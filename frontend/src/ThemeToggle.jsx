import React from "react";

// An animated day->night switch. The track background gradient crossfades
// and the knob (sun/moon) slides across, based on isDark.
export default function ThemeToggle({ isDark, onToggle }) {
  const trackWidth = 64;
  const trackHeight = 32;
  const knobSize = 26;
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
        <Dot top={7} left={10} size={2} />
        <Dot top={16} left={18} size={1.5} />
        <Dot top={9} left={30} size={1.5} />
        <Dot top={20} left={38} size={2} />
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
            top: 20,
            left: 8,
            width: 14,
            height: 5,
            borderRadius: 5,
            background: "rgba(255,255,255,0.6)",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 34,
            width: 10,
            height: 4,
            borderRadius: 4,
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
            <span style={{ position: "absolute", top: 5, left: 6, width: 4, height: 4, borderRadius: "50%", background: "rgba(100,116,139,0.5)" }} />
            <span style={{ position: "absolute", top: 12, left: 14, width: 3, height: 3, borderRadius: "50%", background: "rgba(100,116,139,0.5)" }} />
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
