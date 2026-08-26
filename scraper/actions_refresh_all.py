"""
Entry point for .github/workflows/nightly-refresh.yml

Connects directly to Postgres and re-scrapes every item that has a URL
and isn't handled by a dedicated weekly job, every night. Amazon items
are skipped here -- handled by the separate weekly job
(actions_refresh_amazon_weekly.py). Mouser items are also skipped here
-- handled by the separate weekly job (actions_refresh_mouser_weekly.py).
Both are pulled out of the nightly run for the same reason: they're
expensive (Apify credits) and/or prone to getting blocked, so we don't
want to hit them every single night.

Also skips anything checked in the last 3 days, so a person manually
refreshing "Other items" earlier today doesn't get re-scraped for free
by this job a few hours later.

Sites that need Apify's generic Puppeteer Actor (Arrow -- confirmed to
block a plain HTTP fetch) are batched into ONE Actor run instead of one
run per item. Everything else uses the plain HTTP fast path in
scrape_logic.get_price() -- no local Playwright/Puppeteer fallback
anymore, since it duplicated what the Apify actors already handle more
reliably for the sites that actually need JS rendering.
"""

import os
import sys
import psycopg2
import psycopg2.extras
import uuid
from scrape_logic import get_price
from apify_generic_scrape import try_apify_generic_scrape_batch

# Keep in sync with actions_scrape_one.py -- domains confirmed to block a
# plain HTTP fetch, routed through Apify's generic Puppeteer Actor
# instead. (Mouser is excluded from the query below entirely, since it
# now has its own dedicated weekly job with its own Actor -- this list
# only matters for the remaining domains, e.g. Arrow.)
APIFY_GENERIC_DOMAINS = ("arrow.com",)

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def main():
    job_id = str(uuid.uuid4())
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        f"""SELECT id, url FROM items
           WHERE url IS NOT NULL AND url != ''
             AND url NOT ILIKE '%amazon.%'
             AND url NOT ILIKE '%mouser.%'
             AND (last_checked IS NULL OR last_checked < now() - interval '{SKIP_IF_CHECKED_WITHIN_DAYS} days')"""
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

    apify_rows = [r for r in rows if any(d in r["url"] for d in APIFY_GENERIC_DOMAINS)]
    plain_rows = [r for r in rows if r not in apify_rows]

    results = {}

    if apify_rows:
        apify_urls = [r["url"] for r in apify_rows]
        results.update(try_apify_generic_scrape_batch(apify_urls))

    refreshed = 0
    failed = 0

    def apply_result(item_id, result):
        nonlocal refreshed
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

    for row in apify_rows:
        item_id, url = row["id"], row["url"]
        result = results.get(url, {"found": False, "error": "no result returned"})
        apply_result(item_id, result)

    for row in plain_rows:
        item_id, url = row["id"], row["url"]
        try:
            result = get_price(url)
            apply_result(item_id, result)
        except Exception as e:
            print(f"Failed to refresh item {item_id}: {e}", file=sys.stderr)
            cur.execute(
                "UPDATE items SET status = 'link_failed', last_checked = now(), scrape_job_id = NULL WHERE id = %s AND scrape_job_id = %s",
                (item_id,),
            )
            failed += 1

    cur.close()
    conn.close()
    print(f"Nightly refresh complete: {refreshed} updated, {failed} failed")


if __name__ == "__main__":
    main()
