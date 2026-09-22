-- 0053_hr_people_seams.sql — the person, their terms, and the berkas 201.
--
-- `0040` built `employees` and opened the table to `hrd.create`/`hrd.update`
-- through a policy, which is how every HR table shipped: writable, with no road
-- in that mints anything, writes the trail, or turns a refusal into a sentence.
-- And the **berkas 201 has no table at all** — `employee_documents` exists only
-- in the demo's browser state, which is why `/hrd/berkas-201` has nothing to
-- read against a real database.
--
-- ## An identity number is not a column a client may select
--
-- D196 says a KTP number is masked on every read and comes back only from a
-- reveal that writes an audit row. `0048` does the masking in `v_enrolment` and
-- leaves `enrolments.member_no` selectable underneath, which makes the mask a
-- decoration: `select member_no from ops_hr.enrolments` answers it in full. See
-- F127.
--
-- A view cannot fix this here. Every view in the ladder is `security_invoker =
-- on` and `0037` asserts there are exactly two exceptions — so a view can only
-- read columns its caller can read, and a column the caller can read is a
-- column the caller can select directly.
--
-- So **`employee_documents` is not selectable at all**. There is no read policy
-- and no select grant; the only road to a row is
-- `ops_hr.employee_documents_of()`, a definer function that checks the
-- permission itself and **blanks the number before it leaves the database** for
-- the five kinds that identify a person rather than a document. What the screen
-- gets is the mask, the length, and whether that length is what the kind wants
-- — enough to say *this reading is wrong* without showing a digit of it.
--
-- ## One road for the file
--
-- `file_employee_document` does not write `attachment_links`; it **calls the
-- documents seam** that owns them. That is the same rule `0051` kept by
-- refusing to grow an `attach_overtime_doc` — one place a file can be attached,
-- so there is one place it can be forgotten — and it is why a KTP is filed as a
-- `ktp` here and everywhere else (ADR-010).

insert into ops_core.doc_prefixes (prefix, what) values ('edc', 'employee document');

-- ── the kinds ─────────────────────────────────────────────────────────────
--
-- Tracks `EmployeeDocKind` in `src/services/hr/contracts.ts` exactly. It is not
-- `ops_core.doc_kind_t`: that one is the **evidence road's** vocabulary, where
-- both BPJS cards are one `bpjs` and a warning letter is `surat_peringatan`.
-- This one is the personnel file's, where the two BPJS numbers are different
-- numbers on different cards. `doc_kind_of()` below is the map between them,
-- in one place.
create type ops_hr.employee_doc_kind_t as enum (
  'ktp','kartu_keluarga','ijazah','cv','kontrak_kerja','npwp',
  'bpjs_kesehatan','bpjs_tk','foto','sertifikat','sp','lainnya');

create type ops_hr.doc_no_source_t as enum ('extracted','typed','pending');

create or replace function ops_hr.doc_kind_of(p_kind ops_hr.employee_doc_kind_t)
returns ops_core.doc_kind_t language sql immutable as $$
  select (case p_kind
    when 'bpjs_kesehatan' then 'bpjs'
    when 'bpjs_tk'        then 'bpjs'
    when 'sp'             then 'surat_peringatan'
    when 'lainnya'        then 'other'
    else p_kind::text end)::ops_core.doc_kind_t
$$;

-- **The five that identify a person, not a document.** A contract number, a
-- certificate number and an ijazah number name a piece of paper. A NIK, a KK
-- number, an NPWP and a BPJS membership number are enough on their own to open
-- an account in somebody's name. Masking the first group too would be ritual,
-- and a screen full of rituals is a screen people click through (D195).
create or replace function ops_hr.doc_no_is_sensitive(p_kind ops_hr.employee_doc_kind_t)
returns boolean language sql immutable as $$
  select p_kind in ('ktp','kartu_keluarga','npwp','bpjs_kesehatan','bpjs_tk')
$$;

