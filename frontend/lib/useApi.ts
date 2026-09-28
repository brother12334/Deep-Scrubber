"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, withProfile } from "./api";
import { useSession } from "./session";

/** Fetch a profile-scoped resource; `reload()` re-fetches. Optional polling interval. */
export function useApi<T>(path: string | null, opts: { pollMs?: number; scoped?: boolean } = {}) {
  const { profile } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const scoped = opts.scoped ?? true;
  const full = path ? (scoped ? withProfile(path, profile?.id) : path) : null;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!full || (scoped && !profile)) return;
    setLoading(true);
    try {
      const r = await api<T>(full);
      if (alive.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError ? e : new ApiError(0, "NETWORK", "Network error"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [full, scoped, profile]);

  useEffect(() => {
    alive.current = true;
    void reload();
    if (!opts.pollMs) return () => void (alive.current = false);
    const t = setInterval(() => void reload(), opts.pollMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [reload, opts.pollMs]);

  return { data, error, loading, reload };
}
