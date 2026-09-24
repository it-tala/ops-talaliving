-- 0137 — data diri yang diminta Wajib Lapor Ketenagakerjaan, dan rekap yang
--        mencetaknya.
--
-- ── the gap, stated plainly ───────────────────────────────────────────────
--
-- WLKP asks for a headcount broken down by **jenis kelamin, umur, pendidikan,
-- kewarganegaraan, disabilitas, jabatan** and **status hubungan kerja**.
-- `ops_hr.employees` holds a name, a position, a unit, a pay basis and a start
-- date. Four of those seven dimensions have no data behind them anywhere in
-- this database, so the report cannot be produced at all — not badly, not
-- approximately: at all.
--
-- ── why this is a table and not six columns on `employees` ────────────────
--
-- It was asked for as six columns, and six columns is what it holds. It does
-- not sit on `employees`, and the reason is the one already written into `0056`
-- for `employee_documents` (D196): **`employees` is readable by anyone with
-- `hrd.read` or `payroll.read`, and `0040` granted select on every table in
-- this schema.** A date of birth and a marital status on that table would be
-- readable by every payroll account the day they were added, and nothing would
-- have said so.
--
-- Postgres can revoke a single column, and that was the obvious alternative and
-- is worse: PostgREST reads with `select=*`, so a column-level revoke does not
-- hide the column, it **fails the whole read** — every existing employee screen
-- would break for exactly the accounts that are supposed to keep working.
--
-- So the same shape `employee_documents` already uses, for the same reason and
-- with the same three parts: a table with **no read policy at all**, a definer
-- function that asks the permission itself, and a grant that is taken back
-- rather than assumed. A client that could select this table could select a
-- birth date, which would make the gate a decoration (F127).
--
-- ── and why the recap is a separate seam from the list ────────────────────
--
-- `wlkp_recap()` returns **counts and nothing else** — no name, no date, no
-- row. That is not squeamishness, it is the actual shape of the obligation: the
-- regulator asks *how many women under 25 hold an SMA*, never *which ones*. So
-- the aggregate is the thing most people need, it can be read by anybody who
-- can already see the roster, and the individual dates stay behind
-- `employee_identities()` with its own check.
--
-- ── what is null, and what null means ─────────────────────────────────────
--
-- Every field is nullable and starts null, because today there are twelve
-- employees and none of this has been collected. **Null is not a category.**
-- The recap counts unknowns in their own bucket per dimension and never folds
-- them into the largest one — a report that silently rounds nine unknowns into
-- *laki-laki* is worse than one that says nine are unknown, because the second
-- can be finished and the first cannot be found. Same rule as `KpiMeasure`:
-- unmeasured is not zero, and here unrecorded is not *tidak*.
--
-- `disabled` is a **nullable boolean** for that reason and not a `not null
-- default false`. False means somebody asked and the answer was no. Null means
-- nobody has asked. A default of false would have turned the second into the
-- first for twelve people at once, silently, in a migration.

create type ops_hr.sex_t as enum ('L','P');

-- The ladder WLKP's own form uses, from the bottom. `TIDAK_TAMAT_SD` is a real
-- answer and a common one in a workshop; leaving it out would push those people
-- into `SD`, which is a wrong figure rather than a missing one.
create type ops_hr.education_t as enum (
  'TIDAK_TAMAT_SD','SD','SMP','SMA','SMK','D1','D2','D3','D4','S1','S2','S3');

create type ops_hr.citizenship_t as enum ('WNI','WNA');

create type ops_hr.marital_t as enum
  ('BELUM_KAWIN','KAWIN','CERAI_HIDUP','CERAI_MATI');

