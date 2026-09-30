-- 0197_prod_progress_hours.sql — a piece of work says **when**, to the hour,
-- not only on which day (D346).
--
-- The owner, evaluating the Job Order: *harus bisa mereferensikan pengerjaan
-- item oleh siapa saja, berapa banyak, dan progressnya berdasarkan waktu / tiap
-- jam.* Two of the three were already in `progress_entries` since 0062 — who
-- (`worked_by` and its link) and how many (`qty`). The third was not: the only
-- time an entry carried was `work_date`, a day, and `recorded_at`, which is when
-- somebody typed it rather than when the sanding happened. Reading `recorded_at`
-- as the hour of the work would put every piece of the afternoon at 17.00,
-- because that is when the mandor sits down with the sheet.
--
-- So each entry gets the span it was worked, **both ends or neither**:
--
--   `started_at`, `finished_at`  — moments, not wall-clock `time` columns. The
--   office clock is `ops_core.office_tz()` and it has already moved once
--   (D334, F191); a `time` without a zone would have had to be rewritten by
--   that migration, a moment did not. The screen types *07.30–08.30* on the
--   office clock and `officeStamp()` turns it into a moment.
--
-- Null on both is the state of every entry written before today and of what a
-- signed lembur sheet posts (its lines carry no hours per order), and it reads
-- *jam tidak dicatat* — never an hour guessed from `recorded_at`. The hourly
-- read files an entry under the hour it **finished** in: the pieces were done
-- then, and spreading six pieces over two hours evenly is a number nobody
-- counted.
--
-- The rest stays as 0062 made it: append-only, a correction is a negative
-- entry with a sentence. A wrong hour is corrected the same way — the pieces
-- taken back with a reason, and reported again with the right span.

alter table ops_prod.progress_entries
  add column if not exists started_at  timestamptz,
  add column if not exists finished_at timestamptz;

alter table ops_prod.progress_entries
  add constraint span_has_both_ends check ((started_at is null) = (finished_at is null)),
  add constraint span_runs_forward check (finished_at is null or finished_at > started_at),
  -- A shift, even the overnight one (0186), is not sixteen hours of one piece
  -- of work. Longer is a date typed wrong, not a long day.
  add constraint span_is_a_shift check (finished_at is null or finished_at - started_at <= interval '16 hours');

create index if not exists progress_finished_idx
  on ops_prod.progress_entries (finished_at) where finished_at is not null;

-- ── reporting work, now with its hours ────────────────────────────────────
-- The old signature goes: two overloads differing only in trailing defaults
-- make every positional call ambiguous. Every caller (the screen, the lembur
-- sheet, the smokes) passes the first nine the same way it did.
drop function if exists ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text);

create or replace function ops_prod.record_progress(
  p_wo_no text, p_stage text, p_qty numeric, p_work_date date,
  p_worked_by text default null, p_worked_by_employee_id uuid default null,
  p_note text default null, p_source text default 'manual', p_source_ref text default null,
  p_started_at timestamptz default null, p_finished_at timestamptz default null)
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
  v_day   date;
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

  -- The span (D346). Asked here, before anything about the order's state, so a
  -- span that cannot be true is named as the span and not as something else.
  if (p_started_at is null) <> (p_finished_at is null) then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_half',
      'Jam mulai dan jam selesai diisi berdua, atau dikosongkan berdua. Separuh rentang tidak menyebut jam berapa pekerjaannya.',
      jsonb_build_object('field', case when p_started_at is null then 'started_at' else 'finished_at' end));
  end if;
  v_day := coalesce(p_work_date, ops_core.office_day(p_started_at), ops_core.office_day());
  if p_started_at is not null then
    if p_finished_at <= p_started_at then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_backwards',
        'Jam selesai harus sesudah jam mulai.', jsonb_build_object('field','finished_at'));
    end if;
    if p_finished_at - p_started_at > interval '16 hours' then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_too_long',
        'Lebih dari 16 jam untuk satu laporan — tanggal atau jamnya kemungkinan salah ketik. Laporkan per jam atau per sesi kerja.',
        jsonb_build_object('field','finished_at'));
    end if;
    -- The day an entry is filed under is the day it **started**, the same
    -- reckoning the overnight shift uses (0186): a lembur from 22.00 to 01.00
    -- belongs to the evening it began.
    if ops_core.office_day(p_started_at) <> v_day then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_other_day',
        format('Jam mulainya jatuh pada %s, sedangkan tanggal kerjanya %s.', ops_core.office_day(p_started_at), v_day),
        jsonb_build_object('field','started_at'));
    end if;
    -- Pieces are reported after they are done. A few minutes of slack for a
    -- phone whose clock runs ahead.
    if p_finished_at > now() + interval '10 minutes' then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_in_future',
        'Jam selesainya belum terjadi. Laporkan pekerjaan sesudah selesai.',
        jsonb_build_object('field','finished_at'));
    end if;
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
      (wo_id, stage, qty, work_date, worked_by, worked_by_employee_id, source, source_ref, note, recorded_by,
       started_at, finished_at)
    values (w.id, p_stage, p_qty, v_day,
            nullif(btrim(p_worked_by), ''), p_worked_by_employee_id, v_src,
            nullif(btrim(p_source_ref), ''), nullif(btrim(p_note), ''), auth.uid(),
            p_started_at, p_finished_at);
  exception when check_violation then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'over_order', sqlerrm,
      jsonb_build_object('field','qty'));
  end;

  return ops_core.ok('production','work_order', p_wo_no,'progress',
    jsonb_build_object('wo_no', w.wo_no, 'stage', p_stage, 'qty', p_qty,
                       'started_at', p_started_at, 'finished_at', p_finished_at));
end $$;

grant execute on function
  ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text, timestamptz, timestamptz)
  to authenticated;
revoke execute on function
  ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text, timestamptz, timestamptz)
  from public;

analyze ops_prod.progress_entries;
