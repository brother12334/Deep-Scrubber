"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useFetch<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, [path]);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}
