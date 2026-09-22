-- hr — a closed day is closed for everybody (F101, owner 2026-09-18).
--
-- Nothing here existed before the owner answered, and the existing smokes all
-- still passed after the rule changed — which is the reason this file is
-- separate rather than a few lines added to 11_hr. **A rule nobody tests is a
-- rule that changes back**, and the three consequences below are exactly the
-- ones a reader of the sentence would not think to check:
--
--   the office-wide mark beats a personal one, so the day is worth nothing
--   a sakit day on a closed day needs no surat dokter — it is not being paid
--   and, the one that costs real money: **cuti on a closed day takes nothing
--   from the entitlement**, so the person still has all of it to spend later

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000e1','wulan@talaliving.com','{"full_name":"Wulan Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000e1','hrd','write');

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, paid_leave_days) values
  ('aaaa0000-0000-0000-0000-0000000000a1','B-301','Sari Dewi','daily',170000,2),
  ('aaaa0000-0000-0000-0000-0000000000a2','B-302','Budi Hartono','daily',170000,2);

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000e1','a/surat.jpg','surat-dokter.jpg','ffffffff-0000-0000-0000-0000000000e1');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000e1';

-- 17 August. The office is shut for everybody.
insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
values (null,'2026-08-17','holiday','HUT RI','ffffffff-0000-0000-0000-0000000000e1');

/* ── the office-wide mark wins ─────────────────────────────────────────── */
do $$
declare d ops_hr.day_reading; mark text; v numeric; w text;
begin
  -- Sari was marked sick on it anyway — which happens, because the mark and
  -- the holiday are entered by different people on different days.
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values ('aaaa0000-0000-0000-0000-0000000000a1','2026-08-17','sick','demam','ffffffff-0000-0000-0000-0000000000e1')
  returning mark_no into mark;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-0000000000a1','2026-08-17');
  assert d.mark_kind = 'holiday', 'the closed day governs, not her own mark, got ' || d.mark_kind;
  assert d.day_value = 0,         'and nobody is paid for it, got ' || d.day_value;
  assert d.why like '%Tanggal merah%', 'and it says so: ' || d.why;

  -- Her own mark is still on the record — it is not deleted, it is inert.
  select day_value, why into v, w from ops_hr.v_day_mark_value where mark_no = mark;
  assert v = 0, 'her sick mark is worth nothing on a closed day, got ' || v;
  assert w = 'kantor tutup — tidak dihitung dan tidak memotong jatah',
         'and the sentence says why rather than blaming a missing letter: ' || w;

  -- And a surat dokter does not change it. The day is not being paid, so
  -- there is nothing for the letter to unlock.
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values ('44440000-0000-0000-0000-0000000000e1','day_mark',mark,'surat_dokter',
          'ffffffff-0000-0000-0000-0000000000e1');
  select day_value into v from ops_hr.v_day_mark_value where mark_no = mark;
  assert v = 0, 'a letter cannot pay a day the office was shut, got ' || v;
end $$;

/* ── the expensive one: a closed day spends no entitlement ─────────────── */
do $$
declare taken int; paid int; left_ int; v numeric;
begin
  -- Budi has two days. He is marked cuti on the holiday and on two working
  -- days. Only the two working days are his to spend.
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by) values
    ('aaaa0000-0000-0000-0000-0000000000a2','2026-08-17','leave','cuti','ffffffff-0000-0000-0000-0000000000e1'),
    ('aaaa0000-0000-0000-0000-0000000000a2','2026-08-18','leave','cuti','ffffffff-0000-0000-0000-0000000000e1'),
    ('aaaa0000-0000-0000-0000-0000000000a2','2026-08-19','leave','cuti','ffffffff-0000-0000-0000-0000000000e1');

  select leave_days_taken, leave_days_paid, leave_days_left
    into taken, paid, left_
    from ops_hr.v_leave_used where employee_id = 'aaaa0000-0000-0000-0000-0000000000a2';
  assert taken = 2, 'the closed day is not a day he took, got ' || taken;
  assert paid  = 2, 'both real days are paid, got ' || paid;
  assert left_ = 0, 'and the entitlement is exactly spent, got ' || left_;

  -- Both working days are inside the entitlement. Under the old rule the
  -- holiday would have been the first day of it and 19 Aug would have fallen
  -- outside — a paid day lost, with every figure on screen still adding up.
  select day_value into v from ops_hr.v_day_mark_value
   where employee_id = 'aaaa0000-0000-0000-0000-0000000000a2' and work_date = '2026-08-19';
  assert v = 1, '19 Aug is still inside his two days, got ' || v;

  select day_value into v from ops_hr.v_day_mark_value
   where employee_id = 'aaaa0000-0000-0000-0000-0000000000a2' and work_date = '2026-08-17';
  assert v = 0, 'and the closed day itself is worth nothing, got ' || v;
end $$;

/* ── hours worked on a closed day are still overtime ───────────────────── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-0000000000a1','2026-08-17', t,'manual','masuk pas libur',
         'ffffffff-0000-0000-0000-0000000000e1'
    from unnest(array['2026-08-17 08:00+08','2026-08-17 12:00+08',
                      '2026-08-17 12:45+08','2026-08-17 15:00+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-0000000000a1','2026-08-17');
  assert d.day_value = 0,      'coming in does not make it a working day, got ' || d.day_value;
  assert d.work_hours = 0,     'so it holds no ordinary hours, got ' || d.work_hours;
  assert d.overtime_hours > 6, 'the hours are overtime, got ' || d.overtime_hours;
end $$;

rollback;
