"""
Apify Puppeteer Scraper-based price lookup, for sites that block a plain
self-hosted headless Playwright browser at the WAF/fingerprinting level
(confirmed on Mouser and Arrow -- see actions_scrape_one.py for which
domains route here). Runs the actual page-parsing logic *inside* Apify's
infrastructure (their proxies + browser fingerprinting), rather than
from the GitHub Actions runner's IP, which is what gets past the block.

This uses the generic "apify/puppeteer-scraper" Actor (NOT the Amazon-
specific "junglee/amazon-crawler" used in apify_scrape.py -- there's no
equivalent purpose-built Actor for niche B2B distributor sites, so we
send our own page-parsing function instead).

Cost control: this is billed by Apify compute-unit/proxy usage, not a
flat per-item price like the Amazon Actor, so the input below is
deliberately minimal --
  - maxRequestsPerCrawl: 1        -- never crawl beyond the single URL
  - no linkSelector/globs         -- don't follow any links on the page
  - downloadCss/downloadMedia off -- don't fetch images/stylesheets
  - useChrome: false              -- cheaper bundled Chromium is enough
to keep each call as close to the Amazon-scrape cost as possible.

There is no shared/site-wide APIFY_TOKEN secret -- each user brings their
own Apify token (Settings -> Apify API key on the site), passed through
per-request from the API as client_payload.apify_token. If a user hasn't
set one, this reports "Apify not configured" and the caller falls back to
a plain HTTP fetch instead.

You'll need:
1. An Apify account (same one used for the Amazon Actor is fine).
2. APIFY_PUPPETEER_ACTOR_ID set to "apify/puppeteer-scraper" (or its
   Actor ID) as a GitHub Actions secret/variable (shared config, not a
   per-user credential).
"""

import os
import requests

APIFY_TOKEN = os.environ.get("APIFY_TOKEN")
APIFY_PUPPETEER_ACTOR_ID = os.environ.get("APIFY_PUPPETEER_ACTOR_ID", "apify/puppeteer-scraper")

# JS port of scrape_logic._find_pricing_table_price, run inside the
# Apify-hosted browser via pageFunction. Kept as a plain string since
# it's shipped as JSON input to the Actor, not executed locally.
PAGE_FUNCTION = """
async function pageFunction(context) {
    const { page, request, log } = context;

    function cleanPrice(raw) {
        if (!raw) return null;
        const match = raw.replace(/,/g, '').match(/\\d+\\.\\d{2}|\\d+/);
        return match ? parseFloat(match[0]) : null;
    }

    // 1. itemprop="price"
    const itemPropEl = await page.$('[itemprop="price"]');
    if (itemPropEl) {
        const content = await page.evaluate(
            el => el.getAttribute('content') || el.textContent, itemPropEl
        );
        const price = cleanPrice(content);
        if (price) {
            log.info(`Found price via itemprop: ${price}`);
            return { url: request.url, found: true, price, source: 'apify_itemprop' };
        }
    }

    // 2. Pricing table -- specific keywords first (Mouser/Digi-Key style:
    //    "Unit Price" / "Ext. Price" / "Price Break"), then fall back to
    //    a bare "Price" header (Arrow style) only if that finds nothing.
    const specificKeywords = ['unit price', 'ext. price', 'ext price', 'price break'];
    const fallbackKeywords = ['price'];

    function findTablePrice(keywords) {
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
            const headerCells = Array.from(table.querySelectorAll('th'));
            const cellsToCheck = headerCells.length
                ? headerCells
                : Array.from(table.querySelector('tr')?.querySelectorAll('td, th') || []);
            const headerText = cellsToCheck.map(c => c.textContent.trim()).join(' ').toLowerCase();
            if (!keywords.some(k => headerText.includes(k))) continue;

            const cells = Array.from(table.querySelectorAll('td, th'));
            for (const cell of cells) {
                const text = cell.textContent.trim();
                if (text.startsWith('$')) {
                    const match = text.replace(/,/g, '').match(/\\d+\\.\\d{2}|\\d+/);
                    if (match) return parseFloat(match[0]);
                }
            }
        }
        return null;
    }

    let price = await page.evaluate(findTablePrice, specificKeywords);
    let source = 'apify_pricing_table';
    if (!price) {
        price = await page.evaluate(findTablePrice, fallbackKeywords);
        source = 'apify_pricing_table_fallback';
    }

    if (price) {
        log.info(`Found price via table: ${price}`);
        return { url: request.url, found: true, price, source };
    }

    log.info('No price found on page');
    return { url: request.url, found: false };
}
"""


