-- hr — what a day is worth, and the four ways the schema says no.
--
-- The refusals:
--
--   reading the roll is not writing it — `payroll.read` may not hire (D136)
--   a typed tap says why the machine missed it (D137)
--   the same tap twice is one tap (D143)
--   a pay rule cannot be back-dated onto days already worked (D173)
--   an office-wide mark is a holiday or nothing
--
-- And the derivations, both of which are the reason none of this is a column:
--
--   sakit is worth nothing until the letter is behind it, and worth a full day
--   the moment it is — with no re-run and no correction (D144)
--   cuti is paid out of that person's own entitlement, in date order, and the
--   day past it is still recorded and still unpaid (D144)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000a1','wulan@talaliving.com','{"full_name":"Wulan Sari"}'),
  ('ffffffff-0000-0000-0000-0000000000a2','bayu@talaliving.com','{"full_name":"Bayu Pratama"}');

-- Wulan runs HRD. Bayu runs payroll and may read every one of these rows
-- without being able to write a single one.
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000a1','hrd','write'),
  ('ffffffff-0000-0000-0000-0000000000a1','it','write'),
  ('ffffffff-0000-0000-0000-0000000000a2','payroll','read');

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, allowance_rate, paid_leave_days)
values ('aaaa0000-0000-0000-0000-00000000e001','B-009','Siti Rahayu','monthly',4500000,600000,2);

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000a1','a/surat.jpg','surat-dokter-siti.jpg','ffffffff-0000-0000-0000-0000000000a1');

set local role authenticated;

/* ── REFUSAL: reading the roll is not writing it ───────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000a2';
do $$
declare n int;
begin
  assert ops_core.has_permission('payroll.read'), 'payroll reads';
  assert not ops_core.has_permission('hrd.create'), 'and does not hire';

  select count(*) into n from ops_hr.employees;
  assert n = 1, 'payroll can see the roll it is paying, got ' || n;

  begin
    insert into ops_hr.employees (employee_no, full_name, pay_basis)
    values ('B-999','Orang Baru','monthly');
    raise exception 'payroll should not be able to hire';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── the rest is HRD's ─────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000a1';

/* ── REFUSAL: a typed tap says why the machine missed it (D137) ────────── */
do $$
begin
  begin
    insert into ops_hr.attendance_scans (employee_id, work_date, at, source)
    values ('aaaa0000-0000-0000-0000-00000000e001','2026-09-01','2026-09-01T07:28:00+08','manual');
    raise exception 'a manual scan with no reason should be refused';
  exception when check_violation then null;
  end;

  -- With the sentence, it lands.
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  values ('aaaa0000-0000-0000-0000-00000000e001','2026-09-01','2026-09-01T07:28:00+08','manual',
          'mesin mati, jam dari buku satpam','ffffffff-0000-0000-0000-0000000000a1');
end $$;

/* ── REFUSAL: the same tap twice is one tap (D143) ─────────────────────── */
do $$
begin
  begin
    insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
    values ('aaaa0000-0000-0000-0000-00000000e001','2026-09-01','2026-09-01T07:28:00+08','manual',
            'diketik dua kali','ffffffff-0000-0000-0000-0000000000a1');
    raise exception 're-uploading the same tap should be refused';
  exception when unique_violation then null;
  end;
end $$;

/* ── REFUSAL: an office-wide mark is a holiday or nothing ──────────────── */
do $$
begin
  begin
    insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
    values (null,'2026-09-02','sick','semua orang sakit','ffffffff-0000-0000-0000-0000000000a1');
    raise exception 'sakit for the whole office should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── REFUSAL: a pay rule cannot be back-dated (D173) ───────────────────── */
do $$
begin
  begin
    insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
    values (1, current_date - 30, 'diam-diam mundur sebulan', '{}'::jsonb,
            'ffffffff-0000-0000-0000-0000000000a1');
    raise exception 'a back-dated pay rule should be refused';
  exception when check_violation then null;
  end;

  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (1, current_date, 'versi awal', '{"overtime":{"tiers":[1.5,2]}}'::jsonb,
          'ffffffff-0000-0000-0000-0000000000a1');
end $$;

/* ── DERIVATION: sakit is worth nothing until the letter arrives ───────── */
do $$
declare v numeric; w text; mark text;
begin
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values ('aaaa0000-0000-0000-0000-00000000e001','2026-09-03','sick','demam','ffffffff-0000-0000-0000-0000000000a1')
  returning mark_no into mark;

  select day_value, why into v, w from ops_hr.v_day_mark_value where mark_no = mark;
  assert v = 0, 'sakit with no letter is worth nothing, got ' || v;
  assert w = 'sakit, surat dokter belum ada', 'and says so: ' || w;

  -- The letter arrives days later. Nothing is re-run and nothing is corrected,
  -- because the value was never stored.
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values ('44440000-0000-0000-0000-0000000000a1','day_mark',mark,'surat_dokter',
          'ffffffff-0000-0000-0000-0000000000a1');

  select day_value, why into v, w from ops_hr.v_day_mark_value where mark_no = mark;
  assert v = 1, 'the letter pays the day, got ' || v;
  assert w = 'sakit, surat dokter ada', 'and says so: ' || w;

  -- Withdrawing it takes the day back: unlinking is an update, never a delete.
  update ops_core.attachment_links
     set unlinked_at = now(), unlinked_by = 'ffffffff-0000-0000-0000-0000000000a1'
   where entity_no = mark;

  select day_value into v from ops_hr.v_day_mark_value where mark_no = mark;
  assert v = 0, 'an unlinked letter stops paying the day, got ' || v;
end $$;

/* ── DERIVATION: cuti is paid out of that person's own entitlement ─────── */
do $$
declare taken int; paid int; left_ int; v numeric; w text;
begin
  -- Siti has two days. She takes three, out of date order on the way in — the
  -- entitlement is spent by work_date, not by who was entered first.
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by) values
    ('aaaa0000-0000-0000-0000-00000000e001','2026-09-10','leave','cuti tahunan','ffffffff-0000-0000-0000-0000000000a1'),
    ('aaaa0000-0000-0000-0000-00000000e001','2026-09-08','leave','cuti tahunan','ffffffff-0000-0000-0000-0000000000a1'),
    ('aaaa0000-0000-0000-0000-00000000e001','2026-09-09','leave','cuti tahunan','ffffffff-0000-0000-0000-0000000000a1');

  select leave_days_taken, leave_days_paid, leave_days_left
    into taken, paid, left_
    from ops_hr.v_leave_used where employee_id = 'aaaa0000-0000-0000-0000-00000000e001';
  assert taken = 3, 'three days taken, got ' || taken;
  assert paid  = 2, 'two of them paid — the entitlement, got ' || paid;
  assert left_ = 0, 'and nothing left, got ' || left_;

  -- The first two by date are the paid ones.
  select day_value into v from ops_hr.v_day_mark_value
   where employee_id = 'aaaa0000-0000-0000-0000-00000000e001' and work_date = '2026-09-08';
  assert v = 1, '8 Sep is the first day of the entitlement, got ' || v;

  select day_value, why into v, w from ops_hr.v_day_mark_value
   where employee_id = 'aaaa0000-0000-0000-0000-00000000e001' and work_date = '2026-09-10';
  assert v = 0, '10 Sep is past it and unpaid, got ' || v;
  assert w = 'cuti, melewati jatah 2 hari', 'and the timesheet says why: ' || w;
end $$;

rollback;
