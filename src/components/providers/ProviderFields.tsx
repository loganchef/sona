import { useState, type ReactNode } from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { api } from '@/api';
import { dictationErrorKey } from '@/lib/errors';
import { isConfigured, presetById, withPreset, type ProviderPreset } from '@/lib/providers';
import type { ProviderSettings } from '@/types';

export interface ProviderFieldsProps {
  kind: 'asr' | 'polish';
  presets: ProviderPreset[];
  value: ProviderSettings;
  onChange: (next: ProviderSettings) => void;
  /** Hide the test button when the caller owns verification. */
  showTest?: boolean;
  /** Save button and other card-level actions, placed beside the test. */
  actions?: ReactNode;
  /** Lets the card header show the last known reachability. */
  onTestResult?: (reachable: boolean | null) => void;
}

/**
 * The four inputs every OpenAI-compatible provider needs, shared by the
 * providers page and the first-run wizard so the two cannot drift apart.
 *
 * Test always sends the current values, not the saved ones: during setup the
 * user has not saved yet, and testing the previous configuration is worse
 * than no test at all.
 */
export function ProviderFields({
  kind,
  presets,
  value,
  onChange,
  showTest = true,
  actions,
  onTestResult,
}: ProviderFieldsProps) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const preset = presetById(presets, value.preset) ?? presets[0];
  const complete = isConfigured(value, presets);

  const patch = (change: Partial<ProviderSettings>) => {
    setResult(null);
    onTestResult?.(null);
    onChange({ ...value, ...change });
  };

  const applyPreset = (id: string) => {
    const next = presetById(presets, id);
    if (!next) return;
    setResult(null);
    onTestResult?.(null);
    onChange(withPreset(value, next));
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await api.providers.testConfig(kind, {
        ...value,
        baseUrl: value.baseUrl.trim(),
        model: value.model.trim(),
        apiKey: value.apiKey.trim(),
      });
      const count = response.models ?? 0;
      setResult({
        ok: true,
        text: count > 0 ? t('providers.testOkModels', { count }) : t('providers.testOk'),
      });
      onTestResult?.(true);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      const key = dictationErrorKey(raw);
      setResult({ ok: false, text: key ? t(key) : raw });
      onTestResult?.(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {t('providers.preset')}
        </span>
        <Select
          value={value.preset || presets[0].id}
          onValueChange={applyPreset}
          options={presets.map((item) => ({
            value: item.id,
            label: item.label,
            description: item.baseUrl || undefined,
          }))}
        />
        <span className="mt-1.5 block text-[13px] leading-5 text-slate-600 dark:text-slate-400">
          {preset.hint}
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {t('providers.baseUrl')}
        </span>
        <input
          value={value.baseUrl}
          onChange={(event) => patch({ baseUrl: event.target.value })}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
          className="form-control font-mono text-[13px]"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {t('providers.model')}
        </span>
        <input
          value={value.model}
          onChange={(event) => patch({ model: event.target.value })}
          placeholder={kind === 'asr' ? 'whisper-large-v3-turbo' : 'deepseek-chat'}
          spellCheck={false}
          className="form-control font-mono text-[13px]"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {t('providers.apiKey')}
        </span>
        <div className="relative">
          <input
            value={value.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
            type={reveal ? 'text' : 'password'}
            placeholder={preset.needsKey ? 'sk-…' : t('providers.keyOptional')}
            autoComplete="off"
            spellCheck={false}
            className="form-control pr-11 font-mono text-[13px]"
          />
          <button
            type="button"
            onClick={() => setReveal((current) => !current)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
            aria-label={reveal ? t('providers.hideKey') : t('providers.showKey')}
          >
            {reveal ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        </div>
      </label>

      {showTest && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void test()}
              disabled={testing || !complete}
              title={
                complete
                  ? t(kind === 'asr' ? 'providers.testAsrHint' : 'providers.testPolishHint')
                  : t('providers.testNeedsConfig')
              }
            >
              <SignalIcon className="h-4 w-4" />
              {testing ? t('providers.testing') : t('providers.test')}
            </button>
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </div>

          {result && (
            <div
              role="status"
              className={
                result.ok
                  ? 'flex items-start gap-2 rounded-[10px] bg-emerald-50 px-3 py-2 text-[13px] leading-5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'flex items-start gap-2 rounded-[10px] bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300'
              }
            >
              {result.ok ? (
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{result.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
