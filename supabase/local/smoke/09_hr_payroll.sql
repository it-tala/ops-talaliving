-- hr, second half — the two signatures, and the run that freezes.
--
-- The refusals:
--
--   leadership signs after HRD, not instead of it (D145)
--   a staff sheet never waits on leadership (D146)
--   hours against a work order name the stage they moved (D147)
--   one line per person per sheet
--   a zero adjustment is a row that says nothing (D155)
--   an adjustment on a run that has left DRAFT (D155)
--   a run does not go back from APPROVED to DRAFT
--   a pay rule version landing inside a run's period (D173) — the half 0040
--   could not enforce, because payroll_runs did not exist yet
--
-- And the derivation that is the reason none of this is a status column: a
-- production sheet walking waiting_hrd -> waiting_surat -> waiting_leader ->
-- approved, with its hours reaching the run only at the last step.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000b1','wulan@talaliving.com','{"full_name":"Wulan Sari"}'),
  ('ffffffff-0000-0000-0000-0000000000b2','evin@talaliving.com','{"full_name":"Evin Jonathan"}');

-- Wulan runs HRD and payroll. Evin signs overtime and nothing else.
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000b1','hrd','write'),
  ('ffffffff-0000-0000-0000-0000000000b1','payroll','admin'),
  ('ffffffff-0000-0000-0000-0000000000b1','it','write'),
  ('ffffffff-0000-0000-0000-0000000000b2','hrd','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000000b2','approve_overtime');

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, allowance_rate) values
  ('aaaa0000-0000-0000-0000-00000000f001','B-101','Joko Susilo','daily',180000,25000),
  ('aaaa0000-0000-0000-0000-00000000f002','B-102','Rina Wati','monthly',5200000,600000);

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000b1','a/lembur.jpg','surat-lembur-31ags.jpg','ffffffff-0000-0000-0000-0000000000b1');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000b1';

/* ── REFUSAL: leadership signs after HRD (D145) ────────────────────────── */
do $$
begin
  begin
    insert into ops_hr.overtime_sheets (kind, work_date, purpose, leader_approved_by, leader_approved_at, created_by)
    values ('production','2026-08-31','kejar kirim',
            'ffffffff-0000-0000-0000-0000000000b2', now(), 'ffffffff-0000-0000-0000-0000000000b1');
    raise exception 'leadership should not be able to sign an unchecked sheet';
  exception when check_violation then null;
  end;
end $$;

/* ── REFUSAL: a staff sheet never waits on leadership (D146) ───────────── */
do $$
begin
  begin
    insert into ops_hr.overtime_sheets (kind, work_date, hrd_checked_by, hrd_checked_at,
                                        leader_approved_by, leader_approved_at, created_by)
    values ('staff','2026-08-31','ffffffff-0000-0000-0000-0000000000b1', now(),
            'ffffffff-0000-0000-0000-0000000000b2', now(), 'ffffffff-0000-0000-0000-0000000000b1');
    raise exception 'a staff sheet should not carry a leadership signature';
  exception when check_violation then null;
  end;
end $$;

/* ── DERIVATION: a production sheet walks all four stages ──────────────── */
do $$
declare sheet uuid; sno text; st ops_hr.overtime_stage_t; is_payable boolean; hrs numeric;
begin
  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by)
  values ('production','2026-08-31','kejar kirim proyek Astoria','ffffffff-0000-0000-0000-0000000000b1')
  returning id, sheet_no into sheet, sno;

  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, wo_no, stage, qty_done)
  values (sheet,'aaaa0000-0000-0000-0000-00000000f001', 3, 'amplas ulang','spk-26-08-20_01','sanding', 12);

  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'waiting_hrd', 'a fresh production sheet waits on HRD, got ' || st;

  -- HRD checks the hours. The signed paper is not attached yet, and that is
  -- its own state: leadership cannot act on a sheet it cannot read.
  update ops_hr.overtime_sheets
     set hrd_checked_by = 'ffffffff-0000-0000-0000-0000000000b1', hrd_checked_at = now()
   where id = sheet;
  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'waiting_surat', 'checked but unattached waits on the letter, got ' || st;

  select payable into is_payable from ops_hr.v_overtime_claim where id = sheet;
  assert not is_payable, 'and nothing is payable yet';

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values ('44440000-0000-0000-0000-0000000000b1','overtime_sheet',sno,'surat_lembur',
          'ffffffff-0000-0000-0000-0000000000b1');
  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'waiting_leader', 'the letter moves it to leadership, got ' || st;

  update ops_hr.overtime_sheets
     set leader_approved_by = 'ffffffff-0000-0000-0000-0000000000b2', leader_approved_at = now()
   where id = sheet;
  select stage, payable, hours into st, is_payable, hrs from ops_hr.v_overtime_claim where id = sheet;
  assert st = 'approved',  'both signatures approve it, got ' || st;
  assert is_payable,          'and only now do the hours count';
  assert hrs = 3,          'three hours, got ' || hrs;

  -- Withdrawing the paper puts it back: the stage is read from what is there.
  update ops_core.attachment_links set unlinked_at = now(), unlinked_by = 'ffffffff-0000-0000-0000-0000000000b1'
   where entity_no = sno;
  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'approved', 'a signed sheet stays approved, got ' || st;
end $$;

