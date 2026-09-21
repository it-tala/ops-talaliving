-- hr — the overtime sheet, and the two signatures that decide it
-- (D146, D147, D154).
--
--   REFUSALS     a sheet with no purpose; a name with no hours, no task, or
--                already on the lembar; **a name added to a sheet somebody has
--                signed**; a leader's signature on a staff session, before
--                HRD, twice, or **without the surat attached**; a leader
--                signing with a module grant instead of the authority; a
--                decline with no sentence; an empty sheet decided
--   DERIVATIONS  the stage machine walks `waiting_hrd` → `waiting_surat` →
--                `waiting_leader` → `approved`; a staff session is decided by
--                HRD alone and lands on `paid_checked` or `unpaid`; a
--                production sheet HRD turns down is `declined` outright; the
--                paper form matches **by name** and counts its four kinds of
--                skip apart — **two people of one name is a question, not a
--                guess**; an approved sheet announces what was made
--
-- Worked out first: five form rows → 2 added · 1 unknown · 1 ambiguous · 1 blank

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005101','hrd51@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005102','bos51@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000005103','hrd51b@talaliving.com','{"full_name":"HRD Lain"}'),
  ('ffffffff-0000-0000-0000-000000005104','it51@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005101','hrd','write'),
  -- The leader may **see** the sheets and may not check the hours: `read`, not
  -- `update`. The signature is an **authority**, granted on its own and never
  -- implied by a level (D24, D147) — which is what the pair below proves.
  ('ffffffff-0000-0000-0000-000000005102','hrd','read'),
  -- And this one holds the module and not the authority, which is the pair
  -- that makes the distinction provable.
  ('ffffffff-0000-0000-0000-000000005103','hrd','admin'),
  -- The outbox is IT's to read (`0003`), not the module's.
  ('ffffffff-0000-0000-0000-000000005104','it','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000005102','approve_overtime');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005101';

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate) values
  ('aaaa5100-0000-0000-0000-0000000000e1','B-0012','Joko Widodo','monthly', 4500000),
  ('aaaa5100-0000-0000-0000-0000000000e2','B-0007','Siti  Aminah','daily',    180000),
  -- Two people of one name. The form carries only the name, and this is the
  -- pair that must be reported rather than resolved.
  ('aaaa5100-0000-0000-0000-0000000000e3','B-0021','Sumiati','daily',         170000),
  ('aaaa5100-0000-0000-0000-0000000000e4','B-0033','Sumiati','daily',         170000);

/* ── REFUSAL: a sheet with no reason for existing ──────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.create_overtime_sheet('production','2026-09-18','  ');
  assert a -> 'error' ->> 'code' = 'purpose_required',
    'lembur tanpa alasan adalah kebiasaan, bukan keputusan, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: opening one, and the stage it starts at ───────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.create_overtime_sheet('production','2026-09-18','kejar kirim Astoria hari Jumat','k-51-sheet');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'sheet_no' like 'lbr-%', 'got ' || coalesce(a -> 'data' ->> 'sheet_no','(null)');
  assert a -> 'data' ->> 'stage' = 'waiting_hrd',
    'a fresh production sheet waits for HRD, got ' || coalesce(a -> 'data' ->> 'stage','(null)');

  a := ops_hr.create_overtime_sheet('production','2026-09-18','x','k-51-sheet');
  assert a ->> 'outcome' = 'duplicate', 'a retry is one sheet, got ' || coalesce(a ->> 'outcome','(null)');
end $$;

/* ── REFUSAL and DERIVATION: the names on it ───────────────────────────── */
do $$
declare a jsonb; v_no text; n int;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets;

  a := ops_hr.add_overtime_line(v_no,'B-0012', 0,'amplas');
  assert a -> 'error' ->> 'code' = 'hours_required', 'lembur nol jam bukan lembur, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.add_overtime_line(v_no,'B-0012', 3,'   ');
  assert a -> 'error' ->> 'code' = 'task_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.add_overtime_line(v_no,'B-9999', 3,'amplas');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The line carries what was made, typed once rather than twice (D147).
  a := ops_hr.add_overtime_line(v_no,'B-0012', 3,'amplas pintu','SPK-51-01','FINISHING', 6);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  a := ops_hr.add_overtime_line(v_no,'B-0012', 2,'lagi');
  assert a -> 'error' ->> 'code' = 'already_on_sheet', 'one line per person, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.add_overtime_line(v_no,'B-0007', 4,'packing','SPK-51-01','PACKING', 6);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select count(*) into n from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id where s.sheet_no = v_no;
  assert n = 2, 'two names, got ' || n;
