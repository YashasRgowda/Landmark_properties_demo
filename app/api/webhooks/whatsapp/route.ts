import { after, NextResponse } from 'next/server';
import { enqueue } from '@/lib/queue';
import { parseWebhookPayload } from '@/lib/whatsapp/events';
import { verifyMetaSignature } from '@/lib/whatsapp/signature';
import { runDueTasks } from '@/lib/tasks/runner';

/**
 * Meta's webhook.
 *
 *   GET  — the one-time subscription challenge.
 *   POST — inbound messages and delivery statuses.
 *
 * The POST handler does the least possible work: check the signature, queue
 * each event, return 200. Meta retries anything slow or failing, which is how
 * buyers end up with duplicate replies.
 */
export const dynamic = 'force-dynamic';
// Long enough for a reply and the scoring it triggers to finish after the 200.
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    // Meta requires the raw challenge string, not JSON.
    return new Response(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  return new Response('forbidden', { status: 403 });
}

export async function POST(request: Request) {
  // The signature is over the raw bytes — parsing first and re-serialising
  // would change key order and never match.
  const rawBody = await request.text();

  if (!verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Nothing to retry.
    return NextResponse.json({ ok: true, queued: 0 });
  }

  let queued = 0;
  try {
    for (const event of parseWebhookPayload(payload)) {
      // One row per event, whatever Meta redelivers.
      const key =
        event.kind === 'message'
          ? `wa:msg:${event.waMessageId}`
          : `wa:status:${event.waMessageId}:${event.status}`;

      await enqueue({
        type: 'PROCESS_WA_EVENT',
        dueAt: new Date(),
        payload: { event },
        idempotencyKey: key,
      });
      queued++;
    }
  } catch (error) {
    // Never hand Meta a 500 — it would redeliver the whole batch.
    console.error('[whatsapp webhook] could not queue events', error);
  }

  // Meta gets its 200 first; the work happens straight after, in the same
  // invocation. Without this a reply would wait for the next cron tick —
  // and on a free hosting plan cron may only run once a day.
  //
  // Several passes, because the reply itself queues the scoring. Two workers
  // racing for the same task is harmless: tasks are claimed with SKIP LOCKED.
  if (queued > 0) {
    after(async () => {
      try {
        for (let pass = 0; pass < 3; pass++) {
          const report = await runDueTasks(20);
          if (report.claimed === 0) break;
        }
      } catch (error) {
        console.error('[whatsapp webhook] follow-up processing failed', error);
      }
    });
  }

  return NextResponse.json({ ok: true, queued });
}
