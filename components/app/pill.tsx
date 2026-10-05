import type { Tone } from '@/lib/labels';
import { cn } from '@/lib/utils';

export const TONE: Record<Tone, string> = {
  hot: 'bg-rose-50 text-rose-700 ring-rose-200',
  warm: 'bg-amber-50 text-amber-800 ring-amber-200',
  cold: 'bg-sky-50 text-sky-700 ring-sky-200',
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  neutral: 'bg-stone-100 text-stone-600 ring-stone-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  gold: 'bg-gold-soft text-amber-900 ring-amber-300/70',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
};

const DOT: Record<Tone, string> = {
  hot: 'bg-rose-500', warm: 'bg-amber-500', cold: 'bg-sky-500', good: 'bg-emerald-500',
  neutral: 'bg-stone-400', bad: 'bg-red-500', gold: 'bg-gold', info: 'bg-blue-500',
};

/** A small coloured tag. `title` shows the plain explanation on hover. */
export function Pill({ tone, children, title, dot, className }: {
  tone: Tone; children: React.ReactNode; title?: string; dot?: boolean; className?: string;
}) {
  return (
    <span title={title} className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
      TONE[tone], className,
    )}>
      {dot && <span className={cn('size-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}
