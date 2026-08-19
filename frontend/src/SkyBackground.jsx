import React, { useEffect, useState } from "react";
import { visibleStars, CONSTELLATION_LINES } from "./astronomy.js";
import { RocketIcon } from "./ThemeTransition.jsx";

const DEFAULT_COORDS = { lat: 40.4406, lon: -79.9959 }; // fallback: Pittsburgh, PA
const STAR_REFRESH_MS = 60_000; // sky rotates ~0.25deg/min -- recompute every minute

// Fixed anchor points the rocket travels between. Percent-based so it holds
// up across viewport sizes.
const PAD = { left: "12%", top: "88%" };
const DRIFT_ANCHOR = { left: "22%", top: "24%" };

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

function LaunchPad({ color, visible }) {
  return (
    <svg
      width="54" height="18" viewBox="0 0 54 18"
      style={{
        position: "absolute", left: PAD.left, top: PAD.top, transform: "translate(-50%, 6px)",
        opacity: visible ? 0.8 : 0, transition: "opacity 0.5s ease",
      }}
      fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round"
    >
      <line x1="3" y1="2" x2="51" y2="2" />
      <line x1="12" y1="2" x2="6" y2="16" />
      <line x1="42" y1="2" x2="48" y2="16" />
      <line x1="27" y1="2" x2="27" y2="16" />
    </svg>
  );
}

function StarField({ coords }) {
  const [stars, setStars] = useState(() => visibleStars(coords.lat, coords.lon, new Date()));

  useEffect(() => {
    const id = setInterval(() => setStars(visibleStars(coords.lat, coords.lon, new Date())), STAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [coords.lat, coords.lon]);

  const byName = Object.fromEntries(stars.map((s) => [s.name, s]));
  const toPct = (v) => 50 + v * 46;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {CONSTELLATION_LINES.map(([a, b], i) => {
        const sa = byName[a], sb = byName[b];
        if (!sa || !sb) return null;
        return (
          <line key={i} x1={toPct(sa.x)} y1={toPct(sa.y)} x2={toPct(sb.x)} y2={toPct(sb.y)} stroke="#93c5fd" strokeWidth="0.12" opacity="0.35" />
        );
      })}
      {stars.map((s) => {
        const size = Math.max(0.25, (2.2 - s.mag) * 0.28);
        return (
          <circle
            key={s.name} cx={toPct(s.x)} cy={toPct(s.y)} r={size} fill="#f8fafc"
            style={{ animation: `bom-sky-twinkle ${2.4 + (s.mag % 1)}s ease-in-out ${(s.mag * 0.7) % 2}s infinite` }}
          />
        );
      })}
    </svg>
  );
}

export default function SkyBackground({ themeName, transitionMode, onTransitionDone }) {
  const coords = useCoords();
  const isDark = themeName === "dark";
  const rocketState = transitionMode || (isDark ? "idle-dark" : "idle-light");

  const rocketBase =
    rocketState === "idle-light" ? PAD : rocketState === "landing" ? PAD : DRIFT_ANCHOR;

  const rocketAnim = {
    "idle-dark": "bom-sky-drift 42s ease-in-out infinite",
    "idle-light": "none",
    blastoff: "bom-sky-blastoff 1.8s cubic-bezier(.5,.05,.75,.3) forwards",
    landing: "bom-sky-landing 1.8s cubic-bezier(.2,.6,.4,1) forwards",
  }[rocketState];

  const padVisible = rocketState === "idle-light" || rocketState === "blastoff" || rocketState === "landing";
  const flameVisible = rocketState === "blastoff" || rocketState === "landing";

  const handleAnimEnd = (e) => {
    if (e.target !== e.currentTarget) return; // ignore bubbled child animations (twinkle, flame)
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
        @keyframes bom-sky-flame { 0%,100% { transform: translateX(-50%) scaleY(1); opacity: 0.9; } 50% { transform: translateX(-50%) scaleY(1.4); opacity: 0.5; } }
        @keyframes bom-sky-drift {
          0%   { transform: translate(0, 0) rotate(0deg); }
          25%  { transform: translate(180px, -70px) rotate(-4deg); }
          50%  { transform: translate(60px, -180px) rotate(3deg); }
          75%  { transform: translate(-110px, -90px) rotate(-2deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes bom-sky-blastoff {
          0%   { left: ${PAD.left}; top: ${PAD.top}; opacity: 1; }
          100% { left: ${DRIFT_ANCHOR.left}; top: ${DRIFT_ANCHOR.top}; opacity: 1; }
        }
        @keyframes bom-sky-landing {
          0%   { left: ${DRIFT_ANCHOR.left}; top: ${DRIFT_ANCHOR.top}; opacity: 1; }
          100% { left: ${PAD.left}; top: ${PAD.top}; opacity: 1; }
        }
      `}</style>

      {isDark && <StarField coords={coords} />}

      <LaunchPad color={isDark ? "#94a3b8" : "#334155"} visible={padVisible} />

      <div
        onAnimationEnd={handleAnimEnd}
        style={{
          position: "absolute",
          left: rocketAnim === "none" ? rocketBase.left : undefined,
          top: rocketAnim === "none" ? rocketBase.top : undefined,
          transform: "translate(-50%, -50%)",
          animation: rocketAnim === "none" ? undefined : rocketAnim,
          color: isDark ? "#f1f5f9" : "#111111",
        }}
      >
        <div style={{ position: "relative" }}>
          <RocketIcon color="currentColor" size={30} />
          {flameVisible && (
            <div
              style={{
                position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)",
                width: 6, height: 12, borderRadius: "0 0 6px 6px", background: "#fb923c",
                animation: "bom-sky-flame 0.22s ease-in-out infinite",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
