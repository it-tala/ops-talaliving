-- 0123 — pengajuan cuti: satu-satunya layar HRD yang tidak punya tabel sama sekali.
--
-- ── what was missing, and what was not ────────────────────────────────────
--
-- `/hrd/cuti` has been dark since the HR ladder landed, and for a different
-- reason from the payroll screens: those had a seam that was short of its
-- contract, this one had **nothing underneath it at all**. `day_marks` records
-- that somebody *was* on leave; nothing recorded that somebody *asked*.
--
-- The two are deliberately separate (D142) and stay separate here. A mark is
-- what the timesheet reads and the payslip pays; a request is a decision with
-- a name, a date and a sentence on it. Folding them together would make
-- *kenapa tanggal empat belas ditandai cuti* answerable only as *because it
-- is* — and it would make withdrawing a decision indistinguishable from
-- correcting a day.
--
-- ── approval writes the marks, and says which it could not ────────────────
--
-- Approving is the one place the two meet: the days become marks, because
-- otherwise HRD would approve a request and then have to mark six days by
-- hand, and the sixth one would be the one they forgot. A day that already
-- carries a mark — a tanggal merah, a sick day somebody already entered — is
-- **skipped and named**, never overwritten. The seam returns both lists, so
-- the screen can say *approved, and these two days already had something on
-- them* rather than reporting a clean success over a silent collision.
--
-- ── the balance is read at decision time, not at payslip time ─────────────
--
-- `v_leave_request` prints how the days would be paid **if approved today**
-- (D178). A request that would run past the entitlement says so before the
-- decision rather than turning up as an unpaid line on a payslip a month
-- later, which is the version of this that generates an argument nobody can
-- win. The split is derived on read and never stored: the entitlement moves,
-- the days already taken move, and two stored numbers that must agree is how
-- bruto and diterima drifted apart (F73, A3).

insert into ops_core.doc_prefixes (prefix, what) values ('izn', 'leave request')
  on conflict (prefix) do nothing;

create type ops_hr.leave_kind_t   as enum ('cuti', 'izin', 'sakit');
create type ops_hr.leave_status_t as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

create table ops_hr.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text not null unique default ops_core.next_doc_number('izn'),
  employee_id   uuid not null references ops_hr.employees(id),
  kind          ops_hr.leave_kind_t not null,
  from_date     date not null,
  to_date       date not null,
  -- The reason is read at the moment somebody decides, so it is not optional.
  -- A request with no sentence is one the decider has to guess about.
  reason        text not null check (length(btrim(reason)) > 0),
  status        ops_hr.leave_status_t not null default 'PENDING',
  requested_by  uuid not null references ops_core.users(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references ops_core.users(id),
  decided_at    timestamptz,
  -- Required on a rejection, and the check below is where that is enforced
  -- rather than in the seam alone: a refusal an employee cannot read is one
  -- they cannot argue with (A7).
  decision_note text,

  constraint range_forward check (to_date >= from_date),
  -- A decision is three things at once or none of them. Half a decision — a
  -- status with nobody's name on it — is the row that cannot be explained.
  constraint decided_together check (
    (status in ('PENDING','CANCELLED'))
    or (decided_by is not null and decided_at is not null)),
  constraint rejection_says_why check (
    status <> 'REJECTED' or length(btrim(coalesce(decision_note,''))) > 0)
);

create index leave_emp_idx  on ops_hr.leave_requests (employee_id, from_date);
create index leave_open_idx on ops_hr.leave_requests (status) where status = 'PENDING';

/* Two live requests may not cover the same day for one person. Written as an
   exclusion constraint rather than checked in the seam, because the seam is
   not the only road in and *asked twice, approved twice* is two lots of paid
   days for one absence. `PENDING` and `APPROVED` are the live ones; a rejected
   or cancelled request is history and gets out of the way. */
create extension if not exists btree_gist;
alter table ops_hr.leave_requests add constraint leave_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(from_date, to_date, '[]') with &&
  ) where (status in ('PENDING','APPROVED'));

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.leave_requests enable row level security;

