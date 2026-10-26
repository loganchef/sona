import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

/** Marks that the user deliberately picked a language. */
export const LANG_EXPLICIT_KEY = 'sona.langExplicit';

export type AppLanguage = 'en' | 'zh-CN';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
};

/**
 * Normalise any locale tag (zh, zh_CN, zh-Hans-CN, en-US, ...) to one of the
 * languages shipped with Sona.
 */
export function normalizeLanguage(language?: string | null): AppLanguage {
  return String(language ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function getInitialLanguage(): AppLanguage {
  try {
    const explicit = localStorage.getItem(LANG_EXPLICIT_KEY);
    if (explicit) {
      return normalizeLanguage(localStorage.getItem('i18nextLng'));
    }
    return normalizeLanguage(document.documentElement.lang || navigator.language);
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  supportedLngs: ['en', 'zh-CN'],
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeLanguage(language);
  }
});

export default i18n;