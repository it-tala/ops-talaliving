-- 0052_hr_payroll_seams.sql — opening a run, what people move on it by hand,
-- and the two signatures at the end of it.
--
-- `0044` built `payroll_runs` and `payroll_adjustments`, the freeze trigger and
-- the forward-only status, and `0047` built the figure each person is owed.
-- Nothing could **open** a run, put an adjustment on one, sign it, or say which
-- transfer paid it. This is that, and it is the last of HR's daily work.
--
-- ## An adjustment is withdrawn, never deleted
--
-- The demo's `removeAdjustment` splices the row out of the array. *Why was
-- there a 500.000 deduction on Budi's slip last week and not this week* is a
-- question somebody asks at the counter, and a deleted row answers it with
-- silence (A2, and F123's rule in `0050` for the same reason).
--
-- Two things follow. An adjustment needs a **public code** to be addressed by,
-- because a seam never takes a uuid (ADR-004) — hence `adj_no`, minted like
-- every other document number. And the flag has to reach **every reader of the
-- table**, which is the expensive half: `v_payroll_run` sums them and so does
-- `payroll_line`, and the second is two hundred lines long. It is restated
-- below, sliced out of `0047` verbatim with one predicate added, because the
-- moment the flag is added is the only moment all its readers can be found.
--
-- ## Who signs, and with what
--
-- `payroll.run` opens the run and moves money on it by hand. **Approving it is
-- an authority** — `approve_funds`, the same one that releases a payment round
-- — and never a module level (D24). A payroll clerk prepares; somebody else
-- signs. A level that could do both would make the second signature a
-- formality performed by the first person.
--
-- ## A run over days nobody has read
--
-- Refused, not warned (D139). A payroll computed over open days is a number
-- that looks exact and is not, and the people it is wrong about are the ones
-- least able to argue. `payroll_line` already counts them per person and puts
-- a sentence on the payslip; the signature is where it becomes a refusal.
--
-- ## PAID names a movement that exists
--
-- `paid_names_its_row` in `0044` could only ask that the string is not empty,
-- which is satisfied by a typo. The seam asks the ledger: the transaction is
-- there, it is not VOID, and money left rather than arrived. What it
-- deliberately does **not** check is the amount — see Q56. The contract calls
-- gross plus adjustments the net, `0048` then made an employee's BPJS half a
-- deduction from it, and nothing has yet said which of those two figures a run
-- pays. A seam that enforced the wrong one would be worse than one that
-- enforces neither, so it reports both and refuses on neither.

insert into ops_core.doc_prefixes (prefix, what) values ('adj', 'payroll adjustment');

-- ── the row a person can take back ────────────────────────────────────────
alter table ops_hr.payroll_adjustments
  add column adj_no           text not null unique default ops_core.next_doc_number('adj'),
  add column withdrawn_at     timestamptz,
  add column withdrawn_by     uuid references ops_core.users(id),
  add column withdrawn_reason text;

-- Taking one back is a decision like making it, so it is signed and reasoned.
-- The reason prints nowhere, and that is the point: it is for whoever asks
-- later why the slip changed.
alter table ops_hr.payroll_adjustments
  add constraint withdrawal_is_signed check (
    (withdrawn_at is null) = (withdrawn_by is null)
    and (withdrawn_at is null) = (withdrawn_reason is null));

-- ── the same week, and the weeks either side of it ────────────────────────
--
-- `period_once` in `0044` is unique on `(period_start, period_end)`, which
-- catches the same week opened twice and nothing else. It cannot see 1–7
-- September beside 5–11 September, and those two runs pay the fifth, sixth and
-- seventh over again — the failure the unique key was written to prevent,
-- arriving through the gap in it.
--
-- No extension needed: a range is its own gist opclass. The unique key stays,
-- because the exact repeat is the common mistake and deserves the clearer
-- error.
alter table ops_hr.payroll_runs
  add constraint periods_do_not_overlap
  exclude using gist ((daterange(period_start, period_end, '[]')) with &&);

-- ── the two readers relearn the predicate ─────────────────────────────────
--
-- `v_payroll_run` first, which is the cheap one.
create or replace view ops_hr.v_payroll_run as
select
  r.id,
  r.run_no,
  r.period_start,
  r.period_end,
  r.status,
  r.paid_trx_no,
  coalesce(adj.total, 0)::numeric        as adjustment_total,
  coalesce(adj.rows_n, 0)::int           as adjustment_rows,
  coalesce(ot.approved_hours, 0)::numeric as approved_overtime_hours,
  coalesce(ot.pending_hours, 0)::numeric  as pending_overtime_hours
from ops_hr.payroll_runs r
left join lateral (
  select sum(a.amount) as total, count(*) as rows_n
    from ops_hr.payroll_adjustments a
   where a.run_no = r.run_no
     -- A withdrawn adjustment is not money on this run any more. It stays on
     -- the table, which is a different question and a different reader.
     and a.withdrawn_at is null
) adj on true
left join lateral (
  select
    sum(c.hours) filter (where c.payable) as approved_hours,
    sum(c.hours) filter (where c.stage in ('waiting_hrd','waiting_surat','waiting_leader'))
      as pending_hours
    from ops_hr.v_overtime_claim c
   where c.work_date between r.period_start and r.period_end
) ot on true;

alter view ops_hr.v_payroll_run set (security_invoker = on);

-- `payroll_line` second: two hundred lines from `0047`, unchanged but for the
-- `withdrawn_at is null` on its adjustment sum. Restated rather than patched
-- because a function has no ALTER, and copied by slicing the earlier file
-- rather than by retyping it.
create or replace function ops_hr.payroll_line(p_employee uuid, p_run_no text)
returns ops_hr.payroll_figures
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  run       ops_hr.payroll_runs%rowtype;
  v_rules   jsonb;
  rate      ops_hr.hourly_rate_t;
  d         ops_hr.day_reading;
  out_row   ops_hr.payroll_figures;
  sc        jsonb;
  day_start int;
  grace     int;
  ut_mode   text;
  ut_grace  numeric;
  short     numeric := 0;
  half_days int := 0;
  gap       numeric;
  is_present boolean;
  withheld  boolean;
  n_present int := 0;
  n_withheld int := 0;
  shown_ot  numeric := 0;
  pending_ot numeric := 0;
  no_letter int := 0;
  over_leave int := 0;
  late_one  int;
  w         text[] := '{}';
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  select * into run from ops_hr.payroll_runs where run_no = p_run_no;
  if not found then return null; end if;

  /* The book in force **when the period opened**, which is the whole reason
     the rule book is dated (D173). */
  v_rules  := ops_hr.rules_on(run.period_start);
  rate     := ops_hr.hourly_rate(emp, v_rules);
  sc       := ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit);
  day_start := coalesce((sc->>'start_minutes')::int, (v_rules->>'day_starts_minutes')::int);
  grace    := coalesce((v_rules->>'late_grace_minutes')::int, 0);
  ut_mode  := coalesce(v_rules->>'undertime_mode', 'off');
  ut_grace := coalesce((v_rules->>'undertime_grace_minutes')::numeric, 0) / 60;

  out_row.run_no := run.run_no;
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;

  for d in select * from ops_hr.timesheet(emp.id, run.period_start, run.period_end) loop
    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;
    if d.day_value > 0 then out_row.normal_hours := out_row.normal_hours + d.work_hours; end if;
    shown_ot := shown_ot + d.overtime_hours;

    /* What the paid days are made of, so a payslip can say it rather than
       showing one total nobody can take apart (D144). */
    if d.mark_kind is null then
      if d.day_value > 0 then out_row.days_present := out_row.days_present + d.day_value; end if;
    else
      case d.mark_kind
        when 'half_day' then out_row.days_present := out_row.days_present + d.day_value;
        when 'sick'  then
          if d.day_value > 0 then out_row.days_sick_paid := out_row.days_sick_paid + 1;
          else no_letter := no_letter + 1; end if;
        when 'leave' then
          if d.day_value > 0 then out_row.days_leave_paid := out_row.days_leave_paid + 1;
          else over_leave := over_leave + 1; end if;
        else null;
      end case;
      if d.day_value = 0 and d.mark_kind <> 'holiday' then
        out_row.days_unpaid := out_row.days_unpaid + 1;
      end if;
    end if;

    /* Tunjangan is paid for **coming in**. A monthly person earns it on the
       days the business works, because the fingerprint reader is a workshop
       device and the office does not use it — making it depend on taps for
       everybody paid five office staff Rp 600.000 a month less than the day
       before (F72). No taps is not evidence of absence.

       A half day is presence, and since Q46 that is the owner's ruling rather
       than our reading of one (D272). Sakit, cuti and tanggal merah are not. */
    if emp.pay_basis = 'monthly' then
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else not ops_hr.is_rest_day(v_rules, d.work_date) end;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
    end if;

    if is_present then
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then n_withheld := n_withheld + 1; else n_present := n_present + 1; end if;
    end if;

    /* Minutes late past the grace the owner set (Q41, D251). Nobody has said
       when this person's day starts, so nothing about it is late — not zero
       because they were punctual, zero because there is no threshold, and
       inventing one puts minutes on a payslip (D274). */
    if d.in_at is not null and d.mark_kind is null and day_start is not null then
      late_one := greatest(ops_hr.wita_minutes(d.in_at) - day_start - grace, 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
    end if;

    /* Hours short of the contracted day. Only for people paid by the day: an
       hourly person is already paid for the hours they were here and a monthly
       salary is a month. A marked day is not a short day, it is a different
       day, and counting it here would deduct twice (D174). */
    if ut_mode <> 'off' and emp.pay_basis = 'daily'
       and d.mark_kind is null and d.state = 'complete' then
      gap := emp.daily_hours - d.work_hours;
      if gap > ut_grace then
        short := short + gap;
        if gap > emp.daily_hours / 2 then half_days := half_days + 1; end if;
      end if;
    end if;
  end loop;

  out_row.normal_hours := round(out_row.normal_hours, 2);
  out_row.worked_days  := round(out_row.worked_days, 2);
  out_row.hourly       := rate.hourly;
  out_row.hourly_basis := rate.basis;

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(out_row.worked_days * emp.base_rate)
    else                round(out_row.normal_hours * emp.base_rate)
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := (n_present::bigint * emp.allowance_rate);

  select coalesce(sum(amount), 0), coalesce(sum(hours), 0)
    into out_row.overtime_pay, out_row.overtime_hours
    from ops_hr.overtime_parts(emp.id, run.period_start, run.period_end);

  out_row.undertime_hours := round(short, 2);
  out_row.undertime_amount := case
    when ut_mode = 'half_day_step' then round(half_days * (emp.base_rate / 2.0))
    when ut_mode = 'off' then 0
    else round(short * rate.hourly) end::bigint;

  /* What the hours would cost — *potongannya jam saja* (D251). Computed
     whatever the mode and **applied only when the mode says so**, so the rule
     book can price it before anybody switches it on and a payslip can show
     what is not being deducted rather than leaving the minutes looking free. */
  out_row.late_priced := round((out_row.late_minutes / 60.0) * rate.hourly)::bigint;
  out_row.late_deduction := case when coalesce(v_rules->>'late_mode','manual') = 'pro_rata'
                                 then out_row.late_priced else 0 end;

  select coalesce(sum(amount), 0) into out_row.adjustment_total
    from ops_hr.payroll_adjustments a
   where a.run_no = run.run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between run.period_start and run.period_end
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');
  if pending_ot > 0 then
    w := w || format('%s jam lembur di lembar yang belum selesai ditandatangani — tidak masuk angka ini', pending_ot);
  end if;
  if shown_ot > out_row.overtime_hours + pending_ot then
    w := w || format('%s jam lewat jam kerja di mesin yang belum diklaim siapa pun',
                     round(shown_ot - out_row.overtime_hours - pending_ot, 1));
  end if;
  if no_letter > 0 then
    w := w || format('%s hari sakit tanpa surat dokter — tercatat, tidak dibayar. Suratnya membuatnya dibayar', no_letter);
  end if;
  if over_leave > 0 then
    w := w || format('%s hari cuti melewati jatah %s hari — tercatat, tidak dibayar', over_leave, emp.paid_leave_days);
  end if;
  if n_withheld > 0 and emp.allowance_rate > 0 then
    w := w || format('%s hari tanpa tunjangan — keputusan HRD, alasannya tercetak di slip', n_withheld);
  end if;
  if out_row.late_minutes > 0 and coalesce(v_rules->>'late_mode','manual') = 'manual' then
    w := w || format('%s menit terlambat di luar toleransi — belum dipotong; Rp %s kalau aturannya dinyalakan',
                     out_row.late_minutes, out_row.late_priced);
  end if;
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  out_row.warnings := w;

  return out_row;
end $$;

-- ── one run's people, computed once ───────────────────────────────────────
--
-- `v_payroll_line` was every person on **every** run, which is the right shape
-- for a screen listing one run and the wrong shape for a seam: filtering its
-- output by `run_no` still walks every timesheet of every run, because the
-- column comes out of a lateral the planner cannot push a predicate into. Fifty
-- people over fifty runs is two and a half thousand timesheets read to answer a
-- question about one week.
--
-- So the scope moves into a function the view is then built on. **One
-- definition of who is on a run** — everybody still here, plus anybody who left
-- during the period, because they are owed the days they worked.
create or replace function ops_hr.run_lines(p_run_no text)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.*
    from ops_hr.payroll_runs r
    cross join ops_hr.employees e
    cross join lateral (select (ops_hr.payroll_line(e.id, r.run_no)).*) l
   where r.run_no = p_run_no
     and (e.active or e.left_on >= r.period_start)
$$;

create or replace view ops_hr.v_payroll_line as
  select l.*
    from ops_hr.payroll_runs r
    cross join lateral ops_hr.run_lines(r.run_no) l;

alter view ops_hr.v_payroll_line set (security_invoker = on);

-- ── a run is open until somebody signs it ─────────────────────────────────
--
-- Shared by the two seams that write adjustments, for the same reason
-- `sheet_is_open` is shared in `0051`: the rule is about the run, not about
-- whether money is being put on or taken off. The trigger in `0044` enforces it
-- underneath; this is what turns it into a sentence instead of an exception.
create or replace function ops_hr.run_is_open(p_run ops_hr.payroll_runs)
returns boolean language sql immutable as $$
  select p_run.status = 'DRAFT'
$$;

-- ── opening a run ─────────────────────────────────────────────────────────
--
-- Opening computes nothing. The figures are derived from the days either way
-- (A3); what a run adds is a **document** — a number to hang adjustments and a
-- signature on.
create or replace function ops_hr.open_payroll_run(
  p_period_start date,
  p_period_end   date,
  p_note         text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_clash ops_hr.payroll_runs; v_no text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','open_payroll_run', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', null,'open',
      'not_permitted','Opening a payroll run needs payroll access.');
  end if;
  if p_period_end < p_period_start then
    return ops_core.invalid('hr','payroll', null,'open',
      'period_invalid','Periodenya berakhir sebelum dimulai.',
      jsonb_build_object('field','period_end'));
  end if;

  -- **Overlap, not just repetition.** `period_once` catches the same week run
  -- twice; it cannot see 1–7 September and 5–11 September, which pay the fifth,
  -- sixth and seventh twice over. The exclusion constraint below refuses it in
  -- the table; this is the sentence that says which run is in the way.
  select r.* into v_clash from ops_hr.payroll_runs r
   where daterange(r.period_start, r.period_end, '[]')
      && daterange(p_period_start, p_period_end, '[]')
   limit 1;
  if found then
    return ops_core.conflict('hr','payroll', v_clash.run_no,'open',
      'period_overlaps',
      format('%s sudah mencakup %s sampai %s. Hari yang sama tidak dibayar dua kali.',
             v_clash.run_no, v_clash.period_start, v_clash.period_end));
  end if;

  insert into ops_hr.payroll_runs (period_start, period_end, note, created_by)
  values (p_period_start, p_period_end, nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  returning run_no into v_no;

  v_res := ops_core.ok('hr','payroll', v_no,'open',
    jsonb_build_object('run_no', v_no, 'period_start', p_period_start,
                       'period_end', p_period_end, 'status', 'DRAFT'));
  return ops_core.idem_remember('hr','open_payroll_run', p_key, v_res);
end $$;

-- ── what a person moves by hand ───────────────────────────────────────────
create or replace function ops_hr.add_adjustment(
  p_run_no      text,
  p_employee_no text,
  p_kind        ops_hr.adjustment_kind_t,
  p_amount      numeric,
  p_reason      text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_run ops_hr.payroll_runs; v_emp ops_hr.employees;
  v_no text; v_total numeric; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','add_adjustment', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', p_run_no,'add_adjustment',
      'not_permitted','Moving money on a payslip needs payroll access.');
  end if;

  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'add_adjustment',
      format('No payroll run %s.', p_run_no));
  end if;
  if not ops_hr.run_is_open(v_run) then
    return ops_core.conflict('hr','payroll', p_run_no,'add_adjustment',
      'run_not_draft',
      format('%s sudah %s. Koreksinya masuk run berikutnya — mengubah angka yang '
             'sudah ditandatangani berarti tanda tangannya tidak lagi menunjuk '
             'apa yang ditandatangani.', p_run_no, v_run.status));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'add_adjustment',
      format('No employee %s.', p_employee_no));
  end if;

  if coalesce(p_amount, 0) = 0 then
    return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
      'amount_required',
      'Penyesuaian nol rupiah mencetak satu baris di slip dan tidak mengubah apa pun.',
      jsonb_build_object('field','amount'));
  end if;
  -- Printed on the payslip verbatim. A deduction an employee cannot read is one
  -- they cannot dispute (D155).
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
      'reason_required','Alasannya tercetak di slip. Tanpa itu karyawan tidak bisa membantahnya.',
      jsonb_build_object('field','reason'));
  end if;

  insert into ops_hr.payroll_adjustments
    (run_no, employee_id, kind, amount, reason, created_by)
  values (p_run_no, v_emp.id, p_kind, p_amount, btrim(p_reason), auth.uid())
  returning adj_no into v_no;

  select coalesce(sum(a.amount), 0) into v_total
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.withdrawn_at is null;

  v_res := ops_core.ok('hr','payroll', p_run_no,'add_adjustment',
    jsonb_build_object('adj_no', v_no, 'run_no', p_run_no,
                       'employee_no', p_employee_no, 'kind', p_kind,
                       'amount', p_amount, 'adjustment_total', v_total));
  return ops_core.idem_remember('hr','add_adjustment', p_key, v_res);
