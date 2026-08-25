"""
Entry point for .github/workflows/nightly-refresh.yml

Connects directly to Postgres and re-scrapes every item that has a URL
and isn't handled by a dedicated weekly/biweekly job, every night.
Amazon items are skipped here -- handled by the separate biweekly job
(actions_refresh_amazon_weekly.py). Mouser items are also skipped here --
handled by the separate weekly job (actions_refresh_mouser_weekly.py).
Both are pulled out of the nightly run for the same reason: they're
expensive (Apify credits) and/or prone to getting blocked, so we don't
want to hit them every single night -- and Mouser's dedicated Actor plus
generic-scrape fallback route (used by the weekly job and the on-demand/
batch scrapes) was timing out when squeezed into the nightly run anyway.
"""

import os
import sys
import psycopg2
import psycopg2.extras
from scrape_logic import get_price
from apify_generic_scrape import try_apify_generic_scrape

# Keep in sync with actions_scrape_one.py -- domains confirmed to block/
# starve a plain self-hosted headless Playwright browser, routed through
# Apify's proxy infra first. (Mouser is excluded from the query below
# entirely, since it now has its own dedicated weekly job -- this list
# only matters for the remaining domains, e.g. Arrow.)
APIFY_GENERIC_DOMAINS = ("mouser.com", "arrow.com")


def scrape(url):
    if any(domain in url for domain in APIFY_GENERIC_DOMAINS):
        result = try_apify_generic_scrape(url)
        if not result.get("found"):
            print(f"Apify generic scrape failed ({result.get('error')}), trying Playwright directly")
            result = get_price(url)
        return result
    return get_price(url)


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        """SELECT id, url FROM items
           WHERE url IS NOT NULL AND url != ''
             AND url NOT ILIKE '%amazon.%'
             AND url NOT ILIKE '%mouser.%'"""
    )
    rows = cur.fetchall()
    print(f"Nightly refresh (other items): {len(rows)} items to check")

    refreshed = 0
    failed = 0

    for row in rows:
        item_id, url = row["id"], row["url"]
        try:
            result = scrape(url)

            if result.get("found"):
                cur.execute(
                    """UPDATE items
                       SET unit_price = %s, status = 'ok', source = %s, last_checked = now()
                       WHERE id = %s""",
                    (result["price"], result.get("source"), item_id),
                )
                refreshed += 1
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
                refreshed += 1
        except Exception as e:
            print(f"Failed to refresh item {item_id}: {e}", file=sys.stderr)
            cur.execute(
                "UPDATE items SET status = 'link_failed', last_checked = now() WHERE id = %s",
                (item_id,),
            )
            failed += 1

    cur.close()
    conn.close()
    print(f"Nightly refresh complete: {refreshed} updated, {failed} failed")


if __name__ == "__main__":
    main()

