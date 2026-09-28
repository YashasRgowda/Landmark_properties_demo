import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, messages, visits } from '@/lib/db/schema';
import { getProjectData } from '@/lib/project-data';
import { sendTemplate, sendText } from '@/lib/whatsapp/client';
import { templateFor } from '@/lib/whatsapp/templates';
import { insideServiceWindow } from '@/lib/chase';
import { describeVisit } from '@/lib/visit-time';
import { visitReminderText } from '@/lib/visit-reminder';
import type { TaskHandler } from './types';

/**
 * SEND_VISIT_REMINDER — the day before his visit: date, time, map, pickup.
 *
 * Stands down if the visit has moved or been cancelled since this was queued.
 * Moving a visit queues a fresh reminder for the new time, so the buyer only
 * ever hears about the time that is actually booked.
 */
export const sendVisitReminder: TaskHandler = async ({ task, log }) => {
  const { visitId, visitAt } = (task.payload ?? {}) as { visitId?: string; visitAt?: string };
  if (!visitId || !visitAt) return log('no visit on this task');

  const [visit] = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (!visit) return log('visit has gone');
  if (visit.status !== 'BOOKED') return log(`visit is ${visit.status}; no reminder`);
  if (visit.visitAt.getTime() !== new Date(visitAt).getTime()) {
    return log('visit has moved since this was queued; the new time has its own reminder');
  }
  if (visit.remindedAt) return log('already reminded');

  const [lead] = await db.select().from(leads).where(eq(leads.id, visit.leadId)).limit(1);
  if (!lead) return log('lead has gone');
  if (lead.optedOut) return log('opted out; no reminder');

  const [lastInbound] = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const when = describeVisit(visit.visitAt);
  const open = insideServiceWindow(lastInbound?.sentAt ?? null, new Date());

  const result = open
    ? await sendText({ lead, body: visitReminderText({ name: lead.name, when, project: await getProjectData() }) })
    : await sendTemplate({ lead, ...templateFor('reminder', lead.name, [when]) });

  if (!result.ok) {
    if (result.reason === 'FAILED') throw new Error(`WhatsApp did not accept the reminder: ${result.error}`);
    return log(`no reminder sent — ${result.reason}`);
  }

  await db.update(visits).set({ remindedAt: new Date() }).where(eq(visits.id, visit.id));
  log(`reminded him of ${when}${open ? '' : ' (template — outside the 24-hour window)'}`);
};
