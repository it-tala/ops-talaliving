-- 0257_procure_factory_orders.sql — the production route per order line, and
-- the factory order: a PO tied to a project (O3, kajian F255 §5.1/§5.4, D413,
-- D414, D416).
--
-- TALA finds the order; part of it is made in the workshop and part by a
-- partner factory (Q83). Until now a PO knew its vendor and nothing about the
-- project it served, so *who makes which item, at what price, by when* could
-- not be read from the project (G4).
--
--   project_lines.route         WORKSHOP (default — every existing line stays
--                               where it is) or FACTORY. A project may mix
--                               them. Set on the order card; a line on a live
--                               factory order cannot go back to the workshop,
--                               and a line with live Job Orders cannot go to a
--                               factory, until those are cancelled.
--   purchase_orders.project_id  the project a factory order is for.
--   purchase_orders.currency    IDR (default) or USD, with the kurs typed on
--   purchase_orders.fx_rate     the order (D414). A supplier PO stays rupiah.
--   po_lines.project_line_id    the client's order line this PO line makes.
--
-- `create_factory_order` raises the PO from FACTORY lines: one factory, its
-- price for each item (the chosen offer when it is this factory's, else this
-- factory's newest), the project line's quantity and unit. Everything after
-- that is the PO that already exists — leadership confirms it, procurement
-- issues it, amendments, the signed paper (§5.4). **ISSUED means the factory
-- has said yes**, and the first issued factory order moves the project to
-- IN_PRODUCTION, the way the first Job Order already does (0130).
--
-- **Money (D416).** A factory order's lines are in its own currency. Every
-- figure the payment side reads — `v_po_status.contract_value`, received,
-- credit, and so the terms, billable-now, vendor journey — is **rupiah at the
-- order's kurs**, so the payment and ledger machinery stays one currency. A
-- USD order cannot be issued without its kurs; the kurs is fixed once the
-- order is issued. The agent flow does not read payments (D412); a bank rate
-- that differs from the order's kurs is accounting's to settle (close_po's
-- reason).
--
-- `v_project_production` is the board per project: every order line with its
-- route, its Job Orders or its factory order, what was made and what arrived.
-- What a factory has finished is QC's number and arrives with O7.
--
-- Views keep every column they had, in order, and gain new ones last.
-- Applying to production: no drops, and no function body here removes rows.

-- ── 1. the route per order line ───────────────────────────────────────────

do $$ begin
  create type ops_procure.production_route_t as enum ('WORKSHOP','FACTORY');
exception when duplicate_object then null; end $$;

alter table ops_procure.project_lines
  add column if not exists route ops_procure.production_route_t not null default 'WORKSHOP';

-- ── 2. a PO tied to a project, in its own currency ────────────────────────

alter table ops_procure.purchase_orders
  add column if not exists project_id uuid references ops_procure.projects(id),
  add column if not exists currency text not null default 'IDR'
    constraint po_currency_known check (currency in ('IDR','USD')),
  -- Rupiah per 1 USD, typed by a person (D181, D414).
  add column if not exists fx_rate numeric constraint po_fx_positive check (fx_rate is null or fx_rate > 0);
create index if not exists purchase_orders_project_idx on ops_procure.purchase_orders (project_id)
  where project_id is not null;

alter table ops_procure.po_lines
  add column if not exists project_line_id uuid references ops_procure.project_lines(id);
create index if not exists po_lines_project_line_idx on ops_procure.po_lines (project_line_id)
  where project_line_id is not null;

-- A line total in the order's currency: to the rupiah, or to the cent.
create or replace function ops_procure.po_line_total(p_qty numeric, p_unit_price numeric, p_currency text)
returns numeric
language sql immutable as $$
  select round(p_qty * p_unit_price, case when p_currency = 'USD' then 2 else 0 end)
$$;
grant execute on function ops_procure.po_line_total(numeric, numeric, text) to authenticated;

-- The factory order a client's order line is on, for whoever may read the
-- project. Definer, so the board and the order card can say *on PO-… at CV …,
-- issued* to a reader who may not read purchase orders — it returns the
-- order's name, state and date, never a price.
create or replace function ops_procure.factory_order_of_line(p_line_id uuid)
returns table (po_no text, po_status ops_procure.po_status_t, vendor_code text, vendor_name text,
               expected_delivery date, issued_at timestamptz, ordered_qty numeric)
language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
  select p.po_no, p.status, v.code, v.name, p.expected_delivery, p.issued_at, o.qty
    from ops_procure.po_lines o
    join ops_procure.purchase_orders p on p.id = o.po_id
    join ops_procure.vendors v on v.id = p.vendor_id
   where o.project_line_id = p_line_id
     and o.superseded_by is null
     and p.status <> 'CANCELLED'
     and (ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read')
          or ops_core.has_permission('production.read') or ops_core.has_permission('delivery.read'))
   order by p.created_at desc
   limit 1
$$;
revoke all on function ops_procure.factory_order_of_line(uuid) from public;
grant execute on function ops_procure.factory_order_of_line(uuid) to authenticated;

-- This factory's price for a design item: the chosen offer when it is this
-- factory's, else its newest live one. Read by `create_factory_order`.
create or replace function ops_procure.factory_price_of(p_design_item_id uuid, p_vendor_id uuid)
returns table (line_id uuid, unit_price numeric, currency text)
language sql stable
set search_path = ops_procure, pg_temp
as $$
  select fl.id, fl.unit_price, fq.currency
    from ops_procure.factory_quote_lines fl
    join ops_procure.factory_quotes fq on fq.id = fl.quote_id
    join ops_procure.design_items di on di.id = fl.design_item_id
   where fl.design_item_id = p_design_item_id
     and fq.vendor_id = p_vendor_id
     and fq.voided_at is null
   order by (di.factory_line_id = fl.id) desc nulls last, fq.quoted_on desc, fq.created_at desc
   limit 1
$$;
grant execute on function ops_procure.factory_price_of(uuid, uuid) to authenticated;

-- ── 3. seams ──────────────────────────────────────────────────────────────

-- Workshop or factory, for one or more lines of a project. Whoever runs the
-- project decides, and procurement, who raises the factory order.
create or replace function ops_procure.set_line_route(p_project_code text, p_line_nos int[], p_route text)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
declare
  pr ops_procure.projects; v_route ops_procure.production_route_t; v_missing int;
  x record; n int;
begin
  if not (ops_core.has_permission('project.update') or ops_core.has_permission('procurement.update')) then
    return ops_core.refused('project','project', p_project_code,'route',
      'not_permitted','Memilih workshop atau pabrik untuk baris order perlu akses proyek atau procurement.');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'route','Proyek itu tidak ada.');
  end if;
  begin
    v_route := upper(btrim(p_route))::ops_procure.production_route_t;
  exception when invalid_text_representation then
    return ops_core.invalid('project','project', p_project_code,'route',
      'unknown_route', format('Jalur %s tidak dikenal: WORKSHOP atau FACTORY.', coalesce(p_route, '—')),
      jsonb_build_object('field','route'));
  end;
  if v_route is null then
    return ops_core.invalid('project','project', p_project_code,'route',
      'unknown_route','Pilih jalurnya: WORKSHOP atau FACTORY.', jsonb_build_object('field','route'));
  end if;
  if p_line_nos is null or cardinality(p_line_nos) = 0 then
    return ops_core.invalid('project','project', p_project_code,'route',
      'lines_required','Pilih baris order yang dipindah.', jsonb_build_object('field','lines'));
  end if;
  select u.want into v_missing
    from unnest(p_line_nos) u(want)
   where not exists (select 1 from ops_procure.project_lines l where l.project_id = pr.id and l.line_no = u.want)
   limit 1;
  if v_missing is not null then
    return ops_core.invalid('project','project', p_project_code,'route',
      'line_unknown', format('Baris %s tidak ada di proyek %s.', v_missing, p_project_code),
      jsonb_build_object('field','lines','line_no', v_missing));
  end if;

  -- What is already promised elsewhere stays where it is until it is undone.
  if v_route = 'WORKSHOP' then
    select l.line_no, p.po_no into x
      from ops_procure.project_lines l
      join ops_procure.po_lines o on o.project_line_id = l.id and o.superseded_by is null
      join ops_procure.purchase_orders p on p.id = o.po_id and p.status <> 'CANCELLED'
     where l.project_id = pr.id and l.line_no = any(p_line_nos)
     limit 1;
    if found then
      return ops_core.conflict('project','project', p_project_code,'route',
        'on_factory_order',
        format('Baris %s sudah dipesan ke pabrik di %s. Batalkan atau ubah order itu dulu.', x.line_no, x.po_no),
        jsonb_build_object('line_no', x.line_no, 'po_no', x.po_no));
    end if;
  else
    select l.line_no, w.wo_no into x
      from ops_procure.project_lines l
      join ops_prod.work_orders w on w.project_line_id = l.id and w.status <> 'CANCELLED'
     where l.project_id = pr.id and l.line_no = any(p_line_nos)
     limit 1;
    if found then
      return ops_core.conflict('project','project', p_project_code,'route',
        'has_job_orders',
        format('Baris %s sudah punya Job Order %s di workshop. Batalkan Job Order itu dulu.', x.line_no, x.wo_no),
        jsonb_build_object('line_no', x.line_no, 'wo_no', x.wo_no));
    end if;
  end if;

  update ops_procure.project_lines
     set route = v_route, updated_at = now()
   where project_id = pr.id and line_no = any(p_line_nos) and route <> v_route;
  get diagnostics n = row_count;
  if n = 0 then
    return ops_core.noop('project','project', p_project_code,'route',
      'baris itu sudah di jalur itu', jsonb_build_object('route', v_route));
  end if;

  perform ops_core.emit('project','project.lines.routed', p_project_code,
    jsonb_build_object('project_code', p_project_code, 'route', v_route, 'lines', to_jsonb(p_line_nos), 'changed', n));
  return ops_core.ok('project','project', p_project_code,'route',
    jsonb_build_object('route', v_route, 'changed', n));
