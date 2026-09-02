const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export { API_URL };

let csrfToken = "";
let csrfPromise = null;

export function setCsrfToken(token) {
  csrfToken = typeof token === "string" ? token : "";
  return csrfToken;
}

export function getCsrfToken() {
  return csrfToken;
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_URL}/api/auth/csrf`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`CSRF bootstrap failed (${res.status})`);
        const data = await res.json();
        if (!data?.csrfToken) throw new Error("CSRF bootstrap returned no token");
        csrfToken = data.csrfToken;
        return csrfToken;
      })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

export async function apiFetch(path, options = {}) {
  const { timeoutMs: requestedTimeout, signal: externalSignal, skipCsrf = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const method = (fetchOptions.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !skipCsrf) {
    headers.set("X-CSRF-Token", await ensureCsrfToken());
  }
  const timeoutMs = requestedTimeout ?? (fetchOptions.body instanceof FormData ? 60_000 : 15_000);
  const requestUrl = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;

  const perform = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let removeExternal = null;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else {
        removeExternal = () => controller.abort();
        externalSignal.addEventListener("abort", removeExternal, { once: true });
      }
    }
    return fetch(requestUrl, {
      ...fetchOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timer);
      if (removeExternal) externalSignal.removeEventListener("abort", removeExternal);
    });
  };

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    // Serialize mutations globally so rapid edits and undo/redo are committed
    // in the same order the user issued them. Failed optimistic mutations are
    // reconciled by App via the event below.
    const previous = apiFetch._mutationQueue || Promise.resolve();
    const current = previous.catch(() => {}).then(perform);
    apiFetch._mutationQueue = current.catch(() => {});
    const response = await current;
    if (!response.ok && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bom-api-mutation-failed", { detail: { url: requestUrl, status: response.status } }));
    }
    return response;
  }

  return perform();
}
