"""
Entry point for .github/workflows/scrape-captcha.yml

Unlike the normal on-demand scrape, this script keeps a single browser
session alive and, if it hits an Amazon CAPTCHA, pauses to let a human
(you, on the BOM page) solve it remotely:

1. Load the page.
2. If Amazon serves a CAPTCHA, screenshot it and POST the image to the
   API (item flips to captcha_status = 'needs_solution').
3. Poll the API every 5s, up to POLL_TIMEOUT_SECONDS, waiting for a
   solved answer to show up.
4. If solved: type it into the CAPTCHA field, submit, then continue
   scraping the actual price from the resulting page.
5. If nobody solves it in time: give up, tell the API to fall back to
   the stale/last-known price flag, same as any other Amazon failure.

This never touches an automated CAPTCHA solver -- the answer always
comes from a human typing it into the BOM page themselves.
"""

import os
import sys
import time
import base64
import requests
from playwright.sync_api import sync_playwright

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 600  # 10 minutes to go solve it


def post_screenshot(api_base, secret, item_id, screenshot_bytes):
    b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
    resp = requests.post(
        f"{api_base}/api/internal/captcha-screenshot",
        json={"item_id": item_id, "screenshot_base64": b64},
        headers={"X-Internal-Secret": secret},
        timeout=15,
    )
    resp.raise_for_status()


def poll_for_solution(api_base, secret, item_id):
    waited = 0
    while waited < POLL_TIMEOUT_SECONDS:
        resp = requests.get(
            f"{api_base}/api/internal/captcha-solution/{item_id}",
            headers={"X-Internal-Secret": secret},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("solved"):
                return data["solution"]
        time.sleep(POLL_INTERVAL_SECONDS)
        waited += POLL_INTERVAL_SECONDS
    return None


def report_timeout(api_base, secret, item_id):
    requests.post(
        f"{api_base}/api/internal/captcha-timeout",
        json={"item_id": item_id},
        headers={"X-Internal-Secret": secret},
        timeout=15,
    )


def report_result(api_base, secret, item_id, found, price=None, source=None, error=None):
    requests.post(
        f"{api_base}/api/internal/scrape-result",
        json={"item_id": item_id, "found": found, "price": price, "source": source, "error": error},
        headers={"X-Internal-Secret": secret},
        timeout=15,
    )


def _clean_price(text):
    import re
    match = re.search(r"[\d,]+\.\d{2}|[\d,]+", text.replace(",", ""))
    return float(match.group()) if match else None


def main():
    item_id = os.environ["ITEM_ID"]
    url = os.environ["URL"]
    api_base = os.environ["API_BASE_URL"]
    secret = os.environ["INTERNAL_SCRAPE_SECRET"]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        try:
            page.goto(url, timeout=25000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)

            captcha_form = page.query_selector("form[action*='validateCaptcha']")

            if captcha_form:
                print(f"CAPTCHA detected for item {item_id}, taking screenshot")
                screenshot_bytes = page.screenshot()
                post_screenshot(api_base, secret, item_id, screenshot_bytes)

                print("Waiting for a human to solve it via the BOM page...")
                solution = poll_for_solution(api_base, secret, item_id)

                if not solution:
                    print("Timed out waiting for CAPTCHA solution")
                    report_timeout(api_base, secret, item_id)
                    return

                print("Got a solution, submitting it")
                input_field = page.query_selector("#captchacharacters")
                if not input_field:
                    report_result(api_base, secret, item_id, False,
                                   error="CAPTCHA input field not found on page")
                    return

                input_field.fill(solution)
                submit_button = page.query_selector("button[type='submit']")
                if submit_button:
                    submit_button.click()
                else:
                    page.keyboard.press("Enter")

                page.wait_for_timeout(3000)

            # Whether or not there was a CAPTCHA, try to read the price now
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
                        report_result(api_base, secret, item_id, True, price=price, source=f"amazon_captcha:{sel}")
                        print(f"Success: found price {price}")
                        return

            report_result(api_base, secret, item_id, False,
                           error="Page loaded but no price selector matched, even after CAPTCHA")
            print("No price found even after solving CAPTCHA")

        except Exception as e:
            print(f"Unhandled error: {e}", file=sys.stderr)
            report_result(api_base, secret, item_id, False, error=f"Unhandled error: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