end $$;

-- ── and takes back ────────────────────────────────────────────────────────
create or replace function ops_hr.withdraw_adjustment(
  p_adj_no text,
  p_reason text,
  p_key    text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_adj ops_hr.payroll_adjustments; v_run ops_hr.payroll_runs;
  v_total numeric; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','withdraw_adjustment', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', null,'withdraw_adjustment',
      'not_permitted','Taking an adjustment back needs payroll access.');
  end if;

  select a.* into v_adj from ops_hr.payroll_adjustments a where a.adj_no = p_adj_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_adj_no,'withdraw_adjustment',
      format('No adjustment %s.', p_adj_no));
  end if;
  if v_adj.withdrawn_at is not null then
    return ops_core.conflict('hr','payroll', p_adj_no,'withdraw_adjustment',
      'already_withdrawn', format('%s sudah ditarik.', p_adj_no));
  end if;

  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = v_adj.run_no;
  if not ops_hr.run_is_open(v_run) then
    return ops_core.conflict('hr','payroll', p_adj_no,'withdraw_adjustment',
      'run_not_draft',
      format('%s sudah %s. Yang sudah ditandatangani tidak diubah.',
             v_run.run_no, v_run.status));
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','payroll', p_adj_no,'withdraw_adjustment',
      'reason_required',
      'Kenapa ditarik? Baris ini tetap ada di tabel; yang dibaca orang berikutnya adalah alasannya.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_hr.payroll_adjustments
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = btrim(p_reason)
   where adj_no = p_adj_no;

  select coalesce(sum(a.amount), 0) into v_total
    from ops_hr.payroll_adjustments a
   where a.run_no = v_adj.run_no and a.withdrawn_at is null;

  v_res := ops_core.ok('hr','payroll', v_adj.run_no,'withdraw_adjustment',
    jsonb_build_object('adj_no', p_adj_no, 'run_no', v_adj.run_no,
                       'adjustment_total', v_total),
    jsonb_build_object('withdrawn', false),
    jsonb_build_object('withdrawn', true));
  return ops_core.idem_remember('hr','withdraw_adjustment', p_key, v_res);
