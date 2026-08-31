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

import ipaddress
import json
import re
import random
import socket
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# The API validates the URL a user submits against private/loopback/link-
# local ranges before it's ever stored (see api/lib/urlValidation.js), but
# that check only looks at the URL *as submitted*. Two things can slip past
# it and land here instead, potentially much later (nightly/weekly refresh
# jobs run hours or days after a URL was saved):
#
#   1. DNS rebinding -- a hostname that resolved to a public IP at submit
#      time can be repointed at an internal/loopback address by the time
#      this job actually connects.
#   2. Open redirects -- a validated public URL can 302 straight to an
#      internal address; `requests` with allow_redirects=True follows that
#      without re-checking it against anything.
#
# _SAFE_ variants below close both gaps for the actual outbound request:
# every hostname is resolved and its IP checked before connecting, and
# redirects are followed manually (capped) with the same check re-run on
# each hop, instead of letting `requests` auto-follow them.
_MAX_REDIRECTS = 5


def _is_disallowed_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # can't parse it -> treat as unsafe
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _assert_safe_url(url: str):
    """Resolves the URL's hostname and rejects it if any resolved address
    is private/loopback/link-local/etc. Raises ValueError on rejection."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"disallowed scheme: {parsed.scheme}")
    if not parsed.hostname:
        raise ValueError("URL has no hostname")
    try:
        addrs = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as e:
        raise ValueError(f"DNS resolution failed: {e}")
    for family, _, _, _, sockaddr in addrs:
        ip_str = sockaddr[0]
        if _is_disallowed_ip(ip_str):
            raise ValueError(f"resolved to a disallowed address: {ip_str}")


def _safe_get(url: str, headers: dict, timeout: int):
    """requests.get, but with manual redirect handling so every hop
    (including the initial URL) is re-validated against private/local
    addresses right before connecting."""
    current_url = url
    for _ in range(_MAX_REDIRECTS + 1):
        _assert_safe_url(current_url)
        resp = requests.get(current_url, headers=headers, timeout=timeout, allow_redirects=False)
        if resp.is_redirect or resp.is_permanent_redirect:
            location = resp.headers.get("Location")
            if not location:
                return resp
            current_url = requests.compat.urljoin(current_url, location)
            continue
        return resp
    raise ValueError("too many redirects")

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


def try_generic_scrape(url: str) -> dict:
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    try:
        resp = _safe_get(url, headers=headers, timeout=10)
    except ValueError as e:
        # Blocked by the SSRF guard above (private/local target, bad
        # scheme, DNS failure, or too many redirects).
        return {"found": False, "error": f"link_failed: {e}"}
    except requests.exceptions.RequestException as e:
        return {"found": False, "error": f"link_failed: {e}"}

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
    return try_generic_scrape(url)
