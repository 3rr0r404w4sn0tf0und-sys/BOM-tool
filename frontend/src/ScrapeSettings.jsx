import React, { useEffect, useState } from "react";
import { API_URL, apiFetch } from "./api.js";

const SOURCES = [
  { key: "generic", label: "Generic (text-based scraper)", hint: "Any store URL without a dedicated scraper below." },
  { key: "amazon", label: "Amazon", hint: "Uses your Apify token, if you've set one." },
  { key: "mouser", label: "Mouser", hint: "Uses your Apify token, if you've set one." },
  { key: "etsy", label: "Etsy", hint: "Uses your Apify token, if you've set one." },
];

// Preset options shown in each dropdown, 30 min .. ~6 months. Custom
// values saved from elsewhere (or a future preset that isn't in this
// list) still display correctly via the "Custom" fallback branch below.
const PRESETS = [
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Every day" },
  { minutes: 4320, label: "Every 3 days" },
  { minutes: 10080, label: "Every week" },
  { minutes: 20160, label: "Every 2 weeks" },
  { minutes: 43200, label: "Every month" },
  { minutes: 129600, label: "Every 3 months" },
  { minutes: 262800, label: "Every 6 months" },
];

function formatMinutes(m) {
  if (m % 43200 === 0 && m >= 43200) return `${m / 43200} month${m / 43200 === 1 ? "" : "s"}`;
  if (m % 10080 === 0 && m >= 10080) return `${m / 10080} week${m / 10080 === 1 ? "" : "s"}`;
  if (m % 1440 === 0 && m >= 1440) return `${m / 1440} day${m / 1440 === 1 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? "" : "s"}`;
  return `${m} min`;
}

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in the browser's own
// local time, with no timezone suffix -- this converts an ISO string
// (as stored/returned by the API, always UTC) to that shape, and back.
function isoToLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputValueToIso(value) {
  if (!value) return null;
  const d = new Date(value); // parsed as local time by the Date constructor
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function Notice({ theme, message }) {
  if (!message) return null;
  return <p style={{ color: message.ok ? theme.okText : theme.errText, fontSize: 13, margin: "4px 0 12px", lineHeight: 1.45 }}>{message.ok || message.error}</p>;
}

export default function ScrapeSettings({ theme, onBack }) {
  const [settings, setSettings] = useState(null); // { source: minutes }
  const [anchors, setAnchors] = useState(null); // { source: iso|null }
  const [defaults, setDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingSource, setSavingSource] = useState(null);
  const [message, setMessage] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`${API_URL}/api/auth/scrape-schedule`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Could not load scrape schedule.");
        if (!cancelled) {
          setSettings(data.settings);
          setAnchors(data.anchors || {});
          setDefaults(data.defaults);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Saves whichever of {intervalMinutes, anchorAt} changed, merged with
  // whatever's currently known for the other -- the API always writes
  // both columns together, so a partial patch would otherwise clobber
  // the field you didn't mean to touch.
  async function save(source, patch) {
    setMessage(null);
    setSavingSource(source);
    const previousMinutes = settings[source];
    const previousAnchor = anchors[source];
    const nextMinutes = patch.intervalMinutes ?? previousMinutes;
    const nextAnchor = "anchorAt" in patch ? patch.anchorAt : previousAnchor;

    setSettings((s) => ({ ...s, [source]: nextMinutes })); // optimistic
    setAnchors((a) => ({ ...a, [source]: nextAnchor }));

    try {
      const r = await apiFetch(`${API_URL}/api/auth/scrape-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, intervalMinutes: nextMinutes, anchorAt: nextAnchor }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not save that schedule.");
    } catch (e) {
      setSettings((s) => ({ ...s, [source]: previousMinutes })); // revert
      setAnchors((a) => ({ ...a, [source]: previousAnchor }));
      setMessage({ error: e.message });
    } finally {
      setSavingSource(null);
    }
  }

  const cardStyle = { background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: theme.shadow, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" };
  const selectStyle = { width: "100%", boxSizing: "border-box", padding: 11, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text, fontSize: 14 };
  const inputStyle = { ...selectStyle };
  const labelStyle = { display: "block", fontSize: 12.5, color: theme.subtleText, margin: "14px 0 6px" };

  return (
    <div style={{ minHeight: "100vh", background: theme.pageBg || theme.bg, color: theme.text, fontFamily: "sans-serif", padding: "32px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: theme.muted, cursor: "pointer", padding: 0, marginBottom: 24 }}>← Back</button>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Scrape schedule</h1>
        <p style={{ margin: "0 0 28px", color: theme.subtleText, fontSize: 14 }}>
          Choose how often each scraper automatically re-checks prices, from every 30 minutes up to every 6 months,
          and optionally when that cadence should start counting from (e.g. "every day" starting at 3:00 AM lands
          at 3:00 AM every day, not just 24 hours after whenever it last happened to run).
          This doesn't affect refreshing an item by hand — that always runs right away.
        </p>

        {loading && <p style={{ color: theme.subtleText, fontSize: 14 }}>Loading…</p>}
        {loadError && <Notice theme={theme} message={{ error: loadError }} />}

        {!loading && settings && SOURCES.map(({ key, label, hint }) => {
          const value = settings[key] ?? defaults?.[key];
          const isPreset = PRESETS.some((p) => p.minutes === value);
          const anchorIso = anchors[key];
          const anchorLocalValue = isoToLocalInputValue(anchorIso);
          const disabled = savingSource === key;
          return (
            <div style={cardStyle} key={key}>
              <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{label}</h2>
              <p style={{ margin: "0 0 14px", color: theme.subtleText, fontSize: 13 }}>{hint}</p>

              <label style={{ ...labelStyle, marginTop: 0 }}>Repeats</label>
              <select
                value={isPreset ? value : "custom"}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  save(key, { intervalMinutes: Number(e.target.value) });
                }}
                style={{ ...selectStyle, opacity: disabled ? 0.6 : 1 }}
              >
                {!isPreset && <option value="custom">Custom — every {formatMinutes(value)}</option>}
                {PRESETS.map((p) => (
                  <option key={p.minutes} value={p.minutes}>{p.label}</option>
                ))}
              </select>

              <label style={labelStyle}>Starts at (optional)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="datetime-local"
                  value={anchorLocalValue}
                  disabled={disabled}
                  onChange={(e) => save(key, { anchorAt: localInputValueToIso(e.target.value) })}
                  style={{ ...inputStyle, opacity: disabled ? 0.6 : 1, flex: 1 }}
                />
                {anchorIso && (
                  <button
                    onClick={() => save(key, { anchorAt: null })}
                    disabled={disabled}
                    title="Clear start time"
                    style={{ border: `1px solid ${theme.border}`, background: "none", color: theme.subtleText, borderRadius: 8, padding: "10px 12px", cursor: disabled ? "default" : "pointer", fontSize: 13 }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: theme.subtleText }}>
                {anchorIso
                  ? `Scrapes land on this cadence counting from ${new Date(anchorIso).toLocaleString()} (your local time).`
                  : "No start time set — cadence is aligned to a fixed internal reference instead."}
              </p>

              {disabled && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: theme.subtleText }}>Saving…</p>}
            </div>
          );
        })}

        <Notice theme={theme} message={message} />
      </div>
    </div>
  );
}
