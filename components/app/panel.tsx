import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A white card with a title, a one-line explanation, and an optional "see all". */
export function Panel({ title, description, href, linkLabel = 'See all', icon: Icon, children, className, tone }: {
  title: string; description?: string; href?: string; linkLabel?: string; icon?: LucideIcon;
  children: React.ReactNode; className?: string; tone?: 'urgent';
}) {
  return (
    <section className={cn('bg-card rounded-2xl border shadow-[0_1px_2px_rgba(16,40,30,0.04)]',
      tone === 'urgent' && 'border-amber-300/70', className)}>
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="bg-secondary text-primary mt-0.5 inline-flex size-8 items-center justify-center rounded-lg">
              <Icon className="size-4" />
            </span>
          )}
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description && <p className="text-muted-foreground text-xs">{description}</p>}
          </div>
        </div>
        {href && (
          <Link href={href} className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline">
            {linkLabel} <ArrowRight className="size-3" />
          </Link>
        )}
      </header>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

/** What a list says when it is empty — calm, and telling you why. */
export function Empty({ icon: Icon, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      {Icon && <Icon className="text-muted-foreground/50 mb-1 size-7" />}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-muted-foreground max-w-xs text-xs">{hint}</p>}
    </div>
  );
}

/** A headline number that says what it counts and what it means. */
export function StatCard({ label, value, hint, href, icon: Icon, tone }: {
  label: string; value: number; hint: string; href: string; icon: LucideIcon; tone?: 'urgent' | 'gold';
}) {
  return (
    <Link href={href} className={cn(
      'bg-card group flex flex-col gap-3 rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,40,30,0.04)] transition hover:-translate-y-0.5 hover:shadow-md',
      tone === 'urgent' && value > 0 && 'border-amber-300 bg-amber-50/40',
    )}>
      <div className="flex items-center justify-between">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-xl',
          tone === 'urgent' && value > 0 ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-primary')}>
          <Icon className="size-[18px]" />
        </span>
        <ArrowRight className="text-muted-foreground/40 group-hover:text-primary size-4 transition" />
      </div>
      <div>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </Link>
  );
}