create table ops_hr.employee_identity (
  -- One row per person, and the employee's own id as the key: this is not a
  -- history and nothing here is versioned. A date of birth does not change, and
  -- the three that can — education, marital status, citizenship — are corrected
  -- rather than appended, with the audit log holding who corrected them.
  employee_id      uuid primary key references ops_hr.employees(id),
  born_on          date,
  sex              ops_hr.sex_t,
  education        ops_hr.education_t,
  citizenship      ops_hr.citizenship_t,
  -- Only for WNA, and required for them: *tenaga kerja asing* is counted by
  -- country on the form, so `WNA` with no country is a row that cannot be
  -- reported.
  nationality      text,
  disabled         boolean,
  disability_note  text,
  marital_status   ops_hr.marital_t,
  updated_by       uuid references ops_core.users(id),
  updated_at       timestamptz not null default now(),

  constraint nationality_matches_citizenship check (
    citizenship is null
    or (citizenship = 'WNI' and nationality is null)
    or (citizenship = 'WNA' and nationality is not null and length(btrim(nationality)) > 0)),
  -- A note about a disability nobody recorded is a note about nothing, and a
  -- note left behind after the answer was corrected to *tidak* is worse: it
  -- keeps saying something the row no longer claims.
  constraint disability_note_needs_a_yes check (
    disability_note is null or disabled is true),
  -- Nobody in this company was born in 1870. A typed year is the field most
  -- likely to be wrong by a century, and every age band in the recap is
  -- computed from it.
  --
  -- The bounds are **fixed dates and not `current_date`**, because a check
  -- constraint may only call immutable functions and `current_date` is not one
  -- — a row that satisfied the constraint in 2026 would have to keep satisfying
  -- it forever, and Postgres refuses the whole constraint rather than let that
  -- rot. So the constraint catches the century and `save_employee_identity()`
  -- catches the future, with a sentence.
  constraint born_is_plausible check (
    born_on is null or born_on between date '1930-01-01' and date '2100-01-01')
);

comment on table ops_hr.employee_identity is
  'Data diri untuk WLKP. No read policy: reads go through employee_identities(), which asks hrd.read itself (D196).';

/* ── age, derived and never stored ────────────────────────────────────────
 *
 *  A3: a stored age is wrong every morning until something writes to the row.
 *  Office day rather than `current_date`, because the two name different days
 *  for eight hours out of every twenty-four and a birthday should not depend on
 *  which of them the server happened to use (F17).
 */
create or replace function ops_hr.age_on(p_born date, p_on date)
returns int
language sql immutable as $$
  select case when p_born is null or p_on is null then null
              else extract(year from age(p_on, p_born))::int end;
$$;

/* The bands the form asks for. A function rather than a `case` repeated in the
 * recap and again on the screen: two copies of a boundary is how somebody aged
 * exactly 25 ends up counted twice. */
create or replace function ops_hr.age_band(p_age int)
returns text
language sql immutable as $$
  select case
    when p_age is null then 'tidak_diketahui'
    when p_age < 18 then 'di_bawah_18'
    when p_age < 25 then '18_24'
    when p_age < 35 then '25_34'
    when p_age < 45 then '35_44'
    when p_age < 55 then '45_54'
    else '55_ke_atas' end;
$$;

/* ── reading it: the permission is asked here, not by a policy ────────────
 *
 *  Definer, with `revoke select` on the table underneath, exactly as
 *  `employee_documents_of()` is (`0056`). The table is the only place these
 *  dates exist, so anything that can select the table can read a birth date and
 *  the check above it becomes decoration.
 *
 *  It answers for everybody or for one person, in one signature — `00_no_overloads`
 *  allows a function exactly one, and two names for *the list* and *the row*
 *  would be two places for the permission check to drift apart.
 */
create type ops_hr.employee_identity_t as (
  employee_id uuid, employee_no text, full_name text,
  position text, unit text, active boolean, joined_on date,
  born_on date, age int, age_band text,
  sex ops_hr.sex_t, education ops_hr.education_t,
  citizenship ops_hr.citizenship_t, nationality text,
  disabled boolean, disability_note text,
  marital_status ops_hr.marital_t,
  -- What the form still cannot be filled in for. Counted per person so the
  -- screen can list *who to chase*, which is the only thing that closes the gap.
  missing text[],
  contract_kind text,
  updated_at timestamptz
);

