import React, { useState, useEffect } from "react";
import Footer from "./Footer.jsx";
import PrivacyModal from "./PrivacyModal.jsx";
import SettingsMenu from "./SettingsMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import SectionTable from "./SectionTable.jsx";
import ThemeTransition from "./ThemeTransition.jsx";
import WakingUp from "./WakingUp.jsx";
import { IconWarning, IconEnvelope, IconCoin, IconPlus, IconTable, IconArrowLeft, IconFolder, IconTrash, IconPencil, IconPlug } from "./Icons.jsx";
import { getInitialThemeName, persistThemeName, getTheme } from "./theme.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVACY_SEEN_KEY = "bom-tool-privacy-seen";
const VERIFY_PENDING_SECONDS = 15;
const TOKEN_STORAGE_KEY = "bom-tool-token";

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
  const [themeTransitionMode, setThemeTransitionMode] = useState(null); // null | "blastoff" | "landing"
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [justRegisteredEmail, setJustRegisteredEmail] = useState(null);
  const [verifyCountdown, setVerifyCountdown] = useState(VERIFY_PENDING_SECONDS);
  const [authChecking, setAuthChecking] = useState(true);
  const [canvasMenu, setCanvasMenu] = useState(null);
  const [bomList, setBomList] = useState(null); // null = not loaded yet, [] = loaded/empty
  const [bomListLoading, setBomListLoading] = useState(false);
  const [openingBomId, setOpeningBomId] = useState(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showApiModal, setShowApiModal] = useState(false);
  const theme = getTheme(themeName);

  function persistToken(t) {
    try {
      if (t) window.localStorage.setItem(TOKEN_STORAGE_KEY, t);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // localStorage unavailable — session just won't survive a refresh
    }
  }

  function setSession(t, u) {
    setToken(t);
    setUser(u);
    persistToken(t);
  }

  function toggleTheme() {
    setThemeName((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      persistThemeName(next);
      // Overlay covers the swap below (blastoff = heading INTO dark,
      // landing = heading INTO light) then fades itself out once painted.
      setThemeTransitionMode(next === "dark" ? "blastoff" : "landing");
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
    setBomList(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    persistToken(null);
  }

  // On load, try to restore a session from a previously-saved token before
  // rendering the login screen, so a refresh doesn't sign people out.
  useEffect(() => {
    let cancelled = false;
    let stored = null;
    try {
      stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
    if (!stored) {
      setAuthChecking(false);
      return;
    }
    setToken(stored);
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((r) => {
        if (!r.ok) throw new Error("invalid session");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.user) {
          setUser(data.user);
        } else {
          setToken(null);
          persistToken(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Stored token is stale/invalid — clear it and fall back to login.
        setToken(null);
        persistToken(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On load, check for ?verify_token= (link from verification email) or
  // ?oauth_token=/?oauth_error= (redirect back from Google/GitHub) in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify_token");
    const oauthToken = params.get("oauth_token");
    const oauthError = params.get("oauth_error");

    if (oauthToken) {
      setSession(oauthToken, null);
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

  // Live (as-you-type) mismatch check, distinct from clientValidate()'s
  // on-submit check -- only flags once confirmPassword has content, so the
  // field doesn't turn red before the user's typed anything into it yet.
  const passwordsMismatch = mode === "register" && confirmPassword.length > 0 && password !== confirmPassword;
  const registerDisabled =
    authLoading || !email || !password || (mode === "register" && (!confirmPassword || passwordsMismatch));

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
        setSession(data.token, data.user);
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
        setSession(data.token, data.user);
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

  async function createBom(title) {
    const res = await fetch(`${API_URL}/api/boms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: title || "Untitled BOM" }),
    });
    const data = await res.json();
    setBomList(null);
    loadBom(data.id);
  }

  async function loadBom(id) {
    setOpeningBomId(id);
    const res = await fetch(`${API_URL}/api/boms/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setBom(await res.json());
    setOpeningBomId(null);
  }

  async function loadBomList() {
    setBomListLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/boms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBomList(await res.json());
    } finally {
      setBomListLoading(false);
    }
  }

  function exitBom() {
    setBom(null);
    loadBomList();
  }

  async function renameBom() {
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!next || next === bom.title) return;
    await fetch(`${API_URL}/api/boms/${bom.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: next }),
    });
    setBomList(null);
    loadBom(bom.id);
  }

  async function deleteBom(id) {
    await fetch(`${API_URL}/api/boms/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    loadBomList();
  }

  async function addTable() {
    if (!bom) return;
    await fetch(`${API_URL}/api/boms/${bom.id}/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "New Table", sort_order: bom.sections.length }),
    });
    loadBom(bom.id);
  }

  // Load the BOM list once we know who's logged in and haven't opened a BOM.
  useEffect(() => {
    if (token && user && !bom && bomList === null) loadBomList();
  }, [token, user, bom, bomList]);

  const pageShell = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: theme.bg,
    fontFamily: "sans-serif",
  };

  if (authChecking) {
    return (
      <div style={{ ...pageShell, alignItems: "center", justifyContent: "center" }}>
        <WakingUp theme={theme} />
      </div>
    );
  }

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
            <div style={{ fontSize: 34, marginBottom: 10, display: "flex", justifyContent: "center" }}>
              <IconEnvelope size={34} color={theme.text} />
            </div>
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
        {themeTransitionMode && (
          <ThemeTransition mode={themeTransitionMode} onDone={() => setThemeTransitionMode(null)} />
        )}
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
                  style={{
                    width: "100%", padding: 10, marginBottom: passwordsMismatch ? 4 : 8, boxSizing: "border-box",
                    border: `1px solid ${passwordsMismatch ? theme.errText : theme.border}`, borderRadius: 8,
                    fontSize: 14, background: theme.bg, color: theme.text,
                  }}
                />
              )}
              {passwordsMismatch && (
                <p style={{ color: theme.errText, fontSize: 12.5, margin: "0 0 8px" }}>Passwords don't match</p>
              )}

              <button
                onClick={mode === "login" ? login : register}
                disabled={registerDisabled}
                style={{
                  width: "100%", padding: 11, marginTop: 4, cursor: registerDisabled ? "default" : "pointer",
                  border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontSize: 14, fontWeight: 600,
                  opacity: registerDisabled ? 0.5 : 1,
                }}
              >
                {authLoading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </button>

              {authError && (
                <p style={{ color: theme.errText, fontSize: 13, marginTop: 10 }}>{authError}</p>
              )}

              {authLoading && <WakingUp theme={theme} />}
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
      {themeTransitionMode && (
        <ThemeTransition mode={themeTransitionMode} onDone={() => setThemeTransitionMode(null)} />
      )}
      <div
        style={{ fontFamily: "sans-serif", padding: "32px 40px 60px", flex: 1, color: theme.text, maxWidth: 980, margin: "0 auto", width: "100%", boxSizing: "border-box" }}
        onContextMenu={(e) => {
          // Blank-canvas right click -> "Add table". Clicks inside a
          // SectionTable stop propagation and show their own menu instead.
          e.preventDefault();
          if (!bom) return;
          setCanvasMenu({
            x: e.clientX,
            y: e.clientY,
            items: [{ label: "Add table", icon: IconTable, onClick: addTable }],
          });
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ color: theme.text, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>BOM Tool</h1>
          <SettingsMenu
            theme={theme}
            themeName={themeName}
            onToggleTheme={toggleTheme}
            isLoggedIn={true}
            onLogout={logout}
          />
        </div>

        <style>{`
          @keyframes bom-spin { to { transform: rotate(360deg); } }
          @keyframes bom-view-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          .bom-view-enter { animation: bom-view-enter 220ms ease-out; }
        `}</style>

        {user && !user.email_verified && (
          <div style={{ background: theme.warnBg, color: theme.warnText, padding: "10px 14px", borderRadius: 10, marginBottom: 20, fontSize: 13.5, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ flexShrink: 0, marginTop: 2 }}><IconEnvelope size={15} color={theme.warnText} /></span>
            <span>
              Please verify your email ({user.email}) — check your inbox
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
            </span>
          </div>
        )}

        {!bom && (
          <div key="bom-list" className="bom-view-enter">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.text }}>Your BOMs</h2>
              <button
                onClick={() => createBom("Untitled BOM")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", border: "none", borderRadius: 9,
                  background: theme.accent, color: theme.accentText, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                }}
              >
                <IconPlus size={14} /> New BOM
              </button>
            </div>

            {bomListLoading && (
              <p style={{ color: theme.muted, fontSize: 13.5, textAlign: "center", padding: "24px 0" }}>Loading…</p>
            )}

            {!bomListLoading && bomList && bomList.length === 0 && (
              <div
                style={{
                  background: theme.cardBg,
                  border: `1px dashed ${theme.border}`,
                  borderRadius: 14,
                  padding: "48px 24px",
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, color: theme.muted }}>
                  <IconTable size={30} color={theme.muted} />
                </div>
                <p style={{ color: theme.subtleText, fontSize: 14, margin: "0 0 18px" }}>
                  You don't have a BOM yet — create one to start adding tables and items.
                </p>
                <button
                  onClick={() => createBom("My First BOM")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "10px 18px", border: "none", borderRadius: 9,
                    background: theme.accent, color: theme.accentText, fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlus size={15} /> Create a BOM
                </button>
              </div>
            )}

            {!bomListLoading && bomList && bomList.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bomList.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <button
                      onClick={() => loadBom(b.id)}
                      disabled={openingBomId === b.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, border: "none", background: "none",
                        cursor: openingBomId === b.id ? "default" : "pointer", fontSize: 14, fontWeight: 600,
                        color: theme.text, textAlign: "left", flex: 1,
                        opacity: openingBomId && openingBomId !== b.id ? 0.45 : 1,
                        transition: "opacity 150ms ease",
                      }}
                    >
                      {openingBomId === b.id ? (
                        <span
                          style={{
                            width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                            border: `2px solid ${theme.border}`, borderTopColor: theme.text,
                            animation: "bom-spin 0.6s linear infinite",
                          }}
                        />
                      ) : (
                        <IconFolder size={16} color={theme.muted} />
                      )}
                      {b.title}
                    </button>
                    <button
                      onClick={() => deleteBom(b.id)}
                      title="Delete BOM"
                      style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: theme.muted }}
                    >
                      <IconTrash size={14} color={theme.muted} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {bom && (
          <div key={`bom-detail-${bom.id}`} className="bom-view-enter">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <button
                  onClick={exitBom}
                  title="Back to your BOMs"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, flexShrink: 0, border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, cursor: "pointer",
                  }}
                >
                  <IconArrowLeft size={14} color={theme.text} />
                </button>

                {titleEditing ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={renameBom}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    style={{
                      fontSize: 18, fontWeight: 700, border: `1px solid ${theme.accent}`, borderRadius: 6,
                      padding: "4px 8px", background: theme.cardBg, color: theme.text, minWidth: 0,
                    }}
                  />
                ) : (
                  <button
                    onClick={() => { setTitleDraft(bom.title); setTitleEditing(true); }}
                    title="Rename BOM"
                    style={{
                      display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer",
                      fontSize: 18, fontWeight: 700, color: theme.text, padding: "4px 6px", borderRadius: 6, minWidth: 0,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bom.title}</span>
                    <IconPencil size={12} color={theme.muted} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setShowApiModal(true)}
                  title="API access"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlug size={13} /> API
                </button>
                <button
                  onClick={addTable}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlus size={13} /> Add table
                </button>
              </div>
            </div>

            {showApiModal && <ApiModal bom={bom} theme={theme} onClose={() => setShowApiModal(false)} />}

            {bom.totals.staleCount > 0 && (
              <p style={{ color: theme.warnText, background: theme.warnBg, padding: "8px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconWarning size={15} color={theme.warnText} /></span>
                <span>
                  {bom.totals.staleCount} Amazon item(s) couldn't be refreshed automatically —
                  showing their last known price. Use "Solve CAPTCHA" on the row to update them.
                </span>
              </p>
            )}

            {bom.totals.excludedCount > 0 && (
              <p style={{ color: theme.warnText, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconWarning size={15} color={theme.warnText} /></span>
                <span>{bom.totals.excludedCount} item(s) excluded (link failed) — fix links to include in total.</span>
              </p>
            )}

            {bom.sections.length === 0 && (
              <p style={{ color: theme.muted, fontSize: 13.5, textAlign: "center", padding: "30px 0" }}>
                No tables yet — right-click anywhere, or use "Add table" above.
              </p>
            )}

            {bom.sections.map((section) => (
              <SectionTable
                key={section.id}
                section={section}
                theme={theme}
                token={token}
                onChange={() => loadBom(bom.id)}
              />
            ))}

            <div
              style={{
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: "16px 18px",
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxWidth: 280,
                marginLeft: "auto",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5, color: theme.subtleText }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><IconCoin size={14} color={theme.subtleText} /> Subtotal</span>
                <span>${bom.totals.subtotal.toFixed(2)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5, color: theme.subtleText }}>
                <span>Tax</span>
                <span>${bom.totals.tax.toFixed(2)}</span>
              </span>
              <span style={{ height: 1, background: theme.border, margin: "4px 0" }} />
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 16, fontWeight: 700, color: theme.text }}>
                <span>Total</span>
                <span>${bom.totals.total.toFixed(2)}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      <ContextMenu menu={canvasMenu} theme={theme} onClose={() => setCanvasMenu(null)} />
      <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
      {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
