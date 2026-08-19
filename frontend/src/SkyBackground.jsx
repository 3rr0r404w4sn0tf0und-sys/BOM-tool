import React, { useEffect, useMemo, useState } from "react";
import { visibleStars, CONSTELLATION_LINES } from "./astronomy.js";
import { RocketIcon } from "./ThemeTransition.jsx";

const DEFAULT_COORDS = { lat: 40.4406, lon: -79.9959 }; // fallback: Pittsburgh, PA
const STAR_REFRESH_MS = 60_000; // sky rotates ~0.25deg/min -- recompute every minute
const TRANSIT_S = 4.6; // total blastoff/landing duration, seconds -- cinematic, not snappy

const PAD = { left: "14%", top: "84%" };
const DRIFT_ANCHOR = { left: "24%", top: "22%" };
const GROUND_H = "13%";

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

// Deterministic pseudo-random filler stars (not real catalog data -- purely
// for visual density behind the accurate constellations). Seeded so they
// don't reshuffle every render.
function seededRand(seed) {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}
const FILLER_STARS = Array.from({ length: 180 }, (_, i) => ({
  x: seededRand(i) * 100,
  y: seededRand(i + 500) * 100,
  size: 0.15 + seededRand(i + 900) * 0.35,
  delay: seededRand(i + 200) * 3,
  dur: 2 + seededRand(i + 300) * 2.5,
}));

function GroundScene({ opacity, figuresActive }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: GROUND_H, opacity, transition: "opacity 1.2s ease" }}>
      <svg width="100%" height="100%" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        <path d="M0 14 Q200 0 400 14 L400 60 L0 60 Z" fill="#4b5563" opacity="0.9" />
        <path d="M0 14 Q200 0 400 14" stroke="#6b7280" strokeWidth="1" fill="none" opacity="0.6" />
      </svg>
      {/* Two tiny stick-figure "ground crew" near the pad -- idle sway
          normally, a more energetic checklist-wave loop once the rocket is
          actually resting (figuresActive). */}
      {[{ left: "20%", flip: false }, { left: "27%", flip: true }].map((f, i) => (
        <svg
          key={i}
          width="10" height="20" viewBox="0 0 10 20"
          style={{
            position: "absolute", left: f.left, bottom: "38%", transform: f.flip ? "scaleX(-1)" : "none",
            animation: `bom-sky-figure ${figuresActive ? "0.9s" : "2.6s"} ease-in-out infinite`,
            animationDelay: `${i * 0.3}s`,
          }}
          fill="none" stroke="#e5e7eb" strokeWidth="1.1" strokeLinecap="round"
        >
          <circle cx="5" cy="3" r="1.6" />
          <line x1="5" y1="4.5" x2="5" y2="13" />
          <line x1="5" y1="7" x2="1.5" y2={figuresActive ? "3" : "9"} />
          <line x1="5" y1="7" x2="8.5" y2="10" />
          <line x1="5" y1="13" x2="2" y2="19" />
          <line x1="5" y1="13" x2="8" y2="19" />
        </svg>
      ))}
    </div>
  );
}

function LaunchPad({ color, visible }) {
  return (
    <svg
      width="54" height="18" viewBox="0 0 54 18"
      style={{ position: "absolute", left: PAD.left, top: PAD.top, transform: "translate(-50%, 2px)", opacity: visible ? 0.85 : 0, transition: "opacity 0.6s ease" }}
      fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round"
    >
      <line x1="3" y1="2" x2="51" y2="2" />
      <line x1="12" y1="2" x2="6" y2="16" />
      <line x1="42" y1="2" x2="48" y2="16" />
      <line x1="27" y1="2" x2="27" y2="16" />
    </svg>
  );
}

