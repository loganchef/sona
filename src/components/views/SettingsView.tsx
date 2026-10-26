import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { ArrowDownTrayIcon, ArrowRightIcon, SwatchIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { api } from '@/api';
import { captureAccelerator, formatAccelerator } from '@/lib/keys';
import { dictationErrorKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type {
  AppInfo,
  AppSettings,
  AppView,
  HotkeyStatus,
  InsertStrategy,
  OutputLanguage,
  StylePack,
  ThemePreference,
  VoiceMode,
} from '@/types';

export interface SettingsViewProps {
  settings: AppSettings;
  appInfo: AppInfo | null;
  activePack: StylePack | null;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings>;
  onReset: () => Promise<AppSettings>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRestartSetup: () => void;
  onNavigate: (view: AppView) => void;
}

const MODES: VoiceMode[] = ['raw', 'light', 'structured', 'formal'];
const OUTPUT_LANGUAGES: OutputLanguage[] = ['auto', 'zh-CN', 'en'];
const INSERT_STRATEGIES: InsertStrategy[] = ['paste', 'copy'];

export function SettingsView({
  settings,
  appInfo,
  activePack,
  onUpdate,
  onReset,
  onNotify,
  onRestartSetup,
  onNavigate,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [hotkeys, setHotkeys] = useState<HotkeyStatus | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [capturing, setCapturing] = useState<'dictate' | 'ask' | 'style' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.settings
      .hotkeyStatus()
      .then((status) => {
        if (!cancelled) setHotkeys(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings.voice.hotkeys]);

  useEffect(() => {
    let cancelled = false;
    api.system
      .autostart()
      .then((enabled) => {
        if (!cancelled) setAutostart(enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    const previous = autostart;
    setAutostart(enabled);
    try {
      const next = await api.system.setAutostart(enabled);
      setAutostart(next);
      onNotify(next ? t('settings.autostartOn') : t('settings.autostartOff'), 'success');
    } catch (cause) {
      setAutostart(previous);
      const code = cause instanceof Error ? cause.message : String(cause);
      const key = dictationErrorKey(code);
      onNotify(key ? t(key) : code, 'error');
    }
  };

  const exportDiagnostics = useCallback(async () => {
    setExporting(true);
    try {
      const path = await api.diagnostics.export();
      onNotify(t('settings.diagnosticsSaved', { path }), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setExporting(false);
    }
  }, [onNotify, t]);

  const patchVoice = async (patch: Partial<AppSettings['voice']>) => {
    await onUpdate('voice', { ...settings.voice, ...patch });
  };

  // While capturing, the next key combination becomes the accelerator.
  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }

      const accelerator = captureAccelerator(event);
      if (!accelerator) return;

      void patchVoice({ hotkeys: { ...settings.voice.hotkeys, [capturing]: accelerator } });
      setCapturing(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, patchVoice, settings.voice.hotkeys]);

  const reset = async () => {
    setBusy(true);
    try {
      await onReset();
      setConfirmReset(false);
      onNotify(t('settings.resetDone'), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const platform = appInfo?.platform ?? 'web';
  const styleAdjusted = Boolean(
    activePack &&
      (activePack.mode !== settings.voice.mode ||
        activePack.instruction !== settings.voice.customInstruction),
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad space-y-4">
        <header>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{t('settings.subtitle')}</p>
        </header>

        {/* Dictation */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('settings.dictation')}</h2>

          {activePack && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
              <SwatchIcon className="h-4 w-4 shrink-0 text-brand-500" />
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {t('packs.active')}
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {activePack.name}
              </span>
              {styleAdjusted && <Badge variant="warning">{t('packs.adjusted')}</Badge>}
              <button
                type="button"
                className="btn-ghost ml-auto text-xs"
                onClick={() => onNavigate('packs')}
              >
                {t('packs.manage')}
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.mode')}
              </span>
              <Select
                value={settings.voice.mode}
                onValueChange={(value) => void patchVoice({ mode: value as VoiceMode })}
                options={MODES.map((mode) => ({
                  value: mode,
                  label: t(`mode.${mode}`),
                  description: t(`mode.${mode}Hint`),
                }))}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.outputLanguage')}
              </span>
              <Select
                value={settings.voice.outputLanguage}
                onValueChange={(value) => void patchVoice({ outputLanguage: value as OutputLanguage })}
                options={OUTPUT_LANGUAGES.map((value) => ({
                  value,
                  label: t(`outputLanguage.${value === 'zh-CN' ? 'zh' : value}`),
                }))}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.insert')}
              </span>
              <Select
                value={settings.voice.insert}
                onValueChange={(value) => void patchVoice({ insert: value as InsertStrategy })}
                options={INSERT_STRATEGIES.map((value) => ({
                  value,
                  label: t(`insert.${value}`),
                  description: t(`insert.${value}Hint`),
                }))}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.contextChars', { count: settings.voice.contextChars })}
              </span>
              <input
                type="range"
                min={0}
                max={800}
                step={50}
                value={settings.voice.contextChars}
                onChange={(event) => void patchVoice({ contextChars: Number(event.target.value) })}
                className="w-full accent-brand-600"
              />
              <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                {t('settings.contextHint')}
              </span>
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
            <input
              type="checkbox"
              checked={settings.voice.dictionaryEnabled}
              onChange={(event) => void patchVoice({ dictionaryEnabled: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              {t('settings.dictionaryEnabled')}
            </span>
          </label>

          <label className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
            <input
              type="checkbox"
              checked={settings.voice.holdToTalk}
              onChange={(event) => void patchVoice({ holdToTalk: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              {t('settings.holdToTalk')}
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {t('settings.holdToTalkHint')}
              </span>
            </span>
          </label>

          <label className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
            <input
              type="checkbox"
              checked={settings.voice.autoStop}
              onChange={(event) => void patchVoice({ autoStop: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              {t('settings.autoStop')}
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {t('settings.autoStopHint')}
              </span>
            </span>
          </label>

          <label className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
            <input
              type="checkbox"
              checked={settings.voice.soundFeedback}
              onChange={(event) => void patchVoice({ soundFeedback: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              {t('settings.sound')}
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {t('settings.soundHint')}
              </span>
            </span>
          </label>

          {settings.voice.autoStop && (
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.silence', { seconds: (settings.voice.silenceMs / 1000).toFixed(1) })}
              </span>
              <input
                type="range"
                min={300}
                max={5000}
                step={100}
                value={settings.voice.silenceMs}
                onChange={(event) => void patchVoice({ silenceMs: Number(event.target.value) })}
                className="w-full accent-brand-600"
              />
            </label>
          )}

          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t('settings.customInstruction')}
            </span>
            <textarea
              value={settings.voice.customInstruction}
              onChange={(event) => void patchVoice({ customInstruction: event.target.value })}
              rows={3}
              maxLength={600}
              placeholder={t('settings.customInstructionPlaceholder')}
              className="form-control resize-y leading-6"
            />
            <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
              {t('settings.customInstructionHint')}
            </span>
          </label>
        </section>

        {/* Hotkeys */}
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('settings.hotkeys')}</h2>
            {hotkeys && (
              <Badge variant={hotkeys.supported ? 'success' : 'secondary'}>
                {hotkeys.supported ? t('settings.hotkeysActive') : t('settings.hotkeysUnsupported')}
              </Badge>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['dictate', 'cancel', 'ask', 'style'] as const).map((key) => {
              const inApp = key === 'cancel';
              const active = capturing === key;

              return (
                <div key={key} className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(`settings.hotkey.${key}`)}
                  </span>

                  {inApp ? (
                    <input
                      value={settings.voice.hotkeys[key]}
                      onChange={(event) =>
                        void patchVoice({
                          hotkeys: { ...settings.voice.hotkeys, [key]: event.target.value },
                        })
                      }
                      className="form-control font-mono text-xs"
                      spellCheck={false}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCapturing(active ? null : key)}
                      className={cn(
                        'flex h-9 w-full items-center justify-center gap-2 rounded-xl border font-mono text-xs transition',
                        active
                          ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-400/50 dark:bg-brand-500/10 dark:text-brand-200'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
                      )}
                    >
                      {active ? (
                        <>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                          {t('settings.captureHint')}
                        </>
                      ) : (
                        formatAccelerator(settings.voice.hotkeys[key], platform)
                      )}
                    </button>
                  )}

                  <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                    {inApp
                      ? t('settings.hotkeyInApp')
                      : active
                        ? t('settings.captureEscape')
                        : t('settings.capture')}
                  </span>
                </div>
              );
            })}
          </div>

          {hotkeys && hotkeys.failed.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">
              {hotkeys.failed.map((failure) => (
                <li key={failure.accelerator}>
                  {failure.accelerator}: {failure.reason}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{t('settings.hotkeyHint')}</p>

          {!appInfo?.isMobile && (
            <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
              <input
                type="checkbox"
                checked={autostart === true}
                disabled={autostart === null}
                onChange={(event) => void toggleAutostart(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
                {t('settings.autostart')}
                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                  {t('settings.autostartHint')}
                </span>
              </span>
            </label>
          )}
        </section>

        {/* Appearance */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('settings.appearance.title')}</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.appearance.theme')}
              </span>
              <Select
                value={settings.ui.theme}
                onValueChange={(value) =>
                  void onUpdate('ui', { ...settings.ui, theme: value as ThemePreference })
                }
                options={(['light', 'dark', 'system'] as ThemePreference[]).map((value) => ({
                  value,
                  label: t(`settings.themeOptions.${value}`),
                }))}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.appearance.language')}
              </span>
              <Select
                value={settings.general.language}
                onValueChange={(value) =>
                  void onUpdate('general', { ...settings.general, language: value })
                }
                options={[
                  { value: 'zh-CN', label: t('languages.zhCN') },
                  { value: 'en', label: t('languages.en') },
                ]}
              />
              <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
                {t('settings.appearance.languageHint')}
              </span>
            </label>

            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('settings.appearance.surface')}
              </span>
              <div className="flex gap-2">
                {(['solid', 'glass'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void onUpdate('ui', { ...settings.ui, surface: value })}
                    className={cn(
                      'btn flex-1 border',
                      settings.ui.surface === value
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-500/15 dark:text-brand-200'
                        : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300',
                    )}
                  >
                    {t(`settings.surfaceOptions.${value}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Setup */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t('settings.setupTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t('settings.rerunSetupHint')}
          </p>
          <button type="button" className="btn-secondary mt-3" onClick={onRestartSetup}>
            {t('settings.rerunSetup')}
          </button>
        </section>

        {/* About */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('settings.about')}</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
              <dt className="text-slate-600 dark:text-slate-400">{t('settings.version')}</dt>
              <dd className="font-mono text-slate-800 dark:text-slate-100">{appInfo?.version ?? '0.1.0'}</dd>
            </div>
            <div className="flex justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
              <dt className="text-slate-600 dark:text-slate-400">{t('settings.platform')}</dt>
              <dd className="font-mono text-slate-800 dark:text-slate-100">{platform}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmReset(true)}
              disabled={busy}
            >
              {busy ? t('common.working') : t('settings.reset')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void exportDiagnostics()}
              disabled={exporting}
              title={t('settings.diagnosticsHint')}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {exporting ? t('common.working') : t('settings.diagnostics')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{t('settings.diagnosticsHint')}</p>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t('settings.resetTitle')}
        description={t('settings.resetDescription')}
        confirmLabel={t('settings.reset')}
        busy={busy}
        busyLabel={t('common.working')}
        onConfirm={reset}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}
