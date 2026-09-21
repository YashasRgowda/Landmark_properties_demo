# Landmark Properties — System 1 (Lead Engine)

An AI lead-response system for Landmark Properties, Yelahanka. Answers every
lead on WhatsApp within 60 seconds at any hour, holds a real conversation in the
buyer's language, sorts them Hot/Warm/Cold/Reject, books site visits, hands hot
leads to a human agent, and chases everyone who goes quiet.

Built against [`docs/spec/BUILD-PROMPT.md`](docs/spec/BUILD-PROMPT.md) and [`docs/flowcharts/Landmark-System-1-Complete-Flow.pdf`](docs/flowcharts/Landmark-System-1-Complete-Flow.pdf), one
phase at a time.

**Status: Phase 4 (Meera and The Reader) complete.**

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript |
| UI | shadcn/ui + Tailwind CSS v4 |
| Database | PostgreSQL via Supabase |
| DB access | Drizzle ORM |
| Validation | Zod |
| Dates | date-fns-tz — logic in `Asia/Kolkata`, storage in UTC |
| Tests | Vitest |

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
  string → URI. Use the **session pooler** (port 5432) or the transaction pooler
  (port 6543); prepared statements are already disabled for the latter.
  Remember to URL-encode any special characters in the password.
- **`SUPABASE_URL`** / **`SUPABASE_SERVICE_ROLE_KEY`** — Project Settings → API.
- **`CRON_SECRET`**, **`LEAD_WEBHOOK_SECRET`**, **`AUTH_SECRET`** — already
  generated for you by the setup, but you can regenerate any of them with
  `openssl rand -base64 32`.
- AI and WhatsApp keys are only needed from Phase 3 onward.

### 3. Create the tables

```bash
npm run db:migrate
```

### 4. Create a login

```bash
npm run user:create -- you@landmark.test 'a-strong-password' admin
```

Roles are `admin` (sees `/admin`) or `agent`.

### 5. Run

```bash
npm run dev
```

Then open http://localhost:3000 — it redirects to `/app`, which redirects to
`/login` until you sign in.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Write a new SQL migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database |
| `npm run user:create` | Create or update a login account |
| `npm run verify:phase1` | Phase 1 acceptance test (needs `npm run dev` running) |
| `npm run verify:phase2` | Phase 2 acceptance test (needs `npm run dev` running) |
| `npm run verify:phase3` | Phase 3 acceptance test — runs against a fake Meta, no credentials needed |
| `npm run verify:phase4` | Phase 4 acceptance test — a real Gemini conversation through the fake Meta |

## Layout

```
app/
  login/            sign-in page
  app/              agent-facing screens (auth required)
  admin/            admin screens (admin role required)
lib/
  db/schema.ts      the whole System 1 schema
  auth/             session cookie, password hashing, page guards
  time-window.ts    OFFICE / EVENING / NIGHT — the only place the clock is read
  phone.ts          Indian phone normalisation to 91XXXXXXXXXX
drizzle/            generated SQL migrations
scripts/            operational scripts
tests/              Vitest unit tests
proxy.ts            optimistic auth redirect for /app and /admin
docs/               project documents — spec, flowcharts, proposal (see docs/README.md)
```

## Lead intake

```bash
curl -X POST http://localhost:3000/api/leads/intake \
  -H 'content-type: application/json' \
  -H "x-webhook-secret: $LEAD_WEBHOOK_SECRET" \
  -d '{"name":"Ravi","phone":"+91 98765 43210","source":"99acres","project":"Ashraya"}'
```

The secret may also be sent as `Authorization: Bearer <secret>`. Returns `201`
for a new lead, `200` for a repeat enquiry, `400` for bad input, `401` for a bad
secret.

**One phone number is one lead, forever.** A repeat enquiry never creates a
second row — it appends a `touches` row, so the enquiry history lives in the
append-only log. `leads.source` keeps the *first* source, because that is what
portal spend is reconciled against; later sources are recorded on the touch.

## The task queue

Everything scheduled is a row in `tasks`. Nothing slow runs inside a webhook.

```bash
curl http://localhost:3000/api/cron/worker -H "x-cron-secret: $CRON_SECRET"
```

In production, point a cron at that URL every minute. Vercel Cron's
`Authorization: Bearer <CRON_SECRET>` header is accepted too.

