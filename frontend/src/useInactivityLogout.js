import { useEffect, useRef } from "react";

const STORAGE_KEY = "bom-tool-last-activity";
const TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3h
const CHECK_INTERVAL_MS = 30 * 1000; // poll every 30s, cheap and responsive enough
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll"];
// Activity handlers fire on essentially every mouse move / scroll tick, so
// timestamps are throttled to avoid hammering localStorage/JS on hot paths.
const WRITE_THROTTLE_MS = 5000;

/**
 * Logs the person out after `TIMEOUT_MS` of no interaction anywhere in the
 * app, in *any* tab. Activity is tracked via a shared localStorage
 * timestamp (rather than a plain in-memory timer) so that:
 *   - switching between multiple open tabs of the app counts as activity
 *     for all of them, instead of an idle background tab logging everyone
 *     out from under an active one;
 *   - a tab that was asleep/backgrounded (throttled timers) still logs out
 *     promptly once it's checked again, rather than drifting.
 */
export function useInactivityLogout(active, onTimeout) {
  const lastWriteRef = useRef(0);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return;

    function markActive() {
      const now = Date.now();
      if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      try { window.localStorage.setItem(STORAGE_KEY, String(now)); } catch {}
    }

    function getLastActivity() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? Number(raw) : NaN;
        return Number.isFinite(parsed) ? parsed : Date.now();
      } catch {
        return Date.now();
      }
    }

    function check() {
      if (Date.now() - getLastActivity() >= TIMEOUT_MS) {
        onTimeoutRef.current();
      }
    }

    // Seed a timestamp as soon as a session starts so a freshly-logged-in
    // tab with an empty/stale stored value isn't logged out immediately.
    markActive();

    function onVisible() {
      if (!document.hidden) { markActive(); check(); }
    }

    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, markActive, { passive: true });
    document.addEventListener("visibilitychange", onVisible);

    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActive);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [active]);
}
