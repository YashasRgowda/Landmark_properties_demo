# Landmark Properties — System 1 (Lead Engine) — Build Specification

> **How to use this file.** Open a new Claude Code session in this folder and say:
> *"Read BUILD-PROMPT.md. Start Phase 0. Do not move to the next phase until I confirm the acceptance test passes."*
>
> Build **one phase at a time**. Do not skip ahead. Each phase ends with a test you can run yourself.

---

## 1. What we are building

An AI lead-response system for **Landmark Properties**, a plotted-development company in Yelahanka, Bangalore. They buy ~20,000 leads a month from 99acres/MagicBricks/Housing and employ 40 calling agents.

**The problem:** 40 agents can only make ~57,000 dial attempts a month. 20,000 leads need 120,000–160,000 attempts. So each lead gets ~3 attempts when it needs 6–8, and most leads are never properly worked.

**What System 1 does:** answers every lead on WhatsApp within 60 seconds (any hour, day or night), holds a real conversation in the buyer's language, sorts them Hot/Warm/Cold/Reject, books site visits, hands hot leads to a human agent with a briefing, and automatically chases everyone who goes quiet.

**Reference material in this folder / linked:**
- `Landmark-System-1-Complete-Flow.pdf` — **the authoritative flowchart.** Build exactly this.
- Full proposal: https://claude.ai/code/artifact/d078db58-5501-4fb6-8417-fc1a9e24f095
- All 8 system diagrams: https://claude.ai/code/artifact/5d08e0fa-01c0-4d1d-931d-10ec7f123f2d

**System 2 (call recording and agent scoring) is NOT in scope.** Do not build it. Do not add tables for it.

---

## 2. Tech stack — use exactly this

| Layer | Choice |
|---|---|
| Framework | **Next.js 15+ (App Router), TypeScript** — frontend and backend in one project |
| UI | **shadcn/ui** + Tailwind CSS |
| Database | **PostgreSQL via Supabase** |
| DB access | **Drizzle ORM** (typed, migration-friendly) |
| Background jobs | A `tasks` table + a worker route hit by a cron (see Phase 2) |
| AI | **Provider-agnostic adapter.** Gemini free tier for development, swappable to Claude in one file |
| Validation | **Zod** on every API boundary |
| Dates | **date-fns-tz** — all logic in `Asia/Kolkata`, all storage in UTC |

**UI priority: functional and plain.** Use stock shadcn components. No custom design work. We make it premium later.

---

## 3. Golden rules — violating these breaks the system

1. **The code orchestrates, not the AI.** The AI never decides what happens next. It reads text and returns an answer; the code decides everything else, following the flowchart.

2. **AI is used in exactly 3 places.** Meera (conversation), The Reader (scoring), The Writer (chase messages). Everything else — counting, scheduling, time checks, dedupe, routing — is ordinary code and a database.

3. **Never block the buyer's reply on background work.** Send Meera's reply first, then queue the scoring. A slow score must never delay a message.

4. **Everything is: event → task queue → worker.** Never do slow work inside a webhook handler. Webhooks write a row and return 200 immediately.

5. **Every outbound action is idempotent.** Use a unique key so a retry can never double-send a message or double-book a visit.

6. **Nothing may crash the flow.** Every external call (AI, WhatsApp, DB) is wrapped. A failure logs, marks the task for retry, and moves on.

7. **All times are IST for logic, UTC in the database.** Never store a local time.

8. **Every contact attempt writes a `touches` row.** This is how "contacted 3 times" is counted. Never keep a counter that can drift.

9. **Admin pages require login.** Not optional, even in development.

10. **No secrets in client components.** All AI and WhatsApp calls happen server-side only.

---

## 4. Environment variables

Create `.env.local` (git-ignored) and a matching `.env.example` (committed, values blank):

