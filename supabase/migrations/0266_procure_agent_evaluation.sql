-- 0266_procure_agent_evaluation.sql — the evaluation boards: partner
-- factories, QC people, projects (O9, kajian F255 §5.9).
--
-- Nothing here is typed. Every number is read from what O2–O8 already
-- record, dated and sourced, so the boards are only ever as old as the last
-- report, container or decision:
--
--   factories  factory orders (this year and all), quoted price against the
--              price ordered, shipped on time against the factory's promise
--              (first container out vs the order's promised day), findings
--              per container before shipping, claims after arrival, orders
--              the client accepted or rejected
--   QC people  assignments and orders, days with a report out of days on the
--              job, containers out of their orders while they watched,
--              findings they raised, claims that reached the client on their
--              orders, orders accepted or rejected
--   projects   how long each stage took — inquiry → deal → production →
--              shipped → arrived — the client's decisions and claims on its
--              factory orders, the accepted quotation and, for whoever holds
--              `project.update`, its margin
--
-- Read through definer functions in `ops_procure`: they join purchase orders,
-- QC and deliveries, which no single reader reads all of, and each answers
-- only who may see that board — prices for procurement and leadership, QC for
-- those who see every assignment, durations for whoever reads projects. In
-- `ops_procure`, not `ops_qc`, so the boards open where the project screens
-- already do.

-- ── 1. factories ──────────────────────────────────────────────────────────

create or replace function ops_procure.eval_factories(p_year int default null)
returns table (
  vendor_code text, vendor_name text, vendor_kind text,
  orders int, orders_in_year int,
  priced_lines int, price_diff_pct numeric,
  promised_shipped int, shipped_on_time int, avg_days_late numeric,
  containers int, findings_before int, findings_serious int, findings_per_container numeric,
  claims int, orders_accepted int, orders_rejected int)
language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
  with po as (
    select p.id, p.vendor_id, p.currency, p.expected_delivery, p.issued_at, p.created_at
      from ops_procure.purchase_orders p
     where p.project_id is not null and p.status <> 'CANCELLED'
       and (ops_core.has_permission('procurement.read') or ops_core.has_permission('project.update'))
  ), first_out as (
    select po.id, po.vendor_id, po.expected_delivery,
           (select min(d.dispatched_on) from ops_dlv.deliveries d
             where d.po_id = po.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED') as out_on
      from po
  ), priced as (
    select po.vendor_id, (o.unit_price - fp.unit_price) / fp.unit_price * 100 as diff
      from po
      join ops_procure.po_lines o on o.po_id = po.id and o.superseded_by is null
      join ops_procure.project_lines pl on pl.id = o.project_line_id
      cross join lateral ops_procure.factory_price_of(pl.design_item_id, po.vendor_id) fp
     where pl.design_item_id is not null and fp.currency = po.currency and fp.unit_price > 0
  ), latest as (
    select distinct on (x.po_id) x.po_id, x.verdict
      from ops_procure.factory_order_verdicts x join po on po.id = x.po_id
     order by x.po_id, x.seq desc
  )
  select v.code, v.name, v.kind::text,
         (select count(*)::int from po where po.vendor_id = v.id),
         (select count(*)::int from po where po.vendor_id = v.id
             and extract(year from ops_core.office_day(coalesce(po.issued_at, po.created_at)))
                 = coalesce(p_year, extract(year from ops_core.office_day())::int)),
         (select count(*)::int from priced where priced.vendor_id = v.id),
         (select round(avg(priced.diff), 1) from priced where priced.vendor_id = v.id),
         (select count(*)::int from first_out f where f.vendor_id = v.id and f.out_on is not null and f.expected_delivery is not null),
         (select count(*)::int from first_out f where f.vendor_id = v.id and f.out_on <= f.expected_delivery),
         (select round(avg(f.out_on - f.expected_delivery), 1) from first_out f
           where f.vendor_id = v.id and f.out_on > f.expected_delivery),
         k.n,
         q.before_n, q.serious_n,
         case when k.n > 0 then round(q.before_n::numeric / k.n, 2) end,
         q.claims_n,
         (select count(*)::int from latest l join po on po.id = l.po_id where po.vendor_id = v.id and l.verdict = 'ACCEPTED'),
         (select count(*)::int from latest l join po on po.id = l.po_id where po.vendor_id = v.id and l.verdict = 'REJECTED')
    from ops_procure.vendors v
    cross join lateral (
      select count(*)::int as n from ops_dlv.deliveries d join po on po.id = d.po_id
       where po.vendor_id = v.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED') k
    cross join lateral (
      select count(*) filter (where f.phase <> 'after_arrival')::int as before_n,
             count(*) filter (where f.phase <> 'after_arrival' and f.severity in ('major','critical'))::int as serious_n,
             count(*) filter (where f.phase = 'after_arrival')::int as claims_n
        from ops_qc.qc_findings f join po on po.id = f.po_id
       where po.vendor_id = v.id) q
   where (v.kind = 'factory' or exists (select 1 from po where po.vendor_id = v.id))
     and (ops_core.has_permission('procurement.read') or ops_core.has_permission('project.update'))
   order by 4 desc, v.name
$$;
revoke all on function ops_procure.eval_factories(int) from public;
grant execute on function ops_procure.eval_factories(int) to authenticated;

-- ── 2. QC people ──────────────────────────────────────────────────────────

create or replace function ops_procure.eval_qc_people()
returns table (
  person_code text, person_name text, is_active boolean,
  assignments int, orders int, active_days int, report_days int, report_rate int, reports int,
  last_report_on date, containers_while_watching int,
  findings_raised int, findings_serious int, claims_on_orders int,
  orders_accepted int, orders_rejected int)
language sql stable security definer
set search_path = ops_procure, ops_qc, ops_core, pg_temp
as $$
  with a as (
    select x.id, x.person_id, x.po_id, x.starts_on,
           least(coalesce(x.ends_on, ops_core.office_day()), ops_core.office_day()) as until_on
      from ops_qc.qc_assignments x
     where x.cancelled_at is null and ops_qc.sees_all()
  ), r as (
    select a.person_id, rp.report_date
      from ops_qc.qc_reports rp join a on a.id = rp.assignment_id
     where rp.cancelled_at is null
  ), latest as (
    select distinct on (x.po_id) x.po_id, x.verdict
      from ops_procure.factory_order_verdicts x
     where x.po_id in (select a.po_id from a)
     order by x.po_id, x.seq desc
  )
  select p.code, p.name, p.is_active,
         (select count(*)::int from a where a.person_id = p.id),
         (select count(distinct a.po_id)::int from a where a.person_id = p.id),
         coalesce((select sum(greatest(0, a.until_on - a.starts_on + 1))::int from a where a.person_id = p.id), 0),
         (select count(distinct r.report_date)::int from r where r.person_id = p.id),
         (select case when sum(greatest(0, a.until_on - a.starts_on + 1)) > 0
                      then round(100.0 * (select count(distinct r.report_date) from r where r.person_id = p.id)
                                 / sum(greatest(0, a.until_on - a.starts_on + 1)))::int end
            from a where a.person_id = p.id),
         (select count(*)::int from r where r.person_id = p.id),
         (select max(r.report_date) from r where r.person_id = p.id),
         (select count(distinct d.id)::int from a join ops_dlv.deliveries d on d.po_id = a.po_id
           where a.person_id = p.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED'
             and d.dispatched_on between a.starts_on and a.until_on),
         (select count(*)::int from ops_qc.qc_findings f join a on a.id = f.assignment_id
           where a.person_id = p.id and f.phase <> 'after_arrival'),
         (select count(*)::int from ops_qc.qc_findings f join a on a.id = f.assignment_id
           where a.person_id = p.id and f.phase <> 'after_arrival' and f.severity in ('major','critical')),
         (select count(*)::int from ops_qc.qc_findings f
           where f.phase = 'after_arrival' and f.po_id in (select a.po_id from a where a.person_id = p.id)),
         (select count(*)::int from latest l where l.verdict = 'ACCEPTED' and l.po_id in (select a.po_id from a where a.person_id = p.id)),
         (select count(*)::int from latest l where l.verdict = 'REJECTED' and l.po_id in (select a.po_id from a where a.person_id = p.id))
    from ops_qc.qc_people p
   where ops_qc.sees_all()
   order by p.is_active desc, p.name
$$;
revoke all on function ops_procure.eval_qc_people() from public;
grant execute on function ops_procure.eval_qc_people() to authenticated;

-- ── 3. projects ───────────────────────────────────────────────────────────

-- How long each stage took, from the logged moves (0111) and the deliveries:
-- opened → deal → production → first shipped → all arrived. A stage not yet
-- reached is null, never guessed.
create or replace function ops_procure.eval_projects()
returns table (
  project_code text, project_name text, client_name text, status text,
  opened_on date, deal_on date, production_on date, shipped_on date, arrived_on date, done_on date,
  days_to_deal int, days_to_production int, days_to_ship int, days_to_arrive int,
  factory_orders int, orders_accepted int, orders_rejected int, claims int,
  deal_value numeric, deal_currency text, margin_pct numeric)
language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
  with pj as (
    select p.id, p.code, p.name, coalesce(c.name, p.client_name) as cname, p.status::text as st,
           ops_core.office_day(p.created_at) as opened,
           (select ops_core.office_day(min(l.changed_at)) from ops_procure.project_status_log l
             where l.project_id = p.id and l.to_status in ('DEAL','IN_PRODUCTION','SHIPPED','DONE')) as deal,
           (select ops_core.office_day(min(l.changed_at)) from ops_procure.project_status_log l
             where l.project_id = p.id and l.to_status in ('IN_PRODUCTION','SHIPPED','DONE')) as prod,
           (select ops_core.office_day(min(l.changed_at)) from ops_procure.project_status_log l
             where l.project_id = p.id and l.to_status = 'DONE') as done,
           (select min(d.dispatched_on) from ops_dlv.deliveries d
             where d.project_code = p.code and d.status <> 'CANCELLED') as shipped,
           (select case when count(*) > 0 and count(*) = count(*) filter (where d.status = 'ARRIVED')
                        then max(ops_core.office_day(d.received_at)) end
              from ops_dlv.deliveries d where d.project_code = p.code and d.status <> 'CANCELLED') as arrived
      from ops_procure.projects p
      left join ops_procure.clients c on c.id = p.client_id
     where ops_core.has_permission('project.read')
  ), fo as (
    select po.project_id, po.id
      from ops_procure.purchase_orders po
     where po.project_id is not null and po.status <> 'CANCELLED'
  ), latest as (
    select distinct on (x.po_id) x.po_id, x.verdict
      from ops_procure.factory_order_verdicts x
     order by x.po_id, x.seq desc
  )
  select pj.code, pj.name, pj.cname, pj.st,
         pj.opened, pj.deal, pj.prod, pj.shipped, pj.arrived, pj.done,
         pj.deal - pj.opened, pj.prod - pj.deal, pj.shipped - pj.prod, pj.arrived - pj.shipped,
         (select count(*)::int from fo where fo.project_id = pj.id),
         (select count(*)::int from latest l join fo on fo.id = l.po_id where fo.project_id = pj.id and l.verdict = 'ACCEPTED'),
         (select count(*)::int from latest l join fo on fo.id = l.po_id where fo.project_id = pj.id and l.verdict = 'REJECTED'),
         (select count(*)::int from ops_qc.qc_findings f join fo on fo.id = f.po_id
           where fo.project_id = pj.id and f.phase = 'after_arrival'),
         q.grand_total, q.currency,
         -- The accepted quotation's margin over its own costs, for whoever
         -- sees costs (0133: `v_quotation_line` hides them from everyone else).
         case when ops_core.has_permission('project.update') then
           (select round(100 * (sum(ql.qty * ql.unit_price) - sum(ql.qty * ql.unit_cost)) / nullif(sum(ql.qty * ql.unit_price), 0), 1)
              from ops_procure.v_quotation_line ql
             where ql.quotation_id = q.id and ql.unit_cost is not null and ql.unit_price is not null)
         end
    from pj
    left join lateral (
      select vq.id, vq.grand_total, vq.currency
        from ops_procure.v_quotation vq
       where vq.project_id = pj.id and vq.status = 'ACCEPTED'
       order by vq.decided_at desc
       limit 1) q on true
   order by pj.code desc
$$;
revoke all on function ops_procure.eval_projects() from public;
grant execute on function ops_procure.eval_projects() to authenticated;
