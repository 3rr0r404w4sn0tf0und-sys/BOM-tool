"use client";
import { useState, useRef } from "react";
import { API_BASE } from "../lib/apiBase";

const box = { border: "1px solid #2a2d34", borderRadius: 8, padding: 12, marginBottom: 12, background: "#161821" };
const input = { width: "100%", padding: "6px 8px", marginTop: 4, marginBottom: 8, background: "#0f1115", border: "1px solid #2a2d34", borderRadius: 6, color: "#e6e6e6" };
const label = { fontSize: 12, color: "#9aa0ab" };

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000; // Actions cold-start + scrape can take a minute+

export default function MaterialInput({ title, material, onChange }) {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const pollRef = useRef(null);

  async function fetchPrice() {
    if (!material.link) return;
    setFetching(true);
    setFetchError(null);

    try {
      const startRes = await fetch(`${API_BASE}/api/price/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: material.link }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "failed to start scrape job");

      const jobId = startData.job_id;
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      const poll = async () => {
        if (Date.now() > deadline) {
          setFetchError("Scrape timed out -- check the GitHub Actions run for this repo");
          setFetching(false);
          return;
        }
        const res = await fetch(`${API_BASE}/api/price/status/${jobId}`);
        const data = await res.json();

        if (data.status === "done") {
          if (data.found) {
            onChange({ ...material, price_per_unit: data.price, price_source: data.source });
          } else {
            setFetchError(data.error || "price not found");
          }
          setFetching(false);
          return;
        }
        if (data.status === "error") {
          setFetchError(data.error || "scrape job failed to start");
          setFetching(false);
          return;
        }
        pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      };

      poll();
    } catch (e) {
      setFetchError(e.message);
      setFetching(false);
    }
  }

  const pricePerKg =
    material.price_per_unit && material.spool_weight_g
      ? (material.price_per_unit / material.spool_weight_g) * 1000
      : null;

  return (
    <div style={box}>
      <strong>{title}</strong>

      <div style={label}>Product link</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ ...input, flex: 1 }}
          placeholder="https://..."
          value={material.link || ""}
          onChange={(e) => onChange({ ...material, link: e.target.value })}
        />
        <button onClick={fetchPrice} disabled={fetching || !material.link} style={{ height: 34 }}>
          {fetching ? "Scraping…" : "Fetch price"}
        </button>
      </div>
      {fetching && (
        <div style={{ fontSize: 11, color: "#9aa0ab", marginBottom: 8 }}>
          Triggered a GitHub Action to scrape this -- can take up to a minute.
        </div>
      )}
      {fetchError && <div style={{ color: "#e08080", fontSize: 12, marginBottom: 8 }}>{fetchError}</div>}
      {material.price_per_unit != null && (
        <div style={{ fontSize: 12, color: "#8fd19e", marginBottom: 8 }}>
          Found: ${material.price_per_unit.toFixed(2)} ({material.price_source})
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={label}>Spool weight (g)</div>
          <input type="number" style={input} placeholder="1000" value={material.spool_weight_g || ""}
            onChange={(e) => onChange({ ...material, spool_weight_g: parseFloat(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>Density (g/cm³)</div>
          <input type="number" step="0.01" style={input} placeholder="1.24" value={material.density_g_cm3 || ""}
            onChange={(e) => onChange({ ...material, density_g_cm3: parseFloat(e.target.value) })} />
        </div>
      </div>

      {pricePerKg != null && <div style={{ fontSize: 12, color: "#9aa0ab" }}>≈ ${pricePerKg.toFixed(2)} / kg</div>}
    </div>
  );
}
