import React, { useEffect, useRef, useState } from "react";

export default function SettingsMenu({ theme, themeName, onToggleTheme, isLoggedIn, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", fontFamily: "sans-serif" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
          background: theme.cardBg,
          color: theme.text,
          cursor: "pointer",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ⚙️
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 44,
            right: 0,
            minWidth: 200,
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
            padding: 8,
            zIndex: 100,
          }}
        >
          <button
            onClick={() => {
              onToggleTheme();
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 14,
              color: theme.text,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {themeName === "dark" ? "☀️" : "🌙"}
            {themeName === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          </button>

          {isLoggedIn && (
            <>
              <div style={{ height: 1, background: theme.border, margin: "6px 0" }} />
              <button
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  color: theme.errText,
                  borderRadius: 6,
                }}
              >
                🚪 Log out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