```
# Database
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# AI provider — "gemini" while building, "claude" for the pilot
AI_PROVIDER=gemini
GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# WhatsApp (Phase 3 — leave blank until then)
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

# Security
CRON_SECRET=
LEAD_WEBHOOK_SECRET=
AUTH_SECRET=

# Business config
OFFICE_OPEN=09:30
OFFICE_CLOSE=19:00
EVENING_CLOSE=21:00
TIMEZONE=Asia/Kolkata
```

---

## 5. Database schema

Write these as Drizzle migrations. This is the complete schema for System 1.

```sql
-- Every person who enquires. One row per phone number, ever.
create table leads (
  id                uuid primary key default gen_random_uuid(),
  phone             text not null unique,        -- normalised: 919876543210
  name              text,
  email             text,
  source            text not null,               -- 99acres | magicbricks | housing | meta | website | walkin | broker
  campaign          text,
  project           text,                        -- which project they asked about
  status            text not null default 'NEW', -- see status list below
  category          text,                        -- HOT | WARM | COLD | REJECT
  score             int  not null default 0,
  budget            text,
  timeline          text,
  purpose           text,                        -- own_construction | investment
  language          text,                        -- english | kannada | telugu | hindi | tamil
  interested_plot   text,
  summary           text,                        -- one line for the agent
  wa_state          text,                        -- NOT_ON_WHATSAPP | DELIVERED | READ | REPLIED
  attempt_count     int  not null default 0,
  last_contact_at   timestamptz,
  next_action       text,
  next_action_at    timestamptz,
  owner_agent_id    uuid references agents(id),
  opted_out         boolean not null default false,
  consent_basis     text,                        -- why we were allowed to message them
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on leads (category, next_action_at);
create index on leads (status);
create index on leads (owner_agent_id);

-- EVERY contact attempt, inbound or outbound. The source of truth for "contacted N times".
create table touches (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  channel       text not null,   -- whatsapp | call | sms
  direction     text not null,   -- outbound | inbound
  outcome       text,            -- sent|delivered|read|replied|answered|no_answer|failed|undeliverable
  agent_id      uuid references agents(id),
  duration_secs int,
  notes         text,
  happened_at   timestamptz not null default now()
);
create index on touches (lead_id, happened_at);

-- Every WhatsApp message, both directions.
create table messages (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  direction     text not null,        -- outbound | inbound
  body          text not null,
  media_url     text,
  template_name text,
  wa_message_id text unique,          -- Meta's id — used for idempotency
  status        text,                 -- queued|sent|delivered|read|failed
  sent_at       timestamptz not null default now()
);
create index on messages (lead_id, sent_at);

-- The scheduler. "Call him at 6:15 PM" is a row here.
create table tasks (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads(id) on delete cascade,
  type            text not null,       -- see task types below
  payload         jsonb,
  due_at          timestamptz not null,
  status          text not null default 'PENDING', -- PENDING|RUNNING|DONE|FAILED|CANCELLED
  attempts        int not null default 0,
  last_error      text,
  idempotency_key text unique,         -- prevents double-execution
  created_at      timestamptz not null default now()
);
create index on tasks (status, due_at);

-- Booked site visits.
create table visits (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  visit_at      timestamptz not null,
  label         text,                  -- the buyer's own words: "Sunday 11 AM"
  status        text not null default 'BOOKED', -- BOOKED|REMINDED|ATTENDED|NO_SHOW|CANCELLED
  reminded_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on visits (visit_at, status);

-- Which chase sequence a silent lead is in.
create table chase_states (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references leads(id) on delete cascade,
  state          text not null,   -- NEVER_ANSWERED|WA_GHOST|CALL_GHOST|NO_SHOW|POST_VISIT_SILENT|LATE_STAGE
  step           int not null default 0,
  next_step_at   timestamptz,
  exhausted      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index on chase_states (lead_id);
create index on chase_states (next_step_at, exhausted);

-- The sales team.
create table agents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text unique,
  languages  text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Project data the AI answers from. Editable in the admin panel.
create table project_data (
  id         int primary key default 1,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Audit log of every AI call — needed for debugging and cost tracking.
create table ai_calls (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references leads(id) on delete set null,
  job           text not null,     -- meera | reader | writer
  provider      text not null,
  model         text not null,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  success       boolean not null,
  error         text,
  created_at    timestamptz not null default now()
);
```

