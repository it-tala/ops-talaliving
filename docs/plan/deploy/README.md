# Deployment brief — a session prompt

**Written for a fresh session.** It assumes no memory of the design sessions
and no access to their transcripts. Everything needed to start is here or
named by path. Read this file first, then `docs/plan/01-architecture.md`
(ADR-002 especially) and `docs/plan/00-context.md` §E.

Repository: `talait/ops-talaliving`. Default branch `main`, at the merge of
design milestones M58–M60. Owner is reached in **Indonesian**; the docs stay
in English with the domain vocabulary verbatim (`MSG SENT`, `SP NORTH`,
`PKWT`, account codes, id formats).

---

## 1. What actually exists, as of this brief

Validated by reading the tree, not from memory. Where the owner's summary and
the tree disagreed, the tree is recorded here.

| | State |
|---|---|
| Frontend | 61 routes, all eleven services, complete. Runs on browser-held fixtures |
| Migrations | 22 files, `supabase/migrations/0001…0022` |
| Tables | 46 — `ops_core` 13, `ops_procure` 22, `ops_acct` 11 |
| Views / functions | 42 views, 69 functions, RLS from the migration that creates each table |
| Supabase client seam | `src/lib/api/` — identity, procurement, accounting only |
| REST API | **none.** `src/app/api/` does not exist; there are zero route handlers |
| Deployed anywhere | no. No Vercel config, no Dockerfile, no CI |

### Three corrections to carry in

**a. It is six schemas, not one.** The migrations create `ops_core`,
`ops_procure`, `ops_acct`, `ops_hr`, `ops_inv`, `ops_prod`. The last three are
created empty and reserved — they have no tables yet. What is shared is the
`ops_` *prefix*, and the reason for it was the owner's instruction to leave the
old system's schema untouched (*"lewati menyentuh skema lama"*), so the two
systems can sit in one Postgres without colliding. It was a namespacing
decision, not a consolidation, and **not a performance decision** — the number
of schemas a database has does not affect query performance in Postgres.
Nothing downstream should be justified by a speed claim that isn't real.

**b. The UI is not connected to the database.** Not one file under `src/app`
or `src/components` imports `@/lib/api`; 109 of them import `@/demo`. The swap
is deliberately a single line in `src/demo/api/index.ts` (re-export from
`@/lib/api` when `NEXT_PUBLIC_USE_SUPABASE=1`), and that file belongs to the
design session, so it has not been written. **Deploying today ships the demo**,
with or without Supabase environment variables set. That is by design —
`useRealApi()` requires someone to *choose* the database, because a silent
fallback would mean a production app serving fixtures while every screen looks
correct. Do not "fix" it by making demo mode a fallback.

**c. Only three of eleven services have a backend.** `src/lib/api/` exports
identity, procurement and accounting. Documents, HR, production, inventory,
marketing, delivery and the assistant exist as screens and contracts with no
tables behind them. The flip is therefore not all-or-nothing across the app,
and whoever throws the switch needs to know which screens go live and which
must keep reading fixtures. **Resolve this before deploying, not after.**

---

## 2. The one thing that is genuinely undecided

`ops_core.users.id` references `auth.users(id)` — Supabase Auth. ADR-002 says
enforcement lives in the database: the API calls Postgres **as the signed-in
user**, never with a service role, and `has_permission()` decides. `00-context.md`
§E extends this to Chat in as many words:

> Chat does **not** get its own write path: the bot calls the same API the
> browser calls, as the identified person, and permission is checked the same way.

A Google Chat event hands you the sender's **email**. `ops_core.users.email` is
`citext not null unique`, so the join is clean and already exists. What does
*not* exist is a session: the bot holds an email, not that person's JWT, and RLS
answers to the JWT.

So there are three roads, and the deploy session must pick one deliberately:

1. **Mint a scoped JWT per Chat actor** using the project's JWT secret, with
   that user's `sub`. RLS keeps working untouched. Costs: the secret becomes a
   high-value credential on the listener host, and token lifetime/revocation
   become your problem.
2. **A `security definer` RPC** that takes the acting user and re-checks
   `has_permission()` internally, called with a dedicated low-privilege role.
   Enforcement stays in SQL. Costs: one function that can act for anyone, so it
   must be small enough to read in full and audited on every change.
3. **service_role from the listener.** *This contradicts ADR-002* and reopens
   exactly the hole D5 records — in `john-lau` the anon key could write the
   entire approval chain in production until 2026-08-26. A Chat approval is a
   user-triggered request; ADR-002 reserves service_role for work no user
   triggered. **Do not take this road without the owner overruling ADR-002 in
   writing, recorded in `06-decisions.md`.**

Recommendation: (2). It keeps the decision in the database where every other
permission already lives, and it does not put a signing secret on the host most
exposed to the internet.

---

## 3. Google Chat — reuse the bot, or rebuild?

A reader bot already runs on Cloud Run against `john-lau`'s own Supabase
project. `00-context.md` §E: *"A reader bot already exists; integrating it is a
later decision."* This is that decision.

**Separate the two things that get called "the bot".**

- **The Chat app registration** — the Google Cloud project, the app's name and
  avatar, its OAuth configuration, and the *space memberships*. Expensive to
  recreate: rebuilding means re-adding the bot to every space and getting
  people to talk to something new.
- **The handler code** — cheap to replace, and coupled to the old schema.

So the default answer is **keep the registration, rewrite the handler**. But
check one thing first, because it changes the shape of the job:

> `00-context.md`: *"`john-lau` and its Chat pipeline keep running on their own
> Supabase project throughout."*

