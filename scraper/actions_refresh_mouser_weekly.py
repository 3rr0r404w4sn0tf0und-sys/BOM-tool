"""
Entry point for .github/workflows/weekly-refresh-mouser.yml

Runs weekly (not nightly) specifically for Mouser items, mirroring the
existing Amazon biweekly job (actions_refresh_amazon_weekly.py) but on a
weekly cadence. Mouser was pulled out of the nightly job for the same
reason Amazon was: Apify usage costs credits and Mouser's Akamai bot
protection is prone to blocking, so hitting it every single night isn't
worth it.

Order of attempts per item (same as actions_scrape_one.py):
1. Dedicated Mouser Actor (crawloop/mouser-product-scraper) -- talks to
   Mouser's own data layer instead of screen-scraping the rendered page,
   sidesteps the Akamai block entirely. Tried first.
2. Generic Apify Puppeteer scrape (different infra/IP than the Actions
   runner, but still screen-scrapes -- next best thing).
3. Direct Playwright scrape (free, most likely to get blocked).
4. If all three fail: keep the last known price, flag stale_price = true,
   same as the Amazon weekly job does.
"""

import os
import time
import random
import psycopg2
import psycopg2.extras
from scrape_logic import try_playwright_scrape
from apify_mouser_scrape import try_apify_mouser_scrape
from apify_generic_scrape import try_apify_generic_scrape

# Pace Playwright fallback attempts so we don't hammer Mouser back to back.
DELAY_MIN = 15
DELAY_MAX = 45


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        "SELECT id, url FROM items WHERE url IS NOT NULL AND url != '' AND url ILIKE '%mouser.%'"
    )
    rows = cur.fetchall()
    print(f"Weekly Mouser refresh: {len(rows)} items to check")

    refreshed = 0
    stale = 0

    for i, row in enumerate(rows):
        item_id, url = row["id"], row["url"]
        print(f"--- {item_id} ({i + 1}/{len(rows)}) ---")

        result = try_apify_mouser_scrape(url)
        if result.get("found"):
            print(f"Apify Mouser Actor found price: {result['price']}")
        else:
            print(f"Apify Mouser Actor failed ({result.get('error')}), trying generic Apify scrape")
            result = try_apify_generic_scrape(url)
            if result.get("found"):
                print(f"Apify generic scrape found price: {result['price']}")
            else:
                print(f"Apify generic scrape failed ({result.get('error')}), falling back to Playwright")
                time.sleep(random.randint(DELAY_MIN, DELAY_MAX))
                try:
                    result = try_playwright_scrape(url)
                except Exception as e:
                    result = {"found": False, "error": f"Playwright error: {e}"}

        if result.get("found"):
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s, last_checked = now(),
                       stale_price = false
                   WHERE id = %s""",
                (result["price"], result.get("source"), item_id),
            )
            refreshed += 1
        else:
            print(f"All methods failed ({result.get('error')}), keeping last known price")
            cur.execute(
                "UPDATE items SET stale_price = true, last_checked = now() WHERE id = %s",
                (item_id,),
            )
            stale += 1

    cur.close()
    conn.close()
    print(f"Weekly Mouser refresh complete: {refreshed} updated, {stale} kept stale")


if __name__ == "__main__":
    main()