**Lead status values:** `NEW`, `MESSAGE_SENT`, `NOT_ON_WHATSAPP`, `DELIVERED_UNREAD`, `READ_NO_REPLY`, `CHATTING`, `QUALIFIED`, `WITH_AGENT`, `VISIT_BOOKED`, `VISITED`, `WON`, `LOST`, `REJECTED`

**Task types:** `SEND_FIRST_MESSAGE`, `CHECK_DELIVERY`, `CREATE_CALL_TASK`, `RUN_READER`, `SEND_CHASE_MESSAGE`, `SEND_VISIT_REMINDER`, `ESCALATE_TO_AGENT`, `ADVANCE_CHASE`

---

## 6. The time rules — implement once, use everywhere

Create `lib/time-window.ts` with a single function:

```ts
type Window = 'OFFICE' | 'EVENING' | 'NIGHT';
function currentWindow(at: Date): Window
function nextOfficeOpen(at: Date): Date   // next 9:30 AM IST
```

| Window | IST hours | What may happen |
|---|---|---|
| `OFFICE` | 09:30 – 19:00 | WhatsApp + phone call within 10 minutes |
| `EVENING` | 19:00 – 21:00 | WhatsApp + one AI/agent call attempt, then stop |
| `NIGHT` | 21:00 – 09:30 | **WhatsApp only. No calls.** Queue everything for 9:30 AM |

**WhatsApp always sends, in every window, including 3 AM.** Only calls are restricted.

---

## 7. The three AI jobs

Build `lib/ai/provider.ts` with one interface so the model can be swapped in one place:

```ts
interface AIProvider {
  complete(opts: {
    system: string;
    messages: {role:'user'|'assistant'; content:string}[];
    json?: boolean;
    maxTokens?: number;
  }): Promise<{text: string; inputTokens: number; outputTokens: number}>;
}
```

Implement `GeminiProvider` and `ClaudeProvider`. Select via `AI_PROVIDER`. **Every call is logged to `ai_calls`.**

### Job 1 — Meera (the conversation)

Runs when a buyer sends a WhatsApp message.

- Warm, human, WhatsApp-style. Short sentences. Blank line between separate thoughts.
- Replies in the buyer's language: English, Kannada, Telugu, Hindi, Tamil. **Never mixes two Indian languages.** If unsure, plain English.
- **Answers only from `project_data`.** Never invents a price, date, discount or fact.
- **Never calculates EMI, interest or loan eligibility.** Hands those to the sales head.
- Leads with the legal proof — DC conversion, E-Khata, survey number — because that is the buyers' biggest fear in this corridor.
- Discovers budget, timing, purpose and phone naturally, **one question at a time**, never as a form.
- Pins a **specific day and time** when a visit is agreed (site timings 10 AM – 6 PM).
- Answers honestly if asked whether it is a bot, then keeps helping.
- **Never offers a discount** beyond what `project_data.approved_offers` allows. Anything below the floor → escalate to a human.

### Job 2 — The Reader (scoring)

Runs **after** Meera replies, as a queued task. Never blocks the reply. Runs when the conversation has advanced — roughly every 3rd buyer message, not every one.

Returns strict JSON:

```json
{
  "name": "string|null",
  "budget": "string|null",
  "timeline": "0-3 months|3-6 months|6+ months|null",
  "purpose": "own_construction|investment|null",
  "interested_plot": "string|null",
  "language": "english|kannada|telugu|hindi|tamil",
  "asked_for_documents": true,
  "asked_about_loan": false,
  "visit_agreed": true,
  "visit_datetime_iso": "2026-09-14T11:00:00+05:30",
  "visit_label": "Sunday 11 AM",
  "disqualified": false,
  "disqualify_reason": null,
  "summary": "one short line for the agent"
}
```