create or replace function ops_hr.employee_identities(p_employee_no text default null)
returns setof ops_hr.employee_identity_t
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select (
    e.id, e.employee_no, e.full_name, e.position, e.unit, e.active, e.joined_on,
    i.born_on,
    ops_hr.age_on(i.born_on, ops_core.office_day()),
    ops_hr.age_band(ops_hr.age_on(i.born_on, ops_core.office_day())),
    i.sex, i.education, i.citizenship, i.nationality,
    i.disabled, i.disability_note, i.marital_status,
    /* Built from the columns themselves rather than from a hand-kept list, so
       a seventh field added later cannot be forgotten here. `disabled` counts
       as answered when it is false — somebody asked, and no is an answer. */
    (array_remove(array[
       case when i.born_on        is null then 'tanggal_lahir' end,
       case when i.sex            is null then 'jenis_kelamin' end,
       case when i.education      is null then 'pendidikan' end,
       case when i.citizenship    is null then 'kewarganegaraan' end,
       case when i.disabled       is null then 'disabilitas' end,
       case when i.marital_status is null then 'status_kawin' end
     ], null))::text[],
    /* The seventh dimension the form asks for, and the only one already in the
       database: PKWT or PKWTT. Read from the contract that **covers today and
       was activated**, not from the newest row — a draft nobody signed does not
       describe anybody's status, and a contract that ended in June does not
       describe it in September. */
    (select c.kind::text from ops_hr.employment_contracts c
      where c.employee_id = e.id and c.status = 'active'
        and c.effective_from <= ops_core.office_day()
        and (c.ends_on is null or c.ends_on >= ops_core.office_day())
        and (c.ended_on is null or c.ended_on >= ops_core.office_day())
      order by c.effective_from desc limit 1),
    i.updated_at
  )::ops_hr.employee_identity_t
  from ops_hr.employees e
  left join ops_hr.employee_identity i on i.employee_id = e.id
  where ops_core.has_permission('hrd.read')
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.active desc, e.employee_no collate "C";
$$;

/* ── writing it ───────────────────────────────────────────────────────────
 *
 *  An upsert, because there is one row per person and no history: the first
 *  save creates it and every later one corrects it. The corrections that matter
 *  are in the audit log with a name against them, which is where *who changed
 *  this man's date of birth* is answered.
 */
create or replace function ops_hr.save_employee_identity(
  p_employee_no text,
  p_born_on date default null, p_sex ops_hr.sex_t default null,
  p_education ops_hr.education_t default null,
  p_citizenship ops_hr.citizenship_t default null, p_nationality text default null,
  p_disabled boolean default null, p_disability_note text default null,
  p_marital_status ops_hr.marital_t default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; v_res jsonb;
  v_nat text := nullif(btrim(coalesce(p_nationality,'')),'');
  v_note text := nullif(btrim(coalesce(p_disability_note,'')),'');
begin
  v_replayed := ops_core.idem_replay('hr','save_employee_identity', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','employee_identity', p_employee_no,'save',
      'not_permitted','Mengubah data diri karyawan butuh akses HRD.');
  end if;

  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','employee_identity', p_employee_no,'save',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;

  /* The half the constraint cannot hold, because a check may only call
     immutable functions and *today* is not one. */
  if p_born_on is not null and p_born_on > ops_core.office_day() then
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'born_in_the_future',
      format('Tanggal lahir %s belum terjadi.', p_born_on),
      jsonb_build_object('field','born_on'));
  end if;
  if p_born_on is not null and p_born_on < date '1930-01-01' then
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'born_too_long_ago',
      format('Tanggal lahir %s hampir pasti salah ketik tahunnya.', p_born_on),
      jsonb_build_object('field','born_on'));
  end if;
  if emp.joined_on is not null and p_born_on is not null
     and ops_hr.age_on(p_born_on, emp.joined_on) < 15 then
    /* Not a refusal about the law — it is a refusal about the typing. Somebody
       recorded as starting work at eleven has a wrong date somewhere, and the
       recap would put them in `di_bawah_18` forever. */
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'born_after_joining',
      format('Umur %s tahun pada tanggal masuk (%s) — salah satu dari dua tanggal itu keliru.',
             ops_hr.age_on(p_born_on, emp.joined_on), emp.joined_on),
      jsonb_build_object('field','born_on'));
  end if;
  if p_citizenship = 'WNA' and v_nat is null then
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'nationality_required',
      'WNA dilaporkan per negara, jadi negaranya harus disebut.',
      jsonb_build_object('field','nationality'));
  end if;
  if p_citizenship = 'WNI' and v_nat is not null then
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'nationality_not_for_wni',
      'WNI tidak perlu negara terpisah.', jsonb_build_object('field','nationality'));
  end if;
  if v_note is not null and p_disabled is not true then
    return ops_core.invalid('hr','employee_identity', p_employee_no,'save',
      'note_without_a_yes',
      'Keterangan disabilitas hanya untuk yang jawabannya ya.',
      jsonb_build_object('field','disability_note'));
  end if;

  insert into ops_hr.employee_identity as t
    (employee_id, born_on, sex, education, citizenship, nationality,
     disabled, disability_note, marital_status, updated_by, updated_at)
  values (emp.id, p_born_on, p_sex, p_education, p_citizenship, v_nat,
          p_disabled, v_note, p_marital_status, auth.uid(), now())
  on conflict (employee_id) do update set
    born_on = excluded.born_on, sex = excluded.sex,
    education = excluded.education, citizenship = excluded.citizenship,
    nationality = excluded.nationality,
    disabled = excluded.disabled, disability_note = excluded.disability_note,
    marital_status = excluded.marital_status,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  v_res := ops_core.ok('hr','employee_identity', emp.employee_no,'save',
    jsonb_build_object('employee_no', emp.employee_no),
    null,
    /* The audit says **which fields were given**, never their values: an audit
       row that repeats a date of birth has copied the thing this table exists
       to keep in one place (D196). */
    jsonb_build_object('employee', emp.employee_no,
      'fields', (select coalesce(jsonb_agg(f), '[]'::jsonb) from unnest(array_remove(array[
         case when p_born_on        is not null then 'tanggal_lahir' end,
         case when p_sex            is not null then 'jenis_kelamin' end,
         case when p_education      is not null then 'pendidikan' end,
         case when p_citizenship    is not null then 'kewarganegaraan' end,
         case when p_disabled       is not null then 'disabilitas' end,
         case when p_marital_status is not null then 'status_kawin' end
       ], null)) f)));
  return ops_core.idem_remember('hr','save_employee_identity', p_key, v_res);
