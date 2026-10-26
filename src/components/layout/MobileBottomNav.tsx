import {
  BoltIcon,
  BookOpenIcon,
  ClockIcon,
  Cog6ToothIcon,
  HomeIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import type { AppView } from '@/types';
import { cn } from '@/lib/utils';

export interface MobileBottomNavProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
}

const navItems = [
  { value: 'dashboard' as const, labelKey: 'nav.dashboard', icon: HomeIcon },
  { value: 'history' as const, labelKey: 'nav.history', icon: ClockIcon },
  { value: 'dictionary' as const, labelKey: 'nav.dictionary', icon: BookOpenIcon },
  { value: 'providers' as const, labelKey: 'nav.providers', icon: BoltIcon },
  { value: 'packs' as const, labelKey: 'nav.packs', icon: SwatchIcon },
  { value: 'settings' as const, labelKey: 'nav.settings', icon: Cog6ToothIcon },
];

/** Mobile tab bar: flat, thumb-sized, no floating glass. */
export function MobileBottomNav({ view, onNavigate }: MobileBottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('nav.label')} className="mobile-only fixed inset-x-0 bottom-0 z-50 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
      <div className="flex h-16 items-stretch">
        {navItems.map((item) => {
          const active = view === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onNavigate(item.value)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 active:bg-slate-100/70 dark:active:bg-white/5',
                active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300',
              )}
            >
              <span
                className={cn(
                  'absolute inset-x-5 top-0 h-0.5 rounded-full',
                  active ? 'bg-brand-600 dark:bg-brand-300' : 'bg-transparent',
                )}
              />
              <Icon className="h-5 w-5" />
              <span className="text-[11px] font-semibold leading-none">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
