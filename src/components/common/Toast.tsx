import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

export interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
  duration?: number;
}

const styles: Record<ToastType, { icon: typeof CheckCircleIcon; className: string }> = {
  success: {
    icon: CheckCircleIcon,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  error: {
    icon: ExclamationCircleIcon,
    className: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200',
  },
  info: {
    icon: InformationCircleIcon,
    className: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-200',
  },
};

export function Toast({ toast, onClose, duration = 3200 }: ToastProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [toast, onClose, duration]);

  if (!toast || typeof document === 'undefined') return null;

  const { icon: Icon, className } = styles[toast.type];

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-24 left-4 right-4 z-[120] flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-md sm:bottom-6 sm:left-auto sm:right-6 sm:w-auto sm:max-w-sm',
        className,
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
}