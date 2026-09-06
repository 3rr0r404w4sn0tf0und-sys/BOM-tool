"""
Apify-based Etsy price lookup, using the "Etsy Scraper" Actor
(https://console.apify.com/actors/JOUStaVgex0lqbRnk/input), the same
pattern as apify_mouser_scrape.py for Mouser.

Unlike the Mouser Actor (which takes a `productUrls` list built for
per-product lookups), this Actor's confirmed input shape is search-page
oriented:
  {
    "country": "US",
    "includeDetails": false,
    "maxItems": 10,
    "startUrls": [{"url": "https://www.etsy.com/search?q=handmade+jewelry"}]
  }

`startUrls` is still just "pages to crawl" though, and Etsy listing
pages (etsy.com/listing/<id>/...) are a valid page for the Actor to
visit same as a search results page -- so for our use case (refreshing
the price of specific listings already saved on a BOM), each item's
own listing URL is passed as its own `startUrls` entry, one page in,
one result out, same as passing a single-item search would be. This
avoids depending on this Actor's (unconfirmed) search-result-to-query
matching and instead matches results back to input urls the same way
apify_mouser_scrape.py does for its dedicated Actor.

`includeDetails: true` is used here (unlike the example's `false`) --
without it the Actor only returns search-card-level fields, and a
listing page's own price is exactly what a search card would also
carry, so this is likely unnecessary; it's turned on primarily in case
the Actor's price field is otherwise only populated on the "details"
pass. Cheap to leave on for a batch of listing-page urls vs a search
term.

Output schema isn't confirmed yet -- `_extract_price` below tries
several likely field names/shapes and prints the raw item on failure
so the real field name can be read off a live run and hard-coded in,
same as was done for the Mouser Actor.

You'll need:
1. The same Apify account/token already used for Amazon and Mouser
   (each user brings their own -- see Settings -> Apify API key).
2. APIFY_ETSY_ACTOR_ID set to "JOUStaVgex0lqbRnk" (or the actor's
   "creator/name" slug, if you'd rather set it by name) as a GitHub
   Actions secret/variable.
"""

import os
import requests

APIFY_TOKEN = os.environ.get("APIFY_TOKEN")
APIFY_ETSY_ACTOR_ID = os.environ.get("APIFY_ETSY_ACTOR_ID", "JOUStaVgex0lqbRnk")


def _extract_price(item: dict):
    for key in ("price", "priceValue", "salePrice", "currentPrice", "displayPrice", "unitPrice"):
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
            for subkey in ("value", "amount", "price"):
                if subkey in val:
                    return _extract_price({subkey: val[subkey]})
    return None


def _extract_url(item: dict, fallback: str = None):
    for key in ("url", "listingUrl", "link", "sourceUrl", "productUrl"):
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


def _etsy_listing_id(url: str):
    """Pulls the numeric listing id out of an etsy.com/listing/<id>/... url
    -- Etsy lets the slug after the id vary/redirect, so matching on the
    id alone is more reliable than a full path/normalized-url match."""
    if not isinstance(url, str):
        return None
    from urllib.parse import urlparse
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if "listing" in [p.lower() for p in parts]:
        i = next((i for i, p in enumerate(parts) if p.lower() == "listing"), -1)
        if i >= 0 and i + 1 < len(parts) and parts[i + 1].isdigit():
            return parts[i + 1]
    return None


def _match_input_url(returned_url: str, input_urls: list, used: set):
    if returned_url:
        if returned_url in input_urls and returned_url not in used:
            return returned_url
        norm = _normalize_url(returned_url)
        for u in input_urls:
            if u not in used and _normalize_url(u) == norm:
                return u
        listing_id = _etsy_listing_id(returned_url)
        if listing_id:
            for u in input_urls:
                if u not in used and _etsy_listing_id(u) == listing_id:
                    return u
    return None


def try_apify_etsy_scrape(url: str, apify_token: str = None) -> dict:
    results = try_apify_etsy_scrape_batch([url], apify_token=apify_token)
    return results.get(url, {"found": False, "error": "Apify Etsy scraper returned no results"})


def try_apify_etsy_scrape_batch(urls: list, apify_token: str = None) -> dict:
    """Same lookup as try_apify_etsy_scrape, but sends every url to the
    Actor as its own startUrls entry in ONE run, instead of one Actor run
    per url -- cuts out most of the per-item startup overhead on a big
    batch refresh, same as try_apify_mouser_scrape_batch.

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
        f"https://api.apify.com/v2/acts/{APIFY_ETSY_ACTOR_ID.replace('/', '~')}"
        "/run-sync-get-dataset-items"
    )

    run_input = {
        "country": "US",
        "includeDetails": True,
        "maxItems": len(urls),
        "startUrls": [{"url": u} for u in urls],
    }

    timeout = min(120 + 15 * len(urls), 900)

    try:
        resp = requests.post(endpoint, json=run_input, headers={"Authorization": f"Bearer {token}"}, timeout=timeout)
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
            "error": f"Apify Etsy request failed: {e} (actor: {APIFY_ETSY_ACTOR_ID}, response: {body})",
        }
        return {u: error for u in urls}
    except Exception as e:
        error = {"found": False, "error": f"Apify Etsy request failed: {e} (actor: {APIFY_ETSY_ACTOR_ID})"}
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
            print(f"DEBUG: could not match Etsy Apify result; returned_url={returned_url!r}, item={item}")
            continue
        used.add(matched_url)
        price = _extract_price(item)
        if price is None:
            keys = ", ".join(sorted(item.keys())) or "(empty item)"
            print(f"DEBUG: Apify Etsy scrape found no known price field for {matched_url}, raw item: {item}")
            results[matched_url] = {
                "found": False,
                "error": f"Apify Etsy result had no recognizable price field (item keys: {keys})",
            }
        else:
            print(f"Etsy Apify: matched {matched_url} -> ${price}")
            results[matched_url] = {"found": True, "price": price, "source": "apify_etsy"}

    for u in urls:
        if u not in results:
            results[u] = {"found": False, "error": "Apify Etsy scraper returned no result for this url"}

    return results


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... APIFY_ETSY_ACTOR_ID=... \
    #   python apify_etsy_scrape.py "https://www.etsy.com/listing/123456789/example"
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.etsy.com/listing/123456789/example"
    result = try_apify_etsy_scrape(test_url)
    print(json.dumps(result, indent=2))
