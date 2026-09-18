-- hr — the statutory half, and the four ways it declines to invent a number.
--
-- Worked out on paper first:
--
--   dasar Sari   5.000.000 + 25.000 × (300/12) hari   = 5.625.000
--   BPJS Kes.    4% pemberi kerja / 1% pekerja        = 225.000 / 56.250
--   dasar Bima   didaftarkan 15.000.000, plafon 12jt  = 12.000.000 (capped)
--   Bima pekerja 1% dari plafon                       = 120.000
--
--   REFUSALS     ending an enrolment says why; one live enrolment per person
--                per scheme; a rate with no source; payroll reads and does not
--                register
--   DERIVATIONS  the dated rate; the ceiling and what it was capped from;
--                a mid-month join billed whole with a sentence; no rate for
--                the month meaning no figure rather than zero; the membership
--                number masked; and PPH21 recorded, never computed

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000aa01','wulan@talaliving.com','{"full_name":"Wulan Sari"}'),
  ('ffffffff-0000-0000-0000-00000000aa02','bayu@talaliving.com','{"full_name":"Bayu Pratama"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000aa01','hrd','write'),
  ('ffffffff-0000-0000-0000-00000000aa01','it','write'),
  ('ffffffff-0000-0000-0000-00000000aa01','payroll','admin'),
  ('ffffffff-0000-0000-0000-00000000aa02','payroll','read');

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, allowance_rate, daily_hours)
values ('aaaa0000-0000-0000-0000-00000000c001','B-501','Sari Utami','monthly',5000000,25000,8),
       ('aaaa0000-0000-0000-0000-00000000c002','B-502','Bima Saputra','monthly',9000000,25000,8);

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji iuran',
  '{"effective_days_per_year": 300, "week_pattern":"6day"}'::jsonb,
  'ffffffff-0000-0000-0000-00000000aa01');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000aa01';

/* ── REFUSAL: a rate nobody can source ─────────────────────────────────── */
do $$
begin
  begin
    insert into ops_hr.contribution_rates (scheme, effective_from, employer_percent, employee_percent, note)
    values ('JHT','2026-01-01', 3.7, 2, '   ');
    raise exception 'a rate with no stated source should be refused';
  exception when check_violation then null;
  end;
end $$;

-- Two dated versions. The August figure is January's; September's is a later
-- row and must not reach back.
insert into ops_hr.contribution_rates
  (scheme, effective_from, employer_percent, employee_percent, wage_ceiling, confirmed, note, created_by) values
  ('BPJS_KESEHATAN','2026-01-01', 4, 1, 12000000, true,
   'Perpres 64/2020 — 4% pemberi kerja, 1% pekerja, plafon 12 juta','ffffffff-0000-0000-0000-00000000aa01'),
  ('BPJS_KESEHATAN','2026-09-01', 5, 1, 12000000, true,
   'kenaikan porsi pemberi kerja per September (uji)','ffffffff-0000-0000-0000-00000000aa01'),
  ('JKK','2026-01-01', 0.54, 0, null, false,
   'kelas risiko II — ANGKA SEMENTARA, belum dikonfirmasi BPJS (Q49)','ffffffff-0000-0000-0000-00000000aa01');

/* ── REFUSAL: ending an enrolment says why (A5) ────────────────────────── */
do $$
begin
  begin
    insert into ops_hr.enrolments (employee_id, scheme, enrolled_on, ended_on, by)
    values ('aaaa0000-0000-0000-0000-00000000c001','JHT','2026-01-01','2026-06-30',
            'ffffffff-0000-0000-0000-00000000aa01');
    raise exception 'an ended enrolment with no reason should be refused';
  exception when check_violation then null;
  end;
end $$;

-- Sari joins BPJS Kesehatan on the 20th of August, and is registered for PPh 21.
insert into ops_hr.enrolments (employee_id, scheme, member_no, enrolled_on, by) values
  ('aaaa0000-0000-0000-0000-00000000c001','BPJS_KESEHATAN','0001234567890','2026-08-20',
   'ffffffff-0000-0000-0000-00000000aa01'),
  ('aaaa0000-0000-0000-0000-00000000c001','PPH21','09.254.294.3-407.000','2026-01-01',
   'ffffffff-0000-0000-0000-00000000aa01'),
  ('aaaa0000-0000-0000-0000-00000000c001','JKK',null,'2026-01-01',
   'ffffffff-0000-0000-0000-00000000aa01'),
  ('aaaa0000-0000-0000-0000-00000000c001','JKM',null,'2026-01-01',
   'ffffffff-0000-0000-0000-00000000aa01');
-- Bima's wage was registered higher than the ceiling.
insert into ops_hr.enrolments (employee_id, scheme, member_no, enrolled_on, declared_base, by) values
  ('aaaa0000-0000-0000-0000-00000000c002','BPJS_KESEHATAN','0009876543210','2026-01-01',15000000,
   'ffffffff-0000-0000-0000-00000000aa01');

