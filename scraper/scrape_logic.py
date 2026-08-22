"""
Core price-scraping logic, used by both GitHub Actions workflows
(on-demand single scrape + nightly full refresh).

Each Actions run is its own isolated VM, so no shared-process locking
is needed here (unlike a long-running server handling concurrent
requests) -- one browser per run is naturally the max concurrency.

1. Fast path: plain HTTP GET, parse Open Graph / JSON-LD price data.
   Covers most Shopify/WooCommerce/generic stores (FoxTech, etc.) with
   no browser needed -- tried first for every URL, including Amazon,
   in case a price ever shows up there (it usually won't).
2. Fallback: Playwright headless browser (real Chromium, 7GB RAM
   available on the Actions runner) -- used for JS-rendered pages and
   as the primary method for Amazon.
3. Dead / offline links are detected and reported as "link_failed"
   rather than raising -- callers should never crash on this.
"""

import json
import re
import random
import requests
from bs4 import BeautifulSoup

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
        resp = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
    except requests.exceptions.RequestException as e:
        return {"found": False, "error": f"link_failed: {e}"}

    if resp.status_code in (404, 410):
        return {"found": False, "error": "link_failed: page returned 404/410"}

    try:
        resp.raise_for_status()
    except Exception as e:
        return {"found": False, "error": f"HTTP error: {e}"}

    soup = BeautifulSoup(resp.text, "html.parser")

    og_price = soup.find("meta", property="product:price:amount")
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


def try_playwright_scrape(url: str) -> dict:
    from playwright.sync_api import sync_playwright

    is_amazon = "amazon." in url

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        try:
            response = page.goto(url, timeout=25000, wait_until="domcontentloaded")
            if response and response.status in (404, 410):
                return {"found": False, "error": "link_failed: page returned 404/410"}

            if is_amazon:
                page.wait_for_timeout(random.randint(2000, 5000))
                selectors = [
                    "span.a-price span.a-offscreen",
                    "#priceblock_ourprice",
                    "#priceblock_dealprice",
                ]
                for sel in selectors:
                    el = page.query_selector(sel)
                    if el:
                        price = _clean_price(el.inner_text())
                        if price:
                            return {"found": True, "price": price, "source": f"amazon:{sel}"}

                if page.query_selector("text=Page Not Found"):
                    return {"found": False, "error": "link_failed: Amazon page not found"}

                if page.query_selector("form[action*='validateCaptcha']"):
                    return {"found": False, "error": "Blocked by Amazon CAPTCHA"}

                return {"found": False, "error": "Amazon page loaded but no price selector matched"}

            # Non-Amazon: many distributor sites (Mouser, etc.) populate
            # their pricing table via an async call *after* the initial
            # page load, so a blind fixed-length wait races that fetch.
            # Wait for something that looks like a price to actually
            # exist in the DOM -- either an itemprop tag or a table cell
            # starting with "$" -- falling back to a short flat wait if
            # neither shows up in time (still lets other extraction
            # paths further down get a chance).
            try:
                page.wait_for_function(
                    """() => {
                        if (document.querySelector('[itemprop="price"]')) return true;
                        const cells = document.querySelectorAll('table td, table th');
                        for (const c of cells) {
                            if (c.textContent.trim().startsWith('$')) return true;
                        }
                        return false;
                    }""",
                    timeout=8000,
                )
            except Exception:
                # Nothing showed up in time -- fall back to a short flat
                # wait so slower-but-not-broken pages still get one last
                # chance before extraction runs on whatever loaded.
                page.wait_for_timeout(random.randint(1000, 2000))

            html = page.content()
            soup = BeautifulSoup(html, "html.parser")
            price_tag = soup.find(attrs={"itemprop": "price"})
            if price_tag:
                price = _clean_price(price_tag.get("content") or price_tag.text)
                if price:
                    return {"found": True, "price": price, "source": "playwright_itemprop"}

            table_price = _find_pricing_table_price(soup)
            if table_price:
                return {"found": True, "price": table_price, "source": "playwright_pricing_table"}

            return {"found": False, "error": "No price found even after JS render"}
        except Exception as e:
            return {"found": False, "error": f"Playwright error: {e}"}
        finally:
            browser.close()


def get_price(url: str) -> dict:
    result = try_generic_scrape(url)
    if result["found"]:
        return result
    return try_playwright_scrape(url)
