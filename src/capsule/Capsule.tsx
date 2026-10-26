import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, MicrophoneIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/solid';
import { useTranslation } from 'react-i18next';
import { api, isTauri } from '@/api';
import i18n, { normalizeLanguage } from '@/i18n';
import { useDictation } from '@/hooks/useDictation';
import { useLevels } from '@/hooks/useLevels';
import { dictationErrorKey } from '@/lib/errors';
import { formatAccelerator } from '@/lib/keys';
import { playCue } from '@/lib/sounds';
import { detectPlatformFromUA } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { AppSettings, SelectionOutcome, StylePack } from '@/types';

interface HotkeyPayload {
  action: string;
  accelerator: string;
}

/**
 * The floating dictation pill.
 *
 * It is the only window that owns the recording state machine on desktop: the
 * global hotkey handler shows this window and emits an event, so the same hook
 * drives desktop and (in the future) the mobile overlay.
 */
export function Capsule() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionOutcome | null>(null);
  const [styleNotice, setStyleNotice] = useState<StylePack | null>(null);
  const hideTimer = useRef<number | null>(null);
  // A hold-to-talk release can arrive before getUserMedia resolves.
  const holdStop = useRef(false);
  const holdArmed = useRef(false);

  const dictation = useDictation({
    autoStop: settings?.voice.autoStop ?? true,
    silenceMs: settings?.voice.silenceMs ?? 1200,
    livePreview: settings?.voice.livePreview ?? false,
    onFinished: () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => void hideWindow(), 1500);
    },
    onError: (message) => {
      const key = dictationErrorKey(message);
      setProblem(key ? t(key) : message);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      // Leave the pill up long enough to click the mic and retry a kept take.
      const noSpeech = key === 'voice.noSpeech';
      hideTimer.current = window.setTimeout(() => void hideWindow(), noSpeech ? 2600 : 6500);
    },
  });

  const levels = useLevels(dictation.level, dictation.phase === 'recording');

  // Two blips, nothing more: the user already knows they pressed the key.
  const previousPhase = useRef(dictation.phase);
  useEffect(() => {
    if (settings?.voice.soundFeedback === false) return;
    if (previousPhase.current !== 'recording' && dictation.phase === 'recording') playCue('start');
    if (previousPhase.current === 'recording' && dictation.phase !== 'recording') playCue('stop');
    previousPhase.current = dictation.phase;
  }, [dictation.phase, settings?.voice.soundFeedback]);

  // The capsule runs in its own webview, so it picks the language itself.
  useEffect(() => {
    if (!settings) return;
    const language = normalizeLanguage(settings.general.language);
    if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [settings]);

  // Settings are read once and refreshed on focus: the capsule never blocks startup.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.settings
        .get()
        .then((response) => {
          if (!cancelled) setSettings(response.settings);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  const toggle = useCallback(() => {
    if (dictation.phase === 'recording') void dictation.stop();
    else if (dictation.phase === 'error' && dictation.pending) {
      // The audio is still in memory: one click is cheaper than speaking again.
      void dictation.retry().catch(() => undefined);
    } else if (dictation.phase === 'done' || dictation.phase === 'error') {
      dictation.reset();
      void dictation.start();
    } else if (dictation.phase === 'idle') {
      setProblem(null);
      setSelection(null);
      setStyleNotice(null);
      void dictation.start();
    }
  }, [dictation]);

  // The microphone opens asynchronously. If the user released the hold key
  // during that window, stop as soon as the take actually begins.
  useEffect(() => {
    if (dictation.phase === 'recording' && holdStop.current) {
      holdStop.current = false;
      void dictation.stop();
    } else if (dictation.phase === 'error' || dictation.phase === 'done') {
      holdStop.current = false;
      holdArmed.current = false;
    }

    if (dictation.phase === 'recording') setStyleNotice(null);
  }, [dictation.phase, dictation.stop]);

  const cancel = useCallback(() => {
    holdStop.current = false;
    holdArmed.current = false;
    setStyleNotice(null);
    dictation.cancel();
    void hideWindow();
  }, [dictation]);

  // Global hotkey, tray and selection events (desktop).
  useEffect(() => {
    if (!isTauri()) return;
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    const revealSoon = (ms: number) => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => void hideWindow(), ms);
    };

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const register = async <T,>(event: string, handler: (payload: T) => void) => {
        const unlisten = await listen<T>(event, (message) => handler(message.payload));
        if (cancelled) unlisten();
        else cleanups.push(unlisten);
      };

      await register<HotkeyPayload>('sona://hotkey', (payload) => {
        if (payload.action === 'dictate') {
          toggle();
        } else if (payload.action === 'dictate-start') {
          // A release left over from a cancelled take must not stop this one.
          holdStop.current = false;
          holdArmed.current = true;
          if (dictation.phase !== 'recording') toggle();
        } else if (payload.action === 'dictate-stop') {
          if (dictation.phase === 'recording') void dictation.stop();
          else if (dictation.phase === 'idle' && holdArmed.current) holdStop.current = true;
          holdArmed.current = false;
        }
      });

      await register<{ action: string }>('sona://tray', (payload) => {
        if (payload.action === 'dictate') toggle();
      });

      // The style hotkey already updated settings in Rust. The capsule only
      // reports the new pack; the next take picks it up from the backend.
      await register<StylePack>('sona://style-pack', (payload) => {
        if (dictation.phase === 'recording' || dictation.phase === 'processing') return;
        setProblem(null);
        setSelection(null);
        setStyleNotice(payload);
        setSettings((current) =>
          current
            ? {
                ...current,
                voice: {
                  ...current.voice,
                  mode: payload.mode,
                  customInstruction: payload.instruction,
                  activeStylePack: payload.id,
                },
              }
            : current,
        );
        revealSoon(2200);
      });

      await register<{ reason: string }>('sona://style-pack-error', (payload) => {
        setStyleNotice(null);
        const key = dictationErrorKey(payload.reason);
        setProblem(key ? t(key) : payload.reason);
        revealSoon(2600);
      });

      // A selection rewrite reports back after it has already been pasted; the
      // pill then shows what changed for a couple of seconds.
      await register<SelectionOutcome>('sona://selection', (payload) => {
        setProblem(null);
        setSelection(payload);
        if (settings?.voice.soundFeedback !== false) playCue('stop');
        revealSoon(2400);
      });

      await register<{ reason: string }>('sona://selection-error', (payload) => {
        setSelection(null);
        const key = dictationErrorKey(payload.reason);
        setProblem(
          key === 'voice.noSpeech'
            ? t('selection.noSelection')
            : key
              ? t(key)
              : payload.reason,
        );
        revealSoon(2600);
      });
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [dictation.phase, dictation.stop, settings?.voice.soundFeedback, t, toggle]);

  // Esc cancels, Enter finishes — the whole pill is keyboard-drivable.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && dictation.phase === 'recording') {
        event.preventDefault();
        void dictation.stop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel, dictation]);

  useEffect(() => {
    if (dictation.phase !== 'recording') {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    return () => window.clearInterval(timer);
  }, [dictation.phase]);

  const hint = settings
    ? t(settings.voice.holdToTalk ? 'capsule.holdHint' : 'capsule.hint', {
        hotkey: formatAccelerator(settings.voice.hotkeys.dictate, detectPlatformFromUA()),
      })
    : t('capsule.idle');

  const recording = dictation.phase === 'recording';
  const processing = dictation.phase === 'processing';

  return (
    <div
      data-tauri-drag-region
      className={cn(
        'flex h-[104px] w-[444px] items-center gap-4 rounded-[26px] border px-5',
        'border-white/25 bg-slate-950/72 shadow-[0_24px_64px_-18px_rgb(0_0_0/0.75)] backdrop-blur-2xl',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white transition',
          recording ? 'bg-red-500' : 'bg-brand-600 hover:bg-brand-500',
        )}
        aria-label={recording ? 'stop' : 'start'}
      >
        {processing ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : dictation.pending && dictation.phase === 'error' ? (
          <ArrowPathIcon className="h-5 w-5" />
        ) : (
          <MicrophoneIcon className="h-5 w-5" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold tracking-wide text-white/90">
            {recording
              ? t('capsule.listening', { seconds: (elapsed / 1000).toFixed(1) })
              : processing
                ? t('capsule.processing')
                : selection
                  ? t('selection.done')
                  : styleNotice
                    ? t('packs.capsuleTitle', { name: styleNotice.name })
                    : dictation.result
                      ? t('capsule.done')
                      : t('capsule.idle')}
          </span>
          {settings && (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
              {t(`mode.${styleNotice?.mode ?? settings.voice.mode}`)}
            </span>
          )}
        </div>

        {recording ? (
          dictation.partial ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/70">
              {dictation.partial}
            </p>
          ) : (
            <div className="mt-2 flex h-7 items-end gap-[3px]">
              {levels.slice(-40).map((level, index) => (
                <span
                  key={index}
                  className="w-[3px] rounded-full bg-gradient-to-t from-brand-400 to-sky-300"
                  style={{ height: `${Math.max(12, Math.round(level * 100))}%` }}
                />
              ))}
            </div>
          )
        ) : (
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/70">
            {selection?.after ??
              (styleNotice
                ? styleNotice.instruction || t(`mode.${styleNotice.mode}Hint`)
                : dictation.result?.text) ??
              (problem
                ? dictation.pending && dictation.phase === 'error'
                  ? `${problem} · ${t('capsule.retryHint')}`
                  : problem
                : hint)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {(dictation.phase === 'done' || selection) && (
          <CheckIcon className="h-5 w-5 text-emerald-400" />
        )}
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="cancel"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

async function hideWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}
