import { invoke } from './client';
import type {
  AppInfo,
  AppSettings,
  DictionaryEntry,
  DictionaryInput,
  DictationRequest,
  DictationResult,
  HotkeyStatus,
  HistoryEntry,
  InsertOutcome,
  OutputLanguage,
  PendingDictation,
  ProviderSettings,
  ProviderTestResult,
  SelectionOutcome,
  SettingsResponse,
  Snippet,
  SnippetInput,
  Stats,
  StylePack,
  VoiceMode,
} from '@/types';

/**
 * Single API surface used by the UI. Components never call Tauri directly;
 * this keeps command names in one place and makes the browser mock trivial.
 */
export const api = {
  app: {
    info: () => invoke<AppInfo>('get_app_info'),
    systemLocale: () => invoke<string>('get_system_locale'),
  },
  system: {
    autostart: () => invoke<boolean>('get_autostart'),
    setAutostart: (enabled: boolean) => invoke<boolean>('set_autostart', { enabled }),
  },
  settings: {
    get: () => invoke<SettingsResponse>('get_settings'),
    update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
      invoke<SettingsResponse>('update_setting', { key, value }),
    reset: () => invoke<SettingsResponse>('reset_settings'),
    hotkeyStatus: () => invoke<HotkeyStatus>('get_hotkey_status'),
  },
  packs: {
    list: () => invoke<StylePack[]>('list_style_packs'),
    apply: (id: string) => invoke<SettingsResponse>('apply_style_pack', { id }),
  },
  /** Read, rewrite and replace the selection in the frontmost app. */
  selection: {
    rewrite: (mode?: VoiceMode, outputLanguage?: OutputLanguage) =>
      invoke<SelectionOutcome>('rewrite_selection', { mode, outputLanguage }),
  },
  diagnostics: {
    export: () => invoke<string>('export_diagnostics'),
  },
  dictionary: {
    list: () => invoke<DictionaryEntry[]>('list_dictionary'),
    save: (input: DictionaryInput, id?: string) =>
      invoke<DictionaryEntry>('save_dictionary_entry', { id, input }),
    remove: (id: string) => invoke<void>('delete_dictionary_entry', { id }),
  },
  snippets: {
    list: () => invoke<Snippet[]>('list_snippets'),
    save: (input: SnippetInput, id?: string) =>
      invoke<Snippet>('save_snippet', { id, input }),
    remove: (id: string) => invoke<void>('delete_snippet', { id }),
  },
  history: {
    list: (limit?: number) => invoke<HistoryEntry[]>('list_history', { limit }),
    update: (id: string, text: string) =>
      invoke<HistoryEntry>('update_history_entry', { id, text }),
    remove: (id: string) => invoke<void>('delete_history_entry', { id }),
    clear: () => invoke<void>('clear_history'),
    stats: () => invoke<Stats>('get_stats'),
  },
  dictation: {
    preview: (audioBase64: string, mime: string) =>
      invoke<string>('preview_transcript', { audioBase64, mime }),
    run: (request: DictationRequest) => invoke<DictationResult>('run_dictation', { request }),
    polish: (text: string, mode?: VoiceMode, outputLanguage?: OutputLanguage) =>
      invoke<string>('polish_text', { text, mode, outputLanguage }),
    insert: (text: string) => invoke<InsertOutcome>('insert_text', { text }),
    pending: () => invoke<PendingDictation | null>('get_pending_dictation'),
    retry: () => invoke<DictationResult>('retry_pending_dictation'),
    discard: () => invoke<void>('discard_pending_dictation'),
  },
  providers: {
    /** Test unsaved values — used by the setup wizard and the provider cards. */
    testConfig: (kind: 'asr' | 'polish', provider: ProviderSettings) =>
      invoke<ProviderTestResult>('test_provider_config', { kind, provider }),
    localModels: (baseUrl?: string) => invoke<string[]>('probe_local_asr', { baseUrl }),
  },
};

export type Api = typeof api;
export { invoke, isTauri } from './client';
