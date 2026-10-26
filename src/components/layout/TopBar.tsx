import {
  BoltIcon,
  BookOpenIcon,
  ClockIcon,
  Cog6ToothIcon,
  HomeIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import type { AppView, ThemePreference } from '@/types';
import { cn } from '@/lib/utils';

export interface TopBarProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

const navItems = [
  { value: 'dashboard' as const, labelKey: 'nav.dashboard', icon: HomeIcon },
  { value: 'history' as const, labelKey: 'nav.history', icon: ClockIcon },
  { value: 'dictionary' as const, labelKey: 'nav.dictionary', icon: BookOpenIcon },
  { value: 'providers' as const, labelKey: 'nav.providers', icon: BoltIcon },
  { value: 'packs' as const, labelKey: 'nav.packs', icon: SwatchIcon },
  { value: 'settings' as const, labelKey: 'nav.settings', icon: Cog6ToothIcon },
];

/**
 * Desktop rail. One line, one border: the window chrome should not compete
 * with the recording control. The floating glass dock was a nice demo, but a
 * tool people keep open all day needs a quieter frame.
 */
export function TopBar({ view, onNavigate, theme, onThemeChange }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <div className="desktop-only fixed inset-x-0 top-0 z-50 border-b border-slate-200/70 bg-[#f7f8fa]/88 backdrop-blur-xl dark:border-white/8 dark:bg-[#0a0b0f]/88">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-6">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2"
        >
          <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 rounded-[9px]" />
          <span className="whitespace-nowrap text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
            {t('app.name')}
          </span>
        </button>

        <nav className="flex min-w-0 items-center gap-0.5" aria-label={t('nav.label')}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onNavigate(item.value)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  active
                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-white dark:ring-white/10'
                    : 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/8 dark:hover:text-white',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4',
                    active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-600 dark:text-slate-400',
                  )}
                />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle theme={theme} onChange={onThemeChange} bare className="h-9 w-9 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
