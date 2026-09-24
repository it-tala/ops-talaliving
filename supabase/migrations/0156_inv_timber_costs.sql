-- 0156_inv_timber_costs.sql — what the wood cost once it was in the yard.
--
-- `0070` priced a load by its invoice alone. The owner's question is wider
-- (2026-09-24): per vendor, **what does a cubic metre — and a square metre —
-- of board cost**, with the transport, the sawing and everything else that
-- was paid to get it onto the rack. Those arrive on **separate notas** from
-- other people (a trucker, a sawmill), often days after the load, so they are
-- rows of their own against the load and never folded into `total_cost`:
-- the timber invoice stays what the timber seller billed, and the difference
-- between *paper price* and *landed price* is kept visible rather than lost.
--
-- Two corrections to `0070` ride along, both to agree with the demo's
-- derivation, which is the specification (`src/demo/inventory-derive.ts`):
--
--   **A load bought as boards** — the nota lists sizes, no logs — had no
--   price per m³ of board at all, because every figure divided by `log_m3`,
--   and `v_timber_by_vendor` dropped it (`where log_m3 > 0`). Such a load's
--   whole invoice is its boards.
--
--   **Boards reported with no log marked sawn** — the ordinary day's pile —
--   read as 0 rupiah per m³ of board. The demo takes that pile to mean the
--   load was sawn; so does this, through one column, `sawn_basis_m3`.

insert into ops_core.doc_prefixes (prefix, what) values ('kyb', 'timber cost')
  on conflict (prefix) do nothing;

