"""
Apify-based Mouser price lookup, using the purpose-built
"crawloop/mouser-product-scraper" Actor
(https://console.apify.com/actors/PA69eu9d2uDx1daiw/input) instead of the
generic Puppeteer HTML-scrape in apify_generic_scrape.py.

Why this is worth adding on top of apify_generic_scrape.py: that generic
path still screen-scrapes Mouser's rendered HTML from inside an
Apify-hosted browser -- which helps (different proxy IP than the Actions
runner) but doesn't fully solve the problem, since Mouser's Akamai bot
protection is known to block automated *rendered-page* scraping even
from real browsers, regardless of whose infrastructure runs them. A
dedicated Actor that talks to Mouser's own data layer instead of reading
the DOM sidesteps that entirely, which is a materially different (and
more reliable) approach for this one site -- worth trying first, with
the existing generic Puppeteer scrape kept as the next fallback.

You'll need:
1. An Apify account (same one already used for APIFY_TOKEN).
2. APIFY_MOUSER_ACTOR_ID set to "crawloop/mouser-product-scraper" (or
   its Actor ID, PA69eu9d2uDx1daiw) as a GitHub Actions secret/variable.

Input schema confirmed from the Actor's real input UI:
  {
    "baseUrl": "https://www.mouser.com",
    "enrichListingProducts": false,
    "inStockOnly": false,
    "productUrls": ["https://www.mouser.com/ProductDetail/..."],
    "proxyConfiguration": {"useApifyProxy": false}
  }
Only `productUrls` is actually needed for a single-item price lookup --
`baseUrl`, `inStockOnly`, `enrichListingProducts`, and
`proxyConfiguration` all have sane defaults for this use case, so they're
left out here rather than sent redundantly.

Output schema (the shape of each item in the returned dataset) isn't
confirmed yet -- `_extract_price` below tries several likely field
names/shapes and prints the raw item on failure so the real field name
can be read off a live run and hard-coded in.
"""

import os
import requests

APIFY_TOKEN = os.environ.get("APIFY_TOKEN")
APIFY_MOUSER_ACTOR_ID = os.environ.get(
    "APIFY_MOUSER_ACTOR_ID", "crawloop/mouser-product-scraper"
)


def _extract_price(item: dict):
    """Try several likely field names/shapes -- single unit price, or
    the first entry of a price-break/tier list, whichever the Actor
    actually returns (unconfirmed until seen on a live run)."""
    for key in ("unitPrice", "price", "priceBreaks", "pricingTiers", "prices"):
        val = item.get(key)
        if val is None:
            continue
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str):
            digits = "".join(c for c in val if c.isdigit() or c == ".")
            if digits:
                try:
                    return float(digits)
                except ValueError:
                    continue
        if isinstance(val, dict):
            # e.g. {"price": 449.00, "qty": 1} or {"value": 449.00}
            for subkey in ("price", "value", "unitPrice"):
                if subkey in val:
                    return _extract_price({subkey: val[subkey]})
        if isinstance(val, list) and val:
            # Price-break tiers -- take the qty=1 / first tier's price.
            first = val[0]
            if isinstance(first, dict):
                for subkey in ("price", "unitPrice", "value"):
                    if subkey in first:
                        return _extract_price({subkey: first[subkey]})
    return None


def try_apify_mouser_scrape(url: str) -> dict:
    if not APIFY_TOKEN:
        return {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_MOUSER_ACTOR_ID.replace('/', '~')}"
        f"/run-sync-get-dataset-items?token={APIFY_TOKEN}"
    )

    run_input = {
        "productUrls": [url],
        "proxyConfiguration": {"useApifyProxy": False},
    }

    try:
        resp = requests.post(endpoint, json=run_input, timeout=120)
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        return {"found": False, "error": f"Apify Mouser request failed: {e}"}

    if not items:
        return {"found": False, "error": "Apify Mouser scraper returned no results"}

    price = _extract_price(items[0])
    if price is None:
        print(f"DEBUG: Apify Mouser scrape found no known price field, raw item: {items[0]}")
        return {"found": False, "error": "Apify Mouser result had no recognizable price field"}

    return {"found": True, "price": price, "source": "apify_mouser"}


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... APIFY_MOUSER_ACTOR_ID=... \
    #   python apify_mouser_scrape.py "https://www.mouser.com/ProductDetail/175-SF45-B"
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.mouser.com/ProductDetail/175-SF45-B"
    result = try_apify_mouser_scrape(test_url)
    print(json.dumps(result, indent=2))
