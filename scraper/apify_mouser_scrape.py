"""
Apify-based Mouser price lookup.

SWAPPED 2026-09 -- the old Actor ("crawloop/mouser-product-scraper",
PA69eu9d2uDx1daiw) was removed from Apify entirely (404
record-not-found on run). Replaced with a different Actor
(https://console.apify.com/actors/EFFpERQryCf3Q7LwL) that talks to
Mouser's mobile-app API instead of screen-scraping the rendered page,
which sidesteps Mouser's Akamai bot protection the same way the old
one claimed to.

IMPORTANT SHAPE CHANGE vs the old Actor: this one is keyed by Mouser
PART NUMBER (`partNumbers: [...]` input), not by product URL
(`productUrls: [...]` like before), and its output items don't carry
a URL back at all -- just `distributor_part_number` /
`manufacturer_part_number`. Since every item in this app is stored
as a Mouser product URL, not a bare part number, this file now:
  1. derives a part number from each stored URL (`_derive_part_number`)
  2. sends those part numbers to the Actor
  3. matches results back to the *original url* by part number

The public function signature (`try_apify_mouser_scrape_batch(urls,
apify_token=None) -> {url: {...}}`) is UNCHANGED -- callers
(actions_refresh_mouser_weekly.py, scrapeDispatcher.js) don't need
any changes.

There is no shared/site-wide APIFY_TOKEN secret -- each user brings
their own Apify token (Settings -> Apify API key), passed through
per-request from the API. Without one set, this reports "Apify not
configured" and the caller falls back to the generic Apify scrape,
then plain HTTP.

You'll need:
1. An Apify account (same one already used for the Amazon Actor).
2. APIFY_MOUSER_ACTOR_ID set to the new Actor's ID, EFFpERQryCf3Q7LwL,
   as a GitHub Actions secret/variable (shared config, not a
   per-user credential) -- this REPLACES the old crawloop value.

Input schema, from the Actor's own README:
  {
    "partNumbers": ["78-2KDFN39CA-M3/H", "NE555P"],
    "maxItemsPerQuery": 100,
    "inStockOnly": false
  }
`searchQueries`/`categoryPaths` also exist on this Actor but aren't
used here -- this is a targeted BOM part-number lookup, not a search.

Output schema, from the Actor's own README example:
  {
    "distributor_part_number": "78-2KDFN39CA-M3/H",
    "manufacturer_part_number": "2KDFN39CA-M3/H",
    "price_breaks": [{"quantity": 1, "price": "$1.37",
                       "price_without_format": 1.37, "currency": "USD"}],
    ...
  }
Price comes from `price_breaks[0]['price_without_format']` (the
qty=1 / first tier). NOT confirmed live yet -- `_extract_price` below
also tries a couple of fallback shapes and prints the raw item on
failure so a real mismatch can be read off a live run and fixed.
"""

import os
import requests
from urllib.parse import urlparse

APIFY_TOKEN = os.environ.get("APIFY_TOKEN")
APIFY_MOUSER_ACTOR_ID = os.environ.get(
    "APIFY_MOUSER_ACTOR_ID", "EFFpERQryCf3Q7LwL"
)


def _derive_part_number(url: str):
    """Pull the likely Mouser part number off a product URL, for
    feeding to the partNumbers-based Actor. Handles both URL shapes
    seen in the wild:
      .../ProductDetail/175-SF45-B                (no locale, no mfr slug)
      .../en/ProductDetail/LightWare-LiDAR/SF45-B  (locale + mfr slug)
    Takes the LAST path segment after ProductDetail -- that's always
    the actual part-number-ish code, regardless of how many segments
    (locale, manufacturer slug) come before it.
    """
    if not isinstance(url, str) or not url:
        return None
    parsed = urlparse(url.strip())
    parts = [p for p in parsed.path.split("/") if p]
    lower = [p.lower() for p in parts]
    if "productdetail" not in lower:
        return None
    i = lower.index("productdetail")
    tail = parts[i + 1:]
    if not tail:
        return None
    return tail[-1]


def _extract_price(item: dict):
    """Primary shape: price_breaks[0].price_without_format (or
    .price, parsed). Falls back to a couple of other likely shapes in
    case the Actor's real output drifts from its README example."""
    breaks = item.get("price_breaks")
    if isinstance(breaks, list) and breaks:
        first = breaks[0]
        if isinstance(first, dict):
            val = first.get("price_without_format")
            if isinstance(val, (int, float)):
                return float(val)
            val = first.get("price")
            if isinstance(val, str):
                digits = "".join(c for c in val if c.isdigit() or c == ".")
                if digits:
                    try:
                        return float(digits)
                    except ValueError:
                        pass

    for key in ("unitPriceValue", "unitPrice", "price"):
        val = item.get(key)
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


