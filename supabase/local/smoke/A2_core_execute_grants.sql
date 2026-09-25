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
            ('ops_hr.schedules_in_use_lost'),-- 0117_hr_schedule_editable
            ('ops_procure.restamp_line_money')-- 0139 — called only from inside other seams
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
          'ops_procure.restamp_line_money',
          -- the chat worker's, below (§4)
          'ops_procure.answer_po_approval','ops_procure.po_approval_card',
          'ops_procure.answer_request','ops_procure.answer_batch',
          'ops_procure.approval_card',
          -- the notification worker's, below (§4). Not seams: a person never
          -- "delivers an event", a machine does.
          'ops_core.outbox_due','ops_core.outbox_delivered','ops_core.outbox_failed')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');

  assert n = 0,
    n || ' security definer function(s) in ops_* cannot be executed by `authenticated`. '
    || 'Signed-in people reach every seam; what they may do there is decided inside it, by '
    || 'has_authority/has_permission and the catalogue (D218). A grant that narrows this '
    || 'puts the boundary in two places that must be kept in step:' || E'\n  ' || unreachable;
end $$;

-- ── 4. the workers' reach is exactly what was decided ────────────────────
--
-- `file_evidence` is the capture worker's one verb (0038). Two more belong to
-- the chat worker that carries a PO approval card to leadership and brings the
-- answer back (D299, 0143): it reads one order's card and answers it, and
-- nothing else. Three more carry `ops_core.outbox` events out to Chat and
-- record what happened (0155) — claim, delivered, failed. One more is
-- `answer_request` (0157): the same road as `answer_po_approval`, for a request
-- line rather than an order, and it was reachable from a browser until then —
-- which let any signed-in reader record an approval against leadership, because
-- the seam takes the answerer's address as an argument and the token is on the
-- wire in `v_approval_request`.
--
-- The last two are `0159`'s, and they are the meeting's list rather than one
-- line: `approval_card` reads everything the approver's card shows — the lines,
-- the total, and BCA 271 against what approving them would owe — and
-- `answer_batch` answers the whole list in one press. Both carry or accept live
-- tokens, and a token in a browser is an approval anybody who can read it may
-- give. `answer_batch` writes nothing itself: it calls `answer_request` per
-- line, so the addressee check and the `approve_goods` check happen exactly
-- once in the codebase.
--
-- All of the non-`file_evidence` verbs are shut to `authenticated`, for the
-- same reason in two shapes: a card is answered from Chat by its addressee,
-- never from a browser session, and a signed-in person calling
-- `outbox_delivered` would write "this went out" about something that never
-- did. The outbox's whole value is that its record is true.
--
-- The outbox verbs take no authority and ask for none, because the caller is not
-- a person — the worker has no `auth.uid()` to check. That is `idem_remember`'s
-- shape: plumbing, not a decision. What keeps the widening safe is that
-- `outbox_due` cannot choose what it carries: it reads
-- `ops_core.delivery_rules`, so a row that is absent or not live is never
-- returned, and the worker's *reach* grew without what it can *say* growing.
--
-- The list is spelled out rather than counted, because a count passes when one
-- verb is swapped for another — which is exactly the change that would matter.
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

  assert reach = 'answer_batch, answer_po_approval, answer_request, approval_card, '
               || 'file_evidence, outbox_delivered, outbox_due, outbox_failed, po_approval_card',
    'The service_role key can execute ' || n || ' seam(s): ' || coalesce(reach, '(none)')
    || '. 0038 (capture), D299 (PO approval by Chat), 0155 (outbox to Chat), 0157 (a request '
    || 'line answered from Chat) and 0159 (the meeting''s whole list, and the card that carries '
    || 'its money) name exactly these nine, and that sentence is the reason a service_role key '
    || 'is allowed to exist here at all. Widening it is a decision to write down — in the '
    || 'migration and in this list — not a grant to add in passing.';

  select count(*), string_agg(p.proname, ', ' order by p.proname)
    into n, reach
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where p.oid::regproc::text in ('ops_procure.answer_po_approval','ops_procure.po_approval_card',
                                  'ops_procure.answer_request','ops_procure.answer_batch',
                                  'ops_procure.approval_card',
                                  'ops_core.outbox_due','ops_core.outbox_delivered',
                                  'ops_core.outbox_failed')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE'));
  assert n = 0,
    'The workers'' seams are reachable from a browser session: ' || reach
    || '. A PO approval card is answered from Chat by its addressee (D299), a request line the '
    || 'same way (0157), and a delivery that never happened must not be writable from a '
    || 'browser (0155). `answer_request` is the one that bit: it trusts its caller for the '
    || 'answerer''s address, so a browser caller could approve as anybody the card was sent to. '
    || '`answer_batch` and `approval_card` (0159) are the same trust over a whole meeting''s '
    || 'list, and the card hands out the tokens as well.';

  -- The other half: shut to people is only half the rule, and on its own it is
  -- satisfied by a deliverer nobody granted anything to.
  select count(*), string_agg(p.oid::regproc::text, ', ' order by p.oid::regproc::text)
    into n, reach
    from pg_proc p
   where p.oid::regproc::text in ('ops_core.outbox_due','ops_core.outbox_delivered',
                                  'ops_core.outbox_failed')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE');
  assert n = 0,
    'The notification worker cannot execute: ' || reach
    || '. Nothing would carry the outbox, and nothing would say so — the events would simply '
    || 'sit there, which is the state 0155 exists to end.';
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
