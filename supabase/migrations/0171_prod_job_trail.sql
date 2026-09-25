-- 0171_prod_job_trail.sql — one number, the whole story from purchase to handover.
--
-- The owner (2026-09-25): *kita butuh 1 nomor di setiap event dimana 1 nomor
-- bisa merujuk ke database inventory -> inventory dipakai BOM -> nomornya
-- dipakai lagi ke Purchase Request -> bisa jadi ke Purchase Order untuk vendor
-- -> lalu barangnya masuk gudang masuk ke receiving report, stok nambah,
-- status di job order jadi material ready -> job order pakai nomor yang sama
-- -> job selesai, project selesai bisa di review ulang seluruh kejadian
-- purchase-produksi.*
--
-- ── What the evaluation found (D312) ────────────────────────────────────────
--
-- The chain is **already keyed end to end**, by two numbers rather than one:
--
--   *what*       the item code (`I-00042`)  — BOM component, PR line, PO line,
--                receipt (through its line), stock move
--   *for which*  the Job Order (`spk-…`)    — PR line `source_wo_no`, stock
--                issue `ref_no`, progress, finished goods; and through the JO
--                its project code and customer order line
--
-- Every document keeps its own number as well (PR, PO, RR, surat jalan, BAST):
-- a PO to one vendor covers lines for three JOs, and one JO buys from five
-- vendors, so no single document number can be *the* number. What the owner
-- needs — type one number, see everything — is a **lookup that follows the
-- keys**, not a new number stamped on every row. This migration adds it.
--
-- Two links were plain text nobody checked, so one typo broke the chain
-- silently: `pr_lines.source_wo_no` and a stock issue's `ref_no`. They are
-- checked here, for new writes (existing rows are untouched).
--
-- *Material ready* is not a stored status (A3): it changes the moment the
-- rack moves. It is computed with the JO's material plan (`materialForWorkOrder`).

-- ── 1. JO references are checked where they are written ─────────────────────
create or replace function ops_prod.check_jo_reference()
returns trigger
language plpgsql security definer set search_path = ops_prod, pg_temp as $$
declare
  v_ref    text;
  v_status ops_prod.work_order_status_t;
begin
  if tg_table_name = 'pr_lines' then
    v_ref := new.source_wo_no;
    if v_ref is null or (tg_op = 'UPDATE' and v_ref is not distinct from old.source_wo_no) then
      return new;
    end if;
  else
    -- A stock move's ref_no names many things (an opname sheet, a receipt).
    -- Only a reference written in a JO's own form is held to naming one.
    v_ref := new.ref_no;
    if new.kind not in ('issue','return') or v_ref is null or v_ref !~* '^(spk|jo)-' then
      return new;
    end if;
  end if;

  select w.status into v_status from ops_prod.work_orders w where w.wo_no = v_ref;
  if not found then
    raise exception using errcode = 'foreign_key_violation',
      message = format('Job Order %s tidak ada. Periksa nomornya — rantai pembelian-produksi putus di sini.', v_ref);
  end if;
  if v_status = 'CANCELLED' and tg_table_name = 'pr_lines' then
    raise exception using errcode = 'check_violation',
      message = format('Job Order %s sudah dibatalkan — jangan belanja untuknya.', v_ref);
  end if;
  return new;
end $$;

revoke all on function ops_prod.check_jo_reference() from public;
grant execute on function ops_prod.check_jo_reference() to authenticated;

drop trigger if exists check_jo_reference on ops_procure.pr_lines;
create trigger check_jo_reference
  before insert or update of source_wo_no on ops_procure.pr_lines
  for each row execute function ops_prod.check_jo_reference();

drop trigger if exists check_jo_reference on ops_inv.stock_moves;
create trigger check_jo_reference
  before insert on ops_inv.stock_moves
  for each row execute function ops_prod.check_jo_reference();

