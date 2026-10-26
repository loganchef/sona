import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  CursorArrowRaysIcon,
  KeyIcon,
  SparklesIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { LevelBars } from '@/components/voice/LevelBars';
import { RecordButton } from '@/components/voice/RecordButton';
import { useDictation } from '@/hooks/useDictation';
import { dictationErrorKey } from '@/lib/errors';
import { playCue } from '@/lib/sounds';
import { useLevels } from '@/hooks/useLevels';
import { api } from '@/api';
import { cn } from '@/lib/utils';
import { formatAccelerator } from '@/lib/keys';
import { POLISH_PRESETS, isAsrReady, isConfigured } from '@/lib/providers';
import type { AppInfo, AppSettings, AppView, HistoryEntry, Stats, StylePack } from '@/types';

export interface DashboardProps {
  settings: AppSettings;
  appInfo: AppInfo | null;
  activePack: StylePack | null;
  stats: Stats;
  entries: HistoryEntry[];
  onNavigate: (view: AppView) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRecorded: () => void;
  onOpenSetup: () => void;
}

export function Dashboard({
  settings,
  appInfo,
  activePack,
  stats,
  entries,
  onNavigate,
  onNotify,
  onRecorded,
  onOpenSetup,
}: DashboardProps) {
  const { t } = useTranslation();
  const platform = appInfo?.platform ?? 'web';

  const dictation = useDictation({
    autoStop: settings.voice.autoStop,
    silenceMs: settings.voice.silenceMs,
    livePreview: settings.voice.livePreview,
    onFinished: (result) => {
      onRecorded();
      onNotify(
        result.insert.inserted
          ? t('voice.inserted')
          : result.insert.copied
            ? t('voice.copied')
            : t('voice.failed'),
        result.insert.inserted ? 'success' : 'info',
      );
    },
    onError: (message) => {
      const key = dictationErrorKey(message);
      onNotify(key ? t(key) : message, key === 'voice.noSpeech' ? 'info' : 'error');
    },
  });

  const levels = useLevels(dictation.level, dictation.phase === 'recording');

  const [rewriting, setRewriting] = useState(false);

  const rewriteSelection = useCallback(async () => {
    setRewriting(true);
    try {
      const outcome = await api.selection.rewrite();
      onNotify(
        outcome.inserted
          ? t('selection.replaced', { chars: [...outcome.after].length })
          : t('selection.copied'),
        outcome.inserted ? 'success' : 'info',
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const key = dictationErrorKey(message);
      onNotify(key ? t(key) : t('selection.failed'), 'error');
    } finally {
      setRewriting(false);
    }
  }, [onNotify, t]);

  const previousPhase = useRef(dictation.phase);
  useEffect(() => {
    if (settings.voice.soundFeedback === false) return;
    if (previousPhase.current !== 'recording' && dictation.phase === 'recording') playCue('start');
    if (previousPhase.current === 'recording' && dictation.phase !== 'recording') playCue('stop');
    previousPhase.current = dictation.phase;
  }, [dictation.phase, settings.voice.soundFeedback]);
  const asrReady = isAsrReady(settings.voice);
  const polishReady =
    settings.voice.polish.preset === 'none' ||
    isConfigured(settings.voice.polish, POLISH_PRESETS);
  const hotkey = formatAccelerator(settings.voice.hotkeys.dictate, platform);
  const desktop = !['android', 'ios'].includes(platform);

  const recent = useMemo(() => entries.slice(0, 4), [entries]);
  const pendingErrorKey = dictation.pending ? dictationErrorKey(dictation.pending.error) : null;

  const toggle = useCallback(() => {
    if (dictation.phase === 'recording') void dictation.stop();
    else void dictation.start();
  }, [dictation]);

  const reinsert = useCallback(
    async (text: string) => {
      try {
        const outcome = await api.dictation.insert(text);
        onNotify(outcome.inserted ? t('voice.inserted') : t('voice.copied'), outcome.inserted ? 'success' : 'info');
      } catch (cause) {
        onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
      }
    },
    [onNotify, t],
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        onNotify(t('common.copied'), 'success');
      } catch (cause) {
        onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
      }
    },
    [onNotify, t],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad animate-fade-in space-y-4">
        {/* Recording hero: one action, then the transcript. */}
        <section className="panel relative overflow-hidden">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="p-6 lg:p-8">
              <h1 className="max-w-xl text-[30px] font-semibold leading-[1.2] tracking-[-0.03em] text-slate-950 dark:text-white lg:text-[38px]">
                {desktop && settings.voice.holdToTalk
                  ? t('dashboard.title')
                  : t('dashboard.titleTap')}
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-400">
                {desktop
                  ? t(settings.voice.holdToTalk ? 'dashboard.hintHold' : 'dashboard.hint', {
                      hotkey,
                    })
                  : t('dashboard.hintTouch')}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {desktop && <span className="kbd">{hotkey}</span>}
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {t(`mode.${settings.voice.mode}`)}
                </span>
                {activePack && (
                  <button
                    type="button"
                    onClick={() => onNavigate('packs')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-white/70 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-brand-400/50 dark:hover:text-brand-200"
                    title={t('packs.manage')}
                  >
                    <SwatchIcon className="h-3.5 w-3.5" />
                    {activePack.name}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-4 border-t border-slate-200/70 bg-slate-50/60 p-6 dark:border-white/10 dark:bg-white/[0.03] lg:border-l lg:border-t-0">
              <RecordButton phase={dictation.phase} onToggle={toggle} />
              <LevelBars levels={levels} active={dictation.phase === 'recording'} className="w-56" />
              <p className="min-h-5 max-w-[19rem] text-center text-xs font-medium text-slate-600 dark:text-slate-400">
                {dictation.phase === 'recording'
                  ? dictation.partial || t('voice.listening')
                  : dictation.phase === 'processing'
                    ? t('voice.processing')
                    : desktop && settings.voice.holdToTalk
                      ? t('voice.idleHold')
                      : t('voice.idle')}
              </p>
              {desktop && (
                <button
                  type="button"
                  onClick={() => void rewriteSelection()}
                  disabled={rewriting}
                  className="btn-ghost text-xs"
                  title={t('selection.hint', {
                    hotkey: formatAccelerator(settings.voice.hotkeys.ask, platform),
                  })}
                >
                  <SparklesIcon className="h-4 w-4" />
                  {rewriting ? t('selection.working') : t('selection.action')}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-slate-200/70 px-5 py-4 dark:border-white/10">
            <div className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              {t('dashboard.lastResult')}
            </div>
            <p className="min-w-[12rem] flex-1 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
              {dictation.result?.text ?? dictation.message ?? t('dashboard.noResult')}
            </p>
            {dictation.result && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => void copyText(dictation.result?.text ?? '')}
                >
                  <ClipboardDocumentIcon className="h-4 w-4" />
                  {t('common.copy')}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => void reinsert(dictation.result?.text ?? '')}
                >
                  <CursorArrowRaysIcon className="h-4 w-4" />
                  {t('dashboard.insertAgain')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* A failed take is still recoverable: the audio never left memory. */}
        {dictation.pending && (
          <section className="panel flex flex-wrap items-center gap-4 border-amber-200/80 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t('pending.title')}</p>
              <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
                {t('pending.hint', { seconds: Math.max(1, Math.round(dictation.pending.durationMs / 1000)) })}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-amber-700/70 dark:text-amber-300/60">
                {pendingErrorKey ? t(pendingErrorKey) : dictation.pending.error}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={dictation.phase === 'processing'}
                onClick={() => void dictation.retry().catch(() => undefined)}
              >
                <ArrowPathIcon className="h-4 w-4" />
                {dictation.phase === 'processing' ? t('pending.retrying') : t('common.retry')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void dictation.discard().then(() => onNotify(t('pending.discarded'), 'info'));
                }}
              >
                {t('pending.discard')}
              </button>
            </div>
          </section>
        )}

        {/* One session strip: four counters and the fourteen-day trace. */}
        <section className="panel overflow-hidden">
          <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <Metric label={t('stats.todayCount')} value={String(stats.todayCount)} suffix={t('stats.times')} />
              <Metric label={t('stats.todayChars')} value={String(stats.todayChars)} suffix={t('stats.chars')} />
              <Metric label={t('stats.savedMinutes')} value={String(stats.savedMinutes)} suffix={t('stats.minutes')} />
              <Metric
                label={t('stats.latency')}
                value={String(stats.avgAsrMs + stats.avgPolishMs)}
                suffix="ms"
              />
            </div>
            <ActivityStrip days={stats.days} rate={stats.charsPerMin} streak={stats.streakDays} />
          </div>
        </section>

        {/* Setup checklist — only while something a dictation needs is missing. */}
        {(!asrReady || !polishReady) && (
          <section className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {t('setup.title')}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('setup.subtitle')}</p>
              </div>
              <button type="button" className="btn-primary" onClick={onOpenSetup}>
                {t('setup.cta')}
              </button>
            </div>

            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              <SetupItem done={asrReady} icon={KeyIcon} label={t('setup.asr')} />
              <SetupItem done={polishReady} icon={SparklesIcon} label={t('setup.polish')} />
            </ul>
          </section>
        )}

        {/* Recent */}
        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('dashboard.recent')}</h2>
            <button type="button" className="btn-ghost" onClick={() => onNavigate('history')}>
              {t('dashboard.viewAll')}
            </button>
          </div>

          {recent.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">{t('dashboard.emptyRecent')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200/70 dark:divide-white/10">
              {recent.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700 dark:text-slate-200">{entry.text}</p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()} · {entry.chars}
                      {t('stats.chars')} · {entry.asrMs + entry.polishMs}ms
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={() => void copyText(entry.text)}
                    aria-label={t('common.copy')}
                    title={t('common.copy')}
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

interface ActivityStripProps {
  days: { date: string; count: number; chars: number }[];
  rate: number;
  streak: number;
}

/** Fourteen quiet bars and two readings, like meters on a recorder. */
function ActivityStrip({ days, rate, streak }: ActivityStripProps) {
  const { t } = useTranslation();
  const peak = Math.max(1, ...days.map((day) => day.chars));

  return (
    <div className="border-t border-slate-200/70 px-5 py-4 dark:border-white/10 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-400">
          {t('stats.activity')}
        </p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400">
          {t('stats.streak')} <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{streak}</span>{' '}
          {t('stats.days')}
        </p>
      </div>
      <div className="mt-3 flex h-9 items-end gap-1">
        {days.map((day, index) => {
          const height = day.chars === 0 ? 0.08 : Math.max(0.16, day.chars / peak);
          const isToday = index === days.length - 1;
          return (
            <span
              key={day.date}
              title={`${day.date} · ${day.count} ${t('stats.times')} · ${day.chars} ${t('stats.chars')}`}
              className={
                isToday
                  ? 'w-2.5 rounded-sm bg-brand-500/80'
                  : 'w-2.5 rounded-sm bg-slate-300/70 dark:bg-white/15'
              }
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
        {t('stats.speechRate')}{' '}
        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{rate}</span>{' '}
        {t('stats.charsPerMin')}
      </p>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  suffix: string;
}

function Metric({ label, value, suffix }: MetricProps) {
  return (
    <div className="px-4 py-4 sm:border-l sm:border-slate-200/70 sm:first:border-l-0 dark:sm:border-white/10">
      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums leading-none text-slate-900 dark:text-white">
        {value}
        <span className="ml-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">{suffix}</span>
      </p>
    </div>
  );
}

function SetupItem({ done, icon: Icon, label }: { done: boolean; icon: typeof KeyIcon; label: string }) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm',
        done
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300',
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {done && <CheckCircleIcon className="h-4 w-4" />}
    </li>
  );
}
