import Link from 'next/link';
import { formatPhone } from '@/lib/phone';
import { initials } from '@/lib/labels';
import { cn } from '@/lib/utils';

const AVATAR = [
  'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-900', 'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800', 'bg-violet-100 text-violet-800', 'bg-teal-100 text-teal-800',
];

/** Same buyer, same colour, on every screen. */
function avatarColour(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function Avatar({ name, seed, size = 'md' }: { name: string | null; seed: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
      size === 'sm' && 'size-8 text-xs', size === 'md' && 'size-10 text-sm', size === 'lg' && 'size-14 text-lg',
      avatarColour(seed),
    )}>
      {initials(name)}
    </span>
  );
}

/**
 * A buyer as people recognise him: name first, number underneath. A buyer we
 * have no name for is "Name not shared yet", never just a bare number.
 */
export function LeadIdentity({ id, name, phone, href = true, sub, size = 'md' }: {
  id: string; name: string | null; phone: string; href?: boolean; sub?: React.ReactNode; size?: 'sm' | 'md';
}) {
  const label = name?.trim() || 'Name not shared yet';
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} seed={phone} size={size} />
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', !name?.trim() && 'text-muted-foreground italic')}>{label}</span>
        <span className="text-muted-foreground block truncate text-xs">{sub ?? formatPhone(phone)}</span>
      </span>
    </span>
  );
  return href ? <Link href={`/app/leads/${id}`} className="group min-w-0 hover:[&_span.block:first-child]:underline">{body}</Link> : body;
}
