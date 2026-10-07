-- 0236 — potongan default per bulan: retensi, BPJS TK, BPJS Kesehatan (D389).
--
-- ── the owner's ask (2026-10-07) ──────────────────────────────────────────
--
--   *di /hrd/karyawan tambahkan nilai potongan default per bulan sehingga bisa
--   otomatis tidak perlu input per karyawan. yang default adalah retensi dan
--   BPJS TK, BPJS KESEHATAN juga tapi default 0 karena umumnya dibayar
--   perusahaan tanpa potong gaji.* BPJS TK is **a fixed amount a month**, and
--   the defaults apply to **monthly salaries only**.
--
-- What the database adds:
--
--   * `deduction_defaults` — one amount per kind for everybody on a salary
--     (retensi 500.000, BPJS TK and BPJS Kesehatan 0 until HRD writes them);
--   * `employee_deductions` — a person's own amount over the default, zero
--     included (*this one pays no retensi*); no row follows the default;
--   * `deduction_defaults_for(from, to)` — who owes what for a period: each
--     salaried person employed in a month whose **last day** falls in the
--     period, once per such month, so consecutive runs never take a month
--     twice. A BPJS default is skipped for somebody enrolled in that scheme
--     (0051 computes theirs from the enrolment — one source each);
--   * the generate sheet writes them as ordinary adjustments through
--     `generate_payroll(p_adjust)`, so HRD sees them in the drawer, can take
--     one off before generating, and the retensi lands on the balance (D388);
--   * `add_adjustment` keeps the two BPJS kinds deductions.
--
-- Settings and the per-person amounts are HRD's: read with `hrd.read` or
-- `payroll.read`, written with `hrd.update`, never shown to the employee.

/* ── the defaults, and a person's own ────────────────────────────────────── */
create table ops_hr.deduction_defaults (
  kind        ops_hr.adjustment_kind_t primary key
              check (kind in ('retention','bpjs_tk','bpjs_kes')),
  amount      bigint not null default 0 check (amount >= 0),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
insert into ops_hr.deduction_defaults (kind, amount) values
  ('retention', 500000), ('bpjs_tk', 0), ('bpjs_kes', 0);

create table ops_hr.employee_deductions (
  employee_id uuid not null references ops_hr.employees(id),
  kind        ops_hr.adjustment_kind_t not null
              check (kind in ('retention','bpjs_tk','bpjs_kes')),
  amount      bigint not null check (amount >= 0),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, kind)
);

alter table ops_hr.deduction_defaults enable row level security;
alter table ops_hr.employee_deductions enable row level security;
create policy deduction_defaults_read on ops_hr.deduction_defaults for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy employee_deductions_read on ops_hr.employee_deductions for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
grant select on ops_hr.deduction_defaults, ops_hr.employee_deductions to authenticated;

analyze ops_hr.deduction_defaults;
analyze ops_hr.employee_deductions;

/* ── writing them ────────────────────────────────────────────────────────── */
create or replace function ops_hr.set_deduction_default(
  p_kind ops_hr.adjustment_kind_t, p_amount bigint, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_before bigint; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','set_deduction_default', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','deduction', p_kind::text,'set_default',
      'not_permitted','Potongan default diatur HRD.');
  end if;
  if p_kind not in ('retention','bpjs_tk','bpjs_kes') then
    return ops_core.invalid('hr','deduction', p_kind::text,'set_default',
      'kind_not_default','Hanya retensi, BPJS TK dan BPJS Kesehatan yang punya nilai default.',
      jsonb_build_object('field','kind'));
  end if;
  if p_amount is null or p_amount < 0 then
    return ops_core.invalid('hr','deduction', p_kind::text,'set_default',
      'amount_invalid','Nominal tidak boleh kosong atau negatif — nol berarti tidak dipotong.',
      jsonb_build_object('field','amount'));
  end if;
  select amount into v_before from ops_hr.deduction_defaults where kind = p_kind;
  insert into ops_hr.deduction_defaults (kind, amount, updated_by, updated_at)
  values (p_kind, p_amount, auth.uid(), now())
  on conflict (kind) do update
    set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  v_res := ops_core.ok('hr','deduction', p_kind::text,'set_default',
    jsonb_build_object('kind', p_kind, 'amount', p_amount),
    jsonb_build_object('amount', v_before), jsonb_build_object('amount', p_amount));
  return ops_core.idem_remember('hr','set_deduction_default', p_key, v_res);
end $$;
revoke execute on function ops_hr.set_deduction_default(ops_hr.adjustment_kind_t, bigint, text) from public;
grant execute on function ops_hr.set_deduction_default(ops_hr.adjustment_kind_t, bigint, text) to authenticated;

/* A person's own amount; null takes it away and the default applies again. */
create or replace function ops_hr.set_employee_deduction(
  p_employee_no text, p_kind ops_hr.adjustment_kind_t, p_amount bigint, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_before bigint; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','set_employee_deduction', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','deduction', p_employee_no,'set_person',
      'not_permitted','Potongan per karyawan diatur HRD.');
  end if;
  select * into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','deduction', p_employee_no,'set_person',
      format('No employee %s.', p_employee_no));
  end if;
  if p_kind not in ('retention','bpjs_tk','bpjs_kes') then
    return ops_core.invalid('hr','deduction', p_employee_no,'set_person',
      'kind_not_default','Hanya retensi, BPJS TK dan BPJS Kesehatan yang punya nilai per karyawan.',
      jsonb_build_object('field','kind'));
  end if;
  if p_amount is not null and p_amount < 0 then
    return ops_core.invalid('hr','deduction', p_employee_no,'set_person',
      'amount_invalid','Nominal tidak boleh negatif — nol berarti orang ini tidak dipotong.',
      jsonb_build_object('field','amount'));
  end if;
  select amount into v_before from ops_hr.employee_deductions
   where employee_id = v_emp.id and kind = p_kind;
  if p_amount is null then
    delete from ops_hr.employee_deductions where employee_id = v_emp.id and kind = p_kind;
  else
    insert into ops_hr.employee_deductions (employee_id, kind, amount, updated_by, updated_at)
    values (v_emp.id, p_kind, p_amount, auth.uid(), now())
    on conflict (employee_id, kind) do update
      set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  v_res := ops_core.ok('hr','deduction', p_employee_no,'set_person',
    jsonb_build_object('employee_no', p_employee_no, 'kind', p_kind, 'amount', p_amount),
    jsonb_build_object('amount', v_before), jsonb_build_object('amount', p_amount));
  return ops_core.idem_remember('hr','set_employee_deduction', p_key, v_res);