end $$;

/* ── the recap the form is transcribed from ───────────────────────────────
 *
 *  Counts and nothing else. No name leaves this function, which is why it can
 *  be offered to `hrd.read` **or** `payroll.read` while
 *  `employee_identities()` stays on `hrd.read` alone: *berapa orang* is a
 *  different question from *siapa*, and only the first one is on the form.
 *
 *  Every dimension carries its own `tidak_diketahui`, and the counts add to the
 *  headcount in all seven. That is the property the smoke file asserts, and it
 *  is worth asserting because the failure it catches is silent: a `filter`
 *  whose `else` quietly drops the nulls produces a table that looks finished
 *  and is short by nine people.
 *
 *  `p_asof` exists because WLKP is filed for a date, and *who was employed on
 *  31 December* is not answerable from `active` alone — somebody who left in
 *  November is inactive now and was staff then. So the headcount is taken from
 *  `joined_on`/`left_on` against the date, and `active` is not consulted at all.
 */
create or replace function ops_hr.wlkp_recap(p_asof date default null)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare d date; v_out jsonb;
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    return null;
  end if;
  d := coalesce(p_asof, ops_core.office_day());

  /* One CTE, read once, counted eight ways.
   *
   *  It began as a temp table, which is the obvious way to reuse a row set and
   *  is wrong here twice over: `create table` makes a function volatile, so the
   *  planner stops caching it and `stable` becomes a lie, and a temp table
   *  named `_wlkp` is shared by everything in the session — two calls in one
   *  transaction would read each other's rows. A CTE is visible to every
   *  branch below it and belongs to this statement alone.
   */
  with people as (
    select
      coalesce(nullif(btrim(coalesce(e.position,'')),''), 'tidak_diketahui') as position,
      coalesce(i.sex::text, 'tidak_diketahui')                              as sex,
      ops_hr.age_band(ops_hr.age_on(i.born_on, d))                          as band,
      coalesce(i.education::text, 'tidak_diketahui')                        as education,
      coalesce(i.citizenship::text, 'tidak_diketahui')                      as citizenship,
      case when i.citizenship = 'WNA' then i.nationality end                as nationality,
      case when i.disabled is null then 'tidak_diketahui'
           when i.disabled then 'ya' else 'tidak' end                       as disability,
      coalesce(i.marital_status::text, 'tidak_diketahui')                   as marital,
      coalesce((select c.kind::text from ops_hr.employment_contracts c
                 where c.employee_id = e.id and c.status = 'active'
                   and c.effective_from <= d
                   and (c.ends_on is null or c.ends_on >= d)
                   and (c.ended_on is null or c.ended_on >= d)
                 order by c.effective_from desc limit 1), 'tanpa_kontrak')  as status,
      (i.born_on is null)        as no_born,
      (i.sex is null)            as no_sex,
      (i.education is null)      as no_education,
      (i.citizenship is null)    as no_citizenship,
      (i.disabled is null)       as no_disability,
      (i.marital_status is null) as no_marital
    from ops_hr.employees e
    left join ops_hr.employee_identity i on i.employee_id = e.id
    -- Employed **on that date**, which is not the same as active today.
    where coalesce(e.joined_on, date '1900-01-01') <= d
      and (e.left_on is null or e.left_on >= d)
  ),
  dims as (
    select 'jenis_kelamin'         as dim, sex          as key from people
    union all select 'kelompok_umur',         band              from people
    union all select 'pendidikan',            education         from people
    union all select 'kewarganegaraan',       citizenship       from people
    union all select 'disabilitas',           disability        from people
    union all select 'status_kawin',          marital           from people
    union all select 'jabatan',               position          from people
    union all select 'status_hubungan_kerja', status            from people
  ),
  grouped as (
    select dim, jsonb_agg(jsonb_build_object('key', key, 'count', n)
                          order by n desc, key collate "C") as rows
      from (select dim, key, count(*)::int as n from dims group by dim, key) c
     group by dim
  ),
  missing as (
    select f, n from (
      select 'tanggal_lahir'   as f, count(*) filter (where no_born)::int        as n from people
      union all select 'jenis_kelamin',   count(*) filter (where no_sex)::int         from people
      union all select 'pendidikan',      count(*) filter (where no_education)::int   from people
      union all select 'kewarganegaraan', count(*) filter (where no_citizenship)::int from people
      union all select 'disabilitas',     count(*) filter (where no_disability)::int  from people
      union all select 'status_kawin',    count(*) filter (where no_marital)::int     from people
    ) m where n > 0
  )
  select jsonb_build_object(
    'asof', d,
    'headcount', (select count(*)::int from people),
    -- The number that decides whether the report may be filed at all. Printed
    -- at the top of the screen beside the tables, so nobody transcribes a
    -- breakdown into the portal without seeing how much of it is `belum diisi`.
    'complete', (select count(*)::int from people
                  where not (no_born or no_sex or no_education
                             or no_citizenship or no_disability or no_marital)),
    'incomplete', (select count(*)::int from people
                    where no_born or no_sex or no_education
                       or no_citizenship or no_disability or no_marital),
    'by', coalesce((select jsonb_object_agg(dim, rows) from grouped), '{}'::jsonb),
    -- WNA are reported by country, so the countries are listed rather than
    -- summed into one bar.
    'nationalities', coalesce((
      select jsonb_agg(jsonb_build_object('country', nationality, 'count', n)
                       order by n desc, nationality collate "C")
        from (select nationality, count(*)::int as n from people
               where nationality is not null group by nationality) c), '[]'::jsonb),
    -- Which field is holding the report up, and for how many people. This is
    -- the line that turns *the report is not ready* into a day's work.
    'missing_by_field', coalesce((select jsonb_object_agg(f, n) from missing), '{}'::jsonb))
  into v_out;

  return v_out;
