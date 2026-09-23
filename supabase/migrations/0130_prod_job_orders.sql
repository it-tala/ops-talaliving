-- 0130_prod_job_orders.sql — the work order becomes the Job Order, and gets
-- the seams it never had.
--
-- The tables are 0061–0063 and they stand: stages, progress, vendor legs, the
-- pin to a released BOM. What was missing is every write. They went straight
-- through RLS, which is enough to *store* a row and not enough to *say why a
-- row was refused* — a trigger that raises `check_violation` reaches a screen
-- as a 400 with Postgres's sentence in it. Each seam here asks the same
-- questions the demo asks, in the same order, and answers with an envelope.
--
-- Three things are new rather than wrapped:
--
--   **The name.** The owner calls it a Job Order, so new numbers read
--   `jo-26-09-23_01`. `spk` stays in `doc_prefixes` — a number already printed
--   on paper is never renumbered — and production had none when this ran.
--
--   **The order line.** A Job Order made from a customer's order line carries
--   the line's id, so the order screen can say *12 pesan · 12 di Job Order ·
--   4 selesai* without guessing by product code (one project may order the
--   same chair twice, for two delivery dates). A line with a Job Order behind
--   it can no longer be deleted from the order: the workshop is building it.
--
--   **The project moves.** The first Job Order on a project that is still
--   INQUIRY, QUOTATION_SENT or DEAL moves it to IN_PRODUCTION, logged with the
--   Job Order's number as the reason. The status is what the order list
--   filters on, and a project with chairs on the bench reading *Deal* is the
--   stale flag this system exists to avoid.

insert into ops_core.doc_prefixes (prefix, what) values ('jo', 'job order')
on conflict (prefix) do nothing;

alter table ops_prod.work_orders
  alter column wo_no set default ops_core.next_doc_number('jo');

alter table ops_prod.work_orders
  add column if not exists project_line_id uuid references ops_procure.project_lines(id);
create index if not exists wo_project_line_idx on ops_prod.work_orders (project_line_id);

