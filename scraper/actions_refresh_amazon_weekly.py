"""
Entry point for .github/workflows/weekly-refresh-amazon.yml

Runs weekly (not nightly) specifically for Amazon items, since Amazon
requests are the ones that cost Apify credits and carry blocking risk.
Non-Amazon items are still refreshed nightly by actions_refresh_all.py.

1. Skip anything checked in the last 3 days -- covers items a person
   already manually refreshed (via the BOM page dropdown) earlier in
   the week, so this job isn't re-paying for a scrape that's still
   fresh.
2. Everything left gets sent to the Apify Amazon Actor in ONE batched
   run (categoryOrProductUrls takes a list) instead of one Actor run
   per item -- an Actor run has real startup/proxy-negotiation overhead
   before it even loads the first page, so batching is what actually
   cuts the wall-clock time down on a big refresh.
3. Anything the Actor didn't find a price for keeps its last known
   price and gets flagged stale_price = true. User can manually hit
   "Solve CAPTCHA" from the BOM page any time.

No local Playwright/Puppeteer fallback anymore -- it duplicated what
the Apify Actor already handles more reliably and was the main thing
slowing this down before batching, on top of the per-item overhead.
"""

import os
import psycopg2
import psycopg2.extras
from apify_scrape import try_apify_scrape_batch

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""SELECT id, url FROM items
            WHERE url IS NOT NULL AND url != '' AND url ILIKE '%amazon.%'
              AND (last_checked IS NULL OR last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
    )
    rows = cur.fetchall()
    print(f"Weekly Amazon refresh: {len(rows)} items to check (skipping anything checked in the last {SKIP_IF_CHECKED_WITHIN_DAYS} days)")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    urls = [row["url"] for row in rows]
    url_to_id = {row["url"]: row["id"] for row in rows}

    results = try_apify_scrape_batch(urls)

    refreshed = 0
    stale = 0

    for url, item_id in url_to_id.items():
        result = results.get(url, {"found": False, "error": "no result returned"})
        if result.get("found"):
            print(f"{item_id}: Apify found price {result['price']}")
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s, last_checked = now(),
                       stale_price = false
                   WHERE id = %s""",
                (result["price"], result.get("source"), item_id),
            )
            refreshed += 1
        else:
            print(f"{item_id}: Apify failed ({result.get('error')}), keeping last known price")
            cur.execute(
                "UPDATE items SET stale_price = true, last_checked = now() WHERE id = %s",
                (item_id,),
            )
            stale += 1

    cur.close()
    conn.close()
    print(f"Weekly Amazon refresh complete: {refreshed} updated, {stale} kept stale")


if __name__ == "__main__":
    main()
