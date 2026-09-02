import React, { useState, useEffect, useRef, useCallback } from "react";
import { API_URL, apiFetch } from "./api.js";
import Footer from "./Footer.jsx";
import PrivacyModal from "./PrivacyModal.jsx";
import SettingsMenu from "./SettingsMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import SectionTable from "./SectionTable.jsx";
import WakingUp from "./WakingUp.jsx";
import ApiModal from "./ApiModal.jsx";
import ApifyKeyModal from "./ApifyKeyModal.jsx";
import ShareModal from "./ShareModal.jsx";
import { IconWarning, IconEnvelope, IconCoin, IconPlus, IconTable, IconArrowLeft, IconFolder, IconTrash, IconPencil, IconPlug, IconUpload, IconDownload, IconRefresh, IconShare } from "./Icons.jsx";
import { getInitialThemeName, persistThemeName, getTheme } from "./theme.js";
import { calculateTotals, allItems } from "./totals.js";
import { useUndoRedo } from "./useUndoRedo.js";
import { useBomPolling } from "./useBomPolling.js";
import RefreshMenu from "./RefreshMenu.jsx";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVACY_SEEN_KEY = "bom-tool-privacy-seen";
const VERIFY_PENDING_SECONDS = 15;

// This is a minimal scaffold, not the full editor yet. It proves the
// API round-trip (login -> create BOM -> fetch totals) so the rest of
// the UI (rich text rows, emoji section titles, drag to reorder, etc.)
// can be built against a known-working backend.


