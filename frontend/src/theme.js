// Theme tokens are CSS-variable references, not concrete colors. Keeping this
// object stable is important: switching light/dark mode should update CSS,
// not cause every 200+ BOM row to receive a new `theme` object and re-render.
export const THEME_STORAGE_KEY = "bom-tool-theme";

export const themes = {
  light: {
    name: "light",
    pageBg: "linear-gradient(135deg, #fffaf2 0%, #f4f7ff 32%, #fff5fb 66%, #f3fff9 100%)",
    bg: "#f8fafc",
    cardBg: "rgba(255,255,255,0.86)",
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
    pageBg: "radial-gradient(circle at 18% 4%, #172554 0%, #0d1428 38%, #080c18 72%, #060912 100%)",
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

const cssTheme = Object.freeze(Object.fromEntries(Object.keys(themes.light).map((key) => [key, `var(--bom-${key})`])));

export function getInitialThemeName() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function persistThemeName(name) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, name); } catch {}
}

// Stable reference returned for every theme. Components can safely memoize
// against `theme` while CSS variables update underneath them.
export function getTheme() {
  return cssTheme;
}

export function applyTheme(name) {
  const root = document.documentElement;
  const actual = themes[name] || themes.light;
  for (const [key, value] of Object.entries(actual)) {
    if (key !== "name") root.style.setProperty(`--bom-${key}`, value);
  }
  root.dataset.theme = actual.name;
  root.style.colorScheme = actual.name;
}