create table ops_inv.log_costs (
  id            uuid primary key default gen_random_uuid(),
  cost_no       text not null unique default ops_core.next_doc_number('kyb'),
  purchase_id   uuid not null references ops_inv.log_purchases(id),
  -- Transport, sawing, unloading, anything else. Four words the workshop uses;
  -- `lain` carries the rest with a note rather than growing the list.
  kind          text not null check (kind in ('angkut', 'potong', 'bongkar', 'lain')),
  amount        bigint not null check (amount > 0),
  incurred_on   date not null,
  -- Who was paid. A trucker is often nobody in the vendor list, so the name is
  -- free text; the vendor code is there for when they are (ADR-004).
  payee         text,
  vendor_code   text,
  -- The ledger row that paid, by public code, optional for the same reason
  -- the load's own is (A6).
  trx_no        text,
  note          text,
  created_by    uuid references ops_core.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index log_costs_purchase_idx on ops_inv.log_costs (purchase_id);

alter table ops_inv.log_costs enable row level security;

create policy log_costs_read on ops_inv.log_costs for select to authenticated
  using ((select ops_core.has_permission('inventory.read')));
-- Insert and update, never delete — the same rule as the logs themselves (A2).
create policy log_costs_new  on ops_inv.log_costs for insert to authenticated
  with check ((select ops_core.has_permission('inventory.create')));
create policy log_costs_edit on ops_inv.log_costs for update to authenticated
  using ((select ops_core.has_permission('inventory.update')))
  with check ((select ops_core.has_permission('inventory.update')));

grant select, insert, update on ops_inv.log_costs to authenticated;

-- ── per load ──────────────────────────────────────────────────────────────
--
-- Every column `0070` returned, in its order, then the new ones after — the
-- only change `create or replace view` allows, and `0094` reads this view.
create or replace view ops_inv.v_log_purchase as
select
  p.*,
  v.name as vendor_name,
  round(coalesce(pc.log_m3, 0), 4)        as log_m3,
  round(coalesce(pc.sawn_logs_m3, 0), 4)  as sawn_logs_m3,
  round(coalesce(pc.log_m3, 0) - bs.basis_m3, 4) as unsawn_m3,
  pc.pieces,
  pc.pieces_sawn,
  round(coalesce(b.sawn_m3, 0), 4)        as sawn_m3,
  -- Over the logs actually sawn (D153).
  case when bs.basis_m3 > 0 and coalesce(b.sawn_m3, 0) > 0
    then round(b.sawn_m3 / bs.basis_m3 * 100)::int end as yield_percent,
  case when coalesce(pc.log_m3, 0) > 0
    then round(p.total_cost / pc.log_m3)::bigint end as cost_per_log_m3,
  -- Their share of the invoice (D153) — all of it, for a load bought as boards.
  case when coalesce(b.sawn_m3, 0) > 0
    then round(p.total_cost * bs.share / b.sawn_m3)::bigint end as cost_per_sawn_m3,
  case when p.claimed_m3 is not null
    then round(coalesce(pc.log_m3, 0) - p.claimed_m3, 4) end as claimed_gap_m3,
  n.entity_no is not null as has_nota,
  -- ── 0156 ──
  round(bs.basis_m3, 4)                   as sawn_basis_m3,
  round(coalesce(b.sawn_m2, 0), 4)        as sawn_m2,
  coalesce(c.angkut, 0)::bigint           as cost_angkut,
  coalesce(c.potong, 0)::bigint           as cost_potong,
  coalesce(c.bongkar, 0)::bigint          as cost_bongkar,
  coalesce(c.lain, 0)::bigint             as cost_lain,
  coalesce(c.total, 0)::bigint            as extra_cost,
  (p.total_cost + coalesce(c.total, 0))::bigint as landed_cost,
  case when coalesce(pc.log_m3, 0) > 0
    then round((p.total_cost + coalesce(c.total, 0)) / pc.log_m3)::bigint end
    as landed_cost_per_log_m3,
  -- The same share rule as `cost_per_sawn_m3`: the transport of two sticks
  -- still in the yard has not been paid for by these boards either.
  case when coalesce(b.sawn_m3, 0) > 0
    then round((p.total_cost + coalesce(c.total, 0)) * bs.share / b.sawn_m3)::bigint end
    as landed_cost_per_sawn_m3,
  -- By board face, width × length, every thickness together — the owner's
  -- measure (2026-09-24). Only comparable between loads sawn to similar
  -- thicknesses, which the screen says.
  case when coalesce(b.sawn_m2, 0) > 0
    then round((p.total_cost + coalesce(c.total, 0)) * bs.share / b.sawn_m2)::bigint end
    as landed_cost_per_sawn_m2
from ops_inv.log_purchases p
left join ops_procure.vendors v on v.code = p.vendor_code
left join lateral (
  select
    count(*)::int                                                        as pieces,
    count(*) filter (where sawn_on is not null)::int                     as pieces_sawn,
    sum(ops_inv.log_volume_m3(p.measure, diameter_cm, length_cm))        as log_m3,
    sum(ops_inv.log_volume_m3(p.measure, diameter_cm, length_cm))
      filter (where sawn_on is not null)                                 as sawn_logs_m3
  from ops_inv.log_pieces lp where lp.purchase_id = p.id
) pc on true
left join lateral (
  select sum((thickness_mm / 1000.0) * (width_mm / 1000.0) * (length_mm / 1000.0) * qty) as sawn_m3,
         sum((width_mm / 1000.0) * (length_mm / 1000.0) * qty)                          as sawn_m2
  from ops_inv.sawn_boards sb where sb.purchase_id = p.id
) b on true
cross join lateral (
  -- Which logs the boards came from, and so which share of the bill they
  -- carry. Logs marked sawn when any are; the whole load when boards were
  -- reported as a pile; the whole invoice when the load was bought as boards.
  select
    case when coalesce(pc.sawn_logs_m3, 0) > 0 then pc.sawn_logs_m3
         when coalesce(b.sawn_m3, 0) > 0 then coalesce(pc.log_m3, 0)
         else 0 end as basis_m3,
    case when coalesce(pc.log_m3, 0) = 0 then 1
         when coalesce(pc.sawn_logs_m3, 0) > 0 then pc.sawn_logs_m3 / pc.log_m3
         else 1 end as share
) bs
left join lateral (
  select
    sum(amount) filter (where kind = 'angkut')  as angkut,
    sum(amount) filter (where kind = 'potong')  as potong,
    sum(amount) filter (where kind = 'bongkar') as bongkar,
    sum(amount) filter (where kind = 'lain')    as lain,
    sum(amount)                                 as total
  from ops_inv.log_costs lc where lc.purchase_id = p.id
) c on true
left join lateral (
  select l.entity_no from ops_core.attachment_links l
   where l.entity = 'log_purchase' and l.entity_no = p.purchase_no
     and l.kind = 'nota' and l.unlinked_at is null limit 1
) n on true;

-- ── per vendor, per species ───────────────────────────────────────────────
--
-- Within one species only (D153). Built from each load's own share, so a
-- partly sawn load contributes only what its cut logs carry.
create or replace view ops_inv.v_timber_by_vendor as
select
  p.vendor_code,
  max(p.vendor_name)                          as vendor_name,
  p.species,
  count(*)::int                               as loads,
  sum(p.total_cost)::bigint                   as total_cost,
  round(sum(p.log_m3), 4)                     as log_m3,
  round(sum(p.sawn_logs_m3), 4)               as sawn_logs_m3,
  round(sum(p.sawn_m3), 4)                    as sawn_m3,
  case when sum(p.sawn_basis_m3) > 0 and sum(p.sawn_m3) > 0
    then round(sum(p.sawn_m3) filter (where p.sawn_basis_m3 > 0)
             / sum(p.sawn_basis_m3) * 100)::int end as yield_percent,
  case when sum(p.log_m3) > 0
    then round(sum(p.total_cost) filter (where p.log_m3 > 0) / sum(p.log_m3))::bigint end
    as cost_per_log_m3,
  case when sum(p.sawn_m3) > 0
    then round(sum(p.cost_per_sawn_m3 * p.sawn_m3) / sum(p.sawn_m3))::bigint end
    as cost_per_sawn_m3,
  -- ── 0156 ──
  round(sum(p.unsawn_m3), 4)                  as unsawn_m3,
  round(sum(p.sawn_m2), 4)                    as sawn_m2,
  sum(p.cost_angkut)::bigint                  as cost_angkut,
  sum(p.cost_potong)::bigint                  as cost_potong,
  sum(p.cost_bongkar)::bigint                 as cost_bongkar,
  sum(p.cost_lain)::bigint                    as cost_lain,
  sum(p.extra_cost)::bigint                   as extra_cost,
  sum(p.landed_cost)::bigint                  as landed_cost,
  case when sum(p.log_m3) > 0
    then round(sum(p.landed_cost) filter (where p.log_m3 > 0) / sum(p.log_m3))::bigint end
    as landed_cost_per_log_m3,
  case when sum(p.sawn_m3) > 0
    then round(sum(p.landed_cost_per_sawn_m3 * p.sawn_m3) / sum(p.sawn_m3))::bigint end
    as landed_cost_per_sawn_m3,
  case when sum(p.sawn_m2) > 0
    then round(sum(p.landed_cost_per_sawn_m2 * p.sawn_m2) / sum(p.sawn_m2))::bigint end
    as landed_cost_per_sawn_m2
from ops_inv.v_log_purchase p
where p.log_m3 > 0 or p.sawn_m3 > 0
group by p.vendor_code, p.species;

alter view ops_inv.v_log_purchase     set (security_invoker = on);
alter view ops_inv.v_timber_by_vendor set (security_invoker = on);
