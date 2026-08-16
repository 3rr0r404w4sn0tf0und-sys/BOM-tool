import React, { useState, useEffect } from "react";
import CaptchaSolver from "./CaptchaSolver.jsx";
import Footer from "./Footer.jsx";
import PrivacyModal from "./PrivacyModal.jsx";
import SettingsMenu from "./SettingsMenu.jsx";
import { getInitialThemeName, persistThemeName, getTheme } from "./theme.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVACY_SEEN_KEY = "bom-tool-privacy-seen";
const VERIFY_PENDING_SECONDS = 15;

// This is a minimal scaffold, not the full editor yet. It proves the
// API round-trip (login -> create BOM -> fetch totals) so the rest of
// the UI (rich text rows, emoji section titles, drag to reorder, etc.)
// can be built against a known-working backend.

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [bom, setBom] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState(null); // null | "checking" | "success" | "error"
  const [verifyMessage, setVerifyMessage] = useState(null);
  const [resendStatus, setResendStatus] = useState(null); // null | "sending" | "sent" | "error"

  const [themeName, setThemeName] = useState(getInitialThemeName);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [justRegisteredEmail, setJustRegisteredEmail] = useState(null);
  const [verifyCountdown, setVerifyCountdown] = useState(VERIFY_PENDING_SECONDS);
  const theme = getTheme(themeName);

  function toggleTheme() {
    setThemeName((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      persistThemeName(next);
      return next;
    });
  }

  // Keep the actual page background (outside our themed containers) in sync,
  // so there's no white/mismatched edge around the app on load or overscroll.
  useEffect(() => {
    document.body.style.background = theme.bg;
    document.documentElement.style.background = theme.bg;
  }, [theme.bg]);

  // Show the privacy notice once, automatically, on a person's first visit.
  // It stays reachable afterward via the footer link regardless.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(PRIVACY_SEEN_KEY)) {
        setShowPrivacy(true);
        window.localStorage.setItem(PRIVACY_SEEN_KEY, "1");
      }
    } catch {
      // localStorage unavailable — just skip the auto-popup, footer link still works
    }
  }, []);

  // Countdown + auto-close for the "verification email sent" interstitial
  // shown right after registering (Brevo sends a link, not a code, so there's
  // nothing to type here — the tab is safe to close).
  useEffect(() => {
    if (!justRegisteredEmail) return;
    setVerifyCountdown(VERIFY_PENDING_SECONDS);
    const interval = setInterval(() => {
      setVerifyCountdown((s) => {
        if (s <= 1) {
          clearInterval(interval);
          window.close();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [justRegisteredEmail]);

  function logout() {
    setToken(null);
    setUser(null);
    setBom(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  }

  // On load, check for ?verify_token= (link from verification email) or
  // ?oauth_token=/?oauth_error= (redirect back from Google/GitHub) in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify_token");
    const oauthToken = params.get("oauth_token");
    const oauthError = params.get("oauth_error");

    if (oauthToken) {
      setToken(oauthToken);
      fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${oauthToken}` } })
        .then((r) => r.json())
        .then((data) => {
          if (data.user) setUser(data.user);
        })
        .catch(() => {});
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (oauthError) {
      setAuthError(oauthError);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (!verifyToken) return;

    setVerifyStatus("checking");
    fetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.verified) {
          setVerifyStatus("success");
          setVerifyMessage("Email verified! You can log in now.");
          setUser((u) => (u ? { ...u, email_verified: true } : u));
        } else {
          setVerifyStatus("error");
          setVerifyMessage(data.error || "Verification failed.");
        }
        // Clean the token out of the URL so refreshing doesn't re-submit it.
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        setVerifyStatus("error");
        setVerifyMessage("Could not reach the server to verify. Try again.");
      });
  }, []);

  function loginWithGithub() {
    window.location.href = `${API_URL}/api/auth/github/start`;
  }

  function clientValidate() {
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (mode === "register" && password !== confirmPassword) return "Passwords don't match";
    return null;
  }

  async function login() {
    const validationError = clientValidate();
    if (validationError) return setAuthError(validationError);

    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setUser(data.user);
      } else setAuthError(data.error || "Login failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function register() {
    const validationError = clientValidate();
    if (validationError) return setAuthError(validationError);

    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setUser(data.user);
        setJustRegisteredEmail(email.trim());
      } else setAuthError(data.error || "Registration failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function resendVerification() {
    setResendStatus("sending");
    try {
      const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResendStatus(data.sent ? "sent" : "error");
    } catch {
      setResendStatus("error");
    }
  }

  async function createBom() {
    const res = await fetch(`${API_URL}/api/boms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: "My First BOM" }),
    });
    const data = await res.json();
    loadBom(data.id);
  }

  async function loadBom(id) {
    const res = await fetch(`${API_URL}/api/boms/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setBom(await res.json());
  }

  const pageShell = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: theme.bg,
    fontFamily: "sans-serif",
  };

  if (justRegisteredEmail) {
    return (
      <div style={pageShell}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
          <div
            style={{
              width: 360,
              maxWidth: "100%",
              background: theme.cardBg,
              color: theme.text,
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>📬</div>
            <h2 style={{ margin: "0 0 10px" }}>Verification email sent</h2>
            <p style={{ color: theme.subtleText, fontSize: 14, lineHeight: 1.6, margin: "0 0 6px" }}>
              We sent a verification link to <strong>{justRegisteredEmail}</strong>.
            </p>
            <p style={{ color: theme.subtleText, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
              Check your inbox <strong>and your spam/junk folder</strong> — click the link there to verify.
            </p>
            <p style={{ color: theme.muted, fontSize: 13 }}>
              This tab will close automatically in {verifyCountdown}s.
            </p>
            <button
              onClick={() => window.close()}
              style={{
                marginTop: 14, padding: "8px 16px", cursor: "pointer",
                border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.cardBg, color: theme.text, fontSize: 13,
              }}
            >
              Close now
            </button>
          </div>
        </div>
        <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
        {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  if (!token) {
    return (
      <div style={pageShell}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
          <div style={{ width: 340, maxWidth: "100%", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <SettingsMenu
                theme={theme}
                themeName={themeName}
                onToggleTheme={toggleTheme}
                isLoggedIn={false}
                onLogout={logout}
              />
            </div>

            <div style={{ background: theme.cardBg, borderRadius: 12, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <h2 style={{ margin: "0 0 20px", textAlign: "center", color: theme.text }}>BOM Tool</h2>

              {verifyStatus && (
                <p
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 16,
                    background: verifyStatus === "success" ? theme.okBg : verifyStatus === "error" ? theme.errBg : theme.border,
                    color: verifyStatus === "success" ? theme.okText : verifyStatus === "error" ? theme.errText : theme.subtleText,
                  }}
                >
                  {verifyStatus === "checking" ? "Verifying your email…" : verifyMessage}
                </p>
              )}

              <div style={{ display: "flex", marginBottom: 20, borderBottom: `1px solid ${theme.border}` }}>
                <button
                  onClick={() => { setMode("login"); setAuthError(null); }}
                  style={{
                    flex: 1, padding: 10, border: "none", cursor: "pointer",
                    background: "transparent",
                    fontWeight: mode === "login" ? 600 : 400,
                    color: mode === "login" ? theme.text : theme.muted,
                    borderBottom: mode === "login" ? `2px solid ${theme.text}` : "2px solid transparent",
                    fontSize: 14,
                  }}
                >
                  Log in
                </button>
                <button
                  onClick={() => { setMode("register"); setAuthError(null); }}
                  style={{
                    flex: 1, padding: 10, border: "none", cursor: "pointer",
                    background: "transparent",
                    fontWeight: mode === "register" ? 600 : 400,
                    color: mode === "register" ? theme.text : theme.muted,
                    borderBottom: mode === "register" ? `2px solid ${theme.text}` : "2px solid transparent",
                    fontSize: 14,
                  }}
                >
                  Register
                </button>
              </div>

              <button
                onClick={loginWithGithub}
                style={{
                  width: "100%", padding: 10, marginBottom: 20, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.cardBg, color: theme.text, fontSize: 14,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={theme.text}>
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
                </svg>
                Continue with GitHub
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", color: theme.muted, fontSize: 12 }}>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
                or with email
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>

              <input
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, background: theme.bg, color: theme.text }}
              />
              <input
                placeholder="password (min 8 characters)"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, background: theme.bg, color: theme.text }}
              />
              {mode === "register" && (
                <input
                  placeholder="confirm password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, background: theme.bg, color: theme.text }}
                />
              )}

              <button
                onClick={mode === "login" ? login : register}
                disabled={authLoading || !email || !password || (mode === "register" && !confirmPassword)}
                style={{
                  width: "100%", padding: 11, marginTop: 4, cursor: "pointer",
                  border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontSize: 14, fontWeight: 600,
                  opacity: authLoading || !email || !password || (mode === "register" && !confirmPassword) ? 0.5 : 1,
                }}
              >
                {authLoading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </button>

              {authError && (
                <p style={{ color: theme.errText, fontSize: 13, marginTop: 10 }}>{authError}</p>
              )}

              {authLoading && (
                <p style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>
                  First request can take 30-50s if the server was asleep.
                </p>
              )}
            </div>
          </div>
        </div>

        <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
        {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  return (
    <div style={pageShell}>
      <div style={{ fontFamily: "sans-serif", padding: 40, flex: 1, color: theme.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ color: theme.text }}>BOM Tool</h2>
          <SettingsMenu
            theme={theme}
            themeName={themeName}
            onToggleTheme={toggleTheme}
            isLoggedIn={true}
            onLogout={logout}
          />
        </div>

        {user && !user.email_verified && (
          <div style={{ background: theme.warnBg, color: theme.warnText, padding: 10, borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
            📧 Please verify your email ({user.email}) — check your inbox
            <strong> and spam/junk folder</strong> for the link (first emails from a new sender often land there).
            {" "}
            <button
              onClick={resendVerification}
              disabled={resendStatus === "sending"}
              style={{ marginLeft: 4, cursor: "pointer", border: "none", background: "none", color: theme.warnText, textDecoration: "underline" }}
            >
              {resendStatus === "sending" ? "Sending…" : resendStatus === "sent" ? "Sent! Check spam too." : "Resend email"}
            </button>
            {resendStatus === "error" && <span style={{ marginLeft: 6 }}>Failed to send — try again shortly.</span>}
          </div>
        )}

        {!bom && <button onClick={createBom}>Create a BOM</button>}

        {bom && (
          <div>
            <h3>{bom.title}</h3>

            {bom.totals.staleCount > 0 && (
              <p style={{ color: theme.warnText, background: theme.warnBg, padding: 8, borderRadius: 6 }}>
                ⚠️ {bom.totals.staleCount} Amazon item(s) couldn't be refreshed automatically —
                showing their last known price. Use "Solve CAPTCHA" below to update them.
              </p>
            )}

            {bom.totals.excludedCount > 0 && (
              <p style={{ color: theme.warnText }}>
                ⚠️ {bom.totals.excludedCount} item(s) excluded (link failed) — fix links to include in total.
              </p>
            )}

            {bom.sections.map((section) => (
              <div key={section.id} style={{ marginBottom: 20 }}>
                <h4>{section.emoji} {section.title}</h4>
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      fontSize: item.font_size || 19,
                      fontWeight: item.bold ? "bold" : "normal",
                      fontStyle: item.italic ? "italic" : "normal",
                      padding: "6px 0",
                      borderBottom: `1px solid ${theme.rowBorder}`,
                    }}
                  >
                    {item.name} — qty {item.qty} —{" "}
                    {item.status === "ok"
                      ? `$${Number(item.unit_price).toFixed(2)}`
                      : "⚠️ Link Failed"}
                    {item.stale_price && (
                      <span style={{ color: theme.warnText, fontSize: 12 }}> (stale price)</span>
                    )}
                    {item.stale_price && (
                      <div>
                        <CaptchaSolver item={item} token={token} onResolved={() => loadBom(bom.id)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* TODO: add section/item creation UI, rich text controls, emoji picker,
                tax rate input, drag-to-reorder. This proves totals + captcha flow render correctly. */}
            <div style={{ fontSize: 19, marginTop: 20 }}>
              💰 Subtotal: ${bom.totals.subtotal.toFixed(2)}
              <br />
              Tax: ${bom.totals.tax.toFixed(2)}
              <br />
              <strong>Total: ${bom.totals.total.toFixed(2)}</strong>
            </div>
          </div>
        )}
      </div>

      <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
      {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
