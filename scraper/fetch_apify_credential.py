"""
Fetches the Apify token for the current scrape job from the BOM Tool
API, instead of it being placed directly in the GitHub
repository_dispatch client_payload (which is visible in GitHub's event
metadata, Actions logs, and repository administration).

Must be called -- and its result exported to os.environ["APIFY_TOKEN"]
-- BEFORE apify_scrape.py / apify_generic_scrape.py / apify_mouser_scrape.py
are imported, since those modules read os.environ.get("APIFY_TOKEN") once
at import time, not per-call.
"""

import os
import requests


def fetch_apify_token(job_id: str) -> str | None:
    api_base = os.environ.get("API_PUBLIC_URL", "").rstrip("/")
    secret = os.environ.get("INTERNAL_SCRAPE_SECRET", "")
    if not api_base or not secret:
        print("API_PUBLIC_URL or INTERNAL_SCRAPE_SECRET not set -- skipping Apify credential fetch")
        return None

    try:
        resp = requests.get(
            f"{api_base}/api/internal/apify-credential",
            params={"job_id": job_id},
            headers={"X-Internal-Secret": secret},
            timeout=10,
        )
        if resp.status_code == 404:
            return None  # job not found/already completed -- not an error
        resp.raise_for_status()
        token = resp.json().get("apify_token")
        # Never let the token show up in a workflow's step output/logs.
        if token:
            print("::add-mask::" + token)
        return token
    except Exception as e:
        print(f"Failed to fetch Apify credential: {e}")
        return None
