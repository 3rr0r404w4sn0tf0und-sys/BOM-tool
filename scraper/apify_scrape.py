"""
Apify-based Amazon price lookup. Uses Apify's hosted "run sync and get
dataset items" endpoint against the junglee/amazon-crawler Actor -- Apify
maintains the anti-bot handling, we just call it and read the price back.

There is no shared/site-wide APIFY_TOKEN secret -- each user brings their
own Apify token (Settings -> Apify API key on the site), which the API
passes through per-request as client_payload.apify_token on the GitHub
Actions dispatch and the workflow maps to this env var. If a user hasn't
set one, APIFY_TOKEN is simply unset here and this module reports "Apify
not configured" -- the caller (actions_scrape_one.py) falls back to a
plain HTTP fetch.

To set up your own Apify Actor for this to call:
1. Sign up at apify.com (free, no card).
2. Note the Actor ID "junglee/amazon-crawler" (or your chosen Amazon Actor).
3. Set APIFY_AMAZON_ACTOR_ID as a GitHub Actions secret/variable (this one
   IS shared config, not a per-user credential).

Input schema below matches the Actor's confirmed schema (verified against
real Actor input, not guessed). Field names in the returned DATASET item
still need confirming against a real run -- _extract_price checks several
likely candidates and prints the raw item on failure so the actual field
name can be added once seen.
"""

import os
import requests
from urllib.parse import urlparse
import re

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


def _extract_url(item: dict, fallback: str = None):
    for key in ("url", "inputUrl", "productUrl", "canonicalUrl", "detailUrl", "product_url"):
        val = item.get(key)
        if isinstance(val, str) and val:
            return val
    return fallback


def _amazon_asin(url: str):
    if not isinstance(url, str):
        return None
    m = re.search(r"/(?:dp|gp/product|gp/aw/d|dp/product)/([A-Z0-9]{10})(?:[/?#]|$)", url, re.I)
    return m.group(1).upper() if m else None


def _normalize_url(url: str):
    if not isinstance(url, str) or not url:
        return ""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/") or "/"
    return f"{host}{path}"


def _match_input_url(returned_url: str, input_urls: list, used: set):
    # 1) Exact/normalized URL match.
    if returned_url:
        if returned_url in input_urls and returned_url not in used:
            return returned_url
        norm = _normalize_url(returned_url)
        for u in input_urls:
            if u not in used and _normalize_url(u) == norm:
                return u
        # 2) Amazon canonical URL commonly changes from a long product URL
        #    to /dp/<ASIN>. Match by ASIN so a valid Apify result is not lost.
        asin = _amazon_asin(returned_url)
        if asin:
            for u in input_urls:
                if u not in used and _amazon_asin(u) == asin:
                    return u
    return None

def try_apify_scrape(url: str, zip_code: str = None, country_code: str = None, apify_token: str = None) -> dict:
    results = try_apify_scrape_batch([url], zip_code=zip_code, country_code=country_code, apify_token=apify_token)
    return results.get(url, {"found": False, "error": "Apify returned no results (product may be delisted)"})


def try_apify_scrape_batch(urls: list, zip_code: str = None, country_code: str = None, apify_token: str = None) -> dict:
    """Same lookup as try_apify_scrape, but sends every url to the Actor
    in ONE run (categoryOrProductUrls already accepts a list) instead of
    one Actor run per url -- this is the main thing slowing batch/weekly
    Amazon refreshes down, since each Actor run has real startup and
    proxy-negotiation overhead before it scrapes a single page.

    apify_token, if passed, overrides the APIFY_TOKEN env var -- lets a
    caller that's looping over multiple BOM owners (e.g. the nightly/
    weekly cron jobs) use each owner's own token per call instead of a
    single shared one.

    Returns {url: {found, price, source}}, one entry per input url.
    """
    if not urls:
        return {}

    token = apify_token or APIFY_TOKEN
    if not token or not APIFY_ACTOR_ID:
        missing = ", ".join(
            name for name, val in (("APIFY_TOKEN", token), ("APIFY_AMAZON_ACTOR_ID", APIFY_ACTOR_ID))
            if not val
        )
        error = {"found": False, "error": f"Apify not configured (missing env var(s): {missing})"}
        return {u: error for u in urls}

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR_ID}"
        f"/run-sync-get-dataset-items?token={token}"
    )

    run_input = {
        "categoryOrProductUrls": [{"url": u} for u in urls],
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

    # Apify runs can take a while, and a batch of urls takes longer than
    # one -- scale the timeout with batch size, capped so a bad request
    # doesn't hang forever.
    timeout = min(120 + 15 * len(urls), 900)

    try:
        resp = requests.post(endpoint, json=run_input, timeout=timeout)
        resp.raise_for_status()
        items = resp.json()
    except requests.HTTPError as e:
        body = ""
        try:
            body = resp.text[:300]
        except Exception:
            pass
        error = {
            "found": False,
            "error": f"Apify request failed: {e} (actor: {APIFY_ACTOR_ID}, response: {body})",
        }
        return {u: error for u in urls}
    except Exception as e:
        error = {"found": False, "error": f"Apify request failed: {e} (actor: {APIFY_ACTOR_ID})"}
        return {u: error for u in urls}

    results = {}
    used = set()
    for i, item in enumerate(items):
        returned_url = _extract_url(item)
        matched_url = _match_input_url(returned_url, urls, used)
        # If the Actor omitted a URL, a single-item run can safely use its
        # sole input; for multi-item runs, preserve input order as a last
        # resort because the Actor accepts one result per start URL.
        if not matched_url and not returned_url:
            remaining = [u for u in urls if u not in used]
            if len(remaining) == 1:
                matched_url = remaining[0]
            elif i < len(urls) and urls[i] not in used:
                matched_url = urls[i]
        if not matched_url:
            print(f"DEBUG: could not match Apify result to an input URL; returned_url={returned_url!r}, item={item}")
            continue
        used.add(matched_url)
        price = _extract_price(item)
        if price is None:
            keys = ", ".join(sorted(item.keys())) or "(empty item)"
            print(f"DEBUG: no known price field found for {matched_url}, raw item: {item}")
            results[matched_url] = {
                "found": False,
                "error": f"Apify result had no recognizable price field (item keys: {keys})",
            }
        else:
            print(f"Amazon Apify: matched {matched_url} -> ${price}")
            results[matched_url] = {"found": True, "price": price, "source": "apify"}

    for u in urls:
        if u not in results:
            results[u] = {"found": False, "error": "Apify returned no result for this url (product may be delisted)"}

    return results


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... APIFY_AMAZON_ACTOR_ID=... \
    #   python apify_scrape.py "https://www.amazon.com/dp/XXXXXXXXXX"
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.amazon.com/dp/B0BSHF7WHW"
    result = try_apify_scrape(test_url)
    print(json.dumps(result, indent=2))
