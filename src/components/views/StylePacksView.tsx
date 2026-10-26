import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BoltIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  SwatchIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { api } from '@/api';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StylePackFormModal, type StylePackDraft } from '@/components/packs/StylePackFormModal';
import { cn, copyToClipboard } from '@/lib/utils';
import { detectPlatformFromUA } from '@/lib/platform';
import { dictationErrorKey } from '@/lib/errors';
import { formatAccelerator } from '@/lib/keys';
import type { AppSettings, StylePack, VoiceMode } from '@/types';

const PACK_LIMIT = 24;
const NAME_MAX = 40;
const INSTRUCTION_MAX = 600;
const MODES: VoiceMode[] = ['raw', 'light', 'structured', 'formal'];

export interface StylePacksViewProps {
  settings: AppSettings;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<unknown>;
  onApply: (id: string) => Promise<unknown>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * Voice packs are reusable answers to "how should this take sound?".
 *
 * Built-ins come from Rust so the hotkey and the page agree on the same list;
 * only custom packs are persisted. Applying a pack copies its mode and
 * instruction into the live settings, which means a manual edit makes the
 * active pack "adjusted" rather than silently rewriting the pack itself.
 */
export function StylePacksView({ settings, onUpdate, onApply, onNotify }: StylePacksViewProps) {
  const { t } = useTranslation();
  const [builtins, setBuiltins] = useState<StylePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StylePack | null>(null);
  const [initial, setInitial] = useState<StylePack | null>(null);
  const [seed, setSeed] = useState<StylePackDraft | null>(null);
  const [deleting, setDeleting] = useState<StylePack | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.packs.list();
      setBuiltins(list.filter((pack) => pack.builtin));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, settings.general.language]);

  // Built-ins come from Rust; custom packs always come from the settings we
  // just saved, so the page updates without a second round trip.
  const packs = [
    ...builtins,
    ...settings.voice.stylePacks.map((pack) => ({ ...pack, builtin: false })),
  ];
  const active = packs.find((pack) => pack.id === settings.voice.activeStylePack) ?? null;
  const customized = Boolean(
    active &&
      (active.mode !== settings.voice.mode ||
        active.instruction !== settings.voice.customInstruction),
  );
  // The active panel shows what is actually applied. Cards keep showing
  // the pack itself so "reapply" still has a visible target.
  const appliedMode = customized ? settings.voice.mode : active?.mode;
  const appliedInstruction = customized
    ? settings.voice.customInstruction
    : active?.instruction;
  const excluded = settings.voice.excludedStylePacks ?? [];
  const includedCount = packs.filter((pack) => !excluded.includes(pack.id)).length;
  const platform = detectPlatformFromUA();
  const desktop = !['android', 'ios'].includes(platform);
  const styleHotkey = formatAccelerator(settings.voice.hotkeys.style, platform);

  const reportError = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : String(cause);
    const key = dictationErrorKey(code);
    onNotify(key ? t(key) : code, 'error');
  };

  const apply = async (pack: StylePack) => {
    setBusy(pack.id);
    try {
      await onApply(pack.id);
      onNotify(t('packs.applied', { name: pack.name }), 'success');
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(null);
    }
  };

  const toggleCycle = async (pack: StylePack) => {
    const next = excluded.includes(pack.id)
      ? excluded.filter((id) => id !== pack.id)
      : [...excluded, pack.id];
    setBusy('cycle');
    try {
      await onUpdate('voice', { ...settings.voice, excludedStylePacks: next });
      onNotify(
        next.includes(pack.id)
          ? t('packs.removedFromCycle', { name: pack.name })
          : t('packs.addedToCycle', { name: pack.name }),
        'success',
      );
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(null);
    }
  };

  const moveCustom = async (pack: StylePack, delta: -1 | 1) => {
    const list = [...settings.voice.stylePacks];
    const index = list.findIndex((item) => item.id === pack.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;

    [list[index], list[target]] = [list[target], list[index]];
    setBusy('order');
    try {
      await onUpdate('voice', { ...settings.voice, stylePacks: list });
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(null);
    }
  };

  const save = async (draft: StylePackDraft, id?: string) => {
    const custom = [...settings.voice.stylePacks];
    let saved: StylePack;

    if (id) {
      const index = custom.findIndex((pack) => pack.id === id);
      if (index < 0) throw new Error('style_pack_not_found');
      saved = { ...custom[index], ...draft, id, builtin: false };
      custom[index] = saved;
    } else {
      if (custom.length >= PACK_LIMIT) throw new Error(t('packs.limit'));
      saved = { ...draft, id: uid(), builtin: false };
      custom.unshift(saved);
    }

    // Editing the active pack should keep dictation in sync; creating a pack
    // also applies it, because otherwise "save" would produce an unused row.
    const useNow = !id || id === settings.voice.activeStylePack;

    await onUpdate('voice', {
      ...settings.voice,
      stylePacks: custom.slice(0, PACK_LIMIT),
      ...(useNow
        ? {
            mode: saved.mode,
            customInstruction: saved.instruction,
            activeStylePack: saved.id,
          }
        : {}),
    });

    onNotify(id ? t('packs.saved') : t('packs.created'), 'success');
  };

  const remove = async (pack: StylePack) => {
    setDeleteBusy(true);
    try {
      const stylePacks = settings.voice.stylePacks.filter((item) => item.id !== pack.id);
      await onUpdate('voice', {
        ...settings.voice,
        stylePacks,
        activeStylePack:
          settings.voice.activeStylePack === pack.id ? '' : settings.voice.activeStylePack,
        excludedStylePacks: (settings.voice.excludedStylePacks ?? []).filter(
          (id) => id !== pack.id,
        ),
      });
      setDeleting(null);
      onNotify(t('packs.deleted'), 'success');
    } catch (cause) {
      reportError(cause);
    } finally {
      setDeleteBusy(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setInitial(null);
    setSeed(null);
    setFormOpen(true);
  };

  const openCurrent = () => {
    setEditing(null);
    setInitial(null);
    setSeed({
      name: '',
      mode: settings.voice.mode,
      instruction: settings.voice.customInstruction,
    });
    setFormOpen(true);
  };

  const openEdit = (pack: StylePack) => {
    setEditing(pack);
    setInitial(null);
    setSeed(null);
    setFormOpen(true);
  };

  const duplicate = (pack: StylePack) => {
    setEditing(null);
    setInitial(pack);
    setSeed(null);
    setFormOpen(true);
  };

  const importPacks = async () => {
    setBusy('import');
    try {
      const raw = await readClipboardText(t('packs.clipboardUnavailable'));
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(t('packs.importFailed'));
      }
      const candidates = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.packs)
          ? parsed.packs
          : null;
      if (!candidates) throw new Error(t('packs.importFailed'));

      const existing = settings.voice.stylePacks;
      const used = new Set([...packs.map((pack) => pack.id), ...existing.map((pack) => pack.id)]);
      const seen = new Set(existing.map(packKey));
      const additions: StylePack[] = [];
      let skipped = 0;

      for (const candidate of candidates) {
        if (!isRecord(candidate)) continue;

        const name = String(candidate.name ?? '').trim().slice(0, NAME_MAX);
        if (!name) continue;

        const mode = MODES.includes(candidate.mode as VoiceMode)
          ? (candidate.mode as VoiceMode)
          : 'light';
        const instruction = String(candidate.instruction ?? '').slice(0, INSTRUCTION_MAX);
        const pack: StylePack = { id: '', name, mode, instruction, builtin: false };
        const key = packKey(pack);
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        if (existing.length + additions.length >= PACK_LIMIT) break;

        let id = String(candidate.id ?? '').trim().slice(0, 64);
        if (!id || used.has(id)) id = uid();
        used.add(id);
        seen.add(key);
        additions.push({ ...pack, id });
      }

      if (additions.length === 0) {
        throw new Error(
          skipped > 0 ? t('packs.importDuplicate') : t('packs.importEmpty'),
        );
      }

      // Append in file order: a backup restored twice should look the same,
      // and the hotkey cycle follows this list.
      await onUpdate('voice', {
        ...settings.voice,
        stylePacks: [...existing, ...additions].slice(0, PACK_LIMIT),
      });
      onNotify(
        skipped > 0
          ? t('packs.importedSkipped', { count: additions.length, skipped })
          : t('packs.imported', { count: additions.length }),
        'success',
      );
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(null);
    }
  };

  const exportPacks = async () => {
    const custom = settings.voice.stylePacks;
    if (custom.length === 0) {
      onNotify(t('packs.exportEmpty'), 'info');
      return;
    }
    const copied = await copyToClipboard(JSON.stringify({ version: 1, packs: custom }, null, 2));
    onNotify(copied ? t('packs.exported') : t('packs.exportFailed'), copied ? 'success' : 'error');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad space-y-4 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">{t('packs.title')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t('packs.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void importPacks()}
              disabled={busy === 'import'}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {t('packs.import')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void exportPacks()}>
              <ArrowUpTrayIcon className="h-4 w-4" />
              {t('packs.export')}
            </button>
            <button type="button" className="btn-primary" onClick={openCreate}>
              <PlusIcon className="h-4 w-4" />
              {t('packs.create')}
            </button>
          </div>
        </header>

        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="eyebrow">{t('packs.active')}</span>
              {loading ? (
                <div className="mt-3 max-w-xl space-y-2" aria-hidden>
                  <span className="block h-5 w-40 animate-pulse rounded-md bg-slate-200/80 dark:bg-white/10" />
                  <span className="block h-3.5 w-full animate-pulse rounded bg-slate-200/70 dark:bg-white/10" />
                  <span className="block h-3.5 w-3/4 animate-pulse rounded bg-slate-200/70 dark:bg-white/10" />
                </div>
              ) : active ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                      {active.name}
                    </h2>
                    {appliedMode && <Badge>{t(`mode.${appliedMode}`)}</Badge>}
                    {active.builtin && <Badge variant="secondary">{t('packs.builtin')}</Badge>}
                    {customized && <Badge variant="warning">{t('packs.adjusted')}</Badge>}
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {appliedInstruction || t(`mode.${active.mode}Hint`)}
                  </p>
                  {customized && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {t('packs.adjustedHint')}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('packs.none')}</p>
                  <button type="button" className="btn-secondary mt-3" onClick={openCurrent}>
                    <BookmarkIcon className="h-4 w-4" />
                    {t('packs.saveCurrent')}
                  </button>
                </>
              )}
            </div>

            {(desktop || (active && customized)) && (
              <div className="flex flex-col items-end gap-2">
                {desktop && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    <BoltIcon className="h-3.5 w-3.5" />
                    {t('packs.cycleHint', { hotkey: styleHotkey })}
                  </span>
                )}
                {active && customized && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void apply(active)}
                    disabled={busy !== null}
                  >
                    {t('packs.reapply')}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {loading ? (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="panel animate-pulse space-y-3 p-4">
                <span className="block h-4 w-1/2 rounded bg-slate-200/80 dark:bg-white/10" />
                <span className="block h-3 w-1/4 rounded bg-slate-200/60 dark:bg-white/10" />
                <span className="block h-3 w-full rounded bg-slate-200/60 dark:bg-white/10" />
                <span className="block h-3 w-5/6 rounded bg-slate-200/60 dark:bg-white/10" />
                <span className="block h-8 w-24 rounded-lg bg-slate-200/60 dark:bg-white/10" />
              </li>
            ))}
          </ul>
        ) : error ? (
          <div className="panel p-5 text-sm text-red-600 dark:text-red-400">
            <p>{error}</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {packs.map((pack) => {
              const isActive = pack.id === settings.voice.activeStylePack;
              const inCycle = !excluded.includes(pack.id);
              const customIndex = settings.voice.stylePacks.findIndex((item) => item.id === pack.id);
              return (
                <li
                  key={pack.id}
                  className={`panel flex flex-col gap-3 p-4 ${
                    isActive ? 'ring-2 ring-brand-500/70' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                        <SwatchIcon className="h-4 w-4 shrink-0 text-brand-500" />
                        <span className="truncate">{pack.name}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {t(`mode.${pack.mode}`)}
                        {pack.builtin ? ` · ${t('packs.builtin')}` : ''}
                      </p>
                    </div>
                    {isActive && <Badge variant={customized ? 'warning' : 'success'}>{customized ? t('packs.adjusted') : t('packs.inUse')}</Badge>}
                  </div>

                  <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {pack.instruction || t(`mode.${pack.mode}Hint`)}
                  </p>

                  <label
                    className={cn(
                      'flex w-fit items-center gap-2 text-xs',
                      inCycle ? 'text-slate-600 dark:text-slate-300' : 'text-slate-600 dark:text-slate-500',
                      inCycle && includedCount <= 1 ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                    title={inCycle && includedCount <= 1 ? t('packs.cycleNeedOne') : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={inCycle}
                      onChange={() => void toggleCycle(pack)}
                      disabled={busy !== null || (inCycle && includedCount <= 1)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-brand-600"
                    />
                    {t('packs.cycleInclude')}
                  </label>

                  <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void apply(pack)}
                      disabled={busy !== null || (isActive && !customized)}
                    >
                      {isActive && !customized ? t('packs.inUse') : t('packs.use')}
                    </button>
                    {pack.builtin ? (
                      <button
                        type="button"
                        className="btn-ghost ml-auto"
                        onClick={() => duplicate(pack)}
                      >
                        <DocumentDuplicateIcon className="h-4 w-4" />
                        {t('packs.duplicate')}
                      </button>
                    ) : (
                      <>
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={t('packs.moveUp')}
                            title={t('packs.moveUp')}
                            className="btn-ghost px-2"
                            disabled={busy !== null || customIndex <= 0}
                            onClick={() => void moveCustom(pack, -1)}
                          >
                            <ChevronUpIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('packs.moveDown')}
                            title={t('packs.moveDown')}
                            className="btn-ghost px-2"
                            disabled={busy !== null || customIndex < 0 || customIndex >= settings.voice.stylePacks.length - 1}
                            onClick={() => void moveCustom(pack, 1)}
                          >
                            <ChevronDownIcon className="h-4 w-4" />
                          </button>
                          <button type="button" className="btn-ghost" onClick={() => openEdit(pack)}>
                            <PencilSquareIcon className="h-4 w-4" />
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            aria-label={t('common.delete')}
                            title={t('common.delete')}
                            className="btn-ghost px-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                            onClick={() => setDeleting(pack)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <StylePackFormModal
        open={formOpen}
        pack={editing}
        initial={initial}
        seed={seed}
        builtinPacks={packs.filter((pack) => pack.builtin)}
        onClose={() => {
          setFormOpen(false);
          setSeed(null);
        }}
        onSave={save}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('packs.deleteTitle')}
        description={t('packs.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        busy={deleteBusy}
        busyLabel={t('common.deleting')}
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function packKey(pack: StylePack): string {
  return JSON.stringify([pack.name.trim(), pack.mode, pack.instruction.trim()]);
}

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pack-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readClipboardText(unavailableMessage: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // The browser rejects reads without a permission grant; the raw
      // DOMException is not something a user can act on.
      throw new Error(unavailableMessage);
    }
  }
  throw new Error(unavailableMessage);
}