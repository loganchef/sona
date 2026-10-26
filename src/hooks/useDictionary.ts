import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { DictionaryEntry, DictionaryInput } from '@/types';

export function useDictionary() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.dictionary.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (input: DictionaryInput, id?: string) => {
      const entry = await api.dictionary.save(input, id);
      await reload();
      return entry;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.dictionary.remove(id);
      await reload();
    },
    [reload],
  );

  return { entries, loading, error, reload, save, remove };
}
