"""Shared helper for recording WHY a scrape failed.

The refresh scripts (batch / nightly / weekly) write this into
items.last_error so the reason shows up on the site -- the /track page
and the per-BOM debug panel -- instead of only living in GitHub Actions
logs. Mirrors what the single-item callback (api/routes/internal.js)
already did: truncated, since it's a diagnostic string from an external
API response and shouldn't be able to bloat a row.
"""


def error_text(result, default="no result returned"):
    return str((result or {}).get("error") or default)[:500]
