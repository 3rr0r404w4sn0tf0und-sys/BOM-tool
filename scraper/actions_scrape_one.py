"""
Entry point for .github/workflows/scrape-on-demand.yml

Scrapes one URL and POSTs the result back to the BOM Tool API's
internal callback endpoint. Never raises -- any failure is reported
as a normal "not found" result so the workflow always exits cleanly
and the item never gets stuck on "pending" forever.
"""

import os
import sys
import requests
from scrape_logic import get_price


def main():
    item_id = os.environ["ITEM_ID"]
    url = os.environ["URL"]
    callback_url = os.environ["CALLBACK_URL"]
    secret = os.environ["INTERNAL_SCRAPE_SECRET"]

    try:
        result = get_price(url)
    except Exception as e:
        result = {"found": False, "error": f"Unhandled scrape error: {e}"}

    payload = {
        "item_id": item_id,
        "found": result.get("found", False),
        "price": result.get("price"),
        "source": result.get("source"),
        "error": result.get("error"),
    }

    try:
        resp = requests.post(
            callback_url,
            json=payload,
            headers={"X-Internal-Secret": secret},
            timeout=15,
        )
        resp.raise_for_status()
        print(f"Reported result for item {item_id}: {payload}")
    except Exception as e:
        # Log and exit non-zero so the Actions run is visibly marked
        # failed -- but the item just stays "pending" until next nightly
        # refresh or a manual retry, nothing else breaks.
        print(f"Failed to POST callback for item {item_id}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