end $$;
revoke all on function ops_procure.set_line_route(text, int[], text) from public;
grant execute on function ops_procure.set_line_route(text, int[], text) to authenticated;

-- A factory order from the project's FACTORY lines (§5.4). One factory per
-- order; a project may have several (Q84). p_lines:
--   [{ "line_no": 1, "qty": 4 (optional), "unit_price": 150 (optional) }]
-- Without a unit price the line takes this factory's price for its design
-- item, converted at the order's kurs when the offer was in the other
-- currency. Everything after this is the existing PO road.
create or replace function ops_procure.create_factory_order(
  p_project_code text, p_vendor_code text, p_lines jsonb,
  p_currency text default 'IDR', p_fx_rate numeric default null,
  p_expected_delivery date default null, p_note text default null,
  p_dp_percent numeric default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
declare
  pr ops_procure.projects; v ops_procure.vendors; v_cur text; v_fx numeric;
  x record; v_qty numeric; v_price numeric; v_dup text;
  v_offer numeric; v_offer_cur text;
  v_po_no text; v_po_id uuid; n int := 0; v_self boolean; v_same text;
  replayed jsonb; res jsonb;
  want jsonb := '[]'::jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_factory_order', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','purchase_order', null,'create_factory_order',
      'not_permitted','Membuat order pabrik perlu akses procurement.');
  end if;

  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'project_not_found', format('Tidak ada proyek %s.', coalesce(p_project_code, '—')),
      jsonb_build_object('field','project_code'));
  end if;
  if pr.status in ('LOST','CANCELLED') then
    return ops_core.conflict('procurement','purchase_order', null,'create_factory_order',
      'project_closed', format('Proyek %s berstatus %s; tidak ada yang perlu dibuat.', pr.code, pr.status));
  end if;

  select * into v from ops_procure.vendors where code = p_vendor_code;
  if not found then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'vendor_required','Pilih pabriknya dulu.', jsonb_build_object('field','vendor_code'));
  end if;
  if v.kind in ('qc','other') then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'not_factory', format('%s tercatat sebagai %s, bukan pabrik.', v.name, v.kind),
      jsonb_build_object('field','vendor_code'));
  end if;

  v_cur := upper(coalesce(nullif(btrim(p_currency), ''), 'IDR'));
  if v_cur not in ('IDR','USD') then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'unknown_currency', format('Mata uang %s tidak dipakai: IDR atau USD.', v_cur),
      jsonb_build_object('field','currency'));
  end if;
  if p_fx_rate is not null and p_fx_rate <= 0 then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'bad_fx_rate','Kurs adalah rupiah untuk 1 USD, lebih dari nol.', jsonb_build_object('field','fx_rate'));
  end if;
  v_fx := case when v_cur = 'IDR' then null else p_fx_rate end;

  if p_dp_percent is not null and (p_dp_percent < 0 or p_dp_percent > 100) then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'dp_out_of_range','DP antara 0 dan 100 persen.', jsonb_build_object('field','dp_percent'));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'lines_required','Pilih baris order yang dipesan ke pabrik.', jsonb_build_object('field','lines'));
  end if;
  select l ->> 'line_no' into v_dup
    from jsonb_array_elements(p_lines) l
   group by 1 having count(*) > 1 limit 1;
  if v_dup is not null then
    return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
      'line_named_twice', format('Baris %s disebut dua kali.', v_dup), jsonb_build_object('field','lines'));
  end if;

  for x in
    select l, pl.id, pl.line_no, pl.description, pl.product_code, pl.qty as pl_qty, pl.uom,
           pl.route, pl.design_item_id,
           (select p2.po_no from ops_procure.po_lines o
              join ops_procure.purchase_orders p2 on p2.id = o.po_id
             where o.project_line_id = pl.id and o.superseded_by is null
               and p2.status <> 'CANCELLED' limit 1) as on_po
      from jsonb_array_elements(p_lines) with ordinality as t(l, ord)
      left join ops_procure.project_lines pl
        on pl.project_id = pr.id
       and pl.line_no = case when (l ->> 'line_no') ~ '^\d+$' then (l ->> 'line_no')::int end
     order by ord
  loop
    if x.id is null then
      return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
        'line_unknown', format('Baris %s tidak ada di proyek %s.', coalesce(x.l ->> 'line_no', '—'), pr.code),
        jsonb_build_object('field','lines'));
    end if;
    if x.route <> 'FACTORY' then
      return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
        'not_factory_route',
        format('Baris %s dikerjakan workshop. Pindahkan ke jalur pabrik dulu.', x.line_no),
        jsonb_build_object('field','lines','line_no', x.line_no));
    end if;
    if x.on_po is not null then
      return ops_core.conflict('procurement','purchase_order', null,'create_factory_order',
        'line_already_ordered', format('Baris %s sudah dipesan di %s.', x.line_no, x.on_po),
        jsonb_build_object('line_no', x.line_no, 'po_no', x.on_po));
    end if;

    v_qty := case when nullif(x.l ->> 'qty', '') is null then x.pl_qty
                  when (x.l ->> 'qty') ~ '^\d+(\.\d+)?$' then (x.l ->> 'qty')::numeric end;
    if v_qty is null or v_qty <= 0 then
      return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
        'bad_qty', format('Jumlah baris %s harus lebih dari nol.', x.line_no),
        jsonb_build_object('field','lines','line_no', x.line_no));
    end if;

    v_price := null; v_offer := null; v_offer_cur := null;
    if nullif(x.l ->> 'unit_price', '') is not null then
      v_price := case when (x.l ->> 'unit_price') ~ '^\d+(\.\d+)?$' then (x.l ->> 'unit_price')::numeric end;
      if v_price is null or v_price <= 0 then
        return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
          'bad_price', format('Harga baris %s harus angka lebih dari nol.', x.line_no),
          jsonb_build_object('field','lines','line_no', x.line_no));
      end if;
      v_price := round(v_price, case when v_cur = 'USD' then 2 else 0 end);
    elsif x.design_item_id is not null then
      select f.unit_price, f.currency into v_offer, v_offer_cur
        from ops_procure.factory_price_of(x.design_item_id, v.id) f;
      v_price := ops_procure.money_in(v_offer, v_offer_cur, v_cur, v_fx);
    end if;
    if v_price is null then
      return ops_core.invalid('procurement','purchase_order', null,'create_factory_order',
        'price_required',
        case when v_offer is not null
             then format('Harga %s untuk baris %s dalam %s; isi kurs order ini atau ketik harganya.', v.name, x.line_no, v_offer_cur)
             else format('%s belum memberi harga untuk baris %s. Ketik harga yang disepakati.', v.name, x.line_no) end,
        jsonb_build_object('field','lines','line_no', x.line_no));
    end if;

    want := want || jsonb_build_object('project_line_id', x.id,
      'description', btrim(concat_ws(' · ', x.product_code, x.description)),
      'qty', v_qty, 'uom', x.uom, 'unit_price', v_price);
  end loop;

  -- One order per factory per project is the shape (Q84), not a lock: a line
  -- forgotten on the first order goes on a second one, and the answer says so.
  select p.po_no into v_same
    from ops_procure.purchase_orders p
   where p.project_id = pr.id and p.vendor_id = v.id and p.status <> 'CANCELLED'
   order by p.created_at limit 1;

  if v.kind = 'supplier' then
    update ops_procure.vendors set kind = 'factory' where id = v.id;
  end if;

  v_po_no := ops_core.next_doc_number('po');
  insert into ops_procure.purchase_orders
    (po_no, vendor_id, status, created_by, note, expected_delivery, project_id, currency, fx_rate)
  values (v_po_no, v.id, 'DRAFT', auth.uid(), nullif(btrim(p_note), ''), p_expected_delivery, pr.id, v_cur, v_fx)
  returning id into v_po_id;

  insert into ops_procure.po_lines
    (po_id, line_no, item_id, description, qty, uom, unit_price, line_total, project_line_id)
  select v_po_id, ord, null, w ->> 'description', (w ->> 'qty')::numeric, w ->> 'uom',
         (w ->> 'unit_price')::numeric,
         ops_procure.po_line_total((w ->> 'qty')::numeric, (w ->> 'unit_price')::numeric, v_cur),
         (w ->> 'project_line_id')::uuid
    from jsonb_array_elements(want) with ordinality as t(w, ord);
  get diagnostics n = row_count;

  if p_dp_percent is not null and p_dp_percent > 0 then
    insert into ops_procure.po_schedule (po_id, term_no, kind, basis, basis_value, due_rule) values
      (v_po_id, v_po_no || '-M01','DP',   'percent', p_dp_percent,       'on_issue'),
      (v_po_id, v_po_no || '-M02','FINAL','percent', 100 - p_dp_percent, 'on_delivery');
  end if;

  perform ops_core.emit('procurement','procurement.po.created', v_po_no,
    jsonb_build_object('po_no', v_po_no, 'vendor', v.code, 'lines', n,
                       'project_code', pr.code, 'factory_order', true, 'currency', v_cur));

  -- Leadership writing it confirms it in the same act (D267), as create_po.
  v_self := ops_core.has_authority('approve_goods');
  if v_self then
    update ops_procure.purchase_orders
       set approved_at = now(), approved_by = auth.uid(), self_confirmed = true
     where id = v_po_id;
    perform ops_core.emit('procurement','procurement.po.approved', v_po_no,
      jsonb_build_object('po_no', v_po_no, 'approved', true, 'self_confirmed', true, 'via', 'create_factory_order'));
  end if;

  res := ops_core.ok('procurement','purchase_order', v_po_no,'create_factory_order',
    jsonb_build_object('po_no', v_po_no, 'status','DRAFT', 'lines', n, 'currency', v_cur,
                       'project_code', pr.code, 'self_confirmed', v_self,
                       'same_factory_order', v_same,
                       'needs_rate', v_cur <> 'IDR' and v_fx is null));
  return ops_core.idem_remember('procurement','create_factory_order', p_key, res);
