import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { useIsGlass } from '@/components/theme/SurfaceContext';
import type { ThemePreference } from '@/types';
import { cn } from '@/lib/utils';

export interface MobileTopBarProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

export function MobileTopBar({ theme, onThemeChange }: MobileTopBarProps) {
  const { t } = useTranslation();
  const isGlass = useIsGlass();

  return (
    <header
      className={cn(
        'mobile-only safe-area-top fixed inset-x-0 top-0 z-40 border-b',
        isGlass
          ? 'border-white/25 bg-white/35 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/35'
          : 'border-slate-200/70 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/85',
      )}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0 rounded-[10px]" />
          <span className="truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
            {t('app.name')}
          </span>
        </div>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}