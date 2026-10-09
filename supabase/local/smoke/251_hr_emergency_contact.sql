-- 251_hr_emergency_contact.sql — kontak darurat karyawan (D406).
--
-- Yang dibuktikan:
--   • karyawan baru menyimpan nama, hubungan dan nomor darurat (angka saja);
--   • nomor tanpa nama, nama tanpa nomor, hubungan saja, nomor yang tidak
--     bisa dipakai, dan nomor orang itu sendiri ditolak — dengan field-nya,
--     tanpa menulis apa pun;
--   • tidak dikirim = tetap; mengubah hubungannya saja tidak ditolak;
--   • kosong = dihapus, ketiganya sekaligus;
--   • tabelnya sendiri menolak kontak setengah, siapa pun penulisnya.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024901','hrd249@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024901','hrd','admin');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024901';

do $$
declare a jsonb; e ops_hr.employees;
begin
  /* ── half a contact is refused, and nobody is written on the way ── */
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_emergency_phone => '0813 1111 2222');
  assert a -> 'error' ->> 'code' = 'emergency_name_required', a::text;
  assert a -> 'error' -> 'detail' ->> 'field' = 'emergency_name', a::text;
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_emergency_name => 'Siti');
  assert a -> 'error' ->> 'code' = 'emergency_phone_required', a::text;
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_emergency_relation => 'Istri');
  assert a -> 'error' ->> 'code' = 'emergency_phone_required', a::text;
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_emergency_name => 'Siti', p_emergency_phone => '12-34');
  assert a -> 'error' ->> 'code' = 'emergency_phone_invalid', a::text;
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_phone => '0813-1111-2222',
                            p_emergency_name => 'Siti', p_emergency_phone => '0813 1111 2222');
  assert a -> 'error' ->> 'code' = 'emergency_is_own_phone', a::text;
  assert not exists (select 1 from ops_hr.employees where employee_no = 'B-2491'),
    'nobody written on the way to a refusal';

  /* ── a new hire with a whole contact ── */
  a := ops_hr.save_employee('B-2491','Darurat', 'Tukang','Workshop','daily', 150000,
                            p_phone => '0812 0000 1111',
                            p_emergency_name => '  Siti   Aminah ', p_emergency_relation => ' Istri ',
                            p_emergency_phone => '(0813) 1111-2222');
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-2491';
  assert e.emergency_name = 'Siti Aminah', 'name trimmed, got ' || coalesce(e.emergency_name,'(null)');
  assert e.emergency_relation = 'Istri', 'got ' || coalesce(e.emergency_relation,'(null)');
  assert e.emergency_phone = '081311112222', 'digits, got ' || coalesce(e.emergency_phone,'(null)');

  /* ── absent leaves it; only the relation changes; own phone checked against
        the stored one too ── */
  a := ops_hr.save_employee('B-2491','Darurat', p_position => 'Tukang kayu');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.save_employee('B-2491','Darurat', p_emergency_relation => 'Ibu');
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-2491';
  assert e.emergency_name = 'Siti Aminah' and e.emergency_phone = '081311112222'
     and e.emergency_relation = 'Ibu', 'contact kept, relation changed';
  a := ops_hr.save_employee('B-2491','Darurat', p_emergency_phone => '0812-0000-1111');
  assert a -> 'error' ->> 'code' = 'emergency_is_own_phone', a::text;
  -- And the person's own phone moved onto the contact's number, same answer.
  a := ops_hr.save_employee('B-2491','Darurat', p_phone => '081311112222');
  assert a -> 'error' ->> 'code' = 'emergency_is_own_phone', a::text;

  /* ── blank clears all three; a name alone afterwards is half again ── */
  a := ops_hr.save_employee('B-2491','Darurat', p_emergency_name => '', p_emergency_relation => '',
                            p_emergency_phone => ' ');
  assert ops_core.said_ok(a), a::text;
  select * into e from ops_hr.employees where employee_no = 'B-2491';
  assert e.emergency_name is null and e.emergency_relation is null and e.emergency_phone is null,
    'cleared';
  -- Clearing only the number while a name is stored is half a contact.
  a := ops_hr.save_employee('B-2491','Darurat', p_emergency_name => 'Siti', p_emergency_phone => '081311112222');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.save_employee('B-2491','Darurat', p_emergency_phone => '');
  assert a -> 'error' ->> 'code' = 'emergency_phone_required', a::text;
end $$;

/* ── the table holds the same shape whoever writes it ── */
reset role;
do $$
begin
  begin
    update ops_hr.employees set emergency_phone = null where employee_no = 'B-2491';
    assert false, 'a name with no number reached the table';
  exception when check_violation then null;
  end;
  begin
    update ops_hr.employees set emergency_phone = '0813-abc' where employee_no = 'B-2491';
    assert false, 'a number with letters reached the table';
  exception when check_violation then null;
  end;
end $$;

rollback;
