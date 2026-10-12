-- 0265_procure_factory_outcomes.sql — what became of a factory order after it
-- arrived: accepted or rejected by the client, the client's claims, and the
-- three-month reminder (O8, kajian F255 §5.8, D412, D421).
--
-- Every factory order (O3: a PO with a project) has a work state, read from
-- what is already recorded, plus one decision a person makes:
--
--   ORDER_DRAFT     not issued yet
--   IN_PRODUCTION   issued, no container recorded from it yet (QC reports, O7)
--   SHIPPED         a container recorded (O5), not all of them arrived
--   ARRIVED         every live container from it arrived (`mark_arrived`)
--   ACCEPTED        the client accepted the work — chosen by sales/leadership
--   REJECTED        the client rejected it, with the reason
--
-- **The reminder.** The day the last container arrived + 3 months is the
-- order's reminder; past it with no decision, the order is *perlu
-- dikonfirmasi*. A reminder, not a money clock: whether and when QC is paid
-- is decided outside the system, looking at this (D412).
--
-- **The decision** is a row in `factory_order_verdicts`, append-only: the day,
-- the person on the client's side, the reason when rejected. A later row
-- replaces it (a client who rejects and then accepts after rework), and the
-- earlier one stays for the evaluation (O9). Recorded by `project.update`.
--
-- **Client claims** are 0264's findings with phase `after_arrival`, raised by
-- the coordinator or `project.update` — the same table as findings before
-- shipping, so the evaluation compares the two. This migration only counts
-- them per order.
--
-- Read by whoever reads the project (`project.read`), procurement and QC's
-- leadership — through a definer function, because a project reader does not
-- read purchase orders; it answers the order's name, factory, dates and
-- counts, never a price.

-- ── 1. the decision ───────────────────────────────────────────────────────

create table if not exists ops_procure.factory_order_verdicts (
  id             uuid primary key default gen_random_uuid(),
  -- The order decisions were recorded in: two in one transaction share
  -- `recorded_at`, and the later one must still win.
  seq            bigint generated always as identity,
  po_id          uuid not null references ops_procure.purchase_orders(id),
  verdict        text not null check (verdict in ('ACCEPTED','REJECTED')),
  decided_on     date not null,
  client_person  text not null check (btrim(client_person) <> ''),
  reason         text,
  note           text,
  recorded_by    uuid,
  recorded_at    timestamptz not null default now(),
  constraint factory_verdict_rejected_says_why check (verdict <> 'REJECTED' or nullif(btrim(reason), '') is not null)
);
create index if not exists factory_order_verdicts_po_idx on ops_procure.factory_order_verdicts (po_id, seq desc);

