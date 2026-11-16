"""
Core price-scraping logic, used by both GitHub Actions workflows
(on-demand single scrape + nightly full refresh).

Plain HTTP GET, parse Open Graph / JSON-LD / itemprop / pricing-table
price data. Covers most Shopify/WooCommerce/generic stores (FoxTech,
etc.) with no browser needed. Sites that need real JS rendering
(Amazon, Mouser, Arrow) are routed to their dedicated Apify actors
upstream of this file instead -- there's no local-browser fallback
here anymore (no Playwright/Puppeteer), since maintaining a local
headless-browser fallback duplicated what the Apify actors already do
more reliably, and slowed every batch run down.

Dead / offline links are detected and reported as "link_failed" rather
than raising -- callers should never crash on this.
"""

import json
import re
import random
import requests
from bs4 import BeautifulSoup

from ssrf_safe_request import safe_get, SSRFBlocked

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
]

PRICE_RE = re.compile(r"[\d,]+\.\d{2}|[\d,]+")

# Distributor sites (Mouser, Digi-Key, etc.) commonly render a plain price
# break table -- "Qty. | Unit Price | Ext. Price" -- with no itemprop,
# JSON-LD, or Open Graph price tag anywhere on the page. Scoped to tables
# that actually look like a pricing table so it doesn't grab a stray "$"
# from somewhere unrelated (e.g. a tariff disclaimer sentence).
PRICING_TABLE_KEYWORDS = ("unit price", "ext. price", "ext price", "price break")

# Some distributors (Arrow, e.g.) use a pricing table with a bare "Price"
# header instead of "Unit Price"/"Ext. Price"/"Price Break". Bare "price"
# is a much broader match (could snag an unrelated "price history" or
# disclaimer table), so it's only tried as a fallback -- after the more
# specific keywords above have already failed to match anything.
PRICING_TABLE_FALLBACK_KEYWORDS = ("price",)


def _table_has_price_headers(table, keywords):
    """Only match against header cells (th) or the first row, not the
    whole table body -- avoids false positives from a stray '$' or the
    word 'price' showing up deep in an unrelated data row."""
    header_cells = table.find_all("th")
    if not header_cells:
        first_row = table.find("tr")
        header_cells = first_row.find_all(["td", "th"]) if first_row else []
    header_text = " ".join(c.get_text(" ", strip=True) for c in header_cells).lower()
    return any(k in header_text for k in keywords)


def _find_pricing_table_price(soup):
    tables = soup.find_all("table")

    # Pass 1: specific keywords (Mouser/Digi-Key style)
    for table in tables:
        if not _table_has_price_headers(table, PRICING_TABLE_KEYWORDS):
            continue
        for cell in table.find_all(["td", "th"]):
            text = cell.get_text(strip=True)
            if text.startswith("$"):
                price = _clean_price(text)
                if price:
                    return price

    # Pass 2: fallback to bare "Price" header (Arrow style), only if
    # pass 1 found nothing at all.
    for table in tables:
        if not _table_has_price_headers(table, PRICING_TABLE_FALLBACK_KEYWORDS):
            continue
        for cell in table.find_all(["td", "th"]):
            text = cell.get_text(strip=True)
            if text.startswith("$"):
                price = _clean_price(text)
                if price:
                    return price

    return None


def _clean_price(raw):
    if raw is None:
        return None
    match = PRICE_RE.search(str(raw).replace(",", ""))
    return float(match.group()) if match else None


def _browser_headers(ua: str) -> dict:
    # A bare User-Agent is a classic bot fingerprint; Cloudflare-style WAFs
    # 403 it (especially from GitHub Actions' datacenter IPs). Send the
    # full set of headers a real browser would.
    return {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    }


def _try_shopify_js(url: str):
    """Shopify exposes /products/<handle>.js (JSON) which is often not
    behind the same bot rules as the HTML page. Returns a result dict or
    None if it doesn't work for this URL."""
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(url)
    if "/products/" not in parsed.path:
        return None
    js_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}.js"
    try:
        resp = safe_get(js_url, headers={**_browser_headers(USER_AGENTS[0]), "Accept": "application/json"}, timeout=10)
        if resp.status_code != 200:
            return None
        data = resp.json()
    except Exception:
        return None
    qs = parse_qs(parsed.query)
    wanted = (qs.get("variant") or qs.get("VariantsId") or [None])[0]
    variants = data.get("variants") or []
    chosen = next((v for v in variants if str(v.get("id")) == str(wanted)), None) if wanted else None
    chosen = chosen or (variants[0] if variants else None)
    price_cents = (chosen or {}).get("price") or data.get("price")
    if isinstance(price_cents, (int, float)) and price_cents > 0:
        return {"found": True, "price": round(price_cents / 100, 2), "source": "shopify_js"}
    return None