Scoring is **code, not AI** — in `lib/scoring.ts`:

| Signal | Points |
|---|---|
| Visit agreed with a specific day | +4 |
| Asked for khata / DC / approval documents | +3 |
| Budget stated at or above entry price | +3 |
| Timeline 0–3 months | +3 |
| Timeline 3–6 months | +2 |
| Asked about registration or possession | +2 |
| Asked about a specific plot or dimension | +2 |
| Asked about plot loan | +1 |
| Purpose known | +1 |

**Category:** `HOT ≥ 9` · `WARM 5–8` · `COLD 1–4` · `REJECT` if `disqualified` is true.

### Job 3 — The Writer (chase messages)

Writes one short message to a lead who went quiet. Must reference something specific they actually said. Match their language. No pressure. One emoji at most. Never invents an offer. Output is the message text only.

---

## 8. Build phases

> **Rule: do not start a phase until the previous phase's acceptance test passes.**

### PHASE 0 — Foundation

- Next.js 15 App Router + TypeScript project in this folder
- Tailwind + shadcn/ui initialised
- Drizzle connected to Supabase; all tables from section 5 migrated
- `.env.local` + `.env.example`
- Simple email+password auth (any lightweight solution). **All `/admin` and `/app` routes protected.**
- `lib/time-window.ts` with unit tests
- `lib/phone.ts` — normalise Indian numbers to `91XXXXXXXXXX`, with tests

**Acceptance test:** `npm run dev` starts. Visiting `/app` while logged out redirects to login. `currentWindow()` returns `NIGHT` for 11 PM IST and `OFFICE` for 2 PM IST. Phone normaliser turns `+91 98765 43210`, `09876543210` and `9876543210` all into `919876543210`.

---

### PHASE 1 — Lead intake

- `POST /api/leads/intake` — accepts `{name, phone, email, source, campaign, project}`, secured by `LEAD_WEBHOOK_SECRET`
- Zod validation; phone normalised
- **Dedupe:** if the phone exists, do not create a new lead — append a `touches` row and update `source` history
- Writes a `touches` row for the enquiry itself
- A manual "Add lead" form at `/app/leads/new` for testing without a real portal
- `/app/leads` — a plain table: name, phone, source, status, category, created

**Acceptance test:** POST the same phone twice in different formats → exactly one lead row, two touches. The leads table shows it.

---

### PHASE 2 — The task queue (build this before any messaging)

- `lib/queue.ts` — `enqueue(type, leadId, dueAt, payload, idempotencyKey)`
- `GET /api/cron/worker` — protected by `CRON_SECRET`. Claims up to 50 tasks where `status='PENDING' AND due_at <= now()`, using `FOR UPDATE SKIP LOCKED` so two workers never take the same task
- Each task type maps to a handler in `lib/tasks/`
- **Retry:** on failure increment `attempts`, back off (1m, 5m, 30m), mark `FAILED` after 5
- A dev-only button on `/app/debug` to run the worker manually

**Acceptance test:** Enqueue a task due 10 seconds from now. Hit the worker — nothing runs. Wait 10s, hit it again — it runs exactly once. Hit it a third time — it does not run again. Enqueue two tasks with the same idempotency key — only one row exists.

---

### PHASE 3 — WhatsApp

