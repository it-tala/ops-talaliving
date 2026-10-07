-- 0234 — bonus, retensi and lain-lain typed on the sheet; retensi kept as a
-- balance only HRD reads (D388).
--
-- ── the owner's ask (2026-10-07) ──────────────────────────────────────────
--
--   *di kolom additions tambahkan bonus yang nilainya bebas di input beserta
--   alasan atau catatan kenapa bonus diberikan. lalu tambahkan others jika ada
--   tambahan lain di luar gaji. kemudian di deductions tambahkan RETENTION yang
--   default nya 500.000, sama seperti additions ada free text input nilai,
--   catatan/alasan lalu kolom others.* Retensi is **not** automatic — 500.000
--   is what the field starts at when HRD adds one — and its balance is kept but
--   *jangan ditampilkan ke user, cukup HRD aja*.
--
-- What the database adds:
--
--   * `add_adjustment` knows the two new kinds: `retention` only takes money
--     (negative), `retention_release` only gives it back (positive) and never
--     more than the person's balance;
--   * `generate_payroll` takes `p_adjust` — the bonus, retensi and lain-lain
--     typed on the sheet before the run exists — and writes them in the same
--     transaction as the run, through `add_adjustment`, so every rule above
--     holds there too. An adjustment for somebody the run does not pay is
--     refused: it would sit on a payslip nobody prints;
--   * `retention_balances` and `employee_standing` are HRD's: retensi held,
--     released, in drafts; and for a period, days present, alpa, late, leave
--     left. Definer, and refused to anybody without `hrd.read` or
--     `payroll.read` — the employee's own screens do not call them.
--
-- The old `generate_payroll` signature is dropped here; production renames it
-- instead (F220, see below).

/* ── what a person moves by hand — restated from 0055 ─────────────────────

   Two additions, marked 0234: the sign each retensi kind must carry, and a
   release never larger than what is held. */
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

/* ── the sheet's one button — restated from 0213 with `p_adjust` ──────────

   A new argument is a new signature, and two signatures under one name is a
   call PostgREST cannot choose between (`00_no_overloads`), so the old one is
   dropped, as 0212 and 0217 drop theirs. **Applying this to production:** a
   DROP does not get through the Supabase migration tool (F220) — there it is
   `alter function … rename to generate_payroll_retired_0234` plus `revoke all
   … from public, anon, authenticated`. */
drop function if exists ops_hr.generate_payroll(date, date, text, jsonb, text, text);

