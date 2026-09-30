-- 0198_prod_work_slots.sql — the timeslot: who worked on what, for how long
-- (D347).
--
-- The owner, answering Q-D346a/b with the shape he actually wants:
--
--     item: AA-02   Qty: 10/100   sanding: 1   finishing: 2   complete: 10
--       — for the project manager
--     07.30-09.30  AA-02  rakit pintu     karjo, toha
--     09.30-11.30  AA-02  tambah engsel   karjo
--       — for productivity monitoring
--
--     *pada dasarnya menjelaskan siapa mengerjakan apa, item ini selesai
--     berapa lama, apakah mereka produktif atau tidak, berapa item yang bisa
--     dikerjakan per orang.*
--
-- The first is a reading of what 0062 already counts. The second is a record
-- that did not exist: `progress_entries` is **pieces past a stage**, one name
-- per row, and *tambah engsel* moves no piece past any stage while still being
-- two hours of Karjo's day on AA-02. So the timeslot is its own row:
--
--   `work_slots`          one span of work on one Job Order, in the floor's
--                         own words (`activity`), with the minutes it took;
--   `work_slot_workers`   everybody who was on it — a crew is a list, not a
--                         name with a comma in it.
--
-- A slot **may** also say that pieces finished a stage (`stage` + `qty`). Then
-- it posts one progress entry through `record_progress`, carrying `slot_id`,
-- so the board, the order line, the job trail and the KPI card keep reading
-- the one table they already read. A slot never *is* a progress entry: the
-- count and the labour answer different questions and are two rows.
--
-- The overtime sheet posts per person now (Q-D346b): one slot per line, the
-- line's own person, hours and task. Its idempotency is the line, not the
-- sheet — the old `(source_ref, wo_id, stage)` claim is exactly what forced two
-- people's work into one entry named *Sakirin, Karjo*.

insert into ops_core.doc_prefixes (prefix, what) values ('tsl', 'timeslot kerja produksi')
on conflict (prefix) do nothing;

-- A number is padded, and `lpad` **truncates** a longer string to the width it
-- is given: the hundredth `jo` of a day would have been numbered `_10` and
-- collided with the tenth. Timeslots are the first kind that plausibly reaches
-- a hundred a day (twenty people, five slots each), so the width is three for
-- them and never narrower than the number itself for anybody.
create or replace function ops_core.next_doc_number(p_prefix text, p_at timestamptz default now())
returns text
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  d date := ops_core.office_day(p_at);
  n int;
  width int := case when p_prefix in ('trx','tsl') then 3 else 2 end;
begin
  insert into ops_core.doc_numbers (prefix, day, seq)
       values (p_prefix, d, 1)
  on conflict (prefix, day)
    do update set seq = ops_core.doc_numbers.seq + 1
    returning seq into n;

  return p_prefix || '-' || to_char(d, 'YY-MM-DD') || '_' || lpad(n::text, greatest(width, length(n::text)), '0');
end $$;

