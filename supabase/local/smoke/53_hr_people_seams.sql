-- hr — the personnel record and the berkas 201 (D196, D250, D279, ADR-010).
--
--   REFUSALS     writing a person with a read grant, with no number, with no
--                name, with a rate of nought, with no basis, with a negative
--                allowance, or onto a working pattern the rule book has never
--                heard of; filing a document for nobody, with neither a file
--                nor a number, claiming a number was read out of a file that
--                is not there, or expiring before it was issued; revealing a
--                number that does not exist, a document that has none, or
--                any of it with a payroll grant
--   DERIVATIONS  a new hire's defaults; **absent means unchanged, never zero**;
--                unlinking a pattern is deliberate and leaving the field out is
--                not; **an identity number never leaves the database** — the
--                mask, the length and whether the length is right do — and the
--                table itself cannot be read at all; a wrong-length NIK is
--                called wrong without showing a digit; a revealed number is
--                audited **without the number**; the file goes on the evidence
--                road and nowhere else

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005301','hrd53@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005302','gaji53@talaliving.com','{"full_name":"Staf Payroll"}'),
  ('ffffffff-0000-0000-0000-000000005303','it53@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005301','hrd','write'),
  -- Payroll reads the roll and may not touch the berkas: a wage clerk has no
  -- business with somebody's KTP.
  ('ffffffff-0000-0000-0000-000000005302','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000005303','it','read');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji', '{
   "week_pattern": "6day",
   "day_starts_minutes": 480,
   "schedules": [
     {"code":"produksi","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"note":null},
     {"code":"kantor","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"note":null}
   ],
   "schedule_by_unit": {"Produksi":"produksi","Kantor":"kantor"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005301');

-- A file already on the evidence road, uploaded the way every file is.
insert into ops_core.attachments (id, storage_path, filename, mime, bytes, source, uploaded_by)
values ('bbbb5300-0000-0000-0000-0000000000f1','drive/ktp-karjo.jpg','ktp-karjo.jpg',
        'image/jpeg', 184320,'web','ffffffff-0000-0000-0000-000000005301'),
       ('bbbb5300-0000-0000-0000-0000000000f2','drive/kontrak-karjo.pdf','kontrak-karjo.pdf',
        'application/pdf', 91000,'web','ffffffff-0000-0000-0000-000000005301');

set local role authenticated;

/* ── REFUSAL: payroll may read the roll and may not write the person ────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005302';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.save_employee('B-0012','Karjo');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.file_employee_document('B-0012','ktp', null,'3271...');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.set_employee_schedule('B-0012','kantor');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.reveal_employee_doc_no('edc-99-99-99_01');
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'a wage clerk has no business with somebody''s KTP, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  select count(*) into n from ops_hr.employees;
  assert n = 0, 'and nobody was written on the way to being refused, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005301';

/* ── REFUSAL: the fields a record cannot do without ─────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_employee('   ','Karjo');
  assert a -> 'error' ->> 'code' = 'employee_no_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.save_employee('B-0012','  ');
  assert a -> 'error' ->> 'code' = 'name_required',
    'a payslip cannot do without somebody''s name, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.save_employee('B-0012','Karjo','Tukang kayu','Produksi','daily', 0);
  assert a -> 'error' ->> 'code' = 'rate_required',
    'nol bukan upah, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- And the rate left out altogether, which is a different branch: absent means
  -- *unchanged* on an edit and there is nothing to leave unchanged on a hire.
  a := ops_hr.save_employee('B-0012','Karjo','Tukang kayu','Produksi','daily');
  assert a -> 'error' ->> 'code' = 'rate_required',
    'a new record has no previous rate to keep, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.save_employee('B-0012','Karjo','Tukang kayu','Produksi', null, 180000);
  assert a -> 'error' ->> 'code' = 'pay_basis_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.save_employee('B-0012','Karjo','Tukang kayu','Produksi','daily', 180000, -5000);
  assert a -> 'error' ->> 'code' = 'allowance_negative',
    'potongan ditulis sebagai potongan, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- A pattern nothing can measure a day against (D279).
  a := ops_hr.save_employee('B-0012','Karjo','Tukang kayu','Produksi','daily', 180000, 20000,
                            null,'gudang', true);
  assert a -> 'error' ->> 'code' = 'schedule_unknown', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%gudang%', 'and the sentence names it';
end $$;

/* ── DERIVATION: a new hire, and what the system fills in ───────────────── */
do $$
declare a jsonb; e ops_hr.employees;
begin
  a := ops_hr.save_employee('B-0012','  Karjo Susanto ','Tukang kayu','Produksi','daily',
                            180000, 20000, null,'produksi', true, null, null, null,'k-53-new');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'created')::boolean, 'a number nobody has used is a new person';

  select * into e from ops_hr.employees where employee_no = 'B-0012';
  assert e.full_name = 'Karjo Susanto', 'trimmed, got "' || e.full_name || '"';
  assert e.paid_leave_days = 12, 'the default entitlement, got ' || e.paid_leave_days;
  assert e.daily_hours = 8, 'got ' || e.daily_hours;
  assert e.joined_on = ops_core.office_day(), 'joined today in WITA, not in UTC (F17)';
  assert e.active, 'and is here';

  -- The same key with a different person behind it: a replay answers with the
  -- first, and B-0013 is not created.
  a := ops_hr.save_employee('B-0013','Orang Lain','x','Kantor','monthly', 4000000,
                            null, null, null, false, null, null, null,'k-53-new');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'employee_no' = 'B-0012', 'got ' || coalesce(a -> 'data' ->> 'employee_no','(null)');
  assert not exists (select 1 from ops_hr.employees where employee_no = 'B-0013'),
    'and nobody was hired behind it';
end $$;

/* ── DERIVATION: a second person, unlinked on purpose ───────────────────── */
do $$
declare a jsonb; e ops_hr.employees;
begin
  a := ops_hr.save_employee('B-0007','Siti Aminah','Amplas', null,'monthly', 4500000);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into e from ops_hr.employees where employee_no = 'B-0007';
  -- Nobody said which unit, so the default. Nobody said which pattern, so
  -- **null rather than a guess** — she is counted and named as unlinked, which
  -- is the gap HR is asked to close rather than an assumption nobody made (F70).
  assert e.unit = 'Workshop', 'got ' || e.unit;
  assert e.schedule_code is null, 'an unset pattern is a gap, not the office clock';
  assert e.allowance_rate = 0, 'and the split has not been made yet, got ' || e.allowance_rate;
end $$;

/* ── DERIVATION: absent means unchanged, never zero (D250) ──────────────── */
do $$
declare a jsonb; e ops_hr.employees;
begin
  -- A save that only moves the rate. The allowance field is not in it, and a
  -- save that forgot it must not quietly stop paying it.
  a := ops_hr.save_employee('B-0012','Karjo Susanto','Tukang kayu utama', null, null, 200000);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert not (a -> 'data' ->> 'created')::boolean, 'the number is already somebody''s';

  select * into e from ops_hr.employees where employee_no = 'B-0012';
  assert e.base_rate = 200000, 'got ' || e.base_rate;
  assert e.allowance_rate = 20000, 'the allowance was not in the save and did not move, got '
    || e.allowance_rate;
  assert e.unit = 'Produksi', 'nor did the unit, got ' || e.unit;
  assert e.position = 'Tukang kayu utama', 'and what was in it did, got ' || e.position;
  -- The pattern is only touched when the save says so.
  assert e.schedule_code = 'produksi', 'got ' || coalesce(e.schedule_code,'(null)');

  assert a -> 'data' ->> 'base_rate' = '200000', 'and the envelope carries the new terms';
end $$;

/* ── DERIVATION and REFUSAL: the working pattern, from its own seam ─────── */
do $$
declare a jsonb;
begin
  a := ops_hr.set_employee_schedule('B-9999','kantor');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.set_employee_schedule('B-0007','gudang');
  assert a -> 'error' ->> 'code' = 'schedule_unknown', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.set_employee_schedule('B-0007','kantor','k-53-sched');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (select schedule_code from ops_hr.employees where employee_no = 'B-0007') = 'kantor';

  -- Setting it to what it already is changed nothing, and says so rather than
  -- writing a row that reads as a decision somebody took.
  a := ops_hr.set_employee_schedule('B-0007','kantor');
  assert a ->> 'outcome' = 'noop', 'got ' || coalesce(a ->> 'outcome','(null)');

  -- Null is a deliberate unlink, which is a different thing from leaving the
  -- field out of a save (D279).
  a := ops_hr.set_employee_schedule('B-0007', null);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (select schedule_code from ops_hr.employees where employee_no = 'B-0007') is null;
end $$;

/* ── REFUSAL: what is not a document ────────────────────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.file_employee_document('B-9999','ktp', null,'3271');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.file_employee_document('B-0012','ktp');
  assert a -> 'error' ->> 'code' = 'nothing_to_file',
    'satu baris kosong bukan dokumen, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- F57's claim: seventeen rows saying *terbaca dari berkas* beside *berkas
  -- belum dipindai*.
  a := ops_hr.file_employee_document('B-0012','ktp', null,'3271234567890001','extracted');
  assert a -> 'error' ->> 'code' = 'extracted_without_file',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.file_employee_document('B-0012','sertifikat','bbbb5300-0000-0000-0000-0000000000f2',
                                     'K3-2026','typed','2026-03-01','2026-02-01');
  assert a -> 'error' ->> 'code' = 'expiry_before_issue', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: a KTP, and what the screen is allowed to see (D196) ────── */
do $$
declare a jsonb; r ops_hr.employee_document_row; n int;
begin
  a := ops_hr.file_employee_document('B-0012','ktp','bbbb5300-0000-0000-0000-0000000000f1',
                                     '3271234567890001','extracted', null, null, null,'k-53-ktp');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into r from ops_hr.employee_documents_of('B-0012') where kind = 'ktp';
  -- **The number does not leave the database.** Not hidden by the screen —
  -- absent from what the screen is sent, or the reveal log below would be
  -- theatre over a number already in the browser.
  assert r.doc_no is null, 'got ' || coalesce(r.doc_no,'(null)');
  assert r.sensitive, 'a NIK names a person, not a document';
  assert r.doc_no_masked = '••••••••••••••••', 'got ' || coalesce(r.doc_no_masked,'(null)');
  assert r.doc_no_length = 16, 'the length survives, because it says whether the reading is plausible';
  assert r.doc_no_length_ok, 'and sixteen is what a NIK has';
  assert r.doc_no_source = 'extracted', 'got ' || coalesce(r.doc_no_source::text,'(null)');

  -- The file went on the evidence road and is reachable from the document.
  assert r.attachment_id = 'bbbb5300-0000-0000-0000-0000000000f1', 'got ' || coalesce(r.attachment_id::text,'(null)');
  select count(*) into n from ops_core.attachment_links l
   where l.entity = 'employee' and l.entity_no = 'B-0012' and l.kind = 'ktp' and l.unlinked_at is null;
  assert n = 1, 'one link, filed by the documents seam and not by this one, got ' || n;

  -- A replay files one document, not two.
  a := ops_hr.file_employee_document('B-0012','npwp', null,'091234567890123','typed',
                                     null, null, null,'k-53-ktp');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  select count(*) into n from ops_hr.employee_documents_of('B-0012');
  assert n = 1, 'got ' || n;
end $$;

/* ── DERIVATION: a wrong reading, said without showing a digit ──────────── */
do $$
declare r ops_hr.employee_document_row;
begin
  -- Fifteen digits where a KK has sixteen. That is a fact about the machine
  -- that read it, not about the person, and it is sayable without the number.
  perform ops_hr.file_employee_document('B-0007','kartu_keluarga', null,'327123456789000','typed');
  select * into r from ops_hr.employee_documents_of('B-0007') where kind = 'kartu_keluarga';
  assert r.doc_no_length = 15, 'got ' || r.doc_no_length;
  assert not r.doc_no_length_ok, 'fifteen is not sixteen, and the screen may say so';
  assert r.doc_no is null, 'while still not seeing it';
end $$;

/* ── DERIVATION: a document that names a document, not a person ─────────── */
do $$
declare a jsonb; r ops_hr.employee_document_row;
begin
  a := ops_hr.file_employee_document('B-0012','kontrak_kerja','bbbb5300-0000-0000-0000-0000000000f2',
                                     'PKWT-26-011','typed','2026-01-02','2027-01-01');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into r from ops_hr.employee_documents_of('B-0012') where kind = 'kontrak_kerja';
  -- A contract number identifies a piece of paper. Masking it would be ritual,
  -- and a screen full of rituals is one people click through (D195).
  assert not r.sensitive, 'a contract number is not an identity number';
  assert r.doc_no = 'PKWT-26-011', 'got ' || coalesce(r.doc_no,'(null)');
  assert r.doc_no_length_ok is null, 'a contract number has no fixed length to be wrong';
  assert r.expires_on = '2027-01-01', 'a PKWT ends, and the screen counts down to it';
end $$;

/* ── DERIVATION: a scan with no number yet is pending, not blank ────────── */
do $$
declare r ops_hr.employee_document_row;
begin
  perform ops_hr.file_employee_document('B-0007','foto','bbbb5300-0000-0000-0000-0000000000f1');
  select * into r from ops_hr.employee_documents_of('B-0007') where kind = 'foto';
  assert r.doc_no_source = 'pending',
    'somebody is expected to come back to it, got ' || coalesce(r.doc_no_source::text,'(null)');
  assert r.doc_no_masked is null, 'and there is nothing to mask yet';
end $$;

/* ── DERIVATION: a file unlinked stops being attached, and the row stays ── */
--
-- The link is the evidence road's answer to *is this still this person's KTP*,
-- and the document row is not a second answer to it (A3). Unlinking on the road
-- is therefore visible here, and the number that was filed is still filed.
do $$
declare a jsonb; r ops_hr.employee_document_row; v_link uuid;
begin
  select l.id into v_link from ops_core.attachment_links l
   where l.entity = 'employee' and l.entity_no = 'B-0007' and l.kind = 'foto'
     and l.unlinked_at is null;
  a := ops_core.attach_unlink(v_link);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into r from ops_hr.employee_documents_of('B-0007') where kind = 'foto';
  assert r.doc_ref is not null, 'the row stays — somebody filed it (A2)';
  assert r.attachment_id is null,
    'and stops claiming a file that is no longer attached, got ' || coalesce(r.attachment_id::text,'(null)');
end $$;

/* ── REFUSAL: the table itself is not readable (F127) ───────────────────── */
--
-- The masking above is only worth anything if the column underneath cannot be
-- selected. `0048` masks a BPJS number in a view and leaves the column open;
-- this one does not.
do $$
declare refused boolean := false; n int;
begin
  begin
    select count(*) into n from ops_hr.employee_documents;
  exception when insufficient_privilege then refused := true;
  end;
  assert refused, 'a number nobody may read is a table nobody may select';
end $$;

/* ── REFUSAL and DERIVATION: opening one number, on purpose ─────────────── */
do $$
declare a jsonb; v_ref text; n int;
begin
  a := ops_hr.reveal_employee_doc_no('edc-99-99-99_01');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  select doc_ref into v_ref from ops_hr.employee_documents_of('B-0007') where kind = 'foto';
  a := ops_hr.reveal_employee_doc_no(v_ref);
  assert a -> 'error' ->> 'code' = 'no_number', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  select doc_ref into v_ref from ops_hr.employee_documents_of('B-0012') where kind = 'ktp';
  a := ops_hr.reveal_employee_doc_no(v_ref,'k-53-reveal');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'doc_no' = '3271234567890001',
    'the number itself, once, to whoever asked, got ' || coalesce(a -> 'data' ->> 'doc_no','(null)');
end $$;

/* ── DERIVATION: the trail says who looked, never at what ───────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005303';
do $$
declare g ops_core.audit_log; n int;
begin
  select * into g from ops_core.audit_log
   where entity = 'employee_document' and action = 'reveal' and outcome = 'ok';
  assert g.entity_no = 'B-0012', 'whose, got ' || coalesce(g.entity_no,'(null)');
  assert g.after ->> 'kind' = 'ktp', 'and which kind, got ' || coalesce(g.after ->> 'kind','(null)');
  -- **The one table nobody may ever delete from is the worst place to keep a
  -- NIK.** Nothing in the trail contains it, on the reveal or on the filing.
  select count(*) into n from ops_core.audit_log
   where entity = 'employee_document' and coalesce(after::text,'') like '%3271234567890001%';
  assert n = 0, 'a log of who read a secret must not store the secret, got ' || n;
  -- The filing said a number was filed and called it disamarkan.
  assert exists (
    select 1 from ops_core.audit_log
     where entity = 'employee_document' and action = 'file'
       and after ->> 'doc_no' = '(disamarkan)'),
    'and the filing said so too';
  -- The contract number, which is not an identity number, is written plainly.
  assert exists (
    select 1 from ops_core.audit_log
     where entity = 'employee_document' and action = 'file' and after ->> 'doc_no' = 'PKWT-26-011'),
    'while a document''s own number is legible in the trail';
end $$;

/* ── REFUSAL: a payroll grant reads no berkas at all ────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005302';
do $$
declare n int;
begin
  select count(*) into n from ops_hr.employee_documents_of();
  assert n = 0, 'the function asks the permission itself, got ' || n;
end $$;

/* ── DERIVATION: and HRD reads everybody's ──────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005301';
do $$
declare n int;
begin
  select count(*) into n from ops_hr.employee_documents_of();
  assert n = 4, 'two for Karjo, two for Siti, got ' || n;
  select count(*) into n from ops_hr.employee_documents_of('B-0012');
  assert n = 2, 'got ' || n;
end $$;

rollback;
