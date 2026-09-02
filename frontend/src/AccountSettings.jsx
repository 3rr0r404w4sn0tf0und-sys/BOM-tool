import React, { useEffect, useState } from "react";
import { API_URL, apiFetch } from "./api.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

function passwordRequirements(password) {
  return {
    length: password.length >= 8,
    uppercase: (password.match(/[A-Z]/g) || []).length >= 2,
    lowercase: (password.match(/[a-z]/g) || []).length >= 2,
    numbers: (password.match(/[0-9]/g) || []).length >= 2,
    symbols: (password.match(/[^A-Za-z0-9\s]/g) || []).length >= 2,
    bytes: new TextEncoder().encode(password).length <= 72,
  };
}

function PasswordRequirements({ theme, password }) {
  const r = passwordRequirements(password);
  const rows = [
    ["At least 8 characters", r.length],
    ["2 uppercase letters", r.uppercase],
    ["2 lowercase letters", r.lowercase],
    ["2 numbers", r.numbers],
    ["2 symbols", r.symbols],
    ["72 UTF-8 bytes or fewer", r.bytes],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", margin: "8px 0 14px", fontSize: 12 }}>
      {rows.map(([label, ok]) => (
        <span key={label} style={{ color: ok ? theme.okText : theme.subtleText }}>
          {ok ? "✓" : "○"} {label}
        </span>
      ))}
    </div>
  );
}

function Field({ theme, label, value, onChange, type = "text", placeholder, autoComplete }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 7 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{ width: "100%", boxSizing: "border-box", padding: 11, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text, fontSize: 14 }}
      />
    </label>
  );
}

function Notice({ theme, message }) {
  if (!message) return null;
  return <p style={{ color: message.ok ? theme.okText : theme.errText, fontSize: 13, margin: "4px 0 12px", lineHeight: 1.45 }}>{message.ok || message.error}</p>;
}

