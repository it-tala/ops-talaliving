-- 198_hr_employee_contact_leave.sql — email dan nomor HP karyawan; hak cuti
-- diisi HRD setelah 1 tahun bekerja (D348).
--
-- Yang dibuktikan:
--   • karyawan baru menyimpan email (huruf kecil) dan HP (angka saja);
--   • email/HP yang tidak bisa dipakai ditolak dengan field-nya;
--   • karyawan baru mulai dengan hak cuti 0, dan angka di atas 0 ditolak
--     sebelum 1 tahun — dengan tanggal mulai berhaknya;
--   • orang yang sudah 1 tahun bisa diisi; menyimpan ulang angka lama atau
--     menurunkannya tidak pernah ditolak;
--   • tanpa tanggal masuk, hak cuti tidak bisa dinilai;
--   • HP/email kosong = dihapus, tidak dikirim = tetap.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019801','hrd198@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019801','hrd','admin');

-- Somebody already here with no start date, the way six production rows are.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, paid_leave_days)
values ('aaaa1980-0000-0000-0000-000000000001','B-1981','Tanpa tanggal','Tukang','Workshop',
        'daily', 100000, 0, 8, null, 0);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019801';

do $$
declare a jsonb; e ops_hr.employees; v_from date;
begin
  /* ── contact details that cannot be used ── */
  a := ops_hr.save_employee('B-1982','Baru', 'Tukang','Workshop','daily', 150000,
                            p_email => 'bukan-email');
  assert a -> 'error' ->> 'code' = 'email_invalid', a::text;
  assert a -> 'error' ->> 'message' like 'bukan-email bukan alamat email.', a::text;
  a := ops_hr.save_employee('B-1982','Baru', 'Tukang','Workshop','daily', 150000,
                            p_phone => '12-34');
  assert a -> 'error' ->> 'code' = 'phone_invalid', a::text;
  assert not exists (select 1 from ops_hr.employees where employee_no = 'B-1982'),
    'nobody written on the way to a refusal';

  /* ── a new hire: contact kept, leave at nought ── */
  a := ops_hr.save_employee('B-1982','Baru', 'Tukang','Workshop','daily', 150000,
                            p_email => '  Baru@Contoh.COM ', p_phone => '0812-3456 7890');
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-1982';
  assert e.email = 'baru@contoh.com', 'email lowercased and trimmed, got ' || coalesce(e.email,'(null)');
  assert e.phone = '081234567890', 'phone as digits, got ' || coalesce(e.phone,'(null)');
  assert e.paid_leave_days = 0, 'no entitlement on day one, got ' || e.paid_leave_days;
  assert e.joined_on = ops_core.office_day(), 'joined today';

  /* ── leave before a year is refused, with the date ── */
  a := ops_hr.save_employee('B-1982','Baru', p_paid_leave_days => 12);
  assert a -> 'error' ->> 'code' = 'leave_before_one_year', a::text;
  v_from := ops_hr.leave_from(ops_core.office_day());
  assert a -> 'error' ->> 'message' like '%' || v_from::text || '%', a::text;

  -- And a new hire typed in with leave straight away, same answer.
  a := ops_hr.save_employee('B-1983','Baru juga', 'Tukang','Workshop','daily', 150000,
                            p_paid_leave_days => 12);
  assert a -> 'error' ->> 'code' = 'leave_before_one_year', a::text;

  /* ── somebody entered now who started two years ago may have it at once ── */
  a := ops_hr.save_employee('B-1984','Lama', 'Tukang','Workshop','daily', 150000,
                            p_joined_on => ops_core.office_day() - 800, p_paid_leave_days => 12);
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-1984';
  assert e.paid_leave_days = 12, 'got ' || e.paid_leave_days;

  -- Saving the same number back, or lowering it, is never refused.
  a := ops_hr.save_employee('B-1984','Lama', p_paid_leave_days => 12);
  assert ops_core.said_ok(a) or a ->> 'outcome' = 'noop', a::text;
  a := ops_hr.save_employee('B-1984','Lama', p_paid_leave_days => 6);
  assert ops_core.said_ok(a), a::text;

  /* ── a start date moved back a year opens it in the same save ── */
  a := ops_hr.save_employee('B-1982','Baru', p_joined_on => ops_core.office_day() - 400,
                            p_paid_leave_days => 12);
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-1982';
  assert e.paid_leave_days = 12, 'got ' || e.paid_leave_days;
  assert e.email = 'baru@contoh.com' and e.phone = '081234567890',
    'contact untouched when not sent';

  /* ── no start date: cannot be judged ── */
  a := ops_hr.save_employee('B-1981','Tanpa tanggal', p_paid_leave_days => 12);
  assert a -> 'error' ->> 'code' = 'leave_needs_start_date', a::text;
  -- An unrelated edit to the same person still goes through.
  a := ops_hr.save_employee('B-1981','Tanpa tanggal', p_position => 'Tukang kayu');
  assert ops_core.said_ok(a), a::text;

  /* ── blank clears ── */
  a := ops_hr.save_employee('B-1982','Baru', p_email => '', p_phone => ' ');
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-1982';
  assert e.email is null and e.phone is null, 'cleared';
end $$;

/* ── the table holds the same shape whoever writes it ── */
reset role;
do $$
begin
  begin
    update ops_hr.employees set phone = '0812-abc' where employee_no = 'B-1982';
    assert false, 'a phone with letters reached the table';
  exception when check_violation then null;
  end;
end $$;

rollback;
