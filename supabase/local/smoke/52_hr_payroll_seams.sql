-- hr — opening a payroll run, what people move on it by hand, and the two
-- signatures at the end of it (D139, D155, D24, ADR-004).
--
--   REFUSALS     opening with a read grant, backwards, or over a period
--                another run already covers; an adjustment of nought rupiah,
--                with no sentence, for nobody, on a run somebody has signed;
--                withdrawing one twice, with no sentence, or after the
--                signature; **signing with the module grant instead of the
--                authority**; signing over days nobody has read; signing
--                twice; recording a payment before the signature, against a
--                transaction that is not in the ledger, one that was voided,
--                one that came in rather than went out, and twice
--   DERIVATIONS  a withdrawn adjustment **stops counting in both readers** and
--                stays on the table; the run's total follows; an approved run
--                announces what it comes to; a person who left mid-period is
--                still on it
--
-- Worked out first: +250.000 and −100.000 → 150.000; withdraw the first → −100.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005201','gaji52@talaliving.com','{"full_name":"Staf Payroll"}'),
  ('ffffffff-0000-0000-0000-000000005202','bos52@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000005203','hrd52@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005204','lihat52@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-000000005205','it52@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  -- Prepares the run and types the adjustments — and **cannot sign it**, which
  -- is the pair that makes D24 provable rather than asserted.
  ('ffffffff-0000-0000-0000-000000005201','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000005202','payroll','read'),
  ('ffffffff-0000-0000-0000-000000005203','hrd','write'),
  ('ffffffff-0000-0000-0000-000000005204','payroll','read'),
  ('ffffffff-0000-0000-0000-000000005205','it','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000005202','approve_funds');

-- The ledger rows the last seam reads. Written here as the owner rather than
-- through `ops_acct`'s own seams: what is under test is HR asking the ledger a
-- question, not accounting answering it.
insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code, description,
   source_ref, posted_by, status, void_reason, void_at, void_by)
values
  ('trx-26-09-21_001','2026-09-21',(select id from ops_acct.accounts where code = 'BCA 271'),
   'OUT', 4650000,'RECCURING - PAYROLL','Gaji 14–20 September','smoke-52-wages',
   'ffffffff-0000-0000-0000-000000005201','POSTED', null, null, null),
  ('trx-26-09-21_002','2026-09-21',(select id from ops_acct.accounts where code = 'BCA 271'),
   'OUT', 4650000,'RECCURING - PAYROLL','Gaji — salah rekening','smoke-52-void',
   'ffffffff-0000-0000-0000-000000005201','VOID','salah rekening', now(),
   'ffffffff-0000-0000-0000-000000005201'),
  ('trx-26-09-21_003','2026-09-21',(select id from ops_acct.accounts where code = 'BCA 271'),
   'IN', 4650000,'CASHFLOW','Setoran','smoke-52-in',
   'ffffffff-0000-0000-0000-000000005201','POSTED', null, null, null);

set local role authenticated;

/* ── REFUSAL: a run over nobody ────────────────────────────────────────── */
--
-- Before anybody is on the books, which is where a fresh install starts. A run
-- with no people computes a gross of nought and looks exactly like a week
-- everybody was away.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005201';
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.open_payroll_run('2026-01-05','2026-01-11');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'run_no';
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005202';
  a := ops_hr.approve_payroll_run(v_no);
  assert a -> 'error' ->> 'code' = 'empty_run',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005203';

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, allowance_rate, paid_leave_days)
values ('aaaa5200-0000-0000-0000-0000000000e1','B-0012','Joko Widodo','monthly', 4500000, 25000, 12),
       ('aaaa5200-0000-0000-0000-0000000000e2','B-0007','Siti Aminah','daily',     180000, 20000, 12),
       -- Left on the Wednesday. Still owed the days he worked, so he is still
       -- on the run — which is what `run_lines` says and nothing else does.
       ('aaaa5200-0000-0000-0000-0000000000e3','B-0044','Bambang','daily',         170000, 20000, 12),
       -- Left before the period opened. Not on it.
       ('aaaa5200-0000-0000-0000-0000000000e4','B-0055','Hendra','daily',          170000, 20000, 12);