end $$;

/* ── DERIVATION: the paper form, and its four kinds of skip ────────────── */
do $$
declare a jsonb; v_form text; n int;
begin
  a := ops_hr.create_overtime_sheet('production','2026-09-19','lembur borongan rak');
  v_form := a -> 'data' ->> 'sheet_no';

  a := ops_hr.import_overtime_form(v_form,'form-lembur-19.jpg','[]'::jsonb);
  assert a -> 'error' ->> 'code' = 'empty_form', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.import_overtime_form(v_form,'form-lembur-19.jpg', $j$[
    {"no":"1","name":"joko  widodo","description":"potong","jam":"3","gaji":"75000"},
    {"no":"2","name":"SITI AMINAH","description":"rakit","jam":"2.5","gaji":"60000"},
    {"no":"3","name":"Sumiati","description":"amplas","jam":"3","gaji":"70000"},
    {"no":"4","name":"Budi Hartono","description":"angkut","jam":"2","gaji":"50000"},
    {"no":"5","name":"Joko Widodo","description":"lanjut","jam":"","gaji":"20000"}
  ]$j$::jsonb,'k-51-form');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- Matched on a normalised name: the form is filled in by hand and the
  -- capitalisation and the double space are nobody's fault.
  assert (a -> 'data' ->> 'added')::int = 2,
    'joko and siti, however they were written, got ' || coalesce(a -> 'data' ->> 'added','(null)');

  -- **Two people called Sumiati is a question for HRD.** The demo''s name map
  -- silently kept the last one; a join would have made two lines and doubled
  -- the night.
  assert a -> 'data' -> 'ambiguous' = '["Sumiati"]'::jsonb,
    'got ' || coalesce((a -> 'data' -> 'ambiguous')::text,'(null)');
  assert a -> 'data' -> 'unknown' = '["Budi Hartono"]'::jsonb,
    'a name nobody recognises is reported, never created, got '
    || coalesce((a -> 'data' -> 'unknown')::text,'(null)');
  -- The JAM column was blank. The demo wrote nought hours, which this table
  -- refuses and should — *lembur nol jam bukan lembur* is its own rule one
  -- function up, and an import must not be the road around it.
  assert a -> 'data' -> 'no_hours' = '["Joko Widodo"]'::jsonb,
    'got ' || coalesce((a -> 'data' -> 'no_hours')::text,'(null)');
  assert (a -> 'data' ->> 'skipped')::int = 3, 'and skipped is their sum, got '
    || coalesce(a -> 'data' ->> 'skipped','(null)');

  select count(*) into n from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id where s.sheet_no = v_form;
  assert n = 2, 'two lines on the paper sheet, got ' || n;
  -- The GAJI column travels with the line (D154).
  assert (select form_amount from ops_hr.overtime_lines l
           join ops_hr.overtime_sheets s on s.id = l.sheet_id
          where s.sheet_no = v_form and l.employee_id = 'aaaa5100-0000-0000-0000-0000000000e1') = 75000,
    'the form''s own figure is kept';

  -- Reading the same form again adds nothing.
  a := ops_hr.import_overtime_form(v_form,'form-lembur-19.jpg', $j$[
    {"no":"1","name":"Joko Widodo","description":"potong","jam":"3","gaji":"75000"}
  ]$j$::jsonb);
  assert (a -> 'data' ->> 'added')::int = 0, 'got ' || coalesce(a -> 'data' ->> 'added','(null)');
  assert (a -> 'data' ->> 'duplicate')::int = 1, 'got ' || coalesce(a -> 'data' ->> 'duplicate','(null)');

  -- **The key is the stronger promise.** The read above is the function
  -- reaching the same answer twice by looking; this is the envelope handed
  -- back without the looking. Sent with the first call's key, it must answer
  -- with the first call's tally — a fresh execution of this one row would
  -- report `added = 0`, so the two are told apart.
  a := ops_hr.import_overtime_form(v_form,'form-lembur-19.jpg', $j$[
    {"no":"1","name":"Joko Widodo","description":"potong","jam":"3","gaji":"75000"}
  ]$j$::jsonb,'k-51-form');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert (a -> 'data' ->> 'added')::int = 2,
    'the remembered answer, not a fresh one, got '
    || coalesce(a -> 'data' ->> 'added','(null)');

  select count(*) into n from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id where s.sheet_no = v_form;
  assert n = 2, 'and the replay added nothing, got ' || n;
