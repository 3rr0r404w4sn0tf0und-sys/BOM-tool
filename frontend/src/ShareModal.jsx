import React, { useState, useEffect, useCallback } from "react";
import { API_URL, apiFetch } from "./api.js";
import { IconCopy, IconCheck, IconTrash } from "./Icons.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RoleSelect({ value, onChange, theme, disabled }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        border: `1px solid ${theme.border}`, borderRadius: 6, padding: "5px 8px",
        fontSize: 12.5, fontWeight: 600, background: theme.bg, color: theme.text,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <option value="viewer">Viewer</option>
      <option value="editor">Editor</option>
    </select>
  );
}

// Owner-only: invite people by email (viewer/editor), manage existing
// shares, and set the "anyone with the link" access level. Only ever
// rendered when bom.role === "owner" -- the backend also enforces this
// independently, so this modal being reachable isn't itself a trust
// boundary.
export default function ShareModal({ bom, theme, onClose }) {
  const [shares, setShares] = useState(null);
  const [publicAccess, setPublicAccess] = useState(bom.public_access || "private");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);

  const [linkCopied, setLinkCopied] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const shareLink = `${window.location.origin}/sheet/${bom.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/shares`);
      if (!res.ok) throw new Error("Failed to load sharing settings");
      const data = await res.json();
      setShares(data.shares);
      setPublicAccess(data.public_access);
    } catch (e) {
      setLoadError(e.message || "Failed to load sharing settings");
    } finally {
      setLoading(false);
    }
  }, [bom.id]);

  useEffect(() => { load(); }, [load]);

  async function invite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setInviteError("Enter a valid email address");
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to share");
      }
      setInviteEmail("");
      await load();
    } catch (e) {
      setInviteError(e.message || "Failed to share");
    } finally {
      setInviting(false);
    }
  }

  async function updateShareRole(shareId, role) {
    setShares((prev) => prev.map((s) => (s.id === shareId ? { ...s, role } : s)));
    await apiFetch(`${API_URL}/api/boms/${bom.id}/shares/${shareId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }

  async function removeShare(shareId) {
    setShares((prev) => prev.filter((s) => s.id !== shareId));
    await apiFetch(`${API_URL}/api/boms/${bom.id}/shares/${shareId}`, { method: "DELETE" });
  }

  async function changeVisibility(next) {
    const prev = publicAccess;
    setPublicAccess(next);
    setSavingVisibility(true);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_access: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPublicAccess(prev);
    } finally {
      setSavingVisibility(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // clipboard API unavailable -- nothing else to fall back to
    }
  }

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
          width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto",
          background: theme.cardBg, color: theme.text, borderRadius: 14, padding: 28,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Share "{bom.title}"</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: theme.muted }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: 13, color: theme.subtleText, margin: "0 0 18px", lineHeight: 1.5 }}>
          Viewers can see this BOM but not change it. Editors can add, edit, and delete rows and sections,
          but can't manage sharing or delete the BOM itself — only you can do that.
        </p>

        {/* Invite by email */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !inviting && invite()}
            style={{
              flex: 1, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
              fontSize: 13, background: theme.bg, color: theme.text, minWidth: 0,
            }}
          />
          <RoleSelect value={inviteRole} onChange={setInviteRole} theme={theme} disabled={inviting} />
          <button
            onClick={invite}
            disabled={inviting || !inviteEmail.trim()}
            style={{
              border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700,
              cursor: inviting ? "default" : "pointer", background: theme.accent, color: theme.accentText,
              opacity: inviting || !inviteEmail.trim() ? 0.6 : 1, whiteSpace: "nowrap",
            }}
          >
            {inviting ? "Sharing…" : "Share"}
          </button>
        </div>
        {inviteError && (
          <div style={{ fontSize: 12, color: theme.error || "#ff6b6b", marginBottom: 10 }}>{inviteError}</div>
        )}

        {/* Existing shares */}
        <div style={{ marginTop: 14, marginBottom: 18 }}>
          {loading && <p style={{ fontSize: 12.5, color: theme.muted }}>Loading…</p>}
          {loadError && <p style={{ fontSize: 12.5, color: theme.error || "#ff6b6b" }}>{loadError}</p>}
          {!loading && !loadError && shares && shares.length === 0 && (
            <p style={{ fontSize: 12.5, color: theme.muted, margin: 0 }}>
              Not shared with anyone yet.
            </p>
          )}
          {!loading && shares && shares.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {shares.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.email}
                    </div>
                    <div style={{ fontSize: 11, color: theme.muted }}>
                      {s.accepted_at ? "Accepted" : "Invited — hasn't opened it yet"}
                    </div>
                  </div>
                  <RoleSelect value={s.role} onChange={(r) => updateShareRole(s.id, r)} theme={theme} />
                  <button
                    onClick={() => removeShare(s.id)}
                    title="Remove access"
                    style={{ border: "none", background: "none", cursor: "pointer", display: "flex", flexShrink: 0, color: theme.muted }}
                  >
                    <IconTrash size={14} color={theme.muted} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ height: 1, background: theme.border, margin: "16px 0" }} />

        {/* Public link */}
        <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Anyone with the link</h4>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <select
            value={publicAccess}
            onChange={(e) => changeVisibility(e.target.value)}
            disabled={savingVisibility}
            style={{
              flex: 1, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
              fontSize: 13, fontWeight: 600, background: theme.bg, color: theme.text,
              cursor: savingVisibility ? "default" : "pointer",
            }}
          >
            <option value="private">Private — only people invited above</option>
            <option value="view">Anyone with the link can view</option>
            <option value="edit">Anyone with the link can edit</option>
          </select>
        </div>

        {publicAccess !== "private" && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
            }}
          >
            <code style={{ flex: 1, fontSize: 12, color: theme.text, overflowX: "auto", whiteSpace: "nowrap", fontFamily: "monospace" }}>
              {shareLink}
            </code>
            <button
              onClick={copyLink}
              title="Copy link"
              style={{ border: "none", background: "none", cursor: "pointer", display: "flex", flexShrink: 0, color: linkCopied ? theme.okText : theme.muted }}
            >
              {linkCopied ? <IconCheck size={14} color={theme.okText} /> : <IconCopy size={14} color={theme.muted} />}
            </button>
          </div>
        )}
        {publicAccess === "edit" && (
          <p style={{ fontSize: 12, color: theme.error || "#ff6b6b", margin: "10px 0 0", lineHeight: 1.5 }}>
            Anyone with this link can change prices, delete rows, and rename this BOM — no account or invite needed.
          </p>
        )}
      </div>
    </div>
  );
}