end $$;
revoke all on function ops_procure.create_factory_order(text, text, jsonb, text, numeric, date, text, numeric, text) from public;
grant execute on function ops_procure.create_factory_order(text, text, jsonb, text, numeric, date, text, numeric, text) to authenticated;

-- The kurs of a USD order, while it is a draft. Once issued it is the kurs the
-- factory was promised at, and the rupiah the payments read.
create or replace function ops_procure.set_po_fx_rate(p_po_no text, p_fx_rate numeric)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp
as $$
declare po ops_procure.purchase_orders;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'set_fx_rate',
      'not_permitted','Mengisi kurs order perlu akses procurement.');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'set_fx_rate','Order itu tidak ada.');
  end if;
  if po.currency = 'IDR' then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'set_fx_rate',
      'not_foreign', format('%s dalam rupiah; tidak perlu kurs.', p_po_no), jsonb_build_object('field','fx_rate'));
  end if;
  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'set_fx_rate',
      'already_issued', format('%s sudah diterbitkan dengan kurs %s.', p_po_no, coalesce(po.fx_rate::text, '—')));
  end if;
  if p_fx_rate is null or p_fx_rate <= 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'set_fx_rate',
      'bad_fx_rate','Kurs adalah rupiah untuk 1 USD, lebih dari nol.', jsonb_build_object('field','fx_rate'));
  end if;
  if po.fx_rate = p_fx_rate then
    return ops_core.noop('procurement','purchase_order', p_po_no,'set_fx_rate',
      'kursnya sudah itu', jsonb_build_object('fx_rate', p_fx_rate));
  end if;
  update ops_procure.purchase_orders set fx_rate = p_fx_rate where id = po.id;
  perform ops_core.emit('procurement','procurement.po.fx_rate', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'from', po.fx_rate, 'to', p_fx_rate));
  return ops_core.ok('procurement','purchase_order', p_po_no,'set_fx_rate',
    jsonb_build_object('po_no', p_po_no, 'fx_rate', p_fx_rate));
