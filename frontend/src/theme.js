// Light/dark theme tokens + persistence.
// Persisted choice wins; otherwise falls back to system preference.

export const THEME_STORAGE_KEY = "bom-tool-theme";

export const themes = {
  light: {
    name: "light",
    pageBg: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 52%, #f8fafc 100%)",
    bg: "#f8fafc",
    cardBg: "rgba(255,255,255,0.88)",
    text: "#0f172a",
    muted: "#64748b",
    subtleText: "#475569",
    border: "#dbe3ef",
    accent: "#4f46e5",
    accentText: "#ffffff",
    accentSoft: "#eef2ff",
    error: "#dc2626",
    warnBg: "#fff7ed",
    warnText: "#9a3412",
    errBg: "#fef2f2",
    errText: "#b91c1c",
    okBg: "#f0fdf4",
    okText: "#15803d",
    rowBorder: "#e8edf5",
    linkColor: "#4f46e5",
    shadow: "0 10px 30px rgba(15,23,42,0.07)",
    shadowHover: "0 16px 40px rgba(15,23,42,0.11)",
    inputBg: "rgba(255,255,255,0.96)",
  },
  dark: {
    name: "dark",
    pageBg: "radial-gradient(circle at 15% 0%, #172554 0%, #0b1020 42%, #070b14 100%)",
    bg: "#0b1020",
    cardBg: "rgba(17,24,39,0.82)",
    text: "#f8fafc",
    muted: "#94a3b8",
    subtleText: "#cbd5e1",
    border: "#293548",
    accent: "#818cf8",
    accentText: "#0b1020",
    accentSoft: "#1e2547",
    error: "#f87171",
    warnBg: "#2b2110",
    warnText: "#fbbf24",
    errBg: "#2a1218",
    errText: "#fca5a5",
    okBg: "#0b2419",
    okText: "#86efac",
    rowBorder: "#202b3d",
    linkColor: "#a5b4fc",
    shadow: "0 14px 40px rgba(0,0,0,0.28)",
    shadowHover: "0 20px 50px rgba(0,0,0,0.38)",
    inputBg: "rgba(9,14,27,0.78)",
  },
};

export function getInitialThemeName() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall through to system pref
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function persistThemeName(name) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, name);
  } catch {
    // ignore — non-fatal if storage is unavailable
  }
}

export function getTheme(name) {
  return themes[name] || themes.light;
}
