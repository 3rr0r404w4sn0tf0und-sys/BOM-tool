import React, { useEffect, useRef, useState } from "react";
import { IconRefresh } from "./Icons.jsx";

export default function RefreshMenu({ theme, refreshingFilter, onSelect }) {

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const busy = !!refreshingFilter;

  const options = [
    { key: "other", label: "Other items" },
    { key: "amazon", label: "Amazon items" },
    { key: "mouser", label: "Mouser items" },
    { key: "all", label: "Everything" },
  ];
  const busyLabel = options.find((o) => o.key === refreshingFilter)?.label;

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
          background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}
      >
        <IconRefresh size={13} />
        {busy ? `Refreshing ${busyLabel}…` : "Refresh"}
        <span
          style={{
            fontSize: 9, marginLeft: -1, transform: open ? "rotate(180deg)" : "none",
            transition: "transform 160ms ease",
          }}
        >
          ▾
        </span>
      </button>

      <div
        style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
          background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 10,
          boxShadow: "0 10px 28px rgba(0,0,0,0.18)", minWidth: 180, overflow: "hidden",
          transformOrigin: "top left",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.96) translateY(-4px)",
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 150ms ease, transform 150ms ease",
        }}
      >
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => { setOpen(false); onSelect(o.key); }}
            disabled={busy}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 13px",
              border: "none", background: "none", color: theme.text, fontSize: 13, fontWeight: 500,
              cursor: busy ? "default" : "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.rowBorder)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

