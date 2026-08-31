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
from apify_generic_scrape import try_apify_generic_scrape
from apify_mouser_scrape import try_apify_mouser_scrape

# Domains confirmed to block/starve a plain HTTP fetch -- these route
# through Apify's generic Puppeteer Actor instead. Add to this list as
# new domains are confirmed to have the same problem; don't add
# speculatively, since each Apify call costs credits.
APIFY_GENERIC_DOMAINS = ("mouser.com", "arrow.com")

# mouser.com specifically has a dedicated Actor (crawloop/mouser-product-
# scraper) that talks to Mouser's own data layer instead of screen-
# scraping the rendered page -- more reliable than the generic Puppeteer
# path below, which can still get WAF-blocked even from Apify's own
# infrastructure. Tried first for Mouser; falls back to the generic path,
# then the plain HTTP fast path as a last resort, same as every other
# route here.
APIFY_MOUSER_DOMAINS = ("mouser.com",)


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
            # entirely), then the generic Puppeteer scrape, then the
            # plain HTTP fast path as a last resort.
            result = try_apify_mouser_scrape(url)
            if not result.get("found"):
                print(f"Apify Mouser scrape failed ({result.get('error')}), trying generic Apify scrape")
                result = try_apify_generic_scrape(url)
            if not result.get("found"):
                print(f"Apify generic scrape failed ({result.get('error')}), trying plain HTTP fetch")
                result = get_price(url)
        elif any((urlparse(url).hostname or "").lower() == domain or (urlparse(url).hostname or "").lower().endswith("." + domain) for domain in APIFY_GENERIC_DOMAINS):
            # Known WAF-blocked distributor sites: try Apify's generic
            # Puppeteer Scraper (runs from Apify's proxy IPs) first, fall
            # back to the plain HTTP fast path.
            result = try_apify_generic_scrape(url)
            if not result.get("found"):
                print(f"Apify generic scrape failed ({result.get('error')}), trying plain HTTP fetch")
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
