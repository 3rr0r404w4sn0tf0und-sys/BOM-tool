"""
Entry point for .github/workflows/nightly-refresh.yml

Connects directly to Postgres (no API round trip needed since this
runs once a day, not per-request) and re-scrapes every item that has
a URL. One item's failure never stops the rest.
"""

import os
import sys
import psycopg2
import psycopg2.extras
from scrape_logic import get_price


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT id, url FROM items WHERE url IS NOT NULL AND url != ''")
    rows = cur.fetchall()
    print(f"Nightly refresh: {len(rows)} items to check")

    refreshed = 0
    failed = 0

    for row in rows:
        item_id, url = row["id"], row["url"]
        try:
            result = get_price(url)

            if result.get("found"):
                status, price, source = "ok", result["price"], result.get("source")
            elif "link_failed" in (result.get("error") or "").lower():
                status, price, source = "link_failed", None, None
            else:
                status, price, source = "price_not_found", None, None

            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = %s, source = %s, last_checked = now()
                   WHERE id = %s""",
                (price, status, source, item_id),
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
