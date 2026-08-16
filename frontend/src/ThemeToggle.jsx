import React from "react";

// An animated day->night switch. The track background gradient crossfades
// and the knob (sun/moon) slides across, based on isDark.
export default function ThemeToggle({ isDark, onToggle }) {
  const trackWidth = 52;
  const trackHeight = 26;
  const knobSize = 20;
  const knobTravel = trackWidth - knobSize - 6; // padding on each side = 3

  return (
    <button
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position: "relative",
        width: trackWidth,
        height: trackHeight,
        borderRadius: trackHeight,
        border: "none",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        background: isDark
          ? "linear-gradient(90deg, #0f172a 0%, #1e293b 100%)"
          : "linear-gradient(90deg, #7dd3fc 0%, #fde68a 100%)",
        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.25)",
        transition: "background 450ms ease",
        overflow: "hidden",
      }}
    >
      {/* stars, fade in on dark */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 1 : 0,
          transition: "opacity 450ms ease",
          pointerEvents: "none",
        }}
      >
        <Dot top={6} left={8} size={1.6} />
        <Dot top={13} left={15} size={1.2} />
        <Dot top={7} left={24} size={1.2} />
        <Dot top={16} left={31} size={1.6} />
      </span>

      {/* clouds, fade in on light */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 0 : 1,
          transition: "opacity 450ms ease",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 16,
            left: 7,
            width: 11,
            height: 4,
            borderRadius: 4,
            background: "rgba(255,255,255,0.6)",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 28,
            width: 8,
            height: 3,
            borderRadius: 3,
            background: "rgba(255,255,255,0.5)",
          }}
        />
      </span>

      {/* the sliding knob: sun <-> moon */}
      <span
        style={{
          position: "absolute",
          top: 3,
          left: 3,
          width: knobSize,
          height: knobSize,
          borderRadius: "50%",
          transform: `translateX(${isDark ? knobTravel : 0}px) rotate(${isDark ? 180 : 0}deg)`,
          transition: "transform 450ms cubic-bezier(0.4, 0, 0.2, 1)",
          background: isDark
            ? "radial-gradient(circle at 35% 35%, #f1f5f9, #cbd5e1)"
            : "radial-gradient(circle at 35% 35%, #fef08a, #f59e0b)",
          boxShadow: isDark
            ? "0 0 6px rgba(241,245,249,0.6)"
            : "0 0 8px rgba(245,158,11,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
        }}
      >
        {isDark ? (
          // moon craters
          <span style={{ position: "relative", width: "100%", height: "100%" }}>
            <span style={{ position: "absolute", top: 4, left: 5, width: 3, height: 3, borderRadius: "50%", background: "rgba(100,116,139,0.5)" }} />
            <span style={{ position: "absolute", top: 10, left: 11, width: 2, height: 2, borderRadius: "50%", background: "rgba(100,116,139,0.5)" }} />
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Dot({ top, left, size }) {
  return (
    <span
      style={{
        position: "absolute",
        top,
        left,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#f1f5f9",
      }}
    />
  );
}