end $$;
revoke all on function ops_procure.set_po_fx_rate(text, numeric) from public;
grant execute on function ops_procure.set_po_fx_rate(text, numeric) to authenticated;

-- issue_po (0016/0143): a USD order needs its kurs, and the first issued
-- factory order moves its project to IN_PRODUCTION (§5.4), as 0130 does for
-- the first Job Order.
CREATE OR REPLACE FUNCTION ops_procure.issue_po(p_po_no text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare po ops_procure.purchase_orders; pr ops_procure.projects; n int; replayed jsonb; res jsonb;
        v_moved boolean := false;
begin
  replayed := ops_core.idem_replay('procurement','issue_po:' || p_po_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'issue',
      'not_permitted','Issuing an order needs procurement access.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'issue','No such order.');
  end if;
  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'issue',
      'already_issued', format('%s has already been issued.', p_po_no));
  end if;
  if po.approved_at is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'issue',
      'not_approved',
      format('%s has not been confirmed by leadership. An order is a promise in the company''s name, and it is confirmed before it is sent.', p_po_no));
  end if;
  -- The kurs is what the payments read the order in rupiah by (D416).
  if po.currency <> 'IDR' and po.fx_rate is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'issue',
      'fx_rate_required',
      format('%s is in %s. Type the kurs (rupiah per 1 %s) before issuing it.', p_po_no, po.currency, po.currency),
      jsonb_build_object('field','fx_rate'));
  end if;

  select count(*) into n from ops_procure.po_lines
   where po_id = po.id and superseded_by is null;
  if n = 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'issue',
      'no_lines','An order with no lines is a blank page with a signature on it.');
  end if;

  update ops_procure.purchase_orders
     set status = 'ISSUED', issued_at = now(), issued_by = auth.uid(),
         sent_revision = revision
   where id = po.id;

  -- The factory said yes: the project is in production.
  if po.project_id is not null then
    select * into pr from ops_procure.projects where id = po.project_id;
    if pr.status in ('INQUIRY','QUOTATION_SENT','DEAL') then
      update ops_procure.projects
         set status = 'IN_PRODUCTION', status_changed_at = now(), updated_at = now(), is_active = true
       where id = pr.id;
      insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
      values (pr.id, pr.status, 'IN_PRODUCTION', format('Order pabrik %s diterbitkan', p_po_no), auth.uid());
      v_moved := true;
    end if;
  end if;

  perform ops_core.emit('procurement','procurement.po.issued', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'lines', n, 'revision', po.revision));
  res := ops_core.ok('procurement','purchase_order', p_po_no,'issue',
    jsonb_build_object('po_no', p_po_no, 'status','ISSUED',
                       'project_code', pr.code, 'project_moved', v_moved));
  return ops_core.idem_remember('procurement','issue_po:' || p_po_no, p_key, res);
