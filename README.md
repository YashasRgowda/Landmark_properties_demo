# Landmark Properties — System 1 (Lead Engine)

An AI lead-response system for Landmark Properties, Yelahanka. Answers every
lead on WhatsApp within 60 seconds at any hour, holds a real conversation in the
buyer's language, sorts them Hot/Warm/Cold/Reject, books site visits and reminds
him of them, hands hot leads to a human agent, and follows up automatically on
everyone who goes quiet.

Built against [`docs/spec/BUILD-PROMPT.md`](docs/spec/BUILD-PROMPT.md) and
[`docs/flowcharts/Landmark-System-1-Complete-Flow.pdf`](docs/flowcharts/Landmark-System-1-Complete-Flow.pdf),
one phase at a time.

**Status: all eight phases complete.** Running as a pitch demo on placeholder
project data — see [Before real buyers](#before-real-buyers).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript |
| UI | shadcn/ui + Tailwind CSS v4 |
| Database | PostgreSQL via Supabase |
| DB access | Drizzle ORM |
| Validation | Zod |
| AI | Google Gemini (Claude supported via `AI_PROVIDER=claude`) |
| WhatsApp | Meta WhatsApp Cloud API |
| Hosting | Vercel |
| Dates | date-fns-tz — logic in `Asia/Kolkata`, storage in UTC |
| Tests | Vitest, plus end-to-end `verify:*` scripts |

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- **`DATABASE_URL`** — Supabase → Project Settings → Database → Connection
  string → URI. Session pooler (port 5432) locally; the transaction pooler (port
  6543) on Vercel. Prepared statements are already disabled for the latter.
  URL-encode any special characters in the password.
- **`CRON_SECRET`**, **`LEAD_WEBHOOK_SECRET`**, **`AUTH_SECRET`** — generate
  each with `openssl rand -base64 32`.
- **`GEMINI_API_KEYS`** — one or more keys, comma-separated. Each free-tier key
  is its own allowance. **`GEMINI_MODELS`** is the fallback chain.
- **WhatsApp** — `WHATSAPP_TOKEN` (a system-user token that never expires),
  `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- **Locally only:** `WHATSAPP_API_BASE=http://localhost:4599`, so sends go to
  the fake Meta the test scripts start instead of real WhatsApp. **Never set
  this on Vercel.** It is deliberately absent from `.env.example`, because
  Vercel imports that file's keys as empty strings.

### 3. Create the tables

```bash
npm run db:migrate
```

### 4. Create a login, and at least one agent

```bash
npm run user:create -- you@landmark.test 'a-strong-password' admin
npm run agent:create -- "Ravi Kumar" kannada,english "+91 98450 00000"
```

Logins are `admin` (sees `/admin`) or `agent`. Agents are the people hot leads
are handed to — a hot lead with no active agent has nobody to go to. After the
first one, add agents at `/admin/agents`.

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000 — it redirects to `/login` until you sign in.

### 6. Turn on the one-minute timer (production)

```bash
npm run scheduler:setup
```

**This is how the worker runs in production.** Supabase's `pg_cron` calls
`/api/cron/worker` every minute, authenticated with `CRON_SECRET`. Without it,
anything scheduled for later — the two-minute delivery check, a call due in ten
minutes, a visit reminder, every follow-up — waits until an unrelated message
happens to wake the worker, which for a buyer who never replies is never.

```bash
npm run scheduler:setup -- --status   # is it on, and its recent runs
npm run scheduler:setup -- --remove   # turn it off
```

Vercel's own cron runs only once a day on the free plan, which is not enough.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (restart `dev` afterwards) |
| `npm test` | Unit tests |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run db:generate` / `db:migrate` | Write / apply a migration from `lib/db/schema.ts` |
| `npm run user:create` | Create or update a login |
| `npm run agent:create` | Add an agent from the command line |
| `npm run scheduler:setup` | The one-minute timer (above) |
| `npm run seed` | 20 demo leads across every state; `-- --remove` takes them out |
| `npm run lead:reset` | Wipe a lead so the next message starts fresh (`-- <phone> --yes`) |
| `npm run verify:phase1` … `verify:phase8` | Each phase's acceptance test |
| `npm run verify:reliability` | Breaks Google and WhatsApp on purpose; every buyer must still be answered |
| `npm run verify:language` / `verify:behaviour` | Real-AI checks of Meera's languages and rules |

The `verify:*` scripts need `npm run dev` running. **Run them one at a time** —
they share ports, the AI switch and the queue, and two at once interfere.

## Layout

```
app/
  login/              sign-in
  app/                agent screens — Today, Leads, Calls, Visits (auth required)
  app/debug/failed    failed jobs (admin, works in production)
  admin/              project data and agents (admin role required)
  api/leads/intake    portals post new leads here
  api/webhooks/whatsapp  Meta posts messages and delivery statuses here
  api/cron/worker     the one-minute timer calls this
lib/
  db/schema.ts        the whole schema
  queue.ts, tasks/    the task queue and one handler per task type
  ai/                 Meera, The Reader, The Writer, and the Gemini provider
  whatsapp/           sending, the webhook's events, replies, documents
  first-hour.ts       the first-hour ladder (Phase 5)
  chase.ts            the six follow-up sequences (Phase 6)
  scoring.ts          HOT / WARM / COLD — code, not AI
  time-window.ts      OFFICE / EVENING / NIGHT
drizzle/              SQL migrations
scripts/              operational scripts and verify:* tests
tests/                Vitest unit tests
proxy.ts              optimistic auth redirect for /app and /admin
docs/                 spec, flowcharts, proposal
```

## How it works

### A lead arrives

```bash
curl -X POST http://localhost:3000/api/leads/intake \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $LEAD_WEBHOOK_SECRET" \
  -d '{"name":"Ravi","phone":"+91 98765 43210","source":"99acres","project":"Ashraya"}'
```

`201` for a new lead, `200` for a repeat, `400` bad input, `401` bad secret,
`429` too many requests. **One phone number is one lead, forever** — a repeat
enquiry adds a `touches` row instead of a second lead.

The opening WhatsApp is sent straight away, at any hour, just after the portal
gets its response. Two minutes later the system checks what happened (Phase 5):

| He… | Office hours | Evening | Night |
|---|---|---|---|
| replied | no call — Meera has him | | |
| read it, no reply | call in 15 min | call now | 9:30 AM |
| didn't open it | call in 10 min | call now | 9:30 AM |
| isn't on WhatsApp | call now, top priority | 9:30 AM, top | 9:30 AM, top |

### He writes back

Meta's webhook is signed and checked against the raw body, queued, and answered
with 200 at once; the reply is written just after. **Every message gets exactly
one answer, in time** — Meera's if she can, a plain fallback naming the sales
head if not:

- Meera has a 25-second budget. A slow or overloaded model is dropped after 8
  seconds (not retried on every key) and rested for two minutes.
- The buyer's reply always runs before background work, and the worker never
  starts a job it cannot finish before the 60-second function limit.
- If WhatsApp refuses the send, it is retried — never quietly marked done.
- Only his newest message is answered, and never twice.

`npm run verify:reliability` proves each of these by breaking things on purpose.

### The AI — exactly three jobs

| Job | What it does | Where |
|---|---|---|
| **Meera** | Talks to the buyer, in English, Kannada, Hindi, Telugu or Tamil | `lib/ai/meera.ts` |
| **The Reader** | Pulls facts out of the chat | `lib/ai/reader.ts` |
| **The Writer** | Writes follow-ups | `lib/ai/writer.ts` |

Everything else — scoring, scheduling, routing, counting — is ordinary code.
What the AI writes is checked in code: the right language, and no price the
project data does not contain (a Writer message that invents one is replaced by
a safe pre-written one). Every call is logged to `ai_calls`.

**Scoring** (`lib/scoring.ts`) follows the spec's points table, with two approved
changes: a confirmed visit from a buyer who can afford the plot is HOT, and a
booked visit is never COLD.

### He goes quiet

The timer checks every minute and starts the sequence that fits (Phase 6):

| Situation | Sequence |
|---|---|
| Never replied | 6 touches over 12 days, WhatsApp and calls alternating |
| Chatted, then stopped | a message at 48 h, a person on day 4 |
| Answered a call once, now unreachable | everything in writing, then two calls |
| Booked, didn't come | same day, a call next day, then two new slots |
| Visited, then quiet | feedback, objections on day 3, a person on day 7 |
| Was close to buying | the owner rings today, top of the queue |

The moment he replies or picks up, it stops. When a sequence runs out he moves
to a monthly drip — never deleted. A reply within 24 hours of his last message
is the Writer's own words; after that WhatsApp allows only an approved template
(`WHATSAPP_FOLLOWUP_TEMPLATE`, default `hello_world`). Visit reminders go the day
before.

### The screens

`/app` Today · `/app/leads` (filter, search) · `/app/leads/[id]` his whole
story, visit outcome, follow-up controls · `/app/calls` the call queue ·
`/app/visits` · `/admin/project` everything Meera may say — **a save changes her
very next message**, and bad values are refused · `/admin/agents` ·
`/app/debug/failed`.

## Safety

- **Auth is checked twice.** `proxy.ts` redirects signed-out visitors, but every
  page also calls `requireUser()` / `requireAdmin()` on the server.
- **Opted-out leads are never messaged.** The send function itself refuses, so
  no code path can forget. STOP also cancels every queued job and call.
- **Rate limits**, counted in the database so every server instance shares
  them: lead intake per address, per phone and overall; sign-in per address and
  per account.
- **Failed jobs** are retried 1 → 5 → 30 minutes, then listed at
  `/app/debug/failed` with the error, to retry or dismiss. A job cut off
  mid-run is picked back up after 90 seconds.
- **No leads for two office hours** raises an alert on the Today screen and in
  the logs — usually a broken portal feed. Nights do not count.
- **Contact counts are computed from `touches`**, never stored. A test fails if
  code starts using the old `attempt_count` column.
- **Local and production share one database**, so every task belongs to the
  environment that created it — a laptop running the simulator can never take a
  real buyer's reply. Test numbers (`+91 90000 0xxxx`) are never followed up in
  production.

## Demo

1. `npm run seed` fills the screens with 20 demo leads (remove them after with
   `npm run seed -- --remove`).
2. Message the WhatsApp number from your phone and chat with Meera.
3. On your lead's page, **Follow-up → Start this follow-up**, then **Send next
   step now** to show a 14-day sequence in minutes. Do step 2 first: within 24
   hours of your last message, the follow-ups are the Writer's own words rather
   than the `hello_world` template.

## Before real buyers

- Replace the **placeholder project data** at `/admin/project` — every price,
  plot, survey number and approval is invented — and the specimen PDFs in
  `public/documents/`.
- Move WhatsApp to **Landmark's own verified number** and get the follow-up,
  reminder and first-message templates approved by Meta; set
  `WHATSAPP_FIRST_TEMPLATE`, `WHATSAPP_FOLLOWUP_TEMPLATE` and
  `WHATSAPP_REMINDER_TEMPLATE`.
- Rotate the database password and replace any weak login passwords.
- Consider a paid Gemini key: free keys slow down at busy times (the system
  still answers every buyer, but with the fallback more often).

## Phase progress

- [x] **Phase 0** — Foundation: project, schema, auth, time and phone libraries
- [x] **Phase 1** — Lead intake: webhook, dedupe, manual form, leads table
- [x] **Phase 2** — Task queue: enqueue, worker, retries, debug page
- [x] **Phase 3** — WhatsApp: send, signed webhook, delivery status, opt-out
- [x] **Phase 4** — Meera and The Reader: conversation, scoring, visit booking
- [x] **Phase 5** — The first-hour ladder: first message, delivery check, call queue, hot-lead handover
- [x] **Phase 6** — Visit reminders and the six follow-up sequences
- [x] **Phase 7** — Screens: Today, leads, visits, project data, agents
- [x] **Phase 8** — Hardening: failed jobs, rate limits, lead-drought alert, seed data, this README