create or replace function ops_hr.generate_payroll(
  p_period_start date,
  p_period_end   date,
  p_group        text  default 'all',
  p_hold         jsonb default '[]'::jsonb,
  p_note         text  default null,
  p_key          text  default null,
  p_adjust       jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_open jsonb; v_no text; v_res jsonb;
  h jsonb; v_emp ops_hr.employees; v_note text; n_held int := 0; n_in int;
  -- 0234 (D388)
  a jsonb; v_adj jsonb; v_refusal jsonb; n_adj int := 0;
begin
  v_replayed := ops_core.idem_replay('hr','generate_payroll', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', null,'generate',
      'not_permitted','Generating a payroll needs payroll access.');
  end if;
  if jsonb_typeof(coalesce(p_hold, '[]'::jsonb)) <> 'array' then
    return ops_core.invalid('hr','payroll', null,'generate',
      'hold_invalid','Daftar yang ditahan berbentuk [{employee_no, note}].',
      jsonb_build_object('field','hold'));
  end if;
  if jsonb_typeof(coalesce(p_adjust, '[]'::jsonb)) <> 'array' then
    return ops_core.invalid('hr','payroll', null,'generate',
      'adjust_invalid','Penyesuaian berbentuk [{employee_no, kind, amount, reason}].',
      jsonb_build_object('field','adjust'));
  end if;
  for h in select * from jsonb_array_elements(coalesce(p_hold, '[]'::jsonb)) loop
    if length(btrim(coalesce(h ->> 'note', ''))) = 0 then
      return ops_core.invalid('hr','payroll', null,'generate',
        'reason_required',
        format('Menahan gaji %s perlu alasan — tercetak di daftar run.', coalesce(h ->> 'employee_no', '?')),
        jsonb_build_object('field','hold', 'employee_no', h ->> 'employee_no'));
    end if;
  end loop;

  v_open := ops_hr.open_payroll_run(p_period_start, p_period_end, p_note, null, p_group);
  if not ops_core.said_ok(v_open) then
    return v_open;
  end if;
  v_no := v_open -> 'data' ->> 'run_no';

  -- An error below is caught at the end of this function, and catching it
  -- undoes everything above it here, the run included: the sheet asked for
  -- one thing.
  for h in select * from jsonb_array_elements(coalesce(p_hold, '[]'::jsonb)) loop
    select e.* into v_emp from ops_hr.employees e where e.employee_no = h ->> 'employee_no';
    if not found then
      raise exception using errcode = 'P0001', message = 'ops_hr:hold_unknown',
        detail = coalesce(h ->> 'employee_no', '');
    end if;
    v_note := btrim(h ->> 'note');
    insert into ops_hr.payroll_run_members (run_no, employee_id, included, components, note, auto, set_by, set_at)
    values (v_no, v_emp.id, false, '{}'::jsonb, v_note, false, auth.uid(), now())
    on conflict (run_no, employee_id) do update
      set included = false, note = excluded.note, auto = false,
          set_by = excluded.set_by, set_at = excluded.set_at;
    n_held := n_held + 1;
  end loop;

  select count(*) into n_in from ops_hr.payroll_run_members
   where run_no = v_no and included;
  if n_in = 0 then
    raise exception using errcode = 'P0001', message = 'ops_hr:nobody_left';
  end if;

  /* 0234 (D388): what was typed on the sheet, through the one seam that
     writes an adjustment — its refusal is this call's refusal, and the run
     goes with it. Only for somebody this run pays. */
  for a in select * from jsonb_array_elements(coalesce(p_adjust, '[]'::jsonb)) loop
    if not exists (
      select 1 from ops_hr.payroll_run_members m
        join ops_hr.employees e on e.id = m.employee_id
       where m.run_no = v_no and m.included and e.employee_no = a ->> 'employee_no') then
      v_refusal := ops_core.invalid('hr','payroll', null,'generate',
        'adjust_not_on_run',
        format('%s tidak dibayar run ini — penyesuaiannya tidak bisa ditulis di sini.',
               coalesce(a ->> 'employee_no', '?')),
        jsonb_build_object('field','adjust', 'employee_no', a ->> 'employee_no'));
      raise exception using errcode = 'P0001', message = 'ops_hr:adjust_refused';
    end if;
    v_adj := ops_hr.add_adjustment(v_no, a ->> 'employee_no',
               (a ->> 'kind')::ops_hr.adjustment_kind_t,
               (a ->> 'amount')::numeric, a ->> 'reason');
    if not ops_core.said_ok(v_adj) then
      v_refusal := v_adj;
      raise exception using errcode = 'P0001', message = 'ops_hr:adjust_refused';
    end if;
    n_adj := n_adj + 1;
  end loop;

  v_res := ops_core.ok('hr','payroll', v_no,'generate',
    jsonb_build_object('run_no', v_no, 'period_start', p_period_start,
                       'period_end', p_period_end, 'pay_group', coalesce(nullif(btrim(p_group), ''), 'all'),
                       'members', n_in, 'held', n_held, 'adjustments', n_adj));
  return ops_core.idem_remember('hr','generate_payroll', p_key, v_res);
exception
  when raise_exception then
    if sqlerrm = 'ops_hr:nobody_left' then
      return ops_core.invalid('hr','payroll', null,'generate',
        'nobody_selected','Tidak ada yang dicentang — run tanpa orang bukan run.',
        jsonb_build_object('field','hold'));
    elsif sqlerrm = 'ops_hr:hold_unknown' then
      return ops_core.not_found('hr','payroll', null,'generate',
        'Ada karyawan di daftar tahan yang tidak dikenal.');
    elsif sqlerrm = 'ops_hr:adjust_refused' then
      return v_refusal;
    end if;
    raise;
  when invalid_text_representation then
    -- A kind the enum does not know, or an amount that is not a number.
    return ops_core.invalid('hr','payroll', null,'generate',
      'adjust_invalid','Jenis atau nominal penyesuaian tidak dikenal.',
      jsonb_build_object('field','adjust'));
end $$;

revoke execute on function ops_hr.generate_payroll(date, date, text, jsonb, text, text, jsonb) from public;
grant execute on function ops_hr.generate_payroll(date, date, text, jsonb, text, text, jsonb) to authenticated;

/* ── retensi, held and given back — HRD's ────────────────────────────────

   `held` and `released` count signed runs (approved or paid); `in_draft` is
   what drafts would add; `balance` is what the business holds today. */
create or replace function ops_hr.retention_balances(p_employee_no text default null)
returns table (
  employee_id uuid, employee_no text, full_name text,
  held bigint, released bigint, balance bigint, in_draft bigint)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    return;
  end if;
  return query
  select e.id, e.employee_no, e.full_name,
         coalesce(-sum(a.amount) filter (where a.kind = 'retention' and r.status <> 'DRAFT'), 0)::bigint,
         coalesce(sum(a.amount) filter (where a.kind = 'retention_release' and r.status <> 'DRAFT'), 0)::bigint,
         coalesce(-sum(a.amount) filter (where r.status <> 'DRAFT'), 0)::bigint,
         coalesce(-sum(a.amount) filter (where r.status = 'DRAFT'), 0)::bigint
    from ops_hr.payroll_adjustments a
    join ops_hr.payroll_runs r on r.run_no = a.run_no
    join ops_hr.employees e on e.id = a.employee_id
   where a.withdrawn_at is null
     and a.kind in ('retention','retention_release')
     and (p_employee_no is null or e.employee_no = p_employee_no)
   group by e.id, e.employee_no, e.full_name
   order by e.full_name;
end $$;
revoke execute on function ops_hr.retention_balances(text) from public;
grant execute on function ops_hr.retention_balances(text) to authenticated;

/* ── one person, as HRD reads them ────────────────────────────────────────

   The period's attendance as payroll counts it (the same `payroll_line_for`),
   the year's leave, and the retensi balance. Refused — no row — to anybody
   without `hrd.read` or `payroll.read`. */
create or replace function ops_hr.employee_standing(
  p_employee_no text, p_from date, p_to date)
returns table (
  employee_no text, full_name text, period_from date, period_to date,
  days_present numeric, days_unpaid int, days_sick_paid int, days_leave_paid int,
  days_open int, late_minutes int, late_days int, overtime_hours numeric,
  allowance_withheld_days int,
  leave_entitlement int, leave_taken int, leave_remaining int,
  retention_balance bigint, retention_in_draft bigint)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_emp ops_hr.employees; p ops_hr.payroll_figures; lb record; rb record;
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    return;
  end if;
  select * into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then return; end if;
  p := ops_hr.payroll_line_for(v_emp.id, p_from, p_to);
  select * into lb from ops_hr.leave_balances(extract(year from p_to)::int) x
   where x.employee_id = v_emp.id;
  select coalesce(-sum(a.amount) filter (where r.status <> 'DRAFT'), 0) as bal,
         coalesce(-sum(a.amount) filter (where r.status = 'DRAFT'), 0) as dr
    into rb
    from ops_hr.payroll_adjustments a
    join ops_hr.payroll_runs r on r.run_no = a.run_no
   where a.employee_id = v_emp.id and a.withdrawn_at is null
     and a.kind in ('retention','retention_release');
  return query select
    v_emp.employee_no, v_emp.full_name, p_from, p_to,
    p.days_present, p.days_unpaid, p.days_sick_paid, p.days_leave_paid,
    p.open_days, p.late_minutes, p.late_days, p.overtime_hours,
    p.allowance_withheld_days,
    lb.entitlement::int, lb.taken::int, lb.remaining::int,
    rb.bal::bigint, rb.dr::bigint;
end $$;
revoke execute on function ops_hr.employee_standing(text, date, date) from public;
grant execute on function ops_hr.employee_standing(text, date, date) to authenticated;