-- ── putting something on the floor ────────────────────────────────────────
create or replace function ops_prod.create_work_order(
  p_item_name text, p_qty numeric, p_uom text, p_due_date date,
  p_product_code text default null, p_description text default null,
  p_project_code text default null, p_route text default 'IN_HOUSE',
  p_note text default null, p_project_line_id uuid default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_procure, ops_core, pg_temp as $$
declare
  v_code  text := nullif(upper(btrim(coalesce(p_product_code, ''))), '');
  v_proj  text := nullif(btrim(coalesce(p_project_code, '')), '');
  v_name  text := btrim(coalesce(p_item_name, ''));
  v_uom   text := coalesce(nullif(btrim(p_uom), ''), 'unit');
  v_route ops_prod.route_t;
  pr      ops_procure.projects;
  ln      ops_procure.project_lines;
  prod    ops_prod.products;
  w       ops_prod.work_orders;
  res     jsonb;
  replayed jsonb;
begin
  replayed := ops_core.idem_replay('production', 'create_work_order', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('production.create') then
    return ops_core.refused('production','work_order', null,'create',
      'not_permitted','Membuat Job Order butuh akses produksi (create).');
  end if;

  -- From an order line: the line fills what the caller left empty, and the
  -- project is the line's own — never one the caller names beside it.
  if p_project_line_id is not null then
    select * into ln from ops_procure.project_lines where id = p_project_line_id;
    if not found then
      return ops_core.invalid('production','work_order', null,'create',
        'line_not_found','Baris pesanan itu tidak ada.', jsonb_build_object('field','project_line_id'));
    end if;
    select * into pr from ops_procure.projects where id = ln.project_id;
    v_proj := pr.code;
    v_code := coalesce(v_code, ln.product_code);
    if v_name = '' then v_name := ln.description; end if;
    if p_uom is null or btrim(p_uom) = '' then v_uom := ln.uom; end if;
  end if;

  if v_name = '' then
    return ops_core.invalid('production','work_order', null,'create',
      'item_required','Apa yang dibuat?', jsonb_build_object('field','item_name'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('production','work_order', null,'create',
      'qty_required','Job Order untuk nol unit bukan Job Order.', jsonb_build_object('field','qty'));
  end if;
  if p_due_date is null then
    return ops_core.invalid('production','work_order', null,'create',
      'due_date_required','Job Order tanpa tanggal tidak bisa terlambat — artinya tidak ada yang tahu kapan ia terlambat.',
      jsonb_build_object('field','due_date'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = v_uom) then
    return ops_core.invalid('production','work_order', null,'create',
      'no_such_uom', format('Tidak ada satuan %s.', v_uom), jsonb_build_object('field','uom'));
  end if;
  begin
    v_route := coalesce(nullif(btrim(p_route), ''), 'IN_HOUSE')::ops_prod.route_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','work_order', null,'create',
      'unknown_route', format('Tidak ada rute %s.', p_route), jsonb_build_object('field','route'));
  end;
  if v_code is not null then
    select * into prod from ops_prod.products where product_code = v_code;
    if not found then
      return ops_core.invalid('production','work_order', null,'create',
        'product_not_found', format('Tidak ada produk %s di katalog. Kosongkan kalau ini barang sekali buat.', v_code),
        jsonb_build_object('field','product_code'));
    end if;
  end if;
  if v_proj is not null and pr.id is null then
    select * into pr from ops_procure.projects where code = v_proj;
    if not found then
      return ops_core.invalid('production','work_order', null,'create',
        'project_not_found', format('Tidak ada proyek %s.', v_proj), jsonb_build_object('field','project_code'));
    end if;
  end if;

  insert into ops_prod.work_orders
    (product_code, item_name, description, qty, uom, project_code, due_date, route,
     bom_rev, note, project_line_id, created_by)
  values (v_code, v_name, nullif(btrim(p_description), ''), p_qty, v_uom, v_proj, p_due_date, v_route,
          -- Pinned **now** (D256). Null where the product has no released
          -- revision, and null means exactly that.
          case when prod.id is null then null else ops_prod.released_rev(prod.id) end,
          nullif(btrim(p_note), ''), p_project_line_id, auth.uid())
  returning * into w;

  if pr.id is not null and pr.status in ('INQUIRY','QUOTATION_SENT','DEAL') then
    update ops_procure.projects
       set status = 'IN_PRODUCTION', status_changed_at = now(), updated_at = now(), is_active = true
     where id = pr.id;
    insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
    values (pr.id, pr.status, 'IN_PRODUCTION', format('Job Order %s dibuat', w.wo_no), auth.uid());
  end if;

  res := ops_core.ok('production','work_order', w.wo_no,'create',
    jsonb_build_object('wo_no', w.wo_no, 'bom_rev', w.bom_rev,
                       'project_moved', pr.id is not null and pr.status in ('INQUIRY','QUOTATION_SENT','DEAL')));
  return ops_core.idem_remember('production', 'create_work_order', p_key, res);
end $$;

-- ── reporting work ────────────────────────────────────────────────────────
--
-- The triggers from 0062/0063 stay the last word; this asks first so the
-- refusal has a sentence, and catches theirs for the cases it cannot see
-- coming (two people reporting the same stage in the same second).
create or replace function ops_prod.record_progress(
  p_wo_no text, p_stage text, p_qty numeric, p_work_date date,
  p_worked_by text default null, p_worked_by_employee_id uuid default null,
  p_note text default null, p_source text default 'manual', p_source_ref text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  w       ops_prod.work_orders;
  v_src   ops_prod.progress_source_t;
  v_ret   text;
  v_stages text[];
  v_done  numeric;
  v_away  numeric;
  v_where text;
begin
  begin
    v_src := coalesce(nullif(btrim(p_source), ''), 'manual')::ops_prod.progress_source_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','work_order', p_wo_no,'progress',
      'unknown_source', format('Sumber %s tidak dikenal.', p_source), jsonb_build_object('field','source'));
  end;
  -- Two doors (D147): the workshop on production.update, and a signed
  -- overtime sheet on the signature's own authority.
  if not (ops_core.has_permission('production.update')
          or (v_src = 'overtime_sheet' and ops_core.has_authority('approve_overtime'))) then
    return ops_core.refused('production','work_order', p_wo_no,'progress',
      'not_permitted','Melaporkan pekerjaan butuh akses produksi (update).');
  end if;

  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_order', p_wo_no,'progress', format('Tidak ada Job Order %s.', p_wo_no));
  end if;

  if not exists (select 1 from ops_prod.process_stages where code = p_stage) then
    select name into v_ret from ops_prod.retired_stages where code = p_stage;
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'unknown_stage',
      case when v_ret is not null
        then format('%s bukan lagi tahap di sini — barang mentah sekarang dibeli jadi, jadi yang dicatat di bengkel mulai dari Sanding / amplas. Catatan lama dengan tahap ini tetap tersimpan.', v_ret)
        else format('Tidak ada tahap %s.', p_stage) end,
      jsonb_build_object('field','stage','retired', v_ret is not null));
  end if;

  select array_agg(stage_code order by seq) into v_stages
    from ops_prod.v_work_order_stage where wo_id = w.id;
  if not (p_stage = any(coalesce(v_stages, '{}'))) then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'stage_not_on_product',
      format('Tahap %s tidak dilalui %s. Tahapnya: %s.', p_stage, coalesce(w.product_code, w.wo_no),
             array_to_string(v_stages, ' → ')),
      jsonb_build_object('field','stage','stages', to_jsonb(v_stages)));
  end if;

  if p_qty is null or p_qty = 0 then
    return ops_core.invalid('production','work_order', p_wo_no,'progress',
      'qty_required','Tidak ada yang dilaporkan.', jsonb_build_object('field','qty'));
  end if;
  if p_qty < 0 and coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'reason_required',
      'Koreksi menyebut alasannya. Angka negatif tanpa kalimat lebih buruk dari angka yang salah.',
      jsonb_build_object('field','note'));
  end if;
  if w.status <> 'OPEN' then
    return ops_core.conflict('production','work_order', p_wo_no,'progress',
      'wo_not_open', format('%s sudah %s.', w.wo_no, w.status));
  end if;
  if p_worked_by_employee_id is not null
     and not exists (select 1 from ops_hr.employees where id = p_worked_by_employee_id) then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'employee_not_found',
      'Karyawan yang dipilih tidak ada di data kepegawaian.', jsonb_build_object('field','worked_by_employee_id'));
  end if;

  -- Goods not in the building (D255, F107): the same count the board shows.
  if p_qty > 0 and w.route = 'SUBCON' then
    select coalesce(sum(l.qty - coalesce(l.returned_qty, 0)), 0) into v_away
      from ops_prod.vendor_legs l where l.wo_id = w.id;
    if w.qty - v_away <= 0 then
      select string_agg(format('%s untuk %s sejak %s', l.qty, vp.name, l.sent_on), ', ') into v_where
        from ops_prod.vendor_legs l join ops_prod.vendor_processes vp on vp.code = l.process
       where l.wo_id = w.id and l.returned_on is null;
      return ops_core.conflict('production','work_order', p_wo_no,'progress',
        case when v_where is null and not exists (select 1 from ops_prod.vendor_legs where wo_id = w.id)
             then 'not_sent_yet' else 'still_at_vendor' end,
        case when v_where is not null
             then format('Semua %s %s %s masih di vendor — %s. Catat dulu yang kembali, baru laporkan pekerjaannya.', w.qty, w.uom, w.wo_no, v_where)
             when not exists (select 1 from ops_prod.vendor_legs where wo_id = w.id)
             then format('%s dibuat vendor dan belum pernah dikirim ke sana. Barangnya belum ada.', w.wo_no)
             else format('Tidak ada satu pun %s %s di bengkel — sisanya tidak pernah kembali dari vendor.', w.uom, w.wo_no) end);
    end if;
  end if;

  -- A signed sheet posted twice adds nothing (D147).
  if p_source_ref is not null and exists (
       select 1 from ops_prod.progress_entries
        where source_ref = p_source_ref and wo_id = w.id and stage = p_stage) then
    return ops_core.noop('production','work_order', p_wo_no,'progress',
      'Lembar ini sudah pernah diposting.', jsonb_build_object('wo_no', w.wo_no));
  end if;

  select coalesce(sum(qty), 0) into v_done
    from ops_prod.progress_entries where wo_id = w.id and stage = p_stage;
  if v_done + p_qty > w.qty then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'over_order',
      format('%s untuk %s %s; %s sudah dilaporkan di tahap ini, jadi %s lagi menjadi %s.',
             w.wo_no, w.qty, w.uom, v_done, p_qty, v_done + p_qty),
      jsonb_build_object('field','qty','ordered', w.qty,'already', v_done));
  end if;
  if v_done + p_qty < 0 then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'below_zero',
      format('Koreksi itu membuat %s di bawah nol.', p_stage), jsonb_build_object('field','qty','already', v_done));
  end if;

  begin
    insert into ops_prod.progress_entries
      (wo_id, stage, qty, work_date, worked_by, worked_by_employee_id, source, source_ref, note, recorded_by)
    values (w.id, p_stage, p_qty, coalesce(p_work_date, ops_core.office_day()),
            nullif(btrim(p_worked_by), ''), p_worked_by_employee_id, v_src,
            nullif(btrim(p_source_ref), ''), nullif(btrim(p_note), ''), auth.uid());
  exception when check_violation then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'over_order', sqlerrm,
      jsonb_build_object('field','qty'));
  end;

  return ops_core.ok('production','work_order', p_wo_no,'progress',
    jsonb_build_object('wo_no', w.wo_no, 'stage', p_stage, 'qty', p_qty));
