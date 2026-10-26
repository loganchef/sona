/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
  __APP_PLATFORM__?: string;
  __APP_IS_MOBILE__?: boolean;
}