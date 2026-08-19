import React, { useEffect, useRef, useState } from "react";
import { visibleStars, CONSTELLATION_LINES } from "./astronomy.js";
import { RocketIcon } from "./ThemeTransition.jsx";

const DEFAULT_COORDS = { lat: 40.4406, lon: -79.9959 }; // fallback: Pittsburgh, PA
const STAR_REFRESH_MS = 60_000;
const PAD = { x: 16, y: 82, rot: 0, scale: 1 };

// Ordered phase lists. Each phase: { name, duration(ms), to (or 'idle'),
// skyTo, ease }. The live rocket object always starts a phase from wherever
// it actually is (captured at hand-off), never from a hard-coded point --
// see the rAF loop below.
const ASCENT_PHASES = [
  { name: "IGNITION", label: "IGNITION", duration: 900, to: { x: 16, y: 78, rot: 0, scale: 1 }, sky: 0.04, ease: easeOutCubic, flame: 0.6 },
  { name: "ASCENT", label: "MAX-Q", duration: 2200, to: { x: 24, y: 42, rot: -14, scale: 0.8 }, sky: 0.55, ease: easeInOutCubic, flame: 1 },
  { name: "STAGE_SEP", label: "STAGE SEP", duration: 650, to: { x: 26, y: 30, rot: -8, scale: 0.66 }, sky: 0.68, ease: easeOutCubic, flame: 0.7, spawnBooster: true },
  { name: "EXO_ATMOSPHERE", label: "MECO", duration: 1300, to: { x: 30, y: 18, rot: 0, scale: 0.5 }, sky: 1, ease: easeOutCubic, flame: 0 },
];
const REENTRY_PHASES = [
  { name: "DEORBIT", label: "DEORBIT BURN", duration: 650, to: (from) => ({ ...from, rot: 178, scale: from.scale * 1.15 }), sky: 0.92, ease: easeInCubic, flame: 0.5 },
  { name: "REENTRY", label: "REENTRY", duration: 2000, to: { x: 20, y: 60, rot: 188, scale: 0.85 }, sky: 0.32, ease: easeInCubic, plasma: 1 },
  { name: "CHUTES", label: "CHUTES", duration: 1600, to: { x: 16, y: 80, rot: 360, scale: 1 }, sky: 0.04, ease: easeOutBack, chute: 1 },
  { name: "TOUCHDOWN", label: "TOUCHDOWN", duration: 700, to: { ...PAD, rot: 360 }, sky: 0, ease: easeOutCubic, chute: 0.3 },
];

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
function lerp(a, b, t) { return a + (b - a) * t; }

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

function seededRand(seed) { const x = Math.sin(seed * 999) * 10000; return x - Math.floor(x); }
const FILLER_STARS = Array.from({ length: 150 }, (_, i) => ({
  x: seededRand(i) * 100, y: seededRand(i + 500) * 100,
  size: 0.15 + seededRand(i + 900) * 0.35, delay: seededRand(i + 200) * 3, dur: 2 + seededRand(i + 300) * 2.5,
}));

function StarField({ coords, styleRef }) {
  const [stars, setStars] = useState(() => visibleStars(coords.lat, coords.lon, new Date()));
  useEffect(() => {
    const id = setInterval(() => setStars(visibleStars(coords.lat, coords.lon, new Date())), STAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [coords.lat, coords.lon]);
  const byName = Object.fromEntries(stars.map((s) => [s.name, s]));
  const toPct = (v) => 50 + v * 46;
  return (
    <svg ref={styleRef} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
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
        return <circle key={s.name} cx={toPct(s.x)} cy={toPct(s.y)} r={size} fill="#f8fafc" style={{ animation: `bom-sky-twinkle ${2.4 + (s.mag % 1)}s ease-in-out ${(s.mag * 0.7) % 2}s infinite` }} />;
      })}
    </svg>
  );
}