export default function AccountSettings({ theme, user, onBack, onUpdated, onLogout }) {
  const [username, setUsername] = useState(user?.username || "");
  const [available, setAvailable] = useState(null);
  const [checking, setChecking] = useState(false);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState(null);

  const hasPassword = !!user?.has_password;

  useEffect(() => {
    const value = username.trim();
    if (!USERNAME_RE.test(value)) { setAvailable(value ? false : null); return; }
    if (value.toLowerCase() === (user?.username || "").toLowerCase()) { setAvailable(true); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch(`${API_URL}/api/auth/username/check?username=${encodeURIComponent(value)}`, { credentials: "include" });
        const data = await r.json();
        if (!cancelled) setAvailable(data.available === true);
      } catch { if (!cancelled) setAvailable(null); }
      finally { if (!cancelled) setChecking(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [username, user?.username]);

  async function saveUsername() {
    const value = username.trim();
    setUsernameMessage(null);
    if (!USERNAME_RE.test(value)) return setUsernameMessage({ error: "Username must be 3–24 characters and use only letters, numbers, and underscores." });
    if (!available) return setUsernameMessage({ error: "That username is not available." });
    setUsernameSaving(true);
    try {
      const r = await apiFetch(`${API_URL}/api/auth/username`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: value }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not change username.");
      setUsernameMessage({ ok: "Username updated." });
      onUpdated(data.user);
    } catch (e) { setUsernameMessage({ error: e.message }); }
    finally { setUsernameSaving(false); }
  }

  async function requestEmailChange(e) {
    e.preventDefault();
    setEmailMessage(null);
    if (!newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) return setEmailMessage({ error: "Enter a valid email address." });
    if (hasPassword && !emailPassword) return setEmailMessage({ error: "Enter your current password to change your email." });
    setEmailSaving(true);
    try {
      const r = await apiFetch(`${API_URL}/api/auth/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), currentPassword: emailPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not start email change.");
      setEmailMessage({ ok: `Verification link sent to ${data.pendingEmail}. It expires in 24 hours.` });
      setNewEmail("");
      setEmailPassword("");
    } catch (e) { setEmailMessage({ error: e.message }); }
    finally { setEmailSaving(false); }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPasswordMessage(null);
    const reqs = passwordRequirements(newPassword);
    if (!reqs.length || !reqs.uppercase || !reqs.lowercase || !reqs.numbers || !reqs.symbols || !reqs.bytes) {
      return setPasswordMessage({ error: "Your new password does not meet all of the requirements." });
    }
    if (newPassword !== confirmNewPassword) return setPasswordMessage({ error: "New passwords do not match." });
    if (hasPassword && !currentPassword) return setPasswordMessage({ error: "Enter your current password." });
    setPasswordSaving(true);
    try {
      const r = await apiFetch(`${API_URL}/api/auth/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not change password.");
      setPasswordMessage({ ok: "Password changed. You have been signed out of all sessions." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTimeout(() => onLogout?.(), 900);
    } catch (e) { setPasswordMessage({ error: e.message }); }
    finally { setPasswordSaving(false); }
  }

  async function deleteAccount(e) {
    e.preventDefault();
    setDeleteMessage(null);
    if (deleteConfirmation !== "DELETE") return setDeleteMessage({ error: 'Type "DELETE" exactly to confirm.' });
    if (hasPassword && !deletePassword) return setDeleteMessage({ error: "Enter your current password." });
    if (!window.confirm("This permanently deletes your account and all BOMs you own. Continue?")) return;
    setDeleteSaving(true);
    try {
      const r = await apiFetch(`${API_URL}/api/auth/account`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE", currentPassword: deletePassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not delete your account.");
      onLogout?.();
    } catch (e) { setDeleteMessage({ error: e.message }); }
    finally { setDeleteSaving(false); }
  }

  const cardStyle = { background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: theme.shadow, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" };

  return (
    <div style={{ minHeight: "100vh", background: theme.pageBg || theme.bg, color: theme.text, fontFamily: "sans-serif", padding: "32px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: theme.muted, cursor: "pointer", padding: 0, marginBottom: 24 }}>← Back</button>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Account settings</h1>
        <p style={{ margin: "0 0 28px", color: theme.subtleText, fontSize: 14 }}>Manage your username, email address, password, and account.</p>

        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 16px", fontSize: 17 }}>Username</h2>
          <input value={username} maxLength={24} onChange={e => setUsername(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 11, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text, fontSize: 14 }} />
          <p style={{ minHeight: 20, fontSize: 12.5, margin: "7px 0 12px", color: checking ? theme.muted : available ? theme.okText : theme.errText }}>
            {checking ? "Checking availability…" : available === true ? "✓ Available" : available === false ? "Username unavailable or invalid" : "3–24 letters, numbers, or underscores"}
          </p>
          <Notice theme={theme} message={usernameMessage} />
          <button onClick={saveUsername} disabled={usernameSaving || checking || !available} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontWeight: 700, cursor: "pointer", opacity: usernameSaving || checking || !available ? .55 : 1 }}>{usernameSaving ? "Saving…" : "Save username"}</button>
        </div>

        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 5px", fontSize: 17 }}>Email address</h2>
          <p style={{ margin: "0 0 16px", color: theme.subtleText, fontSize: 13 }}>Current email: <strong>{user?.email}</strong>. A new address is not applied until you verify it.</p>
          <form onSubmit={requestEmailChange}>
            <Field theme={theme} label="New email" value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" autoComplete="email" placeholder="new@example.com" />
            {hasPassword && <Field theme={theme} label="Current password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} type="password" autoComplete="current-password" />}
            {!hasPassword && <p style={{ color: theme.subtleText, fontSize: 12.5 }}>Set a password first before changing your email address.</p>}
            <Notice theme={theme} message={emailMessage} />
            <button type="submit" disabled={emailSaving || !hasPassword} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontWeight: 700, opacity: emailSaving || !hasPassword ? .55 : 1 }}>{emailSaving ? "Sending…" : "Send verification link"}</button>
          </form>
        </div>

        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 5px", fontSize: 17 }}>{hasPassword ? "Change password" : "Set a password"}</h2>
          <p style={{ margin: "0 0 14px", color: theme.subtleText, fontSize: 13 }}>Use a password with at least 2 uppercase letters, 2 lowercase letters, 2 numbers, and 2 symbols.</p>
          <form onSubmit={changePassword}>
            {hasPassword && <Field theme={theme} label="Current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} type="password" autoComplete="current-password" />}
            <Field theme={theme} label="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" autoComplete="new-password" />
            <PasswordRequirements theme={theme} password={newPassword} />
            <Field theme={theme} label="Confirm new password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} type="password" autoComplete="new-password" />
            <Notice theme={theme} message={passwordMessage} />
            <button type="submit" disabled={passwordSaving} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontWeight: 700, opacity: passwordSaving ? .55 : 1 }}>{passwordSaving ? "Saving…" : hasPassword ? "Change password" : "Set password"}</button>
          </form>
        </div>

        <div style={{ ...cardStyle, borderColor: theme.errText }}>
          <h2 style={{ margin: "0 0 5px", fontSize: 17, color: theme.errText }}>Delete account</h2>
          <p style={{ margin: "0 0 16px", color: theme.subtleText, fontSize: 13, lineHeight: 1.5 }}>This permanently deletes your account and every BOM you own. This cannot be undone.</p>
          <form onSubmit={deleteAccount}>
            {hasPassword && <Field theme={theme} label="Current password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} type="password" autoComplete="current-password" />}
            <Field theme={theme} label='Type "DELETE" to confirm' value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} placeholder="DELETE" />
            <Notice theme={theme} message={deleteMessage} />
            <button type="submit" disabled={deleteSaving || deleteConfirmation !== "DELETE"} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: theme.errText, color: "#fff", fontWeight: 700, opacity: deleteSaving || deleteConfirmation !== "DELETE" ? .55 : 1 }}>{deleteSaving ? "Deleting…" : "Delete account permanently"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
