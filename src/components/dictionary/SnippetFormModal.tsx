import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import type { Snippet, SnippetInput } from '@/types';

export interface SnippetFormModalProps {
  open: boolean;
  snippet: Snippet | null;
  onClose: () => void;
  onSave: (input: SnippetInput, id?: string) => Promise<void>;
}

const EMPTY: SnippetInput = { trigger: '', expansion: '', note: '', enabled: true };

/** Errors arrive as backend codes; show the translated copy when we have one. */
function errorKey(message: string): string | null {
  if (message === 'snippet_trigger_required') return 'snippets.triggerRequired';
  if (message === 'snippet_expansion_required') return 'snippets.expansionRequired';
  if (message === 'snippet_trigger_equals_expansion') return 'snippets.sameText';
  if (message === 'snippet_trigger_too_long') return 'snippets.triggerTooLong';
  if (message === 'snippet_expansion_too_long') return 'snippets.expansionTooLong';
  return null;
}

export function SnippetFormModal({ open, snippet, onClose, onSave }: SnippetFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SnippetInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      snippet
        ? {
            trigger: snippet.trigger,
            expansion: snippet.expansion,
            note: snippet.note,
            enabled: snippet.enabled,
          }
        : EMPTY,
    );
  }, [open, snippet]);

  const submit = async () => {
    if (!form.trigger.trim()) {
      setError(t('snippets.triggerRequired'));
      return;
    }
    if (!form.expansion.trim()) {
      setError(t('snippets.expansionRequired'));
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...form, trigger: form.trigger.trim(), expansion: form.expansion.trimEnd() }, snippet?.id);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const key = errorKey(message);
      setError(key ? t(key) : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={snippet ? t('snippets.editTitle') : t('snippets.createTitle')}
      description={t('snippets.formHint')}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('snippets.trigger')}
          </span>
          <input
            value={form.trigger}
            onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value }))}
            placeholder={t('snippets.triggerPlaceholder')}
            className="form-control"
          />
          <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
            {t('snippets.triggerHint')}
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('snippets.expansion')}
          </span>
          <textarea
            value={form.expansion}
            onChange={(event) => setForm((current) => ({ ...current, expansion: event.target.value }))}
            placeholder={t('snippets.expansionPlaceholder')}
            rows={5}
            className="form-control resize-y font-mono text-xs leading-5"
            spellCheck={false}
          />
          <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
            {t('snippets.expansionHint')}
          </span>
        </label>

        {form.trigger.trim() && form.expansion.trim() && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{t('snippets.preview')}</p>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
              <span className="rounded bg-white px-1.5 py-0.5 font-medium dark:bg-white/10">
                {form.trigger.trim()}
              </span>
              <span className="mx-2 text-slate-600">→</span>
            </p>
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-600 dark:text-slate-300">
              {form.expansion.trimEnd()}
            </p>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('snippets.note')}
          </span>
          <input
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder={t('snippets.notePlaceholder')}
            className="form-control"
          />
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          <span className="text-sm text-slate-700 dark:text-slate-200">{t('snippets.enabled')}</span>
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}