-- core — who may call a seam at all (0125).
--
-- ── Why this file is the real fix and the migration is not ──────────────
--
-- `0125` revoked execute on every `security definer` function in `ops_*` from
-- `PUBLIC`. That closed what was open on the day it ran, and it cannot do
-- anything about migration 0112: a new function is executable by `PUBLIC` the
-- moment it is created, and the migration that would have caught it has
-- already gone past.
--
-- So the assertion below derives its set from `pg_proc` at the moment it runs.
-- Write a new seam without granting it deliberately and this fails, naming the
-- function. A hand-kept list would go stale on exactly the function nobody
-- remembered to add to it (F94), which is the same function nobody remembered
-- to grant.
--
-- ── What is being asserted, in one sentence ─────────────────────────────
--
-- The publishable key cannot call a seam. Not "cannot get a useful answer
-- from one" — cannot call it. The difference is the whole point of `0125`:
-- before it, `anon` could execute `post_transaction` and was stopped only by
-- `has_authority` returning false on a null `auth.uid()`, which is a runtime
-- check against a claim rather than a privilege.

begin;

-- ── 1. anon reaches nothing ──────────────────────────────────────────────
do $$
declare
  leaked text;
  n      int;
begin
  select count(*), string_agg(p.oid::regprocedure::text, E'\n  ' order by p.oid::regprocedure::text)
    into n, leaked
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname like 'ops\_%'
     and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  assert n = 0,
    n || ' security definer function(s) in ops_* can be executed by `anon`, which is the '
    || 'key that ships in every browser bundle. A new function is executable by PUBLIC the '
    || 'moment it is created — revoke it from public in the migration that creates it, the '
    || 'way 0125 did for the 175 that existed then:' || E'\n  ' || leaked;
end $$;

-- ── 2. the six that are shut stay shut ───────────────────────────────────
--
-- Named here, and **only** here, because this is the one place where naming
-- them is the point: each is a function an earlier migration deliberately
-- revoked from `public`, and the first draft of `0125` handed every one of
-- them to `authenticated` with a blanket grant. The loop now reads the
-- privilege before changing it, and this is what stops that regression coming
-- back — including by way of a later migration re-creating one of these and
-- picking up the PUBLIC default again.
--
-- A new deliberate revoke belongs in this list. That is not the stale
-- hand-kept scope of F94: the list is not what the guard *searches*, it is
-- what the guard *asserts about*, and a missing entry weakens one assertion
-- rather than silently skipping a whole class. It is derived from the ladder
-- with `grep -rn '^revoke .* on function' supabase/migrations/`, and that
-- pattern is written out because the first attempt grepped `revoke execute`
-- and missed `ops_prod.open_draft`, which 0109 shuts with `revoke all`. The
-- assertion below caught it, which is the argument for a guard that reads the
-- database rather than the migrations.
do $$
declare
  open_again text;
  n          int;
begin
  select count(*), string_agg(sig, E'\n  ' order by sig)
    into n, open_again
    from (values
            ('ops_core.bootstrap_admin'),   -- 0007
            ('ops_core.idem_replay'),       -- 0015 — no client may write directly
            ('ops_core.idem_remember'),     -- 0015
            ('ops_acct.account_guard'),     -- 0105
            ('ops_inv.asset_refs_invalid'), -- 0107
            ('ops_prod.open_draft'),        -- 0109 — `revoke all`, not `revoke execute`
            ('ops_inv.asset_rent_invalid'), -- 0116
            ('ops_hr.schedules_in_use_lost')-- 0117_hr_schedule_editable
         ) as shut(sig)
    join pg_proc p on p.oid::regproc::text = shut.sig
   where has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE');

  assert n = 0,
    n || ' function(s) that a migration deliberately revoked are reachable again: '
    || E'\n  ' || open_again || E'\n'
    || 'A blanket `grant execute … to authenticated` is how this happens. 0125 reads the '
    || 'privilege before changing it precisely so that a function shut on purpose stays shut.';
end $$;

-- ── 3. and everything else is still reachable by authenticated ───────────
--
-- The counterpart assertion, and the one that would catch an over-eager
-- revoke. `authenticated` reaching a seam is the design; what may be *done*
-- there is decided inside it. A seam the app cannot call is an outage, and an
-- outage found here costs a minute rather than a morning.
do $$
declare
  unreachable text;
  n           int;
begin
  select count(*), string_agg(p.oid::regprocedure::text, E'\n  ' order by p.oid::regprocedure::text)
    into n, unreachable
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname like 'ops\_%'
     and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and p.oid::regproc::text not in
         ('ops_core.bootstrap_admin','ops_core.idem_replay','ops_core.idem_remember',
          'ops_acct.account_guard','ops_inv.asset_refs_invalid','ops_prod.open_draft',
          'ops_inv.asset_rent_invalid','ops_hr.schedules_in_use_lost',
          -- Worker-only (0126), asserted as its own category in §3b below. Not
          -- seams: a person never "delivers an event", a machine does.
          'ops_core.outbox_due','ops_core.outbox_delivered','ops_core.outbox_failed')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');

  assert n = 0,
    n || ' security definer function(s) in ops_* cannot be executed by `authenticated`. '
    || 'Signed-in people reach every seam; what they may do there is decided inside it, by '
    || 'has_authority/has_permission and the catalogue (D218). A grant that narrows this '
    || 'puts the boundary in two places that must be kept in step:' || E'\n  ' || unreachable;
end $$;