update ops_hr.employees set active = false, left_on = '2026-09-16'
 where employee_no = 'B-0044';
update ops_hr.employees set active = false, left_on = '2026-08-30'
 where employee_no = 'B-0055';

/* Monday is whole for Joko: in, out for lunch, back, home. Siti's Tuesday has
   everything but the going home — the machine did not read her finger — and
   that is the day nobody has read, the one the signature refuses over. A day
   with no taps at all is not open; it is simply a day off. */
do $$
declare a jsonb;
begin
  a := ops_hr.import_scans('mesin-38.csv', $j$[
    {"employee_ref":"12","at":"2026-09-14T08:05:00+08"},
    {"employee_ref":"12","at":"2026-09-14T12:00:00+08"},
    {"employee_ref":"12","at":"2026-09-14T13:00:00+08"},
    {"employee_ref":"12","at":"2026-09-14T17:02:00+08"},
    {"employee_ref":"7", "at":"2026-09-15T07:58:00+08"},
    {"employee_ref":"7", "at":"2026-09-15T12:00:00+08"},
    {"employee_ref":"7", "at":"2026-09-15T13:00:00+08"}
  ]$j$::jsonb);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
end $$;

/* ── REFUSAL: a read grant may look at payroll, not run it ─────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005204';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.open_payroll_run('2026-09-14','2026-09-20');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  select count(*) into n from ops_hr.payroll_runs where period_start = '2026-09-14';
  assert n = 0, 'and nothing was opened on the way to being refused, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005201';

/* ── REFUSAL and DERIVATION: opening one ───────────────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.open_payroll_run('2026-09-20','2026-09-14');
  assert a -> 'error' ->> 'code' = 'period_invalid', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.open_payroll_run('2026-09-14','2026-09-20','minggu ke-38','k-52-open');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'run_no';
  assert v_no like 'pyr-%', 'got ' || coalesce(v_no,'(null)');
  assert a -> 'data' ->> 'status' = 'DRAFT', 'got ' || coalesce(a -> 'data' ->> 'status','(null)');

  -- **A retry is one run, not two** — and the key is what says so, not the
  -- overlap check behind it. Sent with a period nothing covers: a second
  -- execution would open an October run and answer with its number.
  a := ops_hr.open_payroll_run('2026-10-05','2026-10-11','bulan depan','k-52-open');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'run_no' = v_no,
    'the remembered answer, not a fresh one, got ' || coalesce(a -> 'data' ->> 'run_no','(null)');
  assert not exists (select 1 from ops_hr.payroll_runs where period_start = '2026-10-05'),
    'and nothing was opened behind it';

  -- **The week either side of it, not just the same week.** `period_once` is
  -- unique on the pair of dates and cannot see this one; 18–24 September pays
  -- the 18th, 19th and 20th a second time.
  a := ops_hr.open_payroll_run('2026-09-18','2026-09-24');
  assert a -> 'error' ->> 'code' = 'period_overlaps',
    'the same day is not paid twice, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%' || v_no || '%',
    'and the sentence names the run in the way, got ' || coalesce(a -> 'error' ->> 'message','(null)');
end $$;

/* ── REFUSAL: the table refuses the overlap too ────────────────────────── */
--
-- Not the seam saying no — the seam is one road and a policy grants the table
-- directly. If only the function knew the rule, the rule would hold only for
-- callers who used it.
do $$
declare failed boolean := false;
begin
  begin
    insert into ops_hr.payroll_runs (period_start, period_end, created_by)
    values ('2026-09-16','2026-09-22','ffffffff-0000-0000-0000-000000005201');
  exception when exclusion_violation then failed := true;
  end;
  assert failed, 'two runs over one day is refused by the table, not only by the seam';
end $$;

