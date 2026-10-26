import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import type { DictionaryEntry, DictionaryInput } from '@/types';

export interface DictionaryFormModalProps {
  open: boolean;
  entry: DictionaryEntry | null;
  onClose: () => void;
  onSave: (input: DictionaryInput, id?: string) => Promise<void>;
}

const EMPTY: DictionaryInput = { term: '', aliases: [], note: '', enabled: true };

export function DictionaryFormModal({ open, entry, onClose, onSave }: DictionaryFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<DictionaryInput>(EMPTY);
  const [aliasText, setAliasText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (entry) {
      setForm({
        term: entry.term,
        aliases: entry.aliases,
        note: entry.note,
        enabled: entry.enabled,
      });
      setAliasText(entry.aliases.join(', '));
    } else {
      setForm(EMPTY);
      setAliasText('');
    }
  }, [entry, open]);

  const submit = async () => {
    const term = form.term.trim();
    if (!term) {
      setError(t('dictionary.termRequired'));
      return;
    }

    const aliases = aliasText
      .split(',')
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0 && alias !== term);

    setSaving(true);
    try {
      await onSave({ ...form, term, aliases }, entry?.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? t('dictionary.editTitle') : t('dictionary.createTitle')}
      description={t('dictionary.formHint')}
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
            {t('dictionary.term')}
          </span>
          <input
            value={form.term}
            onChange={(event) => setForm((current) => ({ ...current, term: event.target.value }))}
            placeholder={t('dictionary.termPlaceholder')}
            className="form-control"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('dictionary.aliases')}
          </span>
          <input
            value={aliasText}
            onChange={(event) => setAliasText(event.target.value)}
            placeholder="cloud, 克劳德"
            className="form-control"
          />
          <span className="mt-1.5 block text-xs text-slate-600 dark:text-slate-400">
            {t('dictionary.aliasesHint')}
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('dictionary.note')}
          </span>
          <input
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder={t('dictionary.notePlaceholder')}
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
          <span className="text-sm text-slate-700 dark:text-slate-200">{t('dictionary.enabled')}</span>
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