def try_apify_generic_scrape(url: str, apify_token: str = None) -> dict:
    results = try_apify_generic_scrape_batch([url], apify_token=apify_token)
    return results.get(url, {"found": False, "error": "Apify returned no results"})


def try_apify_generic_scrape_batch(urls: list, apify_token: str = None) -> dict:
    """Same page-scraping logic as try_apify_generic_scrape, but crawls
    every URL in ONE Actor run instead of one run per URL. This is the
    thing that made batch refreshes slow -- an Actor run has real
    startup/proxy-negotiation overhead (several seconds) before it even
    loads the first page, and firing that once per item instead of once
    per whole batch was most of the wall-clock time on a big BOM.

    apify_token, if passed, overrides the APIFY_TOKEN env var -- see
    apify_scrape.try_apify_scrape_batch for why.

    Returns {url: {found, price, source}} -- one entry per input url.
    Any url missing from Apify's response (crawl failure on just that
    page) is filled in with a "found: false" entry so callers can loop
    over the original url list without KeyError risk.
    """
    if not urls:
        return {}

    token = apify_token or APIFY_TOKEN
    if not token:
        error = {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}
        return {u: error for u in urls}

    endpoint = (
        f"https://api.apify.com/v2/acts/{APIFY_PUPPETEER_ACTOR_ID.replace('/', '~')}"
        "/run-sync-get-dataset-items"
    )

    run_input = {
        "startUrls": [{"url": u} for u in urls],
        "pageFunction": PAGE_FUNCTION,
        "proxyConfiguration": {"useApifyProxy": True},
        "headless": True,
        "useChrome": False,
        "waitUntil": ["networkidle2"],
        # Cost/scope controls -- exactly one request per input url, no
        # crawling beyond that, no unnecessary asset downloads.
        "maxRequestsPerCrawl": len(urls),
        "downloadCss": False,
        "downloadMedia": False,
        "closeCookieModals": True,
        "ignoreCorsAndCsp": False,
        "ignoreSslErrors": False,
        "keepUrlFragments": False,
        # Robots.txt disallow rules on distributor sites can otherwise
        # block the single product page we actually want -- fine to
        # ignore for a one-off price lookup like this.
        "respectRobotsTxtFile": False,
    }

    # A batch run legitimately takes longer than a single-url run --
    # scale the timeout with the batch size (with headroom), capped so
    # a bad request doesn't hang forever.
    timeout = min(120 + 15 * len(urls), 900)

    try:
        resp = requests.post(endpoint, json=run_input, headers={"Authorization": f"Bearer {token}"}, timeout=timeout)
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        error = {"found": False, "error": f"Apify request failed: {e}"}
        return {u: error for u in urls}

    results = {}
    for item in items:
        item_url = item.get("url")
        if not item_url:
            continue
        if item.get("found"):
            results[item_url] = {
                "found": True,
                "price": item["price"],
                "source": item.get("source", "apify_generic"),
            }
        else:
            print(f"DEBUG: Apify generic scrape found nothing for {item_url}, raw item: {item}")
            results[item_url] = {"found": False, "error": "Apify generic scrape found no price on page"}

    # Fill in anything Apify's dataset didn't return a row for at all
    # (e.g. a request that errored out before pageFunction ever ran).
    for u in urls:
        if u not in results:
            results[u] = {"found": False, "error": "Apify returned no result for this url"}

    return results


if __name__ == "__main__":
    # Quick manual test: APIFY_TOKEN=... python apify_generic_scrape.py "https://..."
    import sys
    import json

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.mouser.com/ProductDetail/175-SF45-B"
    result = try_apify_generic_scrape(test_url)
    print(json.dumps(result, indent=2))