end $$;

-- ── the signature ─────────────────────────────────────────────────────────
create or replace function ops_hr.approve_payroll_run(
  p_run_no text,
  p_key    text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_run ops_hr.payroll_runs; v_res jsonb;
  v_people int; v_gross bigint; v_adj numeric; v_open int; v_pending numeric;
begin
  v_replayed := ops_core.idem_replay('hr','approve_payroll_run', p_key);
  if v_replayed is not null then return v_replayed; end if;

  -- **An authority, not a level** (D24). The clerk who opened the run and typed
  -- the adjustments holds `payroll.run`; signing is granted separately, to
  -- somebody else, or the second signature is the first person agreeing with
  -- themselves.
  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('hr','payroll', p_run_no,'approve',
      'not_permitted',
      'Menandatangani gaji butuh wewenang approve_funds, bukan akses modul payroll.');
  end if;

  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'approve',
      format('No payroll run %s.', p_run_no));
  end if;
  if v_run.status <> 'DRAFT' then
    return ops_core.conflict('hr','payroll', p_run_no,'approve',
      'already_decided', format('%s sudah %s.', p_run_no, v_run.status));
  end if;

  select count(*)::int,
         coalesce(sum(l.gross), 0)::bigint,
         coalesce(sum(l.adjustment_total), 0)::numeric,
         coalesce(sum(l.open_days), 0)::int
    into v_people, v_gross, v_adj, v_open
    from ops_hr.run_lines(p_run_no) l;

  if v_people = 0 then
    return ops_core.invalid('hr','payroll', p_run_no,'approve',
      'empty_run','Tidak ada seorang pun di periode ini.',
      jsonb_build_object('field','people'));
  end if;
  -- **Refused, not warned** (D139). Everything else HR gets a warning about; a
  -- day nobody has read is the one that makes the figure wrong rather than
  -- incomplete, and the people it is wrong about are the ones least able to
  -- argue about it afterwards.
  if v_open > 0 then
    return ops_core.invalid('hr','payroll', p_run_no,'approve',
      'open_days',
      format('%s hari di periode ini belum dibaca — mesinnya tidak lengkap dan belum '
             'ada yang bilang apa yang terjadi. Baca dulu di timesheet: gaji yang '
             'dihitung dari hari yang belum selesai dicatat salah tentang orang yang '
             'paling sulit membantahnya.', v_open),
      jsonb_build_object('field','open_days','open_days', v_open));
  end if;

  -- Overtime still waiting for a signature is a **warning**, not a refusal
  -- (A6): those hours land on the next run, which is how a late sheet has
  -- always worked, and holding the whole payroll for one unsigned lembar would
  -- pay nobody on Friday.
  select coalesce(sum(c.hours), 0) into v_pending
    from ops_hr.v_overtime_claim c
   where c.work_date between v_run.period_start and v_run.period_end
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');

  update ops_hr.payroll_runs
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where run_no = p_run_no;

  -- `payroll.approved`, not `hr.payroll.approved`: `hr` is a legacy schema name
  -- and a dotted string starting with it trips the isolation guard (F122).
  perform ops_core.emit('hr','payroll.approved', p_run_no,
    jsonb_build_object('run_no', p_run_no, 'period_start', v_run.period_start,
                       'period_end', v_run.period_end, 'people', v_people,
                       'gross_total', v_gross, 'adjustment_total', v_adj));

  v_res := ops_core.ok('hr','payroll', p_run_no,'approve',
    jsonb_build_object('run_no', p_run_no, 'status', 'APPROVED',
                       'people', v_people, 'gross_total', v_gross,
                       'adjustment_total', v_adj,
                       'pending_overtime_hours', v_pending),
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('status', 'APPROVED'));
  return ops_core.idem_remember('hr','approve_payroll_run', p_key, v_res);