/* ── REFUSAL and DERIVATION: what people move by hand ──────────────────── */
do $$
declare a jsonb; v_no text; v_adj text; n int; t numeric;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';

  a := ops_hr.add_adjustment('pyr-99-99-99_01','B-0012','bonus', 100000,'x');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.add_adjustment(v_no,'B-9999','bonus', 100000,'x');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.add_adjustment(v_no,'B-0012','bonus', 0,'x');
  assert a -> 'error' ->> 'code' = 'amount_required',
    'nought rupiah prints a line and changes nothing, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- D155: a deduction an employee cannot read is one they cannot dispute.
  a := ops_hr.add_adjustment(v_no,'B-0012','late', -50000,'   ');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.add_adjustment(v_no,'B-0012','bonus', 250000,'lembur borongan rak, disepakati lisan','k-52-adj');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_adj := a -> 'data' ->> 'adj_no';
  assert v_adj like 'adj-%', 'addressed by a public code, never a uuid, got ' || coalesce(v_adj,'(null)');

  a := ops_hr.add_adjustment(v_no,'B-0007','sp', -100000,'terlambat tiga kali, SP-1');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'adjustment_total')::numeric = 150000,
    'got ' || coalesce(a -> 'data' ->> 'adjustment_total','(null)');

  select adjustment_total, adjustment_rows into t, n
    from ops_hr.v_payroll_run where run_no = v_no;
  assert t = 150000 and n = 2, format('the run agrees: %s over %s rows', t, n);
end $$;

/* ── DERIVATION: a withdrawn adjustment stops counting in BOTH readers ─── */
--
-- The flag is new and the table has two readers, which is F123's arithmetic
-- again: `v_payroll_run` sums them and so does `payroll_line`, two hundred
-- lines away. A test that checked only the first would pass with the second
-- still paying money somebody took back.
do $$
declare a jsonb; v_no text; v_adj text; n int; t numeric; g numeric;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';
  select adj_no into v_adj from ops_hr.payroll_adjustments where amount = 250000;

  a := ops_hr.withdraw_adjustment('adj-99-99-99_01','salah orang');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.withdraw_adjustment(v_adj,'  ');
  assert a -> 'error' ->> 'code' = 'reason_required',
    'why it was taken back is what the next person reads, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.withdraw_adjustment(v_adj,'salah orang — itu bonus Siti, bukan Joko','k-52-wd');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'adjustment_total')::numeric = -100000,
    'got ' || coalesce(a -> 'data' ->> 'adjustment_total','(null)');

  a := ops_hr.withdraw_adjustment(v_adj,'lagi');
  assert a -> 'error' ->> 'code' = 'already_withdrawn', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The same key again with a different row behind it: a replay hands back the
  -- first answer rather than withdrawing the second adjustment.
  a := ops_hr.withdraw_adjustment(
         (select adj_no from ops_hr.payroll_adjustments where amount = -100000),
         'harusnya ini juga','k-52-wd');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'adj_no' = v_adj,
    'the remembered answer, got ' || coalesce(a -> 'data' ->> 'adj_no','(null)');
  assert (select withdrawn_at from ops_hr.payroll_adjustments where amount = -100000) is null,
    'and the second one was not touched';

  -- **Still there** (A2). *Kenapa minggu lalu ada bonus 250.000 dan sekarang
  -- tidak* is asked at the counter, and a deleted row answers with silence.
  select count(*) into n from ops_hr.payroll_adjustments where run_no = v_no;
  assert n = 2, 'nothing was deleted, got ' || n;
  assert (select withdrawn_reason from ops_hr.payroll_adjustments where adj_no = v_adj)
         like 'salah orang%', 'and it says why';

  -- Reader one.
  select adjustment_total, adjustment_rows into t, n
    from ops_hr.v_payroll_run where run_no = v_no;
  assert t = -100000 and n = 1, format('the run: %s over %s rows', t, n);

  -- Reader two, two hundred lines away in `payroll_line`.
  select l.adjustment_total into g from ops_hr.run_lines(v_no) l
   where l.employee_no = 'B-0012';
  assert g = 0, 'Joko''s payslip stopped carrying it, got ' || g;
  select l.adjustment_total into g from ops_hr.run_lines(v_no) l
   where l.employee_no = 'B-0007';
  assert g = -100000, 'and Siti''s still does, got ' || g;

  -- And the figure the next adjustment reports back, which is a third place the
  -- sum is written and the one a screen shows straight after the button.
  a := ops_hr.add_adjustment(v_no,'B-0007','bonus', 50000,'rajin');
  assert (a -> 'data' ->> 'adjustment_total')::numeric = -50000,
    'the withdrawn 250.000 is not in it, got ' || coalesce(a -> 'data' ->> 'adjustment_total','(null)');

  -- A replayed adjustment is one row, not two. The key carries a different
  -- person and a different amount; the first answer comes back anyway.
  a := ops_hr.add_adjustment(v_no,'B-0007','bonus', 999000,'seharusnya tidak ada','k-52-adj');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert (a -> 'data' ->> 'amount')::numeric = 250000,
    'the remembered answer, got ' || coalesce(a -> 'data' ->> 'amount','(null)');
  select count(*) into n from ops_hr.payroll_adjustments where run_no = v_no;
  assert n = 3, 'and no fourth row, got ' || n;