-- How many characters the number has where the format is fixed, so a fifteen
-- digit NIK can be called a failed reading without anybody seeing it. Null
-- where the format is not fixed.
create or replace function ops_hr.doc_no_digits(p_kind ops_hr.employee_doc_kind_t)
returns int language sql immutable as $$
  select case p_kind
    when 'ktp' then 16 when 'kartu_keluarga' then 16 when 'npwp' then 15
    when 'bpjs_kesehatan' then 13 when 'bpjs_tk' then 11 end
$$;

-- ── the file ──────────────────────────────────────────────────────────────
create table ops_hr.employee_documents (
  id             uuid primary key default gen_random_uuid(),
  doc_ref        text not null unique default ops_core.next_doc_number('edc'),
  employee_id    uuid not null references ops_hr.employees(id),
  kind           ops_hr.employee_doc_kind_t not null,
  -- The link on the evidence road, not the file: the road says which file, who
  -- attached it and whether it is still attached, and duplicating any of that
  -- here would be a second answer to the same question (ADR-010, A3).
  link_id        uuid references ops_core.attachment_links(id),
  doc_no         text,
  doc_no_source  ops_hr.doc_no_source_t,
  issued_on      date,
  expires_on     date,
  note           text,
  recorded_by    uuid not null references ops_core.users(id),
  recorded_at    timestamptz not null default now(),

  -- A number with no scan is still a record — the number is usually what
  -- somebody actually needs — so neither is required and one of them is.
  constraint something_to_file check (
    link_id is not null or (doc_no is not null and length(btrim(doc_no)) > 0)),
  -- Where the number came from, recorded at the moment it arrives. A scan filed
  -- with no number is **pending** — somebody is expected to come back to it —
  -- which is a different thing from blank because nobody cared.
  constraint source_follows_the_number check (
    (doc_no is not null) = (doc_no_source in ('typed','extracted'))),
  -- A number cannot have been read out of a file that is not there. The demo's
  -- seeds made exactly this claim seventeen times before it was caught (F57).
  constraint extracted_needs_the_file check (
    doc_no_source is distinct from 'extracted' or link_id is not null),
  constraint expiry_after_issue check (
    expires_on is null or issued_on is null or expires_on >= issued_on)
);

create index employee_docs_idx on ops_hr.employee_documents (employee_id, kind);

-- ── reading one, safely ───────────────────────────────────────────────────
create type ops_hr.employee_document_row as (
  id               uuid,
  doc_ref          text,
  employee_id      uuid,
  employee_no      text,
  kind             ops_hr.employee_doc_kind_t,
  attachment_id    uuid,
  -- Present for a kind that names a document. **Null for a kind that names a
  -- person** — those come back only from a reveal, and only one at a time.
  doc_no           text,
  sensitive        boolean,
  doc_no_masked    text,
  doc_no_length    int,
  doc_no_length_ok boolean,
  doc_no_source    ops_hr.doc_no_source_t,
  issued_on        date,
  expires_on       date,
  note             text,
  recorded_by      uuid,
  recorded_at      timestamptz
);

-- Definer, and the permission is asked here rather than by a policy, because
-- the table has no read policy at all: this function **is** the read.
--
-- `p_employee_no` null means everybody, which is the berkas-201 list.
create or replace function ops_hr.employee_documents_of(p_employee_no text default null)
returns setof ops_hr.employee_document_row
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select
    d.id, d.doc_ref, d.employee_id, e.employee_no, d.kind,
    l.attachment_id,
    case when ops_hr.doc_no_is_sensitive(d.kind) then null else d.doc_no end,
    ops_hr.doc_no_is_sensitive(d.kind),
    case when d.doc_no is null then null
         else regexp_replace(d.doc_no, '[0-9A-Za-z]', '•', 'g') end,
    length(d.doc_no),
    case when d.doc_no is null or ops_hr.doc_no_digits(d.kind) is null then null
         else length(regexp_replace(d.doc_no, '[^0-9]', '', 'g'))
              = ops_hr.doc_no_digits(d.kind) end,
    d.doc_no_source, d.issued_on, d.expires_on, d.note, d.recorded_by, d.recorded_at
  from ops_hr.employee_documents d
  join ops_hr.employees e on e.id = d.employee_id
  -- The link only where it is still a link. An unlinked file stopped being this
  -- person's evidence at a moment somebody chose (A2), and the row stays to say
  -- the number was filed.
  left join ops_core.attachment_links l on l.id = d.link_id and l.unlinked_at is null
  where ops_core.has_permission('hrd.read')
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.employee_no, d.kind, d.recorded_at
$$;

