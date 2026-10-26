import { cn } from '@/lib/utils';

export interface LevelBarsProps {
  levels: number[];
  active: boolean;
  className?: string;
}

/** The 32-bar waveform behind the record button. */
export function LevelBars({ levels, active, className }: LevelBarsProps) {
  return (
    <div className={cn('flex h-14 items-center justify-center gap-[3px]', className)} aria-hidden>
      {levels.map((level, index) => {
        const height = active ? Math.max(0.12, Math.min(1, level)) : 0.12;
        return (
          <span
            key={index}
            className={cn(
              'w-[3px] rounded-full transition-[height,background-color] duration-100',
              active
                ? 'bg-brand-500/80 dark:bg-brand-400/80'
                : 'bg-slate-300/70 dark:bg-white/15',
            )}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
