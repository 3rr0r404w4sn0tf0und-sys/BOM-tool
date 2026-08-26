const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export { API_URL };

export function getCsrfToken() {
  return document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("bom-csrf="))
    ?.slice("bom-csrf=".length) || "";
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", getCsrfToken());

  const { timeoutMs: requestedTimeout, signal: externalSignal, ...fetchOptions } = options;
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