-- ── the slot ──────────────────────────────────────────────────────────────
create table ops_prod.work_slots (
  id            uuid primary key default gen_random_uuid(),
  slot_no       text not null unique default ops_core.next_doc_number('tsl'),
  wo_id         uuid not null references ops_prod.work_orders(id),
  -- The day it started (the overnight shift's reckoning, 0186).
  work_date     date not null,
  -- The span on the office clock, both ends or neither. Neither is the
  -- lembur sheet, which says *3 jam* and not from when.
  started_at    timestamptz,
  finished_at   timestamptz,
  -- Always known: from the span when there is one, typed when there is not.
  -- Person-hours are what productivity is measured in, so a slot without a
  -- duration would be a slot that measures nothing.
  minutes       int not null check (minutes > 0 and minutes <= 960),
  -- The floor's own words: *rakit pintu*, *tambah engsel*. Not a stage code —
  -- most of what happens in a day moves no piece past a stage.
  activity      text not null check (length(btrim(activity)) > 0),
  -- Optional, together: pieces that finished one of the order's stages in
  -- this slot. Posted to `progress_entries` by the seam.
  stage         text,
  qty           numeric check (qty is null or qty > 0),
  source        ops_prod.progress_source_t not null default 'manual',
  -- The lembur sheet number and its line, the idempotency claim (D147, D347).
  source_ref    text,
  source_line   text,
  note          text,
  -- A wrong slot is cancelled with a sentence, never deleted (A5). Its pieces
  -- are taken back with a negative progress entry carrying the same reason.
  voided_at     timestamptz,
  voided_by     uuid references ops_core.users(id),
  void_reason   text,
  recorded_by   uuid references ops_core.users(id),
  recorded_at   timestamptz not null default now(),

  constraint slot_span_has_both_ends check ((started_at is null) = (finished_at is null)),
  constraint slot_span_runs_forward check (finished_at is null or finished_at > started_at),
  constraint slot_minutes_match_span check (
    started_at is null or minutes = round(extract(epoch from finished_at - started_at) / 60)::int),
  constraint slot_qty_names_its_stage check (qty is null or stage is not null),
  constraint slot_sheet_names_its_line check (
    source <> 'overtime_sheet' or (source_ref is not null and source_line is not null)),
  constraint slot_void_is_complete check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);

create index work_slots_wo_idx on ops_prod.work_slots (wo_id, work_date);
create index work_slots_day_idx on ops_prod.work_slots (work_date);
-- One lembur line posts once (D147), whatever order it is replayed in.
create unique index work_slots_sheet_line_once on ops_prod.work_slots (source_ref, source_line)
  where source_ref is not null;

create table ops_prod.work_slot_workers (
  slot_id                uuid not null references ops_prod.work_slots(id),
  seq                    int not null check (seq > 0),
  -- The name as written, kept beside the link and never replaced by it (D264).
  worked_by              text not null check (length(btrim(worked_by)) > 0),
  worked_by_employee_id  uuid references ops_hr.employees(id),
  primary key (slot_id, seq)
);

create unique index work_slot_worker_once_emp on ops_prod.work_slot_workers (slot_id, worked_by_employee_id)
  where worked_by_employee_id is not null;
create unique index work_slot_worker_once_name on ops_prod.work_slot_workers (slot_id, lower(btrim(worked_by)));
create index work_slot_workers_emp_idx on ops_prod.work_slot_workers (worked_by_employee_id);

-- ── the count knows which slot it came from ───────────────────────────────
alter table ops_prod.progress_entries
  add column if not exists slot_id uuid references ops_prod.work_slots(id);
create index if not exists progress_slot_idx on ops_prod.progress_entries (slot_id) where slot_id is not null;

-- The sheet claim (D147) was `(source_ref, wo_id, stage)`: one entry per sheet,
-- order and stage — which is why two people's night was one row. It still
-- holds for what a sheet posted **before** this (no slot); what a slot posts
-- is claimed by the slot's own line index above.
drop index if exists ops_prod.progress_sheet_once_idx;
create unique index progress_sheet_once_idx
  on ops_prod.progress_entries (source_ref, wo_id, stage)
  where source_ref is not null and slot_id is null;

-- ── reporting pieces, now able to say which slot they came from ───────────
drop function if exists ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text, timestamptz, timestamptz);

