import React, { useEffect, useState } from "react";

// Rotates every ROTATE_MS. First two are generic tips; the rest plug other
// projects. Kept as plain strings with a {link} marker so link rendering
// (color, underline, target=_blank) stays consistent without hand-writing
// JSX per slide.
const ROTATE_MS = 4200;
const SLIDES = [
  { text: "Render free tier naps after 15 min idle — first request wakes it back up." },
  { text: "Hang tight, this usually takes 20-50 seconds." },
  {
    text: "Check out another project: {link}",
    linkText: "3rr0r404w4sn0tf0und-sys/Github-Onshape-Upload",
    href: "https://github.com/3rr0r404w4sn0tf0und-sys/Github-Onshape-Upload",
  },
  {
    text: "Also built: {link}",
    linkText: "3rr0r404w4sn0tf0und-sys/printed-parts-calc-cloudflare",
    href: "https://github.com/3rr0r404w4sn0tf0und-sys/printed-parts-calc-cloudflare",
  },
  {
    text: "And: {link}",
    linkText: "ModuDrone-Labs — Open Source Heavy Lift Drone",
    href: "https://github.com/3rr0r404w4sn0tf0und-sys/ModuDrone-Labs",
  },
];

function AlarmClockIcon({ color, size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* bells */}
      <g className="bom-wakeup-bell">
        <path d="M4 4.5 L1.5 7" />
        <path d="M20 4.5 L22.5 7" />
      </g>
      {/* body */}
      <circle cx="12" cy="13" r="8" />
      <circle cx="12" cy="13" r="8" opacity="0.15" fill={color} stroke="none" />
      {/* feet */}
      <path d="M8 20.5 L6.5 22.5" />
      <path d="M16 20.5 L17.5 22.5" />
      {/* top button */}
      <path d="M12 3.2 V1.5" />
      {/* hands */}
      <path d="M12 13 L12 9" />
      <path d="M12 13 L15 14.5" />
    </svg>
  );
}

export default function WakingUp({ theme }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      const t = setTimeout(() => {
        setIndex((i) => (i + 1) % SLIDES.length);
        setVisible(true);
      }, 250);
      return () => clearTimeout(t);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, []);

  const slide = SLIDES[index];
  const [before, after] = slide.text.split("{link}");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "8px 4px" }}>
      <style>{`
        @keyframes bom-wakeup-ring {
          0%, 100% { transform: rotate(0deg); }
          10% { transform: rotate(-12deg); }
          20% { transform: rotate(10deg); }
          30% { transform: rotate(-8deg); }
          40% { transform: rotate(6deg); }
          50% { transform: rotate(-3deg); }
          60%, 100% { transform: rotate(0deg); }
        }
        .bom-wakeup-bell { transform-origin: 12px 6px; animation: bom-wakeup-ring 1.6s ease-in-out infinite; }
        .bom-wakeup-fade { transition: opacity 0.25s ease; }
      `}</style>

      <AlarmClockIcon color={theme.accent} />

      <div style={{ fontWeight: 600, fontSize: 15, color: theme.text }}>Waking up!</div>

      <div
        className="bom-wakeup-fade"
        style={{
          opacity: visible ? 1 : 0,
          fontSize: 12.5, color: theme.muted, textAlign: "center", maxWidth: 320, lineHeight: 1.5, minHeight: 32,
        }}
      >
        {before}
        {slide.href && (
          <a
            href={slide.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: theme.accent, textDecoration: "underline" }}
          >
            {slide.linkText}
          </a>
        )}
        {after}
      </div>
    </div>
  );
}