end $function$;

-- amend_po_line (0016): the new line keeps the client's order line it makes,
-- and its total is rounded in the order's currency.
CREATE OR REPLACE FUNCTION ops_procure.amend_po_line(p_po_no text, p_line_no integer, p_reason text, p_qty numeric DEFAULT NULL::numeric, p_unit_price numeric DEFAULT NULL::numeric, p_description text DEFAULT NULL::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare
  po ops_procure.purchase_orders; old ops_procure.po_lines; new_id uuid;
  v_qty numeric; v_price numeric; v_reason text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'amend',
      'not_permitted','Amending an order needs procurement access.');
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'reason_required',
      'An amendment changes a document the vendor is holding. Say what changed and why.',
      jsonb_build_object('field','reason'));
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend','No such order.');
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'amend',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;

  select * into old from ops_procure.po_lines
   where po_id = po.id and line_no = p_line_no and superseded_by is null;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend',
      format('Line %s is not on this order.', p_line_no));
  end if;

  -- Resolved against the line as it stands, so *unchanged* is a value rather
  -- than a special case, and the validation below sees what will be written.
  v_qty   := coalesce(p_qty, old.qty);
  v_price := coalesce(p_unit_price, old.unit_price);

  if v_qty <= 0 or v_price < 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'bad_values','A quantity is more than nothing and a price is not negative.');
  end if;
  -- Nothing to record is not an amendment, and writing one would bump the
  -- revision and tell a vendor their paper is out of date when it is not.
  if v_qty = old.qty and v_price = old.unit_price
     and coalesce(nullif(btrim(p_description), ''), old.description) = old.description then
    return ops_core.noop('procurement','purchase_order', p_po_no,'amend',
      'nothing changed on that line',
      jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no));
  end if;

  new_id := gen_random_uuid();
  update ops_procure.po_lines set superseded_by = new_id where id = old.id;

  insert into ops_procure.po_lines
    (id, po_id, line_no, item_id, description, qty, uom, unit_price, line_total, pr_line_id, project_line_id)
  values (new_id, po.id, old.line_no, old.item_id,
          coalesce(nullif(btrim(p_description), ''), old.description),
          v_qty, old.uom, v_price, ops_procure.po_line_total(v_qty, v_price, po.currency),
          old.pr_line_id, old.project_line_id);

  if po.status = 'ISSUED' then
    update ops_procure.purchase_orders set revision = revision + 1 where id = po.id;
  end if;

  perform ops_core.emit('procurement','procurement.po.amended', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no, 'reason', v_reason,
                       'from', jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price),
                       'to',   jsonb_build_object('qty', v_qty, 'unit_price', v_price)));

  res := ops_core.ok('procurement','purchase_order', p_po_no,'amend',
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no,
                       'po_line_id', new_id, 'reason', v_reason),
    jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price, 'line_total', old.line_total),
    jsonb_build_object('qty', v_qty, 'unit_price', v_price,
                       'line_total', ops_procure.po_line_total(v_qty, v_price, po.currency)));
  return ops_core.idem_remember('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key, res);
end $function$;

-- ── 4. views ──────────────────────────────────────────────────────────────

-- v_po_status (0033): every money figure the payment side reads is rupiah at
-- the order's kurs (D416). A rupiah order reads exactly as before
-- (`money_in` returns the amount unchanged). Its own currency is appended.
create or replace view ops_procure.v_po_status with (security_invoker = on) as
SELECT po.id AS po_id,
    po.po_no,
    po.status,
    po.vendor_id,
    po.issued_at,
    po.expected_delivery,
    po.revision,
    po.sent_revision,
    po.note,
    COALESCE(ln.contract_value, 0::numeric) AS contract_value,
    COALESCE(pd.paid_to_date, 0::numeric) AS paid_to_date,
    GREATEST(COALESCE(ln.contract_value, 0::numeric) - COALESCE(pd.paid_to_date, 0::numeric), 0::numeric) AS outstanding,
    COALESCE(ln.value_received, 0::numeric) AS value_received,
    COALESCE(pd.paid_to_date, 0::numeric) - COALESCE(ln.value_received, 0::numeric) AS exposure,
    COALESCE(ln.credit, 0::numeric) AS credit,
        CASE
            WHEN COALESCE(pd.paid_to_date, 0::numeric) <= 0::numeric THEN 'UNPAID'::text
            WHEN COALESCE(pd.paid_to_date, 0::numeric) >= (COALESCE(ln.contract_value, 0::numeric) - ops_core.money_tolerance()) THEN 'SETTLED'::text
            ELSE 'PARTIAL'::text
        END::ops_procure.po_payment_state_t AS payment_state,
        CASE
            WHEN COALESCE(ln.value_received, 0::numeric) <= 0::numeric THEN 'PENDING'::text
            WHEN COALESCE(ln.fully_delivered, false) THEN 'COMPLETE'::text
            ELSE 'PARTIAL'::text
        END::ops_procure.po_delivery_state_t AS delivery_state,
    COALESCE(ln.fully_delivered, false) AS fully_delivered,
    COALESCE(ln.any_delivered, false) AS any_delivered,
    dp.basis_value AS dp_percent,
    po.currency,
    po.fx_rate,
    COALESCE(ln.contract_value_own, 0::numeric) AS contract_value_own,
    po.currency <> 'IDR'::text AND po.fx_rate IS NULL AS needs_rate,
    po.project_id
   FROM ops_procure.purchase_orders po
     LEFT JOIN LATERAL ( SELECT ops_procure.money_in(sum(d.line_total), po.currency, 'IDR', po.fx_rate) AS contract_value,
            ops_procure.money_in(sum(d.value_received), po.currency, 'IDR', po.fx_rate) AS value_received,
            ops_procure.money_in(sum(d.over * d.unit_price), po.currency, 'IDR', po.fx_rate) AS credit,
            bool_and(d.received >= d.qty) AS fully_delivered,
            bool_or(d.received > 0::numeric) AS any_delivered,
            sum(d.line_total) AS contract_value_own
           FROM ops_procure.v_po_line_delivery d
          WHERE d.po_id = po.id) ln ON true
     LEFT JOIN ( SELECT al.po_no,
            sum(al.amount) AS paid_to_date
           FROM ops_acct.payment_allocations al
             JOIN ops_acct.transactions t ON t.id = al.trx_id
          WHERE al.superseded_by IS NULL AND al.po_no IS NOT NULL AND t.status <> 'VOID'::ops_acct.trx_status_t
          GROUP BY al.po_no) pd ON pd.po_no = po.po_no
     LEFT JOIN ops_procure.po_schedule dp ON dp.po_id = po.id AND dp.kind = 'DP'::ops_procure.po_payment_kind_t AND dp.basis = 'percent'::ops_procure.schedule_basis_t;

-- v_po_board / v_po_detail: the order's currency, kurs, own-currency total
-- and project, appended.
create or replace view ops_procure.v_po_board with (security_invoker = on) as
select b.*,
       s.currency, s.fx_rate, s.contract_value_own, s.needs_rate,
       pj.code as project_code, pj.name as project_name, s.project_id
  from (
  SELECT po.id,
      po.po_no,
      po.vendor_id,
      po.status,
      po.created_at,
      po.created_by,
      po.issued_at,
      po.issued_by,
      po.note,
      po.expected_delivery,
      po.approval_asked_at,
      po.approval_asked_by,
      po.approved_at,
      po.approved_by,
      po.approval_note,
      po.revision,
      po.sent_revision,
      po.approval_sent_to,
      po.approval_token,
      po.self_confirmed,
      v.name AS vendor_name,
          CASE
              WHEN po.expected_delivery IS NULL THEN NULL::integer
              WHEN po.status = ANY (ARRAY['CLOSED'::ops_procure.po_status_t, 'CANCELLED'::ops_procure.po_status_t]) THEN NULL::integer
              WHEN s.fully_delivered THEN NULL::integer
              WHEN ops_core.office_day() > po.expected_delivery THEN ops_core.office_day() - po.expected_delivery
              ELSE NULL::integer
          END AS days_late,
      jsonb_build_object('po_id', s.po_id, 'contract_value', s.contract_value, 'paid_to_date', s.paid_to_date, 'outstanding', s.outstanding, 'value_received', s.value_received, 'exposure', s.exposure, 'payment_state', s.payment_state, 'delivery_state', s.delivery_state) AS status_view,
      COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', l.id, 'po_id', l.po_id, 'line_no', l.line_no, 'item_id', l.item_id, 'description', l.description, 'qty', l.qty, 'uom', l.uom, 'unit_price', l.unit_price, 'line_total', l.line_total, 'superseded_by', l.superseded_by) ORDER BY l.line_no) AS jsonb_agg
             FROM ops_procure.po_lines l
            WHERE l.po_id = po.id AND l.superseded_by IS NULL), '[]'::jsonb) AS lines
     FROM ops_procure.purchase_orders po
       JOIN ops_procure.vendors v ON v.id = po.vendor_id
       LEFT JOIN ops_procure.v_po_status s ON s.po_id = po.id
       ) b
  join ops_procure.v_po_status s on s.po_id = b.id
  left join ops_procure.projects pj on pj.id = s.project_id;

