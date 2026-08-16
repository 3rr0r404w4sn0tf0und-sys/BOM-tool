import React, { useEffect, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle.jsx";
import { IconGear, IconLogout } from "./Icons.jsx";

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
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: open ? "rotate(35deg)" : "rotate(0deg)",
          transition: "transform 300ms ease",
        }}
      >
        <IconGear size={18} color={theme.text} />
      </button>

      <div
        style={{
          position: "absolute",
          top: 44,
          right: 0,
          minWidth: 224,
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
          transition: "opacity 200ms ease, transform 200ms ease",
        }}
      >
        <div
          style={{
            width: "100%",
            padding: "8px 2px 8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14, color: theme.text }}>
            {themeName === "dark" ? "Dark mode" : "Light mode"}
          </span>
          <ThemeToggle isDark={themeName === "dark"} onToggle={onToggleTheme} />
        </div>

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
                display: "flex",
                alignItems: "center",
                gap: 8,
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
