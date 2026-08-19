import React, { useEffect, useRef, useState } from "react";
import { visibleStars, CONSTELLATION_LINES } from "./astronomy.js";

const DEFAULT_COORDS = { lat: 40.4406, lon: -79.9959 }; // fallback: Pittsburgh, PA
const STAR_REFRESH_MS = 60_000;
const PAD = { x: 16, y: 82, rot: 0, scale: 1 };
const SECOND_PAD = { x: 42, y: 87 }; // spare rocket being assembled off to the side
const PART_SPOTS = [
  { id: "p1", x: 34, y: 89 },
  { id: "p2", x: 48, y: 90 },
  { id: "p3", x: 38, y: 87 },
  { id: "p4", x: 45, y: 85 },
];

// Two-stage rocket with grid fins/interstage -- used on the pad and through
// ascent, before stage separation.
function FullRocketIcon({ color = "#F2F2ED", size = 60 }) {
  return (
    <svg width={size} height={size * 1.7} viewBox="0 0 36 62" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {/* nose/capsule */}
      <path d="M18 1c4 4 5.5 9 5.5 13.5h-11C12.5 10 14 5 18 1Z" />
      <circle cx="18" cy="10.5" r="1.6" />
      {/* upper stage */}
      <rect x="12.5" y="14.5" width="11" height="16" rx="1.2" />
      {/* interstage ring */}
      <line x1="11.5" y1="31" x2="24.5" y2="31" strokeWidth="1.6" />
      {/* booster */}
      <rect x="11.5" y="31" width="13" height="20" rx="1.2" />
      <line x1="11.5" y1="38" x2="24.5" y2="38" opacity="0.5" />
      {/* grid fins */}
      <rect x="7.5" y="33" width="3.5" height="6" opacity="0.85" />
      <rect x="25" y="33" width="3.5" height="6" opacity="0.85" />
      {/* engine skirt + nozzles */}
      <path d="M11.5 51 L9.5 57 L26.5 57 L24.5 51Z" />
      <line x1="14" y1="57" x2="14" y2="60" /><line x1="18" y1="57" x2="18" y2="60.5" /><line x1="22" y1="57" x2="22" y2="60" />
      {/* accent stripe */}
      <line x1="12.5" y1="20" x2="23.5" y2="20" stroke="#D94F30" strokeWidth="2" />
    </svg>
  );
}

// Capsule/pod only -- the piece that actually separates and comes home.
// Used from STAGE_SEP onward through the whole reentry/landing sequence.
function PodIcon({ color = "#F2F2ED", size = 34 }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 30 38" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 1c5 4.5 8 11 8 17 0 6-3 10.5-8 13.5-5-3-8-7.5-8-13.5 0-6 3-12.5 8-17Z" />
      <circle cx="15" cy="14" r="2.6" />
      <line x1="9" y1="24" x2="6" y2="30" /><line x1="21" y1="24" x2="24" y2="30" />
      <line x1="10.5" y1="10" x2="19.5" y2="10" stroke="#D94F30" strokeWidth="1.8" />
    </svg>
  );
}

