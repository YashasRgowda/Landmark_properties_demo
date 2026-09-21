import 'server-only';
import { processEvent, type WhatsAppEvent } from '@/lib/whatsapp/events';
import type { TaskHandler } from './types';

/**
 * Handles one queued WhatsApp webhook event.
 *
 * A payload we cannot use is logged and completed rather than retried — Meta
 * will not send a better version of it, so retrying five times is pure noise.
 */
export const processWaEvent: TaskHandler = async ({ task, log }) => {
  const payload = task.payload as { event?: WhatsAppEvent } | null;
  const event = payload?.event;

  if (!event || (event.kind !== 'message' && event.kind !== 'status')) {
    log('no usable event in payload; nothing to do');
    return;
  }

  // Dates arrive as strings through JSONB.
  const revived = { ...event, timestamp: new Date(event.timestamp) } as WhatsAppEvent;

  const result = await processEvent(revived);
  log(
    `${event.kind} ${result.handled ? 'handled' : 'skipped'}` +
      (result.reason ? ` — ${result.reason}` : ''),
  );
};
