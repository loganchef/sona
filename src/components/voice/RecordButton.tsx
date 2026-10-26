import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/solid';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DictationPhase } from '@/hooks/useDictation';

export interface RecordButtonProps {
  phase: DictationPhase;
  onToggle: () => void;
  disabled?: boolean;
}

export function RecordButton({ phase, onToggle, disabled }: RecordButtonProps) {
  const { t } = useTranslation();
  const recording = phase === 'recording';
  const processing = phase === 'processing';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || processing}
      aria-label={recording ? t('voice.stop') : t('voice.start')}
      className={cn(
        'group relative flex h-24 w-24 items-center justify-center rounded-full text-white transition-all',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/40',
        recording
          ? 'bg-red-500 shadow-[0_18px_50px_-12px_rgb(239_68_68/0.85)]'
          : 'bg-brand-600 shadow-[0_18px_50px_-12px_rgb(79_70_229/0.9)]',
        !processing && 'hover:scale-[1.03] active:scale-95',
        (disabled || processing) && 'cursor-not-allowed opacity-60',
      )}
    >
      {recording && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />}
      {processing ? (
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
      ) : recording ? (
        <StopIcon className="relative h-8 w-8" />
      ) : (
        <MicrophoneIcon className="relative h-9 w-9" />
      )}
    </button>
  );
}
