-- 04_backfill_reported_at.sql — correct the rows `file_evidence()` filed
-- before `0096` gave it anywhere else to put the time.
--
-- Every row `03_bridge_review_queue.sql` carried across was filed under the
-- old default: `reported_at` is the moment the bridge ran, not the moment the
-- chat message arrived. `public.raw_events.received_at` already held the true
-- moment the whole time — this reads it, the same way `03` read
-- `public.ledger_review_queue`, and it names a legacy schema, so it cannot be
-- a migration either (`check_schema_isolation.sh`) and lives here beside it.
--
-- `ref_id` is `<event uuid>~<slot>`, exactly as `03`'s own header states —
-- the source's own id, not a key this script invents. Splitting on `~` and
-- matching `raw_events.event_id` found all 38 rows in the inbox on
-- 2026-09-22, with no misses: this script updates only what it can prove a
-- match for, and touches nothing else.
--
-- Idempotent: run twice, the second run sets every row to the value it
-- already holds. `legacy_map` records the correction once regardless, keyed
-- on `(source_table, source_id)` the same as `03`.

\set ON_ERROR_STOP on

begin;

create temp table _corrected on commit drop as
select ei.ref_id,
       ei.reported_at as old_reported_at,
       re.received_at as new_reported_at
  from ops_acct.evidence_inbox ei
  join public.raw_events re
    on re.event_id = (split_part(ei.ref_id, '~', 1))::uuid
 where ei.origin = 'chat';

update ops_acct.evidence_inbox ei
   set reported_at = c.new_reported_at
  from _corrected c
 where c.ref_id = ei.ref_id
   and ei.reported_at is distinct from c.new_reported_at;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.raw_events',
       c.ref_id,
       'ops_acct.evidence_inbox',
       null,
       'imported',
       format('reported_at %s -> %s', c.old_reported_at, c.new_reported_at),
       gen_random_uuid()
  from _corrected c
 on conflict (source_table, source_id) do update
   set note = excluded.note;

-- Reported before the commit: `_corrected` is `on commit drop`, gone the
-- instant the transaction below ends.
\echo ''
\echo '── corrected ───────────────────────────────────────────────────────'
select count(*) filter (where old_reported_at is distinct from new_reported_at) as changed,
       count(*) as matched
  from _corrected;

\echo ''
\echo '── evidence_inbox.reported_at now ──────────────────────────────────'
select ref_id, reported_at from ops_acct.evidence_inbox order by reported_at limit 10;

commit;
