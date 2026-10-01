import React from "react";
import { METHOD_LABELS, formatWhen, reasonFor } from "./scrapeTrack.js";

// Shared by the /track page and the per-BOM debug panel so both render
// identically. Pure presentational: data comes in already summarized
// (see scrapeTrack.js / GET /api/track).

const th = (theme) => ({ textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 600, color: theme.muted, borderBottom: `1px solid ${theme.border}`, whiteSpace: "nowrap" });
const td = (theme) => ({ padding: "9px 10px", fontSize: 13, color: theme.text, borderBottom: `1px solid ${theme.rowBorder}`, verticalAlign: "top" });

function Count({ theme, n, color }) {
  return <span style={{ color: n > 0 && color ? color : theme.muted, fontWeight: n > 0 && color ? 600 : 400 }}>{n}</span>;
}

export function MethodTable({ theme, methods }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={th(theme)}>Scrape method</th>
            <th style={th(theme)}>Last scrape</th>
            <th style={th(theme)}>Last success</th>
            <th style={th(theme)}>Items</th>
            <th style={th(theme)}>OK</th>
            <th style={th(theme)}>Stale</th>
            <th style={th(theme)}>Failed</th>
            <th style={th(theme)}>Pending</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => {
            const last = formatWhen(m.last_scrape);
            const ok = formatWhen(m.last_success);
            return (
              <tr key={m.method} style={{ opacity: m.total === 0 ? 0.55 : 1 }}>
                <td style={{ ...td(theme), fontWeight: 600 }}>{METHOD_LABELS[m.method] || m.method}</td>
                <td style={td(theme)} title={last.title}>{last.text}</td>
                <td style={td(theme)} title={ok.title}>{ok.text}</td>
                <td style={td(theme)}>{m.total}</td>
                <td style={td(theme)}><Count theme={theme} n={m.ok} color={theme.okText} /></td>
                <td style={td(theme)}><Count theme={theme} n={m.stale} color={theme.warnText} /></td>
                <td style={td(theme)}><Count theme={theme} n={m.failed} color={theme.errText} /></td>
                <td style={td(theme)}><Count theme={theme} n={m.pending} color={theme.accent} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StateBadge({ theme, state }) {
  const stale = state === "stale";
  return (
    <span style={{
      display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      background: stale ? theme.warnBg : theme.errBg, color: stale ? theme.warnText : theme.errText,
    }}>
      {stale ? "Stale" : "Failed"}
    </span>
  );
}

// failures: [{ id, name, url, state, method, last_error, last_checked, bom_title? }]
export function FailureTable({ theme, failures, showBom = false, truncated = false }) {
  if (!failures.length) {
    return <p style={{ margin: 0, fontSize: 13.5, color: theme.okText }}>Nothing failed or stale. 🎉</p>;
  }
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={th(theme)}>State</th>
              <th style={th(theme)}>Method</th>
              {showBom && <th style={th(theme)}>BOM</th>}
              <th style={th(theme)}>Item</th>
              <th style={th(theme)}>Reason</th>
              <th style={th(theme)}>Last tried</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((f) => {
              const when = formatWhen(f.last_checked);
              return (
                <tr key={f.id}>
                  <td style={td(theme)}><StateBadge theme={theme} state={f.state} /></td>
                  <td style={td(theme)}>{METHOD_LABELS[f.method] || f.method}</td>
                  {showBom && <td style={td(theme)}>{f.bom_title}</td>}
                  <td style={{ ...td(theme), maxWidth: 240 }}>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{f.name}</div>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: theme.linkColor, fontSize: 12, overflowWrap: "anywhere" }}>{f.url}</a>
                  </td>
                  <td style={{ ...td(theme), color: theme.subtleText, overflowWrap: "anywhere" }}>{reasonFor(f)}</td>
                  <td style={{ ...td(theme), whiteSpace: "nowrap" }} title={when.title}>{when.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated && <p style={{ margin: "10px 0 0", fontSize: 12, color: theme.muted }}>Showing the most recent {failures.length}; fix some and the rest will show up.</p>}
    </>
  );
}
