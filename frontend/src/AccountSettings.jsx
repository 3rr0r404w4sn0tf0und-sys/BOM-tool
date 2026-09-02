import React, { useEffect, useState } from "react";
import { API_URL, apiFetch } from "./api.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

export default function AccountSettings({ theme, user, onBack, onUpdated }) {
  const [username, setUsername] = useState(user?.username || "");
  const [available, setAvailable] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

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

  async function save() {
    const value = username.trim();
    setMessage(null);
    if (!USERNAME_RE.test(value)) return setMessage({ error: "Username must be 3–24 characters and use only letters, numbers, and underscores." });
    if (!available) return setMessage({ error: "That username is not available." });
    setSaving(true);
    try {
      const r = await apiFetch(`${API_URL}/api/auth/username`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: value }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not change username.");
      setMessage({ ok: "Username updated." });
      onUpdated(data.user);
    } catch (e) { setMessage({ error: e.message }); }
    finally { setSaving(false); }
  }

  return <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: "sans-serif", padding: "32px 40px", boxSizing: "border-box" }}>
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <button onClick={onBack} style={{ border: "none", background: "none", color: theme.muted, cursor: "pointer", padding: 0, marginBottom: 24 }}>← Back</button>
      <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Account settings</h1>
      <p style={{ margin: "0 0 28px", color: theme.subtleText, fontSize: 14 }}>Manage the public username associated with your account.</p>
      <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 24 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Username</label>
        <input value={username} maxLength={24} onChange={e => setUsername(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 11, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text, fontSize: 14 }} />
        <p style={{ minHeight: 20, fontSize: 12.5, margin: "7px 0 12px", color: checking ? theme.muted : available ? theme.okText : theme.errText }}>
          {checking ? "Checking availability…" : available === true ? "✓ Available" : available === false ? "Username unavailable or invalid" : "3–24 letters, numbers, or underscores"}
        </p>
        {message && <p style={{ color: message.ok ? theme.okText : theme.errText, fontSize: 13 }}>{message.ok || message.error}</p>}
        <button onClick={save} disabled={saving || checking || !available} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontWeight: 700, cursor: "pointer", opacity: saving || checking || !available ? .55 : 1 }}>{saving ? "Saving…" : "Save username"}</button>
      </div>
    </div>
  </div>;
}
