-- 0080_mkt_referrals.sql — the second funnel, and what a project owes the
-- person who brought it in.
--
-- Marketing takes the **0080 block**, after inventory's 0070s. This migration
-- builds only the half that has money in it (D185, D186): an agent who agreed
-- is a **representative with a rate**, the owners they introduce are
-- **referrals**, and a referral that becomes a project earns a commission the
-- business **owes**. The first funnel — markets, properties, the three agents
-- per property, the seven-day move-on — is a migration of its own and nothing
-- here needs it.
--
-- ## Why this lands on `v_project_cost`
--
-- Commission is not marketing's private figure. It is money a project costs,
-- as surely as its plywood is, and until now `v_project_cost` had a spend side
-- and no revenue side at all. So this migration completes it — the same way
-- `0063` completed `v_work_order` — with what the job was **sold** for and
-- what its introduction **costs**.
--
-- ## The number that is not stored, and the copy that is dropped
--
-- The contract gives `Referral` its own `contract_value`, typed in beside the
-- project code (C15). Two places now hold one number: that column, and
-- `ops_procure.projects.contract_value`, which exists and is what everything
-- else in the system means by *what the job is worth*. A stored copy is a
-- number that drifts, and the first time the contract is revised the
-- commission is computed off the stale one. So the referral names the project
-- **by code** (ADR-004) and the value is read from the project.
--
-- D186's refusal survives that change and gets sharper: `WON` needs a project
-- code **and** a contract value, and now the second half can actually be
-- checked rather than trusted to whoever typed it.
--
-- ## Deliberately no margin column
--
-- `projected_cost` is materials only, `ledger_spend` is everything the job has
-- ever paid out, and `commission_owed` is a third slice. Subtracting any of
-- them from `contract_value` gives a number that looks like profit and is a
-- category error — the same argument D151 makes about the ledger, one column
-- further on. The view shows the pieces and names them; whoever needs a margin
-- has to say which pieces they meant.

create schema if not exists ops_mkt;  -- the Package programme: reps, referrals, commission

-- `agn` and `lead`, which is what the tracker prints today and what the team
-- says out loud. `rep` and `rfl` would have been tidier and would have made
-- every number on every screen change shape on the day of the swap — the one
-- change guaranteed to make it unusable by the people who use the sheet (D183).
insert into ops_core.doc_prefixes (prefix, what) values
  ('agn',  'sales representative'),
  ('lead', 'referral');

-- Deliberately shorter than the outreach ladder: an owner either is talking to
-- us, has signed, or has not.
create type ops_mkt.referral_status_t as enum ('LEAD','SURVEYED','QUOTED','WON','LOST');

