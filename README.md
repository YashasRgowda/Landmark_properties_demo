# Landmark Properties — System 1 (Lead Engine)

An AI lead-response system for Landmark Properties, Yelahanka. Answers every
lead on WhatsApp within 60 seconds at any hour, holds a real conversation in the
buyer's language, sorts them Hot/Warm/Cold/Reject, books site visits, hands hot
leads to a human agent, and chases everyone who goes quiet.

Built against `BUILD-PROMPT.md` and `Landmark-System-1-Complete-Flow.pdf`, one
phase at a time.

**Status: Phase 1 (Lead intake) complete.**

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

## Two things worth knowing

**Auth is checked twice.** `proxy.ts` (Next 16's renamed middleware) redirects
signed-out visitors, but it is not the security boundary — every protected page
also calls `requireUser()` / `requireAdmin()` server-side.

**Time is IST for logic, UTC in the database.** Nothing outside
`lib/time-window.ts` should read the clock or reason about office hours.

## Phase progress

- [x] **Phase 0** — Foundation: project, schema, auth, time and phone libraries
- [x] **Phase 1** — Lead intake: webhook, dedupe, manual form, leads table
- [ ] Phase 2 — Task queue
- [ ] Phase 3 — WhatsApp
- [ ] Phase 4 — Meera and The Reader
- [ ] Phase 5 — The first-hour ladder
- [ ] Phase 6 — Site visits and the six chase sequences
- [ ] Phase 7 — Screens
- [ ] Phase 8 — Hardening
