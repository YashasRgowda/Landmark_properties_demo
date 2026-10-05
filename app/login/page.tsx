import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CalendarCheck, MessageCircle, PhoneCall } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Landmark Properties' };

const POINTS = [
  { icon: MessageCircle, text: 'Every enquiry gets a WhatsApp reply within a minute, day or night.' },
  { icon: PhoneCall, text: 'Your team is told exactly who to call, and why.' },
  { icon: CalendarCheck, text: 'Site visits are booked and reminded automatically.' },
];

export default async function LoginPage() {
  if (await getSession()) redirect('/app');

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="bg-sidebar text-sidebar-foreground relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-[radial-gradient(circle,var(--gold)_0%,transparent_70%)] opacity-15" />
        <div className="flex items-center gap-3">
          <span className="bg-gold text-sidebar font-display inline-flex size-10 items-center justify-center rounded-xl text-xl font-semibold">L</span>
          <div className="leading-tight">
            <p className="font-display text-lg">Landmark</p>
            <p className="text-sidebar-foreground/60 text-[10px] tracking-[0.2em]">PROPERTIES</p>
          </div>
        </div>
        <div className="max-w-md space-y-8">
          <h1 className="font-display text-4xl leading-tight">
            Every buyer answered.<br />Every call on time.
          </h1>
          <ul className="space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm">
                <span className="text-gold mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4" />
                </span>
                <span className="text-sidebar-foreground/85 pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sidebar-foreground/50 text-xs">Lead Desk · Landmark Properties, Bengaluru</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wider text-amber-800/80 uppercase lg:hidden">Landmark Properties</p>
            <h2 className="font-display text-3xl font-semibold">Welcome back</h2>
            <p className="text-muted-foreground text-sm">Sign in to see today&apos;s buyers and calls.</p>
          </div>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
