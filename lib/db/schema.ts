import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------
 * Value sets. Kept as plain string unions + arrays rather than pg enums so a
 * new status never needs a migration lock on a live table.
 * ---------------------------------------------------------------------- */

export const LEAD_STATUSES = [
  'NEW',
  'MESSAGE_SENT',
  'NOT_ON_WHATSAPP',
  'DELIVERED_UNREAD',
  'READ_NO_REPLY',
  'CHATTING',
  'QUALIFIED',
  'WITH_AGENT',
  'VISIT_BOOKED',
  'VISITED',
  'WON',
  'LOST',
  'REJECTED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CATEGORIES = ['HOT', 'WARM', 'COLD', 'REJECT'] as const;
export type Category = (typeof CATEGORIES)[number];

export const LEAD_SOURCES = [
  '99acres',
  'magicbricks',
  'housing',
  'meta',
  'website',
  'walkin',
  'broker',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const WA_STATES = ['NOT_ON_WHATSAPP', 'DELIVERED', 'READ', 'REPLIED'] as const;
export type WaState = (typeof WA_STATES)[number];

export const LANGUAGES = ['english', 'kannada', 'telugu', 'hindi', 'tamil'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * `portal` covers an enquiry arriving from 99acres/MagicBricks/etc. It is not
 * a contact attempt by us, so it never counts toward `attempt_count` — that is
 * derived from outbound touches only.
 */
export const TOUCH_CHANNELS = ['whatsapp', 'call', 'sms', 'portal'] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

export const TOUCH_DIRECTIONS = ['outbound', 'inbound'] as const;
export type TouchDirection = (typeof TOUCH_DIRECTIONS)[number];

export const TOUCH_OUTCOMES = [
  'enquiry',
  'sent',
  'delivered',
  'read',
  'replied',
  'answered',
  'no_answer',
  'failed',
  'undeliverable',
] as const;
export type TouchOutcome = (typeof TOUCH_OUTCOMES)[number];

export const TASK_TYPES = [
  // Test-only type used by /app/debug and the Phase 2 verification script to
  // exercise the queue itself. Never enqueued by real business logic.
  'DEV_ECHO',
  'SEND_FIRST_MESSAGE',
  'CHECK_DELIVERY',
  'CREATE_CALL_TASK',
  'RUN_READER',
  'SEND_CHASE_MESSAGE',
  'SEND_VISIT_REMINDER',
  'ESCALATE_TO_AGENT',
  'ADVANCE_CHASE',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const VISIT_STATUSES = [
  'BOOKED',
  'REMINDED',
  'ATTENDED',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const CHASE_STATES = [
  'NEVER_ANSWERED',
  'WA_GHOST',
  'CALL_GHOST',
  'NO_SHOW',
  'POST_VISIT_SILENT',
  'LATE_STAGE',
] as const;
export type ChaseState = (typeof CHASE_STATES)[number];

/* -------------------------------------------------------------------------
 * The sales team.
 * ---------------------------------------------------------------------- */

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email').unique(),
  languages: text('languages').array().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------
 * Login accounts for /app and /admin. Separate from `agents`: an agent is a
 * person leads are assigned to, a user is someone who can sign in.
 * ---------------------------------------------------------------------- */

export const USER_ROLES = ['admin', 'agent'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('agent'),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------
 * Every person who enquires. One row per phone number, ever.
 * ---------------------------------------------------------------------- */

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull().unique(), // normalised: 919876543210
    name: text('name'),
    email: text('email'),
    source: text('source').notNull(),
    campaign: text('campaign'),
    project: text('project'),
    status: text('status').notNull().default('NEW'),
    category: text('category'),
    score: integer('score').notNull().default(0),
    budget: text('budget'),
    timeline: text('timeline'),
    purpose: text('purpose'), // own_construction | investment
    language: text('language'),
    interestedPlot: text('interested_plot'),
    summary: text('summary'), // one line for the agent
    waState: text('wa_state'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    nextAction: text('next_action'),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    ownerAgentId: uuid('owner_agent_id').references(() => agents.id),
    optedOut: boolean('opted_out').notNull().default(false),
    consentBasis: text('consent_basis'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('leads_category_next_action_at_idx').on(t.category, t.nextActionAt),
    index('leads_status_idx').on(t.status),
    index('leads_owner_agent_id_idx').on(t.ownerAgentId),
  ],
);

/* -------------------------------------------------------------------------
 * EVERY contact attempt. The source of truth for "contacted N times".
 * ---------------------------------------------------------------------- */

export const touches = pgTable(
  'touches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // whatsapp | call | sms
    direction: text('direction').notNull(), // outbound | inbound
    outcome: text('outcome'),
    agentId: uuid('agent_id').references(() => agents.id),
    durationSecs: integer('duration_secs'),
    notes: text('notes'),
    happenedAt: timestamp('happened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('touches_lead_id_happened_at_idx').on(t.leadId, t.happenedAt)],
);

/* -------------------------------------------------------------------------
 * Every WhatsApp message, both directions.
 * ---------------------------------------------------------------------- */

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // outbound | inbound
    body: text('body').notNull(),
    mediaUrl: text('media_url'),
    templateName: text('template_name'),
    waMessageId: text('wa_message_id').unique(), // Meta's id — idempotency
    status: text('status'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_lead_id_sent_at_idx').on(t.leadId, t.sentAt)],
);

/* -------------------------------------------------------------------------
 * The scheduler. "Call him at 6:15 PM" is a row here.
 * ---------------------------------------------------------------------- */

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    // When the current RUNNING attempt was claimed. Lets the worker rescue
    // tasks abandoned by a crashed process; NULL whenever not RUNNING.
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tasks_status_due_at_idx').on(t.status, t.dueAt)],
);

/* -------------------------------------------------------------------------
 * Booked site visits.
 * ---------------------------------------------------------------------- */

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    visitAt: timestamp('visit_at', { withTimezone: true }).notNull(),
    label: text('label'), // the buyer's own words: "Sunday 11 AM"
    status: text('status').notNull().default('BOOKED'),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visits_visit_at_status_idx').on(t.visitAt, t.status)],
);

/* -------------------------------------------------------------------------
 * Which chase sequence a silent lead is in.
 * ---------------------------------------------------------------------- */

export const chaseStates = pgTable(
  'chase_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    step: integer('step').notNull().default(0),
    nextStepAt: timestamp('next_step_at', { withTimezone: true }),
    exhausted: boolean('exhausted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chase_states_lead_id_idx').on(t.leadId),
    index('chase_states_next_step_at_exhausted_idx').on(t.nextStepAt, t.exhausted),
  ],
);

/* -------------------------------------------------------------------------
 * Project data the AI answers from. Editable in the admin panel.
 * ---------------------------------------------------------------------- */

export const projectData = pgTable('project_data', {
  id: integer('id').primaryKey().default(1),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------
 * Audit log of every AI call — debugging and cost tracking.
 * ---------------------------------------------------------------------- */

export const aiCalls = pgTable('ai_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  job: text('job').notNull(), // meera | reader | writer
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  success: boolean('success').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Touch = typeof touches.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type User = typeof users.$inferSelect;
