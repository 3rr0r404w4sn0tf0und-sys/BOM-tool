"""
Entry point for .github/workflows/weekly-refresh-mouser.yml

Runs weekly (not nightly) specifically for Mouser items, mirroring the
Amazon weekly job. Mouser was pulled out of the nightly job for the
same reason Amazon was: Apify usage costs credits and Mouser's Akamai
bot protection is prone to blocking, so hitting it every single night
isn't worth it.

1. Skip anything checked in the last 3 days -- covers items a person
   already manually refreshed (via the BOM page dropdown) earlier in
   the week.
2. Everything left goes to the dedicated Mouser Actor
   (crawloop/mouser-product-scraper) in ONE batched run -- it talks to
   Mouser's own data layer instead of screen-scraping the rendered
   page, sidestepping the Akamai block, and batching cuts out the
   per-item Actor startup overhead that made this slow before.
3. Anything the dedicated Actor didn't find a price for falls back to
   ONE batched run of the generic Apify Puppeteer scrape
   (apify_generic_scrape.py) for just the leftover urls.
4. Anything still not found keeps its last known price and gets
   flagged stale_price = true, same as the Amazon weekly job.

No local Playwright/Puppeteer fallback anymore -- it duplicated what
the Apify actors already handle more reliably, on top of adding
per-item overhead that batching now avoids.
"""

import os
import psycopg2
import psycopg2.extras
import uuid
from apify_mouser_scrape import try_apify_mouser_scrape_batch
from apify_generic_scrape import try_apify_generic_scrape_batch
from secret_crypto import decrypt_secret

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def main():
    job_id = str(uuid.uuid4())
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""SELECT items.id, items.url, boms.user_id FROM items
            JOIN sections ON items.section_id = sections.id
            JOIN boms ON sections.bom_id = boms.id
            WHERE items.url IS NOT NULL AND items.url != '' AND items.url ILIKE '%mouser.%'
              AND (items.last_checked IS NULL OR items.last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
    )
    rows = cur.fetchall()
    print(f"Weekly Mouser refresh: {len(rows)} items to check (skipping anything checked in the last {SKIP_IF_CHECKED_WITHIN_DAYS} days)")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    cur.execute("UPDATE items SET status = 'pending', stale_price = false, scrape_job_id = %s WHERE id = ANY(%s::uuid[])", (job_id, [r["id"] for r in rows]))
    url_to_id = {row["url"]: row["id"] for row in rows}

    # Group by BOM owner so each owner's Apify credits/token only pay for
    # their own Mouser items -- there is no shared APIFY_TOKEN anymore.
    by_owner = {}
    for row in rows:
        by_owner.setdefault(row["user_id"], []).append(row["url"])

    owner_tokens = {}
    results = {}
    for user_id, urls in by_owner.items():
        cur.execute("SELECT apify_token_encrypted FROM users WHERE id = %s", (user_id,))
        token_row = cur.fetchone()
        token = decrypt_secret(token_row["apify_token_encrypted"]) if token_row else None
        owner_tokens[user_id] = token
        results.update(try_apify_mouser_scrape_batch(urls, apify_token=token))

    leftover_by_owner = {}
    for user_id, urls in by_owner.items():
        leftover = [u for u in urls if not results.get(u, {}).get("found")]
        if leftover:
            leftover_by_owner[user_id] = leftover

    if leftover_by_owner:
        total_leftover = sum(len(v) for v in leftover_by_owner.values())
        total_urls = sum(len(v) for v in by_owner.values())
        print(f"Dedicated Mouser Actor found {total_urls - total_leftover}/{total_urls}; "
              f"trying generic Apify scrape for the remaining {total_leftover}")
        for user_id, leftover in leftover_by_owner.items():
            results.update(try_apify_generic_scrape_batch(leftover, apify_token=owner_tokens.get(user_id)))

    refreshed = 0
    stale = 0

    for url, item_id in url_to_id.items():
        result = results.get(url, {"found": False, "error": "no result returned"})
        if result.get("found"):
            print(f"{item_id}: found price {result['price']} (source: {result.get('source')})")
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s, last_checked = now(),
                       stale_price = false, scrape_job_id = NULL
                   WHERE id = %s AND scrape_job_id = %s""",
                (result["price"], result.get("source"), item_id, job_id),
            )
            refreshed += 1
        else:
            print(f"{item_id}: all methods failed ({result.get('error')}), keeping last known price")
            cur.execute(
                "UPDATE items SET status = CASE WHEN unit_price IS NULL THEN 'price_not_found' ELSE 'ok' END, stale_price = true, last_checked = now(), scrape_job_id = NULL WHERE id = %s AND scrape_job_id = %s",
                (item_id, job_id),
            )
            stale += 1

    cur.close()
    conn.close()
    print(f"Weekly Mouser refresh complete: {refreshed} updated, {stale} kept stale")


if __name__ == "__main__":
    main()