create or replace function ops_prod.record_progress(
  p_wo_no text, p_stage text, p_qty numeric, p_work_date date,
  p_worked_by text default null, p_worked_by_employee_id uuid default null,
  p_note text default null, p_source text default 'manual', p_source_ref text default null,
  p_started_at timestamptz default null, p_finished_at timestamptz default null,
  p_slot_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  w       ops_prod.work_orders;
  sl      ops_prod.work_slots;
  v_src   ops_prod.progress_source_t;
  v_ret   text;
  v_stages text[];
  v_done  numeric;
  v_away  numeric;
  v_where text;
  v_day   date;
  v_by    text := nullif(btrim(p_worked_by), '');
  v_emp   uuid := p_worked_by_employee_id;
  v_crew  boolean := false;
  v_n     int;
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

  -- From a slot (D347): the slot is the authority for who, when and which
  -- order. A positive count posts once per slot; a negative one only takes
  -- back a slot that has been cancelled.
  if p_slot_id is not null then
    select * into sl from ops_prod.work_slots where id = p_slot_id;
    if not found or sl.wo_id <> w.id then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'slot_not_found',
        'Timeslot itu tidak ada di Job Order ini.', jsonb_build_object('field','slot_id'));
    end if;
    if p_qty > 0 and exists (select 1 from ops_prod.progress_entries where slot_id = sl.id) then
      return ops_core.noop('production','work_order', p_wo_no,'progress',
        'Timeslot ini sudah memposting jumlahnya.', jsonb_build_object('wo_no', w.wo_no));
    end if;
    if p_qty < 0 and sl.voided_at is null then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'slot_not_voided',
        'Jumlah dari timeslot hanya ditarik lewat pembatalan timeslot-nya.', jsonb_build_object('field','slot_id'));
    end if;
    select count(*), string_agg(worked_by, ', ' order by seq),
           (array_agg(worked_by_employee_id order by seq))[1]
      into v_n, v_by, v_emp
      from ops_prod.work_slot_workers where slot_id = sl.id;
    -- A crew is *not one person* — the state 0062 made for exactly this.
    v_crew := v_n > 1;
    if v_crew then v_emp := null; end if;
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

  -- The span (D346).
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
    if ops_core.office_day(p_started_at) <> v_day then
      return ops_core.invalid('production','work_order', p_wo_no,'progress', 'span_other_day',
        format('Jam mulainya jatuh pada %s, sedangkan tanggal kerjanya %s.', ops_core.office_day(p_started_at), v_day),
        jsonb_build_object('field','started_at'));
    end if;
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
  if v_emp is not null
     and not exists (select 1 from ops_hr.employees where id = v_emp) then
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

  -- A signed sheet posted twice adds nothing (D147) — the pre-slot claim.
  if p_slot_id is null and p_source_ref is not null and exists (
       select 1 from ops_prod.progress_entries
        where source_ref = p_source_ref and wo_id = w.id and stage = p_stage and slot_id is null) then
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
      (wo_id, stage, qty, work_date, worked_by, worked_by_employee_id, worked_by_not_a_person,
       source, source_ref, note, recorded_by, started_at, finished_at, slot_id)
    values (w.id, p_stage, p_qty, v_day, v_by, v_emp, v_crew, v_src,
            nullif(btrim(p_source_ref), ''), nullif(btrim(p_note), ''), auth.uid(),
            p_started_at, p_finished_at, p_slot_id);
  exception when check_violation then
    return ops_core.invalid('production','work_order', p_wo_no,'progress', 'over_order', sqlerrm,
      jsonb_build_object('field','qty'));
  end;

  return ops_core.ok('production','work_order', p_wo_no,'progress',
    jsonb_build_object('wo_no', w.wo_no, 'stage', p_stage, 'qty', p_qty,
                       'started_at', p_started_at, 'finished_at', p_finished_at, 'slot_id', p_slot_id));
end $$;