end $$;

/* ── DERIVATION: who is on the run ─────────────────────────────────────── */
do $$
declare n int; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';
  select count(*) into n from ops_hr.run_lines(v_no);
  -- Joko, Siti and Bambang, who left on the Wednesday and is owed the two days
  -- before it. Not Hendra, who left in August.
  assert n = 3, 'got ' || n;
  assert exists (select 1 from ops_hr.run_lines(v_no) l where l.employee_no = 'B-0044'),
    'somebody who left mid-period is still owed the days they worked';
  assert not exists (select 1 from ops_hr.run_lines(v_no) l where l.employee_no = 'B-0055'),
    'and somebody who left before it opened is not on it';
end $$;

/* ── REFUSAL: the module grant is not the signature (D24) ──────────────── */
do $$
declare a jsonb; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';
  -- This session holds `payroll` at **admin** — the highest level there is —
  -- and still cannot sign. The authority is granted on its own or not at all.
  a := ops_hr.approve_payroll_run(v_no);
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select status from ops_hr.payroll_runs where run_no = v_no) = 'DRAFT',
    'and it is still a draft';
end $$;

/* ── REFUSAL: a run over days nobody has read (D139) ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005202';
do $$
declare a jsonb; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';
  a := ops_hr.approve_payroll_run(v_no);
  assert a -> 'error' ->> 'code' = 'open_days',
    'a figure computed over unread days looks exact and is not, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
  assert (a -> 'error' -> 'detail' ->> 'open_days')::int = 1,
    'and it says how many, got ' || coalesce(a -> 'error' -> 'detail' ->> 'open_days','(null)');
end $$;

/* Siti's Tuesday is read: she left at half past four and the machine missed it. */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005203';
do $$
declare a jsonb;
begin
  a := ops_hr.add_scan('B-0007','2026-09-15T16:30:00+08','mesin tidak membaca sidik jarinya');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
end $$;

