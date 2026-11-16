"""
Shopify fallback via the Apify "trovevault/shopify-products-scraper" Actor.

Runs from Apify's infrastructure instead of the GitHub Actions runner's IP,
which is what Shopify's CDN 403s. Only called from scrape_logic.get_price()
after the free plain fetch (and the free Shopify .js attempt) were blocked.

NOTE ON COST: this Actor takes a store DOMAIN and returns that store's whole
catalogue (billed ~$0.001 per product returned), not a single product. We
fetch the catalogue for the one domain and pick our product out by handle.
Fine for small stores; for a big store set SHOPIFY_MAX_PRODUCTS to cap it
(a product beyond the cap will simply not be found).

Env vars (all optional):
  APIFY_SHOPIFY_ACTOR_ID   default "trovevault/shopify-products-scraper"
  APIFY_SHOPIFY_PROXY      "none" (default) | "datacenter" | "residential"
  SHOPIFY_MAX_PRODUCTS     default 0 (= whole catalogue)
"""

import os
from urllib.parse import urlparse, parse_qs

import requests

ACTOR_ID = os.environ.get("APIFY_SHOPIFY_ACTOR_ID", "trovevault/shopify-products-scraper")


def _proxy_config():
    mode = os.environ.get("APIFY_SHOPIFY_PROXY", "none").lower()
    if mode == "residential":
        return {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]}
    if mode == "datacenter":
        return {"useApifyProxy": True}
    return {"useApifyProxy": False}


def _to_price(v):
    try:
        v = float(v)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def try_apify_shopify_scrape(url: str) -> dict:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}

    parsed = urlparse(url)
    if "/products/" not in parsed.path or not parsed.hostname:
        return {"found": False, "error": "not a Shopify-style /products/ url"}

    handle = parsed.path.split("/products/", 1)[1].strip("/").split("/")[0].lower()
    qs = parse_qs(parsed.query)
    wanted_variant = (qs.get("variant") or qs.get("VariantsId") or [None])[0]

    endpoint = (
        f"https://api.apify.com/v2/acts/{ACTOR_ID.replace('/', '~')}"
        "/run-sync-get-dataset-items"
    )
    run_input = {
        "domains": [f"{parsed.scheme}://{parsed.hostname}"],
        "maxProducts": int(os.environ.get("SHOPIFY_MAX_PRODUCTS", "0")),
        "includeInventoryDetails": False,
        "proxyConfiguration": _proxy_config(),
    }

    try:
        resp = requests.post(endpoint, json=run_input,
                             headers={"Authorization": f"Bearer {token}"}, timeout=300)
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        return {"found": False, "error": f"Apify Shopify request failed: {e}"}

    product = None
    for it in items or []:
        item_handle = str(it.get("handle") or "").lower()
        item_url = str(it.get("url") or "").lower()
        if item_handle == handle or item_url.rstrip("/").endswith("/products/" + handle):
            product = it
            break
    if not product:
        return {"found": False, "error": f"Apify Shopify: product '{handle}' not in catalogue ({len(items or [])} products returned)"}

    price = None
    if wanted_variant:
        for v in product.get("variants") or []:
            if str(v.get("variantId")) == str(wanted_variant):
                price = _to_price(v.get("price"))
                break
    if price is None:
        price = _to_price(product.get("priceMin"))
    if price is None:
        for v in product.get("variants") or []:
            price = _to_price(v.get("price"))
            if price:
                break

    if price:
        return {"found": True, "price": price, "source": "apify_shopify"}
    return {"found": False, "error": "Apify Shopify: product found but no price"}