-- ── recording a timeslot ──────────────────────────────────────────────────
--
-- `p_workers` is `[{"name": "Karjo", "employee_id": "…"}, {"name": "Toha"}]`.
-- Picking from the list links; typing a name does not (D264).
create or replace function ops_prod.record_work_slot(
  p_wo_no text, p_activity text, p_workers jsonb,
  p_work_date date default null,
  p_started_at timestamptz default null, p_finished_at timestamptz default null,
  p_minutes int default null,
  p_stage text default null, p_qty numeric default null,
  p_note text default null, p_source text default 'manual',
  p_source_ref text default null, p_source_line text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  w        ops_prod.work_orders;
  sl       ops_prod.work_slots;
  v_src    ops_prod.progress_source_t;
  v_day    date;
  v_min    int;
  v_stages text[];
  x        jsonb;
  v_name   text;
  v_emp    uuid;
  v_names  text[] := '{}';
  v_emps   uuid[] := '{}';
  v_seq    int := 0;
  r        jsonb;
  v_refusal jsonb;
  res      jsonb;
  replayed jsonb;
begin
  replayed := ops_core.idem_replay('production', 'record_work_slot', p_key);
  if replayed is not null then return replayed; end if;

  begin
    v_src := coalesce(nullif(btrim(p_source), ''), 'manual')::ops_prod.progress_source_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','work_slot', p_wo_no,'record',
      'unknown_source', format('Sumber %s tidak dikenal.', p_source), jsonb_build_object('field','source'));
  end;
  if not (ops_core.has_permission('production.update')
          or (v_src = 'overtime_sheet' and ops_core.has_authority('approve_overtime'))) then
    return ops_core.refused('production','work_slot', p_wo_no,'record',
      'not_permitted','Mencatat timeslot butuh akses produksi (update).');
  end if;

  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_slot', p_wo_no,'record', format('Tidak ada Job Order %s.', p_wo_no));
  end if;

  -- A lembur line posts once (D147, D347).
  -- The answer names the slot that already holds it, so a caller reads it
  -- back exactly as it would a new one.
  select * into sl from ops_prod.work_slots where source_ref = p_source_ref and source_line = p_source_line;
  if p_source_ref is not null and sl.id is not null then
    return ops_core.noop('production','work_slot', p_wo_no,'record',
      'Baris lembur ini sudah pernah diposting.', jsonb_build_object('wo_no', w.wo_no, 'slot_no', sl.slot_no));
  end if;
  if v_src = 'overtime_sheet' and (p_source_ref is null or p_source_line is null) then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'sheet_line_required',
      'Timeslot dari lembar lembur menyebut lembar dan barisnya.', jsonb_build_object('field','source_line'));
  end if;

  if coalesce(btrim(p_activity), '') = '' then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'activity_required',
      'Apa yang dikerjakan? Tulis dengan kata-kata bengkel — misalnya *rakit pintu*, *tambah engsel*.',
      jsonb_build_object('field','activity'));
  end if;

  -- Who. At least one, each once.
  if jsonb_typeof(coalesce(p_workers, 'null')) <> 'array' or jsonb_array_length(p_workers) = 0 then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'workers_required',
      'Siapa yang mengerjakan? Timeslot tanpa orang tidak menjelaskan siapa mengerjakan apa.',
      jsonb_build_object('field','workers'));
  end if;
  for x in select * from jsonb_array_elements(p_workers) loop
    v_name := nullif(btrim(coalesce(x->>'name', '')), '');
    v_emp := nullif(x->>'employee_id', '')::uuid;
    if v_emp is not null then
      select coalesce(v_name, full_name) into v_name from ops_hr.employees where id = v_emp;
      if not found then
        return ops_core.invalid('production','work_slot', p_wo_no,'record', 'employee_not_found',
          'Karyawan yang dipilih tidak ada di data kepegawaian.', jsonb_build_object('field','workers'));
      end if;
    end if;
    if v_name is null then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'worker_name_required',
        'Setiap orang di timeslot punya nama.', jsonb_build_object('field','workers'));
    end if;
    if lower(v_name) = any(v_names) or (v_emp is not null and v_emp = any(v_emps)) then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'worker_twice',
        format('%s tercatat dua kali di timeslot yang sama.', v_name), jsonb_build_object('field','workers'));
    end if;
    v_names := v_names || lower(v_name);
    if v_emp is not null then v_emps := v_emps || v_emp; end if;
  end loop;

  -- When, and for how long.
  if (p_started_at is null) <> (p_finished_at is null) then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_half',
      'Jam mulai dan jam selesai diisi berdua, atau dikosongkan berdua.',
      jsonb_build_object('field', case when p_started_at is null then 'started_at' else 'finished_at' end));
  end if;
  v_day := coalesce(p_work_date, ops_core.office_day(p_started_at), ops_core.office_day());
  if p_started_at is not null then
    if p_finished_at <= p_started_at then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_backwards',
        'Jam selesai harus sesudah jam mulai.', jsonb_build_object('field','finished_at'));
    end if;
    if p_finished_at - p_started_at > interval '16 hours' then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_too_long',
        'Lebih dari 16 jam untuk satu timeslot — tanggal atau jamnya kemungkinan salah ketik.',
        jsonb_build_object('field','finished_at'));
    end if;
    if ops_core.office_day(p_started_at) <> v_day then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_other_day',
        format('Jam mulainya jatuh pada %s, sedangkan tanggal kerjanya %s.', ops_core.office_day(p_started_at), v_day),
        jsonb_build_object('field','started_at'));
    end if;
    if p_finished_at > now() + interval '10 minutes' then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_in_future',
        'Jam selesainya belum terjadi. Catat timeslot sesudah selesai.', jsonb_build_object('field','finished_at'));
    end if;
    v_min := round(extract(epoch from p_finished_at - p_started_at) / 60)::int;
  else
    v_min := p_minutes;
    if v_min is null or v_min <= 0 then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'duration_required',
        'Berapa lama? Isi jam mulai–selesai, atau lamanya dalam jam.', jsonb_build_object('field','started_at'));
    end if;
    if v_min > 960 then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'span_too_long',
        'Lebih dari 16 jam untuk satu timeslot.', jsonb_build_object('field','minutes'));
    end if;
  end if;

  -- What it finished, if anything.
  if p_qty is not null and p_qty <= 0 then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'qty_positive',
      'Jumlah selesai diisi kalau ada yang selesai, dan tidak pernah negatif. Koreksi jumlah dicatat lewat koreksi, bukan timeslot.',
      jsonb_build_object('field','qty'));
  end if;
  if p_qty is not null and nullif(btrim(p_stage), '') is null then
    return ops_core.invalid('production','work_slot', p_wo_no,'record', 'stage_required',
      'Selesai di tahap mana? Jumlah tanpa tahap tidak menggerakkan papan.', jsonb_build_object('field','stage'));
  end if;
  if nullif(btrim(p_stage), '') is not null then
    select array_agg(stage_code order by seq) into v_stages
      from ops_prod.v_work_order_stage where wo_id = w.id;
    if not (p_stage = any(coalesce(v_stages, '{}'))) then
      return ops_core.invalid('production','work_slot', p_wo_no,'record', 'stage_not_on_product',
        format('Tahap %s tidak dilalui %s. Tahapnya: %s.', p_stage, coalesce(w.product_code, w.wo_no),
               array_to_string(v_stages, ' → ')),
        jsonb_build_object('field','stage','stages', to_jsonb(v_stages)));
    end if;
  end if;

  if w.status <> 'OPEN' then
    return ops_core.conflict('production','work_slot', p_wo_no,'record',
      'wo_not_open', format('%s sudah %s.', w.wo_no, w.status));
  end if;

  -- Written together or not at all: a slot whose pieces the order refuses
  -- (over the quantity, all at the vendor) is refused whole, with the order's
  -- own sentence.
  begin
    insert into ops_prod.work_slots
      (wo_id, work_date, started_at, finished_at, minutes, activity, stage, qty,
       source, source_ref, source_line, note, recorded_by)
    values (w.id, v_day, p_started_at, p_finished_at, v_min, btrim(p_activity),
            nullif(btrim(p_stage), ''), p_qty, v_src, nullif(btrim(p_source_ref), ''),
            nullif(btrim(p_source_line), ''), nullif(btrim(p_note), ''), auth.uid())
    returning * into sl;

    for x in select * from jsonb_array_elements(p_workers) loop
      v_seq := v_seq + 1;
      v_emp := nullif(x->>'employee_id', '')::uuid;
      v_name := nullif(btrim(coalesce(x->>'name', '')), '');
      if v_name is null then select full_name into v_name from ops_hr.employees where id = v_emp; end if;
      insert into ops_prod.work_slot_workers (slot_id, seq, worked_by, worked_by_employee_id)
      values (sl.id, v_seq, v_name, v_emp);
    end loop;

    if sl.qty is not null then
      r := ops_prod.record_progress(w.wo_no, sl.stage, sl.qty, sl.work_date,
             p_note => coalesce(sl.note, format('Timeslot %s — %s', sl.slot_no, sl.activity)),
             p_source => v_src::text, p_source_ref => sl.source_ref,
             p_started_at => sl.started_at, p_finished_at => sl.finished_at, p_slot_id => sl.id);
      if not ops_core.said_ok(r) then
        v_refusal := r;
        raise exception 'slot refused by the order' using errcode = 'P0S01';
      end if;
    end if;
  exception when sqlstate 'P0S01' then
    return v_refusal;
  end;

  res := ops_core.ok('production','work_slot', sl.slot_no,'record',
    jsonb_build_object('slot_no', sl.slot_no, 'wo_no', w.wo_no, 'minutes', sl.minutes,
                       'workers', v_seq, 'posted', sl.qty is not null));
  return ops_core.idem_remember('production', 'record_work_slot', p_key, res);