end $$;

-- ── closing ───────────────────────────────────────────────────────────────
-- Allowed before everything is finished — a customer who took eleven of twelve
-- doors is a real thing — but then it asks why.
create or replace function ops_prod.close_work_order(p_wo_no text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare w ops_prod.work_orders; v_done numeric;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','work_order', p_wo_no,'close',
      'not_permitted','Menutup Job Order butuh akses produksi (update).');
  end if;
  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_order', p_wo_no,'close', format('Tidak ada Job Order %s.', p_wo_no));
  end if;
  if w.status <> 'OPEN' then
    return ops_core.conflict('production','work_order', p_wo_no,'close',
      'already_closed', format('%s sudah %s.', w.wo_no, w.status));
  end if;
  select coalesce(completed, 0) into v_done from ops_prod.v_work_order where id = w.id;
  if v_done < w.qty and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('production','work_order', p_wo_no,'close', 'reason_required',
      format('Baru %s dari %s %s selesai. Menutupnya tetap butuh satu kalimat alasan.', v_done, w.qty, w.uom),
      jsonb_build_object('field','reason','completed', v_done,'ordered', w.qty));
  end if;
  update ops_prod.work_orders
     set status = 'DONE', note = coalesce(nullif(btrim(p_reason), ''), note)
   where id = w.id;
  return ops_core.ok('production','work_order', p_wo_no,'close',
    jsonb_build_object('wo_no', w.wo_no, 'completed', v_done, 'ordered', w.qty, 'reason', nullif(btrim(p_reason), '')));
