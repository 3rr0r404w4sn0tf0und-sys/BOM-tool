"""
Entry point for .github/workflows/weekly-refresh-amazon.yml

Runs weekly (not nightly) specifically for Amazon items, since Amazon
requests are the ones that cost Apify credits and carry blocking risk.
Non-Amazon items are still refreshed nightly by actions_refresh_all.py.

Order of attempts per item:
1. Apify Amazon Actor (handles anti-bot for us, costs Apify credits)
2. Direct Playwright scrape (free, but more likely to hit a CAPTCHA)
3. If both fail: keep the last known price, flag stale_price = true.
   User can manually hit "Solve CAPTCHA" from the BOM page any time.
"""

import os
import sys
import time
import random
import psycopg2
import psycopg2.extras
from scrape_logic import try_playwright_scrape
from apify_scrape import try_apify_scrape

# Still pace Playwright fallback attempts, in case Apify isn't configured
# or fails and we fall through to direct scraping.
DELAY_MIN = 15
DELAY_MAX = 45


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        "SELECT id, url FROM items WHERE url IS NOT NULL AND url != '' AND url ILIKE '%amazon.%'"
    )
    rows = cur.fetchall()
    print(f"Weekly Amazon refresh: {len(rows)} items to check")

    refreshed = 0
    stale = 0

    for row in rows:
        item_id, url = row["id"], row["url"]
        print(f"--- {item_id} ---")

        result = try_apify_scrape(url)
        if result.get("found"):
            print(f"Apify found price: {result['price']}")
        else:
            print(f"Apify failed ({result.get('error')}), falling back to Playwright")
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
            print(f"Both methods failed ({result.get('error')}), keeping last known price")
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
