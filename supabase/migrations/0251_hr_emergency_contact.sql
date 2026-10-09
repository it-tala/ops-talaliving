-- 0251 — kontak darurat karyawan (D406).
--
-- Owner (2026-10-09): *di HRD untuk employee tambahkan kontak darurat.*
--
-- Who to call when something happens to somebody at work: a name, how they
-- are related, and a number. Three columns on `ops_hr.employees`, beside the
-- person's own email and phone (0198), for the same reason those sit there:
-- the people who need it are HRD and whoever already reads the record
-- (`hrd.read`, `payroll.read`, the person themself) — nothing wider.
--
--   emergency_name      who to ask for            free text, up to 120
--   emergency_relation  how they are related      free text, up to 40, optional
--                                                 (*Istri*, *Ibu*, *Kakak* …)
--   emergency_phone     where to reach them       digits, + allowed, 8 to 15 —
--                                                 the same shape as `phone`
--
-- Rules (the same refusals in `src/services/hr/employee-rules.ts`):
--
--   1. **A name and a number, together.** A number with no name is a stranger
--      on the line; a name with no number cannot be called. Either alone is
--      refused (`emergency_name_required`, `emergency_phone_required`); the
--      relation is optional and cannot stand without them. A table check says
--      the same, so no other writer can leave half a contact.
--   2. **Not the person's own number** (`emergency_is_own_phone`). The day the
--      contact is needed is the day that phone is not answering.
--   3. Blank clears, absent leaves it — as email and phone (0198). The rules
--      judge the contact **as it will be after the save**, so changing only
--      the relation of somebody who already has a contact is not refused.
--
-- Not repeated into the audit row: it is kept for ever and this is personal
-- data about somebody who is not even an employee (D196).
--
-- The seam takes three more arguments, so it is dropped and made again (two
-- overloads with defaults would make every named call ambiguous). The new ones
-- come last, so every positional call still means what it meant. The body is
-- 0198's with the additions marked `0251`.

alter table ops_hr.employees
  add column if not exists emergency_name     text,
  add column if not exists emergency_relation text,
  add column if not exists emergency_phone    text;

alter table ops_hr.employees
  add constraint employees_emergency_phone_shape
    check (emergency_phone is null or emergency_phone ~ '^\+?[0-9]{8,15}$'),
  add constraint employees_emergency_name_len
    check (emergency_name is null or char_length(emergency_name) between 1 and 120),
  add constraint employees_emergency_relation_len
    check (emergency_relation is null or char_length(emergency_relation) between 1 and 40),
  add constraint employees_emergency_whole
    check ((emergency_name is null) = (emergency_phone is null)
           and (emergency_relation is null or emergency_name is not null));

comment on column ops_hr.employees.emergency_name is
  'Kontak darurat: siapa yang dihubungi bila terjadi sesuatu pada orang ini (0251, D406). Selalu bersama emergency_phone.';
comment on column ops_hr.employees.emergency_relation is
  'Hubungan kontak darurat dengan orang ini — Istri, Ibu, Kakak … (0251). Opsional.';
comment on column ops_hr.employees.emergency_phone is
  'Nomor kontak darurat, angka saja dengan + di depan bila ada (0251). Bukan nomor orang ini sendiri.';

drop function if exists ops_hr.save_employee(
  text, text, text, text, ops_hr.pay_basis_t, bigint, bigint,
  numeric, text, boolean, int, date, text, text, text, text);