-- ── 2. the trail ────────────────────────────────────────────────────────────
-- Any number in, the project's whole purchase→production story out: a project
-- code, a JO, a PR, a PO, a receiving report, a surat jalan.
--
-- Definer, because the story crosses five modules and nobody holds all five;
-- each part is shown only to a reader who may read that module, and the parts
-- withheld are **named** in `hidden` — *you may not see it* is a different
-- sentence from *it did not happen* (F104).
create or replace function ops_prod.job_trail(p_no text)
returns jsonb
language plpgsql stable security definer
set search_path = ops_prod, ops_procure, ops_inv, ops_dlv, ops_core, pg_temp as $$
declare
  v_no        text := btrim(coalesce(p_no, ''));
  v_kind      text;
  v_project   text;
  v_wos       text[] := '{}';
  v_prl       uuid[] := '{}';   -- purchase request lines in the story
  v_pol       uuid[] := '{}';   -- purchase order lines
  v_rcv       text[] := '{}';   -- receipt numbers
  v_lines     uuid[] := '{}';   -- customer order lines
  v_proc      boolean := ops_core.has_permission('procurement.read');
  v_inv       boolean := ops_core.has_permission('inventory.read');
  v_prod      boolean := ops_core.has_permission('production.read') or ops_core.has_permission('project.read');
  v_dlv       boolean := ops_dlv.can_read();
  v_hidden    text[] := '{}';
  v_events    jsonb := '[]'::jsonb;
  v_part      jsonb;
  v_jos       jsonb;
  v_proj      jsonb;
