import React from "react";

export default function PrivacyModal({ theme, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "80vh",
          overflowY: "auto",
          background: theme.cardBg,
          color: theme.text,
          borderRadius: 12,
          padding: 28,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
          fontFamily: "sans-serif",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Privacy Notice</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: theme.muted }}
          >
            ✕
          </button>
        </div>

        <p>
          BOM Tool is a small, independently run project. This notice explains what data is
          collected and how it's used — plainly, without legal filler.
        </p>

        <h4 style={{ marginBottom: 4 }}>What we collect</h4>
        <p>
          Your email address and a hashed password (or, if you sign in with GitHub, your GitHub
          account identifier and public profile email) are stored so you can log in. We also
          store the Bills of Materials you create — section titles, item names, quantities, and
          the product links you add — along with prices fetched for those links.
        </p>

        <h4 style={{ marginBottom: 4 }}>How it's used</h4>
        <p>
          Your data is used only to run the app: authenticating you, saving your BOMs, and
          periodically refreshing prices for the product links you've added. Email is also used
          to send account verification and, if requested, password-related messages.
        </p>

        <h4 style={{ marginBottom: 4 }}>Third parties</h4>
        <p>
          Transactional email is sent through Brevo. Product prices are fetched via Apify or a
          direct browser fetch, using only the URLs you provide. If you use GitHub sign-in,
          GitHub shares basic profile info with us to create your account. None of your BOM
          content is sold or shared for advertising.
        </p>

        <h4 style={{ marginBottom: 4 }}>Your choices</h4>
        <p>
          You can delete your BOMs at any time from within the app. If you'd like your account
          and associated data fully removed, contact the maintainer via the GitHub repository
          linked in the footer.
        </p>

        <p style={{ marginTop: 20, color: theme.muted, fontSize: 12 }}>
          This is a hobby/open-source project, not a company — treat this notice as a good-faith
          description of current behavior rather than a formal legal policy.
        </p>
      </div>
    </div>
  );
}
