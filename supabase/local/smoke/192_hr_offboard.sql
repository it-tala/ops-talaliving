-- hr — offboarding, and the biometric file that files who it knows (D337).
--
--   REFUSALS     offboarding or reinstating with a read grant; with no reason;
--                somebody nobody has; somebody already gone; a leaving date
--                before the joining date; reinstating somebody still here
--   DERIVATIONS  offboarding writes `active = false` and the date, keeps every
--                tap and **counts the ones after the date**; the machine
--                number matches with leading zeros and a letter prefix off
--                **both** sides; a tap after somebody's last working day is
--                **set aside and named**, never filed and never a refusal of
--                the file; unknown numbers are still named and nobody is created;
--                reinstating puts the person back and the next upload files
--                the taps that were set aside
--
-- Worked out first: seven rows → 3 added · 2 after leaving · 2 unknown

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019201','hrd192@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000019202','lihat192@talaliving.com','{"full_name":"Pimpinan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019201','hrd','write'),
  ('ffffffff-0000-0000-0000-000000019202','hrd','read');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019201';

-- `019` the way somebody typed it by hand, `113` the way the payroll prints it.
insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, joined_on)
values ('aaaa1920-0000-0000-0000-0000000000e1','019','Siti','daily', 97750,'2026-03-02'),
       ('aaaa1920-0000-0000-0000-0000000000e2','113','Miftah','daily', 75000,'2026-05-11');

/* ── REFUSAL: a read grant may not offboard anybody ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019202';
do $$
declare a jsonb;
begin
  a := ops_hr.offboard_employee('113','2026-07-03','resign');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.reinstate_employee('113','salah orang');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select active from ops_hr.employees where employee_no = '113'), 'and he is still here';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019201';

/* ── REFUSAL: what an offboarding cannot do without ───────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.offboard_employee('113','2026-07-03','  ');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.offboard_employee('999','2026-07-03','resign');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.offboard_employee('113','2026-05-01','resign');
  assert a -> 'error' ->> 'code' = 'left_before_joined', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.reinstate_employee('113','kembali');
  assert a -> 'error' ->> 'code' = 'already_active', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: a tap on file before he leaves is kept and counted ────── */
insert into ops_hr.attendance_imports (id, filename, imported_by)
values ('cccc1920-0000-0000-0000-000000000001','lama.csv','ffffffff-0000-0000-0000-000000019201');
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, import_id)
values ('aaaa1920-0000-0000-0000-0000000000e2','2026-07-10','2026-07-10T07:30:00+07','FP','import',
        'cccc1920-0000-0000-0000-000000000001');

do $$
declare a jsonb; e ops_hr.employees;
begin
  a := ops_hr.offboard_employee('113','2026-07-03','tidak kembali setelah lebaran');
  assert ops_core.said_ok(a), 'got ' || a::text;
  assert (a -> 'data' ->> 'taps_after')::int = 1,
    'a tap after the date is kept and counted, so a date set too early is noticed, got '
    || coalesce(a -> 'data' ->> 'taps_after','(null)');

  select * into e from ops_hr.employees where employee_no = '113';
  assert not e.active and e.left_on = '2026-07-03', 'the row says he left, and when';
  assert (select count(*) from ops_hr.attendance_scans where employee_id = e.id) = 1,
    'and nothing he did was deleted';

  a := ops_hr.offboard_employee('113','2026-07-10','lagi');
  assert a -> 'error' ->> 'code' = 'already_left', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: the file files who it knows and refuses nobody ───────── */
do $$
declare a jsonb; v_import uuid;
begin
  a := ops_hr.import_scans('minggu-4.csv', $j$[
    {"employee_ref":"19",  "at":"2026-09-22T07:25:00+07","verify":"FP"},
    {"employee_ref":"0019","at":"2026-09-22T16:31:00+07","verify":"FP"},
    {"employee_ref":"113", "at":"2026-07-03T07:28:00+07","verify":"FP"},
    {"employee_ref":"113", "at":"2026-09-22T07:29:00+07","verify":"FP"},
    {"employee_ref":"113", "at":"2026-09-22T16:30:00+07","verify":"FP"},
    {"employee_ref":"72",  "at":"2026-09-22T07:31:00+07","verify":"FP"},
    {"employee_ref":"72",  "at":"2026-09-22T16:33:00+07","verify":"FP"}
  ]$j$::jsonb);
  assert ops_core.said_ok(a), 'the file is never refused for the people it does not know, got ' || a::text;
  assert (a -> 'data' ->> 'seen')::int = 7, 'got ' || coalesce(a -> 'data' ->> 'seen','(null)');
  assert (a -> 'data' ->> 'added')::int = 3,
    'Siti twice through `019`, and Miftah on his last day, got ' || coalesce(a -> 'data' ->> 'added','(null)');
  assert a -> 'data' -> 'unknown' = '[{"ref":"72","count":2}]'::jsonb,
    'got ' || coalesce((a -> 'data' -> 'unknown')::text,'(null)');
  assert a -> 'data' -> 'after_left'
       = '[{"ref":"113","name":"Miftah","left_on":"2026-07-03","count":2}]'::jsonb,
    'the leaver''s September taps are named with the date he left, got '
    || coalesce((a -> 'data' -> 'after_left')::text,'(null)');

  v_import := (a -> 'data' ->> 'import_id')::uuid;
  assert (select after_left_refs from ops_hr.attendance_imports where id = v_import)
         = a -> 'data' -> 'after_left', 'and the import row remembers them';
  assert (select count(*) from ops_hr.attendance_scans s
            join ops_hr.employees e on e.id = s.employee_id
           where e.employee_no = '113' and s.work_date > '2026-07-03') = 1,
    'only the tap that was already on file sits after the date';
  assert not exists (select 1 from ops_hr.employees where ops_hr.machine_no(employee_no) = '72'),
    'and nobody was conjured for 72';
end $$;

/* ── DERIVATION: reinstating, and the set-aside taps come in next time ─── */
do $$
declare a jsonb;
begin
  a := ops_hr.reinstate_employee('113','  ');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.reinstate_employee('113','kembali bekerja September');
  assert ops_core.said_ok(a), 'got ' || a::text;
  assert (select active and left_on is null from ops_hr.employees where employee_no = '113'),
    'back, with no leaving date';

  a := ops_hr.import_scans('minggu-4.csv', $j$[
    {"employee_ref":"113","at":"2026-09-22T07:29:00+07"},
    {"employee_ref":"113","at":"2026-09-22T16:30:00+07"}
  ]$j$::jsonb);
  assert (a -> 'data' ->> 'added')::int = 2, 'got ' || coalesce(a -> 'data' ->> 'added','(null)');
  assert a -> 'data' -> 'after_left' = '[]'::jsonb, 'got ' || (a -> 'data' -> 'after_left')::text;
end $$;

/* ── DERIVATION: the bare machine number ──────────────────────────────── */
do $$
begin
  assert ops_hr.machine_no('B-0012') = '12', 'letter prefix and zeros';
  assert ops_hr.machine_no('019') = '19', 'zeros typed by hand';
  assert ops_hr.machine_no(' 19 ') = '19', 'spaces';
  assert ops_hr.machine_no('0') = '0', 'zero stays a number';
  assert ops_hr.machine_no('') is null and ops_hr.machine_no(null) is null,
    'empty matches nobody, not everybody';
end $$;

rollback;
