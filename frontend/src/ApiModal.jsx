import React, { useState, useRef, useLayoutEffect, useEffect } from "react";
import { API_URL, apiFetch } from "./api.js";
import { IconCopy, IconCheck, IconRefresh } from "./Icons.jsx";


// Google Apps Script snippet -- pulls the flat "links" feed into a sheet
// via =BOM_ROWS(). Copied as-is, key baked in, nothing for the user to edit.
function sheetsScript(linksUrl) {
  return `function BOM_ROWS() {
  var res = UrlFetchApp.fetch("${linksUrl}");
  var data = JSON.parse(res.getContentText());
  return data.rows.map(function (r) {
    return [r.item, r.price, r.link || ""];
  });
}`;
}

function CopyRow({ label, value, theme }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable -- nothing else to fall back to here
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
          className="bom-api-modal-scroll"
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

// A named integration block: one line of description + a single "Copy code"
// button. No raw code shown in the UI -- clicking it just puts the whole
// working snippet on the clipboard.
function CopyCodeButton({ label, getCode, theme }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable
    }
  }

  return (
    <button
      onClick={copy}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: theme.bg,
        border: `1px solid ${theme.border}`, borderRadius: 8,
        padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        color: copied ? theme.okText : theme.text, width: "100%", textAlign: "left",
      }}
    >
      {copied ? <IconCheck size={14} color={theme.okText} /> : <IconCopy size={14} color={theme.muted} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function ApiModal({ bom, theme, onClose, onKeyRegenerated, anchorRef }) {
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [regenError, setRegenError] = useState(null);

  const [keyRevealed, setKeyRevealed] = useState(false);

  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);

  const key = bom.public_api_key;
  const hasKey = !!key;
  const htmlUrl = hasKey ? `${API_URL}/api/public/bom-html?api_key=${key}` : "";
  const htmlLinksUrl = hasKey ? `${API_URL}/api/public/bom-links-html?api_key=${key}` : "";
  const linksUrl = hasKey ? `${API_URL}/api/public/bom-links?api_key=${key}` : ""; // used only to build the Sheets Apps Script below, never shown directly
  const iframeSnippet = hasKey
    ? `<iframe src="${htmlUrl}" style="width:100%;border:none;min-height:600px;" title="${bom.title.replace(/"/g, "&quot;")} BOM"></iframe>`
    : "";
  const iframeLinksSnippet = hasKey
    ? `<iframe src="${htmlLinksUrl}" style="width:100%;border:none;min-height:600px;" title="${bom.title.replace(/"/g, "&quot;")} BOM (links)"></iframe>`
    : "";
  const maskedKey = hasKey ? "•".repeat(Math.min(key.length, 40)) : "";

  // Position the popover just under the API button, anchored to it exactly
  // like the Share popover -- flips to stay on-screen near the right/bottom
  // edges instead of overflowing. Previously this rendered as a full-screen
  // centered modal unrelated to the button that opened it.
  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef?.current;
      const popover = popoverRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const width = popover?.offsetWidth || 560;
      const height = popover?.offsetHeight || 480;
      const margin = 10;
      let left = a.left;
      if (left + width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - width - margin);
      let top = a.bottom + 8;
      if (top + height + margin > window.innerHeight) top = Math.max(margin, a.top - height - 8);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyRevealed, confirmingRegen, regenError]);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === "Escape") onClose(); }
    function onClickOutside(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    // Capture phase + a microtask delay so the click that opened the
    // popover (on the API button) doesn't immediately close it again.
    const t = setTimeout(() => document.addEventListener("mousedown", onClickOutside, true), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClickOutside, true);
    };
  }, [onClose, anchorRef]);

  async function regenerateKey() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/regenerate-key`, {
        method: "POST",
        headers: { },
      });
      if (!res.ok) throw new Error("Failed to generate a new key");
      const updated = await res.json();
      onKeyRegenerated?.(updated);
      setConfirmingRegen(false);
    } catch (e) {
      setRegenError(e.message || "Failed to generate a new key");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none",
      }}
    >
      {/* Dark, thin scrollbars for the horizontally-scrolling code/url rows
          below -- overrides the OS-default light scrollbar (WebKit) that
          otherwise shows up as a jarring white bar against the dark modal. */}
      <style>{`
        .bom-api-modal-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .bom-api-modal-scroll::-webkit-scrollbar-track { background: transparent; }
        .bom-api-modal-scroll::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 3px; }
        .bom-api-modal-scroll::-webkit-scrollbar-thumb:hover { background: ${theme.muted}; }
        .bom-api-modal-scroll { scrollbar-width: thin; scrollbar-color: ${theme.border} transparent; }
      `}</style>
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className="bom-api-modal-scroll"
        style={{
          position: "fixed",
          top: pos?.top ?? -9999, left: pos?.left ?? -9999,
          visibility: pos ? "visible" : "hidden",
          width: 560, maxWidth: "calc(100vw - 20px)", maxHeight: "80vh", overflowY: "auto",
          background: theme.cardBg, color: theme.text, borderRadius: 14, padding: 28,
          border: `1px solid ${theme.border}`,
          boxShadow: "0 16px 40px rgba(0,0,0,0.28)", fontFamily: "sans-serif",
          pointerEvents: "auto",
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

        {!hasKey ? (
          <div
            style={{
              background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8,
              padding: "14px 12px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.5 }}>
              No API key yet for this BOM. Generate one to get an embeddable link and read-only access.
            </div>
            {regenError && (
              <div style={{ fontSize: 12, color: theme.error || "#ff6b6b" }}>{regenError}</div>
            )}
            <button
              onClick={regenerateKey}
              disabled={regenerating}
              style={{
                border: "none", borderRadius: 6, padding: "8px 10px", fontSize: 12.5,
                fontWeight: 700, cursor: regenerating ? "default" : "pointer",
                background: theme.accent || theme.text, color: theme.cardBg, opacity: regenerating ? 0.7 : 1,
              }}
            >
              {regenerating ? "Generating…" : "Generate API key"}
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>API key</div>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
                }}
              >
                <code
                  style={{
                    flex: 1, fontSize: 12, color: theme.text, overflowX: "auto", whiteSpace: "nowrap",
                    fontFamily: "monospace", userSelect: keyRevealed ? "text" : "none",
                  }}
                >
                  {keyRevealed ? key : maskedKey}
                </code>
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setKeyRevealed(true);
                  }}
                  onPointerUp={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    setKeyRevealed(false);
                  }}
                  onPointerCancel={() => setKeyRevealed(false)}
                  title="Hold to reveal"
                  style={{
                    border: "none", background: "none", cursor: "pointer", display: "flex", flexShrink: 0,
                    fontSize: 11, fontWeight: 600, color: theme.muted, padding: "2px 6px",
                    width: 78, justifyContent: "center", touchAction: "none",
                  }}
                >
                  {keyRevealed ? "Hide" : "Hold to show"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 6 }}>
              <CopyCodeButton label="Copy <iframe> embed snippet (table: name, qty, price)" getCode={() => iframeSnippet} theme={theme} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <CopyCodeButton label="Copy <iframe> embed snippet (links: name + qty only)" getCode={() => iframeLinksSnippet} theme={theme} />
            </div>
            <p style={{ fontSize: 12, color: theme.subtleText, margin: "-8px 0 14px", lineHeight: 1.5 }}>
              Drop either snippet into any page (Odoo included) for a fully styled, self-contained table — no JSON parsing needed.
              The first shows price per item; the second shows just names (as clickable links to each product) and quantities,
              with totals still shown once at the bottom.
            </p>

            <div style={{ marginTop: -4, marginBottom: 4 }}>
              {!confirmingRegen ? (
                <button
                  onClick={() => setConfirmingRegen(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, border: "none", background: "none",
                    cursor: "pointer", fontSize: 12, fontWeight: 600, color: theme.muted, padding: 0,
                  }}
                >
                  <IconRefresh size={12} color={theme.muted} />
                  Key compromised? Generate a new one
                </button>
              ) : (
                <div
                  style={{
                    background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8,
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.5 }}>
                    This immediately deletes the current key and replaces it with a new one. The old key stops
                    working right away — any embed, sheet, or Odoo automation using it will need updating.
                  </div>
                  {regenError && (
                    <div style={{ fontSize: 12, color: theme.error || "#ff6b6b" }}>{regenError}</div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={regenerateKey}
                      disabled={regenerating}
                      style={{
                        flex: 1, border: "none", borderRadius: 6, padding: "7px 10px", fontSize: 12.5,
                        fontWeight: 700, cursor: regenerating ? "default" : "pointer",
                        background: theme.error || "#ff6b6b", color: "#fff", opacity: regenerating ? 0.7 : 1,
                      }}
                    >
                      {regenerating ? "Generating…" : "Yes, replace it"}
                    </button>
                    <button
                      onClick={() => { setConfirmingRegen(false); setRegenError(null); }}
                      disabled={regenerating}
                      style={{
                        flex: 1, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "7px 10px",
                        fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "none", color: theme.text,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ height: 1, background: theme.border, margin: "18px 0" }} />

            <h4 style={{ fontSize: 13, margin: "0 0 6px" }}>Google Sheets</h4>
            <p style={{ fontSize: 12.5, color: theme.subtleText, margin: "0 0 8px", lineHeight: 1.5 }}>
              In your sheet: Extensions → Apps Script → paste the copied code → Save. Back in the sheet, type{" "}
              <code>=BOM_ROWS()</code> into any cell and it spills out item / price / link, one row per part.
            </p>
            <div style={{ marginBottom: 14 }}>
              <CopyCodeButton label="Copy Apps Script code" getCode={() => sheetsScript(linksUrl)} theme={theme} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