end $$;
revoke execute on function ops_hr.set_employee_deduction(text, ops_hr.adjustment_kind_t, bigint, text) from public;
grant execute on function ops_hr.set_employee_deduction(text, ops_hr.adjustment_kind_t, bigint, text) to authenticated;

/* ── who owes what over a period ─────────────────────────────────────────── */
create or replace function ops_hr.deduction_defaults_for(
  p_from date, p_to date, p_employee_no text default null)
returns table (
  employee_no text, full_name text, kind ops_hr.adjustment_kind_t,
  amount bigint, source text, month date, reason text)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    return;
  end if;
  return query
  with due as (
    -- A month is taken in the run that holds its last day: once, whichever
    -- way the runs are cut.
    select date_trunc('month', g)::date as m_start,
           (date_trunc('month', g) + interval '1 month - 1 day')::date as m_end
      from generate_series(date_trunc('month', p_from), p_to, interval '1 month') g
  ),
  kinds as (
    select unnest(array['retention','bpjs_tk','bpjs_kes']::ops_hr.adjustment_kind_t[]) as k
  )
  select e.employee_no, e.full_name, kinds.k,
         coalesce(ed.amount, dd.amount, 0)::bigint,
         case when ed.amount is not null then 'person' else 'default' end,
         due.m_start,
         format('%s — %s %s',
           case kinds.k when 'retention' then 'Retensi bulanan'
                        when 'bpjs_tk'   then 'BPJS Ketenagakerjaan'
                        else 'BPJS Kesehatan' end,
           (array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus',
                  'September','Oktober','November','Desember'])[extract(month from due.m_start)::int],
           extract(year from due.m_start)::int)
    from ops_hr.employees e
    cross join due
    cross join kinds
    left join ops_hr.deduction_defaults dd on dd.kind = kinds.k
    left join ops_hr.employee_deductions ed on ed.employee_id = e.id and ed.kind = kinds.k
   where e.pay_basis = 'monthly'
     and due.m_end between p_from and p_to
     and (e.joined_on is null or e.joined_on <= due.m_end)
     and (e.left_on is null or e.left_on >= due.m_start)
     and (p_employee_no is null or e.employee_no = p_employee_no)
     and coalesce(ed.amount, dd.amount, 0) > 0
     -- One source for each BPJS: an enrolment computes it already (0051).
     and not exists (
       select 1 from ops_hr.enrolments en
        where en.employee_id = e.id
          and ops_hr.enrolled_in(due.m_start, en.enrolled_on, en.ended_on)
          and ((kinds.k = 'bpjs_kes' and en.scheme = 'BPJS_KESEHATAN')
            or (kinds.k = 'bpjs_tk'  and en.scheme in ('JHT','JP'))))
   order by e.full_name, due.m_start, kinds.k;
end $$;
revoke execute on function ops_hr.deduction_defaults_for(date, date, text) from public;
grant execute on function ops_hr.deduction_defaults_for(date, date, text) to authenticated;

/* ── what a person moves by hand — restated from 0234 ─────────────────────

   One addition, marked 0236: the BPJS kinds only take. */
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
  v_no text; v_total numeric; v_res jsonb; v_held numeric;
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

  /* 0234 (D388): retensi is held back, so it only takes; a release only gives
     back, and never more than is held — counted over every run, drafts
     included, because a draft's retensi is already on its way to the balance. */
  if p_kind = 'retention' and p_amount > 0 then
    return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
      'retention_is_deduction','Retensi adalah potongan — nominalnya negatif.',
      jsonb_build_object('field','amount'));
  end if;
  -- 0236 (D389): BPJS taken from a salary only takes.
  if p_kind in ('bpjs_tk','bpjs_kes') and p_amount > 0 then
    return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
      'kind_is_deduction','Iuran BPJS yang dipotong dari gaji adalah potongan — nominalnya negatif.',
      jsonb_build_object('field','amount'));
  end if;
  if p_kind = 'retention_release' then
    if p_amount < 0 then
      return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
        'release_is_addition','Pengembalian retensi adalah tambahan — nominalnya positif.',
        jsonb_build_object('field','amount'));
    end if;
    select coalesce(-sum(a.amount), 0) into v_held
      from ops_hr.payroll_adjustments a
     where a.employee_id = v_emp.id and a.withdrawn_at is null
       and a.kind in ('retention','retention_release');
    if p_amount > v_held then
      return ops_core.invalid('hr','payroll', p_run_no,'add_adjustment',
        'release_exceeds_balance',
        format('Saldo retensi %s hanya Rp %s — tidak bisa mengembalikan Rp %s.',
               v_emp.full_name, to_char(v_held, 'FM999G999G999G999'), to_char(p_amount, 'FM999G999G999G999')),
        jsonb_build_object('field','amount', 'balance', v_held));
    end if;
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
