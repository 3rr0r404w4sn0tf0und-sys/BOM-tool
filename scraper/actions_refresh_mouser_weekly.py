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

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def main():
    job_id = str(uuid.uuid4())
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""SELECT id, url FROM items
            WHERE url IS NOT NULL AND url != '' AND url ILIKE '%mouser.%'
              AND (last_checked IS NULL OR last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
    )
    rows = cur.fetchall()
    print(f"Weekly Mouser refresh: {len(rows)} items to check (skipping anything checked in the last {SKIP_IF_CHECKED_WITHIN_DAYS} days)")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    cur.execute("UPDATE items SET status = 'pending', stale_price = false, scrape_job_id = %s WHERE id = ANY(%s::uuid[])", (job_id, [r["id"] for r in rows]))
    urls = [row["url"] for row in rows]
    url_to_id = {row["url"]: row["id"] for row in rows}

    results = try_apify_mouser_scrape_batch(urls)

    leftover_urls = [u for u in urls if not results.get(u, {}).get("found")]
    if leftover_urls:
        print(f"Dedicated Mouser Actor found {len(urls) - len(leftover_urls)}/{len(urls)}; "
              f"trying generic Apify scrape for the remaining {len(leftover_urls)}")
        generic_results = try_apify_generic_scrape_batch(leftover_urls)
        results.update(generic_results)

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
