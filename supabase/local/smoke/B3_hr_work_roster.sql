-- hr — the work roster: who can be named on a timeslot (0200, D355).
--
--   REFUSALS     somebody with neither production nor HRD reads nothing; the
--                roster never carries pay; a production reader still cannot
--                read the employees table itself
--   DERIVATIONS  a production reader sees the active people with number,
--                name, unit and position; somebody who left is not on it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000b3001','admin-prod-roster@talaliving.com','{"full_name":"Admin Produksi"}'),
  ('ffffffff-0000-0000-0000-0000000b3002','orang-lain-roster@talaliving.com','{"full_name":"Orang Lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000b3001','production','write'),
  ('ffffffff-0000-0000-0000-0000000b3002','inventory','write');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate, daily_hours, joined_on, active)
values
  ('b3000000-0000-0000-0000-0000000000e1','B-3001','Karjo Roster','Tukang','Workshop','daily', 140000, 15000, 8, '2026-01-01', true),
  ('b3000000-0000-0000-0000-0000000000e2','B-3002','Toha Keluar','Tukang','Workshop','daily', 140000, 15000, 8, '2026-01-01', false);

set local role authenticated;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b3001';
do $$
declare v record;
begin
  select * into v from ops_hr.work_roster() r where r.employee_no = 'B-3001';
  assert v.full_name = 'Karjo Roster' and v.unit = 'Workshop' and v.position = 'Tukang', 'production reader sees the roster';
  assert not exists (select 1 from ops_hr.work_roster() r where r.employee_no = 'B-3002'), 'somebody who left is not on it';
  assert not exists (select 1 from ops_hr.employees where employee_no = 'B-3001'), 'the table itself stays closed to production';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b3002';
do $$
begin
  assert not exists (select 1 from ops_hr.work_roster()), 'no production, no HRD: nothing';
end $$;

reset role;
do $$
begin
  -- No pay on the roster, whoever reads it.
  assert not exists (
    select 1 from information_schema.routines r
      join information_schema.parameters p on p.specific_name = r.specific_name
     where r.routine_schema = 'ops_hr' and r.routine_name = 'work_roster'
       and p.parameter_mode = 'OUT' and p.parameter_name in ('base_rate','allowance_rate','bank_account')),
    'the roster carries no pay';
end $$;

rollback;
