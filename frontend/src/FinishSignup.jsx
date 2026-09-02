import React, { useEffect, useState } from "react";
import { API_URL, apiFetch } from "./api.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

export default function FinishSignup({ theme, user, onboardingToken, onComplete, modal = false }) {
  const [username, setUsername] = useState(user?.username || "");
  const [availability, setAvailability] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const value = username.trim();
    if (!USERNAME_RE.test(value)) {
      setAvailability(value ? { available: false, error: "Use 3–24 letters, numbers, or underscores." } : null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch(`${API_URL}/api/auth/username/check?username=${encodeURIComponent(value)}`, { credentials: "include" });
        const data = await res.json();
        if (!cancelled) setAvailability(data);
      } catch {
        if (!cancelled) setAvailability({ available: null, error: "Could not check username availability." });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [username]);

  async function submit(e) {
    e.preventDefault();
    const value = username.trim();
    setError(null);
    if (!USERNAME_RE.test(value)) return setError("Username must be 3–24 characters and use only letters, numbers, and underscores.");
    if (availability && availability.available === false) return setError(availability.error || "That username is already taken.");
    setSaving(true);
    try {
      const res = await apiFetch(
        onboardingToken ? `${API_URL}/api/auth/complete-profile` : `${API_URL}/api/auth/username`,
        {
          method: onboardingToken ? "POST" : "PATCH",
          skipCsrf: !!onboardingToken,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(onboardingToken ? { username: value, onboardingToken } : { username: value }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not finish account setup.");
      if (data.csrfToken) {
        const { setCsrfToken } = await import("./api.js");
        setCsrfToken(data.csrfToken);
      }
      onComplete(data.user);
    } catch (e) {
      setError(e.message || "Could not finish account setup.");
    } finally {
      setSaving(false);
    }
  }

  const card = (
    <div style={{ width: 420, maxWidth: "calc(100vw - 32px)", background: theme.cardBg, color: theme.text, borderRadius: 14, padding: 30, boxShadow: "0 12px 40px rgba(0,0,0,.18)" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 21 }}>Finish signing up</h2>
      <p style={{ margin: "0 0 22px", color: theme.subtleText, fontSize: 14, lineHeight: 1.55 }}>
        Your email is verified. Choose a username to finish setting up your BOM Tool account.
      </p>
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 7 }}>Username</label>
        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={24}
          autoComplete="username"
          placeholder="e.g. engineering_nerd"
          style={{ width: "100%", boxSizing: "border-box", padding: 11, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text, fontSize: 14 }}
        />
        <div style={{ minHeight: 20, marginTop: 7, fontSize: 12.5 }}>
          {checking && <span style={{ color: theme.muted }}>Checking availability…</span>}
          {!checking && availability?.available === true && <span style={{ color: theme.okText }}>✓ Username is available</span>}
          {!checking && availability?.available === false && <span style={{ color: theme.errText }}>{availability.error || "Username is unavailable"}</span>}
        </div>
        {error && <p style={{ color: theme.errText, fontSize: 13, margin: "4px 0 10px" }}>{error}</p>}
        <button disabled={saving || checking || availability?.available !== true} style={{ width: "100%", marginTop: 10, padding: 11, border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving || checking || availability?.available !== true ? .55 : 1 }}>
          {saving ? "Finishing setup…" : "Finish setup"}
        </button>
      </form>
    </div>
  );

  if (!modal) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: theme.bg }}>{card}</div>;
  return <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>{card}</div>;
}