create or replace view ops_procure.v_po_detail with (security_invoker = on) as
select b.*,
       s.currency, s.fx_rate, s.contract_value_own, s.needs_rate,
       pj.code as project_code, pj.name as project_name,
       coalesce((select jsonb_object_agg(o.line_no::text, pl.line_no)
                   from ops_procure.po_lines o
                   join ops_procure.project_lines pl on pl.id = o.project_line_id
                  where o.po_id = s.po_id and o.superseded_by is null), '{}'::jsonb) as project_line_nos
  from (
  SELECT po.po_no,
      po.vendor_id,
      v.name AS vendor_name,
      v.pic_name AS vendor_pic,
      COALESCE(v.pic_phone, v.phone) AS vendor_phone,
      po.status,
      po.expected_delivery,
          CASE
              WHEN po.expected_delivery IS NULL THEN NULL::integer
              WHEN po.status = ANY (ARRAY['CLOSED'::ops_procure.po_status_t, 'CANCELLED'::ops_procure.po_status_t]) THEN NULL::integer
              WHEN s.fully_delivered THEN NULL::integer
              WHEN ops_core.office_day() > po.expected_delivery THEN ops_core.office_day() - po.expected_delivery
              ELSE NULL::integer
          END AS days_late,
      po.revision,
      po.sent_revision,
      po.approval_asked_at,
      asked.full_name AS approval_asked_by_name,
      po.approved_at,
      appr.full_name AS approved_by_name,
      po.approval_note,
      po.note,
      po.created_at,
      po.issued_at,
      iss.full_name AS issued_by_name,
      s.contract_value,
      s.paid_to_date,
      s.outstanding,
      s.value_received,
      s.exposure,
      s.credit,
      s.payment_state,
      s.delivery_state,
      s.dp_percent,
      j.billable_now,
      COALESCE(ln.lines, '[]'::jsonb) AS lines,
      COALESCE(tm.terms, '[]'::jsonb) AS terms,
      COALESCE(tm.payable_now, 0::numeric) AS payable_now,
      COALESCE(am.amendments, '[]'::jsonb) AS amendments,
      COALESCE(pm.payments, '[]'::jsonb) AS payments,
      COALESCE(dc.documents, '[]'::jsonb) AS documents,
      ( SELECT COALESCE(jsonb_agg(blockers.b), '[]'::jsonb) AS "coalesce"
             FROM ( SELECT 'It is already closed.'::text AS b
                    WHERE po.status = 'CLOSED'::ops_procure.po_status_t
                  UNION ALL
                   SELECT 'It was never issued — cancel it rather than close it.'::text AS text
                    WHERE po.status = 'DRAFT'::ops_procure.po_status_t
                  UNION ALL
                   SELECT format('%s of the contract has not been paid.'::text, s.outstanding) AS format
                    WHERE s.outstanding > 0::numeric
                  UNION ALL
                   SELECT 'Not everything ordered has arrived.'::text AS text
                    WHERE NOT s.fully_delivered) blockers) AS close_blockers,
      jsonb_build_object('po_id', s.po_id, 'contract_value', s.contract_value, 'paid_to_date', s.paid_to_date, 'outstanding', s.outstanding, 'value_received', s.value_received, 'exposure', s.exposure, 'payment_state', s.payment_state, 'delivery_state', s.delivery_state) AS status_view,
      po.self_confirmed,
      po.approval_sent_to::text AS approval_sent_to
     FROM ops_procure.purchase_orders po
       JOIN ops_procure.vendors v ON v.id = po.vendor_id
       JOIN ops_procure.v_po_status s ON s.po_id = po.id
       JOIN ops_procure.v_po_journey j ON j.po_id = po.id
       LEFT JOIN ops_core.users asked ON asked.id = po.approval_asked_by
       LEFT JOIN ops_core.users appr ON appr.id = po.approved_by
       LEFT JOIN ops_core.users iss ON iss.id = po.issued_by
       LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('po_line_id', d.po_line_id, 'line_no', d.line_no, 'description', d.description, 'qty', d.qty, 'uom', d.uom, 'unit_price', d.unit_price, 'line_total', d.line_total, 'received', d.received, 'reported', d.reported, 'over', d.over, 'condition', d.condition, 'receipts', COALESCE(rc.receipts, '[]'::jsonb), 'pr_line_no', ( SELECT p.line_no_full
                     FROM ops_procure.po_lines x
                       JOIN ops_procure.pr_lines p ON p.id = x.pr_line_id
                    WHERE x.id = d.po_line_id)) ORDER BY d.line_no) AS lines
             FROM ops_procure.v_po_line_delivery d
               LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('receipt_no', r.receipt_no, 'qty', r.qty_received, 'condition', r.condition, 'at', r.received_at, 'by', COALESCE(rb.full_name, '—'::text), 'qc_by', COALESCE(qb.full_name, '—'::text), 'note', r.note, 'status', r.status, 'photo_attachment_id', ( SELECT k.attachment_id
                             FROM ops_core.attachment_links k
                            WHERE k.entity = 'receipt'::ops_core.link_entity_t AND k.entity_no = r.receipt_no AND k.kind = 'goods_photo'::ops_core.doc_kind_t AND k.unlinked_at IS NULL
                            ORDER BY k.linked_at
                           LIMIT 1), 'delivery_note_attachment_id', ( SELECT k.attachment_id
                             FROM ops_core.attachment_links k
                            WHERE k.entity = 'receipt'::ops_core.link_entity_t AND k.entity_no = r.receipt_no AND k.kind = 'delivery_note'::ops_core.doc_kind_t AND k.unlinked_at IS NULL
                            ORDER BY k.linked_at
                           LIMIT 1)) ORDER BY r.received_at) AS receipts
                     FROM ops_procure.receipts r
                       LEFT JOIN ops_core.users rb ON rb.id = r.received_by
                       LEFT JOIN ops_core.users qb ON qb.id = r.qc_by
                    WHERE r.po_line_id = d.po_line_id) rc ON true
            WHERE d.po_id = po.id) ln ON true
       LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('term_no', t.term_no, 'kind', t.kind, 'basis', t.basis, 'basis_value', t.basis_value, 'due_rule', t.due_rule, 'due_date', t.due_date, 'amount', t.amount, 'covered', t.covered, 'state', t.state, 'blocked_by', t.blocked_by, 'trigger', t.trigger) ORDER BY t.term_no) AS terms,
              sum(GREATEST(t.amount - t.covered, 0::numeric)) FILTER (WHERE t.state = ANY (ARRAY['PAYABLE'::ops_procure.po_term_state_t, 'PARTIAL'::ops_procure.po_term_state_t])) AS payable_now
             FROM ops_procure.v_po_terms t
            WHERE t.po_id = po.id) tm ON true
       LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('line_no', old.line_no, 'from', (((old.qty || ' '::text) || old.uom) || ' × '::text) || old.unit_price, 'to',
                  CASE
                      WHEN new_l.id IS NULL THEN 'removed'::text
                      ELSE (((new_l.qty || ' '::text) || new_l.uom) || ' × '::text) || new_l.unit_price
                  END, 'at', '') ORDER BY old.line_no DESC) AS amendments
             FROM ops_procure.po_lines old
               LEFT JOIN ops_procure.po_lines new_l ON new_l.id = old.superseded_by
            WHERE old.po_id = po.id AND old.superseded_by IS NOT NULL) am ON true
       LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('trx_no', t.trx_no, 'trx_date', t.trx_date, 'amount', al.amount, 'description', t.description) ORDER BY t.trx_date) AS payments
             FROM ops_acct.payment_allocations al
               JOIN ops_acct.transactions t ON t.id = al.trx_id
            WHERE al.po_no = po.po_no AND al.superseded_by IS NULL AND t.status <> 'VOID'::ops_acct.trx_status_t) pm ON true
       LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('attachment_id', a.id, 'filename', a.filename, 'url', a.url, 'kind', k.kind, 'linked_at', k.linked_at) ORDER BY k.linked_at) AS documents
             FROM ops_core.attachment_links k
               JOIN ops_core.attachments a ON a.id = k.attachment_id
            WHERE k.entity = 'purchase_order'::ops_core.link_entity_t AND k.entity_no = po.po_no AND k.unlinked_at IS NULL) dc ON true
       ) b
  join ops_procure.purchase_orders po on po.po_no = b.po_no
  join ops_procure.v_po_status s on s.po_id = po.id
  left join ops_procure.projects pj on pj.id = s.project_id;