end $$;

-- ── moving onto a newer BOM ───────────────────────────────────────────────
-- A decision with a reason, refused once anything has been built: the old
-- list is what was actually consumed (D256).
create or replace function ops_prod.repin_bom(p_wo_no text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare w ops_prod.work_orders; prod ops_prod.products; v_cur int;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','work_order', p_wo_no,'repin_bom',
      'not_permitted','Memindahkan BOM Job Order butuh akses produksi (update).');
  end if;
  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_order', p_wo_no,'repin_bom', format('Tidak ada Job Order %s.', p_wo_no));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('production','work_order', p_wo_no,'repin_bom', 'reason_required',
      'Memindahkan Job Order ke BOM versi lain mengubah angka pembandingnya. Tulis kenapa.',
      jsonb_build_object('field','reason'));
  end if;
  select * into prod from ops_prod.products where product_code = w.product_code;
  if prod.id is null then
    return ops_core.conflict('production','work_order', p_wo_no,'repin_bom', 'no_product',
      format('%s tidak menunjuk produk di katalog, jadi tidak ada BOM untuk disematkan.', w.wo_no));
  end if;
  v_cur := ops_prod.released_rev(prod.id);
  if v_cur is null then
    return ops_core.conflict('production','work_order', p_wo_no,'repin_bom', 'no_released_revision',
      format('%s belum punya BOM yang dirilis.', prod.product_code));
  end if;
  if v_cur = w.bom_rev then
    return ops_core.noop('production','work_order', p_wo_no,'repin_bom','Sudah di revisi terbaru.',
      jsonb_build_object('wo_no', w.wo_no, 'bom_rev', v_cur));
  end if;
  if w.status <> 'OPEN' then
    return ops_core.conflict('production','work_order', p_wo_no,'repin_bom', 'wo_not_open',
      format('%s sudah %s. Angka pembandingnya adalah bagian dari catatan Job Order yang selesai.', w.wo_no, w.status));
  end if;
  if exists (select 1 from ops_prod.progress_entries where wo_id = w.id and qty > 0) then
    return ops_core.conflict('production','work_order', p_wo_no,'repin_bom', 'already_started',
      format('%s sudah ada pekerjaan yang dilaporkan. Bahan yang dipakai adalah bahan rev %s; memindahkannya ke rev %s berarti membandingkan belanja yang nyata dengan daftar yang tidak pernah dipakai.',
             w.wo_no, coalesce(w.bom_rev::text, '—'), v_cur));
  end if;
  update ops_prod.work_orders set bom_rev = v_cur where id = w.id;
  return ops_core.ok('production','work_order', p_wo_no,'repin_bom',
    jsonb_build_object('wo_no', w.wo_no, 'before', w.bom_rev, 'after', v_cur, 'reason', btrim(p_reason)));
