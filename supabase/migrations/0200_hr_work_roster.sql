-- 0200_hr_work_roster.sql — who can be named on a timeslot, readable by the
-- people who write timeslots (D355).
--
-- `ops_hr.employees` is read by `hrd.read` or `payroll.read` and nobody else
-- (0043), and rightly: the row carries the rate, the allowance, the bank
-- account. But the timeslot form (D352) picks its people from that table, so
-- for a production admin without HRD access the list came back **empty**. Every
-- name was then typed, unlinked, and landed on `/produksi/penautan` for
-- somebody to resolve — the picker existed and could not be used by the one
-- person it was built for (F205).
--
-- The answer is not to widen the table's policy. It is a roster: the four
-- columns a floor needs to say *who* — number, name, unit, position — for the
-- people still employed, and nothing about pay. It is a security-definer
-- function rather than a view, because a view over an RLS table answers with
-- the caller's rights, which is the empty list this exists to fix; it decides
-- inside, like every seam here, and answers an empty set to anybody who holds
-- neither production nor HRD.
--
-- The owner, on the floor card (Q-D352 follow-up): *jika tidak jam hadir,
-- cukup daftar karyawan yang aktif saja* — where attendance cannot be read, the
-- per-person table lists the active people instead, so an empty row is
-- somebody nobody wrote down. This roster is that list.

create or replace function ops_hr.work_roster()
returns table (id uuid, employee_no text, full_name text, unit text, "position" text)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_core.has_permission('production.read')
          or ops_core.has_permission('hrd.read')
          or ops_core.has_permission('payroll.read')) then
    return;
  end if;
  return query
    select e.id, e.employee_no, e.full_name, e.unit, e.position
      from ops_hr.employees e
     where e.active
     order by e.employee_no;
end $$;

comment on function ops_hr.work_roster() is
  'Active employees as the floor names them (number, name, unit, position) — no pay. Production, HRD or payroll readers; empty for anybody else. D355.';

grant execute on function ops_hr.work_roster() to authenticated;
revoke execute on function ops_hr.work_roster() from public;
