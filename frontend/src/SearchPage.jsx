import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { API_URL, apiFetch } from "./api.js";
import { formatMoney } from "./totals.js";
import { IconSearch } from "./Icons.jsx";

// /search -- find items across every BOM or sheet the user owns or has been
// shared on. Two distinct searches (tabs): BOM line items, and Sheet rows.
// Leave the box empty to browse everything. Rows are grouped under their
// document; clicking a row (or the document header) opens that document.
// Backed by GET /api/search (read-only, no migration).

const TABS = [
  { key: "bom", label: "BOMs", placeholder: "Search BOM items, links, sections…", empty: "No BOM items found." },
  { key: "sheet", label: "Sheets", placeholder: "Search sheet rows and cells…", empty: "No sheet rows found." },
];
const PAGE_SIZE = 100;
const DEBOUNCE_MS = 250;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, query, theme }) {
  const str = text == null ? "" : String(text);
  if (!query) return <>{str}</>;
  const parts = str.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: theme.name === "dark" ? "rgba(250,204,21,0.28)" : "#fef08a", color: "inherit", borderRadius: 3, padding: "0 1px" }}>{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </>
  );
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function groupByDoc(rows) {
  const groups = [];
  const index = new Map();
  for (const row of rows) {
    let g = index.get(row.bom_id);
    if (!g) {
      g = { id: row.bom_id, title: row.bom_title, role: row.role, labels: row.column_labels, columnCount: row.column_count, rows: [] };
      index.set(row.bom_id, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}

export default function SearchPage({ theme, onBack, onOpenDoc }) {
  const [tab, setTab] = useState("bom");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);
  const inputRef = useRef(null);

  // Debounce typing into the actual query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => { inputRef.current?.focus(); }, [tab]);

  const fetchPage = useCallback(async (offset) => {
    const id = ++requestRef.current;
    const params = new URLSearchParams({ type: tab, q: query, limit: String(PAGE_SIZE), offset: String(offset) });
    try {
      const r = await apiFetch(`${API_URL}/api/search?${params}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Search failed.");
      if (id !== requestRef.current) return; // a newer request superseded this one
      setRows((prev) => (offset === 0 ? body.results : [...prev, ...body.results]));
      setTotal(body.total);
      setHasMore(body.has_more);
      setError(null);
    } catch (e) {
      if (id !== requestRef.current) return;
      setError(e.message);
    } finally {
      if (id === requestRef.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [tab, query]);

  useEffect(() => {
    setLoading(true);
    fetchPage(0);
  }, [fetchPage]);

  const groups = useMemo(() => groupByDoc(rows), [rows]);
  const tabInfo = TABS.find((t) => t.key === tab);
  const cardStyle = { background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: "16px 18px", marginBottom: 14, boxShadow: theme.shadow, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" };
  const cell = { padding: "8px 10px", fontSize: 13, color: theme.text, borderBottom: `1px solid ${theme.rowBorder}`, verticalAlign: "top" };
  const head = { ...cell, fontSize: 12, fontWeight: 600, color: theme.muted, textAlign: "left", whiteSpace: "nowrap" };

  function switchTab(key) {
    if (key === tab) return;
    setTab(key);
    setRows([]);
    setTotal(0);
    setHasMore(false);
    setLoading(true);
  }

  function renderBomTable(g) {
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead>
          <tr>
            <th style={head}>Item</th>
            <th style={head}>Section</th>
            <th style={head}>Qty</th>
            <th style={head}>Price</th>
            <th style={head}>Link</th>
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.id} onClick={() => onOpenDoc(g.id)} style={{ cursor: "pointer" }}>
              <td style={{ ...cell, fontWeight: 600 }}><Highlight text={r.name} query={query} theme={theme} /></td>
              <td style={{ ...cell, color: theme.subtleText }}>{r.section_emoji ? `${r.section_emoji} ` : ""}<Highlight text={r.section_title} query={query} theme={theme} /></td>
              <td style={cell}>{Number(r.qty)}</td>
              <td style={{ ...cell, color: r.status === "ok" && r.unit_price != null ? theme.text : theme.muted }}>
                {r.unit_price != null ? `$${formatMoney(r.unit_price)}` : "—"}
                {r.stale_price && <span title="Latest refresh failed; old price kept" style={{ color: theme.warnText, marginLeft: 4 }}>•</span>}
              </td>
              <td style={{ ...cell, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: theme.linkColor }} title={r.url}>
                    <Highlight text={hostOf(r.url)} query={query} theme={theme} />
                  </a>
                ) : <span style={{ color: theme.muted }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderSheetTable(g) {
    const n = g.columnCount || 3;
    const labels = Array.from({ length: n }, (_, i) => g.labels?.[i] || `Column ${i + 1}`);
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: Math.max(520, n * 120) }}>
        <thead>
          <tr>
            <th style={head}>Section</th>
            {labels.map((l, i) => <th key={i} style={head}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => {
            const data = Array.isArray(r.sheet_data) ? r.sheet_data : [];
            return (
              <tr key={r.id} onClick={() => onOpenDoc(g.id)} style={{ cursor: "pointer", opacity: r.checked === false ? 0.6 : 1 }}>
                <td style={{ ...cell, color: theme.subtleText }}>{r.section_emoji ? `${r.section_emoji} ` : ""}<Highlight text={r.section_title} query={query} theme={theme} /></td>
                {labels.map((_, i) => (
                  <td key={i} style={{ ...cell, textDecoration: r.checked === false ? "line-through" : "none" }}>
                    <Highlight text={data[i] ?? ""} query={query} theme={theme} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.pageBg || theme.bg, color: theme.text, fontFamily: "sans-serif", padding: "32px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: theme.muted, cursor: "pointer", padding: 0, marginBottom: 24 }}>← Back</button>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Search</h1>
        <p style={{ margin: "0 0 20px", color: theme.subtleText, fontSize: 14 }}>
          Search every BOM or sheet you own or that’s been shared with you. Leave the box empty to browse everything.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => switchTab(t.key)}
              style={{
                border: `1px solid ${tab === t.key ? theme.linkColor : theme.border}`,
                background: tab === t.key ? theme.cardBg : "none",
                color: tab === t.key ? theme.text : theme.subtleText,
                fontWeight: tab === t.key ? 600 : 400,
                borderRadius: 999, padding: "7px 18px", cursor: "pointer", fontSize: 14,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: 18 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", pointerEvents: "none" }}>
            <IconSearch size={17} color={theme.muted} />
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tabInfo.placeholder}
            maxLength={100}
            aria-label="Search"
            style={{
              width: "100%", boxSizing: "border-box", padding: "12px 40px 12px 40px", fontSize: 15,
              background: theme.inputBg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 12, outline: "none",
            }}
          />
          {input && (
            <button
              onClick={() => setInput("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", color: theme.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >×</button>
          )}
        </div>

        {error && <p style={{ color: theme.errText, fontSize: 13.5 }}>{error}</p>}
        {loading && <p style={{ color: theme.subtleText, fontSize: 14 }}>Searching…</p>}

        {!loading && !error && (
          <p style={{ margin: "0 0 12px", color: theme.muted, fontSize: 13 }}>
            {total === 0 ? tabInfo.empty : `${total.toLocaleString()} ${tab === "bom" ? "item" : "row"}${total === 1 ? "" : "s"}${query ? ` matching “${query}”` : ""} in ${groups.length}${hasMore ? "+" : ""} ${tab === "bom" ? "BOM" : "sheet"}${groups.length === 1 && !hasMore ? "" : "s"}`}
          </p>
        )}

        {groups.map((g) => (
          <div key={g.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <button
                onClick={() => onOpenDoc(g.id)}
                style={{ border: "none", background: "none", color: theme.text, cursor: "pointer", padding: 0, fontSize: 16, fontWeight: 700, textAlign: "left" }}
              >
                <Highlight text={g.title} query={query} theme={theme} />
              </button>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {g.role !== "owner" && (
                  <span style={{ fontSize: 11, color: theme.muted, border: `1px solid ${theme.border}`, borderRadius: 999, padding: "2px 8px" }}>
                    shared · {g.role}
                  </span>
                )}
                <span style={{ fontSize: 12, color: theme.muted }}>{g.rows.length}{hasMore ? "+" : ""} shown</span>
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {tab === "bom" ? renderBomTable(g) : renderSheetTable(g)}
            </div>
          </div>
        ))}

        {hasMore && !loading && (
          <div style={{ textAlign: "center", margin: "8px 0 32px" }}>
            <button
              onClick={() => { setLoadingMore(true); fetchPage(rows.length); }}
              disabled={loadingMore}
              style={{ border: `1px solid ${theme.border}`, background: "none", color: theme.subtleText, borderRadius: 8, padding: "9px 20px", cursor: loadingMore ? "default" : "pointer", fontSize: 14 }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
