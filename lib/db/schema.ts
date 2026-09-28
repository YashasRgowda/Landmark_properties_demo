import { sql } from 'drizzle-orm';
import { queueEnv } from '../queue-policy';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
  // One inbound webhook event from Meta. The webhook itself only queues this
  // and returns 200 — all processing happens in the worker (golden rule 4).
  'PROCESS_WA_EVENT',
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

/**
 * A reminded visit is still BOOKED — `reminded_at` records the reminder. Using
 * a separate status for it would make every "is this visit still on?" check
 * have to remember two values.
 */
export const VISIT_STATUSES = [
  'BOOKED',
  'ATTENDED',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const CHASE_STATES = [
  'NEVER_ANSWERED',     // never replied to anything
  'WA_GHOST',           // chatted, then stopped
  'CALL_GHOST',         // answered a call once, now unreachable
  'NO_SHOW',            // booked a visit and did not come
  'POST_VISIT_SILENT',  // visited, then went quiet
  'LATE_STAGE',         // was near closing, then went quiet
  'COLD_DRIP',          // a sequence ran out with no reply: slow and gentle, never deleted
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
    /**
     * NEVER READ OR WRITTEN. How often a lead was contacted is counted from
     * `touches` wherever it is shown (golden rule 8) — a stored counter drifts
     * the moment anything touches the lead another way. The column remains
     * only because dropping it needs a deploy first; tests/no-stored-counter
     * fails if any code starts using it.
     */
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
    /**
     * On Meera's replies: the newest buyer message she had seen when she wrote
     * it. That is what "has this message been answered?" is decided from — a
     * reply being newer than a message does not mean it answered it, because
     * the buyer can write again while she is composing.
     */
    replyToWaMessageId: text('reply_to_wa_message_id'),
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
    /**
     * The deployment that owns this task — see queueEnv(). Set on every insert
     * made through Drizzle. Rows from before this column existed are NULL and
     * belong to production.
     */
    env: text('env').$defaultFn(() => queueEnv()),
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
    /** When an agent marked him as came or didn't come. */
    outcomeAt: timestamp('outcome_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visits_visit_at_status_idx').on(t.visitAt, t.status)],
);

/* -------------------------------------------------------------------------
 * Which chase sequence a silent lead is in.
 * ---------------------------------------------------------------------- */

export const CHASE_STATUSES = ['ACTIVE', 'CANCELLED', 'EXHAUSTED'] as const;
export type ChaseStatus = (typeof CHASE_STATUSES)[number];

export const chaseStates = pgTable(
  'chase_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    /** The step that runs next (0-based). */
    step: integer('step').notNull().default(0),
    nextStepAt: timestamp('next_step_at', { withTimezone: true }),
    exhausted: boolean('exhausted').notNull().default(false),
    /** ACTIVE, CANCELLED (he replied) or EXHAUSTED (every step ran). */
    status: text('status').notNull().default('ACTIVE'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: text('ended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chase_states_lead_id_idx').on(t.leadId),
    index('chase_states_next_step_at_exhausted_idx').on(t.nextStepAt, t.exhausted),
    // One live chase per lead, enforced by the database: two timer runs that
    // overlap can never start two sequences for the same buyer.
    uniqueIndex('chase_states_one_active_per_lead')
      .on(t.leadId)
      .where(sql`status = 'ACTIVE'`),
  ],
);

/* -------------------------------------------------------------------------
 * Work for a HUMAN. Deliberately not the `tasks` table: the worker claims
 * every PENDING task whose due_at has passed, so a call waiting for an agent
 * would be picked up by a machine and fail. A person's queue also needs things
 * a machine queue does not — a priority, an owner, and an outcome.
 * ---------------------------------------------------------------------- */

export const CALL_REASONS = [
  'PHONE_ONLY',        // not on WhatsApp at all
  'DELIVERED_UNREAD',  // message landed, not opened
  'READ_NO_REPLY',     // opened, chose not to answer
  'HOT_LEAD',          // scored HOT: a human takes over
  'CHASE',             // a follow-up sequence step
  'NO_SHOW',           // booked a visit and did not come
  'LATE_STAGE',        // was near closing and went quiet: the owner rings today
  'VISIT_CHECK',       // a visit time has passed and nobody said whether he came
  'CALLBACK',          // he picked up and asked to be rung back later
] as const;
export type CallReason = (typeof CALL_REASONS)[number];

export const CALL_TASK_STATUSES = ['PENDING', 'DONE', 'CANCELLED'] as const;
export type CallTaskStatus = (typeof CALL_TASK_STATUSES)[number];

export const CALL_OUTCOMES = [
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'WRONG_NUMBER',
  'NOT_INTERESTED',
  'CALLBACK_REQUESTED',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Parked at the next 9:30 AM, these jump the queue ahead of same-morning work. */
export const PRIORITY_TOP = 10;
export const PRIORITY_NORMAL = 0;

export const callTasks = pgTable(
  'call_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** Null until an agent is assigned; the queue is shared in the meantime. */
    agentId: uuid('agent_id').references(() => agents.id),
    reason: text('reason').notNull(),
    priority: integer('priority').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('PENDING'),
    outcome: text('outcome'),
    notes: text('notes'),
    /** Makes a retried CREATE_CALL_TASK safe: the same key never inserts twice. */
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    // The agent's queue: pending work, top priority first, then oldest due.
    index('call_tasks_status_priority_due_at_idx').on(t.status, t.priority, t.dueAt),
    index('call_tasks_lead_id_idx').on(t.leadId),
  ],
);

/* -------------------------------------------------------------------------
 * Rate limiting, in the database so every server instance shares one count.
 * An in-memory counter would be per instance on a serverless host, and so
 * would never actually limit anything.
 * ---------------------------------------------------------------------- */

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
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
