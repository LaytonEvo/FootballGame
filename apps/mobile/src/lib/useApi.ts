import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Tiny data hook: load on mount, reload on demand, optional polling (live matchday). */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e as Error);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    void load();
    const id = opts.pollMs ? setInterval(load, opts.pollMs) : null;
    return () => {
      alive.current = false;
      if (id) clearInterval(id);
    };
  }, [load, opts.pollMs]);
  return { data, error, loading, reload: load, setData };
}
