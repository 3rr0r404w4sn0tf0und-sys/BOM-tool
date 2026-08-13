import React, { useState } from "react";

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

  async function login() {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.token) setToken(data.token);
    else alert(data.error || "Login failed");
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
        <h2>BOM Tool — login</h2>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <br />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <br />
        <button onClick={login}>Log in</button>
        <p style={{ fontSize: 12, color: "#888" }}>
          (No register UI yet — POST to /api/auth/register to create a test user.)
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 40 }}>
      <h2>BOM Tool</h2>
      {!bom && <button onClick={createBom}>Create a BOM</button>}

      {bom && (
        <div>
          <h3>{bom.title}</h3>
          {/* TODO: sections, emoji picker, rich text rows, add/remove rows,
              tax rate input. This is just proving totals render correctly. */}
          {bom.totals.excludedCount > 0 && (
            <p style={{ color: "#b45309" }}>
              ⚠️ {bom.totals.excludedCount} item(s) excluded (link failed) — fix links to include in total.
            </p>
          )}
          <div style={{ fontSize: 19 }}>
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
