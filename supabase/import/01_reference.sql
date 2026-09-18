-- 01_reference.sql — accounts, projects and vendors.
--
-- Steps 2–4 of the order in `docs/plan/phase-2/04-data-migration.md`. Step 1
-- (users) and step 5 (items) are held out, each for a reason `README.md`
-- states: one needs authentication accounts rather than rows, the other needs a
-- decision about units that is the owner's to make.
--
-- ── Idempotent, and that is the whole design ─────────────────────────────
--
-- Run it twice and the second run imports nothing and changes nothing. Every
-- insert is gated on `ops_core.legacy_map` not already holding that legacy row
-- (0030). An import against a database somebody is still using is never run
-- once — it is run, reconciled, corrected and run again — and without this the
-- second run is a duplicate.
--
-- ── One transaction ──────────────────────────────────────────────────────
--
-- All of it, or none. A half-imported reference table is worse than an empty
-- one: the rows that did land look complete, and the rows that did not are
-- invisible until something fails to resolve against them weeks later.
--
-- ── It never invents a reference ─────────────────────────────────────────
--
-- Where a legacy row cannot be carried across without making something up, it
-- is recorded `refused` with the reason and left out. The refusals are the
-- deliverable: a list somebody with the procurement grant works through, which
-- is what the owner's answer to *who rules on messy rows* requires.

\set ON_ERROR_STOP on
\timing off

begin;

-- One id for this run, so "what changed between Tuesday and Thursday" is
-- answerable from the map alone.
create temp table _run on commit drop as
  select gen_random_uuid() as run_id;

/* ── step 2 · accounts ────────────────────────────────────────────────────
 *
 * **Not an import.** `04-data-migration.md` lists this as 6 rows to bring
 * across; all six are already in `ops_acct.accounts`, seeded by `0013`, under
 * the same codes. Inserting them again would be six duplicates of the accounts
 * every transaction is about to resolve against.
 *
 * So this step **verifies and maps**. It writes no account row. What it
 * produces is the correspondence — legacy `code` → our id — which is what makes
 * the ledger import a join instead of a guess, and a refusal for any legacy
 * code we do not have, because a transaction naming an account that does not
 * exist here must be found now rather than at row 3.000.
 *
 * `public.accounts` has no id column of its own, so the code *is* the identity.
 */
insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.accounts',
       a.code,
       'ops_acct.accounts',
       o.id,
       case when o.id is null then 'refused' else 'imported' end,
       case when o.id is null
            then 'no account with this code in ops_acct.accounts — seeded set differs from legacy'
            else 'already seeded by 0013; mapped by code, nothing inserted' end,
       (select run_id from _run)
  from public.accounts a
  left join ops_acct.accounts o on o.code = a.code
 on conflict (source_table, source_id) do nothing;

/* ── step 3 · projects ────────────────────────────────────────────────────
 *
 * Five rows, and one of them cannot be carried across without inventing
 * something. `ops_procure.projects.code` is `not null unique` — a public
 * identifier, per ADR-004 — and `FAIRMONT` has no code in the legacy system.
 *
 * The codes in use are `25004`–`25007`, so the obvious move is `25008`. That is
 * **inventing a project number**, and a project number is a thing people quote
 * to each other and write on documents. Somebody chooses it; an import does
 * not. It lands in the refusals, which is one decision, on a row the owner will
 * recognise instantly.
 *
 * `is_active` carries `active` across as it stands. A project closed in the old
 * system is closed here — importing it as open would reopen four of five.
 */
insert into ops_procure.projects (code, name, is_active)
select btrim(p.code), btrim(p.name), coalesce(p.active, true)
  from public.projects p
 where coalesce(btrim(p.code), '') <> ''
   and not exists (
     select 1 from ops_core.legacy_map m
      where m.source_table = 'public.projects' and m.source_id = p.project_id::text)
 on conflict (code) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.projects',
       p.project_id::text,
       'ops_procure.projects',
       t.id,
       case when coalesce(btrim(p.code), '') = '' then 'refused' else 'imported' end,
       case when coalesce(btrim(p.code), '') = ''
            then 'no project code in the legacy row, and a project code is a public '
                 'identifier somebody chooses — not one an import may invent'
            else null end,
       (select run_id from _run)
  from public.projects p
  left join ops_procure.projects t on t.code = btrim(p.code)
 on conflict (source_table, source_id) do nothing;

