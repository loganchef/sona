import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { HistoryEntry, Stats } from '@/types';

const EMPTY_STATS: Stats = {
  todayCount: 0,
  todayChars: 0,
  todaySeconds: 0,
  totalCount: 0,
  avgAsrMs: 0,
  avgPolishMs: 0,
  savedMinutes: 0,
  streakDays: 0,
  charsPerMin: 0,
  days: [],
};

export function useHistory(limit = 200) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, nextStats] = await Promise.all([api.history.list(limit), api.history.stats()]);
      setEntries(list);
      setStats(nextStats);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      await api.history.remove(id);
      await reload();
    },
    [reload],
  );

  const update = useCallback(
    async (id: string, text: string) => {
      const updated = await api.history.update(id, text);
      setEntries((current) => current.map((entry) => (entry.id === id ? updated : entry)));
      return updated;
    },
    [],
  );

  const clear = useCallback(async () => {
    await api.history.clear();
    await reload();
  }, [reload]);

  return { entries, stats, loading, error, reload, remove, clear, update };
}
