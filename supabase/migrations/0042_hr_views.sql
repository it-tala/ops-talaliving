-- 0042_hr_views.sql — where the marks reach the money.
--
-- Two derivations, and neither is stored (A3). What a day is worth depends on
-- things outside the mark — a letter that may arrive next week, an entitlement
-- counted from the other marks in the same year — so a `day_value` column
-- would be a number that was right when it was written and wrong afterwards,
-- with nothing on screen to say which.

-- Paid leave taken, per person per calendar year (D144).
--
-- There is deliberately no `leave_balance_remaining` column anywhere: a stored
-- balance drifts the first time a mark is removed, and the person it drifts
-- against loses a paid day. The balance is `paid_leave_days − taken`, computed
-- here, from the marks themselves.
create or replace view ops_hr.v_leave_used as
select
  m.employee_id,
  e.employee_no,
  e.full_name,
  extract(year from m.work_date)::int              as year,
  count(*)::int                                    as leave_days_taken,
  e.paid_leave_days                                as entitlement,
  least(count(*), e.paid_leave_days)::int          as leave_days_paid,
  greatest(e.paid_leave_days - count(*), 0)::int   as leave_days_left
from ops_hr.day_marks m
join ops_hr.employees e on e.id = m.employee_id
where m.kind = 'leave'
group by m.employee_id, e.employee_no, e.full_name,
         extract(year from m.work_date), e.paid_leave_days;

-- What one marked day is worth, and the sentence that says why.
--
-- `day_value` is 1 for an ordinary day, 0,5 for *setengah hari*, 1 for *sakit*
-- with the letter behind it and *cuti* inside the entitlement, and 0 for
-- everything else (D142, D144). The reason travels with the figure because
-- "why is this day worth nothing" is the question an employee asks, and an app
-- that cannot answer it makes HRD answer it from memory.
--
-- The entitlement is spent **in date order**: the first days of the year are
-- the paid ones. A day taken past the balance is still recorded — nothing here
-- refuses a mark, because a day taken without a letter is a fact about that
-- person's month whether or not it is worth anything.
create or replace view ops_hr.v_day_mark_value as
with leave_nth as (
  select id,
         row_number() over (
           partition by employee_id, extract(year from work_date)
           order by work_date, mark_no
         ) as nth
  from ops_hr.day_marks
  where kind = 'leave' and employee_id is not null
),
sick_letter as (
  -- A live link only: unlinking is an update, never a delete (A2), so a letter
  -- somebody withdrew must stop paying the day.
  select distinct entity_no
  from ops_core.attachment_links
  where entity = 'day_mark' and kind = 'surat_dokter' and unlinked_at is null
)
select
  m.id,
  m.mark_no,
  m.employee_id,
  m.work_date,
  m.kind,
  m.reason,
  case m.kind
    when 'half_day' then 0.5
    when 'sick'     then case when sl.entity_no is not null then 1 else 0 end
    when 'leave'    then case when ln.nth <= e.paid_leave_days then 1 else 0 end
    else 0
  end::numeric as day_value,
  case m.kind
    when 'half_day' then 'setengah hari'
    when 'sick'     then case when sl.entity_no is not null
                          then 'sakit, surat dokter ada'
                          else 'sakit, surat dokter belum ada' end
    when 'leave'    then case when ln.nth <= e.paid_leave_days
                          then 'cuti, hari ke-' || ln.nth || ' dari ' || e.paid_leave_days
                          else 'cuti, melewati jatah ' || e.paid_leave_days || ' hari' end
    when 'holiday'  then 'tanggal merah'
    when 'permit'   then 'izin, tidak dibayar'
    when 'absent'   then 'alpa'
  end as why
from ops_hr.day_marks m
left join ops_hr.employees e on e.id = m.employee_id
left join leave_nth   ln on ln.id = m.id
left join sick_letter sl on sl.entity_no = m.mark_no;

-- Both read tables whose policies already say who may see the rows, so the
-- view must carry the reader's rights rather than the owner's. Stated rather
-- than assumed, because the default changed and somebody reading this on an
-- older server should not have to guess.
alter view ops_hr.v_leave_used      set (security_invoker = on);
alter view ops_hr.v_day_mark_value  set (security_invoker = on);

grant select on ops_hr.v_leave_used, ops_hr.v_day_mark_value to authenticated;