end $$;

-- ── the vendor legs ───────────────────────────────────────────────────────
-- `p_vendor` is the vendor's code or its id: the screens pick from
-- procurement's list, which hands out ids, and the leg stores the code (C12).
create or replace function ops_prod.send_to_vendor(
  p_wo_no text, p_vendor text, p_process text, p_qty numeric,
  p_expected_back date default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_procure, ops_core, pg_temp as $$
declare w ops_prod.work_orders; v ops_procure.vendors; v_proc ops_prod.vendor_process_t;
        v_out numeric; l ops_prod.vendor_legs; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('production', 'send_to_vendor', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','work_order', p_wo_no,'send',
      'not_permitted','Mengirim ke vendor butuh akses produksi (update).');
  end if;
  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_order', p_wo_no,'send', format('Tidak ada Job Order %s.', p_wo_no));
  end if;
  if w.status <> 'OPEN' then
    return ops_core.conflict('production','work_order', p_wo_no,'send', 'wo_not_open', format('%s sudah %s.', w.wo_no, w.status));
  end if;
  begin
    v_proc := p_process::ops_prod.vendor_process_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','work_order', p_wo_no,'send', 'unknown_process',
      format('Tidak ada proses vendor bernama %s.', p_process), jsonb_build_object('field','process'));
  end;
  select * into v from ops_procure.vendors where code = p_vendor or id::text = p_vendor limit 1;
  if not found then
    return ops_core.invalid('production','work_order', p_wo_no,'send', 'vendor_not_found',
      format('Tidak ada vendor %s.', p_vendor), jsonb_build_object('field','vendor_id'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('production','work_order', p_wo_no,'send', 'qty_required',
      'Berapa banyak yang dikirim?', jsonb_build_object('field','qty'));
  end if;
  if p_expected_back is not null and p_expected_back < ops_core.office_day() then
    return ops_core.invalid('production','work_order', p_wo_no,'send', 'promise_in_past',
      'Janji kembali lebih awal dari hari ini.', jsonb_build_object('field','expected_back'));
  end if;
  select coalesce(sum(qty - coalesce(returned_qty, 0)), 0) into v_out
    from ops_prod.vendor_legs where wo_id = w.id and returned_on is null;
  if v_out + p_qty > w.qty then
    return ops_core.invalid('production','work_order', p_wo_no,'send', 'over_order',
      format('%s untuk %s %s, dan %s sudah di vendor — %s lagi jadi %s.', w.wo_no, w.qty, w.uom, v_out, p_qty, v_out + p_qty),
      jsonb_build_object('field','qty','ordered', w.qty,'already_out', v_out));
  end if;

  insert into ops_prod.vendor_legs (wo_id, process, vendor_code, qty, sent_on, expected_back, note, created_by)
  values (w.id, v_proc, v.code, p_qty, ops_core.office_day(), p_expected_back, nullif(btrim(p_note), ''), auth.uid())
  returning * into l;

  res := ops_core.ok('production','vendor_leg', l.leg_no,'send',
    jsonb_build_object('wo_no', w.wo_no, 'leg_no', l.leg_no));
  return ops_core.idem_remember('production', 'send_to_vendor', p_key, res);
end $$;

create or replace function ops_prod.receive_from_vendor(
  p_leg_no text, p_returned_qty numeric, p_returned_on date default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare l ops_prod.vendor_legs; w ops_prod.work_orders; v_on date := coalesce(p_returned_on, ops_core.office_day());
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','vendor_leg', p_leg_no,'receive',
      'not_permitted','Mencatat barang kembali butuh akses produksi (update).');
  end if;
  select * into l from ops_prod.vendor_legs where leg_no = p_leg_no;
  if not found then
    return ops_core.not_found('production','vendor_leg', p_leg_no,'receive', format('Tidak ada pengiriman vendor %s.', p_leg_no));
  end if;
  select * into w from ops_prod.work_orders where id = l.wo_id;
  if l.returned_on is not null then
    return ops_core.noop('production','vendor_leg', p_leg_no,'receive','Sudah dicatat kembali.',
      jsonb_build_object('wo_no', w.wo_no));
  end if;
  if v_on < l.sent_on then
    return ops_core.invalid('production','vendor_leg', p_leg_no,'receive', 'returned_before_sent',
      format('Tanggal kembali %s lebih awal dari tanggal kirim %s.', v_on, l.sent_on), jsonb_build_object('field','returned_on'));
  end if;
  if p_returned_qty is null or p_returned_qty < 0 then
    return ops_core.invalid('production','vendor_leg', p_leg_no,'receive', 'qty_negative',
      'Jumlah kembali tidak bisa negatif.', jsonb_build_object('field','returned_qty'));
  end if;
  if p_returned_qty > l.qty then
    return ops_core.invalid('production','vendor_leg', p_leg_no,'receive', 'over_sent',
      format('Yang dikirim %s %s, yang dicatat kembali %s. Kalau vendor mengembalikan lebih, itu barang pesanan lain — catat terpisah.', l.qty, w.uom, p_returned_qty),
      jsonb_build_object('field','returned_qty','sent', l.qty));
  end if;
  update ops_prod.vendor_legs
     set returned_on = v_on, returned_qty = p_returned_qty,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = l.id;
  return ops_core.ok('production','vendor_leg', p_leg_no,'receive',
    jsonb_build_object('wo_no', w.wo_no, 'sent', l.qty, 'returned', p_returned_qty, 'short_by', l.qty - p_returned_qty));
end $$;

grant execute on function
  ops_prod.create_work_order(text, numeric, text, date, text, text, text, text, text, uuid, text),
  ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text),
  ops_prod.close_work_order(text, text),
  ops_prod.repin_bom(text, text),
  ops_prod.send_to_vendor(text, text, text, numeric, date, text, text),
  ops_prod.receive_from_vendor(text, numeric, date, text)
  to authenticated;

-- ── the order line knows its Job Orders ───────────────────────────────────
-- Appended columns only, so the view keeps its shape for every reader of 0111.
create or replace view ops_procure.v_project_line as
select
  l.*,
  p.code                          as project_code,
  s.name                          as product_name,
  s.current_rev                   as product_current_rev,
  s.draft_rev                     as product_draft_rev,
  s.production_cost               as product_production_cost,
  (s.id is not null)              as product_exists,
  coalesce(j.jobs, 0)             as job_order_count,
  coalesce(j.qty, 0)              as job_order_qty,
  coalesce(j.completed, 0)        as job_order_completed,
  j.open_jobs                     as job_order_open
from ops_procure.project_lines l
join ops_procure.projects p on p.id = l.project_id
left join ops_prod.v_product_summary s on s.product_code = l.product_code
left join lateral (
  select count(*)::int                                   as jobs,
         sum(w.qty)                                      as qty,
         sum(coalesce(w.completed, 0))                   as completed,
         count(*) filter (where w.status = 'OPEN')::int  as open_jobs
    from ops_prod.work_orders wo
    -- `v_work_order` froze `w.*` when it was created, so the new column is
    -- read off the table and the arithmetic off the view.
    join ops_prod.v_work_order w on w.id = wo.id
   where wo.project_line_id = l.id and w.status <> 'CANCELLED'
) j on true;

alter view ops_procure.v_project_line set (security_invoker = on);
grant select on ops_procure.v_project_line to authenticated;

-- A line the workshop is building is not one to delete from the order.
create or replace function ops_procure.remove_project_line(p_project_code text, p_line_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; l ops_procure.project_lines; v_jobs text;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','project', p_project_code,'remove_line',
      'not_permitted','Mengubah pesanan butuh akses proyek (update).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'remove_line',
      format('Tidak ada proyek %s.', p_project_code));
  end if;
  select * into l from ops_procure.project_lines where id = p_line_id and project_id = pr.id;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'remove_line','Baris itu tidak ada.');
  end if;
  select string_agg(wo_no, ', ' order by wo_no) into v_jobs
    from ops_prod.work_orders where project_line_id = l.id;
  if v_jobs is not null then
    return ops_core.conflict('project','project', p_project_code,'remove_line', 'has_job_orders',
      format('Baris ini sudah punya Job Order (%s). Tutup atau batalkan di produksi dulu; baris pesanan tetap menjadi catatannya.', v_jobs));
  end if;
  delete from ops_procure.project_lines where id = l.id;
  return ops_core.ok('project','project', p_project_code,'remove_line',
    jsonb_build_object('line_id', l.id), to_jsonb(l), null);
