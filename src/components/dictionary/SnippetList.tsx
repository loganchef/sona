import { ChatBubbleLeftRightIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import type { Snippet } from '@/types';

export interface SnippetListProps {
  snippets: Snippet[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (snippet: Snippet) => void;
  onRemove: (snippet: Snippet) => void;
}

/** A compact wall of trigger → block. The expansion is the point, so it wins. */
export function SnippetList({ snippets, loading, onAdd, onEdit, onRemove }: SnippetListProps) {
  const { t } = useTranslation();

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-600">{t('common.loading')}</p>;
  }

  if (snippets.length === 0) {
    return (
      <EmptyState
        icon={ChatBubbleLeftRightIcon}
        title={t('snippets.empty')}
        description={t('snippets.emptyHint')}
        action={
          <button type="button" className="btn-primary" onClick={onAdd}>
            <PlusIcon className="h-4 w-4" />
            {t('snippets.add')}
          </button>
        }
      />
    );
  }

  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {snippets.map((snippet) => (
        <li key={snippet.id} className="panel flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                <ChatBubbleLeftRightIcon className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium text-slate-900 dark:text-white">{snippet.trigger}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {t('snippets.hits', { count: snippet.hits })}
                {snippet.note ? ` · ${snippet.note}` : ''}
              </p>
            </div>
            <Badge variant={snippet.enabled ? 'success' : 'secondary'}>
              {snippet.enabled ? t('snippets.on') : t('snippets.off')}
            </Badge>
          </div>

          <pre className="max-h-28 overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-600 dark:bg-white/5 dark:text-slate-300">
            {snippet.expansion}
          </pre>

          <div className="mt-auto flex items-center gap-1 pt-1">
            <button type="button" className="btn-ghost" onClick={() => onEdit(snippet)}>
              <PencilSquareIcon className="h-4 w-4" />
              {t('common.edit')}
            </button>
            <button
              type="button"
              className="btn-ghost ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={() => onRemove(snippet)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}