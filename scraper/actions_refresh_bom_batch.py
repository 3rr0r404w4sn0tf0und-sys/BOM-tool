"""
Entry point for .github/workflows/scrape-bom-batch.yml

Scrapes every item in ONE specific BOM that matches FILTER
("amazon" | "mouser" | "other" | "all") -- this is what the refresh
buttons on the BOM page trigger. One repository_dispatch, one Actions
run, instead of firing a separate dispatch per item.

Two optimizations over the old per-item loop:
1. Skip anything checked in the last 3 days -- if you already refreshed
   "Amazon items" this morning and hit "Everything" this afternoon,
   those Amazon items don't get re-scraped for free.
2. Whatever's left is grouped by provider (Amazon / Mouser / other) and
   sent to each Apify actor in ONE batched run per provider, instead of
   one Actor run per item -- an Actor run has real startup/proxy-
   negotiation overhead before it even loads the first page, so this is
   what actually cuts the wait down on a BOM with a lot of items.

Amazon items go through the Apify Amazon Actor and keep their last
known price on failure, flagged stale. Mouser items try the dedicated
Mouser Actor first, then the generic Apify Puppeteer scrape for
whatever's left over, and also keep their last known price on failure,
flagged stale. Everything else ("other") uses the plain get_price()
scraper (same as the nightly job) and clears its price on failure, same
as that job does.

No local Playwright/Puppeteer fallback anymore -- it duplicated what
the Apify actors already handle more reliably, and was slow on top of
that.
"""

import os
import psycopg2
import psycopg2.extras
import uuid
from urllib.parse import urlparse
from scrape_logic import get_price
from apify_scrape import try_apify_scrape_batch
from apify_generic_scrape import try_apify_generic_scrape_batch
from apify_mouser_scrape import try_apify_mouser_scrape_batch

SKIP_IF_CHECKED_WITHIN_DAYS = 3


def is_amazon(url):
    host = (urlparse(url).hostname or "").lower()
    return host == "amazon.com" or host.endswith(".amazon.com") or host.startswith("amazon.")


def is_mouser(url):
    host = (urlparse(url).hostname or "").lower()
    return host == "mouser.com" or host.endswith(".mouser.com")


def main():
    bom_id = os.environ["BOM_ID"]
    filt = os.environ.get("FILTER", "all")
    job_id = os.environ["JOB_ID"]

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    where = (
        "sections.bom_id = %s AND items.scrape_job_id = %s AND items.url IS NOT NULL AND items.url != '' "
    )
    params = [bom_id, job_id]
    if filt == "amazon":
        where += " AND items.url ILIKE %s"
        params.append("%amazon.%")
    elif filt == "mouser":
        where += " AND items.url ILIKE %s"
        params.append("%mouser.%")
    elif filt == "other":
        where += " AND items.url NOT ILIKE %s AND items.url NOT ILIKE %s"
        params.append("%amazon.%")
        params.append("%mouser.%")

    cur.execute(
        f"""SELECT items.id, items.url, items.scrape_job_id FROM items
            JOIN sections ON items.section_id = sections.id
            WHERE {where}""",
        params,
    )
    rows = cur.fetchall()
    print(f"BOM batch refresh ({filt}) for bom {bom_id}: {len(rows)} items to check")

    if not rows:
        cur.close()
        conn.close()
        print("Nothing to do.")
        return

    amazon_rows = [r for r in rows if is_amazon(r["url"])]
    mouser_rows = [r for r in rows if is_mouser(r["url"])]
    other_rows = [r for r in rows if not is_amazon(r["url"]) and not is_mouser(r["url"])]

    results = {}

    if amazon_rows:
        results.update(try_apify_scrape_batch([r["url"] for r in amazon_rows]))

    if mouser_rows:
        mouser_urls = [r["url"] for r in mouser_rows]
        mouser_results = try_apify_mouser_scrape_batch(mouser_urls)
        leftover = [u for u in mouser_urls if not mouser_results.get(u, {}).get("found")]
        if leftover:
            print(f"Dedicated Mouser Actor found {len(mouser_urls) - len(leftover)}/{len(mouser_urls)}; "
                  f"trying generic Apify scrape for the remaining {len(leftover)}")
            mouser_results.update(try_apify_generic_scrape_batch(leftover))
        results.update(mouser_results)

    refreshed = 0
    failed = 0

    for row in amazon_rows + mouser_rows:
        item_id, url = row["id"], row["url"]
        result = results.get(url, {"found": False, "error": "no result returned"})
        if result.get("found"):
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s,
                       last_checked = now(), stale_price = false, scrape_job_id = NULL
                   WHERE id = %s AND scrape_job_id = %s""",
                (result["price"], result.get("source"), item_id, job_id),
            )
            refreshed += 1
        else:
            # Keep the last known price for Amazon/Mouser rather than
            # nuking it -- same behavior as their dedicated weekly jobs.
            cur.execute(
                "UPDATE items SET status = CASE WHEN unit_price IS NULL THEN 'price_not_found' ELSE 'ok' END, stale_price = true, last_checked = now(), scrape_job_id = NULL WHERE id = %s AND scrape_job_id = %s",
                (item_id, job_id),
            )
            failed += 1

    for row in other_rows:
        item_id, url = row["id"], row["url"]
        try:
            result = get_price(url)
        except Exception as e:
            result = {"found": False, "error": f"Unhandled scrape error: {e}"}

        if result.get("found"):
            cur.execute(
                """UPDATE items
                   SET unit_price = %s, status = 'ok', source = %s,
                       last_checked = now(), stale_price = false, scrape_job_id = NULL
                   WHERE id = %s AND scrape_job_id = %s""",
                (result["price"], result.get("source"), item_id, job_id),
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
                   SET unit_price = NULL, status = %s, source = NULL, last_checked = now(), scrape_job_id = NULL
                   WHERE id = %s AND scrape_job_id = %s""",
                (status, item_id, job_id),
            )
            failed += 1

    cur.close()
    conn.close()
    print(f"BOM batch refresh complete: {refreshed} updated, {failed} failed/stale")


if __name__ == "__main__":
    main()
