import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { API_URL, apiFetch } from "./api.js";
import { IconCopy, IconCheck, IconTrash } from "./Icons.jsx";

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

// Owner-only: invite people by username or email (viewer/editor), manage
// existing shares, and set the "anyone with the link" access level. Only
// ever rendered when bom.role === "owner" -- the backend also enforces
// this independently, so this modal being reachable isn't itself a trust
// boundary.
//
// Rendered as a popover anchored to the Share button (via anchorRef)
// rather than a centered, dimmed-overlay modal -- it's a quick, contextual
// action, not something that needs to take over the whole screen.
export default function ShareModal({ bom, theme, onClose, anchorRef }) {
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

  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);

  const shareLink = `${window.location.origin}/sheet/${bom.id}`;

  // Position the popover just under the Share button, flipping to stay
  // on-screen near the right/bottom edges instead of overflowing.
  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef?.current;
      const popover = popoverRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const width = popover?.offsetWidth || 380;
      const height = popover?.offsetHeight || 420;
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
  }, [loading, shares, publicAccess]);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === "Escape") onClose(); }
    function onClickOutside(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    // Capture phase + a microtask delay so the click that opened the
    // popover (on the Share button) doesn't immediately close it again.
    const t = setTimeout(() => document.addEventListener("mousedown", onClickOutside, true), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClickOutside, true);
    };
  }, [onClose, anchorRef]);

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
    const identifier = inviteEmail.trim();
    if (!identifier) {
      setInviteError("Enter a username or email address");
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, role: inviteRole }),
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
      style={{
        position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none",
      }}
    >
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: pos?.top ?? -9999, left: pos?.left ?? -9999,
          visibility: pos ? "visible" : "hidden",
          width: 380, maxWidth: "calc(100vw - 20px)", maxHeight: "80vh", overflowY: "auto",
          background: theme.cardBg, color: theme.text, borderRadius: 14, padding: 20,
          border: `1px solid ${theme.border}`,
          boxShadow: "0 16px 40px rgba(0,0,0,0.28)", fontFamily: "sans-serif",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15.5 }}>Share "{bom.title}"</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: theme.muted }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: theme.subtleText, margin: "0 0 16px", lineHeight: 1.5 }}>
          Viewers can see this BOM but not change it. Editors can add, edit, and delete rows and sections,
          but can't manage sharing or delete the BOM itself — only you can do that.
        </p>

        {/* Invite by username or email */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Username or email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !inviting && invite()}
            style={{
              flex: 1, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 10px",
              fontSize: 13, background: theme.bg, color: theme.text, minWidth: 0,
            }}
          />
          <RoleSelect value={inviteRole} onChange={setInviteRole} theme={theme} disabled={inviting} />
        </div>
        <button
          onClick={invite}
          disabled={inviting || !inviteEmail.trim()}
          style={{
            width: "100%", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700,
            cursor: inviting ? "default" : "pointer", background: theme.accent, color: theme.accentText,
            opacity: inviting || !inviteEmail.trim() ? 0.6 : 1, whiteSpace: "nowrap", marginBottom: 8,
          }}
        >
          {inviting ? "Sharing…" : "Share"}
        </button>
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
                      {s.username ? `@${s.username}` : s.email}
                    </div>
                    <div style={{ fontSize: 11, color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.username ? `${s.email} · ` : ""}{s.accepted_at ? "Accepted" : "Invited — hasn't opened it yet"}
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
