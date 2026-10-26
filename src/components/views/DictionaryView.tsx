import { useState } from 'react';
import { PlusIcon, TrashIcon, BookOpenIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/common/EmptyState';
import { DictionaryFormModal } from '@/components/dictionary/DictionaryFormModal';
import { SnippetFormModal } from '@/components/dictionary/SnippetFormModal';
import { SnippetList } from '@/components/dictionary/SnippetList';
import type { DictionaryEntry, DictionaryInput, Snippet, SnippetInput } from '@/types';

type LexiconTab = 'terms' | 'snippets';

export interface DictionaryViewProps {
  entries: DictionaryEntry[];
  loading: boolean;
  snippets: Snippet[];
  snippetsLoading: boolean;
  onSave: (input: DictionaryInput, id?: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<void>;
  onSaveSnippet: (input: SnippetInput, id?: string) => Promise<unknown>;
  onRemoveSnippet: (id: string) => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * Two kinds of vocabulary live here: words whose spelling must be fixed, and
 * phrases that expand into a block. Both are "say it once, get it right every
 * time", so they share one page and one mental model.
 */
export function DictionaryView({
  entries,
  loading,
  snippets,
  snippetsLoading,
  onSave,
  onRemove,
  onSaveSnippet,
  onRemoveSnippet,
  onNotify,
}: DictionaryViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LexiconTab>('terms');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DictionaryEntry | null>(null);
  const [snippetFormOpen, setSnippetFormOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);

  const openCreate = () => {
    if (tab === 'snippets') {
      setEditingSnippet(null);
      setSnippetFormOpen(true);
      return;
    }
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (entry: DictionaryEntry) => {
    setEditing(entry);
    setFormOpen(true);
  };

  const save = async (input: DictionaryInput, id?: string) => {
    await onSave(input, id);
    onNotify(id ? t('dictionary.edited') : t('dictionary.added'), 'success');
  };

  const remove = async (entry: DictionaryEntry) => {
    await onRemove(entry.id);
    onNotify(t('dictionary.removed'), 'success');
  };

  const openSnippet = (snippet: Snippet | null) => {
    setEditingSnippet(snippet);
    setSnippetFormOpen(true);
  };

  const saveSnippet = async (input: SnippetInput, id?: string) => {
    await onSaveSnippet(input, id);
    onNotify(id ? t('snippets.updated') : t('snippets.created'), 'success');
  };

  const removeSnippet = async (snippet: Snippet) => {
    await onRemoveSnippet(snippet.id);
    onNotify(t('snippets.removed'), 'success');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-shell page-pad space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">{t('dictionary.title')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              {tab === 'terms' ? t('dictionary.subtitle') : t('snippets.subtitle')}
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreate}>
            <PlusIcon className="h-4 w-4" />
            {tab === 'terms' ? t('dictionary.add') : t('snippets.add')}
          </button>
        </header>

        <Tabs value={tab} onValueChange={(value) => setTab(value as LexiconTab)}>
          <TabsList className="w-fit">
            <TabsTrigger value="terms">
              {t('dictionary.tabTerms')}
              <span className="text-xs font-normal text-slate-600">{entries.length}</span>
            </TabsTrigger>
            <TabsTrigger value="snippets">
              {t('dictionary.tabSnippets')}
              <span className="text-xs font-normal text-slate-600">{snippets.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'terms' ? (
          loading ? (
            <p className="py-16 text-center text-sm text-slate-600">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={BookOpenIcon}
              title={t('dictionary.empty')}
              description={t('dictionary.emptyHint')}
              action={
                <button type="button" className="btn-primary" onClick={openCreate}>
                  {t('dictionary.add')}
                </button>
              }
            />
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {entries.map((entry) => (
                <li key={entry.id} className="panel flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-900 dark:text-white">
                        {entry.term}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {new Date(entry.updatedAt).toLocaleDateString()} · {t('dictionary.hits', { count: entry.hits })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {entry.enabled ? (
                        <Badge variant="success">{t('dictionary.on')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('dictionary.off')}</Badge>
                      )}
                    </div>
                  </div>

                  {entry.aliases.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {entry.aliases.map((alias) => (
                        <span
                          key={alias}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/10 dark:text-slate-300"
                        >
                          {alias}
                        </span>
                      ))}
                    </div>
                  )}

                  {entry.note && (
                    <p className="text-xs text-slate-600 dark:text-slate-400">{entry.note}</p>
                  )}

                  <div className="mt-auto flex items-center gap-1 pt-1">
                    <button type="button" className="btn-ghost" onClick={() => openEdit(entry)}>
                      <PencilSquareIcon className="h-4 w-4" />
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      onClick={() => void remove(entry)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <SnippetList
            snippets={snippets}
            loading={snippetsLoading}
            onAdd={() => openSnippet(null)}
            onEdit={openSnippet}
            onRemove={(snippet) => void removeSnippet(snippet)}
          />
        )}
      </div>

      <DictionaryFormModal
        open={formOpen}
        entry={editing}
        onClose={() => setFormOpen(false)}
        onSave={save}
      />

      <SnippetFormModal
        open={snippetFormOpen}
        snippet={editingSnippet}
        onClose={() => setSnippetFormOpen(false)}
        onSave={saveSnippet}
      />
    </div>
  );
}