end $$;

-- ── cancelling one ────────────────────────────────────────────────────────
create or replace function ops_prod.void_work_slot(p_slot_no text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare sl ops_prod.work_slots; w ops_prod.work_orders; r jsonb; v_refusal jsonb; v_posted numeric;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','work_slot', p_slot_no,'void',
      'not_permitted','Membatalkan timeslot butuh akses produksi (update).');
  end if;
  select * into sl from ops_prod.work_slots where slot_no = p_slot_no;
  if not found then
    return ops_core.not_found('production','work_slot', p_slot_no,'void', format('Tidak ada timeslot %s.', p_slot_no));
  end if;
  if sl.voided_at is not null then
    return ops_core.noop('production','work_slot', p_slot_no,'void', 'Sudah dibatalkan.',
      jsonb_build_object('slot_no', sl.slot_no));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('production','work_slot', p_slot_no,'void', 'reason_required',
      'Membatalkan timeslot menyebut alasannya — catatannya tetap ada, dan kalimat itulah yang menjelaskannya.',
      jsonb_build_object('field','reason'));
  end if;
  select * into w from ops_prod.work_orders where id = sl.wo_id;

  begin
    update ops_prod.work_slots
       set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
     where id = sl.id;
    -- Whatever this slot put on the board comes back off it, as an entry.
    select coalesce(sum(qty), 0) into v_posted from ops_prod.progress_entries where slot_id = sl.id;
    if v_posted > 0 then
      r := ops_prod.record_progress(w.wo_no, sl.stage, -v_posted, sl.work_date,
             p_note => format('Timeslot %s dibatalkan: %s', sl.slot_no, btrim(p_reason)),
             p_source => sl.source::text, p_source_ref => sl.source_ref,
             p_started_at => sl.started_at, p_finished_at => sl.finished_at, p_slot_id => sl.id);
      if not ops_core.said_ok(r) then
        v_refusal := r;
        raise exception 'void refused by the order' using errcode = 'P0S01';
      end if;
    end if;
  exception when sqlstate 'P0S01' then
    return v_refusal;
  end;

  return ops_core.ok('production','work_slot', sl.slot_no,'void',
    jsonb_build_object('slot_no', sl.slot_no, 'wo_no', w.wo_no, 'taken_back', v_posted));
