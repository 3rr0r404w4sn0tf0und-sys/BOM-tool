import React, { useState } from "react";
import Footer from "./Footer.jsx";
import PrivacyModal from "./PrivacyModal.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { IconTable, IconRefresh, IconShare } from "./Icons.jsx";

const FEATURES = [
  {
    icon: IconTable,
    title: "BOMs and sheets, side by side",
    body: "Build priced bill-of-materials tables or plain data sheets in the same tool, with drag-to-reorder rows and sections, undo/redo, and checkboxes for tracking progress.",
  },
  {
    icon: IconRefresh,
    title: "Prices that keep themselves current",
    body: "Paste a product link and BOM Tool fetches and refreshes its price automatically, so totals stay accurate without manual re-checking.",
  },
  {
    icon: IconShare,
    title: "Share and collaborate",
    body: "Invite collaborators as viewers or editors, or hand out a public API key to pull totals into your own tools and dashboards.",
  },
];

export default function Landing({ theme, themeName, onToggleTheme, onLogin, onSignUp }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        position: "relative",
        zIndex: 1,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "18px 24px",
          maxWidth: 1080,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <span className="bom-brand" aria-label="BOM Tool">
          <img src="/favicon.svg" alt="" width="22" height="22" />
          <span>BOM Tool</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ThemeToggle isDark={themeName === "dark"} onToggle={onToggleTheme} />
          <button
            onClick={onLogin}
            style={{
              padding: "9px 18px",
              borderRadius: 999,
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: theme.text,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Log in
          </button>
          <button
            onClick={onSignUp}
            style={{
              padding: "9px 18px",
              borderRadius: 999,
              border: "none",
              background: theme.accent,
              color: theme.accentText,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 6px 16px rgba(79,70,229,0.25)",
            }}
          >
            Sign up
          </button>
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px 72px" }}>
        <div style={{ maxWidth: 680, textAlign: "center" }}>
          <h1
            style={{
              fontSize: "clamp(32px, 5vw, 48px)",
              lineHeight: 1.12,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: theme.text,
              margin: "0 0 18px",
            }}
          >
            Bills of materials that price and update themselves.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: theme.subtleText, margin: "0 0 32px" }}>
            BOM Tool is a lightweight, collaborative way to track parts, quantities, and live prices for a
            hardware project — or just keep a plain shared sheet — without wrestling a spreadsheet into
            submission.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={onSignUp}
              style={{
                padding: "13px 26px",
                borderRadius: 999,
                border: "none",
                background: theme.accent,
                color: theme.accentText,
                fontSize: 15.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 10px 24px rgba(79,70,229,0.28)",
              }}
            >
              Get started free
            </button>
            <button
              onClick={onLogin}
              style={{
                padding: "13px 26px",
                borderRadius: 999,
                border: `1px solid ${theme.border}`,
                background: theme.cardBg,
                color: theme.text,
                fontSize: 15.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Log in
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 64,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 18,
            width: "100%",
            maxWidth: 1000,
          }}
        >
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              style={{
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 16,
                padding: "22px 20px",
                textAlign: "left",
                boxShadow: theme.shadow,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: theme.accentSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <Icon size={17} color={theme.accent} />
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 700, color: theme.text, margin: "0 0 6px" }}>{title}</h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, color: theme.subtleText, margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </main>

      <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
      {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
