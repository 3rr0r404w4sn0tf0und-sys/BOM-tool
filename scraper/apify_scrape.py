"""
Apify-based Amazon price lookup. Uses Apify's hosted "run sync and get
dataset items" endpoint against the junglee/amazon-crawler Actor -- Apify
maintains the anti-bot handling, we just call it and read the price back.

You'll need to:
1. Sign up at apify.com (free, no card).
2. Note the Actor ID "junglee/amazon-crawler" (or your chosen Amazon Actor).
3. Set APIFY_TOKEN and APIFY_AMAZON_ACTOR_ID as GitHub Actions secrets.

Input schema below matches the Actor's confirmed schema (verified against
real Actor input, not guessed). Field names in the returned DATASET item
still need confirming against a real run -- _extract_price checks several
likely candidates and prints the raw item on failure so the actual field
name can be added once seen.
"""

import os
import requests

APIFY_TOKEN = os.environ.get("APIFY_TOKEN")
APIFY_ACTOR_ID = os.environ.get("APIFY_AMAZON_ACTOR_ID")


def _extract_price(item: dict):
    """Try several likely field names for the junglee/amazon-crawler Actor
    (and other common Amazon Actors) since the exact field hasn't been
    confirmed against a real dataset item yet."""
    for key in (
        "price",
        "currentPrice",
        "listPrice",
        "price_value",
        "finalPrice",
        "buyBoxPrice",
        "priceValue",
    ):
        val = item.get(key)
        if val is None:
            continue
        # Some Actors nest price as {"value": 19.99, "currency": "USD"}
        if isinstance(val, dict) and "value" in val:
            return val["value"]
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str):
            digits = "".join(c for c in val if c.isdigit() or c == ".")
            if digits:
                try:
                    return float(digits)
                except ValueError:
                    continue
    return None


def try_apify_scrape(url: str, zip_code: str = None, country_code: str = None) -> dict:
    if not APIFY_TOKEN or not APIFY_ACTOR_ID:
        return {"found": False, "error": "Apify not configured (missing token/actor id)"}

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR_ID}"
        f"/run-sync-get-dataset-items?token={APIFY_TOKEN}"
    )

    run_input = {
        "categoryOrProductUrls": [{"url": url}],
        # Empty by default -- this is what triggers the billed "Delivery
        # Location" event per item. We don't use zip_code yet, so there's
        # no reason to pay for a location lookup we throw away. Only
        # applied to the PRODUCT page (not search/offers) once zip_code
        # is actually passed in.
        "locationDeliverableRoutes": ["PRODUCT"] if zip_code else [],
        "maxItemsPerStartUrl": 1,
        "maxOffers": 0,
        "maxProductVariantsAsSeparateResults": 0,
        "maxSearchPagesPerStartUrl": 9999,
        "proxyCountry": "AUTO_SELECT_PROXY_COUNTRY",
        "scrapeProductDetails": True,
        "scrapeProductVariantPrices": False,
        "scrapeSellers": False,
        "useCaptchaSolver": False,
    }
    # zip_code/country_code aren't wired end-to-end from the DB yet --
    # only include them (and only pay for the Delivery Location lookup
    # above) when actually passed in.
    if zip_code:
        run_input["zipCode"] = zip_code
    if country_code:
        run_input["countryCode"] = country_code

    try:
        resp = requests.post(
            endpoint,
            json=run_input,
            timeout=120,  # Apify runs can take a while, this is a real scrape job
        )
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        return {"found": False, "error": f"Apify request failed: {e}"}

    if not items:
        return {"found": False, "error": "Apify returned no results (product may be delisted)"}

    price = _extract_price(items[0])
    if price is None:
        # Print raw item so the real field name can be read off a live run
        print(f"DEBUG: no known price field found, raw item: {items[0]}")
        return {"found": False, "error": "Apify result had no recognizable price field"}

    return {"found": True, "price": price, "source": "apify"}


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... APIFY_AMAZON_ACTOR_ID=... \
    #   python apify_scrape.py "https://www.amazon.com/dp/XXXXXXXXXX"
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.amazon.com/dp/B0BSHF7WHW"
    result = try_apify_scrape(test_url)
    print(json.dumps(result, indent=2))