end $$;

/* ── access ───────────────────────────────────────────────────────────────
 *
 *  RLS on, and **no policy at all** — not even for select. `0040`'s blanket
 *  grant reaches tables created years after it ran, so the grant is taken back
 *  the moment this one is created, the same line `0056` had to write for
 *  `employee_documents` and the same one `0136` had to write again for a
 *  rebuilt view (F147). The two functions above are the only road in, and each
 *  asks its own permission.
 */
alter table ops_hr.employee_identity enable row level security;

/* **This line changes nothing today, and it is staying.** Removing it and
 * running the whole battery finds no failure, because `0040`'s blanket grant
 * ran years before this table existed and no grant on it was ever made — so
 * there is nothing to take back. It is here against the next migration that
 * copies `grant select on all tables in schema ops_hr` out of one of the six
 * that already carry it, which is exactly F147 and took a working `employee_documents`
 * revoke with it. A surviving mutation is a question, not a clearance: the
 * question here was *what is actually holding the door shut*, and the answer is
 * the line above and the absence below, which `101` now asserts directly. */
revoke select, insert, update, delete on ops_hr.employee_identity from authenticated;

revoke execute on function ops_hr.employee_identities(text) from public;
revoke execute on function ops_hr.save_employee_identity(
  text, date, ops_hr.sex_t, ops_hr.education_t, ops_hr.citizenship_t, text,
  boolean, text, ops_hr.marital_t, text) from public;
revoke execute on function ops_hr.wlkp_recap(date) from public;

grant execute on function ops_hr.age_on(date, date) to authenticated;
grant execute on function ops_hr.age_band(int) to authenticated;
grant execute on function ops_hr.employee_identities(text) to authenticated;
grant execute on function ops_hr.save_employee_identity(
  text, date, ops_hr.sex_t, ops_hr.education_t, ops_hr.citizenship_t, text,
  boolean, text, ops_hr.marital_t, text) to authenticated;
grant execute on function ops_hr.wlkp_recap(date) to authenticated;
