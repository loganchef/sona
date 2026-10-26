import { api } from '@/api';

/**
 * Platform detection.
 *
 * The User-Agent is used synchronously so the first paint already picks the
 * right shell. Once Tauri is available, `get_app_info` provides the real
 * platform and broadcasts a platform event.
 */

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';

export const PLATFORM_EVENT = 'app:platform';

const MOBILE_PLATFORMS: Platform[] = ['android', 'ios'];

let cachedPlatform: Platform | null = null;
let cachedIsMobile: boolean | null = null;

export function detectPlatformFromUA(): Platform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

function normalizePlatform(value?: string | null): Platform | null {
  if (!value) return null;
  const platform = value.toLowerCase();
  if (platform === 'darwin' || platform === 'macos') return 'macos';
  if (platform === 'win32' || platform === 'windows') return 'windows';
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  if (platform === 'linux') return 'linux';
  return null;
}

export function getPlatform(): Platform {
  if (typeof window !== 'undefined' && window.__APP_PLATFORM__) {
    return window.__APP_PLATFORM__ as Platform;
  }
  if (!cachedPlatform) {
    cachedPlatform = detectPlatformFromUA();
  }
  return cachedPlatform;
}

export function isMobilePlatform() {
  if (cachedIsMobile === null) {
    cachedIsMobile = MOBILE_PLATFORMS.includes(getPlatform());
  }
  return cachedIsMobile;
}

function applyPlatform(value: string | null | undefined): Platform {
  const platform = normalizePlatform(value) ?? detectPlatformFromUA();
  cachedPlatform = platform;
  cachedIsMobile = MOBILE_PLATFORMS.includes(platform);

  if (typeof window !== 'undefined') {
    window.__APP_PLATFORM__ = platform;
    window.__APP_IS_MOBILE__ = cachedIsMobile;
    window.dispatchEvent(new CustomEvent(PLATFORM_EVENT, { detail: platform }));
  }

  return platform;
}

// Synchronous fallback before the backend answers.
if (typeof window !== 'undefined') {
  cachedPlatform = detectPlatformFromUA();
  cachedIsMobile = MOBILE_PLATFORMS.includes(cachedPlatform);
  window.__APP_PLATFORM__ = cachedPlatform;
  window.__APP_IS_MOBILE__ = cachedIsMobile;
}

/** Read the real platform from Tauri and broadcast it. Safe to call twice. */
export async function initPlatform(): Promise<Platform> {
  try {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
      const info = await api.app.info();
      if (info?.platform) return applyPlatform(info.platform);
    }
  } catch (error) {
    console.warn('Failed to read platform info, falling back to UA:', error);
  }
  return getPlatform();
}