-- Payroll reads them for the same reason it reads the taps: the days are the
-- figure. It never writes one.
create policy leave_read on ops_hr.leave_requests for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
-- No insert or update policy: both roads go through the seams below, which are
-- `security definer` and decide for themselves. A table somebody can write
-- directly is a table where a decision can arrive with no audit row.

/* ── how a request's days would be paid, if decided today ─────────────── */
--
-- Derived, never stored (A3). `paid_days` is what the entitlement still
-- covers; `unpaid_days` is the rest, and it is shown **before** the decision.
-- Only `cuti` spends the entitlement — izin and sakit are their own marks with
-- their own rules (D142), and sakit is paid on a doctor's letter rather than
-- on a balance.
create or replace view ops_hr.v_leave_request
with (security_invoker = on) as
  with req as (
    select r.*, e.employee_no, e.full_name, e.paid_leave_days,
           (r.to_date - r.from_date + 1) as span
      from ops_hr.leave_requests r
      join ops_hr.employees e on e.id = r.employee_id
  ),
  used as (
    select q.id,
           -- Days already recorded as cuti this year, from the marks — the
           -- same source the payslip counts, so the two cannot disagree.
           (select count(*) from ops_hr.day_marks m
             where m.employee_id = q.employee_id and m.kind = 'leave'
               and m.withdrawn_at is null
               and extract(year from m.work_date) = extract(year from q.from_date)) as taken
      from req q
  ),
  clash as (
    select q.id,
           coalesce(array_agg(d::date::text order by d) filter (where m.id is not null), '{}') as days
      from req q
      cross join lateral generate_series(q.from_date, q.to_date, interval '1 day') d
      left join ops_hr.day_marks m
        on m.work_date = d::date
       and (m.employee_id = q.employee_id or m.employee_id is null)
       and m.withdrawn_at is null
     group by q.id
  )
  select
    q.id, q.request_no, q.employee_id, q.kind, q.from_date, q.to_date,
    q.span as days, q.reason, q.status,
    q.requested_by, q.requested_at, q.decided_by, q.decided_at, q.decision_note,
    q.employee_no, q.full_name,
    u.full_name as decided_by_name,
    case when q.kind <> 'cuti' then 0
         else least(q.span, greatest(q.paid_leave_days - used.taken, 0)) end as paid_days,
    case when q.kind <> 'cuti' then q.span
         else q.span - least(q.span, greatest(q.paid_leave_days - used.taken, 0)) end as unpaid_days,
    clash.days as clashes
  from req q
  join used  on used.id  = q.id
  join clash on clash.id = q.id
  left join ops_core.users u on u.id = q.decided_by;

/* ── asking ───────────────────────────────────────────────────────────── */
create or replace function ops_hr.request_leave(
  p_employee_no text, p_kind ops_hr.leave_kind_t,
  p_from date, p_to date, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; v_no text; v_res jsonb; v_clash text;
begin
  v_replayed := ops_core.idem_replay('hr','request_leave', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','leave_request', null,'request',
      'not_permitted','Mengajukan cuti butuh akses HRD.');
  end if;

  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','leave_request', p_employee_no,'request',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;
  if p_to < p_from then
    return ops_core.invalid('hr','leave_request', null,'request',
      'range_invalid','Tanggal selesai mendahului tanggal mulai.',
      jsonb_build_object('field','to_date'));
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    return ops_core.invalid('hr','leave_request', null,'request',
      'reason_required','Tulis alasannya — itu yang dibaca saat diputuskan.',
      jsonb_build_object('field','reason'));
  end if;

  /* Asked here so the answer is a sentence, and refused by the exclusion
     constraint underneath either way. */
  select request_no into v_clash from ops_hr.leave_requests
   where employee_id = emp.id and status in ('PENDING','APPROVED')
     and from_date <= p_to and to_date >= p_from
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','leave_request', null,'request',
      'overlaps_existing',
      format('%s sudah menutupi tanggal itu untuk orang yang sama.', v_clash));
  end if;

  insert into ops_hr.leave_requests
    (employee_id, kind, from_date, to_date, reason, requested_by)
  values (emp.id, p_kind, p_from, p_to, btrim(p_reason), auth.uid())
  returning request_no into v_no;

  v_res := ops_core.ok('hr','leave_request', v_no,'request',
    jsonb_build_object('request_no', v_no, 'employee_no', emp.employee_no,
                       'kind', p_kind, 'from_date', p_from, 'to_date', p_to),
    null,
    jsonb_build_object('employee', emp.employee_no, 'kind', p_kind,
                       'from', p_from, 'to', p_to, 'reason', btrim(p_reason)));
  return ops_core.idem_remember('hr','request_leave', p_key, v_res);