- Tasks are claimed with `FOR UPDATE SKIP LOCKED`, so two workers never take the
  same one.
- `attempts` is counted when a task is **claimed**, not when it fails — a task
  that kills the worker still runs out of attempts instead of retrying forever.
- Retries back off 1 min → 5 min → 30 min, then `FAILED` after 5 attempts.
- A task left `RUNNING` by a dead worker is returned to `PENDING` after 10
  minutes.
- `/app/debug` (development only) adds test tasks and runs the worker by hand.

## WhatsApp

`POST /api/webhooks/whatsapp` takes inbound messages and delivery statuses;
`GET` answers Meta's subscription challenge.

- Every delivery must carry a valid `X-Hub-Signature-256`. Unsigned requests are
  rejected, and the signature is checked against the **raw** body.
- The webhook only queues a `PROCESS_WA_EVENT` task and returns 200. Nothing is
  processed inline — Meta retries anything slow, which is how buyers get
  duplicate replies.
- `messages.wa_message_id` is unique, so a redelivered event is a no-op.
- Delivery statuses never move backwards: a late `sent` cannot undo a `read`,
  and a buyer who replied stays `REPLIED`.
- **Opt-out:** a message that is exactly STOP / unsubscribe / cancel (and
  similar) sets `opted_out` and cancels every pending task for that lead. The
  match is whole-message on purpose — "please don't stop sending updates" must
  not opt a buyer out.
- `sendText()` / `sendTemplate()` refuse an opted-out lead themselves, so no
  future phase can forget the check.

### Before go-live

`.env.local` currently holds **placeholder** WhatsApp values plus
`WHATSAPP_API_BASE` pointing at a local test server. Replace the four Meta
values and **delete the `WHATSAPP_API_BASE` line**, or live sends will go to
localhost.

## The AI

Used in exactly three places. Everything else — counting, scheduling, routing —
is ordinary code.

| Job | What it does | Where |
|---|---|---|
| **Meera** | Talks to the buyer | `lib/ai/meera.ts` |
| **The Reader** | Pulls facts out of the chat | `lib/ai/reader.ts` |
| The Writer | Chase messages (Phase 6) | not built yet |

- **Scoring is code, not AI** (`lib/scoring.ts`). Same facts in, same score out,
  and a human can argue with it.
- **The reply is sent before any scoring.** `RUN_READER` is queued only after
  the send, so the buyer never waits behind it.
- **The Reader runs on the first buyer message and every third after that** —
  not on every one.
- **If the AI fails the buyer still gets an answer**: a fixed fallback with the
  sales head's number. He never sees an error.
- Every call is logged to `ai_calls` with tokens and latency.
- `GEMINI_MODELS` is a fallback chain — Google's free tier throttles hard, so a
  busy model falls through to the next.

### ⚠️ The project data is invented

`lib/project-data.ts` holds **placeholder** Ashraya details — plot sizes, prices,
survey number, approvals. Meera answers only from this, so **every figure must be
replaced with Landmark's real data** before a real buyer sees it.

Budgets are parsed in English *and* Kannada, Hindi, Telugu and Tamil — a buyer
writing "45 ಲಕ್ಷ" must score the same as one writing "45 lakh".

## Two things worth knowing

**Auth is checked twice.** `proxy.ts` (Next 16's renamed middleware) redirects
signed-out visitors, but it is not the security boundary — every protected page
also calls `requireUser()` / `requireAdmin()` server-side.

**Time is IST for logic, UTC in the database.** Nothing outside
`lib/time-window.ts` should read the clock or reason about office hours.

## Phase progress

- [x] **Phase 0** — Foundation: project, schema, auth, time and phone libraries
- [x] **Phase 1** — Lead intake: webhook, dedupe, manual form, leads table
- [x] **Phase 2** — Task queue: enqueue, worker, retries, debug page
- [x] **Phase 3** — WhatsApp: send, signed webhook, delivery status, opt-out
- [x] **Phase 4** — Meera and The Reader: conversation, scoring, visit booking
- [ ] Phase 5 — The first-hour ladder
- [ ] Phase 6 — Site visits and the six chase sequences
- [ ] Phase 7 — Screens
- [ ] Phase 8 — Hardening
