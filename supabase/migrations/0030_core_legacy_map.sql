-- 0030_core_legacy_map.sql — which legacy row became which of ours.
--
-- ── The prerequisite B8 named and did not have ────────────────────────────
--
-- `docs/plan/phase-2/04-data-migration.md` states the arrangement's safety
-- rests on the import being *idempotent by `legacy_ref`*, then records that
-- **no such column exists anywhere** — not in the migrations, not in `src`.
-- Only `ops_acct.transactions` can recognise a row it has already taken, and
-- only through `source_ref`.
--
-- That is not a detail to handle inside the import. An import against a
-- database somebody is still using is never run once: it is run, reconciled,
-- corrected, and run again. Without a way to say *I have already taken this
-- one*, the second run is not a no-op — it is a duplicate, and what gets
-- duplicated is money.
--
-- ── A map, not a column on each table ─────────────────────────────────────
--
-- The plan left the choice open: `legacy_ref text unique` on every imported
-- table, or one map. The map, for three reasons.
--
-- **The domain tables stay clean.** `ops_procure.vendors` describes a vendor.
-- A column recording which row of a system being retired it came from is true
-- for a season and then is a column nobody can explain — and A5 means nothing
-- here is ever dropped, so it would outlive its reason.
--
-- **The reconciliation needs somewhere to live.** `notes` carries what the
-- import decided when it could not decide cleanly: *vendor name unresolved,
-- kept in remark*. With a column per table there is nowhere to put that except
-- another column per table.
--
-- **It answers the question in one place.** *Did we import that?* is one select
-- rather than seventeen, which matters most while the two systems run side by
-- side and somebody is trying to find out why a number differs.
--
-- The cost is a join to get from a legacy id to ours. The import pays it; no
-- screen ever does, because no screen should know the legacy system exists.

create table ops_core.legacy_map (
  id            bigserial primary key,

  -- Where it came from. `source_table` is schema-qualified (`public.vendors`)
  -- because the legacy system has five schemas and two of them have a table
  -- called `pay_allocations`.
  source_table  text not null,
  -- The legacy key, as text: they are uuids in some tables and text ids in
  -- others (`chat_users.user_id`), and one column that holds both without
  -- casting is what lets this table be one table.
  source_id     text not null,

  -- What it became here.
  target_table  text not null,
  target_id     uuid,

  -- **Nullable on purpose, and the null is the interesting row.** A legacy row
  -- that was read and deliberately not imported — a duplicate folded into
  -- another, a status column the new schema derives, a row the import refused —
  -- is still a row somebody will ask about. Recording the decision is the
  -- difference between *we chose not to* and *we missed it*, and only one of
  -- those is answerable six months later.
  outcome       text not null
                check (outcome in ('imported','skipped','refused','superseded')),
  -- Why, in words, when the outcome is not `imported`. The reconciliation
  -- report reads this column and nothing else.
  note          text,

  imported_at   timestamptz not null default now(),
  -- Which run. An import is re-run after corrections, and *what changed between
  -- Tuesday and Thursday* is a question the second run has to be able to answer.
  run_id        uuid not null,

  -- One legacy row has one fate. A second attempt to record the same source row
  -- is the import being run twice, which is expected — `on conflict do nothing`
  -- at the call site is what makes the whole import idempotent, and it is the
  -- entire reason this table exists.
  unique (source_table, source_id)
);

create index legacy_map_target_idx on ops_core.legacy_map (target_table, target_id);
create index legacy_map_run_idx    on ops_core.legacy_map (run_id);
create index legacy_map_outcome_idx on ops_core.legacy_map (outcome)
  where outcome <> 'imported';

alter table ops_core.legacy_map enable row level security;

-- **`it.read`, and no write policy at all.** Reading it is how somebody
-- reconciles the two systems, and that is IT's job during the cutover. Writing
-- it belongs to the import, which runs as the owner from `supabase/import/`
-- and passes through RLS — the same arrangement as `doc_numbers` and
-- `idempotency_keys` (0028), and for the same reason: a table whose only writer
-- is a script does not need a policy that lets a browser in.
create policy legacy_map_read on ops_core.legacy_map
  for select to authenticated using (ops_core.has_permission('it.read'));

grant select on ops_core.legacy_map to authenticated;

comment on table ops_core.legacy_map is
  'Which legacy row became which of ours, and what was decided about the ones that did not. '
  'Written only by supabase/import/, read under it.read. The unique (source_table, source_id) '
  'is what makes re-running an import a no-op instead of a duplicate. (0030)';

-- What the reconciliation screen reads, and what a person reads at 7pm when a
-- figure in the new system does not match the old one.
create or replace view ops_core.v_legacy_reconciliation as
  select source_table,
         count(*)                                          as rows_seen,
         count(*) filter (where outcome = 'imported')       as imported,
         count(*) filter (where outcome = 'skipped')        as skipped,
         count(*) filter (where outcome = 'refused')        as refused,
         count(*) filter (where outcome = 'superseded')     as superseded,
         min(imported_at)                                   as first_run,
         max(imported_at)                                   as last_run,
         count(distinct run_id)                             as runs
    from ops_core.legacy_map
   group by source_table;

alter view ops_core.v_legacy_reconciliation set (security_invoker = on);
grant select on ops_core.v_legacy_reconciliation to authenticated;
