import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { Snippet, SnippetInput } from '@/types';

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSnippets(await api.snippets.list());
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
    async (input: SnippetInput, id?: string) => {
      const snippet = await api.snippets.save(input, id);
      await reload();
      return snippet;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.snippets.remove(id);
      await reload();
    },
    [reload],
  );

  return { snippets, loading, error, reload, save, remove };
}
