"""
Last-resort fallback for generic stores (Shopify etc.) that 403 the plain
HTTP fetch because they block GitHub Actions' datacenter IPs.

Runs apify/cheerio-scraper (plain HTTP + HTML parsing, NO browser) through
Apify's default datacenter proxy -- by far the cheapest Apify option, and
only called after the free plain fetch has already returned 403/429.
Uses the per-user APIFY_TOKEN already set by fetch_apify_credential.
"""

import os
import requests

ACTOR_ID = os.environ.get("APIFY_CHEERIO_ACTOR_ID", "apify/cheerio-scraper")

PAGE_FUNCTION = r"""
async function pageFunction(context) {
    const { $, request } = context;
    const clean = (raw) => {
        if (raw === undefined || raw === null) return null;
        const m = String(raw).replace(/,/g, '').match(/\d+\.\d{2}|\d+/);
        return m ? parseFloat(m[0]) : null;
    };
    let p = clean($('meta[property="product:price:amount"]').attr('content')
               || $('meta[property="og:price:amount"]').attr('content'));
    if (p) return { url: request.url, found: true, price: p, source: 'apify_og_meta' };

    let found = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        if (found) return;
        try {
            const data = JSON.parse($(el).html());
            const list = Array.isArray(data) ? data : [data];
            for (const it of list) {
                const nodes = it && it['@graph'] ? it['@graph'] : [it];
                for (const n of nodes) {
                    let offers = n && n.offers;
                    if (!offers) continue;
                    offers = Array.isArray(offers) ? offers : [offers];
                    for (const o of offers) {
                        const v = clean(o.price || (o.priceSpecification && o.priceSpecification.price));
                        if (v) { found = v; return; }
                    }
                }
            }
        } catch (e) {}
    });
    if (found) return { url: request.url, found: true, price: found, source: 'apify_json_ld' };

    const ip = $('[itemprop="price"]').first();
    p = clean(ip.attr('content') || ip.text());
    if (p) return { url: request.url, found: true, price: p, source: 'apify_itemprop' };
    return { url: request.url, found: false };
}
"""


def try_apify_cheerio_scrape(url: str) -> dict:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return {"found": False, "error": "Apify not configured (missing APIFY_TOKEN)"}

    endpoint = (
        f"https://api.apify.com/v2/acts/{ACTOR_ID.replace('/', '~')}"
        "/run-sync-get-dataset-items"
    )
    run_input = {
        "startUrls": [{"url": url}],
        "pageFunction": PAGE_FUNCTION,
        "proxyConfiguration": {"useApifyProxy": True},
        "maxRequestsPerCrawl": 1,
        "maxRequestRetries": 2,
        "respectRobotsTxtFile": False,
        "ignoreSslErrors": False,
    }
    try:
        resp = requests.post(endpoint, json=run_input,
                             headers={"Authorization": f"Bearer {token}"}, timeout=120)
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        return {"found": False, "error": f"Apify request failed: {e}"}

    for item in items or []:
        if item.get("found") and item.get("price"):
            return {"found": True, "price": item["price"], "source": item.get("source", "apify_cheerio")}
    return {"found": False, "error": "Apify cheerio scrape found no price on page"}
