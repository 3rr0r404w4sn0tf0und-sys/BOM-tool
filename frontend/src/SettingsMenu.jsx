import React, { useEffect, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle.jsx";
import { IconGear, IconLogout, IconPlug } from "./Icons.jsx";

export default function SettingsMenu({ theme, themeName, onToggleTheme, isLoggedIn, onLogout, hasApifyToken, onManageApifyKey, onAccountSettings }) {
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
    <div ref={ref} style={{ position: "relative", fontFamily: "sans-serif", marginLeft: 10 }}>
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
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background-color 500ms ease, border-color 500ms ease, color 500ms ease",
        }}
      >
        <span
          style={{
            display: "flex",
            transform: open ? "rotate(35deg)" : "rotate(0deg)",
            transition: "transform 300ms ease",
          }}
        >
          <IconGear size={18} color={theme.text} />
        </span>
      </button>

      <div
        style={{
          position: "absolute",
          top: 44,
          right: 0,
          minWidth: 224,
          boxSizing: "border-box",
          background: theme.cardBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
          padding: 8,
          zIndex: 100,
          transformOrigin: "top right",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.95) translateY(-6px)",
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease, transform 200ms ease, background-color 500ms ease, border-color 500ms ease",
        }}
      >
        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 2px 8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14, color: theme.text, }}>
            {themeName === "dark" ? "Dark mode" : "Light mode"}
          </span>
          <ThemeToggle isDark={themeName === "dark"} onToggle={onToggleTheme} />
        </div>

        {isLoggedIn && (
          <>
            <div style={{ height: 1, background: theme.border, margin: "6px 0", }} />
            {onAccountSettings && (
              <button
                onClick={() => { setOpen(false); onAccountSettings(); }}
                style={{ width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: "none", cursor: "pointer", fontSize: 14, color: theme.text, borderRadius: 6 }}
              >
                Account settings
              </button>
            )}
            {onManageApifyKey && (
              <button
                onClick={() => {
                  setOpen(false);
                  onManageApifyKey();
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
                 ,
                }}
              >
                <IconPlug size={15} color={theme.text} />
                Apify API key{hasApifyToken ? " ✓" : ""}
              </button>
            )}
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
                display: "flex",
                alignItems: "center",
                gap: 8,
               ,
              }}
            >
              <IconLogout size={15} color={theme.errText} />
              Log out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
