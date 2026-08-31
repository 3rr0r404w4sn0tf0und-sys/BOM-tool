import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./api.js";

export function useBomPolling(bom, setBom) {
  const bomRef = useRef(bom);
  useEffect(() => { bomRef.current = bom; }, [bom]);

  const pollBomQuietly = useCallback(async (id) => {
    try {
      const res = await apiFetch(`/api/boms/${id}`);
      if (res.ok) setBom(await res.json());
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
    const timer = setTimeout(() => pollBomQuietly(bom.id), 4000);
    return () => clearTimeout(timer);
  }, [bom, pollBomQuietly]);

  return { pollBomQuietly, onItemResolved };
}