-- ── 3b. the worker-only verbs, shut to people and open to the worker ─────
--
-- A third category, introduced by `0126`, and it needed writing down because
-- §2 and §3 between them had assumed there were only two.
--
-- `ops_core.outbox_due`, `outbox_delivered` and `outbox_failed` carry an event
-- out to a chat channel and record what happened. They take no authority and
-- ask for none, because the caller is not a person: the worker has no
-- `auth.uid()` to check. That is the same shape as `idem_remember` — plumbing,
-- not a decision — and plumbing is shut to clients for the same reason: a
-- signed-in person calling `outbox_delivered` would write "this went out" about
-- something that never did, and the outbox's whole value is that its record is
-- true.
--
-- So the rule for this category is both halves, asserted together, because
-- either one alone is satisfied by an accident:
--
--   `service_role` can execute it   (or the deliverer is dead and nothing says so)
--   nobody else can                 (or the record can be forged from a browser)
--
-- `file_evidence` is deliberately NOT here: it is granted to `authenticated`
-- too, because a person filing a document they are looking at is an ordinary
-- thing to do from a screen.
do $$
declare
  wrong text;
  n     int;
begin
  select count(*), string_agg(detail, E'\n  ' order by detail)
    into n, wrong
    from (
      select w.sig || ' — ' ||
             case when not has_function_privilege('service_role', p.oid, 'EXECUTE')
                    then 'the worker cannot execute it'
                  else 'reachable by ' ||
                       concat_ws(' and ',
                         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                then 'authenticated' end,
                         case when has_function_privilege('anon', p.oid, 'EXECUTE')
                                then 'anon' end)
             end as detail
        from (values
                ('ops_core.outbox_due'),
                ('ops_core.outbox_delivered'),
                ('ops_core.outbox_failed')
             ) as w(sig)
        join pg_proc p on p.oid::regproc::text = w.sig
       where not has_function_privilege('service_role', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
    ) x;

  assert n = 0,
    n || ' worker-only verb(s) have the wrong reach: ' || E'\n  ' || wrong || E'\n'
    || 'These three must be executable by service_role and by nothing else (0126). '
    || 'A person who can call them can write a delivery that never happened.';
end $$;

-- ── 4. the worker's reach is exactly four verbs ──────────────────────────
--
-- It was one until 2026-09-24, and `0038`'s sentence — *the worker's entire
-- reach is one verb* — was the reason a `service_role` key is allowed to exist
-- against this database at all. `0126` makes it four, so the sentence is
-- rewritten rather than quietly outgrown:
--
--   file_evidence      file a document the worker captured
--   outbox_due         claim events the catalogue has made live
--   outbox_delivered   say one went out
--   outbox_failed      say why one did not
--
-- The three new ones cannot choose what they carry. `outbox_due` reads
-- `ops_core.delivery_rules`, and a row that is not there or not `is_live` is
-- never returned — so widening the worker's *reach* did not widen what it can
-- *say*. That is the property that made four acceptable where four arbitrary
-- verbs would not have been.
--
-- The list is spelled out rather than counted. A count passes when one verb is
-- swapped for another, which is exactly the change that would matter.
do $$
declare
  reach text;
  n     int;
begin
  select count(*), string_agg(p.proname, ', ' order by p.proname)
    into n, reach
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname like 'ops\_%'
     and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('service_role', p.oid, 'EXECUTE');

  assert reach = 'file_evidence, outbox_delivered, outbox_due, outbox_failed',
    'The worker key can execute ' || n || ' seam(s): ' || coalesce(reach, '(none)')
    || '. It may file a document it captured and carry an event it did not choose, and '
    || 'nothing else (0038, 0126). Widening it is a decision to write down — in the '
    || 'migration and in this list — not a grant to add in passing.';
end $$;

-- ── 5. and the tables stay shut ──────────────────────────────────────────
--
-- The half of `0038`'s claim that was always true, asserted so it stays that
-- way. `service_role` carries `rolbypassrls`, so a single table grant would
-- hand it every row in that table with no policy in the way.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname like 'ops\_%'
     and c.relkind in ('r','v','m','p')
     and (has_table_privilege('service_role', c.oid, 'SELECT')
       or has_table_privilege('service_role', c.oid, 'INSERT')
       or has_table_privilege('service_role', c.oid, 'UPDATE')
       or has_table_privilege('service_role', c.oid, 'DELETE'));

  assert n = 0,
    n || ' table(s) in ops_* are reachable by service_role. That role has rolbypassrls, so '
    || 'one grant is every row with no policy in the way. The worker gets functions, never '
    || 'tables (0038).';
end $$;

-- ── 6. it is a privilege, not a preference ───────────────────────────────
--
-- The three assertions above read the catalogue. This one proves the
-- catalogue is telling the truth about what actually happens, because a
-- privilege that is right in `pg_proc` and wrong at the call site is worth
-- nothing. `anon` calls a money seam and is refused **before** any code in it
-- runs — which is why the refusal is a privilege error and not this system's
-- own worded refusal.
do $$
declare
  sqlstate_seen text := '(no error)';
begin
  set local role anon;
  begin
    perform ops_acct.void_transaction('trx-does-not-exist', 'smoke');
  exception when others then
    sqlstate_seen := sqlstate;
  end;
  reset role;

  assert sqlstate_seen = '42501',
    'anon calling void_transaction raised ' || sqlstate_seen || ', not 42501 '
    || '(insufficient_privilege). Anything else means it got far enough to run the '
    || 'function body and was turned away by has_authority — which is the runtime check '
    || '0125 exists to stop relying on.';
end $$;

rollback;