end $$;

-- ── material out to a Job Order, in one piece ─────────────────────────────
-- Every line is checked before any is written: half an issue posted and half
-- refused would leave the rack describing a trip that did not happen. Each
-- line then goes through `issue_stock` (0097), so the one rule for taking
-- material off the rack stays written once.
create or replace function ops_inv.issue_for_work_order(
  p_wo_no text, p_location text, p_lines jsonb, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare w ops_prod.work_orders; x jsonb; r jsonb; bad text[] := '{}'; v_moves jsonb := '[]'; v_neg jsonb := '[]';
        v_n int := 0; res jsonb; replayed jsonb; it ops_procure.items;
begin
  replayed := ops_core.idem_replay('inventory', 'issue_for_work_order', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','stock_move', p_wo_no,'issue',
      'not_permitted','Mengeluarkan stok perlu akses inventory.');
  end if;
  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('inventory','stock_move', p_wo_no,'issue', format('Tidak ada Job Order %s.', p_wo_no));
  end if;
  if w.status = 'CANCELLED' then
    return ops_core.conflict('inventory','stock_move', p_wo_no,'issue', 'wo_cancelled', format('%s sudah dibatalkan.', w.wo_no));
  end if;
  if not exists (select 1 from ops_inv.stock_locations where code = p_location and is_active) then
    return ops_core.invalid('inventory','stock_move', p_wo_no,'issue',
      'location_required','Bahan ini keluar dari lokasi mana?', jsonb_build_object('field','location'));
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    v_n := v_n + 1;
    select * into it from ops_procure.items where code = x->>'item_code';
    if it.code is null or it.merged_into is not null
       or not exists (select 1 from ops_inv.stocked_categories where category_code = it.category_code) then
      bad := bad || (x->>'item_code');
    end if;
  end loop;
  if v_n = 0 then
    return ops_core.invalid('inventory','stock_move', p_wo_no,'issue', 'nothing_to_issue',
      'Tidak ada barang yang dikeluarkan. Isi jumlah yang benar-benar dibawa ke bengkel — daftar dari BOM hanya usulan.',
      jsonb_build_object('field','lines'));
  end if;
  if array_length(bad, 1) > 0 then
    return ops_core.invalid('inventory','stock_move', p_wo_no,'issue', 'not_stocked',
      format('Bukan barang yang distok: %s.', array_to_string(bad, ', ')),
      jsonb_build_object('field','lines','items', to_jsonb(bad)));
  end if;

  for x in select * from jsonb_array_elements(p_lines) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    r := ops_inv.issue_stock(x->>'item_code', p_location, (x->>'qty')::numeric, w.wo_no, p_note, null);
    if not ops_core.said_ok(r) then
      raise exception 'issue_stock refused % after it was checked: %', x->>'item_code', r;
    end if;
    v_moves := v_moves || to_jsonb(r->'data'->>'move_no');
    if (r->'data'->>'went_negative')::boolean then
      v_neg := v_neg || jsonb_build_object('item_code', x->>'item_code',
        'item_name', (select name from ops_procure.items where code = x->>'item_code'),
        'on_hand_after', (r->'data'->>'on_hand_after')::numeric);
    end if;
  end loop;

  res := ops_core.ok('inventory','stock_move', w.wo_no,'issue',
    jsonb_build_object('wo_no', w.wo_no, 'move_nos', v_moves, 'issued', v_n, 'negative', v_neg));
  return ops_core.idem_remember('inventory', 'issue_for_work_order', p_key, res);
end $$;

grant execute on function ops_inv.issue_for_work_order(text, text, jsonb, text, text) to authenticated;
