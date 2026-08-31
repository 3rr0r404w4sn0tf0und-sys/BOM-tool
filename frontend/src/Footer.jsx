import React from "react";

export default function Footer({ theme, onPrivacyClick }) {
  return (
    <footer
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "10px 16px",
        fontSize: 12,
        color: theme.muted,
        background: theme.cardBg,
        borderTop: `1px solid ${theme.border}`,
        fontFamily: "sans-serif",
      }}
    >
      <span>Created by WanChengJunWang</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <a
        href="https://github.com/3rr0r404w4sn0tf0und-sys/BOM-tool/blob/main/LICENSE"
        target="_blank"
        rel="noreferrer"
        style={{ color: theme.linkColor }}
      >
        License (AGPLv3)
      </a>
      <span style={{ opacity: 0.5 }}>·</span>
      <a
        href="https://github.com/3rr0r404w4sn0tf0und-sys/BOM-tool"
        target="_blank"
        rel="noreferrer"
        style={{ color: theme.linkColor }}
      >
        GitHub
      </a>
      <span style={{ opacity: 0.5 }}>·</span>
      <button
        onClick={onPrivacyClick}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: 0,
          font: "inherit",
          color: theme.linkColor,
          textDecoration: "underline",
        }}
      >
        Privacy
      </button>
      <span style={{ opacity: 0.5 }}>·</span>
      <a
        href="mailto:modudroneteam@hotmail.com"
        style={{ color: theme.linkColor }}
      >
        Contact
      </a>
    </footer>
  );
}
