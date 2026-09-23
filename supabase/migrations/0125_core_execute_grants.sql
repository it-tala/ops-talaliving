-- 0125_core_execute_grants.sql — who may call a seam at all.
--
-- ── The claim that was not true ──────────────────────────────────────────
--
-- `0038_acct_file_evidence.sql` says, of the capture worker's key:
--
--     service_role gets **usage on the schema and execute on this function,
--     and nothing else.** No table grants. … A compromised worker key can
--     file evidence. It cannot read the ledger, and it cannot resolve
--     anything.
--
-- Half of that was measured and half was assumed. The table half is true and
-- stayed true: `service_role` holds **zero** privileges on all 189 tables
-- across the seven `ops_*` schemas, not one SELECT or INSERT.
--
-- The execute half was false. `service_role` could execute **278 of 285**
-- `ops_*` functions — among them `post_transaction`, `void_transaction`,
-- `edit_transaction`, `set_authorities`, `approve_payroll_run`,
-- `reveal_employee_doc_no`, and `resolve_inbox`, which that comment names by
-- name as the thing it cannot do. So could `anon`, which is the publishable
-- key that ships inside every browser bundle.
--
-- Nothing granted this. It is the PostgreSQL default: a new function is
-- executable by `PUBLIC`, and Supabase's three roles all inherit `PUBLIC`.
-- The ladder revokes it in exactly two places — `bootstrap_admin` (0007) and
-- `idem_replay`/`idem_remember` (0015) — which shows the authors knew about
-- the default and closed it where they were thinking about it. Ninety-odd
-- functions later, nobody was thinking about it.
--
-- ── What was actually protecting the ledger ─────────────────────────────
--
-- Not the grant. Every money seam opens with `ops_core.has_authority(...)`,
-- which is `select exists (… where ua.user_id = auth.uid() …)`. For `anon`,
-- `auth.uid()` is null, the `exists` is false, and the seam refuses. So the
-- door held — **by a different mechanism than the one documented, and a
-- weaker one.** Weaker because it is a runtime check against a claim rather
-- than a privilege: mint a `service_role` JWT that carries a `sub`, and
-- `auth.uid()` returns it, and every authority check passes for whoever that
-- is. A grant cannot be talked around by a claim.
--
-- Two guards where the design assumed one is fine. One guard where the design
-- assumed two is how a system is one mistake from open.
--
-- ── What this changes, and what it deliberately does not ────────────────
--
-- **`authenticated` keeps every function it has today.** That is not laziness
-- — it is the design. A signed-in person reaching a seam is supposed to
-- happen; what may then be *done* is decided inside, by `has_authority` and
-- `has_permission` and the catalogue (D218). Narrowing `authenticated` would
-- move the boundary into the grant table, where nobody reads it, and leave
-- two places to keep in step.
--
-- **`anon` loses execute on every `security definer` function in `ops_*`.**
-- Nothing signed-out has any business calling one: the app's only pre-session
-- call is Supabase Auth itself, and `record_sign_in()` runs after. This is
-- the change that matters, because `anon` is a key that is public on purpose.
--
-- **`service_role` is narrowed to the one verb a worker calls**, which is
-- what `0038` already said out loud.
--
-- **Only `security definer` functions are touched.** An invoker function runs
-- as its caller and is bounded by RLS, so a grant on one buys nothing; and 47
-- of the invoker functions here belong to the `citext` extension —
-- `citext_eq`, `texticlike`, the operator support. Revoking execute on those
-- would break every comparison against a citext column, for everybody. The
-- loop below selects on `prosecdef`, which excludes all 47 without naming
-- them: none of the 175 definer functions comes from an extension, checked
-- rather than hoped.
--
-- ── The mistake this loop is shaped around ──────────────────────────────
--
-- The obvious loop revokes from `public` and grants to `authenticated`, every
-- function, unconditionally. Written that way and applied to production, it
-- moved `authenticated` from 168 functions to 175 — because six of them had
-- been **deliberately** revoked by earlier migrations, and a blanket grant
-- handed them straight back: `bootstrap_admin` (0007), `idem_replay` and
-- `idem_remember` (0015, "no client may write directly"), `account_guard`
-- (0105), `asset_refs_invalid` (0107), `asset_rent_invalid` (0116).
--
-- So a file written to close a hole opened six. It was caught by the count
-- moving the wrong way, which is the argument for measuring before and after
-- rather than reading the diff and being satisfied.
--
-- The fix is not a list of six names to skip — that is the same staleness in
-- a new place. It is to **read the privilege before changing it**: a function
-- `public` can execute today was left on the default and is moved; one it
-- cannot was shut on purpose and is left alone. That reads identically on a
-- ladder replayed from nothing, where those revokes have already run.

-- ── Why a loop and not a list ───────────────────────────────────────────
--
-- A hand-kept list of 175 names stops covering the newest thing first (F94).
-- The loop reads `pg_proc`, so it covers whatever exists when it runs.
--
-- That leaves the other half of the problem: a function created by migration
-- 0112 is executable by `PUBLIC` the moment it exists, and this file has
-- already run. A migration cannot fix the future. So the guard that keeps
-- this shut is not here — it is `supabase/local/smoke/A2_core_execute_grants.sql`,
-- which derives the same set from `pg_proc` and fails if `anon` can reach one
-- of them. This migration closes what is open; the smoke file is what stops
-- it reopening.

do $$
declare
  fn record;
  n_moved int := 0;
  n_kept  int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig,
           -- **Read before revoking.** This is the whole correctness of the
           -- loop: `public` executable *right now* is what says the function
           -- was left on the default. A function an earlier migration
           -- deliberately revoked is already false here, so it is passed over
           -- rather than handed to `authenticated`.
           has_function_privilege('public', p.oid, 'EXECUTE') as was_public
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname like 'ops\_%'
       and p.prosecdef
       -- An extension owns its grants; we do not take them over.
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
  loop
    if fn.was_public then
      execute format('revoke execute on function %s from public', fn.sig);
      execute format('grant  execute on function %s to authenticated', fn.sig);
      n_moved := n_moved + 1;
    else
      n_kept := n_kept + 1;
    end if;
  end loop;

  raise notice
    'execute moved from public to authenticated on % security definer functions; % left shut',
    n_moved, n_kept;

  if n_moved = 0 then
    raise exception
      'No security definer function in ops_* was executable by public — this migration '
      'matched nothing, which means either the pattern is wrong or it ran before the '
      'schemas existed. Either way the grants are not in the state this file claims.';
  end if;
end $$;

/* ── the worker's one verb ───────────────────────────────────────────────
 *
 * `0038` granted `usage on schema ops_acct, ops_core to service_role` and
 * execute on this function. The usage grants stand; this restates the execute
 * one **after** the revoke above has taken it away along with everything else,
 * so the file is the whole statement of what a worker may call rather than a
 * correction to be read beside another file.
 *
 * Adding a second verb here is a decision, not a convenience: it widens what
 * a leaked key does. The signature is spelled out so that changing the
 * function's arguments makes this fail loudly rather than silently granting
 * nothing.
 */
grant execute on function ops_acct.file_evidence(
  text, text, text, ops_acct.inbox_origin_t, text, text, bigint, text,
  jsonb, ops_acct.direction_t, timestamptz, text) to service_role;

comment on function ops_acct.file_evidence(
  text, text, text, ops_acct.inbox_origin_t, text, text, bigint, text,
  jsonb, ops_acct.direction_t, timestamptz, text) is
  'The capture worker''s entire reach into this database: one verb, validated '
  'arguments, and since 0125 that is measured rather than asserted. A leaked '
  'worker key files evidence and does nothing else.';
