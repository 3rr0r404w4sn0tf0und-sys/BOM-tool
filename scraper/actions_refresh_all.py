"""
Entry point for .github/workflows/nightly-refresh.yml

Connects directly to Postgres and re-scrapes every item that has a URL
and isn't handled by a dedicated weekly job, every night. Amazon items
are skipped here -- handled by the separate weekly job
(actions_refresh_amazon_weekly.py). Mouser and Etsy items are also
skipped here -- handled by their own separate weekly jobs
(actions_refresh_mouser_weekly.py / actions_refresh_etsy_weekly.py).
All three are pulled out of the nightly run for the same reason:
they're expensive (Apify credits) and/or prone to getting blocked, so
we don't want to hit them every single night.

Also skips anything checked in the last 3 days, so a person manually
refreshing "Other items" earlier today doesn't get re-scraped for free
by this job a few hours later.

Everything here goes through the plain HTTP fast path in
scrape_logic.get_price() -- there is no Apify/Puppeteer/Playwright
fallback for anything in this nightly run anymore (removed at the
user's request). Note this means arrow.com items, which previously
routed through Apify's generic Puppeteer Actor here because a plain
fetch was confirmed to get WAF-blocked, will now likely come back
price_not_found until/unless a dedicated Arrow Actor is added the same
way Mouser and Etsy have one.
"""

import os
import sys
import psycopg2
import psycopg2.extras
import uuid
from scrape_logic import get_price

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def main():
    job_id = str(uuid.uuid4())
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""SELECT items.id, items.url FROM items
           JOIN sections ON items.section_id = sections.id
           JOIN boms ON sections.bom_id = boms.id
           WHERE items.url IS NOT NULL AND items.url != ''
             AND items.url NOT ILIKE '%amazon.%'
             AND items.url NOT ILIKE '%mouser.%'
             AND items.url NOT ILIKE '%etsy.%'
             AND (items.last_checked IS NULL OR items.last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
    )
    rows = cur.fetchall()
    if rows:
        cur.execute("UPDATE items SET status = 'pending', scrape_job_id = %s WHERE id = ANY(%s::uuid[])", (job_id, [r["id"] for r in rows]))
    print(f"Nightly refresh (other items): {len(rows)} items to check (skipping anything checked in the last {SKIP_IF_CHECKED_WITHIN_DAYS} days)")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    refreshed = 0
    failed = 0

    for row in rows:
        item_id, url = row["id"], row["url"]
        try:
            result = get_price(url)
            if result.get("found"):
                cur.execute(
                    """UPDATE items
                       SET unit_price = %s, status = 'ok', source = %s, last_checked = now()
                       WHERE id = %s AND scrape_job_id = %s""",
                    (result["price"], result.get("source"), item_id, job_id),
                )
            else:
                status = (
                    "link_failed"
                    if "link_failed" in (result.get("error") or "").lower()
                    else "price_not_found"
                )
                cur.execute(
                    """UPDATE items
                       SET unit_price = NULL, status = %s, source = NULL, last_checked = now(), scrape_job_id = NULL
                       WHERE id = %s AND scrape_job_id = %s""",
                    (status, item_id, job_id),
                )
            refreshed += 1
        except Exception as e:
            print(f"Failed to refresh item {item_id}: {e}", file=sys.stderr)
            cur.execute(
                "UPDATE items SET status = 'link_failed', last_checked = now(), scrape_job_id = NULL WHERE id = %s AND scrape_job_id = %s",
                (item_id, job_id),
            )
            failed += 1

    cur.close()
    conn.close()
    print(f"Nightly refresh complete: {refreshed} updated, {failed} failed")


if __name__ == "__main__":
    main()
