import React, { useState, useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Shown next to a stale Amazon item. Handles the full hand-off flow:
// 1. User clicks "Solve CAPTCHA" -> triggers the workflow.
// 2. We poll for a screenshot to appear.
// 3. User types the code, submits.
// 4. We poll again until the item's status/stale flag actually updates,
//    so the user sees it resolve without needing to refresh manually.
export default function CaptchaSolver({ item, token, onResolved }) {
  const [screenshot, setScreenshot] = useState(null);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | starting | waiting_for_screenshot | ready_to_solve | submitted | done
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function start() {
    setError(null);
    setPhase("starting");
    try {
      const res = await fetch(`${API_URL}/api/boms/items/${item.id}/request-captcha-refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to start");
      setPhase("waiting_for_screenshot");
      pollForScreenshot();
    } catch (e) {
      setError(e.message);
      setPhase("idle");
    }
  }

  function pollForScreenshot() {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API_URL}/api/boms/items/${item.id}/captcha`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.captcha_screenshot) {
        setScreenshot(data.captcha_screenshot);
        setPhase("ready_to_solve");
        clearInterval(pollRef.current);
      }
    }, 3000);
  }

  async function submitAnswer() {
    if (!answer.trim()) return;
    setPhase("submitted");
    await fetch(`${API_URL}/api/boms/items/${item.id}/captcha-solution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ solution: answer.trim() }),
    });
    pollForResolution();
  }

  function pollForResolution() {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API_URL}/api/boms/items/${item.id}/captcha`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.captcha_status) {
        // cleared -> either solved or timed out, either way we're done waiting
        clearInterval(pollRef.current);
        setPhase("done");
        onResolved && onResolved();
      }
    }, 4000);
  }

  if (phase === "idle") {
    return (
      <button onClick={start} style={{ fontSize: 12 }}>
        🔓 Solve CAPTCHA
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginTop: 6, maxWidth: 320 }}>
      {phase === "starting" && <p style={{ fontSize: 13 }}>Starting scraper…</p>}

      {phase === "waiting_for_screenshot" && (
        <p style={{ fontSize: 13 }}>Waiting for CAPTCHA screenshot (~20-40s)…</p>
      )}

      {phase === "ready_to_solve" && screenshot && (
        <div>
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Amazon CAPTCHA"
            style={{ maxWidth: "100%", border: "1px solid #ccc" }}
          />
          <input
            placeholder="Type the letters you see"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 8, boxSizing: "border-box" }}
          />
          <button onClick={submitAnswer} style={{ marginTop: 6, width: "100%" }}>
            Submit
          </button>
          <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            You have about 10 minutes before this expires.
          </p>
        </div>
      )}

      {phase === "submitted" && <p style={{ fontSize: 13 }}>Submitting, finishing the scrape…</p>}

      {phase === "done" && <p style={{ fontSize: 13, color: "green" }}>Done — price should be updated.</p>}

      {error && <p style={{ color: "#b91c1c", fontSize: 12 }}>{error}</p>}
    </div>
  );
}
