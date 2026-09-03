// Applied synchronously, before first paint, so the page (including native
// scrollbars and form controls, which key off color-scheme) never flashes
// light before React mounts and runs its own theme effect. Mirrors the
// storage key / fallback logic in theme.js. Kept as a separate same-origin
// file (not an inline <script>) so it works under this app's
// `script-src 'self'` CSP without needing a nonce.
(function () {
  try {
    var stored = window.localStorage.getItem("bom-tool-theme");
    var name = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
    root.dataset.theme = name;
    root.style.colorScheme = name;
  } catch (e) {}
})();
