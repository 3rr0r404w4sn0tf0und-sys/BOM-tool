import React, { useMemo, useState } from "react";
import { MethodTable, FailureTable } from "./ScrapeTables.jsx";
import { summarizeItems, formatWhen } from "./scrapeTrack.js";

// Collapsible debug section under each BOM. Computed client-side from the
// already-loaded (and already-polled) BOM, so it stays live with no extra
// request. Replaces digging through GitHub Actions logs for "why did this
// item fail".
export default function BomDebugPanel({ theme, sections }) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    const items = [];
    for (const s of sections || []) for (const i of s.items || []) items.push(i);
    return summarizeItems(items);
  }, [sections]);

  const problems = summary.failures.length;
  const scraped = summary.methods.reduce((n, m) => n + m.total, 0);
  const last = formatWhen(summary.last_scrape);
  if (scraped === 0) return null; // nothing with a URL, nothing to debug

  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, marginTop: 16, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", border: "none", background: "none", color: theme.text, cursor: "pointer", font: "inherit", fontSize: 14, textAlign: "left" }}
      >
        <span style={{ fontWeight: 600 }}>{open ? "▾" : "▸"} Scrape debug</span>
        <span style={{ fontSize: 12.5, color: problems ? theme.warnText : theme.muted }} title={last.title}>
          {problems ? `${problems} failed/stale · ` : "All good · "}last scrape {last.text.toLowerCase()}
        </span>
      </button>
      {open && (
        <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
          <MethodTable theme={theme} methods={summary.methods} />
          <div>
            <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Failed &amp; stale items</h3>
            <FailureTable theme={theme} failures={summary.failures} />
          </div>
        </div>
      )}
    </div>
  );
}