def _extract_part_number(item: dict):
    for key in ("distributor_part_number", "manufacturer_part_number"):
        val = item.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def _normalize_part(s: str):
    """Strip everything but alphanumerics and lowercase, so 'SF45-B',
    'SF45/B', 'SF45 B', and '175-SF45/B' all reduce to comparable
    forms ('sf45b' / '175sf45b') regardless of which separator Mouser
    or our own URL-derivation happened to use."""
    if not isinstance(s, str):
        return ""
    return "".join(c for c in s.lower() if c.isalnum())


def _url_part_key(url):
    """Same last-path-segment extraction as _derive_part_number, used
    on the Actor's OWN returned product_detail_url so we can match
    two urls against each other directly -- this sidesteps part-number
    formatting differences entirely when the Actor gives us a url back."""
    part = _derive_part_number(url)
    return _normalize_part(part) if part else None


def try_apify_mouser_scrape(url: str, apify_token: str = None) -> dict:
    results = try_apify_mouser_scrape_batch([url], apify_token=apify_token)
    return results.get(url, {"found": False, "error": "Apify Mouser scraper returned no results"})


def try_apify_mouser_scrape_batch(urls: list, apify_token: str = None) -> dict:
    """Same lookup as try_apify_mouser_scrape, but sends every url to
    the Actor in ONE run (as a batch of derived part numbers) instead
    of one Actor run per url.

    apify_token, if passed, overrides the APIFY_TOKEN env var -- see
    apify_scrape.try_apify_scrape_batch for why.

    Returns {url: {found, price, source}}, one entry per input url --
    same external shape as before the Actor swap, even though the
    Actor itself is now keyed by part number internally.
    """
    if not urls:
        return {}

    token = apify_token or APIFY_TOKEN
    if not token:
        error = {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}
        return {u: error for u in urls}

    # Derive a part number per url; urls we can't derive anything from
    # fail immediately without wasting an Actor call on them.
    url_to_part = {}
    undeliverable = []
    for u in urls:
        part = _derive_part_number(u)
        if part:
            url_to_part[u] = part
        else:
            undeliverable.append(u)

    if not url_to_part:
        error = {"found": False, "error": "Could not derive a Mouser part number from this url"}
        return {u: error for u in urls}

    part_numbers = list(url_to_part.values())
    # Normalized (separator-stripped) part -> input urls, for fuzzy
    # matching against whatever separator style Mouser returns.
    part_to_urls = {}
    for u, p in url_to_part.items():
        part_to_urls.setdefault(_normalize_part(p), []).append(u)

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_MOUSER_ACTOR_ID.replace('/', '~')}"
        "/run-sync-get-dataset-items"
    )

    run_input = {
        "partNumbers": part_numbers,
        "maxItemsPerQuery": 100,
        "inStockOnly": False,
    }

    timeout = min(120 + 15 * len(part_numbers), 900)

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
            "error": f"Apify Mouser request failed: {e} (actor: {APIFY_MOUSER_ACTOR_ID}, response: {body})",
        }
        return {u: error for u in urls}
    except Exception as e:
        error = {"found": False, "error": f"Apify Mouser request failed: {e} (actor: {APIFY_MOUSER_ACTOR_ID})"}
        return {u: error for u in urls}

    results = {}
    used_parts = set()
    for item in items:
        matched_urls = []

        # 1) Best match: the Actor's own product_detail_url, reduced
        # the same way we reduced our input urls -- sidesteps every
        # separator/prefix quirk since it's comparing like-for-like.
        returned_url = item.get("product_detail_url")
        url_key = _url_part_key(returned_url) if returned_url else None
        if url_key and url_key in part_to_urls:
            matched_urls = part_to_urls[url_key]

        returned_part = _extract_part_number(item)
        if not matched_urls and returned_part:
            key = _normalize_part(returned_part)
            if key in part_to_urls:
                matched_urls = part_to_urls[key]
            else:
                # Loose match: returned part number contains or is
                # contained by a derived one (Mouser often prefixes
                # its own catalog number, e.g. "175SF45B" vs "SF45B").
                for derived_key, us in part_to_urls.items():
                    if derived_key and (derived_key in key or key in derived_key):
                        matched_urls = us
                        break

        if not matched_urls:
            print(f"DEBUG: could not match Mouser Apify result to a url; returned_part={returned_part!r}, product_detail_url={returned_url!r}, item={item}")
            continue

        price = _extract_price(item)
        for u in matched_urls:
            if u in used_parts:
                continue
            used_parts.add(u)
            if price is None:
                keys = ", ".join(sorted(item.keys())) or "(empty item)"
                print(f"DEBUG: Apify Mouser scrape found no known price field for {u}, raw item: {item}")
                results[u] = {
                    "found": False,
                    "error": f"Apify Mouser result had no recognizable price field (item keys: {keys})",
                }
            else:
                print(f"Mouser Apify: matched {u} -> ${price}")
                results[u] = {"found": True, "price": price, "source": "apify_mouser"}
            break  # one result item maps to one url even if several urls share a part number

    for u in urls:
        if u not in results:
            if u in undeliverable:
                results[u] = {"found": False, "error": "Could not derive a Mouser part number from this url"}
            else:
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
