"""
Shared per-user, per-source scrape interval logic.

Previously each actions_refresh_*.py had a hardcoded
SKIP_IF_CHECKED_WITHIN_DAYS constant (3 days for all of them) baked
into its WHERE clause. That's now user-configurable from Settings
(migration 018_scrape_schedule.sql, user_scrape_settings table), from
30 minutes up to ~6 months per source. This module is just the one bit
of SQL every refresh script needs to honor that.

IMPORTANT: DEFAULT_INTERVAL_MINUTES here must match
DEFAULT_SCRAPE_INTERVALS in api/routes/auth.js -- both are "what a user
gets before they've ever touched Settings", and they'll drift out of
sync silently if only one side is ever updated.
"""

# Matches each source's old hardcoded cadence, so nobody's refresh
# cadence silently changes just because this feature shipped.
DEFAULT_INTERVAL_MINUTES = {
    "generic": 1440,    # was the nightly job
    "amazon": 20160,    # was "biweekly" (1st/15th of month, ~14 days)
    "mouser": 10080,    # was weekly
    "etsy": 10080,       # was weekly
}


def due_join_and_filter(source: str, boms_alias: str = "boms") -> tuple:
    """Returns (join_sql, where_sql) for filtering items down to ones
    whose owner's configured interval for `source` has actually
    elapsed, based on items.last_checked.

    Usage in a query already joining items -> sections -> boms:
        join_sql, where_sql = due_join_and_filter("mouser")
        cur.execute(f'''SELECT items.id, items.url, boms.user_id FROM items
            JOIN sections ON items.section_id = sections.id
            JOIN boms ON sections.bom_id = boms.id
            {join_sql}
            WHERE items.url ILIKE '%mouser.%' AND {where_sql}''')

    A NULL last_checked (never scraped) always counts as due,
    regardless of interval -- same as the old behavior.
    """
    if source not in DEFAULT_INTERVAL_MINUTES:
        raise ValueError(f"Unknown scrape source: {source!r}")
    default_minutes = DEFAULT_INTERVAL_MINUTES[source]
    join_sql = (
        f"LEFT JOIN user_scrape_settings uss ON uss.user_id = {boms_alias}.user_id "
        f"AND uss.source = '{source}'"
    )
    where_sql = (
        "(items.last_checked IS NULL OR items.last_checked < "
        f"now() - (COALESCE(uss.interval_minutes, {default_minutes}) * interval '1 minute'))"
    )
    return join_sql, where_sql
