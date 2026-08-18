import React, { useState } from "react";
import { IconCopy, IconCheck } from "./Icons.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function CopyRow({ label, value, theme }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable -- the text is still selectable/visible below
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
        }}
      >
        <code
          style={{
            flex: 1, fontSize: 12, color: theme.text, overflowX: "auto", whiteSpace: "nowrap",
            fontFamily: "monospace",
          }}
        >
          {value}
        </code>
        <button
          onClick={copy}
          title="Copy"
          style={{ border: "none", background: "none", cursor: "pointer", display: "flex", flexShrink: 0, color: copied ? theme.okText : theme.muted }}
        >
          {copied ? <IconCheck size={14} color={theme.okText} /> : <IconCopy size={14} color={theme.muted} />}
        </button>
      </div>
    </div>
  );
}

export default function ApiModal({ bom, theme, onClose }) {
  const key = bom.public_api_key;
  const cleanUrl = `${API_URL}/api/public/bom-clean?api_key=${key}`;
  const linksUrl = `${API_URL}/api/public/bom-links?api_key=${key}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto",
          background: theme.cardBg, color: theme.text, borderRadius: 14, padding: 28,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>API access for "{bom.title}"</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: theme.muted }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: 13, color: theme.subtleText, margin: "0 0 18px", lineHeight: 1.5 }}>
          Read-only endpoints, scoped to this BOM only. Anyone with this key can view (but not edit) it — treat it like a password.
        </p>

        <CopyRow label="API key" value={key} theme={theme} />
        <CopyRow label="Formatted (sections, totals, bold/italic) — for docs/reports" value={cleanUrl} theme={theme} />
        <CopyRow label="Flat rows (item, price, link) — for spreadsheets" value={linksUrl} theme={theme} />

        <div style={{ height: 1, background: theme.border, margin: "18px 0" }} />

        <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>Google Sheets</h4>
        <p style={{ fontSize: 12.5, color: theme.subtleText, margin: "0 0 8px", lineHeight: 1.5 }}>
          Extensions → Apps Script, paste this, then use <code>=BOM_ROWS()</code> in a cell:
        </p>
        <pre
          style={{
            background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 10,
            fontSize: 11, overflowX: "auto", fontFamily: "monospace", color: theme.text, margin: "0 0 14px",
          }}
        >{`function BOM_ROWS() {
  const res = UrlFetchApp.fetch("${linksUrl}");
  const data = JSON.parse(res.getContentText());
  return data.rows.map(r => [r.item, r.price, r.link]);
}`}</pre>

        <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>Odoo</h4>
        <p style={{ fontSize: 12.5, color: theme.subtleText, margin: "0 0 8px", lineHeight: 1.5 }}>
          Call it from a Scheduled Action / server action (Settings → Technical → Automation):
        </p>
        <pre
          style={{
            background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 10,
            fontSize: 11, overflowX: "auto", fontFamily: "monospace", color: theme.text, margin: "0 0 4px",
          }}
        >{`import requests
res = requests.get("${cleanUrl}", timeout=15)
data = res.json()
# data["sections"][i]["rows"] -> [{item, qty, price, ...}]
# loop over rows to create/update Odoo records as needed`}</pre>
      </div>
    </div>
  );
}