alter table ops_procure.factory_order_verdicts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops_procure' and policyname = 'factory_order_verdicts_read') then
    create policy factory_order_verdicts_read on ops_procure.factory_order_verdicts for select
      using (ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read') or ops_qc.sees_all());
  end if;
end $$;
grant select on ops_procure.factory_order_verdicts to authenticated;

-- ── 2. what is read ───────────────────────────────────────────────────────

-- Every live factory order with its work state, its containers, its reminder,
-- its decision, and its findings before shipping against claims after.
create or replace function ops_procure.factory_outcomes(p_project_code text default null)
returns table (
  po_no text, po_status ops_procure.po_status_t, project_code text, project_name text, client_name text,
  vendor_name text, issued_at timestamptz, expected_delivery date,
  container_count int, containers_arrived int, first_arrived_on date, last_arrived_on date,
  work_state text, reminder_on date, days_to_reminder int, needs_confirmation boolean,
  verdict text, verdict_on date, verdict_client_person text, verdict_reason text,
  verdict_recorded_by text, verdict_recorded_at timestamptz,
  findings_before int, findings_before_open int, claims_total int, claims_open int, qc_names text)
language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
  with o as (
    select p.id, p.po_no, p.status, pj.code, pj.name as pname, coalesce(c.name, pj.client_name) as cname,
           v.name as vname, p.issued_at, p.expected_delivery,
           k.n, k.arrived, k.first_on, k.last_on,
           fv.verdict, fv.decided_on, fv.client_person, fv.reason, u.full_name as by_name, fv.recorded_at
      from ops_procure.purchase_orders p
      join ops_procure.projects pj on pj.id = p.project_id
      left join ops_procure.clients c on c.id = pj.client_id
      join ops_procure.vendors v on v.id = p.vendor_id
      left join lateral (
        select count(*)::int as n,
               count(*) filter (where d.status = 'ARRIVED')::int as arrived,
               min(ops_core.office_day(d.received_at)) filter (where d.status = 'ARRIVED') as first_on,
               max(ops_core.office_day(d.received_at)) filter (where d.status = 'ARRIVED') as last_on
          from ops_dlv.deliveries d
         where d.po_id = p.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED') k on true
      left join lateral (
        select x.verdict, x.decided_on, x.client_person, x.reason, x.recorded_by, x.recorded_at
          from ops_procure.factory_order_verdicts x
         where x.po_id = p.id
         order by x.seq desc
         limit 1) fv on true
      left join ops_core.users u on u.id = fv.recorded_by
     where p.status <> 'CANCELLED'
       and (p_project_code is null or pj.code = btrim(p_project_code))
       and (ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read') or ops_qc.sees_all())
  ), s as (
    select o.*,
           case when o.n > 0 and o.arrived = o.n then o.last_on end as all_arrived_on
      from o
  )
  select s.po_no, s.status, s.code, s.pname, s.cname, s.vname, s.issued_at, s.expected_delivery,
         s.n, s.arrived, s.first_on, s.all_arrived_on,
         case when s.verdict is not null then s.verdict
              when s.all_arrived_on is not null then 'ARRIVED'
              when s.n > 0 then 'SHIPPED'
              when s.status = 'DRAFT' then 'ORDER_DRAFT'
              else 'IN_PRODUCTION' end,
         (s.all_arrived_on + interval '3 months')::date,
         case when s.all_arrived_on is not null
              then (s.all_arrived_on + interval '3 months')::date - ops_core.office_day() end,
         s.verdict is null and s.all_arrived_on is not null
           and ops_core.office_day() >= (s.all_arrived_on + interval '3 months')::date,
         s.verdict, s.decided_on, s.client_person, s.reason, s.by_name, s.recorded_at,
         (select count(*)::int from ops_qc.qc_findings f where f.po_id = s.id and f.phase <> 'after_arrival'),
         (select count(*)::int from ops_qc.qc_findings f where f.po_id = s.id and f.phase <> 'after_arrival' and f.status = 'OPEN'),
         (select count(*)::int from ops_qc.qc_findings f where f.po_id = s.id and f.phase = 'after_arrival'),
         (select count(*)::int from ops_qc.qc_findings f where f.po_id = s.id and f.phase = 'after_arrival' and f.status = 'OPEN'),
         (select string_agg(x.name, ', ' order by x.name)
            from ops_qc.qc_assignments a join ops_qc.qc_people x on x.id = a.person_id
           where a.po_id = s.id and a.cancelled_at is null)
    from s
   order by s.code desc, s.po_no
$$;
revoke all on function ops_procure.factory_outcomes(text) from public;
grant execute on function ops_procure.factory_outcomes(text) to authenticated;

-- Every decision on one order, newest first — what the client said, and
-- when it changed.
create or replace function ops_procure.factory_verdict_history(p_po_no text)
returns table (verdict text, decided_on date, client_person text, reason text, note text,
               recorded_by text, recorded_at timestamptz)
language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
  select x.verdict, x.decided_on, x.client_person, x.reason, x.note, u.full_name, x.recorded_at
    from ops_procure.factory_order_verdicts x
    join ops_procure.purchase_orders p on p.id = x.po_id
    left join ops_core.users u on u.id = x.recorded_by
   where p.po_no = btrim(p_po_no)
     and (ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read') or ops_qc.sees_all())
   order by x.seq desc
$$;
revoke all on function ops_procure.factory_verdict_history(text) from public;
grant execute on function ops_procure.factory_verdict_history(text) to authenticated;

-- ── 3. the seam ───────────────────────────────────────────────────────────

-- Accepted or rejected by the client: the day, who said it on their side,
-- why when rejected. Only once something has arrived; a container still at
-- sea is said, not refused. The same decision again is a noop; a different
-- one replaces the last and is said.
create or replace function ops_procure.record_client_verdict(
  p_po_no text, p_verdict text, p_decided_on date, p_client_person text,
  p_reason text default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
declare
  po ops_procure.purchase_orders; v_verdict text; v_first date; v_n int; v_arrived int;
  v_last ops_procure.factory_order_verdicts; v_warn jsonb := '[]'::jsonb; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('procurement','record_client_verdict', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('procurement','factory_order', p_po_no,'verdict',
      'not_permitted','Keputusan klien atas order pabrik dicatat oleh pengelola proyek (project update).');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = btrim(p_po_no);
  if not found or po.project_id is null then
    return ops_core.invalid('procurement','factory_order', p_po_no,'verdict', 'order_unknown',
      format('Tidak ada order pabrik %s.', coalesce(p_po_no, '—')), jsonb_build_object('field','po_no'));
  end if;
  if po.status = 'CANCELLED' then
    return ops_core.conflict('procurement','factory_order', po.po_no,'verdict', 'order_cancelled',
      format('%s sudah dibatalkan.', po.po_no));
  end if;
  v_verdict := upper(btrim(coalesce(p_verdict, '')));
  if v_verdict not in ('ACCEPTED','REJECTED') then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'unknown_verdict',
      'Diterima atau ditolak klien?', jsonb_build_object('field','verdict'));
  end if;

  select count(*), count(*) filter (where d.status = 'ARRIVED'),
         min(ops_core.office_day(d.received_at)) filter (where d.status = 'ARRIVED')
    into v_n, v_arrived, v_first
    from ops_dlv.deliveries d
   where d.po_id = po.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED';
  if coalesce(v_arrived, 0) = 0 then
    return ops_core.conflict('procurement','factory_order', po.po_no,'verdict', 'not_arrived',
      format('Belum ada kontainer %s yang sampai di klien. Keputusan klien dicatat setelah barang sampai.', po.po_no));
  end if;
  if v_arrived < v_n then
    v_warn := v_warn || to_jsonb(format('%s dari %s kontainer %s belum sampai.', v_n - v_arrived, v_n, po.po_no));
  end if;

  if p_decided_on is null then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'date_required',
      'Tanggal berapa klien memutuskan?', jsonb_build_object('field','decided_on'));
  end if;
  if p_decided_on > ops_core.office_day() then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'date_in_future',
      'Keputusan tidak bisa untuk hari yang belum datang.', jsonb_build_object('field','decided_on'));
  end if;
  if p_decided_on < v_first then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'before_arrival',
      format('Kontainer pertama sampai %s; keputusan klien tidak bisa sebelum itu.', v_first),
      jsonb_build_object('field','decided_on'));
  end if;
  if nullif(btrim(p_client_person), '') is null then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'client_person_required',
      'Siapa di pihak klien yang memutuskan?', jsonb_build_object('field','client_person'));
  end if;
  if v_verdict = 'REJECTED' and nullif(btrim(p_reason), '') is null then
    return ops_core.invalid('procurement','factory_order', po.po_no,'verdict', 'reason_required',
      'Kenapa ditolak klien? Alasannya dibaca saat evaluasi.', jsonb_build_object('field','reason'));
  end if;

  select * into v_last from ops_procure.factory_order_verdicts x
   where x.po_id = po.id order by x.seq desc limit 1;
  if v_last.id is not null and v_last.verdict = v_verdict and v_last.decided_on = p_decided_on
     and v_last.client_person = btrim(p_client_person)
     and v_last.reason is not distinct from nullif(btrim(p_reason), '') then
    return ops_core.noop('procurement','factory_order', po.po_no,'verdict', 'sudah tercatat',
      jsonb_build_object('po_no', po.po_no, 'verdict', v_verdict, 'warnings', v_warn));
  end if;
  if v_last.id is not null then
    v_warn := v_warn || to_jsonb(format('Menggantikan keputusan sebelumnya (%s, %s, %s); yang lama tetap tercatat.',
      case v_last.verdict when 'ACCEPTED' then 'diterima' else 'ditolak' end, v_last.decided_on, v_last.client_person));
  end if;

  insert into ops_procure.factory_order_verdicts (po_id, verdict, decided_on, client_person, reason, note, recorded_by)
  values (po.id, v_verdict, p_decided_on, btrim(p_client_person), nullif(btrim(p_reason), ''), nullif(btrim(p_note), ''), auth.uid());

  perform ops_core.emit('procurement', case v_verdict when 'ACCEPTED' then 'factory_order.accepted' else 'factory_order.rejected' end,
    po.po_no, jsonb_build_object('po_no', po.po_no, 'verdict', v_verdict, 'decided_on', p_decided_on,
                                 'client_person', btrim(p_client_person), 'reason', nullif(btrim(p_reason), '')));
  res := ops_core.ok('procurement','factory_order', po.po_no,'verdict',
    jsonb_build_object('po_no', po.po_no, 'verdict', v_verdict, 'warnings', v_warn));
  return ops_core.idem_remember('procurement','record_client_verdict', p_key, res);
end $$;
revoke all on function ops_procure.record_client_verdict(text, text, date, text, text, text, text) from public;
grant execute on function ops_procure.record_client_verdict(text, text, date, text, text, text, text) to authenticated;

analyze ops_procure.factory_order_verdicts;
