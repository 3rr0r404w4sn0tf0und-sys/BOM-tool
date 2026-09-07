"""
Entry point for .github/workflows/weekly-refresh-etsy.yml

Runs weekly, same cadence as Mouser's weekly job (Etsy has no separate
bot-protection concern driving this like Mouser's Akamai issue -- it's
just kept off the nightly job for the same credit-cost reason, and
weekly was the cadence asked for here).

1. Skip anything checked in the last 3 days -- covers items a person
   already manually refreshed (via the BOM page dropdown) earlier in
   the week.
2. Everything left goes to the dedicated Etsy Actor
   (apify_etsy_scrape.py) in ONE batched run.
3. Anything the dedicated Actor didn't find a price for keeps its last
   known price and gets flagged stale_price = true, same as the
   Amazon/Mouser weekly jobs.
"""

import os
import psycopg2
import psycopg2.extras
import uuid
from apify_etsy_scrape import try_apify_etsy_scrape_batch
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
            WHERE items.url IS NOT NULL AND items.url != '' AND items.url ILIKE '%etsy.%'
              AND items.source IS DISTINCT FROM 'manual'
              AND (items.last_checked IS NULL OR items.last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
    )
    rows = cur.fetchall()
    print(f"Weekly Etsy refresh: {len(rows)} items to check (skipping anything checked in the last {SKIP_IF_CHECKED_WITHIN_DAYS} days)")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    cur.execute("UPDATE items SET status = 'pending', stale_price = false, scrape_job_id = %s WHERE id = ANY(%s::uuid[])", (job_id, [r["id"] for r in rows]))
    url_to_id = {row["url"]: row["id"] for row in rows}

    # Group by BOM owner so each owner's Apify credits/token only pay for
    # their own Etsy items -- there is no shared APIFY_TOKEN anymore.
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
        results.update(try_apify_etsy_scrape_batch(urls, apify_token=token))

    leftover_by_owner = {}
    for user_id, urls in by_owner.items():
        leftover = [u for u in urls if not results.get(u, {}).get("found")]
        if leftover:
            leftover_by_owner[user_id] = leftover

    if leftover_by_owner:
        total_leftover = sum(len(v) for v in leftover_by_owner.values())
        total_urls = sum(len(v) for v in by_owner.values())
        print(f"Dedicated Etsy Actor found {total_urls - total_leftover}/{total_urls}; "
              f"{total_leftover} not found (no fallback scraper anymore -- keeping last known price)")

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
    print(f"Weekly Etsy refresh complete: {refreshed} updated, {stale} kept stale")


if __name__ == "__main__":
    main()
