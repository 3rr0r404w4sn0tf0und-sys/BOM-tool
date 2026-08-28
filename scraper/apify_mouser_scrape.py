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

There is no shared/site-wide APIFY_TOKEN secret -- each user brings their
own Apify token (Settings -> Apify API key), passed through per-request
from the API. Without one set, this reports "Apify not configured" and
the caller falls back to the generic Apify scrape, then plain HTTP.

You'll need:
1. An Apify account (same one already used for the Amazon Actor).
2. APIFY_MOUSER_ACTOR_ID set to "crawloop/mouser-product-scraper" (or
   its Actor ID, PA69eu9d2uDx1daiw) as a GitHub Actions secret/variable
   (shared config, not a per-user credential).

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
    for key in ("unitPriceValue", "unitPrice", "price", "priceBreaks", "pricingTiers", "prices"):
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
            for subkey in ("unitPriceValue", "price", "value", "unitPrice"):
                if subkey in val:
                    return _extract_price({subkey: val[subkey]})
        if isinstance(val, list) and val:
            # Price-break tiers -- take the qty=1 / first tier's price.
            first = val[0]
            if isinstance(first, dict):
                for subkey in ("unitPriceValue", "price", "unitPrice", "value"):
                    if subkey in first:
                        return _extract_price({subkey: first[subkey]})
    return None


def _extract_url(item: dict, fallback: str = None):
    for key in ("url", "productUrl", "link", "sourceUrl", "productURL", "product_url"):
        val = item.get(key)
        if isinstance(val, str) and val:
            return val
    return fallback


def _normalize_url(url: str):
    if not isinstance(url, str) or not url:
        return ""
    from urllib.parse import urlparse
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/") or "/"
    return f"{host}{path}"


def _mouser_product_key(url: str):
    if not isinstance(url, str):
        return None
    from urllib.parse import urlparse
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if "productdetail" in [p.lower() for p in parts]:
        i = next((i for i,p in enumerate(parts) if p.lower() == "productdetail"), -1)
        if i >= 0 and i + 1 < len(parts):
            return parts[i + 1].lower()
    return None


def _match_input_url(returned_url: str, input_urls: list, used: set):
    if returned_url:
        if returned_url in input_urls and returned_url not in used:
            return returned_url
        norm = _normalize_url(returned_url)
        for u in input_urls:
            if u not in used and _normalize_url(u) == norm:
                return u
        key = _mouser_product_key(returned_url)
        if key:
            for u in input_urls:
                if u not in used and _mouser_product_key(u) == key:
                    return u
    return None

def try_apify_mouser_scrape(url: str, apify_token: str = None) -> dict:
    results = try_apify_mouser_scrape_batch([url], apify_token=apify_token)
    return results.get(url, {"found": False, "error": "Apify Mouser scraper returned no results"})


def try_apify_mouser_scrape_batch(urls: list, apify_token: str = None) -> dict:
    """Same lookup as try_apify_mouser_scrape, but sends every url to the
    Actor in ONE run (it already accepts a productUrls list) instead of
    one Actor run per url -- cuts out most of the per-item startup
    overhead on a big batch refresh.

    apify_token, if passed, overrides the APIFY_TOKEN env var -- see
    apify_scrape.try_apify_scrape_batch for why.

    Returns {url: {found, price, source}}, one entry per input url.
    """
    if not urls:
        return {}

    token = apify_token or APIFY_TOKEN
    if not token:
        error = {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}
        return {u: error for u in urls}

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_MOUSER_ACTOR_ID.replace('/', '~')}"
        f"/run-sync-get-dataset-items?token={token}"
    )

    run_input = {
        "productUrls": urls,
        "proxyConfiguration": {"useApifyProxy": False},
    }

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
            "error": f"Apify Mouser request failed: {e} (actor: {APIFY_MOUSER_ACTOR_ID}, response: {body})",
        }
        return {u: error for u in urls}
    except Exception as e:
        error = {"found": False, "error": f"Apify Mouser request failed: {e} (actor: {APIFY_MOUSER_ACTOR_ID})"}
        return {u: error for u in urls}

    results = {}
    used = set()
    for i, item in enumerate(items):
        returned_url = _extract_url(item)
        matched_url = _match_input_url(returned_url, urls, used)
        if not matched_url and not returned_url:
            remaining = [u for u in urls if u not in used]
            if len(remaining) == 1:
                matched_url = remaining[0]
            elif i < len(urls) and urls[i] not in used:
                matched_url = urls[i]
        if not matched_url:
            print(f"DEBUG: could not match Mouser Apify result; returned_url={returned_url!r}, item={item}")
            continue
        used.add(matched_url)
        price = _extract_price(item)
        if price is None:
            keys = ", ".join(sorted(item.keys())) or "(empty item)"
            print(f"DEBUG: Apify Mouser scrape found no known price field for {matched_url}, raw item: {item}")
            results[matched_url] = {
                "found": False,
                "error": f"Apify Mouser result had no recognizable price field (item keys: {keys})",
            }
        else:
            print(f"Mouser Apify: matched {matched_url} -> ${price}")
            results[matched_url] = {"found": True, "price": price, "source": "apify_mouser"}

    for u in urls:
        if u not in results:
            results[u] = {"found": False, "error": "Apify Mouser scraper returned no result for this url"}

    return results


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... APIFY_MOUSER_ACTOR_ID=... \
    #   python apify_mouser_scrape.py "https://www.mouser.com/ProductDetail/175-SF45-B"
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.mouser.com/ProductDetail/175-SF45-B"
    result = try_apify_mouser_scrape(test_url)
    print(json.dumps(result, indent=2))
