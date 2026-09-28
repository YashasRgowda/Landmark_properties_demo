import { after, NextResponse } from 'next/server';
import { parseIntake } from '@/lib/leads/schema';
import { runDueTasks } from '@/lib/tasks/runner';
import { hit, hitAll } from '@/lib/rate-limit';
import { clientIp, LIMITS } from '@/lib/rate-limit-policy';
import { intakeLead } from '@/lib/leads/intake';
import { extractSecret, secretMatches } from '@/lib/security/secret';

/**
 * POST /api/leads/intake
 *
 * The portal-facing entry point. Secured by LEAD_WEBHOOK_SECRET, sent as either
 *   Authorization: Bearer <secret>
 *   x-webhook-secret: <secret>
 *
 * Nothing slow happens before the response: it validates, dedupes, records the
 * enquiry and queues the opening WhatsApp (golden rule 4). The portal gets its
 * answer at once, and the message is sent straight after, in the same call.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The worker's share of maxDuration, leaving room for the request itself. */
const WORK_BUDGET_MS = 54_000;

function tooMany(retryAfter: number) {
  return NextResponse.json(
    { ok: false, error: 'too many requests — slow down', retryAfter },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}

export async function POST(request: Request) {
  // Before the secret check, so guessing the secret is limited too.
  const ip = clientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'));
  const byIp = await hit(LIMITS.intakePerIp, ip);
  if (!byIp.allowed) return tooMany(byIp.retryAfter);

  if (!secretMatches(extractSecret(request.headers), process.env.LEAD_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 });
  }

  const parsed = parseIntake(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  // One buyer posted again and again is a portal stuck in a retry loop; the
  // overall ceiling stops any burst. Both are counted once the lead is valid.
  const limited = await hitAll([
    [LIMITS.intakePerPhone, parsed.value.normalisedPhone],
    [LIMITS.intakeGlobal, 'all'],
  ]);
  if (!limited.allowed) return tooMany(limited.retryAfter);

  try {
    const result = await intakeLead(parsed.value);

    // Send the opening WhatsApp now, after the portal has its response.
    // Queuing it was not enough: nothing ran the queue, so in production a
    // 99acres lead's first message waited for whatever happened to wake the
    // worker next — possibly never.
    if (result.created) {
      after(async () => {
        try {
          await runDueTasks(10, { budgetMs: WORK_BUDGET_MS });
        } catch (error) {
          console.error('[intake] could not send the opening message', error);
        }
      });
    }

    return NextResponse.json(
      {
        ok: true,
        leadId: result.lead.id,
        phone: result.lead.phone,
        created: result.created,
        duplicate: !result.created,
        enriched: result.enriched,
        warnings: [...parsed.warnings, ...result.warnings],
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    // One bad lead must never take the endpoint down for the next one.
    console.error('[intake] failed', error);
    return NextResponse.json({ ok: false, error: 'could not record the enquiry' }, { status: 500 });
  }
}
