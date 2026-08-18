"""
Entry point for .github/workflows/scrape-on-demand.yml

Scrapes one URL and POSTs the result back to the Cloudflare Worker's
callback endpoint. Never raises -- any failure is reported as a normal
"not found" result so the workflow always exits cleanly and the job
never gets stuck "pending" forever on the frontend.
"""

import os
import sys
import requests
from scrape_logic import get_price
from apify_scrape import try_apify_scrape


def main():
    job_id = os.environ["JOB_ID"]
    url = os.environ["URL"]
    callback_url = os.environ["CALLBACK_URL"]
    secret = os.environ["INTERNAL_SCRAPE_SECRET"]

    try:
        if "amazon." in url:
            # Amazon: try Apify first (handles anti-bot), fall back to
            # direct Playwright (free, may hit a CAPTCHA -- that's fine,
            # it just reports not-found and the user can retry the link).
            result = try_apify_scrape(url)
            if not result.get("found"):
                print(f"Apify failed ({result.get('error')}), trying Playwright directly")
                result = get_price(url)
        else:
            result = get_price(url)
    except Exception as e:
        result = {"found": False, "error": f"Unhandled scrape error: {e}"}

    payload = {
        "job_id": job_id,
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
        print(f"Reported result for job {job_id}: {payload}")
    except Exception as e:
        print(f"Failed to POST callback for job {job_id}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