end $$;

-- ── access ────────────────────────────────────────────────────────────────
-- Read by anyone signed in, like `progress_entries`; written only through the
-- seams above, which decide inside.
alter table ops_prod.work_slots enable row level security;
alter table ops_prod.work_slot_workers enable row level security;
create policy work_slots_read on ops_prod.work_slots for select to authenticated using (true);
create policy work_slot_workers_read on ops_prod.work_slot_workers for select to authenticated using (true);
grant select on ops_prod.work_slots, ops_prod.work_slot_workers to authenticated;

grant execute on function
  ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text, timestamptz, timestamptz, uuid),
  ops_prod.record_work_slot(text, text, jsonb, date, timestamptz, timestamptz, int, text, numeric, text, text, text, text, text),
  ops_prod.void_work_slot(text, text)
  to authenticated;
revoke execute on function
  ops_prod.record_progress(text, text, numeric, date, text, uuid, text, text, text, timestamptz, timestamptz, uuid),
  ops_prod.record_work_slot(text, text, jsonb, date, timestamptz, timestamptz, int, text, numeric, text, text, text, text, text),
  ops_prod.void_work_slot(text, text)
  from public;

analyze ops_prod.work_slots;
analyze ops_prod.work_slot_workers;
analyze ops_prod.progress_entries;