/* ── DERIVATION: the signature, and what it announces ──────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005202';
do $$
declare a jsonb; v_no text; v_gross bigint;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';

  a := ops_hr.approve_payroll_run(v_no,'k-52-sign');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'status' = 'APPROVED', 'got ' || coalesce(a -> 'data' ->> 'status','(null)');
  assert (a -> 'data' ->> 'people')::int = 3, 'got ' || coalesce(a -> 'data' ->> 'people','(null)');
  assert (a -> 'data' ->> 'adjustment_total')::numeric = -50000,
    'the withdrawn one is not in the signed figure either, got '
    || coalesce(a -> 'data' ->> 'adjustment_total','(null)');
  v_gross := (a -> 'data' ->> 'gross_total')::bigint;
  assert v_gross > 0, 'somebody was paid, got ' || v_gross;

  a := ops_hr.approve_payroll_run(v_no);
  assert a -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The same key against a different run — the empty January one, which a
  -- second execution would refuse as `empty_run`. A replay answers with the
  -- run that was actually signed, and January stays a draft.
  a := ops_hr.approve_payroll_run(
         (select run_no from ops_hr.payroll_runs where period_start = '2026-01-05'),'k-52-sign');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'run_no' = v_no, 'got ' || coalesce(a -> 'data' ->> 'run_no','(null)');
  assert (select status from ops_hr.payroll_runs where period_start = '2026-01-05') = 'DRAFT',
    'and nothing was signed behind it';
end $$;

/* ── DERIVATION: the announcement, read by IT ──────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005205';
do $$
declare p jsonb; v_no text;
begin
  select o.payload, o.entity_no into p, v_no from ops_core.outbox o
   where o.event_type = 'payroll.approved';
  assert p is not null, 'an approved run announces itself';
  assert (p ->> 'people')::int = 3, 'got ' || coalesce(p ->> 'people','(null)');
  assert (p ->> 'adjustment_total')::numeric = -50000, 'got ' || coalesce(p ->> 'adjustment_total','(null)');
  assert p ->> 'period_start' = '2026-09-14', 'got ' || coalesce(p ->> 'period_start','(null)');

  -- `before`/`after` live on the trail rather than in the envelope, which is
  -- where *what did this change* is asked from.
  assert exists (
    select 1 from ops_core.audit_log g
     where g.entity = 'payroll' and g.action = 'approve' and g.outcome = 'ok'
       and g.before ->> 'status' = 'DRAFT' and g.after ->> 'status' = 'APPROVED'),
    'and the trail says what moved';
  -- A refusal is recorded too (A7): the signature refused over open days, and
  -- the attempt is the thing somebody asks about afterwards.
  assert exists (
    select 1 from ops_core.audit_log g
     where g.entity = 'payroll' and g.action = 'approve' and g.outcome = 'refused'),
    'and that somebody tried before the days were read';
end $$;

/* ── REFUSAL: a signed run is closed to hand-written money ─────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005201';
do $$
declare a jsonb; v_no text; v_adj text;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';
  select adj_no into v_adj from ops_hr.payroll_adjustments where amount = -100000;

  a := ops_hr.add_adjustment(v_no,'B-0012','bonus', 75000,'terlupa');
  assert a -> 'error' ->> 'code' = 'run_not_draft',
    'a correction is the next run, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.withdraw_adjustment(v_adj,'berubah pikiran');
  assert a -> 'error' ->> 'code' = 'run_not_draft',
    'and the other end is shut too, got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL and DERIVATION: which transfer paid it ────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where period_start = '2026-09-14';

  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_999');
  assert a -> 'error' ->> 'code' = 'trx_not_found',
    'a number nobody can find is the same as none, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_002');
  assert a -> 'error' ->> 'code' = 'trx_void',
    'a cancelled payment paid nobody, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_003');
  assert a -> 'error' ->> 'code' = 'trx_not_outgoing',
    'wages leave the account, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_001','k-52-paid');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'status' = 'PAID', 'got ' || coalesce(a -> 'data' ->> 'status','(null)');
  -- Both figures, side by side, and no refusal between them — Q56.
  assert (a -> 'data' ->> 'trx_amount')::numeric = 4650000, 'got ' || coalesce(a -> 'data' ->> 'trx_amount','(null)');
  assert (a -> 'data' ->> 'gross_total')::bigint > 0, 'and what the run came to';

  assert (select paid_trx_no from ops_hr.payroll_runs where run_no = v_no) = 'trx-26-09-21_001',
    'the run names its movement';

  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_001');
  assert a -> 'error' ->> 'code' = 'already_paid', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The same key with a different transaction behind it: a second execution
  -- would answer `already_paid`, a replay answers with the transfer that paid.
  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_003','k-52-paid');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'trx_no' = 'trx-26-09-21_001',
    'the remembered answer, got ' || coalesce(a -> 'data' ->> 'trx_no','(null)');
end $$;

/* ── REFUSAL: a read grant does not record the transfer either ─────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005204';
do $$
declare a jsonb;
begin
  a := ops_hr.record_payroll_paid(
         (select run_no from ops_hr.payroll_runs where period_start = '2026-01-05'),
         'trx-26-09-21_001');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005201';

/* ── REFUSAL: paying a run nobody signed ───────────────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.open_payroll_run('2026-09-21','2026-09-27');
  v_no := a -> 'data' ->> 'run_no';
  a := ops_hr.record_payroll_paid(v_no,'trx-26-09-21_001');
  assert a -> 'error' ->> 'code' = 'not_approved',
    'gaji dibayar setelah disetujui, got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

rollback;