create table ops_mkt.sales_reps (
  id                 uuid primary key default gen_random_uuid(),
  rep_no             text not null unique default ops_core.next_doc_number('agn'),
  name               text not null check (length(btrim(name)) > 0),
  agency             text,
  phone              text,
  email              text,
  -- The market they were recruited in. Null for a rep who works across several,
  -- which happens and is not an error. A **code**, at the seam — the market
  -- table arrives with the first funnel and this must not wait for it.
  market_code        text,
  -- Per cent of the project value, negotiated per person. The upper bound is
  -- the demo's own guard, which the team has been running against a real
  -- tracker: a rate above twenty is a typo far more often than a deal.
  commission_percent numeric not null
    check (commission_percent > 0 and commission_percent <= 20),
  onboarded_on       date not null default ops_core.office_day(),
  active             boolean not null default true,
  note               text,
  created_by         uuid references ops_core.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table ops_mkt.referrals (
  id                uuid primary key default gen_random_uuid(),
  referral_no       text not null unique default ops_core.next_doc_number('lead'),
  rep_id            uuid not null references ops_mkt.sales_reps(id),
  owner_name        text not null check (length(btrim(owner_name)) > 0),
  unit              text,
  -- The property it sits in, by ref, across the seam (ADR-004). Null until the
  -- first funnel exists, and null for a walk-in the rep brought from elsewhere.
  property_ref      text,
  phone             text,
  status            ops_mkt.referral_status_t not null default 'LEAD',
  introduced_on     date not null default ops_core.office_day(),
  -- `ops_procure.projects.code`. **Not a foreign key** and not a uuid: the
  -- project is another service's row and this is the seam (ADR-004). The
  -- trigger below is what makes it mean something.
  project_code      text,
  -- **No `contract_value` here.** See the header, and C15.
  --
  -- Which ledger row paid the commission. A public code, again at the seam —
  -- this module records what is owed and never pays it (D186).
  commission_trx_no text,
  lost_reason       text,
  note              text,
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A referral that has been surveyed and quoted is work, not revenue. A
  -- percentage of a hoped-for size is a figure the agent will eventually quote
  -- back at us (D186).
  constraint won_names_a_project check (status <> 'WON' or project_code is not null),
  -- Losing says why, for the same reason cancelling a work order does.
  constraint lost_says_why check (
    status <> 'LOST' or (lost_reason is not null and length(btrim(lost_reason)) > 0)),
  -- Nothing is paid on an introduction that did not become a job.
  constraint paid_only_when_won check (commission_trx_no is null or status = 'WON')
);

create index referrals_rep_idx     on ops_mkt.referrals (rep_id);
create index referrals_project_idx on ops_mkt.referrals (project_code) where project_code is not null;
create unique index referrals_one_per_project on ops_mkt.referrals (project_code)
  where project_code is not null and status = 'WON';

-- ── the other half of D186's refusal, which only now can be checked ───────
--
-- The constraint above catches *no project code*. This catches *a project code
-- with nothing behind it* — a job that does not exist, or one whose contract
-- value nobody has entered. Either way the commission would be a number nobody
-- can check, and commission is money, which is the one place A6 does not apply.
create or replace function ops_mkt.won_needs_a_priced_contract()
returns trigger
language plpgsql set search_path = ops_mkt, pg_temp as $$
declare v_value numeric; v_found boolean;
begin
  if new.status <> 'WON' then return new; end if;

  select p.contract_value, true into v_value, v_found
    from ops_procure.projects p where p.code = new.project_code;

  if not coalesce(v_found, false) then
    raise exception 'no project % — a commission needs a contract that exists (D186)',
      new.project_code using errcode = 'check_violation';
  end if;
  if v_value is null or v_value <= 0 then
    raise exception 'project % has no contract value; a percentage of nothing is not a commission (D186)',
      new.project_code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger won_needs_a_priced_contract
  before insert or update on ops_mkt.referrals
  for each row execute function ops_mkt.won_needs_a_priced_contract();

-- ── a rate that has been paid against cannot move ─────────────────────────
--
-- One rate per rep is the contract's shape and the tracker's. It holds right
-- up to the moment somebody renegotiates: every commission already computed
-- silently restates, including the ones the ledger has paid, and the module's
-- figures stop agreeing with the bank.
--
-- So the rate is ordinary editing while nothing has been paid, and frozen
-- afterwards. A rep who genuinely renegotiates mid-relationship needs the
-- **dated** rate `ops_hr.pay_rule_sets` already has, which is a bigger change
-- than this table should make on a guess — see F114.
create or replace function ops_mkt.rate_is_frozen_once_paid()
returns trigger
language plpgsql set search_path = ops_mkt, pg_temp as $$
begin
  if new.commission_percent is not distinct from old.commission_percent then
    return new;
  end if;
  if exists (select 1 from ops_mkt.referrals r
              where r.rep_id = old.id and r.commission_trx_no is not null) then
    raise exception
      'rep %s rate has already been paid against; changing it would restate commissions the ledger has settled',
      old.rep_no using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger rate_is_frozen_once_paid
  before update on ops_mkt.sales_reps
  for each row execute function ops_mkt.rate_is_frozen_once_paid();

-- ── what is owed ──────────────────────────────────────────────────────────
--
-- Derived on every read, never stored (A3). The write guard above means a
-- `WON` referral always has a value behind it; this one is the **read** guard
-- beside it, because a contract value cleared later in procurement is not
-- something a trigger here can prevent, and a commission computed off a
-- missing number must come back null rather than nought.
create or replace view ops_mkt.v_referral as
select
  r.referral_no,
  r.rep_id,
  s.rep_no,
  s.name                                   as rep_name,
  s.commission_percent,
  r.owner_name,
  r.unit,
  r.property_ref,
  r.phone,
  r.status,
  r.introduced_on,
  r.project_code,
  p.name                                   as project_name,
  -- One number, read from the one place that holds it.
  p.contract_value,
  case when r.status = 'WON' and p.contract_value is not null
       then round(p.contract_value * s.commission_percent / 100)::bigint end as commission_amount,
  r.commission_trx_no,
  (r.commission_trx_no is not null)        as commission_paid,
  case when r.status = 'WON' and p.contract_value is not null and r.commission_trx_no is null
       then round(p.contract_value * s.commission_percent / 100)::bigint
       when r.status = 'WON' and p.contract_value is not null then 0::bigint end as commission_unpaid,
  -- Named rather than silently null: *won, and the contract value went away*
  -- is a state somebody has to go and fix.
  (r.status = 'WON' and p.contract_value is null) as contract_value_missing,
  r.lost_reason,
  r.note,
  r.updated_at
from ops_mkt.referrals r
join ops_mkt.sales_reps s on s.id = r.rep_id
left join ops_procure.projects p on p.code = r.project_code;

create or replace view ops_mkt.v_rep as
select
  s.rep_no,
  s.name,
  s.agency,
  s.phone,
  s.email,
  s.market_code,
  s.commission_percent,
  s.onboarded_on,
  s.active,
  count(v.referral_no)::int                                  as referrals,
  count(*) filter (where v.status = 'WON')::int              as won,
  count(*) filter (where v.status = 'LOST')::int             as lost,
  -- Σ of the contracts that came from them.
  sum(v.contract_value) filter (where v.status = 'WON')      as won_value,
  coalesce(sum(v.commission_amount), 0)::bigint              as commission_earned,
  coalesce(sum(v.commission_amount) filter (where v.commission_paid), 0)::bigint as commission_paid,
  -- The number that matters (D186).
  coalesce(sum(v.commission_unpaid), 0)::bigint              as commission_unpaid,
  count(*) filter (where v.contract_value_missing)::int      as needs_attention,
  s.note
from ops_mkt.sales_reps s
left join ops_mkt.v_referral v on v.rep_id = s.id
group by s.id, s.rep_no, s.name, s.agency, s.phone, s.email, s.market_code,
         s.commission_percent, s.onboarded_on, s.active, s.note;

-- ── one more thing a reader may not be allowed to see: the prices ────────
--
-- `projected_cost` walks the BOM and prices it out of `ops_procure.items`,
-- which is open to procurement, production and inventory and to nobody else.
-- A marketing reader therefore prices **nothing**, every line comes back
-- unpriced, and `projected_cost` is null — for a completely different reason
-- from the one that null already means, which is *some component has no price*.
-- One null, two sentences, and no way to tell them apart: F104's shape for the
-- sixth time.
--
-- So the reader is told which it is. The predicate below mirrors the three
-- `items_read*` policies exactly; when procurement collapses them into one
-- (F111) this line collapses with them.
create or replace view ops_prod.v_wo_materials as
select
  w.wo_no,
  w.product_code,
  w.project_code,
  w.qty,
  w.bom_rev,
  w.status,
  x.lines                            as projected_lines,
  -- Withheld rather than counted: to a reader who can price nothing, *every
  -- line is unpriced* is true of the reader, not of the bill of material.
  case when ops_core.has_permission('procurement.read')
         or ops_core.has_permission('production.read')
         or ops_core.has_permission('inventory.read')   then x.unpriced end as projected_unpriced,
  x.unexploded                       as projected_unexploded,
  coalesce(x.has_cycle, false)       as projected_has_cycle,
  case when ops_core.has_permission('procurement.read')
         or ops_core.has_permission('production.read')
         or ops_core.has_permission('inventory.read')   then x.material_cost end as projected_cost,
  ops_core.has_permission('procurement.read') as procurement_visible,
  case when ops_core.has_permission('procurement.read') then coalesce(r.requests, 0)      end as requests,
  case when ops_core.has_permission('procurement.read') then coalesce(r.request_lines, 0) end as request_lines,
  case when ops_core.has_permission('procurement.read') then coalesce(r.asked, 0)         end as asked,
  case when ops_core.has_permission('procurement.read') then coalesce(r.approved, 0)      end as approved,
  case when ops_core.has_permission('procurement.read') then coalesce(r.paid, 0)          end as paid,
  case when ops_core.has_permission('procurement.read') then coalesce(r.asked_unpriced, 0) end as asked_unpriced,
  -- Appended in 0080: may this reader be told what making it costs at all.
  (ops_core.has_permission('procurement.read')
   or ops_core.has_permission('production.read')
   or ops_core.has_permission('inventory.read'))        as cost_visible
from ops_prod.work_orders w
left join lateral ops_prod.explode_summary(w.product_code, w.qty, w.bom_rev) x on true
left join lateral (
  select count(distinct l.doc_no)::int            as requests,
         count(*)::int                            as request_lines,
         sum(l.item_total)                        as asked,
         sum(case when ap.approved
                  then coalesce(ap.approved_amount, l.item_total) else 0 end) as approved,
         sum(coalesce(cov.covered, 0))            as paid,
         count(*) filter (where l.item_total = 0)::int as asked_unpriced
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    left join ops_procure.v_line_coverage cov on cov.line_id = l.id
    left join ops_procure.v_line_approval ap
      on ap.line_id = l.id and ap.step = 'GOODS'
   where l.source_wo_no = w.wo_no
     and l.removed_at is null
     and d.status <> 'CANCELLED'
) r on true;

-- ── `v_project_cost`, completed ───────────────────────────────────────────
--
-- What the job was **sold** for, and what its introduction **costs**, beside
-- what making it costs. Four modules answer one question about a project and
-- no single reader may see all four, so the view says which quarters it was
-- allowed to show — `procurement_visible`, `ledger_visible`, and now
-- `marketing_visible`. A commission summed to nought for a workshop reader
-- would say *nobody is owed anything on this job*, which is a different
-- sentence from *you may not see it* (F104, F112, F113).
--
-- `contract_value` carries no flag because `projects_read` is `using (true)`:
-- procurement decided in `0006` that the project list is not a secret, and
-- what a job was sold for is on it.
create or replace view ops_prod.v_project_cost as
select
  p.code                                as project_code,
  p.name                                as project_name,
  count(m.wo_no)::int                   as work_orders,
  case when bool_and(m.cost_visible)
       then count(*) filter (where m.projected_cost is null)::int end as orders_without_a_projection,
  -- No `cost_visible` guard here, deliberately: `v_wo_materials` already
  -- withholds `projected_cost` from a reader who cannot price anything, so
  -- every order comes back unprojected and this null arrives on its own. A
  -- second guard that can never fire is a line the next reader has to work
  -- out — the mutation that removed it changed nothing, which is how it was
  -- found. `orders_without_a_projection` below is not redundant: without its
  -- guard it would count every order and read as a fault in the data.
  case when count(*) filter (where m.projected_cost is null) > 0 then null
       else sum(m.projected_cost)::bigint end          as projected_cost,
  max(m.procurement_visible::int)::boolean             as procurement_visible,
  sum(m.asked)::bigint                                 as asked,
  sum(m.approved)::bigint                              as approved,
  sum(m.paid)::bigint                                  as paid,
  ops_core.has_permission('accounting.read')           as ledger_visible,
  case when ops_core.has_permission('accounting.read') then coalesce((
    select sum(t.amount_idr)
      from ops_acct.transactions t
     where t.project_id = p.id
       and t.direction = 'OUT'
       and t.status <> 'VOID'), 0)::bigint end         as ledger_spend,
  -- What it was sold for. Null where nobody has entered it, and that null is
  -- load-bearing: it is what stops a commission being computed (D186).
  p.contract_value::bigint                             as contract_value,
  ops_core.has_permission('marketing.read')
    or ops_core.has_permission('accounting.read')      as marketing_visible,
  case when ops_core.has_permission('marketing.read')
         or ops_core.has_permission('accounting.read') then coalesce((
    select sum(v.commission_amount) from ops_mkt.v_referral v
     where v.project_code = p.code), 0)::bigint end    as commission_owed,
  case when ops_core.has_permission('marketing.read')
         or ops_core.has_permission('accounting.read') then coalesce((
    select sum(v.commission_amount) from ops_mkt.v_referral v
     where v.project_code = p.code and v.commission_paid), 0)::bigint end as commission_paid,
  -- Appended rather than placed beside the figure it governs: `create or
  -- replace view` may add a column at the end and may not move one, and the
  -- view already has readers. The order of columns is not the contract.
  bool_and(m.cost_visible)                             as cost_visible
from ops_procure.projects p
join ops_prod.work_orders w      on w.project_code = p.code
join ops_prod.v_wo_materials m   on m.wo_no = w.wo_no
where w.status <> 'CANCELLED'
group by p.id, p.code, p.name, p.contract_value;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_mkt.sales_reps enable row level security;
alter table ops_mkt.referrals  enable row level security;

-- **One predicate, written once, at the start.** Accounting pays these
-- commissions and has to be able to see what is owed; marketing records them.
-- Procurement's `items_read` needed four additive policies bolted on from the
-- outside before anybody counted (F111), and the difference is only that this
-- table was written after that finding rather than before it.
create policy reps_read on ops_mkt.sales_reps for select to authenticated
  using (ops_core.has_permission('marketing.read') or ops_core.has_permission('accounting.read'));
create policy referrals_read on ops_mkt.referrals for select to authenticated
  using (ops_core.has_permission('marketing.read') or ops_core.has_permission('accounting.read'));

create policy reps_new  on ops_mkt.sales_reps for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy reps_edit on ops_mkt.sales_reps for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));
create policy referrals_new  on ops_mkt.referrals for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy referrals_edit on ops_mkt.referrals for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));

-- No DELETE policy and no DELETE grant (A2). An introduction that came to
-- nothing is `LOST` with a reason, which is a fact; removing the row is how a
-- conversion rate improves by forgetting.

alter view ops_mkt.v_referral     set (security_invoker = on);
alter view ops_mkt.v_rep          set (security_invoker = on);
alter view ops_prod.v_wo_materials  set (security_invoker = on);
alter view ops_prod.v_project_cost set (security_invoker = on);

grant usage on schema ops_mkt to authenticated;
grant select on all tables in schema ops_mkt to authenticated;
grant insert, update on ops_mkt.sales_reps, ops_mkt.referrals to authenticated;
