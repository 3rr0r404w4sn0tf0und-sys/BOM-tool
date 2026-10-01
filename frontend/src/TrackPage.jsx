import React, { useEffect, useState, useCallback } from "react";
import { API_URL, apiFetch } from "./api.js";
import { MethodTable, FailureTable } from "./ScrapeTables.jsx";
import { formatWhen } from "./scrapeTrack.js";

// /track -- scrape status across ALL of the user's BOMs:
//   1. when the last scrape happened
//   2. one table row per scrape method (Amazon / Mouser / Etsy / Generic)
//   3. everything currently failed or stale, with the recorded reason
// Per-BOM detail lives in the debug panel under each BOM.
export default function TrackPage({ theme, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`${API_URL}/api/track`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Could not load scrape status.");
      setData(body);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cardStyle = { background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: theme.shadow, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" };
  const last = formatWhen(data?.last_scrape);

  return (
    <div style={{ minHeight: "100vh", background: theme.pageBg || theme.bg, color: theme.text, fontFamily: "sans-serif", padding: "32px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: theme.muted, cursor: "pointer", padding: 0, marginBottom: 24 }}>← Back</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Scrape tracker</h1>
          <button onClick={load} disabled={loading} style={{ border: `1px solid ${theme.border}`, background: "none", color: theme.subtleText, borderRadius: 8, padding: "7px 12px", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p style={{ margin: "0 0 24px", color: theme.subtleText, fontSize: 14 }}>
          Status of every scraper across your BOMs. “Stale” means the latest refresh failed and the old price is being kept.
          Open a BOM to see the same breakdown for just that BOM.
        </p>

        {error && <p style={{ color: theme.errText, fontSize: 13.5 }}>{error}</p>}
        {!data && loading && <p style={{ color: theme.subtleText, fontSize: 14 }}>Loading…</p>}

        {data && (
          <>
            <div style={cardStyle}>
              <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>Last scrape</h2>
              <p style={{ margin: 0, fontSize: 14, color: theme.subtleText }} title={last.title}>
                {data.last_scrape ? <>{last.text} <span style={{ color: theme.muted }}>({last.title})</span></> : "No scrapes recorded yet."}
              </p>
            </div>

            <div style={cardStyle}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>By scrape method</h2>
              <MethodTable theme={theme} methods={data.methods} />
            </div>

            <div style={cardStyle}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>Failed &amp; stale items</h2>
              <FailureTable theme={theme} failures={data.failures} showBom truncated={data.failures_truncated} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
