import React from "react";

// Shown for THEME_TRANSITION_MS while the theme underneath has already
// swapped -- this overlay just covers that swap with a themed animation,
// then fades itself out to reveal the new theme already in place.
export const THEME_TRANSITION_MS = 1300;

const DARK_BG = "#0f172a";
const LIGHT_BG = "#f8fafc";
const STARS = [
  { top: "18%", left: "22%", delay: "0s" },
  { top: "30%", left: "70%", delay: "0.3s" },
  { top: "62%", left: "18%", delay: "0.6s" },
  { top: "70%", left: "78%", delay: "0.15s" },
  { top: "14%", left: "52%", delay: "0.45s" },
  { top: "50%", left: "88%", delay: "0.75s" },
];

export function RocketIcon({ color = "#f1f5f9", size = 40 }) {
  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 40 64" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 2c7 8 8 20 8 28 0 6-2 10-8 14-6-4-8-8-8-14 0-8 1-20 8-28Z" />
      <circle cx="20" cy="24" r="4" />
      <path d="M12 34 4 46l8-3" />
      <path d="M28 34l8 12-8-3" />
    </svg>
  );
}

export default function ThemeTransition({ mode, onDone }) {
  const isBlastoff = mode === "blastoff";
  const bg = isBlastoff ? DARK_BG : LIGHT_BG;
  const iconColor = isBlastoff ? "#f1f5f9" : "#111111";

  return (
    <div
      onAnimationEnd={onDone}
      style={{
        position: "fixed", inset: 0, zIndex: 3000, background: bg,
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        animation: "bom-tt-overlay-fade 1.3s ease forwards",
      }}
    >
      <style>{`
        @keyframes bom-tt-overlay-fade {
          0% { opacity: 1; }
          78% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes bom-tt-blastoff {
          0% { transform: translateY(120px); opacity: 0; }
          15% { opacity: 1; }
          80% { transform: translateY(-260px); opacity: 1; }
          100% { transform: translateY(-340px); opacity: 0; }
        }
        @keyframes bom-tt-landing {
          0% { transform: translateY(-220px); opacity: 0; }
          15% { opacity: 1; }
          75% { transform: translateY(0px); opacity: 1; }
          100% { transform: translateY(6px); opacity: 1; }
        }
        @keyframes bom-tt-flame {
          0%, 100% { transform: scaleY(1); opacity: 0.9; }
          50% { transform: scaleY(1.4); opacity: 0.5; }
        }
        @keyframes bom-tt-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes bom-tt-dust {
          0% { transform: scale(0.4); opacity: 0; }
          60% { opacity: 0.5; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        .bom-tt-rocket-blastoff { animation: bom-tt-blastoff 1.1s cubic-bezier(.55,.05,.85,.35) forwards; }
        .bom-tt-rocket-landing { animation: bom-tt-landing 1.1s cubic-bezier(.15,.65,.45,.95) forwards; }
        .bom-tt-flame-el { animation: bom-tt-flame 0.22s ease-in-out infinite; transform-origin: center top; }
      `}</style>

      {isBlastoff &&
        STARS.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute", top: s.top, left: s.left, width: 3, height: 3, borderRadius: "50%",
              background: "#f1f5f9", animation: `bom-tt-twinkle 1.3s ease-in-out ${s.delay} infinite`,
            }}
          />
        ))}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div className={isBlastoff ? "bom-tt-rocket-blastoff" : "bom-tt-rocket-landing"} style={{ position: "relative" }}>
          <RocketIcon color={iconColor} />
          {isBlastoff && (
            <div
              className="bom-tt-flame-el"
              style={{
                position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)",
                width: 8, height: 16, borderRadius: "0 0 8px 8px", background: "#fb923c",
              }}
            />
          )}
        </div>

        {!isBlastoff && (
          <>
            <div style={{ width: 90, height: 2, background: iconColor, opacity: 0.3, marginTop: 6 }} />
            <div
              style={{
                position: "absolute", bottom: -2, width: 30, height: 30, borderRadius: "50%",
                background: iconColor, opacity: 0, animation: "bom-tt-dust 0.7s ease-out 0.85s forwards",
              }}
            />
          </>
        )}

        <div style={{ marginTop: 18, fontSize: 13, fontWeight: 600, color: iconColor, letterSpacing: 0.3, opacity: 0.85 }}>
          {isBlastoff ? "Going dark…" : "Touching down…"}
        </div>
      </div>
    </div>
  );
}
