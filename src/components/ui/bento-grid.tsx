import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

export interface BentoGridProps {
  children: ReactNode;
  className?: string;
}

export function BentoGrid({ children, className }: BentoGridProps) {
  return (
    <div
      className={cn(
        'grid w-full auto-rows-auto grid-cols-3 gap-3 lg:auto-rows-[21rem] lg:gap-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface BentoCardProps {
  name: string;
  description?: string;
  className?: string;
  background?: ReactNode;
  comment?: ReactNode;
  Icon: ComponentType<{ className?: string }>;
  href?: string;
  onClick?: () => void;
  cta?: string;
  ctaClassName?: string;
  /** Vertically center the content instead of anchoring it to the bottom. */
  centered?: boolean;
}

export function BentoCard({
  name,
  description,
  className,
  background,
  comment,
  Icon,
  href,
  onClick,
  cta,
  ctaClassName,
  centered = false,
}: BentoCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative col-span-3 flex flex-col overflow-hidden rounded-2xl',
        centered ? 'justify-center' : 'justify-end',
        'bg-white [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]',
        'transform-gpu dark:border dark:border-white/10 dark:bg-slate-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
        onClick && 'cursor-pointer transition-transform active:scale-[0.99]',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0">{background}</div>
      <div className="pointer-events-none absolute inset-0">{comment}</div>

      <div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1 p-4 transition-all duration-300 lg:p-6 lg:group-hover:-translate-y-8">
        <Icon className="h-9 w-9 origin-left transform-gpu text-slate-600 transition-all duration-300 ease-in-out dark:text-slate-300 lg:h-11 lg:w-11 lg:group-hover:scale-90" />
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 lg:text-xl">
          {name}
        </h3>
        {description && (
          <p className="max-w-lg text-sm text-slate-600 dark:text-slate-400">{description}</p>
        )}
      </div>

      <div className="pointer-events-none static flex w-full items-center p-4 pt-0 opacity-100 transition-all duration-300 lg:absolute lg:bottom-0 lg:translate-y-8 lg:p-4 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100">
        {cta &&
          (onClick ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClick();
              }}
              className={cn(
                'pointer-events-auto inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10',
                ctaClassName,
              )}
            >
              {cta}
              <ArrowRightIcon className="ml-2 h-4 w-4" />
            </button>
          ) : (
            <a
              href={href ?? '#'}
              className={cn(
                'pointer-events-auto inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10',
                ctaClassName,
              )}
            >
              {cta}
              <ArrowRightIcon className="ml-2 h-4 w-4" />
            </a>
          ))}
      </div>

      <div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-black/[.03] dark:group-hover:bg-white/[.02]" />
    </div>
  );
}