-- ── writing the person ────────────────────────────────────────────────────
--
-- One seam for the new hire and the change of terms, because the screen has one
-- form and the difference is whether the number is already here.
--
-- `p_set_schedule` exists because SQL cannot tell *absent* from *null* and the
-- contract needs to: absent leaves the pattern alone, null is a deliberate
-- unlink, and a save that quietly cleared somebody's working pattern is how
-- their punctuality stops being measurable (D279).
create or replace function ops_hr.save_employee(
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
  p_key             text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_no text; v_emp ops_hr.employees; v_rules jsonb;
  v_before jsonb; v_res jsonb; v_new boolean;
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

  if v_new then
    insert into ops_hr.employees
      (employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
       daily_hours, schedule_code, paid_leave_days, joined_on, note)
    values (v_no, btrim(p_full_name), nullif(btrim(coalesce(p_position,'')), ''),
            coalesce(nullif(btrim(coalesce(p_unit,'')), ''), 'Workshop'),
            p_pay_basis, p_base_rate, coalesce(p_allowance_rate, 0),
            coalesce(p_daily_hours, 8),
            -- Null, never a guess: somebody nobody has linked is **counted and
            -- named** on the schedule screen, which is the gap HR is asked to
            -- close (F70, D279).
            case when p_set_schedule then p_schedule_code end,
            coalesce(p_paid_leave_days, 12),
            coalesce(p_joined_on, ops_core.office_day()),
            nullif(btrim(coalesce(p_note,'')), ''))
    returning * into v_emp;
  else
    v_before := jsonb_build_object(
      'base_rate', v_emp.base_rate, 'allowance_rate', v_emp.allowance_rate,
      'pay_basis', v_emp.pay_basis, 'position', v_emp.position,
      'schedule_code', v_emp.schedule_code);

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
      updated_at      = now()
    where employee_no = v_no
    returning * into v_emp;
  end if;

  v_res := ops_core.ok('hr','employee', v_no, case when v_new then 'create' else 'update' end,
    jsonb_build_object('employee_no', v_no, 'full_name', v_emp.full_name,
                       'pay_basis', v_emp.pay_basis, 'base_rate', v_emp.base_rate,
                       'allowance_rate', v_emp.allowance_rate,
                       'schedule_code', v_emp.schedule_code, 'created', v_new),
    v_before,
    case when v_new then null else jsonb_build_object(
      'base_rate', v_emp.base_rate, 'allowance_rate', v_emp.allowance_rate,
      'pay_basis', v_emp.pay_basis, 'position', v_emp.position,
      'schedule_code', v_emp.schedule_code) end);
  return ops_core.idem_remember('hr','save_employee', p_key, v_res);
end $$;

-- Its own seam as well as a field on the save, because HR reaches it from two
-- screens and *when did his hours change* has to be answerable from whichever
-- one they used (D281).
create or replace function ops_hr.set_employee_schedule(
  p_employee_no text, p_schedule_code text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_rules jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','set_employee_schedule', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','employee', p_employee_no,'set_schedule',
      'not_permitted','Setting somebody''s working pattern needs HR access.');
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','employee', p_employee_no,'set_schedule',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;

  if p_schedule_code is not null then
    v_rules := ops_hr.rules_on(ops_core.office_day());
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_rules -> 'schedules','[]'::jsonb)) sc
       where sc ->> 'code' = p_schedule_code) then
      return ops_core.invalid('hr','employee', p_employee_no,'set_schedule',
        'schedule_unknown',
        format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', p_schedule_code),
        jsonb_build_object('field','schedule_code'));
    end if;
  end if;

  if v_emp.schedule_code is not distinct from p_schedule_code then
    return ops_core.noop('hr','employee', p_employee_no,'set_schedule',
      'Jadwalnya sudah itu.',
      jsonb_build_object('employee_no', p_employee_no, 'schedule_code', p_schedule_code));
  end if;

  update ops_hr.employees set schedule_code = p_schedule_code, updated_at = now()
   where employee_no = p_employee_no;

  v_res := ops_core.ok('hr','employee', p_employee_no,'set_schedule',
    jsonb_build_object('employee_no', p_employee_no, 'schedule_code', p_schedule_code),
    jsonb_build_object('schedule_code', v_emp.schedule_code),
    jsonb_build_object('schedule_code', p_schedule_code));
  return ops_core.idem_remember('hr','set_employee_schedule', p_key, v_res);