end $$;

/* ── REFUSAL: who may sign, and in which order ─────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005103';
do $$
declare a jsonb; v_no text;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets order by sheet_no limit 1;
  assert ops_core.has_permission('hrd.update'), 'this one runs HR';
  assert not ops_core.has_authority('approve_overtime'), 'and holds no signature';

  -- **The distinction D24 exists for.** A module level, however high, is not
  -- the leader's signature.
  a := ops_hr.decide_overtime_sheet(v_no,'leader', true);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%approve_overtime%',
    'and the message names what is missing, got ' || coalesce(a -> 'error' ->> 'message','(null)');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005102';
do $$
declare a jsonb; v_no text;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets order by sheet_no limit 1;
  -- The leader holds the signature and only a read of the module, and signs
  -- after HRD rather than instead of.
  a := ops_hr.decide_overtime_sheet(v_no,'leader', true);
  assert a -> 'error' ->> 'code' = 'hrd_first',
    'pimpinan menandatangani setelah HRD, bukan menggantikannya, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: the machine walks ─────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005101';
do $$
declare a jsonb; v_no text;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets order by sheet_no limit 1;

  a := ops_hr.decide_overtime_sheet(v_no,'hrd', true);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- No surat yet, so the board says what is missing rather than that it is ready.
  assert a -> 'data' ->> 'stage' = 'waiting_surat', 'got ' || coalesce(a -> 'data' ->> 'stage','(null)');

  a := ops_hr.decide_overtime_sheet(v_no,'hrd', true);
  assert a -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- **A signed sheet is closed.** A name added now would mean the signature no
  -- longer points at what was signed.
  a := ops_hr.add_overtime_line(v_no,'B-0021', 2,'ikut');
  assert a -> 'error' ->> 'code' = 'sheet_closed', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.import_overtime_form(v_no,'susulan.jpg','[{"name":"Sumiati","jam":"2"}]'::jsonb);
  assert a -> 'error' ->> 'code' = 'sheet_closed', 'and the other road is closed too, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL: what the leader is actually signing ──────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005102';
do $$
declare a jsonb; v_no text;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets order by sheet_no limit 1;

  a := ops_hr.decide_overtime_sheet(v_no,'leader', true);
  assert a -> 'error' ->> 'code' = 'surat_required',
    'HRD checked the hours; without the paper what is approved is a number (D147), got '
    || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

-- Filing the surat is the **documents** road and there is only one (ADR-010),
-- so the fixture writes the link the way that seam does.
reset role;
insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('bbbb5100-0000-0000-0000-0000000000f1','https://files.talaliving.test/surat-lembur-18.jpg',
   'surat-lembur-18.jpg','ffffffff-0000-0000-0000-000000005101');
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
select 'bbbb5100-0000-0000-0000-0000000000f1','overtime_sheet', s.sheet_no,'surat_lembur',
       'ffffffff-0000-0000-0000-000000005101'
  from ops_hr.overtime_sheets s order by s.sheet_no limit 1;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005102';

do $$
declare a jsonb; v_no text; v_payload jsonb;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets order by sheet_no limit 1;
  assert (select stage from ops_hr.v_overtime_stage where sheet_no = v_no) = 'waiting_leader',
    'with the surat attached the board says whose move it is';

  a := ops_hr.decide_overtime_sheet(v_no,'leader', true, null,'k-51-sign');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'stage' = 'approved', 'got ' || coalesce(a -> 'data' ->> 'stage','(null)');

  a := ops_hr.decide_overtime_sheet(v_no,'leader', true);
  assert a -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005104';
do $$
declare v_payload jsonb;
begin
  select payload into v_payload from ops_core.outbox where event_type = 'overtime.approved';
  -- **D147's second door.** `0062` lets `approve_overtime` post a progress
  -- entry whose source is this sheet without holding the production module,
  -- so the announcement carries what was made that night.
  assert jsonb_array_length(v_payload -> 'production') = 2,
    'both lines carried work orders, got ' || coalesce(jsonb_array_length(v_payload -> 'production')::text,'(null)');
  assert v_payload -> 'production' -> 0 ->> 'wo_no' = 'SPK-51-01', 'got '
    || coalesce(v_payload -> 'production' -> 0 ->> 'wo_no','(null)');
end $$;

/* ── DERIVATION: a staff session is HRD's alone ────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005101';
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.create_overtime_sheet('staff','2026-09-20','tutup buku bulanan');
  v_no := a -> 'data' ->> 'sheet_no';
  assert a -> 'data' ->> 'stage' = 'paid_default',
    'a staff session ships paid and waits for nobody, got ' || coalesce(a -> 'data' ->> 'stage','(null)');

  a := ops_hr.decide_overtime_sheet(v_no,'hrd', true);
  assert a -> 'error' ->> 'code' = 'empty_sheet', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.add_overtime_line(v_no,'B-0012', 5,'rekap absensi');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  a := ops_hr.decide_overtime_sheet(v_no,'hrd', true);
  assert a -> 'data' ->> 'stage' = 'paid_checked', 'got ' || coalesce(a -> 'data' ->> 'stage','(null)');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005102';
do $$
declare a jsonb; v_no text;
begin
  select sheet_no into v_no from ops_hr.overtime_sheets where kind = 'staff';
  a := ops_hr.decide_overtime_sheet(v_no,'leader', true);
  assert a -> 'error' ->> 'code' = 'no_leader_needed',
    'lembur staff tidak perlu tanda tangan pimpinan (D146), got '
    || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: turning one down, and what that costs in words ────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005101';
do $$
declare a jsonb; v_staff text; v_prod text;
begin
  a := ops_hr.create_overtime_sheet('staff','2026-09-21','lembur yang tidak diminta siapa-siapa');
  v_staff := a -> 'data' ->> 'sheet_no';
  perform ops_hr.add_overtime_line(v_staff,'B-0007', 2,'entah');

  a := ops_hr.decide_overtime_sheet(v_staff,'hrd', false);
  assert a -> 'error' ->> 'code' = 'reason_required',
    'menolak lembur yang sudah dikerjakan butuh satu kalimat, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.decide_overtime_sheet(v_staff,'hrd', false,'tidak ada permintaan dari siapa pun');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- A staff session HRD says no to is `unpaid`, and the reason is on the row.
  assert a -> 'data' ->> 'stage' = 'unpaid', 'got ' || coalesce(a -> 'data' ->> 'stage','(null)');
  assert (select unpaid_reason from ops_hr.overtime_sheets where sheet_no = v_staff)
         = 'tidak ada permintaan dari siapa pun', 'with the sentence on it';

  -- A production sheet HRD turns down is declined outright: there is nothing
  -- left for the leader to sign.
  a := ops_hr.create_overtime_sheet('production','2026-09-21','salah catat');
  v_prod := a -> 'data' ->> 'sheet_no';
  perform ops_hr.add_overtime_line(v_prod,'B-0021', 2,'tidak jadi');
  a := ops_hr.decide_overtime_sheet(v_prod,'hrd', false,'malam itu tidak ada lembur');
  assert a -> 'data' ->> 'stage' = 'declined', 'got ' || coalesce(a -> 'data' ->> 'stage','(null)');

  a := ops_hr.decide_overtime_sheet(v_prod,'hrd', true);
  assert a -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

rollback;