function Clouds() {
  const puffs = [
    { top: "58%", left: "-8%", scale: 1.6, dur: "55s", delay: "0s" },
    { top: "70%", left: "15%", scale: 1.2, dur: "68s", delay: "-12s" },
    { top: "50%", left: "45%", scale: 1.8, dur: "48s", delay: "-24s" },
    { top: "75%", left: "65%", scale: 1.1, dur: "72s", delay: "-6s" },
    { top: "62%", left: "85%", scale: 1.4, dur: "60s", delay: "-33s" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {puffs.map((p, i) => (
        <div key={i} style={{
          position: "absolute", top: p.top, left: p.left, width: 190 * p.scale, height: 60 * p.scale,
          background: "#ffffff", borderRadius: 999, filter: "blur(4px)", opacity: 0.85,
          animation: `bom-sky-drift-cloud ${p.dur} linear ${p.delay} infinite`,
        }} />
      ))}
    </div>
  );
}

function GroundScene({ figuresActive }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "13%" }}>
      <svg width="100%" height="100%" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        <path d="M0 14 Q200 0 400 14 L400 60 L0 60 Z" fill="#4b5563" opacity="0.9" />
      </svg>
      {[{ left: "20%", flip: false }, { left: "27%", flip: true }].map((f, i) => (
        <svg key={i} width="10" height="20" viewBox="0 0 10 20" style={{
          position: "absolute", left: f.left, bottom: "38%", transform: f.flip ? "scaleX(-1)" : "none",
          animation: `bom-sky-figure ${figuresActive ? "0.9s" : "2.6s"} ease-in-out infinite`, animationDelay: `${i * 0.3}s`,
        }} fill="none" stroke="#e5e7eb" strokeWidth="1.1" strokeLinecap="round">
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

export default function SkyBackground({ themeName, transitionMode, onTransitionDone }) {
  const coords = useCoords();
  const isDark = themeName === "dark";

  const rocketRef = useRef(null);
  const flameRef = useRef(null);
  const plasmaRef = useRef(null);
  const chuteRef = useRef(null);
  const daySkyRef = useRef(null);
  const twilightSkyRef = useRef(null);
  const nightSkyRef = useRef(null);
  const groundRef = useRef(null);
  const cloudsRef = useRef(null);
  const hudRef = useRef(null);

  const liveRef = useRef({ ...PAD }); // the ONE continuously-tracked rocket transform
  const liveSeqRef = useRef(null); // which phase list ("ASCENT_PHASES"/"REENTRY_PHASES") is currently running, if any
  const skyRef = useRef(0); // 0 = full day, 1 = full space
  const phaseIdxRef = useRef(-1);
  const phaseStartRef = useRef(0);
  const phaseFromRef = useRef({ ...PAD });
  const skyFromRef = useRef(0);
  const missionStartRef = useRef(0);
  const [phaseLabel, setPhaseLabel] = useState(null);
  const [fx, setFx] = useState([]); // transient booster/dust particles
  const [figuresActive, setFiguresActive] = useState(!isDark);

  const reducedMotion = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches).current;

  // If a real value isn't set at PAD when starting SPACE_IDLE, remember
  // where the rocket arrived so idle-drift orbits around that point instead
  // of snapping to a fixed spot.
  const spaceAnchorRef = useRef({ x: 30, y: 18 });

  function applyTransform() {
    const { x, y, rot, scale } = liveRef.current;
    if (rocketRef.current) {
      rocketRef.current.style.left = `${x}%`;
      rocketRef.current.style.top = `${y}%`;
      rocketRef.current.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`;
    }
    const s = skyRef.current;
    const day = Math.max(0, 1 - s * 2.1);
    const night = Math.max(0, s * 2.1 - 1.1);
    const twilight = Math.max(0, 1 - Math.abs(s - 0.5) * 2.6);
    if (daySkyRef.current) daySkyRef.current.style.opacity = day;
    if (nightSkyRef.current) nightSkyRef.current.style.opacity = night;
    if (twilightSkyRef.current) twilightSkyRef.current.style.opacity = twilight;
    if (cloudsRef.current) cloudsRef.current.style.opacity = day;
    if (groundRef.current) groundRef.current.style.opacity = Math.max(0, 1 - s * 1.6);
  }

  // Continuous rAF loop: idles when at rest, runs the active phase's eased
  // interpolation when mid-sequence. Always reads its starting point off
  // liveRef (the live object), never a constant.
  useEffect(() => {
    let raf;
    const tick = (now) => {
      const seq = phaseIdxRef.current >= 0 ? (liveSeqRef.current || []) : null;

      if (seq && phaseIdxRef.current < seq.length) {
        const phase = seq[phaseIdxRef.current];
        if (phaseStartRef.current === 0) phaseStartRef.current = now;
        const t = Math.min(1, (now - phaseStartRef.current) / phase.duration);
        const eased = phase.ease(t);
        const to = typeof phase.to === "function" ? phase.to(phaseFromRef.current) : phase.to;

        liveRef.current = {
          x: lerp(phaseFromRef.current.x, to.x, eased),
          y: lerp(phaseFromRef.current.y, to.y, eased),
          rot: lerp(phaseFromRef.current.rot, to.rot, eased),
          scale: lerp(phaseFromRef.current.scale, to.scale, eased),
        };
        skyRef.current = lerp(skyFromRef.current, phase.sky, eased);

        if (flameRef.current) flameRef.current.style.opacity = lerp(phaseFromRef.current._flame ?? 0, phase.flame ?? 0, eased);
        if (plasmaRef.current) plasmaRef.current.style.opacity = phase.plasma ? Math.sin(Math.PI * t) : lerp(phaseFromRef.current._plasma ?? 0, 0, eased);
        if (chuteRef.current) chuteRef.current.style.opacity = lerp(phaseFromRef.current._chute ?? 0, phase.chute ?? 0, eased);
        if (hudRef.current) {
          const elapsedMs = now - missionStartRef.current;
          const mm = String(Math.floor(elapsedMs / 60000)).padStart(2, "0");
          const ss = String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0");
          hudRef.current.textContent = `T+${mm}:${ss}  ${phase.label}`;
        }

        applyTransform();

        if (t >= 1) {
          if (phase.spawnBooster) {
            const id = Math.random().toString(36).slice(2);
            setFx((f) => [...f, { id, x: liveRef.current.x, y: liveRef.current.y }]);
            setTimeout(() => setFx((f) => f.filter((p) => p.id !== id)), 1400);
          }
          phaseFromRef.current = { ...liveRef.current, _flame: phase.flame ?? 0, _plasma: phase.plasma ? 0 : 0, _chute: phase.chute ?? 0 };
          skyFromRef.current = phase.sky;
          phaseIdxRef.current += 1;
          phaseStartRef.current = 0;
          if (phaseIdxRef.current >= seq.length) {
            // Sequence complete -- settle into the resting state.
            phaseIdxRef.current = -1;
            setPhaseLabel(null);
            if (seq === ASCENT_PHASES) {
              spaceAnchorRef.current = { x: liveRef.current.x, y: liveRef.current.y };
              setFiguresActive(false);
            } else {
              setFiguresActive(true);
            }
            onTransitionDone && onTransitionDone();
          } else {
            setPhaseLabel(seq[phaseIdxRef.current].label);
          }
        }
      } else {
        // Resting idle motion -- still updates liveRef continuously so the
        // next transition always starts from a real, current position.
        if (isDark) {
          const t = now / 1000;
          const anchor = spaceAnchorRef.current;
          liveRef.current = {
            x: anchor.x + Math.sin(t / 6) * 6,
            y: anchor.y + Math.cos(t / 8) * 5,
            rot: (t * 12) % 360,
            scale: 0.5,
          };
          skyRef.current = 1;
        } else {
          const t = now / 1000;
          liveRef.current = { x: PAD.x, y: PAD.y + Math.sin(t / 2) * 0.6, rot: Math.sin(t / 3) * 1.5, scale: 1 };
          skyRef.current = 0;
        }
        applyTransform();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // Kick off a sequence whenever App tells us a transition started.
  useEffect(() => {
    if (!transitionMode) return;
    const seq = transitionMode === "blastoff" ? ASCENT_PHASES : REENTRY_PHASES;

    if (reducedMotion) {
      // Respect prefers-reduced-motion: snap straight to the end state with
      // just a short opacity crossfade instead of the full choreography.
      const end = transitionMode === "blastoff" ? { x: 30, y: 18, rot: 0, scale: 0.5 } : { ...PAD };
      liveRef.current = end;
      skyRef.current = transitionMode === "blastoff" ? 1 : 0;
      applyTransform();
      if (transitionMode === "blastoff") { spaceAnchorRef.current = { x: end.x, y: end.y }; setFiguresActive(false); }
      else setFiguresActive(true);
      const id = setTimeout(() => onTransitionDone && onTransitionDone(), 400);
      return () => clearTimeout(id);
    }

    liveSeqRef.current = seq;
    phaseFromRef.current = { ...liveRef.current, _flame: 0, _plasma: 0, _chute: 0 };
    skyFromRef.current = skyRef.current;
    phaseStartRef.current = 0;
    phaseIdxRef.current = 0;
    missionStartRef.current = performance.now();
    setPhaseLabel(seq[0].label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionMode]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{`
        @keyframes bom-sky-twinkle { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes bom-sky-flame { 0%,100% { transform: translateX(-50%) scaleY(1); } 50% { transform: translateX(-50%) scaleY(1.35); } }
        @keyframes bom-sky-drift-cloud { from { transform: translateX(0); } to { transform: translateX(130vw); } }
        @keyframes bom-sky-figure { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-6deg); } }
        @keyframes bom-sky-booster-fall { from { transform: translate(-50%,-50%) rotate(0deg); opacity: 0.9; } to { transform: translate(-50%,120px) rotate(70deg); opacity: 0; } }
      `}</style>

      <div ref={daySkyRef} style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #3F7FCB 0%, #6FA9E0 35%, #A9D3F0 70%, #EFE9D8 100%)" }}>
        <div ref={cloudsRef}><Clouds /></div>
      </div>
      <div ref={twilightSkyRef} style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #2C5F8A 0%, #4B3F72 50%, #7A4B8A 100%)", opacity: 0 }} />
      <div ref={nightSkyRef} style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #060814 0%, #0B0F22 100%)", opacity: 0 }}>
        <StarField coords={coords} />
      </div>

      <div ref={groundRef}><GroundScene figuresActive={figuresActive} /></div>

      {fx.map((p) => (
        <div key={p.id} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, width: 8, height: 14, background: "#374151", borderRadius: 2, animation: "bom-sky-booster-fall 1.3s ease-in forwards" }} />
      ))}

      <div ref={rocketRef} style={{ position: "absolute", left: `${PAD.x}%`, top: `${PAD.y}%`, transform: "translate(-50%,-50%)", color: "#F2F2ED" }}>
        <div style={{ position: "relative" }}>
          <div ref={chuteRef} style={{ position: "absolute", left: "50%", bottom: "100%", transform: "translateX(-50%)", opacity: 0 }}>
            <svg width="34" height="26" viewBox="0 0 34 26" fill="none" stroke="#e2e8f0" strokeWidth="1.4">
              <path d="M1 14 Q17 -2 33 14" fill="#FF6B35" stroke="#dc2626" />
              <line x1="4" y1="14" x2="12" y2="24" /><line x1="17" y1="14" x2="15" y2="24" /><line x1="30" y1="14" x2="19" y2="24" />
            </svg>
          </div>
          <div ref={plasmaRef} style={{ position: "absolute", inset: -10, borderRadius: "50%", background: "radial-gradient(circle, #FFD23F 0%, #FF5A36 45%, transparent 75%)", opacity: 0, filter: "blur(2px)" }} />
          <RocketIcon color="currentColor" size={30} />
          <div ref={flameRef} style={{ position: "absolute", bottom: -8, left: "50%", width: 6, height: 14, borderRadius: "0 0 6px 6px", background: "linear-gradient(180deg,#FFF6D5,#FFB347 55%,#FF6B35)", opacity: 0, animation: "bom-sky-flame 0.2s ease-in-out infinite" }} />
        </div>
      </div>

      {phaseLabel && (
        <div style={{ position: "absolute", top: 16, right: 16, fontFamily: "monospace", fontSize: 11, color: "#f1f5f9", opacity: 0.85, background: "rgba(0,0,0,0.35)", padding: "4px 8px", borderRadius: 4 }}>
          <span ref={hudRef}>{phaseLabel}</span>
        </div>
      )}
    </div>
  );
}
