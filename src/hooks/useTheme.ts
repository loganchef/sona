import { useEffect } from 'react';
import type { ThemePreference } from '@/types';

/** Applies the persisted theme and follows the OS while `theme === 'system'`. */
export function useTheme(theme: ThemePreference | undefined) {
  useEffect(() => {
    if (!theme) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };

    apply();

    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }

    return undefined;
  }, [theme]);
}