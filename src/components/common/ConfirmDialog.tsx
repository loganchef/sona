import { useTranslation } from 'react-i18next';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
  busyLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
  busyLabel,
  danger = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  // While a destructive request is in flight, Escape / backdrop clicks must
  // not dismiss the dialog and make the outcome ambiguous.
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            disabled={busy}
            data-autofocus
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={cn(danger ? 'btn-danger' : 'btn-primary')}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? (busyLabel ?? t('common.working')) : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-4">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            danger
              ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'
              : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
          )}
        >
          <ExclamationTriangleIcon className="h-6 w-6" />
        </div>
        <p className="pt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
      </div>
    </Modal>
  );
}