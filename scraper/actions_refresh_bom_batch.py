"""
Entry point for .github/workflows/scrape-bom-batch.yml

Scrapes every item in ONE specific BOM that matches FILTER
("amazon" | "non-amazon" | "all") -- this is what the three refresh
buttons on the BOM page trigger. One repository_dispatch, one Actions
run, instead of firing a separate dispatch per item.

Amazon items go through Apify first, falling back to direct Playwright
(same order as the weekly Amazon job) and keep their last known price
on total failure, flagged stale. Non-Amazon items use the plain
get_price() scraper (same as the nightly job) and clear their price on
failure, same as that job does.
"""

import os
import time
import random
import psycopg2
import psycopg2.extras
from scrape_logic import get_price, try_playwright_scrape
from apify_scrape import try_apify_scrape

# Pace Playwright fallback attempts so we don't hammer Amazon back to back.
DELAY_MIN = 5
DELAY_MAX = 15


def is_amazon(url):
    return "amazon." in url


def main():
    bom_id = os.environ["BOM_ID"]
    filt = os.environ.get("FILTER", "all")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    where = "sections.bom_id = %s AND items.url IS NOT NULL AND items.url != ''"
    params = [bom_id]
    if filt == "amazon":
        where += " AND items.url ILIKE %s"
        params.append("%amazon.%")
    elif filt == "non-amazon":
        where += " AND items.url NOT ILIKE %s"
        params.append("%amazon.%")

    cur.execute(
        f"""SELECT items.id, items.url FROM items
            JOIN sections ON items.section_id = sections.id
            WHERE {where}""",
        params,
    )
    rows = cur.fetchall()
    print(f"BOM batch refresh ({filt}) for bom {bom_id}: {len(rows)} items to check")

    refreshed = 0
    failed = 0

    for i, row in enumerate(rows):
        item_id, url = row["id"], row["url"]
        print(f"--- {item_id} ({i + 1}/{len(rows)}) ---")

        try:
            if is_amazon(url):
                result = try_apify_scrape(url)
                if not result.get("found"):
                    print(f"Apify failed ({result.get('error')}), trying Playwright")
                    time.sleep(random.randint(DELAY_MIN, DELAY_MAX))
                    result = try_playwright_scrape(url)
            else:
                result = get_price(url)
        except Exception as e:
            result = {"found": False, "error": f"Unhandled scrape error: {e}"}

        if result.get("found"):
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s,
                       last_checked = now(), stale_price = false
                   WHERE id = %s""",
                (result["price"], result.get("source"), item_id),
            )
            refreshed += 1
        else:
            if is_amazon(url):
                # Keep the last known price for Amazon rather than nuking
                # it -- same behavior as the weekly Amazon job.
                cur.execute(
                    "UPDATE items SET stale_price = true, last_checked = now() WHERE id = %s",
                    (item_id,),
                )
            else:
                status = (
                    "link_failed"
                    if "link_failed" in (result.get("error") or "").lower()
                    else "price_not_found"
                )
                cur.execute(
                    """UPDATE items
                       SET unit_price = NULL, status = %s, source = NULL, last_checked = now()
                       WHERE id = %s""",
                    (status, item_id),
                )
            failed += 1

    cur.close()
    conn.close()
    print(f"BOM batch refresh complete: {refreshed} updated, {failed} failed/stale")


if __name__ == "__main__":
    main()