// Ordered phase lists. Each phase: { name, duration(ms), to (or 'idle'),
// skyTo, ease }. The live rocket object always starts a phase from wherever
// it actually is (captured at hand-off), never from a hard-coded point --
// see the rAF loop below.
const ASCENT_PHASES = [
  { name: "IGNITION", label: "IGNITION", duration: 900, to: { x: 16, y: 78, rot: 0, scale: 1 }, sky: 0.04, ease: easeOutCubic, flame: 0.6 },
  { name: "ASCENT", label: "MAX-Q", duration: 2200, to: { x: 24, y: 42, rot: -14, scale: 0.8 }, sky: 0.55, ease: easeInOutCubic, flame: 1 },
  { name: "STAGE_SEP", label: "STAGE SEP", duration: 650, to: { x: 26, y: 30, rot: -8, scale: 0.66 }, sky: 0.68, ease: easeOutCubic, flame: 0.7, spawnBooster: true },
  { name: "EXO_ATMOSPHERE", label: "MECO", duration: 1300, to: { x: 30, y: 18, rot: 0, scale: 0.85 }, sky: 1, ease: easeOutCubic, flame: 0 },
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

// Content slide: holds in place through most of the flight, then exits in
// the phase closest to "the rocket's basically there" -- down/off-bottom
// as it nears space, up/off-top as it nears the ground on the way down.
function contentOffsetForPhase(phaseName, t) {
  switch (phaseName) {
    case "EXO_ATMOSPHERE": return lerp(0, 130, t);
    case "DEORBIT": return lerp(0, -40, t);
    case "REENTRY": return lerp(-40, -130, t);
    case "CHUTES": return -130;
    case "TOUCHDOWN": return -130;
    default: return 0;
  }
}

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
const FILLER_STARS = Array.from({ length: 110 }, (_, i) => ({
  x: seededRand(i) * 100, y: seededRand(i + 500) * 100,
  size: 0.05 + seededRand(i + 900) * 0.1, delay: seededRand(i + 200) * 3, dur: 2 + seededRand(i + 300) * 2.5,
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
        const size = Math.max(0.08, (2.2 - s.mag) * 0.09);
        return <circle key={s.name} cx={toPct(s.x)} cy={toPct(s.y)} r={size} fill="#f8fafc" style={{ animation: `bom-sky-twinkle ${2.4 + (s.mag % 1)}s ease-in-out ${(s.mag * 0.7) % 2}s infinite` }} />;
      })}
    </svg>
  );
}

function Clouds() {
  const puffs = [
    { top: "14%", left: "-8%", scale: 1.6, dur: "55s", delay: "0s" },
    { top: "26%", left: "15%", scale: 1.2, dur: "68s", delay: "-12s" },
    { top: "10%", left: "45%", scale: 1.8, dur: "48s", delay: "-24s" },
    { top: "32%", left: "65%", scale: 1.1, dur: "72s", delay: "-6s" },
    { top: "20%", left: "85%", scale: 1.4, dur: "60s", delay: "-33s" },
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

function StickFigure({ left, bottom = "36%", flip, active, walkCycle }) {
  return (
    <svg width="26" height="52" viewBox="0 0 10 20" style={{
      position: "absolute", left, bottom, transform: flip ? "scaleX(-1)" : "none",
      animation: `bom-sky-figure ${active ? "0.9s" : "2.6s"} ease-in-out infinite${walkCycle ? `, bom-sky-walk ${walkCycle} ease-in-out infinite` : ""}`,
    }} fill="none" stroke="#e5e7eb" strokeWidth="1.1" strokeLinecap="round">
      <circle cx="5" cy="3" r="1.6" />
      <line x1="5" y1="4.5" x2="5" y2="13" />
      <line x1="5" y1="7" x2="1.5" y2={active ? "3" : "9"} />
      <line x1="5" y1="7" x2="8.5" y2="10" />
      <line x1="5" y1="13" x2="2" y2="19" />
      <line x1="5" y1="13" x2="8" y2="19" />
    </svg>
  );
}

// A small part (fin, ring, or capsule-shell) that periodically "gets
// collected" -- fades out and shrinks toward the spare rocket, then
// reappears after a pause, so the ground crew reads as continuously
// salvaging/reassembling in the background rather than a one-shot event.
function GroundPart({ x, y, cycleS, delayS, shape }) {
  return (
    <div style={{
      position: "absolute", left: `${x}%`, bottom: `${y}%`, width: 10, height: 6,
      animation: `bom-sky-part-cycle ${cycleS}s ease-in-out ${delayS}s infinite`,
    }}>
      <svg width="14" height="8" viewBox="0 0 14 8" fill="none" stroke="#9ca3af" strokeWidth="1">
        {shape === "fin" && <path d="M1 7 L5 1 L9 1 L7 7Z" />}
        {shape === "ring" && <ellipse cx="7" cy="4" rx="5" ry="2.4" />}
        {shape === "shell" && <path d="M2 7 Q2 1 7 1 Q12 1 12 7Z" />}
      </svg>
    </div>
  );
}

function GroundScene({ figuresActive }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "13%" }}>
      <svg width="100%" height="100%" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        <path d="M0 14 Q200 0 400 14 L400 60 L0 60 Z" fill="#4b5563" opacity="0.9" />
      </svg>

      {/* Spare rocket being assembled off to the side -- perpetually
          "under construction", never actually finishes (its cap part
          just pulses in the GroundPart loop below). */}
      <div style={{ position: "absolute", left: `${SECOND_PAD.x}%`, bottom: "20%", opacity: 0.75 }}>
        <svg width="30" height="46" viewBox="0 0 20 34" fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeLinecap="round">
          <rect x="6" y="10" width="8" height="18" rx="1" />
          <line x1="6" y1="17" x2="14" y2="17" opacity="0.5" />
          <path d="M6 24 L4.5 28 L15.5 28 L14 24Z" />
        </svg>
      </div>
      {PART_SPOTS.map((p, i) => (
        <GroundPart key={p.id} x={p.x} y={0} cycleS={7 + i * 1.7} delayS={i * 1.2} shape={["fin", "ring", "shell", "ring"][i]} />
      ))}

      <StickFigure left="20%" flip={false} active={figuresActive} />
      <StickFigure left="27%" flip={true} active={figuresActive} />
      <StickFigure left="33%" bottom="18%" flip={false} active={false} walkCycle="9s" />
      <StickFigure left="44%" bottom="18%" flip={true} active={false} walkCycle="11s" />
    </div>
  );
}

