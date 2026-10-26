import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CpuChipIcon,
  KeyIcon,
  LockClosedIcon,
  MicrophoneIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { ProviderFields } from '@/components/providers/ProviderFields';
import { api, isTauri } from '@/api';
import { captureAccelerator, formatAccelerator } from '@/lib/keys';
import { ASR_PRESETS, POLISH_PRESETS, isConfigured } from '@/lib/providers';
import { detectPlatformFromUA } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { AppInfo, AppSettings, HotkeyStatus, ProviderSettings, VoiceSettings } from '@/types';

export interface SetupWizardProps {
  settings: AppSettings;
  appInfo: AppInfo | null;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings>;
  onFinish: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const EMPTY_PROVIDER: ProviderSettings = { preset: 'none', baseUrl: '', apiKey: '', model: '' };

/**
 * First run, in the order a person actually needs it: what goes where, how the
 * voice becomes text, whether a second model should tidy it, and one key to
 * start. Every step is saved before moving on, so closing the app halfway does
 * not throw the work away.
 */
export function SetupWizard({ settings, appInfo, onUpdate, onFinish, onNotify }: SetupWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [voice, setVoice] = useState<VoiceSettings>(settings.voice);
  const [mode, setMode] = useState<'cloud' | 'local'>(
    settings.voice.localAsr.enabled ? 'local' : 'cloud',
  );
  const [polishOn, setPolishOn] = useState(
    settings.voice.polish.preset !== 'none' && isConfigured(settings.voice.polish, POLISH_PRESETS),
  );
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | null>(null);
  const [trialDone, setTrialDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trialRef = useRef<HTMLTextAreaElement>(null);

  const platform = appInfo?.platform ?? detectPlatformFromUA();
  const hotkey = formatAccelerator(voice.hotkeys.dictate, platform);

  const saveVoice = useCallback(
    async (next: VoiceSettings) => {
      setBusy(true);
      try {
        const saved = await onUpdate('voice', next);
        setVoice(saved.voice);
        return saved.voice;
      } finally {
        setBusy(false);
      }
    },
    [onUpdate],
  );

  // Refresh the real registration state when the last step opens; the wizard
  // must not claim a shortcut works just because it is written in settings.
  useEffect(() => {
    if (step !== 3 || !isTauri()) return;
    let cancelled = false;
    api.settings
      .hotkeyStatus()
      .then((status) => {
        if (!cancelled) setHotkeyStatus(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [step]);

  // Capture the next combination on the last step.
  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setCapturing(false);
        return;
      }

      const accelerator = captureAccelerator(event);
      if (!accelerator) return;

      setCapturing(false);
      setProblem(null);
      const next = {
        ...voice,
        hotkeys: { ...voice.hotkeys, dictate: accelerator },
      };
      setVoice(next);
      void saveVoice(next)
        .then(async (saved) => {
          if (!isTauri()) return;
          const status = await api.settings.hotkeyStatus();
          setHotkeyStatus(status);
          if (status.supported && !status.registered.includes(saved.hotkeys.dictate)) {
            setProblem(t('setup.hotkeyFailed'));
          } else {
            // Put the caret back in the trial box: the next press should land here.
            trialRef.current?.focus();
          }
        })
        .catch((cause) => setProblem(cause instanceof Error ? cause.message : String(cause)));
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, saveVoice, t, voice]);

  const probeLocal = async () => {
    setProbing(true);
    setLocalModels([]);
    try {
      const models = await api.providers.localModels(voice.localAsr.baseUrl.trim());
      setLocalModels(models);
      if (!voice.localAsr.model.trim() && models.length === 1) {
        setVoice((current) => ({
          ...current,
          localAsr: { ...current.localAsr, model: models[0] },
        }));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      onNotify(`${t('setup.localProbeFailed')} · ${message}`, 'error');
    } finally {
      setProbing(false);
    }
  };

  const nextFromAsr = async () => {
    if (mode === 'local') {
      if (!voice.localAsr.baseUrl.trim() || !voice.localAsr.model.trim()) {
        setProblem(t('setup.notReady'));
        return;
      }
      setProblem(null);
      await saveVoice({ ...voice, localAsr: { ...voice.localAsr, enabled: true } });
    } else {
      if (!isConfigured(voice.asr, ASR_PRESETS)) {
        setProblem(t('setup.notReady'));
        return;
      }
      setProblem(null);
      await saveVoice({ ...voice, localAsr: { ...voice.localAsr, enabled: false } });
    }
    setStep(2);
  };

  const nextFromPolish = async () => {
    if (polishOn && !isConfigured(voice.polish, POLISH_PRESETS)) {
      setProblem(t('setup.notReady'));
      return;
    }
    setProblem(null);
    await saveVoice({ ...voice, polish: polishOn ? voice.polish : { ...EMPTY_PROVIDER } });
    setStep(3);
  };

  const saveLanguage = (language: string) => {
    void onUpdate('general', { ...settings.general, language }).catch((cause) => {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    });
  };

  const finish = async () => {
    try {
      const saved = await saveVoice(voice);
      if (isTauri()) {
        const status = await api.settings.hotkeyStatus();
        setHotkeyStatus(status);
        if (status.supported && !status.registered.includes(saved.hotkeys.dictate)) {
          setProblem(t('setup.hotkeyFailed'));
          return;
        }
      }
      await onFinish();
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    }
  };

  const skip = async () => {
    try {
      await saveVoice(voice);
    } catch {
      // Skipping must never trap the user in setup.
    }
    await onFinish();
  };

  const dictateActive =
    !hotkeyStatus?.supported || Boolean(hotkeyStatus?.registered.includes(voice.hotkeys.dictate));

  return (
    <div className="relative flex min-h-dvh justify-center px-3 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-2xl">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl shadow-sm" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('app.name')}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{t('app.tagline')}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => void skip()}>
            {t('setup.skip')}
          </button>
        </header>

        {step > 0 && (
          <div className="mt-6 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-600">
              {t('setup.stepOf', { current: step, total: 3 })}
            </span>
          </div>
        )}

        <section className="panel mt-4 p-5 sm:p-7">
          {step === 0 && (
            <div className="animate-fade-in">
              <span className="eyebrow">{t('setup.privacyTitle')}</span>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('setup.welcomeTitle')}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                {t('setup.welcomeBody')}
              </p>

              <ul className="mt-6 space-y-3">
                <PrivacyPoint icon={LockClosedIcon} text={t('setup.privacyAudio')} />
                <PrivacyPoint icon={SparklesIcon} text={t('setup.privacyHold')} />
                <PrivacyPoint icon={KeyIcon} text={t('setup.privacyKeys')} />
                <PrivacyPoint icon={MicrophoneIcon} text={t('setup.privacyContext')} />
              </ul>

              <div className="mt-7 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary" onClick={() => setStep(1)}>
                  {t('setup.start')}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
                <div className="ml-auto flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => saveLanguage('zh-CN')}
                    className={cn(
                      'rounded-lg px-2 py-1',
                      settings.general.language === 'zh-CN'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10',
                    )}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    onClick={() => saveLanguage('en')}
                    className={cn(
                      'rounded-lg px-2 py-1',
                      settings.general.language === 'en'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10',
                    )}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="animate-fade-in">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('setup.asrTitle')}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('setup.asrHint')}</p>

              <div className="mt-4 inline-flex rounded-xl border border-slate-200 p-1 dark:border-white/10">
                {(['cloud', 'local'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      mode === value
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
                    )}
                  >
                    {value === 'cloud' ? t('setup.cloud') : t('setup.local')}
                  </button>
                ))}
              </div>

              {mode === 'cloud' ? (
                <div className="mt-4">
                  <ProviderFields
                    kind="asr"
                    presets={ASR_PRESETS}
                    value={voice.asr}
                    onChange={(asr) => setVoice((current) => ({ ...current, asr }))}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:bg-white/5 dark:text-slate-400">
                    {t('setup.localHint')}
                  </p>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t('providers.localUrl')}
                    </span>
                    <input
                      value={voice.localAsr.baseUrl}
                      onChange={(event) =>
                        setVoice((current) => ({
                          ...current,
                          localAsr: { ...current.localAsr, baseUrl: event.target.value },
                        }))
                      }
                      spellCheck={false}
                      className="form-control font-mono text-xs"
                      placeholder="http://127.0.0.1:8080/v1"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t('providers.localModel')}
                    </span>
                    <input
                      value={voice.localAsr.model}
                      onChange={(event) =>
                        setVoice((current) => ({
                          ...current,
                          localAsr: { ...current.localAsr, model: event.target.value },
                        }))
                      }
                      spellCheck={false}
                      className="form-control font-mono text-xs"
                      placeholder="Systran/faster-whisper-small"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void probeLocal()}
                    disabled={probing}
                  >
                    <CpuChipIcon className="h-4 w-4" />
                    {probing ? t('setup.localProbing') : t('setup.localProbe')}
                  </button>
                  {localModels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-600">
                        {t('setup.localFound', { count: localModels.length })}
                      </span>
                      {localModels.map((model) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() =>
                            setVoice((current) => ({
                              ...current,
                              localAsr: { ...current.localAsr, model },
                            }))
                          }
                          className={
                            model === voice.localAsr.model
                              ? 'rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30'
                              : 'rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15'
                          }
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="animate-fade-in">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('setup.polishTitle')}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('setup.polishHint')}</p>

              <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
                <input
                  type="checkbox"
                  checked={polishOn}
                  onChange={(event) => setPolishOn(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('setup.polishEnable')}
                </span>
                <SparklesIcon className="h-4 w-4 text-brand-500" />
              </label>

              {polishOn ? (
                <div className="mt-4">
                  <ProviderFields
                    kind="polish"
                    presets={POLISH_PRESETS}
                    value={voice.polish}
                    onChange={(polish) => setVoice((current) => ({ ...current, polish }))}
                  />
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:bg-white/5 dark:text-slate-400">
                  {t('setup.polishOffHint')}
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="animate-fade-in">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('setup.hotkeyTitle')}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t(voice.holdToTalk ? 'setup.hotkeyHintHold' : 'setup.hotkeyHint')}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="kbd">{hotkey}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setProblem(null);
                    setCapturing(true);
                  }}
                  disabled={capturing}
                >
                  {capturing ? t('setup.hotkeyCapturing') : t('setup.hotkeyCapture')}
                </button>
                {capturing && <span className="text-xs text-slate-600">{t('setup.hotkeyEscape')}</span>}
                {!capturing && dictateActive && hotkeyStatus?.supported && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    {t('setup.hotkeyOk')}
                  </span>
                )}
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t('setup.trialTitle')}
                  </h2>
                  {trialDone && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      {t('setup.trialDone')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {t(voice.holdToTalk ? 'setup.trialHintHold' : 'setup.trialHint', { hotkey })}
                </p>
                <textarea
                  ref={trialRef}
                  autoFocus
                  onPaste={() => setTrialDone(true)}
                  rows={3}
                  placeholder={t('setup.trialPlaceholder')}
                  className="form-control mt-2 resize-none text-sm leading-6"
                />
                {isTauri() ? (
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-500">
                    {trialDone
                      ? t('setup.trialDone')
                      : t(voice.holdToTalk ? 'setup.trialWaitingHold' : 'setup.trialWaiting', { hotkey })}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    {t('setup.browserTrial')}
                  </p>
                )}
              </div>

              {platform === 'macos' && isTauri() && (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  {t('setup.macPermission')}
                </p>
              )}

              <ul className="mt-6 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li>· {t('setup.privacyAudio')}</li>
                <li>· {t('setup.privacyContext')}</li>
              </ul>
            </div>
          )}

          {problem && (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {problem}
            </p>
          )}

          <div className="mt-6 flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setProblem(null);
                  setStep((current) => Math.max(0, current - 1));
                }}
                disabled={busy}
              >
                <ArrowLeftIcon className="h-4 w-4" />
                {t('setup.back')}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {step === 1 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void nextFromAsr()}
                  disabled={busy}
                >
                  {t('setup.next')}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              )}
              {step === 2 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void nextFromPolish()}
                  disabled={busy}
                >
                  {t('setup.next')}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              )}
              {step === 3 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void finish()}
                  disabled={busy || capturing || !dictateActive}
                >
                  {busy ? t('setup.finishing') : t('setup.finish')}
                  <CheckCircleIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </section>

        <p className="mt-4 text-center text-xs text-slate-600 dark:text-slate-500">
          {t('setup.privacyKeys')}
        </p>
      </div>
    </div>
  );
}

function PrivacyPoint({ icon: Icon, text }: { icon: typeof KeyIcon; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-white/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
      <span className="text-sm leading-5 text-slate-600 dark:text-slate-300">{text}</span>
    </li>
  );
}