- `lib/whatsapp.ts` — `sendTemplate()`, `sendText()`, using Meta Cloud API
- `POST /api/webhooks/whatsapp` — handles Meta's `GET` verification challenge, and `POST` for inbound messages + delivery status
- **Verify Meta's signature** using `WHATSAPP_APP_SECRET`. Reject unsigned requests.
- Webhook writes a row and returns 200 **immediately**; all processing goes to the queue
- Inbound message → save to `messages` → `touches` row (`inbound`, `replied`) → update `lead.wa_state = 'REPLIED'`
- Delivery status → update `messages.status` and `lead.wa_state` (`DELIVERED` / `READ`)
- Send failure meaning the number is not on WhatsApp → `lead.wa_state = 'NOT_ON_WHATSAPP'`
- **Opt-out:** an inbound message containing STOP / unsubscribe sets `opted_out = true` and cancels all pending tasks for that lead

**Acceptance test:** Send yourself a template from the app; it arrives. Reply; it appears in `messages` with a `touches` row. Reply "STOP"; the lead is marked opted out and pending tasks are cancelled.

---

### PHASE 4 — Meera and The Reader

- `lib/ai/provider.ts` + Gemini and Claude implementations
- `project_data` seeded with the Ashraya details (plots, sizes, prices, approvals, timings, sales contact)
- On inbound message: load history → call Meera → **send reply immediately** → *then* enqueue `RUN_READER`
- `RUN_READER` task: calls The Reader, applies `lib/scoring.ts`, updates category/score/facts on the lead
- If `visit_agreed` is true with a valid date → create a `visits` row (idempotent per lead)
- **Failure path:** if Meera fails, send a fixed fallback message giving the sales head's number. Never show an error to the buyer.

**Acceptance test:** Have a real WhatsApp conversation with the system. It answers in your language, sends the approval documents, and asks about budget naturally. After 3 messages the lead's category and facts are populated. Say "I'll come Sunday at 11" → a `visits` row appears with the right date.

---

### PHASE 5 — The first-hour ladder

This is the core of the flowchart. Build it exactly.

On a new lead:
1. Enqueue `SEND_FIRST_MESSAGE` — **due immediately, any hour**
2. After sending, enqueue `CHECK_DELIVERY` due in 2 minutes

`CHECK_DELIVERY` branches on `wa_state`:

| State | Meaning | Action |
|---|---|---|
| `NOT_ON_WHATSAPP` | Undeliverable | **Phone-only lead.** `OFFICE` → agent call task now. `EVENING`/`NIGHT` → agent call task at next 9:30 AM, **top priority** |
| `DELIVERED` (unread) | Busy | `OFFICE` → call task at +10 min. `EVENING` → call task now. `NIGHT` → 9:30 AM |
| `READ` no reply | Chose not to answer | Same as above but +15 min in `OFFICE` |
| `REPLIED` | Chatting | No call. Meera has it. |

- Call tasks appear on `/app/calls` — the agent's queue, sorted by priority then time
- The agent marks the outcome; that writes a `touches` row
- **Hard rule to enforce and test: no lead sits longer than 10 minutes in `OFFICE` hours without a call task existing.**
- HOT leads → assign `owner_agent_id` by language match, then round-robin among active agents; enqueue `ESCALATE_TO_AGENT` immediately
- Lead detail page `/app/leads/[id]` — the "track box": facts, status line (*contacted N times · last X · next Y · owner Z*), one merged timeline of messages and calls

**Acceptance test:** Create a lead at 11 PM with a number that has no WhatsApp → call task exists, due 9:30 AM tomorrow, marked top priority. Create one at 2 PM that gets delivered but unread → call task due at +10 minutes. Create one that replies → no call task at all.

---

### PHASE 6 — Site visits and the six chase sequences

- Visit reminder: 24 hours before, `SEND_VISIT_REMINDER` — message with date, time, map link, pickup offer
- Mark attended / no-show on the visit
- `lib/chase.ts` — the six states, each with its own step schedule:

| State | Trigger | Sequence |
|---|---|---|
| `NEVER_ANSWERED` | No reply to anything | 6 touches over 14 days, rotating WhatsApp → call → SMS, varying the hour |
| `WA_GHOST` | Chatted then stopped | Message at 48h → **human call task** on day 4 |
| `CALL_GHOST` | Answered once, now unreachable | Everything in writing → 2 calls at different hours |
| `NO_SHOW` | Booked, didn't come | Message same day → call next day → offer a new date |
| `POST_VISIT_SILENT` | Visited, then quiet | Feedback at 24h → objection at day 3 → **human call** day 7 |
| `LATE_STAGE` | Was near closing | **Top agent call same day** + notify the owner |

- Each step enqueues `SEND_CHASE_MESSAGE` (using The Writer) or a call task
- Any inbound reply **cancels the chase** and returns the lead to `CHATTING`
- Exhausted chases → `COLD` drip, never deleted

**Acceptance test:** A lead with no reply for 2 days enters `NEVER_ANSWERED` and gets a message. Reply to it → the chase cancels and pending chase tasks are gone.

---

### PHASE 7 — Screens

Plain shadcn. No design work.

- `/app` — today: new leads, hot leads waiting, calls due, visits today
- `/app/leads` — filter by category, status, source; search by phone
- `/app/leads/[id]` — the track box (from Phase 5)
- `/app/calls` — the agent's call queue
- `/app/visits` — upcoming visits
- `/admin/project` — edit project data: plots, prices, availability, possession, approvals, offers, sales contact. **Saving updates what Meera says on the very next message.**
- `/admin/agents` — add and deactivate agents

**Acceptance test:** Change a plot price in `/admin/project`, then ask the WhatsApp bot the price → it quotes the new one.

---

### PHASE 8 — Hardening

- A dead-letter view at `/app/debug/failed` listing `FAILED` tasks with the error
- Alert (email or console) if no leads have been ingested in 2 hours during office hours
- `attempt_count` on the lead kept in sync with `touches` (compute it, don't store a drifting counter)
- Rate-limit the intake endpoint
- Never message an `opted_out` lead — enforce in `sendTemplate`/`sendText`, not just at the call site
- Seed script that creates 20 realistic test leads across every state
- README with setup steps and how to run the worker

**Acceptance test:** Kill the AI key and send a message → the buyer still gets the fallback message, the task retries, and the failure appears in `/app/debug/failed`.

---

## 9. Mistakes to avoid

These are real errors from the earlier prototype. Do not repeat them.

1. **Do not await scoring before replying.** The buyer waited for 3 AI calls in the old version. Reply first, queue the rest.
2. **Do not run The Reader on every message.** Every 3rd buyer message, or when the conversation clearly advanced.
3. **Do not use loose keyword regexes.** The old visit-detector matched `am|pm` without word boundaries, so "I **am** looking" triggered it. Use word boundaries and test.
4. **Do not leave admin pages unauthenticated.** The old prototype exposed every buyer's phone number to anyone with the URL.
5. **Do not put secrets in client components.**
6. **Do not store local times.** UTC in the database, IST for logic.
7. **Do not let one failure stop a batch.** One bad lead must not block the other 49 in the worker run.
8. **Do not blast messages.** WhatsApp's daily limit starts at 1,000 new conversations. Add a configurable daily send cap and respect it.

---

## 10. Out of scope — do not build

- System 2: call recording, transcription, agent scoring, leaderboards
- AI voice calling
- Any premium UI or custom design
- Multi-project support (Ashraya only for now — but do not hardcode it so badly that adding Horizon later means a rewrite)
- Payments, registration tracking, broker portal

---

## 11. Definition of done for System 1

A lead can arrive at any hour and:
1. Receive a WhatsApp within 60 seconds with the approval documents
2. Have a real conversation in their own language
3. Be scored and categorised automatically
4. Book a site visit that is stored and reminded
5. Reach a human agent with a full briefing if hot
6. Be chased automatically through the right sequence if they go quiet
7. Be visible on one screen showing every touch and the next scheduled action

...and none of it depends on any person remembering anything.
