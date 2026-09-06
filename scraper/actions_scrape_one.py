"""
Entry point for .github/workflows/scrape-on-demand.yml

Scrapes one URL and POSTs the result back to the BOM Tool API's
internal callback endpoint. Never raises -- any failure is reported
as a normal "not found" result so the workflow always exits cleanly
and the item never gets stuck on "pending" forever.
"""

import os
import sys
import requests

# Must happen before the apify_* imports below -- they read
# os.environ["APIFY_TOKEN"] once at import time.
from fetch_apify_credential import fetch_apify_token
_job_id_for_token_fetch = os.environ.get("JOB_ID")
if _job_id_for_token_fetch:
    _token = fetch_apify_token(_job_id_for_token_fetch)
    if _token:
        os.environ["APIFY_TOKEN"] = _token

from scrape_logic import get_price
from apify_scrape import try_apify_scrape
from apify_mouser_scrape import try_apify_mouser_scrape
from apify_etsy_scrape import try_apify_etsy_scrape

# mouser.com has a dedicated Actor (crawloop/mouser-product-scraper) that
# talks to Mouser's own data layer instead of screen-scraping the
# rendered page -- sidesteps the Akamai block that a plain HTTP fetch
# hits. Tried first for Mouser; falls back to the plain HTTP fast path
# as a last resort (won't get through, but costs nothing to try).
APIFY_MOUSER_DOMAINS = ("mouser.com",)

# etsy.com also 403s a plain HTTP fetch (confirmed via a real on-demand
# scrape attempt), so it gets the same dedicated-Actor-first treatment
# as Mouser.
APIFY_ETSY_DOMAINS = ("etsy.com",)

# NOTE: arrow.com previously routed through Apify's generic Puppeteer
# Actor here (removed at the user's request, along with the rest of the
# Puppeteer/Playwright pipeline -- see apify_generic_scrape.py's git
# history / actions_scrape_captcha.py, both deleted). Arrow now falls
# through to the plain HTTP fast path below like anything else with no
# dedicated Actor, which was previously confirmed to get blocked by
# Arrow's WAF -- so Arrow items will likely report price_not_found
# until/unless a dedicated Arrow Actor is added the same way Mouser and
# Etsy have one.


def main():
    item_id = os.environ["ITEM_ID"]
    job_id = os.environ["JOB_ID"]
    url = os.environ["URL"]
    callback_url = os.environ["CALLBACK_URL"]
    secret = os.environ["INTERNAL_SCRAPE_SECRET"]

    try:
        from urllib.parse import urlparse

        hostname = (urlparse(url).hostname or "").lower()
        if hostname == "amazon.com" or hostname.endswith(".amazon.com") or hostname.startswith("amazon."):
            # Amazon: try Apify first (costs credits but handles anti-bot),
            # fall back to the plain HTTP fast path (free, won't get past
            # a protected page -- it reports price_not_found and preserves any
            # previously known protected-store price as stale on the API side).
            result = try_apify_scrape(url)
            if not result.get("found"):
                print(f"Apify failed ({result.get('error')}), trying plain HTTP fetch")
                result = get_price(url)
        elif any((urlparse(url).hostname or "").lower() == domain or (urlparse(url).hostname or "").lower().endswith("." + domain) for domain in APIFY_MOUSER_DOMAINS):
            # Mouser: try the dedicated Mouser Actor first (talks to
            # Mouser's own data layer, sidesteps the Akamai block
            # entirely), then the plain HTTP fast path as a last resort.
            result = try_apify_mouser_scrape(url)
            if not result.get("found"):
                print(f"Apify Mouser scrape failed ({result.get('error')}), trying plain HTTP fetch")
                result = get_price(url)
        elif any((urlparse(url).hostname or "").lower() == domain or (urlparse(url).hostname or "").lower().endswith("." + domain) for domain in APIFY_ETSY_DOMAINS):
            # Etsy: same chain as Mouser -- plain HTTP gets a 403, so try
            # the dedicated Etsy Actor first, then the plain HTTP fast
            # path as a last resort.
            result = try_apify_etsy_scrape(url)
            if not result.get("found"):
                print(f"Apify Etsy scrape failed ({result.get('error')}), trying plain HTTP fetch")
                result = get_price(url)
        else:
            result = get_price(url)
    except Exception as e:
        result = {"found": False, "error": f"Unhandled scrape error: {e}"}

    payload = {
        "item_id": item_id,
        "job_id": job_id,
        "found": result.get("found", False),
        "price": result.get("price"),
        "source": result.get("source"),
        "error": result.get("error"),
    }

    try:
        resp = requests.post(
            callback_url,
            json=payload,
            headers={"X-Internal-Secret": secret},
            timeout=15,
        )
        resp.raise_for_status()
        print(f"Reported result for item {item_id}: {payload}")
    except Exception as e:
        # Log and exit non-zero so the Actions run is visibly marked
        # failed -- but the item just stays "pending" until next nightly
        # refresh or a manual retry, nothing else breaks.
        print(f"Failed to POST callback for item {item_id}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
