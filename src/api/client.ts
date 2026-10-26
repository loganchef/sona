import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  AppSettings,
  DictionaryEntry,
  DictionaryInput,
  DictationRequest,
  DictationResult,
  GeneralSettings,
  HistoryEntry,
  HotkeyStatus,
  InsertOutcome,
  ProviderSettings,
  Snippet,
  SnippetInput,
  Stats,
  StylePack,
  UiSettings,
  VoiceMode,
  VoiceSettings,
} from '@/types';

const MOCK_STORAGE_KEY = 'sona.mock.v1';

export function isTauri() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function tauriPlatform(): { platform: string; family: string; isMobile: boolean } {
  if (typeof navigator === 'undefined') {
    return { platform: 'web', family: 'web', isMobile: false };
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return { platform: 'android', family: 'mobile', isMobile: true };
  if (/iPhone|iPad|iPod/i.test(ua)) return { platform: 'ios', family: 'mobile', isMobile: true };
  if (/Macintosh|Mac OS X/i.test(ua)) return { platform: 'macos', family: 'desktop', isMobile: false };
  if (/Windows/i.test(ua)) return { platform: 'windows', family: 'desktop', isMobile: false };
  if (/Linux/i.test(ua)) return { platform: 'linux', family: 'desktop', isMobile: false };
  return { platform: 'web', family: 'web', isMobile: false };
}

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

/** Browser preview still talks to the provider; a mock green light hides real failures. */
function providerUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${path}`;
}

function modelIds(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  return list
    .map((item) =>
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ? (item as { id: string }).id
          : '',
    )
    .filter(Boolean);
}

async function browserFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const MOCK_TEXTS: Record<VoiceMode, string> = {
  raw: '嗯，那个，我们下周一先把登录做完，然后再说导出的事。',
  light: '我们下周一先把登录做完，然后再说导出的事。',
  structured:
    '下周一的工作安排：\n\n1. 完成登录功能\n2. 登录完成后再评估导出功能的排期\n\n约束：导出不在本迭代内交付。',
  formal:
    '关于本周排期，团队的安排是：下周一优先完成登录功能；导出功能将在登录交付后再行评估排期。',
};

function mockBuiltinPacks(language: string): StylePack[] {
  if (language === 'zh-CN') {
    return [
      { id: 'builtin-daily', name: '日常口述', mode: 'light', instruction: '', builtin: true },
      {
        id: 'builtin-meeting',
        name: '会议纪要',
        mode: 'structured',
        instruction: '整理成带小标题的要点，保留负责人、时间和待办；只依据原话，不要补充没说的内容。',
        builtin: true,
      },
      {
        id: 'builtin-email',
        name: '邮件',
        mode: 'formal',
        instruction: '整理成可以直接发送的邮件正文，语气克制、结构清楚；不要添加主题、称呼或签名。',
        builtin: true,
      },
      { id: 'builtin-verbatim', name: '逐字转写', mode: 'raw', instruction: '', builtin: true },
    ];
  }

  return [
    { id: 'builtin-daily', name: 'Daily', mode: 'light', instruction: '', builtin: true },
    {
      id: 'builtin-meeting',
      name: 'Meeting notes',
      mode: 'structured',
      instruction:
        'Turn this into headed bullet points, keeping owners, dates and action items. Do not add anything that was not said.',
      builtin: true,
    },
    {
      id: 'builtin-email',
      name: 'Email',
      mode: 'formal',
      instruction:
        'Turn this into a send-ready email body with a restrained tone and clear structure. Do not add a subject, greeting or signature.',
      builtin: true,
    },
    { id: 'builtin-verbatim', name: 'Verbatim', mode: 'raw', instruction: '', builtin: true },
  ];
}

function defaultSettings(): AppSettings {
  const language = typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh-CN' : 'en';

  const voice: VoiceSettings = {
    mode: 'light',
    outputLanguage: 'auto',
    asr: { preset: 'none', baseUrl: '', apiKey: '', model: '' },
    polish: { preset: 'none', baseUrl: '', apiKey: '', model: '' },
    insert: 'paste',
    contextChars: 300,
    dictionaryEnabled: true,
    hotkeys: { dictate: 'Alt+Space', cancel: 'Escape', ask: 'Alt+Enter', style: 'Alt+Shift+P' },
    localAsr: { enabled: false, baseUrl: 'http://127.0.0.1:8080/v1', model: '', modelDir: '' },
    customInstruction: '',
    stylePacks: [],
    activeStylePack: '',
    excludedStylePacks: [],
    livePreview: false,
    holdToTalk: true,
    autoStop: true,
    silenceMs: 1200,
    soundFeedback: true,
  };

  return {
    // Browser preview starts in the app; `?setup=1` opens the first-run guide.
    general: { language, onboarded: true },
    ui: { theme: 'system', surface: 'solid', compact: false, pageSize: 20 },
    voice,
  };
}

interface MockDb {
  settings: AppSettings;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  history: HistoryEntry[];
}

function seedDictionary(): DictionaryEntry[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'seed-claude',
      term: 'Claude',
      aliases: ['cloud', '克劳德'],
      note: '产品名，识别常写成 cloud',
      enabled: true,
      hits: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-git',
      term: 'git',
      aliases: ['get', '给特'],
      note: '命令名',
      enabled: true,
      hits: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedSnippets(): Snippet[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'seed-snippet-email',
      trigger: '我的邮箱',
      expansion: 'hi@example.com',
      note: '自报邮箱',
      enabled: true,
      hits: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-snippet-weekly',
      trigger: '周报模板',
      expansion: '本周进展：\n\n1. \n\n下周计划：\n\n1. ',
      note: '说一句，落一段',
      enabled: true,
      hits: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedHistory(): HistoryEntry[] {
  const now = Date.now();
  return [
    {
      id: 'seed-1',
      createdAt: new Date(now - 26 * 60_000).toISOString(),
      raw: '嗯，帮我给客户回个邮件，语气客气一点，说一下交付要延两周。',
      text: '帮我给客户回个邮件，语气客气一点，说明交付需要延后两周。',
      mode: 'light',
      asrModel: 'FunAudioLLM/SenseVoiceSmall',
      polishModel: 'deepseek-chat',
      durationMs: 9_400,
      asrMs: 620,
      polishMs: 1_180,
      chars: 30,
      app: 'Mail',
      inserted: true,
      copied: true,
      edited: false,
    },
    {
      id: 'seed-2',
      createdAt: new Date(now - 3 * 60 * 60_000).toISOString(),
      raw: '把这个函数改成异步的，别动返回值。',
      text: '把这个函数改成异步的，不要改动返回值。',
      mode: 'light',
      asrModel: 'FunAudioLLM/SenseVoiceSmall',
      polishModel: 'deepseek-chat',
      durationMs: 5_200,
      asrMs: 480,
      polishMs: 900,
      chars: 22,
      app: 'Cursor',
      inserted: true,
      copied: true,
      edited: false,
    },
  ];
}

function mergeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const defaults = defaultSettings();
  return {
    general: { ...defaults.general, ...(value?.general ?? {}) },
    ui: { ...defaults.ui, ...(value?.ui ?? {}) },
    voice: {
      ...defaults.voice,
      ...(value?.voice ?? {}),
      asr: { ...defaults.voice.asr, ...(value?.voice?.asr ?? {}) },
      polish: { ...defaults.voice.polish, ...(value?.voice?.polish ?? {}) },
      hotkeys: { ...defaults.voice.hotkeys, ...(value?.voice?.hotkeys ?? {}) },
      localAsr: { ...defaults.voice.localAsr, ...(value?.voice?.localAsr ?? {}) },
    },
  };
}

function readMockDb(): MockDb {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MockDb>;
      return {
        settings: mergeSettings(parsed.settings),
        dictionary: Array.isArray(parsed.dictionary) ? parsed.dictionary : seedDictionary(),
        snippets: Array.isArray(parsed.snippets) ? parsed.snippets : seedSnippets(),
        history: Array.isArray(parsed.history) ? parsed.history : seedHistory(),
      };
    }
  } catch {
    // Fall through to a fresh database.
  }

  const db: MockDb = {
    settings: defaultSettings(),
    dictionary: seedDictionary(),
    snippets: seedSnippets(),
    history: seedHistory(),
  };
  writeMockDb(db);
  return db;
}

function writeMockDb(db: MockDb) {
  try {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Storage can be unavailable in private mode; the in-memory copy still works.
  }
}

function mockUid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mockStats(history: HistoryEntry[]): Stats {
  const today = new Date().toDateString();
  const todayEntries = history.filter((entry) => new Date(entry.createdAt).toDateString() === today);
  const chars = todayEntries.reduce((sum, entry) => sum + entry.chars, 0);
  const seconds = Math.round(todayEntries.reduce((sum, entry) => sum + entry.durationMs, 0) / 1000);
  const typingSeconds = history.reduce((sum, entry) => sum + entry.chars, 0) / 3.6;
  const spokenSeconds = history.reduce((sum, entry) => sum + entry.durationMs, 0) / 1000;
  const avgAsr = history.length
    ? Math.round(history.reduce((sum, entry) => sum + entry.asrMs, 0) / history.length)
    : 0;
  const polished = history.filter((entry) => entry.polishMs > 0);
  const avgPolish = polished.length
    ? Math.round(polished.reduce((sum, entry) => sum + entry.polishMs, 0) / polished.length)
    : 0;

  return {
    todayCount: todayEntries.length,
    todayChars: chars,
    todaySeconds: seconds,
    totalCount: history.length,
    avgAsrMs: avgAsr,
    avgPolishMs: avgPolish,
    savedMinutes: Math.max(0, Math.round((typingSeconds - spokenSeconds) / 60)),
    streakDays: history.length ? 1 : 0,
    charsPerMin: seconds > 0 ? Math.round((chars / seconds) * 60) : 0,
    days: Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (13 - index));
      const key = day.toDateString();
      const entries = history.filter((entry) => new Date(entry.createdAt).toDateString() === key);
      return {
        date: day.toISOString().slice(0, 10),
        count: entries.length,
        chars: entries.reduce((sum, entry) => sum + entry.chars, 0),
      };
    }),
  };
}

/** Browser-only mock so `npm run dev` works without the Rust side. */
async function mockInvoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  await delay();
  const db = readMockDb();
  const platform = tauriPlatform();

  switch (command) {
    case 'get_app_info':
      return {
        name: 'Sona',
        version: '0.1.0',
        ...platform,
        secrets: 'file',
        features: {
          globalHotkey: !platform.isMobile,
          autostart: !platform.isMobile,
          syntheticPaste: !platform.isMobile,
          localAsr: false,
          floatingCapsule: !platform.isMobile,
        },
      } satisfies AppInfo;

    case 'get_system_locale':
      return typeof navigator !== 'undefined' ? navigator.language : 'en-US';

    case 'get_settings':
      return { success: true, settings: db.settings };

    case 'get_hotkey_status':
      return {
        supported: !platform.isMobile,
        registered: [
          db.settings.voice.hotkeys.dictate,
          db.settings.voice.hotkeys.ask,
          db.settings.voice.hotkeys.style,
        ],
        failed: [],
      } satisfies HotkeyStatus;

    case 'update_setting': {
      const key = String(args.key);
      if (key === 'general') {
        const previousLanguage = db.settings.general.language;
        const previousVoice = db.settings.voice;
        const update = args.value as Partial<GeneralSettings>;
        db.settings.general = { ...db.settings.general, ...update };

        // Mirror the Rust rule: an untouched built-in follows the UI
        // language, while a manual edit stays exactly as the user left it.
        if (db.settings.general.language !== previousLanguage) {
          const oldPack = mockBuiltinPacks(previousLanguage).find(
            (pack) => pack.id === previousVoice.activeStylePack,
          );
          const customized =
            oldPack &&
            (oldPack.mode !== previousVoice.mode ||
              oldPack.instruction !== previousVoice.customInstruction);
          if (oldPack && !customized) {
            const nextPack = mockBuiltinPacks(db.settings.general.language).find(
              (pack) => pack.id === oldPack.id,
            );
            if (nextPack) {
              db.settings.voice = {
                ...previousVoice,
                mode: nextPack.mode,
                customInstruction: nextPack.instruction,
              };
            }
          }
        }
      } else if (key === 'ui') {
        db.settings.ui = { ...db.settings.ui, ...(args.value as Partial<UiSettings>) };
      } else if (key === 'voice') {
        db.settings.voice = mergeSettings({ voice: args.value as VoiceSettings }).voice;
      } else {
        throw new Error(`Unsupported setting: ${key}`);
      }
      writeMockDb(db);
      return { success: true, settings: db.settings };
    }

    case 'reset_settings':
      db.settings = defaultSettings();
      writeMockDb(db);
      return { success: true, settings: db.settings };

    case 'list_style_packs':
      return [
        ...mockBuiltinPacks(db.settings.general.language),
        ...db.settings.voice.stylePacks.map((pack) => ({ ...pack, builtin: false })),
      ];

    case 'apply_style_pack': {
      const id = String(args.id);
      const pack = [
        ...mockBuiltinPacks(db.settings.general.language),
        ...db.settings.voice.stylePacks.map((item) => ({ ...item, builtin: false })),
      ].find((item) => item.id === id);
      if (!pack) throw new Error('style_pack_not_found');
      db.settings.voice = {
        ...db.settings.voice,
        mode: pack.mode,
        customInstruction: pack.instruction,
        activeStylePack: pack.id,
      };
      writeMockDb(db);
      return { success: true, settings: db.settings };
    }

    case 'list_dictionary':
      return [...db.dictionary].sort((a, b) => b.hits - a.hits);

    case 'save_dictionary_entry': {
      const input = args.input as DictionaryInput;
      const id = args.id as string | undefined;
      const now = new Date().toISOString();
      if (id) {
        const index = db.dictionary.findIndex((entry) => entry.id === id);
        if (index === -1) throw new Error('dictionary_not_found');
        db.dictionary[index] = { ...db.dictionary[index], ...input, updatedAt: now };
        writeMockDb(db);
        return db.dictionary[index];
      }
      const entry: DictionaryEntry = {
        id: mockUid(),
        term: input.term.trim(),
        aliases: input.aliases,
        note: input.note,
        enabled: input.enabled,
        hits: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.dictionary = [entry, ...db.dictionary];
      writeMockDb(db);
      return entry;
    }

    case 'delete_dictionary_entry': {
      const id = String(args.id);
      db.dictionary = db.dictionary.filter((entry) => entry.id !== id);
      writeMockDb(db);
      return undefined;
    }

    case 'list_snippets':
      return [...db.snippets].sort((a, b) => b.hits - a.hits || b.updatedAt.localeCompare(a.updatedAt));

    case 'save_snippet': {
      const input = args.input as SnippetInput;
      const id = args.id as string | undefined;
      const now = new Date().toISOString();
      const trigger = input.trigger.trim();
      const expansion = input.expansion.trimEnd();
      if (!trigger) throw new Error('snippet_trigger_required');
      if (!expansion.trim()) throw new Error('snippet_expansion_required');

      if (id) {
        const index = db.snippets.findIndex((snippet) => snippet.id === id);
        if (index === -1) throw new Error('snippet_not_found');
        db.snippets[index] = {
          ...db.snippets[index],
          trigger,
          expansion,
          note: input.note,
          enabled: input.enabled,
          updatedAt: now,
        };
        writeMockDb(db);
        return db.snippets[index];
      }

      const snippet: Snippet = {
        id: mockUid(),
        trigger,
        expansion,
        note: input.note,
        enabled: input.enabled,
        hits: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.snippets = [snippet, ...db.snippets.filter((item) => item.trigger !== trigger)];
      writeMockDb(db);
      return snippet;
    }

    case 'delete_snippet': {
      const id = String(args.id);
      db.snippets = db.snippets.filter((snippet) => snippet.id !== id);
      writeMockDb(db);
      return undefined;
    }

    case 'list_history': {
      const limit = Number(args.limit ?? 500);
      return [...db.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    }

    case 'preview_transcript':
      return '我们下周一先把登录做完';

    case 'rewrite_selection': {
      const before = '这个方案我觉得还行，但是时间上可能来不及。';
      const after = '方案可行，但时间安排存在风险。';
      return { before, after, inserted: !platform.isMobile, reason: platform.isMobile ? 'copy_only' : null };
    }

    case 'export_diagnostics':
      return '~/Downloads/sona-diagnostics-mock.json';

    case 'update_history_entry': {
      const id = String(args.id);
      const text = String(args.text ?? '').trim();
      const index = db.history.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('history_not_found');
      db.history[index] = { ...db.history[index], text, chars: [...text].length, edited: true };
      writeMockDb(db);
      return db.history[index];
    }

    case 'delete_history_entry': {
      const id = String(args.id);
      db.history = db.history.filter((entry) => entry.id !== id);
      writeMockDb(db);
      return undefined;
    }

    case 'clear_history':
      db.history = [];
      writeMockDb(db);
      return undefined;

    case 'get_stats':
      return mockStats(db.history);

    case 'run_dictation': {
      const request = args.request as DictationRequest;
      const settings = db.settings.voice;
      const text = MOCK_TEXTS[settings.mode] ?? MOCK_TEXTS.light;
      const entry: HistoryEntry = {
        id: mockUid(),
        createdAt: new Date().toISOString(),
        raw: MOCK_TEXTS.raw,
        text,
        mode: settings.mode,
        asrModel: settings.asr.model || 'mock-asr',
        polishModel: settings.polish.model || 'mock-polish',
        durationMs: request.durationMs || 4_200,
        asrMs: 520,
        polishMs: settings.mode === 'raw' ? 0 : 860,
        chars: text.length,
        app: request.app ?? '',
        inserted: !platform.isMobile,
        copied: true,
      edited: false,
      };
      db.history = [entry, ...db.history];
      writeMockDb(db);
      return {
        entry,
        text,
        raw: MOCK_TEXTS.raw,
        insert: {
          inserted: !platform.isMobile,
          copied: true,
          reason: platform.isMobile ? 'copy_only' : null,
        },
      } satisfies DictationResult;
    }

    case 'polish_text': {
      const mode = (args.mode as VoiceMode | undefined) ?? db.settings.voice.mode;
      return MOCK_TEXTS[mode] ?? MOCK_TEXTS.light;
    }

    case 'insert_text':
      return {
        inserted: !platform.isMobile,
        copied: true,
        reason: null,
      } satisfies InsertOutcome;

    case 'get_pending_dictation':
      return null;

    case 'retry_pending_dictation':
      throw new Error('pending_not_found');

    case 'discard_pending_dictation':
      return undefined;

    case 'get_autostart':
      return false;

    case 'set_autostart':
      return Boolean(args.enabled);

    case 'test_provider_config': {
      const kind = args.kind === 'polish' ? 'polish' : 'asr';
      const provider = (args.provider as ProviderSettings | undefined) ?? db.settings.voice.asr;
      const baseUrl = provider.baseUrl.trim();
      if (!baseUrl) throw new Error(`${kind}_not_configured`);
      if (!['', 'none', 'custom', 'local'].includes(provider.preset) && !provider.apiKey.trim()) {
        throw new Error(`${kind}_probe_http_401: missing key`);
      }

      const headers: Record<string, string> = {};
      if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
      try {
        if (kind === 'asr') {
          const response = await browserFetch(providerUrl(baseUrl, 'models'), { headers });
          const body = await response.text();
          if (!response.ok) {
            throw new Error(`asr_probe_http_${response.status}: ${body.slice(0, 200)}`);
          }
          // A reachable endpoint is still reachable if the body is not the
          // shape we expected; report success without inventing a count.
          let count = 0;
          try {
            count = modelIds(JSON.parse(body || 'null')).length;
          } catch {
            count = 0;
          }
          return { kind, ok: true, models: count || null };
        }

        const response = await browserFetch(providerUrl(baseUrl, 'chat/completions'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0,
            stream: false,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`polish_probe_http_${response.status}: ${body.slice(0, 200)}`);
        }
        return { kind, ok: true };
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes('_probe_')) throw cause;
        throw new Error(`provider_test_browser: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }

    case 'probe_local_asr': {
      const baseUrl = String(args.baseUrl ?? '').trim();
      if (!baseUrl) throw new Error('local_asr_url_required');
      try {
        const response = await browserFetch(providerUrl(baseUrl, 'models'), {});
        const body = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ids = modelIds(JSON.parse(body || 'null'));
        if (ids.length === 0) throw new Error('local_asr_no_models');
        return ids;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message === 'local_asr_no_models') throw cause;
        throw new Error(`local_asr_unreachable: ${message}`);
      }
    }

    default:
      throw new Error(`[browser mock] Unsupported command: ${command}`);
  }
}

/** Typed bridge to the Rust backend. Falls back to a localStorage mock in a browser. */
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri()) {
    return (await mockInvoke(command, args)) as T;
  }
  return tauriInvoke<T>(command, args);
}
