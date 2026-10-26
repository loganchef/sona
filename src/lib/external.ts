import { isTauri } from '@/api';

/**
 * Open a link in the user's browser. A plain anchor would navigate the Tauri
 * webview away from the app; the shell plugin keeps Sona open.
 */
export async function openExternal(url: string) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}