/* ── REFUSAL: one live enrolment per person per scheme ─────────────────── */
do $$
begin
  begin
    insert into ops_hr.enrolments (employee_id, scheme, enrolled_on, by)
    values ('aaaa0000-0000-0000-0000-00000000c001','BPJS_KESEHATAN','2026-08-25',
            'ffffffff-0000-0000-0000-00000000aa01');
    raise exception 'a second live enrolment should be refused';
  exception when unique_violation then null;
  end;
end $$;

/* ── DERIVATION: the base, the dated rate, and the ceiling ─────────────── */
do $$
declare l record;
begin
  select * into l from ops_hr.contribution_lines('BPJS_KESEHATAN','2026-08-01')
   where employee_no = 'B-501';
  assert l.base = 5625000,     '5.000.000 + 25.000 × 25 hari, got ' || l.base;
  assert l.base_source = 'pay_record', 'nothing was declared for her, got ' || l.base_source;
  assert l.employer = 225000,  '4% pemberi kerja, got ' || l.employer;
  assert l.employee = 56250,   '1% pekerja, got ' || l.employee;
  assert l.capped_from is null,'well under the ceiling';
  -- The membership number is on the card and never on the screen (D196).
  assert l.member_no_masked = '•••••••••••••', 'every digit masked, got ' || l.member_no_masked;
  -- BPJS charges the month whole, so a part-month is a full charge with a
  -- sentence rather than a pro-rated figure nobody agreed to.
  assert l.partial_month like 'Masuk 2026-08-20%', 'and it says she joined mid-month: ' || coalesce(l.partial_month,'(none)');

  select * into l from ops_hr.contribution_lines('BPJS_KESEHATAN','2026-08-01')
   where employee_no = 'B-502';
  assert l.base = 12000000,        'the ceiling caps it, got ' || l.base;
  assert l.capped_from = 15000000, 'and says what it was capped from, got ' || l.capped_from;
  assert l.base_source = 'declared','his wage was registered, got ' || l.base_source;
  assert l.employee = 120000,      '1% of the ceiling, got ' || l.employee;

  -- September has its own row, and it must not reach back into August.
  select * into l from ops_hr.contribution_lines('BPJS_KESEHATAN','2026-09-01')
   where employee_no = 'B-501';
  assert l.employer = 281250, 'September is 5%, got ' || l.employer;
end $$;

/* ── DERIVATION: no rate for the month is no figure, not a zero rate ───── */
do $$
declare l record; n int;
begin
  -- JKM has an enrolment and no rate row at all.
  select count(*) into n from ops_hr.contribution_lines('JKM','2026-08-01');
  assert n = 1, 'she is enrolled, so she is on the roll, got ' || n;
  select * into l from ops_hr.contribution_lines('JKM','2026-08-01');
  assert l.employer = 0 and l.employee = 0, 'and nothing is computed without a rate';
  assert not l.rate_confirmed, 'which is not a confirmed figure either';

  -- JKK has one, and it wears its badge: a stand-in, not a checked number (Q49).
  select * into l from ops_hr.contribution_lines('JKK','2026-08-01');
  assert not l.rate_confirmed, 'the risk class is unconfirmed, got ' || l.rate_confirmed;
  assert l.employee = 0, 'JKK is the employer''s alone, got ' || l.employee;
end $$;

/* ── DERIVATION: PPh 21 is recorded and never computed (D140, Q50) ─────── */
do $$
declare run text; n int; is_computed boolean;
begin
  insert into ops_hr.payroll_runs (period_start, period_end, created_by)
  values ('2026-08-01','2026-08-31','ffffffff-0000-0000-0000-00000000aa01')
  returning run_no into run;

  select count(*) into n from ops_hr.v_payroll_contribution
   where run_no = run and scheme = 'PPH21';
  assert n = 0, 'PPh 21 never reaches a payslip figure, got ' || n;

  select computed into is_computed from ops_hr.v_enrolment
   where employee_no = 'B-501' and scheme = 'PPH21';
  assert not is_computed, 'but the enrolment is recorded, and marked as not computed';

  -- The four computed schemes she is in do reach it.
  select count(*) into n from ops_hr.v_payroll_contribution
   where run_no = run and employee_no = 'B-501';
  assert n = 3, 'kesehatan, JKK and JKM — three of the five, got ' || n;
end $$;

/* ── REFUSAL: payroll reads the register and does not write it ─────────── */
do $$
declare n int;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000aa02';
  assert ops_core.has_permission('payroll.read'), 'payroll reads';
  select count(*) into n from ops_hr.enrolments;
  assert n = 5, 'and sees the register it is paying from, got ' || n;

  begin
    insert into ops_hr.enrolments (employee_id, scheme, enrolled_on, by)
    values ('aaaa0000-0000-0000-0000-00000000c002','JHT','2026-08-01',
            'ffffffff-0000-0000-0000-00000000aa02');
    raise exception 'payroll should not be able to register anybody';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
