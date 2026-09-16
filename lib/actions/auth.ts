'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { clearSessionCookie, createSessionCookie } from '@/lib/auth/session';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

/** Only redirect to our own paths — never to a URL an attacker supplied. */
function safeNext(next: string | undefined): string {
  if (!next) return '/app';
  if (!next.startsWith('/') || next.startsWith('//')) return '/app';
  return next;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }

  const { email, password, next } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Same message and roughly the same work either way, so the response does
  // not reveal whether the email exists.
  const ok = user?.active ? await verifyPassword(password, user.passwordHash) : false;
  if (!ok || !user) {
    return { error: 'Wrong email or password.' };
  }

  await createSessionCookie({
    userId: user.id,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'agent',
  });

  redirect(safeNext(next));
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