-- The approval card (0143) says which currency the leader is confirming.
CREATE OR REPLACE FUNCTION ops_procure.po_approval_card(p_po_no text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
  select jsonb_build_object(
           'po_no', p.po_no,
           'token', p.approval_token,
           'to', p.approval_sent_to,
           'asked_by', (select u.email from ops_core.users u where u.id = p.approval_asked_by),
           'vendor', v.name,
           'contract_value', s.contract_value,
           'currency', p.currency,
           'fx_rate', p.fx_rate,
           'contract_value_own', s.contract_value_own,
           'project_code', (select pj.code from ops_procure.projects pj where pj.id = p.project_id),
           'expected_delivery', p.expected_delivery,
           'lines', (select jsonb_agg(jsonb_build_object(
                        'description', l.description, 'qty', l.qty, 'uom', l.uom,
                        'unit_price', l.unit_price, 'line_total', l.line_total,
                        'pr_line_no', (select pl.line_no_full from ops_procure.pr_lines pl where pl.id = l.pr_line_id))
                      order by l.line_no)
                       from ops_procure.po_lines l where l.po_id = p.id and l.superseded_by is null))
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no
     and p.status = 'DRAFT' and p.approved_at is null and p.approval_token is not null;
$function$;

-- v_project_line (0130): the route, the design item, and the factory order
-- the line is on — its name, state and date, for whoever reads the project.
create or replace view ops_procure.v_project_line with (security_invoker = on) as
select b.*,
       l.route,
       l.design_item_id,
       di.item_no as design_item_no,
       fo.po_no as factory_po_no,
       fo.po_status as factory_po_status,
       fo.vendor_code as factory_vendor_code,
       fo.vendor_name as factory_vendor_name,
       fo.expected_delivery as factory_expected_delivery,
       fo.issued_at as factory_issued_at
  from (
  SELECT l.id,
      l.project_id,
      l.line_no,
      l.product_code,
      l.description,
      l.qty,
      l.uom,
      l.unit_price,
      l.note,
      l.created_at,
      l.delivery_date,
      l.updated_at,
      p.code AS project_code,
      s.name AS product_name,
      s.current_rev AS product_current_rev,
      s.draft_rev AS product_draft_rev,
      s.production_cost AS product_production_cost,
      s.id IS NOT NULL AS product_exists,
      COALESCE(j.jobs, 0) AS job_order_count,
      COALESCE(j.qty, 0::numeric) AS job_order_qty,
      COALESCE(j.completed, 0::numeric) AS job_order_completed,
      j.open_jobs AS job_order_open
     FROM ops_procure.project_lines l
       JOIN ops_procure.projects p ON p.id = l.project_id
       LEFT JOIN ops_prod.v_product_summary s ON s.product_code = l.product_code
       LEFT JOIN LATERAL ( SELECT count(*)::integer AS jobs,
              sum(w.qty) AS qty,
              sum(COALESCE(w.completed, 0::numeric)) AS completed,
              count(*) FILTER (WHERE w.status = 'OPEN'::ops_prod.work_order_status_t)::integer AS open_jobs
             FROM ops_prod.work_orders wo
               JOIN ops_prod.v_work_order w ON w.id = wo.id
            WHERE wo.project_line_id = l.id AND w.status <> 'CANCELLED'::ops_prod.work_order_status_t) j ON true
       ) b
  join ops_procure.project_lines l on l.id = b.id
  left join ops_procure.design_items di on di.id = l.design_item_id
  left join lateral ops_procure.factory_order_of_line(l.id) fo on true;

-- The board per project (§5.1): every order line, where it is made, how far
-- it is. WORKSHOP lines read their Job Orders (`made` as v_fulfilment_line
-- counts it); FACTORY lines read their factory order — what the factory has
-- finished is QC's number and arrives with O7, so `made` is null for them,
-- never a guess. Shipping and arrival are the same for both.
--
--   stage  NO_JOB_ORDER · IN_WORK · MADE            (workshop)
--          NO_FACTORY_ORDER · ORDER_DRAFT · AT_FACTORY (factory)
--          SHIPPED · ARRIVED                        (either, once it moves)
create or replace view ops_procure.v_project_production with (security_invoker = on) as
select pl.project_code,
       p.name as project_name,
       p.status as project_status,
       p.is_active as project_is_active,
       pl.id as project_line_id,
       pl.line_no,
       pl.product_code,
       pl.description,
       pl.qty,
       pl.uom,
       pl.delivery_date,
       pl.route,
       pl.design_item_no,
       pl.job_order_count,
       pl.job_order_open,
       case when pl.route = 'WORKSHOP' then f.made end as made,
       pl.factory_po_no,
       pl.factory_po_status,
       pl.factory_vendor_name,
       pl.factory_expected_delivery,
       coalesce(f.delivered, 0::numeric) as delivered,
       coalesce(f.arrived, 0::numeric) as arrived,
       coalesce(f.installed, 0::numeric) as installed,
       case
         when coalesce(f.arrived, 0) >= pl.qty then 'ARRIVED'
         when coalesce(f.delivered, 0) >= pl.qty then 'SHIPPED'
         when pl.route = 'WORKSHOP' then
           case when pl.job_order_count = 0 and f.made is null then 'NO_JOB_ORDER'
                when coalesce(f.made, 0) >= pl.qty then 'MADE'
                else 'IN_WORK' end
         when pl.factory_po_no is null then 'NO_FACTORY_ORDER'
         when pl.factory_po_status = 'DRAFT' then 'ORDER_DRAFT'
         else 'AT_FACTORY'
       end as stage,
       case
         when pl.route = 'FACTORY' and pl.factory_expected_delivery is not null
              and pl.factory_po_status = 'ISSUED'
              and coalesce(f.delivered, 0) < pl.qty
              and ops_core.office_day() > pl.factory_expected_delivery
         then ops_core.office_day() - pl.factory_expected_delivery
       end as factory_days_late
  from ops_procure.v_project_line pl
  join ops_procure.projects p on p.id = pl.project_id
  left join ops_dlv.v_fulfilment_line f on f.project_line_id = pl.id;

grant select on ops_procure.v_project_production to authenticated;

analyze ops_procure.project_lines;
analyze ops_procure.purchase_orders;
analyze ops_procure.po_lines;
