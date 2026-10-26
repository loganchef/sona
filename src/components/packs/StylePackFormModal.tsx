import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { StylePack, VoiceMode } from '@/types';

const MODES: VoiceMode[] = ['raw', 'light', 'structured', 'formal'];
const NAME_MAX = 40;
const INSTRUCTION_MAX = 600;

export interface StylePackDraft {
  name: string;
  mode: VoiceMode;
  instruction: string;
}

const EMPTY: StylePackDraft = { name: '', mode: 'light', instruction: '' };

export interface StylePackFormModalProps {
  open: boolean;
  /** The custom pack being edited, or null when creating. */
  pack: StylePack | null;
  /** A built-in to start from when duplicating. */
  initial?: StylePack | null;
  /** The current setup, when the user chooses "save current setup". */
  seed?: StylePackDraft | null;
  builtinPacks: StylePack[];
  onClose: () => void;
  onSave: (draft: StylePackDraft, id?: string) => Promise<void>;
}

export function StylePackFormModal({
  open,
  pack,
  initial,
  seed,
  builtinPacks,
  onClose,
  onSave,
}: StylePackFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<StylePackDraft>(EMPTY);
  const [baseline, setBaseline] = useState<StylePackDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let next = EMPTY;
    if (pack) {
      next = { name: pack.name, mode: pack.mode, instruction: pack.instruction };
    } else if (seed) {
      next = seed;
    } else if (initial) {
      next = {
        name: `${initial.name} ${t('packs.copySuffix')}`.trim().slice(0, NAME_MAX),
        mode: initial.mode,
        instruction: initial.instruction,
      };
    }
    setForm(next);
    setBaseline(next);
    setError(null);
    setConfirmDiscard(false);
  }, [initial, open, pack, seed, t]);

  // The dialog stays mounted while switching to the discard prompt, so the
  // focus moved by Modal on open needs a second pass for the new footer.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (confirmDiscard) keepEditingRef.current?.focus();
      else nameRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [confirmDiscard, open]);

  const dirty =
    form.name !== baseline.name ||
    form.mode !== baseline.mode ||
    form.instruction !== baseline.instruction;

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError(t('packs.nameRequired'));
      return;
    }

    setSaving(true);
    try {
      await onSave(
        {
          name: form.name.trim().slice(0, NAME_MAX),
          mode: form.mode,
          instruction: form.instruction.trimEnd().slice(0, INSTRUCTION_MAX),
        },
        pack?.id,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const showingDiscard = confirmDiscard && dirty;

  return (
    <Modal
      open={open}
      onClose={showingDiscard ? () => setConfirmDiscard(false) : requestClose}
      title={
        showingDiscard
          ? t('packs.discardTitle')
          : pack
            ? t('packs.editTitle')
            : t('packs.newTitle')
      }
      description={showingDiscard ? t('packs.discardHint') : t('packs.formHint')}
      footer={
        showingDiscard ? (
          <div className="flex justify-end gap-2">
            <button
              ref={keepEditingRef}
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmDiscard(false)}
              data-autofocus
            >
              {t('packs.keepEditing')}
            </button>
            <button type="button" className="btn-danger" onClick={onClose}>
              {t('packs.discardChanges')}
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={requestClose}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )
      }
    >
      {showingDiscard ? (
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t('packs.discardBody')}
        </p>
      ) : (
        <div className="space-y-4">
          {!pack && builtinPacks.length > 0 && (
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('packs.startFrom')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {builtinPacks.map((builtin) => (
                  <button
                    key={builtin.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        name: `${builtin.name} ${t('packs.copySuffix')}`.trim().slice(0, NAME_MAX),
                        mode: builtin.mode,
                        instruction: builtin.instruction,
                      })
                    }
                    className="min-h-9 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-brand-400/50 dark:hover:text-brand-200"
                  >
                    {builtin.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('packs.name')}
            </span>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              onKeyDown={(event) => {
                // Enter also confirms an IME candidate; submitting there would
                // save a half-typed Chinese name.
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('packs.namePlaceholder')}
              maxLength={NAME_MAX}
              className="form-control"
              data-autofocus
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('packs.mode')}
            </span>
            <Select
              value={form.mode}
              onValueChange={(value) => setForm((current) => ({ ...current, mode: value as VoiceMode }))}
              options={MODES.map((mode) => ({
                value: mode,
                label: t(`mode.${mode}`),
                description: t(`mode.${mode}Hint`),
              }))}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('packs.instruction')}
              <span className="text-xs font-normal text-slate-600">
                {form.instruction.length}/{INSTRUCTION_MAX}
              </span>
            </span>
            <textarea
              value={form.instruction}
              onChange={(event) =>
                setForm((current) => ({ ...current, instruction: event.target.value }))
              }
              placeholder={t('packs.instructionPlaceholder')}
              rows={5}
              maxLength={INSTRUCTION_MAX}
              className="form-control resize-y leading-6"
            />
            <span className={cn('mt-1.5 block text-xs', form.mode === 'raw' ? 'text-amber-600 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400')}>
              {form.mode === 'raw' ? t('packs.rawHint') : t('packs.instructionHint')}
            </span>
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
