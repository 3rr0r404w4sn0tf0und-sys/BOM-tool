import React from "react";

// Simple, consistent line-art icons (stroke-based) used in place of emoji
// throughout the app. Each accepts a `color` and `size` prop.

export function IconGear({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a1.6 1.6 0 0 0 .32 1.76l.05.06a1.94 1.94 0 1 1-2.75 2.75l-.06-.05a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-1 1.47V19.4a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.76.32l-.06.05a1.94 1.94 0 1 1-2.75-2.75l.05-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-1H4.6a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.76l-.05-.06A1.94 1.94 0 1 1 8.54 3.6l.06.05a1.6 1.6 0 0 0 1.76.32H10.5a1.6 1.6 0 0 0 1-1.47V2.6a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.76-.32l.06-.05a1.94 1.94 0 1 1 2.75 2.75l-.05.06a1.6 1.6 0 0 0-.32 1.76V8.5a1.6 1.6 0 0 0 1.47 1h.09a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.47 1Z" />
    </svg>
  );
}

export function IconLogout({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconWarning({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="17" r="0.9" fill={color} stroke="none" />
    </svg>
  );
}

export function IconEnvelope({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
      <path d="M3.2 6.3 12 13l8.8-6.7" />
    </svg>
  );
}

export function IconCoin({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M14.8 9.3a2.6 2.6 0 0 0-2.5-1.6c-1.5 0-2.6.9-2.6 2s.9 1.6 2.6 2c1.7.4 2.6 1 2.6 2.1s-1.1 2-2.6 2a2.7 2.7 0 0 1-2.6-1.7" />
    </svg>
  );
}

export function IconUnlock({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="11" width="15" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 7.4-2.1" />
    </svg>
  );
}