begin
  if not (v_proc or v_inv or v_prod or v_dlv) then
    return ops_core.refused('production','trail', v_no,'read',
      'not_permitted','Riwayat ini butuh akses baca produksi, proyek, pembelian, gudang, atau pengiriman.');
  end if;
  if v_no = '' then
    return ops_core.invalid('production','trail', null,'read',
      'number_required','Ketik satu nomor: proyek, Job Order, PR, PO, penerimaan, atau surat jalan.',
      jsonb_build_object('field','no'));
  end if;

  -- ── what was typed ──
  if exists (select 1 from ops_prod.work_orders w where w.wo_no = v_no) then
    v_kind := 'job_order';
    select w.project_code into v_project from ops_prod.work_orders w where w.wo_no = v_no;
    v_wos := array[v_no];
  elsif exists (select 1 from ops_procure.projects p where p.code = v_no) then
    v_kind := 'project';
    v_project := v_no;
  elsif exists (select 1 from ops_procure.pr_documents d where d.doc_no = v_no) then
    v_kind := 'purchase_request';
    select p.code into v_project from ops_procure.pr_documents d
      left join ops_procure.projects p on p.id = d.project_id where d.doc_no = v_no;
    select coalesce(array_agg(l.id), '{}') into v_prl from ops_procure.pr_lines l
     where l.doc_no = v_no and l.removed_at is null;
  elsif exists (select 1 from ops_procure.purchase_orders o where o.po_no = v_no) then
    v_kind := 'purchase_order';
    select coalesce(array_agg(pl.id), '{}') into v_pol from ops_procure.po_lines pl
      join ops_procure.purchase_orders o on o.id = pl.po_id
     where o.po_no = v_no and pl.superseded_by is null;
    select coalesce(array_agg(pl.pr_line_id), '{}') into v_prl from ops_procure.po_lines pl
     where pl.id = any(v_pol) and pl.pr_line_id is not null;
  elsif exists (select 1 from ops_procure.receipts r where r.receipt_no = v_no) then
    v_kind := 'receipt';
    select coalesce(array_agg(x), '{}') into v_prl from (
      select r.line_id as x from ops_procure.receipts r where r.receipt_no = v_no and r.line_id is not null
      union
      select pl.pr_line_id from ops_procure.receipts r join ops_procure.po_lines pl on pl.id = r.po_line_id
       where r.receipt_no = v_no and pl.pr_line_id is not null) s;
    select coalesce(array_agg(r.po_line_id), '{}') into v_pol from ops_procure.receipts r
     where r.receipt_no = v_no and r.po_line_id is not null;
  elsif exists (select 1 from ops_dlv.deliveries d where d.delivery_no = v_no) then
    v_kind := 'delivery';
    select d.project_code into v_project from ops_dlv.deliveries d where d.delivery_no = v_no;
  else
    return ops_core.not_found('production','trail', v_no,'read',
      format('Nomor %s tidak ditemukan sebagai proyek, Job Order, PR, PO, penerimaan, atau surat jalan.', v_no));
  end if;

  -- A document names its JOs through its lines; a JO names its project.
  v_wos := v_wos || coalesce((select array_agg(distinct l.source_wo_no) from ops_procure.pr_lines l
                               where l.id = any(v_prl) and l.source_wo_no is not null), '{}');
  if v_project is null then
    select min(w.project_code) into v_project from ops_prod.work_orders w where w.wo_no = any(v_wos);
  end if;
  -- The project's own JOs — the review is of the whole job, whichever number
  -- opened it.
  if v_project is not null then
    v_wos := v_wos || coalesce((select array_agg(w.wo_no) from ops_prod.work_orders w
                                 where w.project_code = v_project), '{}');
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_wos from unnest(v_wos) x;

  -- Purchase lines raised for those JOs, or on the project's own requests.
  select coalesce(array_agg(distinct l.id), '{}') into v_prl from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    left join ops_procure.projects p on p.id = d.project_id
   where l.removed_at is null
     and (l.id = any(v_prl) or l.source_wo_no = any(v_wos) or (v_project is not null and p.code = v_project));
  select coalesce(array_agg(distinct pl.id), '{}') into v_pol from ops_procure.po_lines pl
   where pl.superseded_by is null and (pl.id = any(v_pol) or pl.pr_line_id = any(v_prl));
  select coalesce(array_agg(distinct r.receipt_no), '{}') into v_rcv from ops_procure.receipts r
   where r.line_id = any(v_prl) or r.po_line_id = any(v_pol);
  select coalesce(array_agg(distinct w.project_line_id), '{}') into v_lines from ops_prod.work_orders w
   where w.wo_no = any(v_wos) and w.project_line_id is not null;

  -- ── the story, one event per row ──
  if v_prod then
    select coalesce(jsonb_agg(jsonb_build_object(
             'at', w.created_at, 'stage', 'job_order', 'no', w.wo_no, 'wo_no', w.wo_no,
             'item_code', w.product_code, 'text', w.item_name, 'qty', w.qty, 'uom', w.uom,
             'status', w.status)), '[]') into v_part
      from ops_prod.work_orders w where w.wo_no = any(v_wos);
    v_events := v_events || v_part;

    select coalesce(jsonb_agg(jsonb_build_object(
             'at', e.work_date, 'stage', 'progress', 'no', w.wo_no, 'wo_no', w.wo_no,
             'item_code', w.product_code, 'text', e.stage, 'qty', e.qty, 'uom', w.uom,
             'status', null)), '[]') into v_part
      from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
     where w.wo_no = any(v_wos);
    v_events := v_events || v_part;
  else
    v_hidden := v_hidden || array['job_order','progress'];
  end if;

  if v_proc then
    select coalesce(jsonb_agg(jsonb_build_object(
             'at', coalesce(d.submitted_at, l.created_at), 'stage', 'purchase_request',
             'no', l.line_no_full, 'doc_no', l.doc_no, 'wo_no', l.source_wo_no,
             'item_code', i.code, 'text', l.description, 'qty', l.qty, 'uom', l.uom,
             'amount', l.item_total, 'paid', cov.covered, 'status', d.status)), '[]') into v_part
      from ops_procure.pr_lines l
      join ops_procure.pr_documents d on d.id = l.doc_id
      left join ops_procure.items i on i.id = l.item_id
      left join ops_procure.v_line_coverage cov on cov.line_id = l.id
     where l.id = any(v_prl);
    v_events := v_events || v_part;

    select coalesce(jsonb_agg(jsonb_build_object(
             'at', coalesce(o.issued_at, o.created_at), 'stage', 'purchase_order',
             'no', o.po_no || '/' || pl.line_no, 'doc_no', o.po_no, 'wo_no', src.source_wo_no,
             'item_code', i.code, 'text', pl.description || ' — ' || coalesce(v.name, '?'),
             'qty', pl.qty, 'uom', pl.uom, 'amount', pl.line_total, 'status', o.status)), '[]') into v_part
      from ops_procure.po_lines pl
      join ops_procure.purchase_orders o on o.id = pl.po_id
      left join ops_procure.vendors v on v.id = o.vendor_id
      left join ops_procure.items i on i.id = pl.item_id
      left join ops_procure.pr_lines src on src.id = pl.pr_line_id
     where pl.id = any(v_pol);
    v_events := v_events || v_part;

    select coalesce(jsonb_agg(jsonb_build_object(
             'at', r.received_at, 'stage', 'receipt', 'no', r.receipt_no, 'doc_no', r.receipt_no,
             'wo_no', coalesce(src.source_wo_no, psrc.source_wo_no),
             'item_code', coalesce(i1.code, i2.code), 'text', coalesce(src.description, pl.description),
             'qty', r.qty_received, 'uom', coalesce(pl.uom, src.uom),
             'status', r.status || ' · ' || r.condition)), '[]') into v_part
      from ops_procure.receipts r
      left join ops_procure.pr_lines src on src.id = r.line_id
      left join ops_procure.po_lines pl on pl.id = r.po_line_id
      left join ops_procure.pr_lines psrc on psrc.id = pl.pr_line_id
      left join ops_procure.items i1 on i1.id = src.item_id
      left join ops_procure.items i2 on i2.id = pl.item_id
     where r.receipt_no = any(v_rcv);
    v_events := v_events || v_part;
  else
    v_hidden := v_hidden || array['purchase_request','purchase_order','receipt'];
  end if;

  if v_inv then
    select coalesce(jsonb_agg(jsonb_build_object(
             'at', m.moved_at,
             'stage', case m.kind when 'receipt' then 'stock_in' when 'issue' then 'issue' else 'return' end,
             'no', m.move_no, 'doc_no', m.ref_no,
             'wo_no', case when m.kind = 'receipt' then null else m.ref_no end,
             'item_code', m.item_code, 'text', m.location, 'qty', m.qty, 'uom', m.uom,
             'status', null)), '[]') into v_part
      from ops_inv.stock_moves m
     where (m.kind = 'receipt' and m.ref_no = any(v_rcv))
        or (m.kind in ('issue','return') and m.ref_no = any(v_wos));
    v_events := v_events || v_part;

    select coalesce(jsonb_agg(jsonb_build_object(
             'at', m.moved_at, 'stage', 'finished', 'no', m.move_no, 'doc_no', m.ref_no,
             'wo_no', m.wo_no, 'item_code', m.product_code,
             'text', m.kind::text || ' · ' || m.location, 'qty', m.qty, 'uom', null,
             'status', null)), '[]') into v_part
      from ops_inv.product_moves m
     where m.wo_no = any(v_wos) or m.project_line_id = any(v_lines);
    v_events := v_events || v_part;
  else
    v_hidden := v_hidden || array['stock_in','issue','finished'];
  end if;

  if v_dlv then
    if v_project is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'at', d.created_at, 'stage', 'delivery', 'no', d.delivery_no, 'doc_no', d.delivery_no,
               'wo_no', null, 'item_code', pl.product_code, 'text', dl.description,
               'qty', dl.qty, 'uom', dl.uom, 'status', d.status)), '[]') into v_part
        from ops_dlv.delivery_lines dl
        join ops_dlv.deliveries d on d.id = dl.delivery_id
        join ops_procure.project_lines pl on pl.id = dl.project_line_id
       where d.project_code = v_project;
      v_events := v_events || v_part;

      select coalesce(jsonb_agg(jsonb_build_object(
               'at', h.created_at, 'stage', 'handover', 'no', h.handover_no, 'doc_no', h.handover_no,
               'wo_no', null, 'item_code', null,
               'text', format('BAST — %s / %s', h.client_rep, h.our_rep),
               'qty', null, 'uom', null,
               'status', case when h.open_snags_at_handover > 0
                              then h.open_snags_at_handover || ' snag terbuka' end)), '[]') into v_part
        from ops_dlv.handovers h where h.project_code = v_project;
      v_events := v_events || v_part;
    end if;
  else
    v_hidden := v_hidden || array['delivery','handover'];
  end if;

  select coalesce(jsonb_agg(e order by (e->>'at')::timestamptz, e->>'stage', e->>'no'), '[]')
    into v_events from jsonb_array_elements(v_events) e;

  select jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status::text,
                            'client_name', p.client_name, 'target_date', p.target_date)
    into v_proj from ops_procure.projects p where p.code = v_project;

  select coalesce(jsonb_agg(jsonb_build_object(
           'wo_no', w.wo_no, 'product_code', w.product_code, 'item_name', w.item_name,
           'qty', w.qty, 'uom', w.uom, 'status', w.status, 'completed', w.completed,
           'due_date', w.due_date, 'bom_rev', w.bom_rev) order by w.created_at), '[]')
    into v_jos from ops_prod.v_work_order w where w.wo_no = any(v_wos) and v_prod;

  return ops_core.ok('production','trail', v_no,'read', jsonb_build_object(
    'no', v_no, 'resolved_as', v_kind, 'project', v_proj, 'job_orders', v_jos,
    'events', v_events, 'hidden', to_jsonb(v_hidden),
    -- A request with no JO is spending the chain cannot place on the floor.
    'unlinked_purchase_lines', case when v_proc then
      (select count(*) from ops_procure.pr_lines l where l.id = any(v_prl) and l.source_wo_no is null) end));
end $$;

revoke all on function ops_prod.job_trail(text) from public;
grant execute on function ops_prod.job_trail(text) to authenticated;