end $$;

-- ── filing a document ─────────────────────────────────────────────────────
create or replace function ops_hr.file_employee_document(
  p_employee_no   text,
  p_kind          ops_hr.employee_doc_kind_t,
  p_attachment_id uuid default null,
  p_doc_no        text default null,
  p_doc_no_source ops_hr.doc_no_source_t default null,
  p_issued_on     date default null,
  p_expires_on    date default null,
  p_note          text default null,
  p_key           text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp ops_hr.employees; v_no text; v_link uuid;
  v_linked jsonb; v_source ops_hr.doc_no_source_t; v_ref text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','file_employee_document', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','employee_document', p_employee_no,'file',
      'not_permitted','Filing somebody''s berkas needs HR access.');
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','employee_document', p_employee_no,'file',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;

  v_no := nullif(btrim(coalesce(p_doc_no,'')), '');
  if p_attachment_id is null and v_no is null then
    return ops_core.invalid('hr','employee_document', p_employee_no,'file',
      'nothing_to_file','Lampirkan berkasnya atau tulis nomornya. Satu baris kosong bukan dokumen.',
      jsonb_build_object('field','doc_no'));
  end if;
  if p_doc_no_source = 'extracted' and p_attachment_id is null then
    return ops_core.invalid('hr','employee_document', p_employee_no,'file',
      'extracted_without_file',
      'Nomor tidak bisa ditandai terbaca dari berkas kalau berkasnya tidak ada. '
      'Lampirkan berkasnya, atau tandai diketik.',
      jsonb_build_object('field','doc_no_source'));
  end if;
  if p_expires_on is not null and p_issued_on is not null and p_expires_on < p_issued_on then
    return ops_core.invalid('hr','employee_document', p_employee_no,'file',
      'expiry_before_issue','Tanggal berakhir mendahului tanggal terbit.',
      jsonb_build_object('field','expires_on'));
  end if;

  -- **The documents seam files it, not this one.** One road on and one road
  -- off, so there is one place a file can be attached and one place it can be
  -- forgotten (ADR-010, and `0051`'s reason for having no `attach_overtime_doc`).
  if p_attachment_id is not null then
    v_linked := ops_core.attach_link(p_attachment_id,'employee', p_employee_no,
                                     ops_hr.doc_kind_of(p_kind)::text);
    if not ops_core.said_ok(v_linked) then return v_linked; end if;
    select id into v_link from ops_core.attachment_links
     where attachment_id = p_attachment_id and entity = 'employee'
       and entity_no = p_employee_no and kind = ops_hr.doc_kind_of(p_kind)
       and unlinked_at is null;
  end if;

  v_source := case when v_no is not null then coalesce(p_doc_no_source, 'typed')
                   else 'pending' end;

  insert into ops_hr.employee_documents
    (employee_id, kind, link_id, doc_no, doc_no_source, issued_on, expires_on, note, recorded_by)
  values (v_emp.id, p_kind, v_link, v_no, v_source, p_issued_on, p_expires_on,
          nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  returning doc_ref into v_ref;

  -- The trail says a number was filed and never what it is. An audit row nobody
  -- may delete is the worst place in the system to keep a NIK.
  v_res := ops_core.ok('hr','employee_document', p_employee_no,'file',
    jsonb_build_object('doc_ref', v_ref, 'employee_no', p_employee_no, 'kind', p_kind,
                       'doc_no_source', v_source, 'attached', p_attachment_id is not null,
                       'expires_on', p_expires_on),
    null,
    jsonb_build_object('kind', p_kind,
      'doc_no', case when v_no is null then null
                     when ops_hr.doc_no_is_sensitive(p_kind) then '(disamarkan)'
                     else v_no end,
      'expires_on', p_expires_on));
  return ops_core.idem_remember('hr','file_employee_document', p_key, v_res);
end $$;

-- ── reading one number, on purpose ────────────────────────────────────────
--
-- The one act on this screen that is a **read** and still belongs in the audit
-- trail, for two reasons that are easy to get half right.
--
-- It goes to `audit_log` rather than the activity log, because the activity log
-- keeps detail for thirty days (D188) and *who looked at Karjo's KTP* is asked
-- months later, usually by Karjo. And the row it writes **must not contain the
-- number**: a log of who read a secret that stores the secret has multiplied
-- the thing it was protecting, in the one table nobody may ever delete from
-- (D196, D197).
create or replace function ops_hr.reveal_employee_doc_no(
  p_doc_ref text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_doc ops_hr.employee_documents; v_emp ops_hr.employees; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','reveal_employee_doc_no', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.read') then
    return ops_core.refused('hr','employee_document', p_doc_ref,'reveal',
      'not_permitted','Membuka nomor identitas butuh akses HRD.');
  end if;

  select d.* into v_doc from ops_hr.employee_documents d where d.doc_ref = p_doc_ref;
  if not found then
    return ops_core.not_found('hr','employee_document', p_doc_ref,'reveal','Dokumen tidak ada.');
  end if;
  if v_doc.doc_no is null then
    return ops_core.invalid('hr','employee_document', p_doc_ref,'reveal',
      'no_number','Dokumen ini belum punya nomor untuk dibuka.',
      jsonb_build_object('field','doc_no'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.id = v_doc.employee_id;

  v_res := ops_core.ok('hr','employee_document', v_emp.employee_no,'reveal',
    jsonb_build_object('doc_ref', p_doc_ref, 'doc_no', v_doc.doc_no,
                       'revealed_at', now()),
    null,
    -- Whose, and which kind. Never the number.
    jsonb_build_object('kind', v_doc.kind, 'employee', v_emp.full_name));
  return ops_core.idem_remember('hr','reveal_employee_doc_no', p_key, v_res);
end $$;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.employee_documents enable row level security;

-- **No read policy, deliberately.** The number lives in this table and a client
-- that could select the table could select the number, which would make the
-- masking above a decoration (F127). Reading goes through
-- `employee_documents_of()`, which asks the permission itself.
create policy employee_docs_new on ops_hr.employee_documents for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));

-- `0040` granted select on every table in this schema, including the ones that
-- did not exist yet only because they were added later. This one is taken back
-- the moment it is created.
revoke select on ops_hr.employee_documents from authenticated;
grant insert on ops_hr.employee_documents to authenticated;

grant execute on function
  ops_hr.doc_kind_of(ops_hr.employee_doc_kind_t),
  ops_hr.doc_no_is_sensitive(ops_hr.employee_doc_kind_t),
  ops_hr.doc_no_digits(ops_hr.employee_doc_kind_t),
  ops_hr.employee_documents_of(text),
  ops_hr.save_employee(text, text, text, text, ops_hr.pay_basis_t, bigint, bigint,
                       numeric, text, boolean, int, date, text, text),
  ops_hr.set_employee_schedule(text, text, text),
  ops_hr.file_employee_document(text, ops_hr.employee_doc_kind_t, uuid, text,
                                ops_hr.doc_no_source_t, date, date, text, text),
  ops_hr.reveal_employee_doc_no(text, text)
  to authenticated;