/* ── DERIVATION: a staff sheet is paid until somebody says otherwise ───── */
do $$
declare sheet uuid; st ops_hr.overtime_stage_t;
begin
  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by)
  values ('staff','2026-08-28','tutup buku','ffffffff-0000-0000-0000-0000000000b1')
  returning id into sheet;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
  values (sheet,'aaaa0000-0000-0000-0000-00000000f002', 2, 'rekap faktur');

  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'paid_default', 'a staff sheet ships paid, got ' || st;

  update ops_hr.overtime_sheets set hrd_checked_by = 'ffffffff-0000-0000-0000-0000000000b1',
                                    hrd_checked_at = now() where id = sheet;
  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'paid_checked', 'HRD looking at it is a different fact, got ' || st;

  -- Turning it off says why, or it is refused.
  begin
    update ops_hr.overtime_sheets set paid = false where id = sheet;
    raise exception 'an unpaid sheet with no reason should be refused';
  exception when check_violation then null;
  end;

  update ops_hr.overtime_sheets set paid = false, unpaid_reason = 'jam tidak sesuai laporan'
   where id = sheet;
  select stage into st from ops_hr.v_overtime_stage where id = sheet;
  assert st = 'unpaid', 'and then it is unpaid, got ' || st;
end $$;

/* ── REFUSAL: hours against a work order name the stage (D147) ─────────── */
do $$
declare sheet uuid;
begin
  select id into sheet from ops_hr.overtime_sheets where work_date = '2026-08-31' limit 1;
  begin
    insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, wo_no)
    values (sheet,'aaaa0000-0000-0000-0000-00000000f002', 2, 'spk-26-08-20_01');
    raise exception 'a production line with no stage should be refused';
  exception when check_violation then null;
  end;

  -- And one person appears once on one sheet.
  begin
    insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
    values (sheet,'aaaa0000-0000-0000-0000-00000000f001', 1, 'dobel');
    raise exception 'a second line for the same person should be refused';
  exception when unique_violation then null;
  end;
end $$;

/* ── the run ───────────────────────────────────────────────────────────── */
do $$
declare run text; open_run text; approved numeric; pending numeric; total numeric;
begin
  insert into ops_hr.payroll_runs (period_start, period_end, created_by)
  values ('2026-08-25','2026-09-07','ffffffff-0000-0000-0000-0000000000b1')
  returning run_no into run;

  -- DERIVATION: the approved night counts, the unpaid staff night does not,
  -- and neither figure is stored anywhere.
  select approved_overtime_hours, pending_overtime_hours
    into approved, pending
    from ops_hr.v_payroll_run where run_no = run;
  assert approved = 3, 'the twice-approved night is in, got ' || approved;
  assert coalesce(pending, 0) = 0, 'the unpaid staff sheet is not pending, it is decided, got ' || coalesce(pending,0);

  /* REFUSAL: a zero adjustment (D155) */
  begin
    insert into ops_hr.payroll_adjustments (run_no, employee_id, kind, amount, reason, created_by)
    values (run,'aaaa0000-0000-0000-0000-00000000f001','other', 0,'tidak apa-apa','ffffffff-0000-0000-0000-0000000000b1');
    raise exception 'a zero adjustment should be refused';
  exception when check_violation then null;
  end;

  insert into ops_hr.payroll_adjustments (run_no, employee_id, kind, amount, reason, created_by) values
    (run,'aaaa0000-0000-0000-0000-00000000f001','late',  -50000,'terlambat 3 hari, sesuai SP1','ffffffff-0000-0000-0000-0000000000b1'),
    (run,'aaaa0000-0000-0000-0000-00000000f002','bonus', 250000,'lembur tutup buku','ffffffff-0000-0000-0000-0000000000b1');

  select adjustment_total into total from ops_hr.v_payroll_run where run_no = run;
  assert total = 200000, 'adjustments are signed and add up, got ' || total;

  /* REFUSAL: a rule version inside a run's period (D173) — the half 0040 left
     open until payroll_runs existed.

     Against the period that is actually open, because that is the only one the
     rule can bite on: a version may not be back-dated either, so a clash can
     only ever happen with a period still running. */
  insert into ops_hr.payroll_runs (period_start, period_end, created_by)
  values (current_date - 3, current_date + 10, 'ffffffff-0000-0000-0000-0000000000b1')
  returning run_no into open_run;

  begin
    insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
    values (9, current_date, 'di tengah periode', '{}'::jsonb,'ffffffff-0000-0000-0000-0000000000b1');
    raise exception 'a rule landing inside an open run period should be refused';
  exception when check_violation then null;
  end;

  -- Clear of every period, it lands.
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (9, current_date + 30, 'berlaku periode depan', '{"overtime":{"tiers":[1.5,2]}}'::jsonb,
          'ffffffff-0000-0000-0000-0000000000b1');

  /* REFUSAL: adjustments freeze when the run leaves DRAFT (D155) */
  update ops_hr.payroll_runs
     set status = 'APPROVED', approved_by = 'ffffffff-0000-0000-0000-0000000000b1', approved_at = now()
   where run_no = run;

  begin
    insert into ops_hr.payroll_adjustments (run_no, employee_id, kind, amount, reason, created_by)
    values (run,'aaaa0000-0000-0000-0000-00000000f001','bonus', 100000,'menyusul','ffffffff-0000-0000-0000-0000000000b1');
    raise exception 'an adjustment on an APPROVED run should be refused';
  exception when check_violation then null;
  end;

  /* REFUSAL: and the run does not go back to let it in */
  begin
    update ops_hr.payroll_runs set status = 'DRAFT' where run_no = run;
    raise exception 'a run should not go back to DRAFT';
  exception when check_violation then null;
  end;

  /* PAID names the ledger row that paid it */
  begin
    update ops_hr.payroll_runs set status = 'PAID' where run_no = run;
    raise exception 'PAID with no transaction should be refused';
  exception when check_violation then null;
  end;
  update ops_hr.payroll_runs set status = 'PAID', paid_trx_no = 'trx-26-09-08_004' where run_no = run;
end $$;

rollback;