function Clouds({ opacity }) {
  const puffs = [
    { top: "58%", left: "-8%", scale: 1.6, dur: "55s", delay: "0s" },
    { top: "70%", left: "15%", scale: 1.2, dur: "68s", delay: "-12s" },
    { top: "50%", left: "45%", scale: 1.8, dur: "48s", delay: "-24s" },
    { top: "75%", left: "65%", scale: 1.1, dur: "72s", delay: "-6s" },
    { top: "62%", left: "85%", scale: 1.4, dur: "60s", delay: "-33s" },
    { top: "45%", left: "8%", scale: 1.0, dur: "80s", delay: "-18s" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, transition: "opacity 1.4s ease" }}>
      {puffs.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute", top: p.top, left: p.left, width: 190 * p.scale, height: 60 * p.scale,
            background: "#ffffff", borderRadius: 999, filter: "blur(4px)", opacity: 0.85,
            boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
            animation: `bom-sky-drift-cloud ${p.dur} linear ${p.delay} infinite`,
          }}
        />
      ))}
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
  const toPct = (v) => 50 + v * 46;

  return (
    <svg
      viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, transition: "opacity 1.4s ease" }}
    >
      {FILLER_STARS.map((s, i) => (
        <circle key={`f${i}`} cx={s.x} cy={s.y} r={s.size} fill="#f8fafc" style={{ animation: `bom-sky-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
      ))}
      {CONSTELLATION_LINES.map(([a, b], i) => {
        const sa = byName[a], sb = byName[b];
        if (!sa || !sb) return null;
        return <line key={i} x1={toPct(sa.x)} y1={toPct(sa.y)} x2={toPct(sb.x)} y2={toPct(sb.y)} stroke="#93c5fd" strokeWidth="0.12" opacity="0.35" />;
      })}
      {stars.map((s) => {
        const size = Math.max(0.3, (2.2 - s.mag) * 0.32);
        return (
          <circle key={s.name} cx={toPct(s.x)} cy={toPct(s.y)} r={size} fill="#f8fafc" style={{ animation: `bom-sky-twinkle ${2.4 + (s.mag % 1)}s ease-in-out ${(s.mag * 0.7) % 2}s infinite` }} />
        );
      })}
    </svg>
  );
}

function Parachute({ visible }) {
  return (
    <div style={{ position: "absolute", left: "50%", bottom: "100%", transform: "translateX(-50%)", opacity: visible ? 1 : 0, transition: "opacity 0.3s ease" }}>
      <svg width="34" height="26" viewBox="0 0 34 26" fill="none" stroke="#e2e8f0" strokeWidth="1.4">
        <path d="M1 14 Q17 -2 33 14" fill="#f87171" opacity="0.9" stroke="#dc2626" />
        <line x1="4" y1="14" x2="12" y2="24" />
        <line x1="17" y1="14" x2="15" y2="24" />
        <line x1="30" y1="14" x2="19" y2="24" />
      </svg>
    </div>
  );
}

export default function SkyBackground({ themeName, transitionMode, onTransitionDone }) {
  const coords = useCoords();
  const isDark = themeName === "dark";
  const rocketState = transitionMode || (isDark ? "idle-dark" : "idle-light");

  const rocketBase = rocketState === "idle-light" ? PAD : rocketState === "landing" ? PAD : DRIFT_ANCHOR;
  const rocketAnim = {
    "idle-dark": "bom-sky-drift 46s ease-in-out infinite",
    "idle-light": "none",
    blastoff: `bom-sky-blastoff ${TRANSIT_S}s cubic-bezier(.4,.05,.7,.3) forwards`,
    landing: `bom-sky-landing ${TRANSIT_S}s cubic-bezier(.2,.5,.4,1) forwards`,
  }[rocketState];

  const dayVisible = transitionMode ? undefined : !isDark;
  const spaceVisible = transitionMode ? undefined : isDark;

  const padVisible = rocketState === "idle-light" || rocketState === "blastoff" || rocketState === "landing";
  const flameVisible = rocketState === "blastoff" || (rocketState === "landing" && false);
  const groundVisible = rocketState !== "idle-dark"; // ground recedes once fully drifting in space
  const figuresActive = rocketState === "idle-light";

  const handleAnimEnd = (e) => {
    if (e.target !== e.currentTarget) return; // ignore bubbled child animations
    if (transitionMode) onTransitionDone && onTransitionDone();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{`
        @keyframes bom-sky-twinkle { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes bom-sky-flame { 0%,100% { transform: translateX(-50%) scaleY(1); opacity: 0.9; } 50% { transform: translateX(-50%) scaleY(1.4); opacity: 0.5; } }
        @keyframes bom-sky-drift-cloud { from { transform: translateX(0); } to { transform: translateX(130vw); } }
        @keyframes bom-sky-figure { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-6deg); } }
        @keyframes bom-sky-drift {
          0%   { transform: translate(0, 0) rotate(0deg); }
          25%  { transform: translate(190px, -70px) rotate(-4deg); }
          50%  { transform: translate(70px, -190px) rotate(3deg); }
          75%  { transform: translate(-120px, -90px) rotate(-2deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes bom-sky-blastoff {
          0%   { left: ${PAD.left}; top: ${PAD.top}; }
          70%  { left: 19%; top: 30%; }
          100% { left: ${DRIFT_ANCHOR.left}; top: ${DRIFT_ANCHOR.top}; }
        }
        @keyframes bom-sky-landing {
          0%   { left: ${DRIFT_ANCHOR.left}; top: ${DRIFT_ANCHOR.top}; }
          55%  { left: 19%; top: 55%; }
          100% { left: ${PAD.left}; top: ${PAD.top}; }
        }
        /* Sky/cloud/star crossfade only happens in the back portion of the
           timeline -- rocket is well into its climb/descent before the
           "atmosphere break" happens, like a real launch. */
        @keyframes bom-sky-day-fadeout   { 0% { opacity: 1; } 65% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes bom-sky-space-fadein  { 0% { opacity: 0; } 65% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes bom-sky-space-fadeout { 0% { opacity: 1; } 35% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes bom-sky-day-fadein    { 0% { opacity: 0; } 35% { opacity: 0; } 100% { opacity: 1; } }
      `}</style>

      {/* Two full-bleed sky layers, cross-faded so the sky itself only
          flips once the rocket is well into its climb/descent. */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, #bfe3ff 0%, #eaf6ff 60%, #f8fafc 100%)",
          opacity: dayVisible !== undefined ? (dayVisible ? 1 : 0) : undefined,
          animation:
            transitionMode === "blastoff" ? `bom-sky-day-fadeout ${TRANSIT_S}s ease forwards` :
            transitionMode === "landing" ? `bom-sky-day-fadein ${TRANSIT_S}s ease forwards` : undefined,
          transition: transitionMode ? "none" : "opacity 1.2s ease",
        }}
      >
        <Clouds opacity={1} />
      </div>
      <div
        style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, #0b1224 0%, #0f172a 55%, #111827 100%)",
          opacity: spaceVisible !== undefined ? (spaceVisible ? 1 : 0) : undefined,
          animation:
            transitionMode === "blastoff" ? `bom-sky-space-fadein ${TRANSIT_S}s ease forwards` :
            transitionMode === "landing" ? `bom-sky-space-fadeout ${TRANSIT_S}s ease forwards` : undefined,
          transition: transitionMode ? "none" : "opacity 1.2s ease",
        }}
      >
        <StarField coords={coords} opacity={1} />
      </div>

      <GroundScene opacity={groundVisible ? 1 : 0} figuresActive={figuresActive} />
      <LaunchPad color={isDark ? "#94a3b8" : "#334155"} visible={padVisible} />

      <div
        onAnimationEnd={handleAnimEnd}
        style={{
          position: "absolute",
          left: rocketAnim === "none" ? rocketBase.left : undefined,
          top: rocketAnim === "none" ? rocketBase.top : undefined,
          transform: "translate(-50%, -50%)",
          animation: rocketAnim === "none" ? undefined : rocketAnim,
          color: isDark || rocketState === "blastoff" ? "#f1f5f9" : "#111111",
        }}
      >
        <div style={{ position: "relative" }}>
          <Parachute visible={rocketState === "landing"} />
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
