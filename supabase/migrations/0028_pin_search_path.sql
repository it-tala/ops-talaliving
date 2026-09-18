-- 0028_pin_search_path.sql — the seven helpers that were not pinned, and two
-- tables whose emptiness is a decision rather than an oversight.
--
-- ── The first migration written after the ladder was applied ─────────────
--
-- Everything up to `0027` could be corrected in place, because the ladder had
-- never run anywhere but a scratch cluster. On 2026-09-18 it was applied to
-- `john-lau-v01`, and from here the rule changes: **a mistake in an applied
-- migration is fixed by a new migration, never by editing the old one.** A file
-- somebody has already run is a record of what their database actually did.
--
-- ── What Supabase's advisor found, and what it means here ────────────────
--
-- Seven functions in `ops_*` carry no `search_path`. All seven are `security
-- invoker`: they run with the caller's own privileges, so there is no
-- escalation to be had, which is why this is a WARN rather than an ERROR — and
-- why it was worth checking rather than assuming. Every one of the 77
-- `security definer` functions, the ones that *would* be an escalation, pins it
-- already.
--
-- So this is not a hole. It is a correctness risk of exactly the shape that
-- cost a day already: `0001` installed `citext` where the seams could not see
-- its operators, and `where email = p_email` silently became case-sensitive.
-- An unpinned function is the same bug waiting for a different name —
-- `ops_core.office_day` decides which working day a row falls on and is read by
-- the audit trail, the activity recap, the cash calendar and every receipt, and
-- a function whose resolution depends on who called it is a function that can
-- disagree with itself.
--
-- `pg_temp` is last on every one of these, as it is everywhere else in the
-- ladder: it stops a caller creating a temporary object that shadows a name the
-- function meant.

alter function ops_core.office_day(timestamptz)
  set search_path = ops_core, pg_temp;

alter function ops_core.said_ok(jsonb)
  set search_path = ops_core, pg_temp;

-- `new_token` reads `gen_random_uuid()`, which pgcrypto puts in `extensions` on
-- Supabase and in `public` on a bare Postgres. Both are named so the function
-- resolves identically in either, which is the whole point of pinning it.
alter function ops_core.new_token(text)
  set search_path = ops_core, extensions, public, pg_temp;

alter function ops_procure.receipt_counts(ops_procure.receipt_condition_t, ops_procure.receipt_status_t)
  set search_path = ops_procure, ops_core, pg_temp;

alter function ops_procure.receipt_is_problem(ops_procure.receipt_condition_t)
  set search_path = ops_procure, ops_core, pg_temp;

alter function ops_acct.due_date_of(text, integer)
  set search_path = ops_acct, ops_core, pg_temp;

alter function ops_acct.cash_occurrences(ops_acct.cash_frequency_t, integer, integer, date, text)
  set search_path = ops_acct, ops_core, pg_temp;

-- ── Two tables with RLS on and no policy at all ───────────────────────────
--
-- The advisor reports these as `rls_enabled_no_policy`, and it is right to:
-- that shape is usually somebody enabling RLS and forgetting the policy, which
-- locks a table nobody meant to lock.
--
-- Here it is the intent. Both tables are the machinery underneath the seams and
-- have no reading anybody should do directly: `doc_numbers` hands out `PR-26-09-10`
-- and must be touched only by `next_number()` holding its lock, and
-- `idempotency_keys` is what makes a double tap on a slow phone one decision
-- rather than two. A policy on either would be a way in that the design does
-- not want to exist — RLS on with no policy means **no row, to anybody, ever**,
-- while the `security definer` functions that own them pass through it.
--
-- Written into the database rather than into a file, because the advisor is
-- read against the database and whoever reads its output next should find the
-- answer in the same place as the question.
comment on table ops_core.doc_numbers is
  'RLS on with no policy, deliberately: reachable only through ops_core.next_number(), '
  'which holds the lock that makes a document number unique. Direct reads are not a '
  'use case this table has. (0028)';

comment on table ops_core.idempotency_keys is
  'RLS on with no policy, deliberately: written and replayed only by ops_core.idem_remember() '
  'and ops_core.idem_replay(). A client must never read another client''s claim. (0028)';