end $$;

-- ── which transfer paid it ────────────────────────────────────────────────
--
-- `acct` owns the money and mints the transaction; this only records **which
-- movement** settled the run, by its public code and never by a uuid into
-- another schema (ADR-004, ADR-006).
create or replace function ops_hr.record_payroll_paid(
  p_run_no text,
  p_trx_no text,
  p_key    text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_run ops_hr.payroll_runs; v_res jsonb;
  v_dir ops_acct.direction_t; v_status ops_acct.trx_status_t; v_amount numeric;
  v_gross bigint; v_adj numeric;
begin
  v_replayed := ops_core.idem_replay('hr','record_payroll_paid', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', p_run_no,'mark_paid',
      'not_permitted','Recording the transfer needs payroll access.');
  end if;

  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'mark_paid',
      format('No payroll run %s.', p_run_no));
  end if;
  if v_run.status = 'DRAFT' then
    return ops_core.conflict('hr','payroll', p_run_no,'mark_paid',
      'not_approved','Belum ada yang menandatangani run ini. Gaji dibayar setelah disetujui, bukan sebelum.');
  end if;
  if v_run.status = 'PAID' then
    return ops_core.conflict('hr','payroll', p_run_no,'mark_paid',
      'already_paid', format('%s sudah dibayar lewat %s.', p_run_no, v_run.paid_trx_no));
  end if;

  -- **The constraint could only ask that the string is not empty**, which a
  -- typo satisfies. A number nobody can find in the ledger is the same as no
  -- number at all, so the ledger is asked.
  select t.direction, t.status, t.amount_idr into v_dir, v_status, v_amount
    from ops_acct.transactions t where t.trx_no = btrim(coalesce(p_trx_no,''));
  if not found then
    return ops_core.invalid('hr','payroll', p_run_no,'mark_paid',
      'trx_not_found',
      format('Tidak ada %s di buku besar.', coalesce(nullif(btrim(coalesce(p_trx_no,'')), ''), '(kosong)')),
      jsonb_build_object('field','trx_no'));
  end if;
  if v_status = 'VOID' then
    return ops_core.invalid('hr','payroll', p_run_no,'mark_paid',
      'trx_void', format('%s dibatalkan. Pembayaran yang dibatalkan tidak membayar apa pun.', p_trx_no),
      jsonb_build_object('field','trx_no'));
  end if;
  if v_dir <> 'OUT' then
    return ops_core.invalid('hr','payroll', p_run_no,'mark_paid',
      'trx_not_outgoing','Gaji keluar dari rekening, bukan masuk.',
      jsonb_build_object('field','trx_no'));
  end if;

  update ops_hr.payroll_runs
     set status = 'PAID', paid_trx_no = btrim(p_trx_no)
   where run_no = p_run_no;

  -- The two figures side by side, and **no refusal between them** — see Q56.
  -- The contract calls gross plus adjustments the net; `0048` then made an
  -- employee's BPJS half a deduction from what they receive, and nothing has
  -- yet said which of the two a run pays. Enforcing the wrong one is worse than
  -- enforcing neither, so both are reported and whoever reads the envelope can
  -- see that they differ.
  select coalesce(sum(l.gross), 0)::bigint, coalesce(sum(l.adjustment_total), 0)::numeric
    into v_gross, v_adj
    from ops_hr.run_lines(p_run_no) l;

  v_res := ops_core.ok('hr','payroll', p_run_no,'mark_paid',
    jsonb_build_object('run_no', p_run_no, 'status', 'PAID', 'trx_no', btrim(p_trx_no),
                       'trx_amount', v_amount,
                       'gross_total', v_gross, 'adjustment_total', v_adj),
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('status', 'PAID'));
  return ops_core.idem_remember('hr','record_payroll_paid', p_key, v_res);
end $$;

grant execute on function
  ops_hr.run_lines(text),
  ops_hr.run_is_open(ops_hr.payroll_runs),
  ops_hr.open_payroll_run(date, date, text, text),
  ops_hr.add_adjustment(text, text, ops_hr.adjustment_kind_t, numeric, text, text),
  ops_hr.withdraw_adjustment(text, text, text),
  ops_hr.approve_payroll_run(text, text),
  ops_hr.record_payroll_paid(text, text, text)
  to authenticated;
