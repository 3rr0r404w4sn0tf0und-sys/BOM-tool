import React, { useState } from "react";
import { API_URL, apiFetch } from "./api.js";

// Lets a user paste in their own Apify API token so their Amazon/Mouser
// scrapes run against their own Apify account (and their own usage/
// billing). There is no site-wide fallback token -- without one saved
// here, Apify-tier scrapes (Amazon/Mouser/Arrow) just fall back to a
// plain HTTP fetch and may come back price-not-found. Saved token is
// never sent back to the client in plaintext -- once set, this just
// shows "saved" with an option to clear it, same pattern as a password
// field.
export default function ApifyKeyModal({ theme, hasApifyToken, onClose, onSaved }) {
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    if (!tokenInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/apify-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save key");
      }
      setTokenInput("");
      setJustSaved(true);
      onSaved?.(true);
    } catch (e) {
      setError(e.message || "Failed to save key");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setClearing(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/apify-key`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove key");
      }
      setJustSaved(false);
      onSaved?.(false);
    } catch (e) {
      setError(e.message || "Failed to remove key");
    } finally {
      setClearing(false);
    }
  }

  const currentlySet = justSaved || hasApifyToken;

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
          width: "100%", maxWidth: 460, background: theme.cardBg, color: theme.text,
          borderRadius: 14, padding: 28, boxShadow: "0 10px 30px rgba(0,0,0,0.3)", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Your Apify API key</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: theme.muted }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: 13, color: theme.subtleText, margin: "0 0 18px", lineHeight: 1.5 }}>
          Amazon, Mouser, and Arrow links need an Apify token to fetch prices reliably -- there's no shared account
          anymore, so without your own key those scrapes will fall back to a plain fetch and often come back price
          not found. Paste in your own token from{" "}
          <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noreferrer" style={{ color: theme.text }}>
            console.apify.com/settings/integrations
          </a>{" "}
          and your BOM's scrapes will run against your own account (and your own usage/billing).
        </p>

        {currentlySet && (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8,
              padding: "10px 12px", marginBottom: 14, fontSize: 13,
            }}
          >
            <span style={{ color: theme.okText || theme.text }}>● A key is saved for your account</span>
            <button
              onClick={clearKey}
              disabled={clearing}
              style={{
                border: "none", background: "none", cursor: clearing ? "default" : "pointer",
                fontSize: 12.5, fontWeight: 600, color: theme.error || "#ff6b6b", padding: 0,
                opacity: clearing ? 0.6 : 1,
              }}
            >
              {clearing ? "Removing…" : "Remove"}
            </button>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>
          {currentlySet ? "Replace with a new key" : "Apify API token"}
        </div>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="apify_api_..."
          style={{
            width: "100%", boxSizing: "border-box", background: theme.bg, color: theme.text,
            border: `1px solid ${theme.border}`, borderRadius: 8, padding: "9px 10px", fontSize: 13,
            fontFamily: "monospace", marginBottom: 12,
          }}
        />

        {error && <div style={{ fontSize: 12.5, color: theme.error || "#ff6b6b", marginBottom: 10 }}>{error}</div>}

        <button
          onClick={save}
          disabled={saving || !tokenInput.trim()}
          style={{
            width: "100%", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 13.5,
            fontWeight: 700, cursor: saving || !tokenInput.trim() ? "default" : "pointer",
            background: theme.text, color: theme.cardBg, opacity: saving || !tokenInput.trim() ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save key"}
        </button>

        <p style={{ fontSize: 11.5, color: theme.muted, margin: "12px 0 0", lineHeight: 1.5 }}>
          Stored encrypted and never shown again once saved. Applies to on-demand and batch scrapes triggered from
          this page. The nightly automatic refresh job still runs on a single site-wide token today -- it hasn't
          been converted to per-user tokens yet, so those items may fall back to plain HTTP if the nightly job's
          token is removed.
        </p>
      </div>
    </div>
  );
}
