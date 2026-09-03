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

// Called on logout (and should be called on any session change) so a stale
// token from the previous session is never reused. The token is an HMAC of
// the session id server-side, so a new session always needs a fresh fetch --
// without this reset, re-logging in inside the same tab silently keeps
// sending the old session's token and every mutation 403s.
export function resetCsrfToken() {
  csrfToken = "";
  csrfPromise = null;
}

async function ensureCsrfToken(forceRefresh = false) {
  if (csrfToken && !forceRefresh) return csrfToken;
  if (forceRefresh) csrfToken = "";
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
  const method = (fetchOptions.method || "GET").toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const timeoutMs = requestedTimeout ?? (fetchOptions.body instanceof FormData ? 60_000 : 15_000);
  const requestUrl = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;

  const perform = (csrfHeader) => {
    const headers = new Headers(fetchOptions.headers || {});
    if (csrfHeader) headers.set("X-CSRF-Token", csrfHeader);
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

  if (isMutation) {
    const runMutation = async () => {
      const token = skipCsrf ? null : await ensureCsrfToken();
      let response = await perform(token);
      // A 403 here almost always means the cached CSRF token belongs to a
      // session that's no longer current (e.g. logged out and back in, or
      // an expired session was silently refreshed) rather than an actual
      // forgery attempt. Force a fresh token once and retry transparently
      // instead of leaving the mutation (e.g. a delete) silently failing.
      if (!skipCsrf && response.status === 403) {
        const retryToken = await ensureCsrfToken(true);
        response = await perform(retryToken);
      }
      return response;
    };

    // Serialize mutations globally so rapid edits and undo/redo are committed
    // in the same order the user issued them. Failed optimistic mutations are
    // reconciled by App via the event below.
    const previous = apiFetch._mutationQueue || Promise.resolve();
    const current = previous.catch(() => {}).then(runMutation);
    apiFetch._mutationQueue = current.catch(() => {});
    const response = await current;
    if (!response.ok && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bom-api-mutation-failed", { detail: { url: requestUrl, status: response.status } }));
    }
    return response;
  }

  return perform();
}