create function ops_hr.save_employee(
  p_employee_no     text,
  p_full_name       text,
  p_position        text default null,
  p_unit            text default null,
  p_pay_basis       ops_hr.pay_basis_t default null,
  p_base_rate       bigint default null,
  p_allowance_rate  bigint default null,
  p_daily_hours     numeric default null,
  p_schedule_code   text default null,
  p_set_schedule    boolean default false,
  p_paid_leave_days int default null,
  p_joined_on       date default null,
  p_note            text default null,
  p_key             text default null,
  -- 0198: null leaves it as it is; an empty string clears it.
  p_email           text default null,
  p_phone           text default null,
  -- 0251: the same — null leaves it, an empty string clears it.
  p_emergency_name     text default null,
  p_emergency_relation text default null,
  p_emergency_phone    text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_no text; v_emp ops_hr.employees; v_rules jsonb;
  v_before jsonb; v_res jsonb; v_new boolean;
  v_email text; v_phone text; v_joined date; v_from date;
  v_em_name text; v_em_rel text; v_em_phone text; v_own_phone text;
begin
  v_replayed := ops_core.idem_replay('hr','save_employee', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','employee', p_employee_no,'save',
      'not_permitted','Writing the personnel record needs HR access.');
  end if;

  v_no := btrim(coalesce(p_employee_no,''));
  if v_no = '' then
    return ops_core.invalid('hr','employee', null,'save',
      'employee_no_required',
      'Nomor di mesin absensi — itu yang menghubungkan kehadirannya dengan orangnya.',
      jsonb_build_object('field','employee_no'));
  end if;
  if coalesce(btrim(coalesce(p_full_name,'')), '') = '' then
    return ops_core.invalid('hr','employee', v_no,'save',
      'name_required','Nama orang adalah satu hal yang tidak bisa dihilangkan dari slip gaji.',
      jsonb_build_object('field','full_name'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = v_no;
  v_new := not found;

  -- **A rate of zero is not a rate**, and it is only asked of a new record: an
  -- edit that leaves the field alone must not be read as *stop paying them*.
  if v_new and coalesce(p_base_rate, 0) <= 0 then
    return ops_core.invalid('hr','employee', v_no,'save',
      'rate_required','Nol bukan upah. Tulis yang benar-benar dibayar.',
      jsonb_build_object('field','base_rate'));
  end if;
  if p_base_rate is not null and p_base_rate <= 0 then
    return ops_core.invalid('hr','employee', v_no,'save',
      'rate_required','Nol bukan upah. Tulis yang benar-benar dibayar.',
      jsonb_build_object('field','base_rate'));
  end if;
  if p_allowance_rate is not null and p_allowance_rate < 0 then
    return ops_core.invalid('hr','employee', v_no,'save',
      'allowance_negative',
      'Tunjangan tidak bisa negatif. Potongan ditulis sebagai potongan, dengan alasannya.',
      jsonb_build_object('field','allowance_rate'));
  end if;
  if v_new and p_pay_basis is null then
    return ops_core.invalid('hr','employee', v_no,'save',
      'pay_basis_required','Bulanan, harian atau per jam — itu menentukan arti angkanya.',
      jsonb_build_object('field','pay_basis'));
  end if;

  -- A pattern that is not in the rule book in force is a pattern nothing can
  -- measure a day against, so it is refused with the name in it rather than
  -- stored and discovered by a timesheet (D279).
  if p_set_schedule and p_schedule_code is not null then
    v_rules := ops_hr.rules_on(ops_core.office_day());
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_rules -> 'schedules','[]'::jsonb)) sc
       where sc ->> 'code' = p_schedule_code) then
      return ops_core.invalid('hr','employee', v_no,'save',
        'schedule_unknown',
        format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', p_schedule_code),
        jsonb_build_object('field','schedule_code'));
    end if;
  end if;

  /* 0198: how to reach them. Blank is *none*; anything else must be usable. */
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return ops_core.invalid('hr','employee', v_no,'save',
      'email_invalid', format('%s bukan alamat email.', btrim(p_email)),
      jsonb_build_object('field','email'));
  end if;
  v_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[[:space:]().-]', '', 'g');
  if v_phone <> '' and v_phone !~ '^\+?[0-9]{8,15}$' then
    return ops_core.invalid('hr','employee', v_no,'save',
      'phone_invalid',
      format('%s bukan nomor HP — tulis 8 sampai 15 angka, boleh diawali +.', btrim(p_phone)),
      jsonb_build_object('field','phone'));
  end if;

  /* 0251: the emergency contact, judged as it will be after this save —
     absent is what is stored, blank is none. */
  v_em_name := case when p_emergency_name is null then v_emp.emergency_name
                    else nullif(regexp_replace(btrim(p_emergency_name), '[[:space:]]+', ' ', 'g'), '') end;
  v_em_rel  := case when p_emergency_relation is null then v_emp.emergency_relation
                    else nullif(regexp_replace(btrim(p_emergency_relation), '[[:space:]]+', ' ', 'g'), '') end;
  v_em_phone := case when p_emergency_phone is null then v_emp.emergency_phone
                     else nullif(regexp_replace(btrim(p_emergency_phone), '[[:space:]().-]', '', 'g'), '') end;
  if v_em_phone is not null and v_em_phone !~ '^\+?[0-9]{8,15}$' then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_phone_invalid',
      format('%s bukan nomor HP — tulis 8 sampai 15 angka, boleh diawali +.', btrim(p_emergency_phone)),
      jsonb_build_object('field','emergency_phone'));
  end if;
  if v_em_phone is not null and v_em_name is null then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_name_required',
      'Kontak darurat perlu nama — siapa yang dicari saat nomor itu ditelepon.',
      jsonb_build_object('field','emergency_name'));
  end if;
  if v_em_phone is null and (v_em_name is not null or v_em_rel is not null) then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_phone_required',
      'Kontak darurat perlu nomor yang bisa dihubungi.',
      jsonb_build_object('field','emergency_phone'));
  end if;
  if char_length(v_em_name) > 120 then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_name_too_long', 'Nama kontak darurat paling panjang 120 huruf.',
      jsonb_build_object('field','emergency_name'));
  end if;
  if char_length(v_em_rel) > 40 then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_relation_too_long', 'Hubungan ditulis singkat — paling panjang 40 huruf.',
      jsonb_build_object('field','emergency_relation'));
  end if;
  v_own_phone := case when p_phone is null then v_emp.phone else nullif(v_phone, '') end;
  if v_em_phone is not null and v_em_phone = v_own_phone then
    return ops_core.invalid('hr','employee', v_no,'save',
      'emergency_is_own_phone',
      'Nomor darurat sama dengan nomor HP orang ini — saat darurat, justru nomor itu yang tidak menjawab.',
      jsonb_build_object('field','emergency_phone'));
  end if;

  /* 0198: paid leave is written after a year of service. Only a **change to a
     number above nought** is judged, so an edit that carries the stored figure
     back unchanged is never refused over it. */
  v_joined := coalesce(p_joined_on, v_emp.joined_on, case when v_new then ops_core.office_day() end);
  if p_paid_leave_days is not null and p_paid_leave_days > 0
     and p_paid_leave_days is distinct from (case when v_new then null else v_emp.paid_leave_days end) then
    v_from := ops_hr.leave_from(v_joined);
    if v_from is null then
      return ops_core.invalid('hr','employee', v_no,'save',
        'leave_needs_start_date',
        'Hak cuti dihitung dari tanggal masuk — isi tanggal masuknya dulu.',
        jsonb_build_object('field','paid_leave_days'));
    end if;
    if v_from > ops_core.office_day() then
      return ops_core.invalid('hr','employee', v_no,'save',
        'leave_before_one_year',
        format('Hak cuti diisi setelah 1 tahun bekerja — orang ini berhak mulai %s.', v_from),
        jsonb_build_object('field','paid_leave_days', 'from', v_from));
    end if;
  end if;

  if v_new then
    insert into ops_hr.employees
      (employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
       daily_hours, schedule_code, paid_leave_days, joined_on, note, email, phone,
       emergency_name, emergency_relation, emergency_phone)
    values (v_no, btrim(p_full_name), nullif(btrim(coalesce(p_position,'')), ''),
            coalesce(nullif(btrim(coalesce(p_unit,'')), ''), 'Workshop'),
            p_pay_basis, p_base_rate, coalesce(p_allowance_rate, 0),
            coalesce(p_daily_hours, 8),
            -- Null, never a guess: somebody nobody has linked is **counted and
            -- named** on the schedule screen, which is the gap HR is asked to
            -- close (F70, D279).
            case when p_set_schedule then p_schedule_code end,
            -- 0198: nought until a year of service, then HRD's number (D348).
            coalesce(p_paid_leave_days, 0),
            v_joined,
            nullif(btrim(coalesce(p_note,'')), ''),
            nullif(v_email, ''), nullif(v_phone, ''),
            v_em_name, v_em_rel, v_em_phone)
    returning * into v_emp;
  else
    v_before := jsonb_build_object(
      'base_rate', v_emp.base_rate, 'allowance_rate', v_emp.allowance_rate,
      'pay_basis', v_emp.pay_basis, 'position', v_emp.position,
      'schedule_code', v_emp.schedule_code, 'paid_leave_days', v_emp.paid_leave_days);

    -- **Absent means unchanged, never zero.** A save that forgot the allowance
    -- field must not quietly stop paying it (D250).
    update ops_hr.employees set
      full_name       = btrim(p_full_name),
      position        = coalesce(nullif(btrim(coalesce(p_position,'')), ''), position),
      unit            = coalesce(nullif(btrim(coalesce(p_unit,'')), ''), unit),
      pay_basis       = coalesce(p_pay_basis, pay_basis),
      base_rate       = coalesce(p_base_rate, base_rate),
      allowance_rate  = coalesce(p_allowance_rate, allowance_rate),
      daily_hours     = coalesce(p_daily_hours, daily_hours),
      schedule_code   = case when p_set_schedule then p_schedule_code else schedule_code end,
      paid_leave_days = coalesce(p_paid_leave_days, paid_leave_days),
      joined_on       = coalesce(p_joined_on, joined_on),
      note            = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note),
      email           = case when p_email is null then email else nullif(v_email, '') end,
      phone           = case when p_phone is null then phone else nullif(v_phone, '') end,
      -- 0251: already resolved against what was stored.
      emergency_name     = v_em_name,
      emergency_relation = v_em_rel,
      emergency_phone    = v_em_phone,
      updated_at      = now()
    where employee_no = v_no
    returning * into v_emp;
  end if;

  v_res := ops_core.ok('hr','employee', v_no, case when v_new then 'create' else 'update' end,
    jsonb_build_object('employee_no', v_no, 'full_name', v_emp.full_name,
                       'pay_basis', v_emp.pay_basis, 'base_rate', v_emp.base_rate,
                       'allowance_rate', v_emp.allowance_rate,
                       'schedule_code', v_emp.schedule_code,
                       'paid_leave_days', v_emp.paid_leave_days, 'created', v_new),
    v_before,
    -- The contact details — the person's and the emergency contact's — are not
    -- repeated into the audit row: it is kept for ever and a phone number is
    -- personal data (D196). The entitlement is.
    case when v_new then null else jsonb_build_object(
      'base_rate', v_emp.base_rate, 'allowance_rate', v_emp.allowance_rate,
      'pay_basis', v_emp.pay_basis, 'position', v_emp.position,
      'schedule_code', v_emp.schedule_code, 'paid_leave_days', v_emp.paid_leave_days) end);
  return ops_core.idem_remember('hr','save_employee', p_key, v_res);
end $$;

revoke execute on function ops_hr.save_employee(
  text, text, text, text, ops_hr.pay_basis_t, bigint, bigint,
  numeric, text, boolean, int, date, text, text, text, text, text, text, text) from public;
grant execute on function ops_hr.save_employee(
  text, text, text, text, ops_hr.pay_basis_t, bigint, bigint,
  numeric, text, boolean, int, date, text, text, text, text, text, text, text) to authenticated;

analyze ops_hr.employees;