def try_generic_scrape(url: str) -> dict:
    # Shopify-style /products/ URLs: try the JSON endpoint first. It is
    # free, faster than parsing HTML, and often not behind the bot rules
    # that 403 the HTML page. Silently falls through for non-Shopify sites.
    shopify = _try_shopify_js(url)
    if shopify:
        return shopify

    resp = None
    try:
        for ua in random.sample(USER_AGENTS, len(USER_AGENTS)):
            resp = safe_get(url, headers=_browser_headers(ua), timeout=10)
            if resp.status_code not in (403, 429):
                break
    except SSRFBlocked as e:
        # Treat like any other unreachable link rather than raising --
        # callers already expect try_generic_scrape() to never crash,
        # and a private-address target should surface as a normal
        # "link failed" rather than a stack trace.
        return {"found": False, "error": f"link_failed: blocked ({e})"}
    except requests.exceptions.RequestException as e:
        return {"found": False, "error": f"link_failed: {e}"}

    if resp.status_code in (403, 429):
        alt = _try_shopify_js(url)
        if alt:
            return alt

    if resp.status_code in (404, 410):
        return {"found": False, "error": "link_failed: page returned 404/410"}

    try:
        resp.raise_for_status()
    except Exception as e:
        return {"found": False, "error": f"HTTP error: {e}"}

    soup = BeautifulSoup(resp.text, "html.parser")

    # Shopify (and some other platforms) emit the standard Open Graph
    # "og:price:amount" tag; the older Facebook-specific namespace
    # "product:price:amount" also shows up on some sites. Check both --
    # missing "og:price:amount" was silently sending every Shopify page
    # (which don't set the product: namespace) straight past this fast
    # path and into JSON-LD/itemprop/table extraction, which often don't
    # match either, ending in a false "price_not_found".
    og_price = soup.find("meta", property="product:price:amount") or soup.find(
        "meta", property="og:price:amount"
    )
    if og_price and og_price.get("content"):
        price = _clean_price(og_price["content"])
        if price:
            return {"found": True, "price": price, "source": "og_meta"}

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
        except Exception:
            continue
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            offers = item.get("offers") if isinstance(item, dict) else None
            offer_list = offers if isinstance(offers, list) else [offers] if offers else []
            for offer in offer_list:
                if isinstance(offer, dict):
                    price = _clean_price(offer.get("price"))
                    if price:
                        return {"found": True, "price": price, "source": "json_ld"}

    price_tag = soup.find(attrs={"itemprop": "price"})
    if price_tag:
        price = _clean_price(price_tag.get("content") or price_tag.text)
        if price:
            return {"found": True, "price": price, "source": "itemprop"}

    table_price = _find_pricing_table_price(soup)
    if table_price:
        return {"found": True, "price": table_price, "source": "pricing_table"}

    return {"found": False, "error": "No price found via generic scrape"}


def get_price(url: str) -> dict:
    result = try_generic_scrape(url)
    # Plain fetch blocked (GitHub Actions' datacenter IP) -> retry through
    # Apify. Only fires on 403/429, so normal items stay free.
    err = str(result.get("error") or "")
    if not result.get("found") and ("403" in err or "429" in err):
        notes = []
        # Shopify Actor for /products/ URLs: reads the store's own
        # catalogue feed from Apify's network.
        if "/products/" in url:
            try:
                from apify_shopify_scrape import try_apify_shopify_scrape
                fb = try_apify_shopify_scrape(url)
                if fb.get("found"):
                    return fb
                notes.append(f"shopify actor: {fb.get('error')}")
            except Exception as e:
                notes.append(f"shopify actor crashed: {e}")
        result = {"found": False, "error": f"{err} | " + " | ".join(notes)}
    return result
