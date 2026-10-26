import { useEffect, useState } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api';
import { ProviderFields } from '@/components/providers/ProviderFields';
import { ASR_PRESETS, BINRC_DESK_HOME, POLISH_PRESETS, isConfigured, type ProviderPreset } from '@/lib/providers';
import { openExternal } from '@/lib/external';
import { dictationErrorKey } from '@/lib/errors';
import type { ProviderSettings, SecretBackend, VoiceSettings } from '@/types';

export interface ProvidersViewProps {
  voice: VoiceSettings;
  secretBackend?: SecretBackend;
  onSave: (next: VoiceSettings) => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ProvidersView({ voice, secretBackend, onSave, onNotify }: ProvidersViewProps) {
  const { t } = useTranslation();

  const openDesk = async () => {
    try {
      await openExternal(BINRC_DESK_HOME);
    } catch {
      onNotify(t('providers.openFailed'), 'error');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad space-y-4">
        <header>
          <h1 className="page-title">{t('providers.title')}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t('providers.subtitle')}
          </p>
        </header>

        <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">BINRC Desk</h2>
              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-400/15 dark:text-brand-300">
                {t('providers.deskBadge')}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-slate-600 dark:text-slate-300">
              {t('providers.deskBody')}
            </p>
          </div>
          <button type="button" onClick={openDesk} className="btn-secondary shrink-0 self-start sm:self-auto">
            {t('providers.deskCta')}
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </button>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ProviderCard
            kind="asr"
            title={t('providers.asrTitle')}
            description={t('providers.asrDescription')}
            presets={ASR_PRESETS}
            provider={voice.asr}
            onSave={async (provider) => {
              await onSave({ ...voice, asr: provider });
              onNotify(t('providers.saved'), 'success');
            }}
            onNotify={onNotify}
          />
          <ProviderCard
            kind="polish"
            title={t('providers.polishTitle')}
            description={t('providers.polishDescription')}
            presets={POLISH_PRESETS}
            provider={voice.polish}
            onSave={async (provider) => {
              await onSave({ ...voice, polish: provider });
              onNotify(t('providers.saved'), 'success');
            }}
            onNotify={onNotify}
          />
        </div>

        <LocalAsrCard
          voice={voice}
          onSave={onSave}
          onNotify={onNotify}
        />

        <section className="panel p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('providers.privacyTitle')}</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>· {t('providers.privacyAudio')}</li>
            <li>· {t('providers.privacyContext')}</li>
            <li>· {t('providers.privacyStorage')}</li>
          </ul>
          {secretBackend === 'file' && (
            <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('providers.keychainFallback')}</span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

interface LocalAsrCardProps {
  voice: VoiceSettings;
  onSave: (next: VoiceSettings) => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * A whisper server on this machine: same OpenAI shape, no key, nothing leaves
 * the computer. The card exists because "本地识别" used to be a dead switch.
 */
function LocalAsrCard({ voice, onSave, onNotify }: LocalAsrCardProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(voice.localAsr);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    setLocal(voice.localAsr);
  }, [voice.localAsr]);

  const commit = async (patch: Partial<typeof local>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    await onSave({ ...voice, localAsr: next });
  };

  const test = async () => {
    setTesting(true);
    try {
      // Test what is on screen; the fields save on blur, which races with a click.
      const result = await api.providers.testConfig('asr', {
        preset: 'local',
        baseUrl: local.baseUrl.trim(),
        apiKey: '',
        model: local.model.trim(),
      });
      const count = result.models ?? 0;
      onNotify(count > 0 ? t('providers.testOkModels', { count }) : t('providers.testOk'), 'success');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const key = dictationErrorKey(message);
      onNotify(`${t('providers.testFailed')} · ${key ? t(key) : message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  // `GET /models` only: no audio, no key. If the server lists nothing, the
  // problem is the server, not the dictation.
  const probe = async () => {
    setProbing(true);
    setModels([]);
    try {
      const found = await api.providers.localModels(local.baseUrl.trim());
      setModels(found);
      onNotify(t('providers.localFound', { count: found.length }), 'success');
      if (!local.model.trim() && found.length === 1) {
        await commit({ model: found[0] });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const key = dictationErrorKey(message);
      onNotify(`${t('providers.localProbeFailed')} · ${key ? t(key) : message}`, 'error');
    } finally {
      setProbing(false);
    }
  };

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t('providers.localTitle')}
        </h2>
        <Badge variant={local.enabled ? 'success' : 'secondary'} className="shrink-0">
          {local.enabled ? t('providers.localOn') : t('providers.localOff')}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('providers.localHint')}</p>

      <label className="mt-3 flex items-center gap-3 rounded-[10px] border border-slate-200 px-3.5 py-2.5 dark:border-white/10">
        <input
          type="checkbox"
          checked={local.enabled}
          onChange={(event) => void commit({ enabled: event.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
          {t('providers.localEnable')}
        </span>
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            {t('providers.localUrl')}
          </span>
          <input
            value={local.baseUrl}
            onChange={(event) => setLocal({ ...local, baseUrl: event.target.value })}
            onBlur={() => void commit({ baseUrl: local.baseUrl })}
            className="form-control font-mono text-[13px]"
            spellCheck={false}
            placeholder="http://127.0.0.1:8080/v1"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            {t('providers.localModel')}
          </span>
          <input
            value={local.model}
            onChange={(event) => setLocal({ ...local, model: event.target.value })}
            onBlur={() => void commit({ model: local.model })}
            className="form-control font-mono text-[13px]"
            spellCheck={false}
            placeholder="Systran/faster-whisper-small"
          />
        </label>
      </div>

      {models.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-slate-600 dark:text-slate-400">{t('providers.localModels')}</span>
          {models.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => void commit({ model })}
              className={
                model === local.model
                  ? 'rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30'
                  : 'rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15'
              }
            >
              {model}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => void probe()} disabled={probing || !local.baseUrl.trim()}>
          <MagnifyingGlassIcon className="h-4 w-4" />
          {probing ? t('providers.localProbing') : t('providers.localProbe')}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void test()} disabled={testing || !local.baseUrl.trim() || !local.model.trim()}>
          <SignalIcon className="h-4 w-4" />
          {testing ? t('providers.testing') : t('providers.test')}
        </button>
        <span className="text-[13px] leading-5 text-slate-600 dark:text-slate-400">{t('providers.localTestHint')}</span>
      </div>
    </section>
  );
}

interface ProviderCardProps {
  kind: 'asr' | 'polish';
  title: string;
  description: string;
  presets: ProviderPreset[];
  provider: ProviderSettings;
  onSave: (provider: ProviderSettings) => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function ProviderCard({ kind, title, description, presets, provider, onSave, onNotify }: ProviderCardProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProviderSettings>(provider);
  const [saving, setSaving] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    setDraft(provider);
  }, [provider]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.apiKey.trim() });
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        {reachable === false ? (
          <Badge variant="danger" className="shrink-0">
            <ExclamationCircleIcon className="h-3.5 w-3.5" />
            {t('providers.unreachable')}
          </Badge>
        ) : reachable === true ? (
          <Badge variant="success" className="shrink-0">
            <CheckCircleIcon className="h-3.5 w-3.5" />
            {t('providers.reachable')}
          </Badge>
        ) : isConfigured(draft, presets) ? (
          <Badge variant="success" className="shrink-0">
            <CheckCircleIcon className="h-3.5 w-3.5" />
            {t('providers.ready')}
          </Badge>
        ) : (
          <Badge variant="secondary">{t('providers.notReady')}</Badge>
        )}
      </div>

      <div className="mt-4">
        <ProviderFields
          kind={kind}
          presets={presets}
          value={draft}
          onChange={setDraft}
          onTestResult={setReachable}
          actions={
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          }
        />
      </div>
    </section>
  );
}