export default function SkyBackground({ themeName, transitionMode, onTransitionDone, contentRef }) {
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
  const [iconKind, setIconKind] = useState(isDark ? "pod" : "full"); // "full" (on pad/ascent) vs "pod" (post-separation onward)

  const contentReentryRef = useRef({ active: false, start: 0, dir: null, duration: 700 });

  const reducedMotion = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches).current;

  // If a real value isn't set at PAD when starting SPACE_IDLE, remember
  // where the rocket arrived so idle-drift orbits around that point instead
  // of snapping to a fixed spot.
  const spaceAnchorRef = useRef({ x: 30, y: 18 });
  const idleEnterRef = useRef(0);
  const idleBaseRotRef = useRef(0);

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
      // Content re-entry beat runs independently of the rocket phase
      // machine (it starts right as that machine finishes).
      const reentry = contentReentryRef.current;
      if (reentry.active && contentRef?.current) {
        const rt = Math.min(1, (now - reentry.start) / reentry.duration);
        const eased = easeOutCubic(rt);
        const from = reentry.dir === "in-from-top" ? -130 : 130;
        contentRef.current.style.transform = `translateY(${lerp(from, 0, eased)}%)`;
        if (rt >= 1) reentry.active = false;
      }

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
        if (contentRef?.current) {
          contentRef.current.style.transform = `translateY(${contentOffsetForPhase(phase.name, eased)}%)`;
        }

        if (t >= 1) {
          if (phase.spawnBooster) {
            const id = Math.random().toString(36).slice(2);
            setFx((f) => [...f, { id, x: liveRef.current.x, y: liveRef.current.y }]);
            setTimeout(() => setFx((f) => f.filter((p) => p.id !== id)), 1400);
            setIconKind("pod"); // stage sep just happened -- only the pod continues
          }
          phaseFromRef.current = { ...liveRef.current, _flame: phase.flame ?? 0, _plasma: phase.plasma ? 0 : 0, _chute: phase.chute ?? 0 };
          skyFromRef.current = phase.sky;
          phaseIdxRef.current += 1;
          phaseStartRef.current = 0;
          if (phaseIdxRef.current >= seq.length) {
            // Sequence complete -- settle into the resting state, then kick
            // off the content's own re-entry beat (from top for space,
            // from bottom for ground) as a short independent animation.
            phaseIdxRef.current = -1;
            setPhaseLabel(null);
            if (seq === ASCENT_PHASES) {
              spaceAnchorRef.current = { x: liveRef.current.x, y: liveRef.current.y };
              setFiguresActive(false);
              contentReentryRef.current = { active: true, start: now, dir: "in-from-top", duration: 700 };
            } else {
              setFiguresActive(true);
              setIconKind("full"); // ground crew already reassembled the spare -- pad shows the full rocket again
              contentReentryRef.current = { active: true, start: now, dir: "in-from-bottom", duration: 700 };
            }
            onTransitionDone && onTransitionDone();
          } else {
            setPhaseLabel(seq[phaseIdxRef.current].label);
          }
        }
      } else {
        // Resting idle motion -- offsets are zero-anchored to the moment we
        // *entered* idle (idleEnterRef), and rotation continues from
        // wherever the rocket's rotation actually was, so there's no jump
        // when the phase machine hands off into this branch.
        if (idleEnterRef.current === 0) {
          idleEnterRef.current = now;
          idleBaseRotRef.current = liveRef.current.rot;
        }
        const localT = (now - idleEnterRef.current) / 1000;
        if (isDark) {
          const anchor = spaceAnchorRef.current;
          liveRef.current = {
            x: anchor.x + Math.sin(localT / 6) * 6,
            y: anchor.y + Math.sin(localT / 8) * 5,
            rot: idleBaseRotRef.current + localT * 10,
            scale: 0.85,
          };
          skyRef.current = 1;
        } else {
          liveRef.current = { x: PAD.x, y: PAD.y + Math.sin(localT / 2) * 0.6, rot: idleBaseRotRef.current, scale: 1 };
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
      const end = transitionMode === "blastoff" ? { x: 30, y: 18, rot: 0, scale: 0.85 } : { ...PAD };
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
    idleEnterRef.current = 0; // re-anchor idle drift fresh next time we settle
    missionStartRef.current = performance.now();
    setPhaseLabel(seq[0].label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionMode]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{`
        @keyframes bom-sky-twinkle { 0%,100% { opacity: 0.25; } 50% { opacity: 0.75; } }
        @keyframes bom-sky-flame { 0%,100% { transform: translateX(-50%) scaleY(1); } 50% { transform: translateX(-50%) scaleY(1.35); } }
        @keyframes bom-sky-drift-cloud { from { transform: translateX(0); } to { transform: translateX(130vw); } }
        @keyframes bom-sky-figure { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-6deg); } }
        @keyframes bom-sky-walk { 0%,100% { margin-left: 0; } 50% { margin-left: 40px; } }
        @keyframes bom-sky-part-cycle {
          0%   { opacity: 1; transform: translate(0,0) scale(1); }
          38%  { opacity: 1; transform: translate(0,0) scale(1); }
          55%  { opacity: 0; transform: translate(60px,-8px) scale(0.4); }
          85%  { opacity: 0; transform: translate(60px,-8px) scale(0.4); }
          100% { opacity: 1; transform: translate(0,0) scale(1); }
        }
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
            <svg width="64" height="49" viewBox="0 0 34 26" fill="none" stroke="#e2e8f0" strokeWidth="1.4">
              <path d="M1 14 Q17 -2 33 14" fill="#FF6B35" stroke="#dc2626" />
              <line x1="4" y1="14" x2="12" y2="24" /><line x1="17" y1="14" x2="15" y2="24" /><line x1="30" y1="14" x2="19" y2="24" />
            </svg>
          </div>
          <div ref={plasmaRef} style={{ position: "absolute", inset: -20, borderRadius: "50%", background: "radial-gradient(circle, #FFD23F 0%, #FF5A36 45%, transparent 75%)", opacity: 0, filter: "blur(3px)" }} />
          {iconKind === "full" ? <FullRocketIcon color="currentColor" size={54} /> : <PodIcon color="currentColor" size={32} />}
          <div ref={flameRef} style={{ position: "absolute", bottom: -15, left: "50%", width: 11, height: 27, borderRadius: "0 0 11px 11px", background: "linear-gradient(180deg,#FFF6D5,#FFB347 55%,#FF6B35)", opacity: 0, animation: "bom-sky-flame 0.2s ease-in-out infinite" }} />
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
