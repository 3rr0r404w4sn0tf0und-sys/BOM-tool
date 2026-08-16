// Light/dark theme tokens + persistence.
// Persisted choice wins; otherwise falls back to system preference.

export const THEME_STORAGE_KEY = "bom-tool-theme";

export const themes = {
  light: {
    name: "light",
    bg: "#f8fafc",
    cardBg: "#ffffff",
    text: "#111111",
    muted: "#94a3b8",
    subtleText: "#475569",
    border: "#e2e8f0",
    accent: "#111111",
    accentText: "#ffffff",
    warnBg: "#fef3c7",
    warnText: "#92400e",
    errBg: "#fee2e2",
    errText: "#b91c1c",
    okBg: "#dcfce7",
    okText: "#166534",
    rowBorder: "#eeeeee",
    linkColor: "#475569",
  },
  dark: {
    name: "dark",
    bg: "#0f172a",
    cardBg: "#1e293b",
    text: "#f1f5f9",
    muted: "#64748b",
    subtleText: "#cbd5e1",
    border: "#334155",
    accent: "#f1f5f9",
    accentText: "#0f172a",
    warnBg: "#422006",
    warnText: "#fbbf24",
    errBg: "#450a0a",
    errText: "#fca5a5",
    okBg: "#052e16",
    okText: "#86efac",
    rowBorder: "#334155",
    linkColor: "#94a3b8",
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
