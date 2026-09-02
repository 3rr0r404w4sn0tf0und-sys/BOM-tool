import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api.js";

// Shallow value-equality for a single item/section row: same keys, same
// primitive values (arrays like sheet_data compared element-wise). Good
// enough here because nothing nested is itself mutated in place.
function rowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (key === "items") continue; // sections handle items separately, below
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

// Reconciles a freshly-fetched BOM against the previous one in local state,
// keeping the exact same object reference for any section/item whose values
// didn't change. This is what lets SectionTable's React.memo actually skip
// re-rendering tables that a poll didn't touch -- polling used to just
// setBom(freshJson), which handed every section/item a brand new object
// identity every 4s (even when nothing in it changed), so every table on
// the page re-rendered on every poll regardless of BOM size. That's the
// dominant cause of "big BOMs feel laggy while anything is scraping."
function mergeBom(prev, fresh) {
  if (!prev || prev.id !== fresh.id) return fresh;

  const prevSectionsById = new Map(prev.sections.map((s) => [s.id, s]));
  let sectionsChanged = fresh.sections.length !== prev.sections.length;

  const mergedSections = fresh.sections.map((freshSection) => {
    const prevSection = prevSectionsById.get(freshSection.id);
    if (!prevSection) {
      sectionsChanged = true;
      return freshSection;
    }

    const prevItemsById = new Map(prevSection.items.map((i) => [i.id, i]));
    let itemsChanged = freshSection.items.length !== prevSection.items.length;

    const mergedItems = freshSection.items.map((freshItem) => {
      const prevItem = prevItemsById.get(freshItem.id);
      if (prevItem && rowEqual(prevItem, freshItem)) return prevItem;
      itemsChanged = true;
      return freshItem;
    });

    const sectionMetaEqual = rowEqual(
      { ...prevSection, items: undefined },
      { ...freshSection, items: undefined }
    );
    if (!itemsChanged && sectionMetaEqual) {
      return prevSection; // identical: keep the old reference so memo bails out
    }
    sectionsChanged = true;
    return { ...freshSection, items: mergedItems };
  });

  return {
    ...fresh,
    sections: sectionsChanged ? mergedSections : prev.sections,
  };
}

export function useBomPolling(bom, setBom) {
  const bomRef = useRef(bom);
  const etagRef = useRef(null);
  useEffect(() => {
    if (bomRef.current?.id !== bom?.id) etagRef.current = null;
    bomRef.current = bom;
  }, [bom]);

  const pollBomQuietly = useCallback(async (id) => {
    try {
      const headers = etagRef.current ? { "If-None-Match": etagRef.current } : {};
      const res = await apiFetch(`/api/boms/${id}`, { headers });
      if (res.status === 304) return;
      if (!res.ok) return;
      const nextEtag = res.headers.get("ETag");
      if (nextEtag) etagRef.current = nextEtag;
      const fresh = await res.json();
      setBom((prev) => mergeBom(prev, fresh));
    } catch {
      // Transient network/Render wake-up failures are retried by the next poll.
    }
  }, [setBom]);

  const onItemResolved = useCallback(() => {
    if (bomRef.current) pollBomQuietly(bomRef.current.id);
  }, [pollBomQuietly]);

  useEffect(() => {
    if (!bom) return;
    const hasPending = bom.sections?.some((s) => s.items.some((i) => i.status === "pending" || !i.status));
    if (!hasPending) return;

    // Don't burn polls (or re-render work) on a backgrounded tab; catch up
    // as soon as it's visible again instead.
    if (document.visibilityState === "hidden") {
      const onVisible = () => {
        if (document.visibilityState === "visible") pollBomQuietly(bom.id);
      };
      document.addEventListener("visibilitychange", onVisible, { once: true });
      return () => document.removeEventListener("visibilitychange", onVisible);
    }

    const timer = setTimeout(() => pollBomQuietly(bom.id), 4000);
    return () => clearTimeout(timer);
  }, [bom, pollBomQuietly]);

  return { pollBomQuietly, onItemResolved };
}