end $$;

/* ── deciding ─────────────────────────────────────────────────────────── */
--
-- Approval writes the marks. A day that already carries one is skipped and
-- **named back**, never overwritten: a holiday or a sick day somebody already
-- entered is a fact, and a leave request is not authority to erase it.
create or replace function ops_hr.decide_leave(
  p_request_no text, p_approved boolean, p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; req ops_hr.leave_requests%rowtype; emp ops_hr.employees%rowtype;
  v_kind ops_hr.day_mark_t; d date;
  marked text[] := '{}'; v_skipped text[] := '{}';
  v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','decide_leave', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','leave_request', p_request_no,'decide',
      'not_permitted','Memutuskan cuti butuh akses HRD.');
  end if;

  select * into req from ops_hr.leave_requests where request_no = p_request_no;
  if not found then
    return ops_core.not_found('hr','leave_request', p_request_no,'decide',
      format('Tidak ada pengajuan %s.', p_request_no));
  end if;
  if req.status <> 'PENDING' then
    return ops_core.conflict('hr','leave_request', p_request_no,'decide',
      'already_decided',
      format('%s sudah %s — tidak ada yang berubah.', req.request_no, lower(req.status::text)));
  end if;
  if not p_approved and coalesce(btrim(coalesce(p_note,'')),'') = '' then
    return ops_core.invalid('hr','leave_request', p_request_no,'decide',
      'reason_required',
      'Penolakan harus punya alasan. Yang ditolak tanpa kalimat tidak bisa dibantah orangnya.',
      jsonb_build_object('field','note'));
  end if;

  select * into emp from ops_hr.employees where id = req.employee_id;

  update ops_hr.leave_requests
     set status = case when p_approved then 'APPROVED' else 'REJECTED' end::ops_hr.leave_status_t,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note,'')), '')
   where id = req.id;

  if p_approved then
    v_kind := case req.kind when 'cuti' then 'leave'
                            when 'izin' then 'permit'
                            else 'sick' end::ops_hr.day_mark_t;
    for d in select generate_series(req.from_date, req.to_date, interval '1 day')::date loop
      if exists (select 1 from ops_hr.day_marks m
                  where m.work_date = d and m.withdrawn_at is null
                    and (m.employee_id = emp.id or m.employee_id is null)) then
        v_skipped := v_skipped || d::text;
      else
        insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
        values (emp.id, d, v_kind,
                format('%s: %s', req.request_no, req.reason), auth.uid());
        marked := marked || d::text;
      end if;
    end loop;
  end if;

  v_res := ops_core.ok('hr','leave_request', req.request_no,
    case when p_approved then 'approve' else 'reject' end,
    jsonb_build_object('request_no', req.request_no,
                       'status', case when p_approved then 'APPROVED' else 'REJECTED' end,
                       'marked', to_jsonb(marked), 'skipped', to_jsonb(v_skipped)),
    null,
    jsonb_build_object('employee', emp.employee_no,
                       'marked', to_jsonb(marked), 'skipped', to_jsonb(v_skipped),
                       'note', nullif(btrim(coalesce(p_note,'')), '')));
  return ops_core.idem_remember('hr','decide_leave', p_key, v_res);
end $$;

/* ── what everybody has left ──────────────────────────────────────────── */
--
-- Per person and derived (D144, A3). `booked` is the part that only exists
-- because requests now do: approved days still in the future that have not
-- become the year's history yet. Without it the screen would show somebody
-- twelve days remaining on the morning they are about to take ten of them.
create type ops_hr.leave_balance_t as (
  employee_id uuid, employee_no text, full_name text,
  entitlement int, taken int, booked int, remaining int, over int,
  sick_days int, sick_without_letter int, permit_days int
);

