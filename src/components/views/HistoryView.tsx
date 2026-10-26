import { useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { api } from '@/api';
import { changedPair, type Correction } from '@/lib/diff';
import { cn } from '@/lib/utils';
import type { HistoryEntry } from '@/types';

export interface HistoryViewProps {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  onUpdate: (id: string, text: string) => Promise<HistoryEntry>;
  onDelete: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface LearnTarget {
  entry: HistoryEntry;
  correction: Correction;
}

export function HistoryView({
  entries,
  loading,
  error,
  onUpdate,
  onDelete,
  onClear,
  onNotify,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<HistoryEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [learn, setLearn] = useState<LearnTarget | null>(null);
  const [learnTerm, setLearnTerm] = useState('');
  const [learnAlias, setLearnAlias] = useState('');
  const [learnBusy, setLearnBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.text.toLowerCase().includes(needle) || entry.raw.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(t('common.copied'), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    }
  };

  const reinsert = async (text: string) => {
    try {
      const outcome = await api.dictation.insert(text);
      onNotify(
        outcome.inserted ? t('voice.inserted') : t('voice.copied'),
        outcome.inserted ? 'success' : 'info',
      );
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await onDelete(deleting.id);
      setDeleting(null);
      onNotify(t('history.deleted'), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await onClear();
      setConfirmClear(false);
      onNotify(t('history.cleared'), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (entry: HistoryEntry) => {
    setEditingId(entry.id);
    setDraft(entry.text);
  };

  const saveEdit = async (entry: HistoryEntry) => {
    const text = draft.trim();
    if (!text || text === entry.text) {
      setEditingId(null);
      return;
    }

    setSavingId(entry.id);
    try {
      const updated = await onUpdate(entry.id, text);
      setEditingId(null);
      onNotify(t('history.edited'), 'success');

      // A one-word fix is a dictionary entry waiting to happen.
      const correction = changedPair(updated.raw, updated.text);
      if (correction) {
        setLearnTerm(correction.term);
        setLearnAlias(correction.alias);
        setLearn({ entry: updated, correction });
      }
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setSavingId(null);
    }
  };

  const saveLearn = async () => {
    if (!learn) return;
    const term = learnTerm.trim();
    const alias = learnAlias.trim();
    if (!term) return;

    setLearnBusy(true);
    try {
      await api.dictionary.save({
        term,
        aliases: alias && alias !== term ? [alias] : [],
        note: t('history.learnNote'),
        enabled: true,
      });
      setLearn(null);
      onNotify(t('history.learned', { term }), 'success');
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setLearnBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">{t('history.title')}</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              {t('history.subtitle', { count: entries.length })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('history.search')}
                className="form-control w-56 pl-9"
              />
            </label>
            {entries.length > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setConfirmClear(true)}>
                <TrashIcon className="h-4 w-4" />
                {t('history.clear')}
              </button>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-slate-600">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={query ? t('history.noResults') : t('history.empty')}
            description={query ? t('history.noResultsHint') : t('history.emptyHint')}
          />
        ) : (
          <ul className="space-y-2">
            {filtered.map((entry) => {
              const open = expanded === entry.id;
              const editing = editingId === entry.id;
              // Only a hand edit is a signal: polish always differs from raw.
              const correction = entry.edited ? changedPair(entry.raw, entry.text) : null;

              return (
                <li key={entry.id} className="panel p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge variant="secondary">{t(`mode.${entry.mode}`)}</Badge>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.app && <span>· {entry.app}</span>}
                    <span>· {entry.chars} {t('stats.chars')}</span>
                    <span>· {entry.asrMs + entry.polishMs}ms</span>
                    {!entry.inserted && entry.copied && (
                      <Badge variant="warning">{t('history.copiedOnly')}</Badge>
                    )}
                    {correction && !editing && (
                      <Badge variant="default">{t('history.corrected')}</Badge>
                    )}
                  </div>

                  {editing ? (
                    <div className="mt-2">
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
                        className="form-control resize-y leading-6"
                        autoFocus
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void saveEdit(entry)}
                          disabled={savingId === entry.id}
                        >
                          <CheckIcon className="h-4 w-4" />
                          {savingId === entry.id ? t('common.saving') : t('history.saveEdit')}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                          <XMarkIcon className="h-4 w-4" />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">
                      {entry.text}
                    </p>
                  )}

                  {open && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {t('history.raw')}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                        {entry.raw}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-600">
                        {entry.asrModel} → {entry.polishModel}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    <button type="button" className="btn-ghost" onClick={() => void copy(entry.text)}>
                      <ClipboardDocumentIcon className="h-4 w-4" />
                      {t('common.copy')}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => void reinsert(entry.text)}>
                      <ArrowPathIcon className="h-4 w-4" />
                      {t('history.reinsert')}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => startEdit(entry)}>
                      <PencilSquareIcon className="h-4 w-4" />
                      {t('history.edit')}
                    </button>
                    {correction && (
                      <button
                        type="button"
                        className="btn-ghost text-brand-600 dark:text-brand-300"
                        onClick={() => {
                          setLearnTerm(correction.term);
                          setLearnAlias(correction.alias);
                          setLearn({ entry, correction });
                        }}
                      >
                        <SparklesIcon className="h-4 w-4" />
                        {t('history.learn')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={cn('btn-ghost', open && 'text-brand-600 dark:text-brand-300')}
                      onClick={() => setExpanded(open ? null : entry.id)}
                    >
                      {open ? t('history.hideRaw') : t('history.showRaw')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      onClick={() => setDeleting(entry)}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t('history.clearTitle')}
        description={t('history.clearDescription')}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={clear}
        onClose={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('history.deleteTitle')}
        description={t('history.deleteDescription', {
          preview: deleting ? deleting.text.slice(0, 56) : '',
        })}
        confirmLabel={t('common.delete')}
        busy={deleteBusy}
        busyLabel={t('common.deleting')}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />

      <Modal
        open={Boolean(learn)}
        onClose={() => setLearn(null)}
        title={t('history.learnTitle')}
        description={t('history.learnHint')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setLearn(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void saveLearn()}
              disabled={learnBusy || !learnTerm.trim()}
            >
              {learnBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t('history.learnTerm')}
            </span>
            <input
              value={learnTerm}
              onChange={(event) => setLearnTerm(event.target.value)}
              className="form-control"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t('history.learnAlias')}
            </span>
            <input
              value={learnAlias}
              onChange={(event) => setLearnAlias(event.target.value)}
              className="form-control"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
