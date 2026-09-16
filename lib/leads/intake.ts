import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, touches, type Lead } from '@/lib/db/schema';
import { canonicalSource } from './source';
import type { IntakeInput } from './schema';

export type IntakeOutcome = {
  lead: Lead;
  created: boolean;
  /** Set when an existing lead had blank fields filled in by this enquiry. */
  enriched: string[];
  warnings: string[];
};

type IntakeArgs = IntakeInput & { normalisedPhone: string };

/**
 * One phone number is one lead, forever.
 *
 * A repeat enquiry never creates a second lead — it appends a `touches` row, so
 * the enquiry history lives in the append-only log rather than in a column that
 * can drift (golden rule 8).
 *
 * `leads.source` deliberately keeps the FIRST source. That is the acquisition
 * source, and it is what portal spend is reconciled against. Later sources are
 * recorded on the touch.
 */
export async function intakeLead(input: IntakeArgs): Promise<IntakeOutcome> {
  const { source, known } = canonicalSource(input.source);
  const warnings: string[] = [];
  if (!known) {
    warnings.push(`source "${source}" is not one of the known portals; stored as-is`);
  }

  const phone = input.normalisedPhone;
  const name = input.name || null;
  const campaign = input.campaign || null;
  const project = input.project || null;

  // Insert-or-nothing against the unique phone index. This is race-safe: two
  // simultaneous enquiries for the same number cannot both create a lead.
  const inserted = await db
    .insert(leads)
    .values({
      phone,
      name,
      email: input.email ?? null,
      source,
      campaign,
      project,
      status: 'NEW',
      consentBasis: `enquiry_via_${source}`,
    })
    .onConflictDoNothing({ target: leads.phone })
    .returning();

  let lead = inserted[0];
  const created = Boolean(lead);
  const enriched: string[] = [];

  if (!lead) {
    const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
    if (!existing) {
      // Only reachable if the row vanished between the insert and this read.
      throw new Error(`intake: lead for ${phone} could neither be created nor found`);
    }
    lead = existing;

    // Fill blanks from the new enquiry. Never overwrite something we already
    // know — a portal re-posting a stale name must not clobber a better one.
    const patch: Partial<typeof leads.$inferInsert> = {};
    if (!lead.name && name) { patch.name = name; enriched.push('name'); }
    if (!lead.email && input.email) { patch.email = input.email; enriched.push('email'); }
    if (!lead.campaign && campaign) { patch.campaign = campaign; enriched.push('campaign'); }
    if (!lead.project && project) { patch.project = project; enriched.push('project'); }

    if (enriched.length > 0) {
      const [updated] = await db
        .update(leads)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(leads.id, lead.id))
        .returning();
      if (updated) lead = updated;
    }
  }

  // Every enquiry writes a touch, first or fifth. This is the source history.
  await db.insert(touches).values({
    leadId: lead.id,
    channel: 'portal',
    direction: 'inbound',
    outcome: 'enquiry',
    notes: describeEnquiry({ source, campaign, project, repeat: !created }),
  });

  return { lead, created, enriched, warnings };
}

function describeEnquiry(args: {
  source: string;
  campaign: string | null;
  project: string | null;
  repeat: boolean;
}): string {
  const parts = [args.repeat ? 'Repeat enquiry' : 'Enquiry', `via ${args.source}`];
  if (args.project) parts.push(`for ${args.project}`);
  if (args.campaign) parts.push(`(campaign: ${args.campaign})`);
  return parts.join(' ');
}