create or replace function ops_hr.leave_balances(p_year int default null)
returns setof ops_hr.leave_balance_t
language sql stable set search_path = ops_hr, pg_temp as $$
  with y as (select coalesce(p_year, extract(year from ops_core.office_day())::int) as yr),
  marks as (
    select m.employee_id, m.kind, m.work_date, m.mark_no,
           -- The same predicate `read_day` uses, down to the `kind` and the
           -- `unlinked_at`: a letter is linked by the mark's **public number**
           -- (ADR-004), and a letter filed against something else is not a
           -- doctor's letter for this day.
           exists (select 1 from ops_core.attachment_links al
                    where al.entity = 'day_mark' and al.entity_no = m.mark_no
                      and al.kind = 'surat_dokter' and al.unlinked_at is null) as has_letter
      from ops_hr.day_marks m, y
     where m.employee_id is not null and m.withdrawn_at is null
       and extract(year from m.work_date) = y.yr
  ),
  agg as (
    select e.id,
      count(*) filter (where mk.kind = 'leave')::int  as leave_days,
      count(*) filter (where mk.kind = 'sick')::int   as sick_days,
      count(*) filter (where mk.kind = 'sick' and not mk.has_letter)::int as sick_no_letter,
      count(*) filter (where mk.kind = 'permit')::int as permit_days
      from ops_hr.employees e
      left join marks mk on mk.employee_id = e.id
     group by e.id
  ),
  future as (
    select r.employee_id,
           coalesce(sum(
             -- Only the part still ahead: a request that started last week is
             -- already showing up as marks, and counting it twice would take a
             -- week off somebody's balance for no reason.
             greatest(r.to_date - greatest(r.from_date, ops_core.office_day()) + 1, 0)), 0)::int as booked
      from ops_hr.leave_requests r, y
     where r.status = 'APPROVED' and r.kind = 'cuti'
       and r.to_date >= ops_core.office_day()
       and extract(year from r.from_date) = y.yr
     group by r.employee_id
  )
  select (
    e.id, e.employee_no, e.full_name,
    e.paid_leave_days,
    least(a.leave_days, e.paid_leave_days),
    coalesce(f.booked, 0),
    greatest(e.paid_leave_days - a.leave_days - coalesce(f.booked, 0), 0),
    -- Days recorded as cuti past the entitlement: taken, and not paid.
    greatest(a.leave_days - e.paid_leave_days, 0),
    a.sick_days, a.sick_no_letter, a.permit_days
  )::ops_hr.leave_balance_t
  from ops_hr.employees e
  join agg a on a.id = e.id
  left join future f on f.employee_id = e.id
  where e.active
  order by e.employee_no
$$;

-- The table grant, which RLS does not imply: a policy narrows what a role may
-- see, and a role with no grant at all meets `permission denied` before any
-- policy is consulted.
--
-- **Named, not `on all tables in schema ops_hr`** — which is what every HR
-- migration up to `0052` says, and what this file said first. That idiom was
-- safe for exactly as long as no table had been closed again: `0056` revokes
-- select on `ops_hr.employee_documents`, because a document number nobody may
-- read is a table nobody may select (D196). Every earlier blanket grant is
-- numbered below that revoke, so the revoke always won. This is the first one
-- above it, and re-running the blanket form quietly re-opened the numbers —
-- caught by `53_hr_people_seams`, which asserts exactly that (F147).
grant select on ops_hr.leave_requests to authenticated;
-- No `insert` or `update` here on purpose (contrast `day_marks` in `0044`):
-- the only roads in are the two definer seams, so a decision cannot arrive
-- without an audit row beside it.

grant select on ops_hr.v_leave_request to authenticated;
grant execute on function
  ops_hr.request_leave(text, ops_hr.leave_kind_t, date, date, text, text),
  ops_hr.decide_leave(text, boolean, text, text),
  ops_hr.leave_balances(int)
  to authenticated;
