import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { AppSettings } from '@/types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.settings.get();
      setSettings(response.settings);
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

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const response = await api.settings.update(key, value);
      setSettings(response.settings);
      setError(null);
      return response.settings;
    },
    [],
  );

  const resetSettings = useCallback(async () => {
    const response = await api.settings.reset();
    setSettings(response.settings);
    setError(null);
    return response.settings;
  }, []);

  const applyStylePack = useCallback(async (id: string) => {
    const response = await api.packs.apply(id);
    setSettings(response.settings);
    setError(null);
    return response.settings;
  }, []);

  return { settings, loading, error, reload, updateSetting, resetSettings, applyStylePack };
}