export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [bom, setBom] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState(null); // null | "checking" | "success" | "error"
  const [verifyMessage, setVerifyMessage] = useState(null);
  const [resendStatus, setResendStatus] = useState(null); // null | "sending" | "sent" | "error"

  const [themeName, setThemeName] = useState(getInitialThemeName);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [justRegisteredEmail, setJustRegisteredEmail] = useState(null);
  const [verifyCountdown, setVerifyCountdown] = useState(VERIFY_PENDING_SECONDS);
  const [authChecking, setAuthChecking] = useState(true);
  const [canvasMenu, setCanvasMenu] = useState(null);
  const [bomList, setBomList] = useState(null); // null = not loaded yet, [] = loaded/empty
  const [bomListLoading, setBomListLoading] = useState(false);
  const [openingBomId, setOpeningBomId] = useState(null);
  const [bomLoadError, setBomLoadError] = useState(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showApiModal, setShowApiModal] = useState(false);
  const [showApifyKeyModal, setShowApifyKeyModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [accessDeniedNotice, setAccessDeniedNotice] = useState(null);
  const [sheetImporting, setSheetImporting] = useState(false);
  const [sheetImportError, setSheetImportError] = useState(null);
  const [sheetImportJustSucceeded, setSheetImportJustSucceeded] = useState(false);
  const sheetFileInputRef = useRef(null);
  const [sheetExporting, setSheetExporting] = useState(false);
  const [refreshingFilter, setRefreshingFilter] = useState(null); // null | "amazon" | "mouser" | "other" | "all"
  const [taxRateEditing, setTaxRateEditing] = useState(false);
  const [taxRateDraft, setTaxRateDraft] = useState("");
  const [dragSectionId, setDragSectionId] = useState(null);
  const [dragOverSectionId, setDragOverSectionId] = useState(null);
  const theme = getTheme(themeName);
  const history = useUndoRedo();

  // Stable live reference used by mutation callbacks so they can avoid
  // closing over the whole BOM object and forcing every table to re-render.
  const bomRef = useRef(bom);
  useEffect(() => { bomRef.current = bom; }, [bom]);

  // Applies a local edit to bom.sections and recomputes totals from it --
  // this is what lets add/delete/edit/reorder feel instant instead of
  // waiting on a full loadBom() round trip after every action.
  const setSections = useCallback((updater) => {
    setBom((prev) => {
      if (!prev) return prev;
      const sections = updater(prev.sections);
      return { ...prev, sections, totals: calculateTotals(allItems(sections), prev.tax_rate) };
    });
  }, []);

  const authHeaders = useCallback((extra) => ({ ...(extra || {}) }), []);
  const jsonHeaders = useCallback(() => ({ "Content-Type": "application/json" }), []);

  // --- Row (item) mutations: optimistic local update + undo/redo command,
  // API call fired in the background. All rely on soft-delete/restore on
  // the backend so ids never change across undo/redo, however many times
  // a row gets deleted and brought back. Each is wrapped in useCallback
  // with a stable dependency list (token, and the stable helpers above)
  // -- they read the live BOM via bomRef instead of closing over `bom`,
  // so their identity never changes and SectionTable's React.memo holds. ---

  const addRow = useCallback(async (sectionId) => {
    const isSheet = bomRef.current?.doc_type === "sheet";
    const res = await apiFetch(`${API_URL}/api/boms/sections/${sectionId}/items`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(isSheet ? { name: "", qty: 1, checked: false } : { name: "New item", qty: 1 }),
    });
    const item = await res.json();
    setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, item] } : s)));
    history.push({
      undo: () => {
        setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== item.id) } : s)));
        apiFetch(`${API_URL}/api/boms/items/${item.id}`, { method: "DELETE", headers: authHeaders() });
      },
      redo: () => {
        setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, item] } : s)));
        apiFetch(`${API_URL}/api/boms/items/${item.id}/restore`, { method: "POST", headers: authHeaders() });
      },
    });
  }, [jsonHeaders, authHeaders, setSections, history]);

  const deleteRow = useCallback((sectionId, itemId) => {
    const section = bomRef.current.sections.find((s) => s.id === sectionId);
    const index = section.items.findIndex((i) => i.id === itemId);
    const removedItem = section.items[index];
    if (!removedItem) return;

    function apply() {
      setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s)));
      apiFetch(`${API_URL}/api/boms/items/${itemId}`, { method: "DELETE", headers: authHeaders() });
    }
    function revert() {
      setSections((sections) => sections.map((s) => {
        if (s.id !== sectionId) return s;
        const items = [...s.items];
        items.splice(Math.min(index, items.length), 0, removedItem);
        return { ...s, items };
      }));
      apiFetch(`${API_URL}/api/boms/items/${itemId}/restore`, { method: "POST", headers: authHeaders() });
    }
    apply();
    history.push({ undo: revert, redo: apply });
  }, [authHeaders, setSections, history]);

  const patchItem = useCallback((sectionId, itemId, patch) => {
    const section = bomRef.current.sections.find((s) => s.id === sectionId);
    const item = section?.items.find((i) => i.id === itemId);
    if (!item) return;
    const before = {};
    Object.keys(patch).forEach((k) => (before[k] = item[k]));

    function apply(p) {
      setSections((sections) => sections.map((s) => (s.id !== sectionId ? s : { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...p } : i)) })));
      apiFetch(`${API_URL}/api/boms/items/${itemId}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(p) });
    }
    apply(patch);
    history.push({ undo: () => apply(before), redo: () => apply(patch) });
  }, [jsonHeaders, setSections, history]);

  const reorderItems = useCallback((sectionId, orderedIds) => {
    const section = bomRef.current.sections.find((s) => s.id === sectionId);
    const prevOrder = section.items.map((i) => i.id);

    function apply(ids) {
      setSections((sections) => sections.map((s) => {
        if (s.id !== sectionId) return s;
        const byId = Object.fromEntries(s.items.map((i) => [i.id, i]));
        return { ...s, items: ids.map((id) => byId[id]).filter(Boolean) };
      }));
      apiFetch(`${API_URL}/api/boms/sections/${sectionId}/items/reorder`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ orderedIds: ids }),
      });
    }
    apply(orderedIds);
    history.push({ undo: () => apply(prevOrder), redo: () => apply(orderedIds) });
  }, [jsonHeaders, setSections, history]);

  // --- Table (section) mutations ---

  const deleteTable = useCallback((sectionId) => {
    const index = bomRef.current.sections.findIndex((s) => s.id === sectionId);
    const removedSection = bomRef.current.sections[index];
    if (!removedSection) return;

    function apply() {
      setBom((prev) => {
        const sections = prev.sections.filter((s) => s.id !== sectionId);
        return { ...prev, sections, totals: calculateTotals(allItems(sections), prev.tax_rate) };
      });
      apiFetch(`${API_URL}/api/boms/sections/${sectionId}`, { method: "DELETE", headers: authHeaders() });
    }
    function revert() {
      setBom((prev) => {
        const sections = [...prev.sections];
        sections.splice(Math.min(index, sections.length), 0, removedSection);
        return { ...prev, sections, totals: calculateTotals(allItems(sections), prev.tax_rate) };
      });
      apiFetch(`${API_URL}/api/boms/sections/${sectionId}/restore`, { method: "POST", headers: authHeaders() });
    }
    apply();
    history.push({ undo: revert, redo: apply });
  }, [authHeaders, history]);

  const toggleDocType = useCallback(() => {
    const current = bomRef.current;
    if (!current) return;
    const from = current.doc_type || "bom";
    const to = from === "sheet" ? "bom" : "sheet";

    function apply(docType) {
      setBom((prev) => (prev ? { ...prev, doc_type: docType } : prev));
      setBomList((prev) => (prev ? prev.map((b) => (b.id === current.id ? { ...b, doc_type: docType } : b)) : prev));
      apiFetch(`${API_URL}/api/boms/${current.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ doc_type: docType }),
      });
    }
    apply(to);
    history.push({ undo: () => apply(from), redo: () => apply(to) });
  }, [jsonHeaders, history]);

  const setColumnCount = useCallback((count) => {
    const current = bomRef.current;
    if (!current) return;
    const from = current.column_count || 3;
    const to = Math.max(1, Math.min(7, count));
    if (to === from) return;

    function apply(columnCount) {
      setBom((prev) => (prev ? { ...prev, column_count: columnCount } : prev));
      apiFetch(`${API_URL}/api/boms/${current.id}/columns`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ column_count: columnCount }),
      });
    }
    apply(to);
    history.push({ undo: () => apply(from), redo: () => apply(to) });
  }, [jsonHeaders, history]);

  const renameColumn = useCallback((index, label) => {
    const current = bomRef.current;
    if (!current) return;
    const fromLabels = current.column_labels ? [...current.column_labels] : [];
    const toLabels = [...fromLabels];
    toLabels[index] = label;

    function apply(labels) {
      setBom((prev) => (prev ? { ...prev, column_labels: labels } : prev));
      apiFetch(`${API_URL}/api/boms/${current.id}/columns`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ column_count: current.column_count, column_labels: labels }),
      });
    }
    apply(toLabels);
    history.push({ undo: () => apply(fromLabels), redo: () => apply(toLabels) });
  }, [jsonHeaders, history]);

  const renameSection = useCallback((sectionId, title) => {
    const section = bomRef.current.sections.find((s) => s.id === sectionId);    if (!section) return;
    const before = section.title;

    function apply(t) {
      setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, title: t } : s)));
      apiFetch(`${API_URL}/api/boms/sections/${sectionId}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ title: t }) });
    }
    apply(title);
    history.push({ undo: () => apply(before), redo: () => apply(title) });
  }, [jsonHeaders, setSections, history]);

  const setSectionEmoji = useCallback((sectionId, emoji) => {
    const section = bomRef.current.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const before = section.emoji ?? null;

    function apply(e) {
      setSections((sections) => sections.map((s) => (s.id === sectionId ? { ...s, emoji: e } : s)));
      apiFetch(`${API_URL}/api/boms/sections/${sectionId}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ emoji: e || "" }) });
    }
    apply(emoji);
    history.push({ undo: () => apply(before), redo: () => apply(emoji) });
  }, [jsonHeaders, setSections, history]);

  const reorderSections = useCallback((orderedIds) => {
    const prevOrder = bomRef.current.sections.map((s) => s.id);

    function apply(ids) {
      setBom((prev) => {
        const byId = Object.fromEntries(prev.sections.map((s) => [s.id, s]));
        const sections = ids.map((id) => byId[id]).filter(Boolean);
        return { ...prev, sections, totals: calculateTotals(allItems(sections), prev.tax_rate) };
      });
      apiFetch(`${API_URL}/api/boms/${bomRef.current.id}/sections/reorder`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ orderedIds: ids }),
      });
    }
    apply(orderedIds);
    history.push({ undo: () => apply(prevOrder), redo: () => apply(orderedIds) });
  }, [jsonHeaders, history]);

  const onSectionDragStart = useCallback((e, sectionId) => {
    setDragSectionId(sectionId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sectionId);
  }, []);
  const onSectionDragOver = useCallback((e, sectionId) => {
    if (!dragSectionId || dragSectionId === sectionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSectionId((over) => (over === sectionId ? over : sectionId));
  }, [dragSectionId]);
  const onSectionDragEnd = useCallback(() => {
    setDragSectionId(null);
    setDragOverSectionId(null);
  }, []);
  const onSectionDrop = useCallback((e, targetSectionId) => {
    e.preventDefault();
    const draggedId = dragSectionId;
    setDragSectionId(null);
    setDragOverSectionId(null);
    if (!draggedId || draggedId === targetSectionId) return;
    const ids = bomRef.current.sections.map((s) => s.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetSectionId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedId);
    reorderSections(ids);
  }, [dragSectionId, reorderSections]);

  // Authentication is kept in an HttpOnly cookie. The frontend never stores
  // or receives the JWT, so there is no bearer token in localStorage or JS memory.
  function persistToken() {}

  function setSession(_token, u) {
    setToken("session");
    setUser(u);
  }

  function toggleTheme() {
    setThemeName((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      persistThemeName(next);
      return next;
    });
  }

  // Keep the actual page background (outside our themed containers) in sync,
  // so there's no white/mismatched edge around the app on load or overscroll.
  useEffect(() => {
    document.body.style.background = theme.bg;
    document.documentElement.style.background = theme.bg;
  }, [theme.bg]);

  // Show the privacy notice once, automatically, on a person's first visit.
  // It stays reachable afterward via the footer link regardless.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(PRIVACY_SEEN_KEY)) {
        setShowPrivacy(true);
        window.localStorage.setItem(PRIVACY_SEEN_KEY, "1");
      }
    } catch {
      // localStorage unavailable — just skip the auto-popup, footer link still works
    }
  }, []);

  // Countdown + auto-close for the "verification email sent" interstitial
  // shown right after registering (Brevo sends a link, not a code, so there's
  // nothing to type here — the tab is safe to close).
  useEffect(() => {
    if (!justRegisteredEmail) return;
    setVerifyCountdown(VERIFY_PENDING_SECONDS);
    const interval = setInterval(() => {
      setVerifyCountdown((s) => {
        if (s <= 1) {
          clearInterval(interval);
          window.close();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [justRegisteredEmail]);

  async function logout() {
    try {
      await apiFetch(`${API_URL}/api/auth/logout`, { method: "POST" });
    } catch {}
    setToken(null);
    setUser(null);
    setBom(null);
    setBomList(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  }

  // On load, ask the API whether the HttpOnly session cookie is still valid.
  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_URL}/api/auth/me`)
      .then((r) => {
        if (!r.ok) throw new Error("no session");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.user) {
          setToken("session");
          setUser(data.user);
        } else {
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => { cancelled = true; };
  }, []);

  // On load, check for the email-verification link or an OAuth error.
  // Successful OAuth callbacks set the HttpOnly session cookie on the API before redirecting here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify_token");
    const oauthError = params.get("oauth_error");

    if (oauthError) {
      setAuthError(oauthError);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (!verifyToken) return;

    setVerifyStatus("checking");
    apiFetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.verified) {
          setVerifyStatus("success");
          setVerifyMessage("Email verified! You can log in now.");
          setUser((u) => (u ? { ...u, email_verified: true } : u));
        } else {
          setVerifyStatus("error");
          setVerifyMessage(data.error || "Verification failed.");
        }
        // Clean the token out of the URL so refreshing doesn't re-submit it.
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        setVerifyStatus("error");
        setVerifyMessage("Could not reach the server to verify. Try again.");
      });
  }, []);

  function loginWithGithub() {
    window.location.href = `${API_URL}/api/auth/github/start`;
  }

  function clientValidate() {
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (mode === "register" && password !== confirmPassword) return "Passwords don't match";
    return null;
  }

  // Live (as-you-type) mismatch check, distinct from clientValidate()'s
  // on-submit check -- only flags once confirmPassword has content, so the
  // field doesn't turn red before the user's typed anything into it yet.
  const passwordsMismatch = mode === "register" && confirmPassword.length > 0 && password !== confirmPassword;
  const registerDisabled =
    authLoading || !email || !password || (mode === "register" && (!confirmPassword || passwordsMismatch));

  async function login() {
    const validationError = clientValidate();
    if (validationError) return setAuthError(validationError);

    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.user) {
        setSession(null, data.user);
      } else setAuthError(data.error || "Login failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function register() {
    const validationError = clientValidate();
    if (validationError) return setAuthError(validationError);

    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.user) {
        setSession(null, data.user);
        setJustRegisteredEmail(email.trim());
      } else setAuthError(data.error || "Registration failed");
    } catch (e) {
      setAuthError("Could not reach the server. It may be waking up — try again in a few seconds.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function resendVerification() {
    setResendStatus("sending");
    try {
      const res = await apiFetch(`${API_URL}/api/auth/resend-verification`, {
        method: "POST",
        headers: { },
      });
      const data = await res.json();
      setResendStatus(data.sent ? "sent" : "error");
    } catch {
      setResendStatus("error");
    }
  }

  async function createBom(title, docType) {
    const res = await apiFetch(`${API_URL}/api/boms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: title || (docType === "sheet" ? "Untitled Sheet" : "Untitled BOM"), doc_type: docType || "bom" }),
    });
    const data = await res.json();
    setBomList(null);
    loadBom(data.id);
  }

  async function loadBom(id) {
    setOpeningBomId(id);
    setBomLoadError(null);
    setSheetImportJustSucceeded(false);
    // Previously this had no try/catch: if the fetch failed, or the
    // response wasn't valid JSON (e.g. a 500/timeout returning an HTML
    // error page instead), the exception meant setOpeningBomId(null)
    // below never ran -- the button was stuck showing its loading
    // spinner forever with no error, no matter how many times you
    // clicked. This is what "click it, it just loads forever" was.
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${id}`, {
        headers: { },
      });
      if (!res.ok) {
        // 404 covers both "doesn't exist" and "exists but you have no
        // access" -- deliberately not distinguished, so a bad guess at
        // someone else's BOM id can't be used to confirm it's real.
        let message = res.status === 404
          ? "You don't have access to this BOM, or it doesn't exist."
          : `Failed to load BOM (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error && res.status !== 404) message = body.error;
        } catch {
          // response wasn't JSON (e.g. a raw 500/502 HTML page) -- fall
          // back to the generic status-based message above
        }
        setAccessDeniedNotice(res.status === 404 ? message : null);
        throw new Error(message);
      }
      setAccessDeniedNotice(null);
      setBom(await res.json());
    } catch (e) {
      console.error("loadBom failed:", e);
      setBomLoadError(e.message || "Failed to load this BOM. Please try again.");
    } finally {
      setOpeningBomId(null);
    }
  }

  const { pollBomQuietly, onItemResolved } = useBomPolling(bom, setBom);

  // Any failed optimistic mutation forces a quiet server reconciliation,
  // rolling the UI back to the authoritative database state.
  useEffect(() => {
    const onMutationFailed = () => {
      if (bomRef.current) pollBomQuietly(bomRef.current.id);
    };
    window.addEventListener("bom-api-mutation-failed", onMutationFailed);
    return () => window.removeEventListener("bom-api-mutation-failed", onMutationFailed);
  }, [pollBomQuietly]);

  async function loadBomList() {
    setBomListLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/boms`, {
        headers: { },
      });
      setBomList(await res.json());
    } finally {
      setBomListLoading(false);
    }
  }

  function exitBom() {
    setBom(null);
    loadBomList();
  }

  async function renameBom() {
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!next || next === bom.title) return;
    await apiFetch(`${API_URL}/api/boms/${bom.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify({ title: next }),
    });
    setBomList(null);
    loadBom(bom.id);
  }

  async function saveTaxRate() {
    setTaxRateEditing(false);
    const pct = parseFloat(taxRateDraft);
    if (!Number.isFinite(pct) || pct < 0) return;
    const rate = Math.round((pct / 100) * 10000) / 10000; // matches NUMERIC(6,4)
    if (rate === Number(bom.tax_rate)) return;
    await apiFetch(`${API_URL}/api/boms/${bom.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify({ tax_rate: rate }),
    });
    loadBom(bom.id);
  }

  async function deleteBom(id) {
    await apiFetch(`${API_URL}/api/boms/${id}`, {
      method: "DELETE",
      headers: { },
    });
    loadBomList();
  }

  async function addTable() {
    if (!bom) return;
    // sort_order is intentionally omitted -- the backend now computes
    // "end of list" itself (see api/routes/boms.js), which is the fix
    // for new tables/rows landing in the wrong place.
    const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/sections`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "New Table" }),
    });
    const section = await res.json();
    const newSection = { ...section, items: [] };
    setBom((prev) => (prev ? { ...prev, sections: [...prev.sections, newSection] } : prev));
    history.push({
      undo: () => {
        setBom((prev) => {
          const sections = prev.sections.filter((s) => s.id !== newSection.id);
          return { ...prev, sections, totals: calculateTotals(allItems(sections), prev.tax_rate) };
        });
        apiFetch(`${API_URL}/api/boms/sections/${newSection.id}`, { method: "DELETE", headers: authHeaders() });
      },
      redo: () => {
        setBom((prev) => (prev ? { ...prev, sections: [...prev.sections, newSection] } : prev));
        apiFetch(`${API_URL}/api/boms/sections/${newSection.id}/restore`, { method: "POST", headers: authHeaders() });
      },
    });
  }

  // Upload a .xlsx/.xls/.csv following the fixed column layout (link in A,
  // optional name override in B, qty in C, D always ignored) — each
  // section-header row in the file becomes a new table here, appended
  // after whatever's already in the BOM.
  function triggerSheetUpload() {
    sheetFileInputRef.current?.click();
  }

  async function refreshItems(filter) {
    if (!bom || refreshingFilter) return;
    setRefreshingFilter(filter);
    setSheetImportJustSucceeded(false);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/refresh-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", },
        body: JSON.stringify({ filter }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Refresh failed");
      }
      await loadBom(bom.id);
    } catch (err) {
      setSheetImportError(err.message || "Refresh failed");
    } finally {
      setRefreshingFilter(null);
    }
  }

  async function importSheet(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !bom) return;

    setSheetImporting(true);
    setSheetImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/import-sheet`, {
        method: "POST",
        headers: { },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Import failed");
      }
      await loadBom(bom.id);
      setSheetImportJustSucceeded(true);
    } catch (err) {
      setSheetImportError(err.message || "Import failed");
    } finally {
      setSheetImporting(false);
    }
  }

  // Downloads the current BOM as a .xlsx via GET /:bomId/export-sheet.
  // Same fixed A/B/C/D column layout importSheet() reads, so a round trip
  // (export -> edit in Excel/Sheets -> re-import) reproduces the BOM.
  async function exportSheet() {
    if (!bom) return;
    setSheetExporting(true);
    setSheetImportError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/boms/${bom.id}/export-sheet`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }
      const blob = await res.blob();
      // Prefer the server's Content-Disposition filename so it matches the
      // BOM title exactly (already sanitized server-side); fall back to a
      // client-side slug if the header is missing for any reason.
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${(bom.title || "BOM").replace(/[^a-z0-9 _-]/gi, "").trim() || "BOM"}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setSheetImportError(err.message || "Export failed");
    } finally {
      setSheetExporting(false);
    }
  }

  // --- URL routing (no react-router; the app only has 4 "pages") ---
  // Paths: /login, /register, /home, /sheet/<25-char id>. This effect runs
  // once auth-check resolves and interprets whatever path the tab opened
  // with, so a bookmarked or shared link lands on the right screen instead
  // of always dumping the person on "/".
  const pendingDeepLinkBomId = useRef(null);
  useEffect(() => {
    if (authChecking) return;
    const path = window.location.pathname;
    const sheetMatch = path.match(/^\/sheet\/([A-Za-z0-9_-]{6,})\/?$/);
    if (!token) {
      // Not logged in: only /login and /register are meaningful; anything
      // else (including a deep-linked /sheet/<id>) falls back to /login,
      // but remembers the sheet id so we can jump straight there post-login.
      if (sheetMatch) pendingDeepLinkBomId.current = sheetMatch[1];
      if (path === "/register") setMode("register");
      else setMode("login");
      return;
    }
    if (sheetMatch) {
      loadBom(sheetMatch[1]);
    }
    // token is set but path was /login, /register, "/", or anything else
    // unrecognized: just let it fall through to /home below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecking, token]);

  // If someone opened a /sheet/<id> link while logged out, once login
  // succeeds jump straight into that BOM instead of landing on /home.
  useEffect(() => {
    if (token && pendingDeepLinkBomId.current) {
      const id = pendingDeepLinkBomId.current;
      pendingDeepLinkBomId.current = null;
      loadBom(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Keep the address bar in sync with whatever screen is actually showing,
  // so refresh/back/forward/share-link all do the right thing.
  useEffect(() => {
    if (authChecking) return;
    const path = !token
      ? mode === "register" ? "/register" : "/login"
      : bom ? `/sheet/${bom.id}` : "/home";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }, [authChecking, token, mode, bom]);

  // Support the browser's back/forward buttons.
  useEffect(() => {
    function onPopState() {
      const path = window.location.pathname;
      const sheetMatch = path.match(/^\/sheet\/([A-Za-z0-9_-]{6,})\/?$/);
      if (!token) {
        setMode(path === "/register" ? "register" : "login");
        return;
      }
      if (sheetMatch) {
        if (!bom || bom.id !== sheetMatch[1]) loadBom(sheetMatch[1]);
      } else if (bom) {
        exitBom();
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, bom]);

  // Load the BOM list once we know who's logged in and haven't opened a BOM.
  useEffect(() => {
    if (token && user && !bom && bomList === null) loadBomList();
  }, [token, user, bom, bomList]);

  const pageShell = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: theme.bg,
    fontFamily: "sans-serif",
    position: "relative",
    zIndex: 1,
  };

  if (authChecking) {
    return (
      <div style={{ ...pageShell, alignItems: "center", justifyContent: "center" }}>
        <WakingUp theme={theme} />
      </div>
    );
  }

  if (justRegisteredEmail) {
    return (
        <div style={pageShell}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
          <div
            style={{
              width: 360,
              maxWidth: "100%",
              background: theme.cardBg,
              color: theme.text,
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10, display: "flex", justifyContent: "center" }}>
              <IconEnvelope size={34} color={theme.text} />
            </div>
            <h2 style={{ margin: "0 0 10px" }}>Verification email sent</h2>
            <p style={{ color: theme.subtleText, fontSize: 14, lineHeight: 1.6, margin: "0 0 6px" }}>
              We sent a verification link to <strong>{justRegisteredEmail}</strong>.
            </p>
            <p style={{ color: theme.subtleText, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
              Check your inbox <strong>and your spam/junk folder</strong> — click the link there to verify.
            </p>
            <p style={{ color: theme.muted, fontSize: 13 }}>
              This tab will close automatically in {verifyCountdown}s.
            </p>
            <button
              onClick={() => window.close()}
              style={{
                marginTop: 14, padding: "8px 16px", cursor: "pointer",
                border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.cardBg, color: theme.text, fontSize: 13,
              }}
            >
              Close now
            </button>
          </div>
        </div>
        <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
        {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
        </div>
    );
  }

  if (!token) {
    return (
      <div style={pageShell}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
          <div style={{ width: 340, maxWidth: "100%", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <SettingsMenu
                theme={theme}
                themeName={themeName}
                onToggleTheme={toggleTheme}
                isLoggedIn={false}
                onLogout={logout}
              />
            </div>

            <div style={{ background: theme.cardBg, borderRadius: 12, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <h2 style={{ margin: "0 0 20px", textAlign: "center", color: theme.text }}>BOM Tool</h2>

              {verifyStatus && (
                <p
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 16,
                    background: verifyStatus === "success" ? theme.okBg : verifyStatus === "error" ? theme.errBg : theme.border,
                    color: verifyStatus === "success" ? theme.okText : verifyStatus === "error" ? theme.errText : theme.subtleText,
                  }}
                >
                  {verifyStatus === "checking" ? "Verifying your email…" : verifyMessage}
                </p>
              )}

              <div style={{ display: "flex", marginBottom: 20, borderBottom: `1px solid ${theme.border}` }}>
                <button
                  onClick={() => { setMode("login"); setAuthError(null); }}
                  style={{
                    flex: 1, padding: 10, border: "none", cursor: "pointer",
                    background: "transparent",
                    fontWeight: mode === "login" ? 600 : 400,
                    color: mode === "login" ? theme.text : theme.muted,
                    borderBottom: mode === "login" ? `2px solid ${theme.text}` : "2px solid transparent",
                    fontSize: 14,
                  }}
                >
                  Log in
                </button>
                <button
                  onClick={() => { setMode("register"); setAuthError(null); }}
                  style={{
                    flex: 1, padding: 10, border: "none", cursor: "pointer",
                    background: "transparent",
                    fontWeight: mode === "register" ? 600 : 400,
                    color: mode === "register" ? theme.text : theme.muted,
                    borderBottom: mode === "register" ? `2px solid ${theme.text}` : "2px solid transparent",
                    fontSize: 14,
                  }}
                >
                  Register
                </button>
              </div>

              <button
                onClick={loginWithGithub}
                style={{
                  width: "100%", padding: 10, marginBottom: 20, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.cardBg, color: theme.text, fontSize: 14,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={theme.text}>
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
                </svg>
                Continue with GitHub
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", color: theme.muted, fontSize: 12 }}>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
                or with email
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>

              <input
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, background: theme.bg, color: theme.text }}
              />
              <input
                placeholder="password (min 8 characters)"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 14, background: theme.bg, color: theme.text }}
              />
              {mode === "register" && (
                <input
                  placeholder="confirm password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: "100%", padding: 10, marginBottom: passwordsMismatch ? 4 : 8, boxSizing: "border-box",
                    border: `1px solid ${passwordsMismatch ? theme.errText : theme.border}`, borderRadius: 8,
                    fontSize: 14, background: theme.bg, color: theme.text,
                  }}
                />
              )}
              {passwordsMismatch && (
                <p style={{ color: theme.errText, fontSize: 12.5, margin: "0 0 8px" }}>Passwords don't match</p>
              )}

              <button
                onClick={mode === "login" ? login : register}
                disabled={registerDisabled}
                style={{
                  width: "100%", padding: 11, marginTop: 4, cursor: registerDisabled ? "default" : "pointer",
                  border: "none", borderRadius: 8, background: theme.accent, color: theme.accentText, fontSize: 14, fontWeight: 600,
                  opacity: registerDisabled ? 0.5 : 1,
                }}
              >
                {authLoading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </button>

              {authError && (
                <p style={{ color: theme.errText, fontSize: 13, marginTop: 10 }}>{authError}</p>
              )}

              {authLoading && <WakingUp theme={theme} />}
            </div>
          </div>
        </div>

        <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
        {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
      </div>
    );
  }

  return (
    <div style={pageShell}>
      <div
        style={{ fontFamily: "sans-serif", padding: "32px 40px 60px", flex: 1, color: theme.text, maxWidth: 980, margin: "0 auto", width: "100%", boxSizing: "border-box" }}
        onContextMenu={(e) => {
          // Blank-canvas right click -> "Add table". Clicks inside a
          // SectionTable stop propagation and show their own menu instead.
          e.preventDefault();
          if (!bom) return;
          setCanvasMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: "Add table", icon: IconTable, onClick: addTable },
              {
                label: bom.doc_type === "sheet" ? "Convert to BOM" : "Convert to Sheet",
                icon: IconRefresh,
                onClick: toggleDocType,
              },
            ],
          });
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ color: theme.text, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>BOM Tool</h1>
          <SettingsMenu
            theme={theme}
            themeName={themeName}
            onToggleTheme={toggleTheme}
            isLoggedIn={true}
            onLogout={logout}
            hasApifyToken={!!user?.has_apify_token}
            onManageApifyKey={() => setShowApifyKeyModal(true)}
          />
        </div>

        <style>{`
          @keyframes bom-spin { to { transform: rotate(360deg); } }
          @keyframes bom-view-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          .bom-view-enter { animation: bom-view-enter 220ms ease-out; }
        `}</style>

        {user && !user.email_verified && (
          <div style={{ background: theme.warnBg, color: theme.warnText, padding: "10px 14px", borderRadius: 10, marginBottom: 20, fontSize: 13.5, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ flexShrink: 0, marginTop: 2 }}><IconEnvelope size={15} color={theme.warnText} /></span>
            <span>
              Please verify your email ({user.email}) — check your inbox
              <strong> and spam/junk folder</strong> for the link (first emails from a new sender often land there).
              {" "}
              <button
                onClick={resendVerification}
                disabled={resendStatus === "sending"}
                style={{ marginLeft: 4, cursor: "pointer", border: "none", background: "none", color: theme.warnText, textDecoration: "underline" }}
              >
                {resendStatus === "sending" ? "Sending…" : resendStatus === "sent" ? "Sent! Check spam too." : "Resend email"}
              </button>
              {resendStatus === "error" && <span style={{ marginLeft: 6 }}>Failed to send — try again shortly.</span>}
            </span>
          </div>
        )}

        {!bom && (
          <div key="bom-list" className="bom-view-enter">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.text }}>Your BOMs</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => createBom("Untitled BOM", "bom")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px", border: "none", borderRadius: 9,
                    background: theme.accent, color: theme.accentText, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlus size={14} /> New BOM
                </button>
                <button
                  onClick={() => createBom("Untitled Sheet", "sheet")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px", border: `1px solid ${theme.border}`, borderRadius: 9,
                    background: theme.cardBg, color: theme.text, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlus size={14} /> New Sheet
                </button>
              </div>
            </div>

            {bomLoadError && (
              <div
                style={{
                  background: theme.errBg || "#fdecea",
                  color: theme.errText || "#c0392b",
                  border: `1px solid ${theme.errText || "#c0392b"}33`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 13,
                  marginBottom: 14,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                }}
              >
                <span>{bomLoadError}</span>
                <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                  {accessDeniedNotice && (
                    <button
                      onClick={logout}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Log in as someone else
                    </button>
                  )}
                  <button
                    onClick={() => { setBomLoadError(null); setAccessDeniedNotice(null); }}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {bomListLoading && (
              <p style={{ color: theme.muted, fontSize: 13.5, textAlign: "center", padding: "24px 0" }}>Loading…</p>
            )}

            {!bomListLoading && bomList && bomList.length === 0 && (
              <div
                style={{
                  background: theme.cardBg,
                  border: `1px dashed ${theme.border}`,
                  borderRadius: 14,
                  padding: "48px 24px",
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, color: theme.muted }}>
                  <IconTable size={30} color={theme.muted} />
                </div>
                <p style={{ color: theme.subtleText, fontSize: 14, margin: "0 0 18px" }}>
                  You don't have a BOM yet — create one to start adding tables and items.
                </p>
                <button
                  onClick={() => createBom("My First BOM")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "10px 18px", border: "none", borderRadius: 9,
                    background: theme.accent, color: theme.accentText, fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlus size={15} /> Create a BOM
                </button>
              </div>
            )}

            {!bomListLoading && bomList && bomList.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bomList.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <button
                      onClick={() => loadBom(b.id)}
                      disabled={openingBomId === b.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, border: "none", background: "none",
                        cursor: openingBomId === b.id ? "default" : "pointer", fontSize: 14, fontWeight: 600,
                        color: theme.text, textAlign: "left", flex: 1,
                        opacity: openingBomId && openingBomId !== b.id ? 0.45 : 1,
                        transition: "opacity 150ms ease",
                      }}
                    >
                      {openingBomId === b.id ? (
                        <span
                          style={{
                            width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                            border: `2px solid ${theme.border}`, borderTopColor: theme.text,
                            animation: "bom-spin 0.6s linear infinite",
                          }}
                        />
                      ) : b.doc_type === "sheet" ? (
                        <IconTable size={16} color={theme.muted} />
                      ) : (
                        <IconFolder size={16} color={theme.muted} />
                      )}
                      {b.title}
                      {b.role && b.role !== "owner" && (
                        <span
                          style={{
                            fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
                            color: theme.muted, border: `1px solid ${theme.border}`, borderRadius: 5,
                            padding: "1px 6px", flexShrink: 0,
                          }}
                        >
                          Shared · {b.role}
                        </span>
                      )}
                    </button>
                    {b.role === "owner" && (
                    <button
                      onClick={() => deleteBom(b.id)}
                      title="Delete BOM"
                      style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: theme.muted }}
                    >
                      <IconTrash size={14} color={theme.muted} />
                    </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {bom && (
          <div key={`bom-detail-${bom.id}`} className="bom-view-enter">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <button
                onClick={exitBom}
                title="Back to your BOMs"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 30, height: 30, flexShrink: 0, border: `1px solid ${theme.border}`, borderRadius: 8,
                  background: theme.cardBg, color: theme.text, cursor: "pointer",
                }}
              >
                <IconArrowLeft size={14} color={theme.text} />
              </button>

              {titleEditing && bom.role !== "viewer" ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={renameBom}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  style={{
                    fontSize: 18, fontWeight: 700, border: `1px solid ${theme.accent}`, borderRadius: 6,
                    padding: "4px 8px", background: theme.cardBg, color: theme.text, minWidth: 0, flex: 1,
                  }}
                />
              ) : bom.role !== "viewer" ? (
                <button
                  onClick={() => { setTitleDraft(bom.title); setTitleEditing(true); }}
                  title="Rename BOM"
                  style={{
                    display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer",
                    fontSize: 18, fontWeight: 700, color: theme.text, padding: "4px 6px", borderRadius: 6, minWidth: 0,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bom.title}</span>
                  <IconPencil size={12} color={theme.muted} />
                </button>
              ) : (
                <span style={{ fontSize: 18, fontWeight: 700, color: theme.text, padding: "4px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {bom.title}
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {bom.role === "owner" && (
                <button
                  onClick={() => setShowShareModal(true)}
                  title="Share this BOM"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconShare size={13} /> Share
                </button>
              )}
              {bom.role && bom.role !== "owner" && (
                <span
                  title={bom.role === "viewer" ? "You can view this BOM but not edit it" : "You can edit this BOM's content, but not sharing or deletion"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.bg, color: theme.muted, fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  {bom.role === "viewer" ? "Viewing (read-only)" : "Editing (shared)"}
                </span>
              )}
              {bom.doc_type !== "sheet" && bom.role === "owner" && (
                <button
                  onClick={() => setShowApiModal(true)}
                  title="API access"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <IconPlug size={13} /> API
                </button>
              )}
              <input
                ref={sheetFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={importSheet}
                style={{ display: "none" }}
              />
              {bom.doc_type !== "sheet" && bom.role !== "viewer" && <RefreshMenu theme={theme} refreshingFilter={refreshingFilter} onSelect={refreshItems} />}
              {bom.role !== "viewer" && (
              <button
                onClick={triggerSheetUpload}
                disabled={sheetImporting}
                title={bom.doc_type === "sheet" ? "Import a .xlsx/.xls/.csv into this sheet's columns" : "Import a .xlsx/.xls/.csv (link in col A, qty in col C)"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                  background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600,
                  cursor: sheetImporting ? "default" : "pointer", opacity: sheetImporting ? 0.6 : 1,
                }}
              >
                <IconUpload size={13} /> {sheetImporting ? "Importing…" : bom.doc_type === "sheet" ? "Import Sheet (Doc)" : "Import Sheet (BOM)"}
              </button>
              )}
              <button
                onClick={exportSheet}
                disabled={sheetExporting}
                title="Download as .xlsx (opens fine in Excel, Google Sheets, Numbers, etc.)"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                  background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600,
                  cursor: sheetExporting ? "default" : "pointer", opacity: sheetExporting ? 0.6 : 1,
                }}
              >
                <IconDownload size={13} /> {sheetExporting ? "Exporting…" : "Export Sheet"}
              </button>
              {bom.role !== "viewer" && (
              <button
                onClick={addTable}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", border: `1px solid ${theme.border}`, borderRadius: 8,
                  background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <IconPlus size={13} /> Add table
              </button>
              )}
              {bom.role !== "viewer" && (
              <span style={{ display: "inline-flex", marginLeft: "auto", gap: 4 }}>
                <button
                  onClick={history.undo}
                  title="Undo (Ctrl+Z)"
                  style={{
                    padding: "7px 10px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  ↶ Undo
                </button>
                <button
                  onClick={history.redo}
                  title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
                  style={{
                    padding: "7px 10px", border: `1px solid ${theme.border}`, borderRadius: 8,
                    background: theme.cardBg, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  ↷ Redo
                </button>
              </span>
              )}
            </div>

            {sheetImportError && (
              <p style={{ color: theme.errText, background: theme.errBg, padding: "8px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconWarning size={15} color={theme.errText} /></span>
                <span>{sheetImportError}</span>
              </p>
            )}

            {sheetImportJustSucceeded && (
              <p style={{ color: theme.subtleText, background: theme.rowBorder, padding: "8px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconRefresh size={13} color={theme.subtleText} /></span>
                <span>{bom.doc_type === "sheet" ? "Sheet imported." : "Sheet imported — hit Refresh above to fetch prices for the new items."}</span>
              </p>
            )}

            {showApiModal && (
              <ApiModal
                bom={bom}
                theme={theme}
                onClose={() => setShowApiModal(false)}
                onKeyRegenerated={(updated) => {
                  setBom((prev) => (prev ? { ...prev, public_api_key: updated.public_api_key } : prev));
                  setBomList((prev) =>
                    prev ? prev.map((b) => (b.id === updated.id ? { ...b, public_api_key: updated.public_api_key } : b)) : prev
                  );
                }}
              />
            )}

            {showShareModal && bom.role === "owner" && (
              <ShareModal
                bom={bom}
                theme={theme}
                onClose={() => setShowShareModal(false)}
              />
            )}

            {showApifyKeyModal && (
              <ApifyKeyModal
                theme={theme}
                hasApifyToken={!!user?.has_apify_token}
                onClose={() => setShowApifyKeyModal(false)}
                onSaved={(hasToken) => setUser((u) => (u ? { ...u, has_apify_token: hasToken } : u))}
              />
            )}

            {bom.totals.staleCount > 0 && (
              <p style={{ color: theme.warnText, background: theme.warnBg, padding: "8px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconWarning size={15} color={theme.warnText} /></span>
                <span>
                  {bom.totals.staleCount} item(s) couldn't be refreshed automatically — showing their last known price. Try Refresh again later.
                </span>
              </p>
            )}

            {bom.totals.excludedCount > 0 && (
              <p style={{ color: theme.errText, background: theme.errBg, padding: "8px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                <span style={{ flexShrink: 0, marginTop: 2 }}><IconWarning size={15} color={theme.errText} /></span>
                <span>{bom.totals.excludedCount} item(s) excluded (link failed) — fix links to include in total.</span>
              </p>
            )}

            {bom.sections.length === 0 && (
              <p style={{ color: theme.muted, fontSize: 13.5, textAlign: "center", padding: "30px 0" }}>
                No tables yet — right-click anywhere, or use "Add table" above.
              </p>
            )}

            {/* Viewers get a live BOM with every inline control still
                visible (SectionTable isn't role-aware internally), but
                pointer-events is switched off for the whole table region
                so nothing is actually clickable/editable. The backend
                rejects any mutation from a viewer regardless -- this is
                just to stop the UI from *looking* editable when it isn't. */}
            <div style={bom.role === "viewer" ? { pointerEvents: "none", opacity: 0.92 } : undefined}>
              {bom.sections.map((section) => (
                <SectionTable
                  key={section.id}
                  section={section}
                  theme={theme}
                  docType={bom.doc_type}
                  columnCount={bom.column_count}
                  columnLabels={bom.column_labels}
                  onSetColumnCount={setColumnCount}
                  onRenameColumn={renameColumn}
                  onResolved={onItemResolved}
                  onAddRow={addRow}
                  onDeleteRow={deleteRow}
                  onPatchItem={patchItem}
                  onReorderItems={reorderItems}
                  onRenameSection={renameSection}
                  onChangeEmoji={setSectionEmoji}
                  onDeleteTable={deleteTable}
                  isSectionDragOver={dragOverSectionId === section.id}
                  onSectionDragStart={onSectionDragStart}
                  onSectionDragOver={onSectionDragOver}
                  onSectionDrop={onSectionDrop}
                  onSectionDragEnd={onSectionDragEnd}
                />
              ))}
            </div>

            {bom.doc_type !== "sheet" && (
            <div
              style={{
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: "16px 18px",
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxWidth: 280,
                marginLeft: "auto",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5, color: theme.subtleText }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><IconCoin size={14} color={theme.subtleText} /> Subtotal</span>
                <span>${bom.totals.subtotal.toFixed(2)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5, color: theme.subtleText }}>
                {taxRateEditing && bom.role !== "viewer" ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span>Tax</span>
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      value={taxRateDraft}
                      onChange={(e) => setTaxRateDraft(e.target.value)}
                      onBlur={saveTaxRate}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setTaxRateEditing(false);
                      }}
                      style={{
                        width: 54, boxSizing: "border-box", padding: "2px 5px", fontSize: 12.5,
                        border: `1px solid ${theme.accent}`, borderRadius: 5,
                        background: theme.cardBg, color: theme.text, textAlign: "right",
                      }}
                    />
                    <span>%</span>
                  </span>
                ) : bom.role !== "viewer" ? (
                  <button
                    onClick={() => {
                      setTaxRateDraft(String(Math.round(Number(bom.tax_rate) * 10000) / 100));
                      setTaxRateEditing(true);
                    }}
                    title="Click to set tax rate"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      border: "none", background: "none", padding: "2px 4px", margin: "-2px -4px",
                      borderRadius: 5, cursor: "pointer", color: theme.subtleText, font: "inherit",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = theme.rowBorder)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    Tax ({(Number(bom.tax_rate) * 100).toFixed(2)}%)
                    <IconPencil size={10} color={theme.muted} />
                  </button>
                ) : (
                  <span>Tax ({(Number(bom.tax_rate) * 100).toFixed(2)}%)</span>
                )}
                <span>${bom.totals.tax.toFixed(2)}</span>
              </span>
              <span style={{ height: 1, background: theme.border, margin: "4px 0" }} />
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 16, fontWeight: 700, color: theme.text }}>
                <span>Total</span>
                <span>${bom.totals.total.toFixed(2)}</span>
              </span>
            </div>
            )}
          </div>
        )}
      </div>

      <ContextMenu menu={canvasMenu} theme={theme} onClose={() => setCanvasMenu(null)} />
      <Footer theme={theme} onPrivacyClick={() => setShowPrivacy(true)} />
      {showPrivacy && <PrivacyModal theme={theme} onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