If there is **one** Chat app and you repoint it at v2, you break john-lau on the
day you cut over, and both systems are supposed to run side by side. That argues
for a **second Chat app** for v2 during the parallel period — v2 gets its own
bot, in its own spaces or the same ones, and the cutover becomes "which bot do
people answer", which is reversible. Confirm with the owner whether parallel
running is still the plan; if john-lau is being retired sooner than §E assumes,
a single repointed app is simpler and cheaper.

**Two directions of traffic, and neither is built yet:**

| Direction | Status |
|---|---|
| Chat → system (approve a line, confirm receiving with a photo, the pre-PR exception intake) | nothing exists |
| System → Chat (notifications) | `ops_core.outbox` table exists — `service`, `event_type`, `payload`, `delivered_at`, `attempts`, `last_error`, with a partial index on undelivered. **No worker reads it.** `OUTBOX_WEBHOOK_SECRET` is reserved in `.env.example` |

Both are deploy-session scope. The outbox is the easier half and proves the
transport end to end; do it first.

---

## 4. Cloud Run vs a VPS — measure before you move

The owner's reason for moving is cost. Test that reason before acting on it,
because the likeliest outcome is that a VPS is *more* expensive.

**Cloud Run scales to zero and has a monthly free allowance.** A Chat bot for
one company — a few thousand events a month, each a few hundred milliseconds —
normally lands inside it and bills close to nothing. So a Cloud Run bill that
hurts usually has a specific cause, and the cause is usually fixable for free:

- **`min-instances` ≥ 1.** The classic one. It keeps an instance warm 24/7 and
  turns a scale-to-zero service into a rented server. Set it to 0 unless cold
  starts are genuinely hurting.
- **CPU always allocated** instead of CPU-only-during-request.
- **Over-provisioned** memory or vCPU on a service that needs neither.
- **A polling loop** — anything on a timer that wakes the service constantly
  defeats scale-to-zero entirely.
- **The bill isn't Cloud Run at all**: Artifact Registry storage, Cloud Build,
  Cloud Logging ingestion, egress, or a Cloud SQL instance left running.

**Step 1 of this work is to open the actual billing breakdown by SKU** and find
out which line is large. Report the number to the owner before proposing a
migration. If it is `min-instances`, the fix is one flag and the migration is
unnecessary.

**If the bill is real and a VPS is still wanted**, it is technically
straightforward — a Chat webhook needs only a public HTTPS endpoint that
verifies Google's token and answers within ~30 seconds:

- Google POSTs the event with a **Bearer JWT signed by Google** in the
  `Authorization` header (issuer `chat@system.gserviceaccount.com`, audience =
  your configured project). **Verify it against Google's public certs on every
  request** — without that check the endpoint is an open write path into the
  approval chain, reachable by anyone who learns the URL. This verification is
  identical on Cloud Run and on a VPS; nothing about Google Chat requires GCP.
- **Pub/Sub transport is the alternative worth knowing about**: a Chat app can
  receive events by subscribing to a Pub/Sub topic instead of exposing an HTTP
  endpoint. The VPS then needs *no* inbound port, no public domain and no
  certificate — it only makes outbound connections. For a small host with no ops
  team, that removes most of the attack surface and most of the maintenance.
- Honest cost of a VPS: a fixed monthly fee that never scales to zero, plus TLS
  renewal, OS patching, log rotation, monitoring, and a single point of failure
  with no automatic restart unless you build one. Budget the hours, not just the
  rupiah.

Deliver this as a **written comparison with the real billing figure in it**, for
the owner to decide — not as a migration already performed.

---

## 5. Suggested order of work

1. Read the Cloud Run bill by SKU. Report. *(cheap, and may end §4 immediately)*
2. Put the §2 identity question and the §3 one-bot-or-two question to the owner.
3. Stand up the Supabase project; apply `0001…0022` to a **fresh** project.
   Run `supabase/local/rebuild.sh` and `smoke.sh` locally first.
4. Deploy the frontend **in demo mode** (`NEXT_PUBLIC_USE_SUPABASE` unset). It
   is honest, it is useful to the owner immediately, and it decouples hosting
   problems from database problems.
5. Build the outbox worker. Proves system → Chat end to end.
6. Build the inbound listener on the §2 road the owner chose.
7. Only then discuss flipping the three backed services to real data — and name
   explicitly which screens stay on fixtures.

---

## 6. Standing rules — these are not negotiable

- **Branch.** Develop on the branch the session is given. Never push elsewhere
  without explicit permission. **Never open a pull request unless asked.**
- **Secrets.** Secret store → environment variable, never the repo. `service_role`
  never in a `NEXT_PUBLIC_*` name — `src/lib/supabase/env.ts` throws on it, and
  that guard exists because the prefix is an instruction to inline the value into
  the client bundle. Do not weaken it to make an import work.
- **The production database is production.** Never wipe, never bulk-delete.
  Corrections are VOID, not DELETE. Additive migrations may be applied after a
  dry run; **destructive DDL asks the owner first.**
- **Do not touch the old system's schema.** Standing instruction. Related:
  `core.audit_exempt` in production has RLS disabled (critical). It is known,
  it is reported, and it is deliberately left alone — it belongs to john-lau.
- **`docs/plan/` is the living record.** Update `06-decisions.md`, `findings.md`
  and the README milestone board **in the same commit as the work**, never after.
- **Known and accepted:** 5 npm advisories whose only fix is a breaking Next
  major upgrade. Do not upgrade as a side quest.

## 7. Questions for the owner — ask, don't assume

1. Is john-lau still running in parallel? (Decides one Chat app or two — §3.)
2. Which of the three identity roads in §2?
3. When the three backed services go live, what happens to the eight screens
   with no backend — hidden, or visibly labelled as demo?
4. Which domain does the deployed app answer on?
