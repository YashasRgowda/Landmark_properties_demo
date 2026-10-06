'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, Building2, CalendarCheck, Globe, LayoutDashboard, PhoneCall, Users, UsersRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavCounts = { calls: number; visits: number; failed: number };

const ICONS = {
  today: LayoutDashboard, leads: Users, calls: PhoneCall, visits: CalendarCheck,
  project: Building2, team: UsersRound, health: Activity, portal: Globe,
};
type Item = { href: string; label: string; icon: keyof typeof ICONS; count?: number; alert?: boolean };

export function Nav({ isAdmin, counts, variant = 'side' }: { isAdmin: boolean; counts: NavCounts; variant?: 'side' | 'top' }) {
  const path = usePathname();
  const work: Item[] = [
    { href: '/app', label: 'Today', icon: 'today' },
    { href: '/app/leads', label: 'Leads', icon: 'leads' },
    { href: '/app/calls', label: 'Calls to make', icon: 'calls', count: counts.calls, alert: true },
    { href: '/app/visits', label: 'Site visits', icon: 'visits', count: counts.visits },
  ];
  const demo: Item[] = [{ href: '/app/demo/99acres', label: '99acres enquiry', icon: 'portal' }];
  const settings: Item[] = isAdmin ? [
    { href: '/admin/project', label: 'Project details', icon: 'project' },
    { href: '/admin/agents', label: 'Sales team', icon: 'team' },
    { href: '/app/debug/failed', label: 'System health', icon: 'health', count: counts.failed, alert: true },
  ] : [];

  const active = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));

  const link = (item: Item) => {
    const Icon = ICONS[item.icon];
    const on = active(item.href);
    return (
      <Link key={item.href} href={item.href} className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
        variant === 'side'
          ? on ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_3px_0_0_var(--gold)]'
            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
          : on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
        variant === 'top' && 'shrink-0',
      )}>
        <Icon className="size-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {!!item.count && (
          <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
            item.alert ? 'bg-gold text-sidebar-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground')}>
            {item.count}
          </span>
        )}
      </Link>
    );
  };

  if (variant === 'top') {
    return <nav className="flex gap-1 overflow-x-auto px-4 pb-3">{[...work, ...demo, ...settings].map(link)}</nav>;
  }
  return (
    <nav className="space-y-6">
      <div className="space-y-1">
        <p className="text-sidebar-foreground/45 px-3 pb-1 text-[11px] font-medium tracking-wider uppercase">Daily work</p>
        {work.map(link)}
      </div>
      <div className="space-y-1">
        <p className="text-sidebar-foreground/45 px-3 pb-1 text-[11px] font-medium tracking-wider uppercase">Try it live</p>
        {demo.map(link)}
      </div>
      {settings.length > 0 && (
        <div className="space-y-1">
          <p className="text-sidebar-foreground/45 px-3 pb-1 text-[11px] font-medium tracking-wider uppercase">Settings</p>
          {settings.map(link)}
        </div>
      )}
    </nav>
  );
}