/* ── step 4 · vendors ─────────────────────────────────────────────────────
 *
 * 296 rows, no blank names, no colliding names — checked against the live
 * database rather than assumed. (`04-data-migration.md` recorded 1 collision;
 * there are none today.) D30 says the system takes vendors uncurated, so they
 * all come across with `is_curated` false and curation is ordinary work after.
 *
 * **The code is generated here, in the same shape the seam generates it**
 * (`V-0001`, `0017`), because `ops_procure.vendors.code` is `not null unique`
 * and the legacy table has none. That is not inventing a fact about the vendor:
 * a surrogate public key has to come from somewhere, and matching the seam's
 * format means a vendor created next week and one imported today are
 * indistinguishable — which they should be.
 *
 * Numbered by `created_at` then name, so a re-run against the same data would
 * produce the same codes. `on conflict (code) do nothing` plus the `legacy_map`
 * guard is what makes the second run a no-op rather than 296 new codes.
 *
 * `aka` is jsonb in the old schema and `text[]` here. The six rows that carry
 * one keep it: a vendor's other names are how the 68 unresolved ledger names
 * will eventually be matched, so dropping them would make later work harder.
 */
with fresh as (
  select v.vendor_id, btrim(v.name) as name, v.aka, v.active,
         v.address, v.phone, v.bank_account,
         row_number() over (order by v.created_at, btrim(v.name)) as seq
    from public.vendors v
   where coalesce(btrim(v.name), '') <> ''
     and not exists (
       select 1 from ops_core.legacy_map m
        where m.source_table = 'public.vendors' and m.source_id = v.vendor_id::text)
),
base as (
  select coalesce(max(substring(code from 3)::int), 0) as n
    from ops_procure.vendors where code ~ '^V-[0-9]{4}$'
)
insert into ops_procure.vendors
  (code, name, aka, is_curated, phone, address, bank_account)
select 'V-' || lpad((b.n + f.seq)::text, 4, '0'),
       f.name,
       case when jsonb_typeof(f.aka) = 'array'
            then coalesce((select array_agg(x::text) from jsonb_array_elements_text(f.aka) x), '{}')
            else '{}' end,
       false,
       nullif(btrim(coalesce(f.phone, '')), ''),
       nullif(btrim(coalesce(f.address, '')), ''),
       nullif(btrim(coalesce(f.bank_account, '')), '')
  from fresh f cross join base b
 on conflict (code) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.vendors',
       v.vendor_id::text,
       'ops_procure.vendors',
       t.id,
       case when t.id is null then 'refused' else 'imported' end,
       case when coalesce(btrim(v.name), '') = ''
            then 'vendor has no name'
            when t.id is null
            then 'name did not land — check for a code collision'
            else null end,
       (select run_id from _run)
  from public.vendors v
  left join ops_procure.vendors t on t.name = btrim(v.name)
 on conflict (source_table, source_id) do nothing;

/* ── what it did ──────────────────────────────────────────────────────────
 *
 * Printed rather than returned, because whoever runs this reads a terminal.
 * Read this, not the exit code: an import that refuses 40 rows exits 0.
 */
\echo ''
\echo '── imported ────────────────────────────────────────────────────────'
select source_table, outcome, count(*) as rows
  from ops_core.legacy_map
 where run_id = (select run_id from _run)
 group by source_table, outcome
 order by source_table, outcome;

\echo ''
\echo '── refused — these need a decision, and nothing imported them ───────'
select source_table, source_id, note
  from ops_core.legacy_map
 where run_id = (select run_id from _run) and outcome = 'refused'
 order by source_table, source_id;

\echo ''
\echo '── landed ──────────────────────────────────────────────────────────'
select 'ops_procure.vendors'  as tbl, count(*) as rows from ops_procure.vendors
union all
select 'ops_procure.projects', count(*) from ops_procure.projects
union all
select 'ops_acct.accounts',    count(*) from ops_acct.accounts
order by 1;

commit;
