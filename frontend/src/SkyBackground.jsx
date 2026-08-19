import React, { useEffect, useRef, useState } from "react";
import { visibleStars, CONSTELLATION_LINES } from "./astronomy.js";

const DEFAULT_COORDS = { lat: 40.4406, lon: -79.9959 }; // fallback: Pittsburgh, PA
const STAR_REFRESH_MS = 60_000; // sky rotates ~0.25deg/min -- recompute every minute

function useCoords() {
  const [coords, setCoords] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem("bom_coords") || "null");
      if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached;
    } catch {}
    return null;
  });

  useEffect(() => {
    if (coords || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
        localStorage.setItem("bom_coords", JSON.stringify(next));
        setCoords(next);
      },
      () => setCoords({ ...DEFAULT_COORDS, ts: Date.now() }),
      { timeout: 8000 }
    );
  }, [coords]);

  return coords || DEFAULT_COORDS;
}

function Rocket({ state }) {
  // state: "idle-dark" (floating up top), "idle-light" (resting bottom),
  // "blastoff" (rising), "landing" (descending)
  const rising = state === "blastoff";
  const descending = state === "landing";
  const resting = state === "idle-light";

  return (
    <div
      style={{
        position: "absolute",
        left: "6%",
        top: resting ? "auto" : rising ? "78%" : descending ? "10%" : "16%",
        bottom: resting ? "8%" : "auto",
        transform: "translateX(-50%)",
        animation: rising
          ? "bom-sky-rise 1.6s cubic-bezier(.55,.05,.85,.35) forwards"
          : descending
          ? "bom-sky-fall 1.6s cubic-bezier(.15,.65,.45,.95) forwards"
          : "bom-sky-idle-float 5s ease-in-out infinite",
        zIndex: 1,
      }}
    >
      <svg width="34" height="54" viewBox="0 0 40 64" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 2c7 8 8 20 8 28 0 6-2 10-8 14-6-4-8-8-8-14 0-8 1-20 8-28Z" />
        <circle cx="20" cy="24" r="4" />
        <path d="M12 34 4 46l8-3" />
        <path d="M28 34l8 12-8-3" />
      </svg>
      {!resting && (
        <div
          style={{
            position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)",
            width: 7, height: 13, borderRadius: "0 0 7px 7px", background: "#fb923c",
            animation: "bom-sky-flame 0.22s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

function StarField({ coords, opacity }) {
  const [stars, setStars] = useState(() => visibleStars(coords.lat, coords.lon, new Date()));

  useEffect(() => {
    const id = setInterval(() => setStars(visibleStars(coords.lat, coords.lon, new Date())), STAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [coords.lat, coords.lon]);

  const byName = Object.fromEntries(stars.map((s) => [s.name, s]));
  // Dome radius as % of the smaller viewport dimension; stars projected in [-1,1].
  const toPct = (v) => 50 + v * 46;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, transition: "opacity 900ms ease" }}
    >
      {CONSTELLATION_LINES.map(([a, b], i) => {
        const sa = byName[a], sb = byName[b];
        if (!sa || !sb) return null;
        return (
          <line
            key={i}
            x1={toPct(sa.x)} y1={toPct(sa.y)} x2={toPct(sb.x)} y2={toPct(sb.y)}
            stroke="#93c5fd" strokeWidth="0.12" opacity="0.35"
          />
        );
      })}
      {stars.map((s) => {
        const size = Math.max(0.25, (2.2 - s.mag) * 0.28);
        return (
          <circle
            key={s.name}
            cx={toPct(s.x)} cy={toPct(s.y)} r={size}
            fill="#f8fafc"
            style={{ animation: `bom-sky-twinkle ${2.4 + (s.mag % 1)}s ease-in-out ${(s.mag * 0.7) % 2}s infinite` }}
          />
        );
      })}
    </svg>
  );
}

function Clouds({ opacity }) {
  const puffs = [
    { top: "12%", left: "-5%", scale: 1.3, dur: "70s", delay: "0s" },
    { top: "28%", left: "20%", scale: 0.9, dur: "85s", delay: "-15s" },
    { top: "8%", left: "55%", scale: 1.1, dur: "60s", delay: "-30s" },
    { top: "40%", left: "75%", scale: 0.8, dur: "95s", delay: "-45s" },
    { top: "60%", left: "-8%", scale: 1.0, dur: "78s", delay: "-10s" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, transition: "opacity 900ms ease" }}>
      {puffs.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute", top: p.top, left: p.left, width: 160 * p.scale, height: 50 * p.scale,
            background: "#ffffff", borderRadius: 999, filter: "blur(6px)", opacity: 0.55,
            animation: `bom-sky-drift ${p.dur} linear ${p.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}

export default function SkyBackground({ themeName, transitionMode, onTransitionDone }) {
  const coords = useCoords();
  const isDark = themeName === "dark";
  const rocketState = transitionMode || (isDark ? "idle-dark" : "idle-light");

  const handleAnimEnd = (e) => {
    if (e.target !== e.currentTarget) return; // ignore bubbled child animations
    if (transitionMode) onTransitionDone && onTransitionDone();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none",
        background: isDark
          ? "linear-gradient(180deg, #0b1224 0%, #0f172a 55%, #111827 100%)"
          : "linear-gradient(180deg, #bfe3ff 0%, #eaf6ff 60%, #f8fafc 100%)",
        transition: "background 900ms ease",
      }}
    >
      <style>{`
        @keyframes bom-sky-twinkle { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes bom-sky-drift { from { transform: translateX(0); } to { transform: translateX(120vw); } }
        @keyframes bom-sky-idle-float { 0%,100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -14px); } }
        @keyframes bom-sky-flame { 0%,100% { transform: translateX(-50%) scaleY(1); opacity: 0.9; } 50% { transform: translateX(-50%) scaleY(1.4); opacity: 0.5; } }
        @keyframes bom-sky-rise { 0% { top: 78%; opacity: 0.9; } 100% { top: 12%; opacity: 1; } }
        @keyframes bom-sky-fall { 0% { top: 10%; opacity: 1; } 100% { top: 78%; opacity: 0.9; } }
      `}</style>

      <StarField coords={coords} opacity={isDark ? 1 : 0} />
      <Clouds opacity={isDark ? 0 : 1} />

      <div style={{ color: isDark ? "#f1f5f9" : "#111111" }} onAnimationEnd={handleAnimEnd}>
        <Rocket state={rocketState} />
      </div>
    </div>
  );
}
