import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import type { ThemePreference } from '@/types';
import { cn } from '@/lib/utils';

const order: ThemePreference[] = ['system', 'light', 'dark'];

const icons = {
  system: ComputerDesktopIcon,
  light: SunIcon,
  dark: MoonIcon,
};

export interface ThemeToggleProps {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
  className?: string;
  /** Render without its own chrome (for use inside an existing chip). */
  bare?: boolean;
}

export function ThemeToggle({ theme, onChange, className, bare = false }: ThemeToggleProps) {
  const { t } = useTranslation();
  const Icon = icons[theme];
  const label = t(`settings.themeOptions.${theme}`);

  return (
    <button
      type="button"
      onClick={() => onChange(order[(order.indexOf(theme) + 1) % order.length])}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-all hover:bg-slate-900/6 active:scale-95 dark:text-slate-300 dark:hover:bg-white/12',
        !bare &&
          'border border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/85',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}