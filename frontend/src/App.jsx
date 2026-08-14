import React, { useState } from "react";
import CaptchaSolver from "./CaptchaSolver.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// This is a minimal scaffold, not the full editor yet. It proves the
// API round-trip (login -> create BOM -> fetch totals) so the rest of
// the UI (rich text rows, emoji section titles, drag to reorder, etc.)
// can be built against a known-working backend.

export default function App() {
  const [token, setToken] = useState(null);
  const [bom, setBom] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  async function login() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.token) setToken(data.token);
      else setAuthError(data.error || "Login failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function register() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.token) setToken(data.token);
      else setAuthError(data.error || "Registration failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
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

  if (!token) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: 40, maxWidth: 320 }}>
        <h2>BOM Tool</h2>

        <div style={{ display: "flex", marginBottom: 16, borderBottom: "1px solid #ddd" }}>
          <button
            onClick={() => { setMode("login"); setAuthError(null); }}
            style={{
              flex: 1, padding: 8, border: "none", cursor: "pointer",
              background: "transparent",
              fontWeight: mode === "login" ? "bold" : "normal",
              borderBottom: mode === "login" ? "2px solid #333" : "2px solid transparent",
            }}
          >
            Log in
          </button>
          <button
            onClick={() => { setMode("register"); setAuthError(null); }}
            style={{
              flex: 1, padding: 8, border: "none", cursor: "pointer",
              background: "transparent",
              fontWeight: mode === "register" ? "bold" : "normal",
              borderBottom: mode === "register" ? "2px solid #333" : "2px solid transparent",
            }}
          >
            Register
          </button>
        </div>

        <input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
        />

        <button
          onClick={mode === "login" ? login : register}
          disabled={authLoading || !email || !password}
          style={{ width: "100%", padding: 10, cursor: "pointer" }}
        >
          {authLoading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>

        {authError && (
          <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{authError}</p>
        )}

        {authLoading && (
          <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
            First request can take 30-50s if the server was asleep.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 40 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>BOM Tool</h2>
        <button onClick={() => { setToken(null); setBom(null); setEmail(""); setPassword(""); }}>
          Log out
        </button>
      </div>
      {!bom && <button onClick={createBom}>Create a BOM</button>}

      {bom && (
        <div>
          <h3>{bom.title}</h3>

          {bom.totals.staleCount > 0 && (
            <p style={{ color: "#b45309", background: "#fef3c7", padding: 8, borderRadius: 6 }}>
              ⚠️ {bom.totals.staleCount} Amazon item(s) couldn't be refreshed automatically —
              showing their last known price. Use "Solve CAPTCHA" below to update them.
            </p>
          )}

          {bom.totals.excludedCount > 0 && (
            <p style={{ color: "#b45309" }}>
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
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {item.name} — qty {item.qty} —{" "}
                  {item.status === "ok"
                    ? `$${Number(item.unit_price).toFixed(2)}`
                    : "⚠️ Link Failed"}
                  {item.stale_price && (
                    <span style={{ color: "#b45309", fontSize: 12 }}> (stale price)</span>
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

      <footer style={{ marginTop: 60, fontSize: 12, color: "#999" }}>
        Powered by{" "}
        <a href="https://example.com" style={{ color: "#999" }}>
          BOM Tool
        </a>
      </footer>
    </div>
  );
}
