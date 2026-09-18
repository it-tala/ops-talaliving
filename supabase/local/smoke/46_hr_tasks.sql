-- hr — the tracker, and the one rule it exists to protect.
--
--   REFUSALS     a reference kind without its code, and a code without a kind;
--                DONE with nobody behind it; CANCELLED with no reason; a block
--                with no moment; and no DELETE at all
--   DERIVATIONS  days_left and overdue against today; **blocked is not
--                overdue** (D261); late and days_early on a finished task; and
--                the queue order a person actually works down
--
-- The dates are relative to `ops_core.office_day()` on purpose. A fixture
-- pinned to August passes today and quietly stops testing `overdue` the moment
-- August is in the past.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000bb01','wulan@talaliving.com','{"full_name":"Wulan Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000bb01','hrd','write');

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate) values
  ('aaaa0000-0000-0000-0000-00000000d101','B-601','Dian Permata','monthly',4000000);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000bb01';

/* ── REFUSAL: a reference is a kind and a code together (ADR-004) ──────── */
do $$
begin
  begin
    insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, ref_kind)
    values ('Cek SPK','aaaa0000-0000-0000-0000-00000000d101','ffffffff-0000-0000-0000-00000000bb01',
            ops_core.office_day() + 3, 'work_order');
    raise exception 'a work_order reference with no code should be refused';
  exception when check_violation then null;
  end;

  begin
    insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, ref_kind, ref_no)
    values ('Cek SPK','aaaa0000-0000-0000-0000-00000000d101','ffffffff-0000-0000-0000-00000000bb01',
            ops_core.office_day() + 3, 'none', 'spk-26-08-20_01');
    raise exception 'a code with no kind should be refused too';
  exception when check_violation then null;
  end;
end $$;

/* ── REFUSAL: finishing is a person and a moment together ──────────────── */
do $$
declare t uuid;
begin
  insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date)
  values ('Rapikan berkas 201','aaaa0000-0000-0000-0000-00000000d101',
          'ffffffff-0000-0000-0000-00000000bb01', ops_core.office_day() + 3)
  returning id into t;

  begin
    update ops_hr.tasks set status = 'DONE', done_at = now() where id = t;
    raise exception 'DONE with nobody behind it should be refused';
  exception when check_violation then null;
  end;

  begin
    update ops_hr.tasks set status = 'CANCELLED' where id = t;
    raise exception 'CANCELLED with no reason should be refused';
  exception when check_violation then null;
  end;

  begin
    update ops_hr.tasks set blocked_reason = 'menunggu vendor' where id = t;
    raise exception 'a block with no moment should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── DERIVATION: overdue, and the rule that blocked is not ─────────────── */
do $$
declare v record; b record;
begin
  -- Two tasks, both three days past their date. One is waiting on somebody
  -- else, and that is the whole point of the module.
  insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date) values
    ('Kirim rekap absensi','aaaa0000-0000-0000-0000-00000000d101',
     'ffffffff-0000-0000-0000-00000000bb01', ops_core.office_day() - 3);
  insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, blocked_reason, blocked_at)
  values ('Tutup PO mahoni','aaaa0000-0000-0000-0000-00000000d101',
          'ffffffff-0000-0000-0000-00000000bb01', ops_core.office_day() - 3,
          'menunggu nota dari vendor', now());

  select * into v from ops_hr.v_task where title = 'Kirim rekap absensi';
  assert v.days_left = -3, 'three days past its date, got ' || v.days_left;
  assert v.overdue,        'and nothing is holding it up, so it is overdue';
  assert not v.late,       'late is about a finished task, not an open one';
  assert v.days_early is null, 'and there is no early for something unfinished';
  assert v.queue_rank = 0, 'overdue comes first in the queue, got ' || v.queue_rank;

  select * into b from ops_hr.v_task where title = 'Tutup PO mahoni';
  assert b.days_left = -3,  'the same three days past, got ' || b.days_left;
  assert not b.overdue,     'BUT a task waiting on somebody else has not been failed by the person holding it (D261)';
  assert b.queue_rank = 1,  'it sits after the overdue and before the rest, got ' || b.queue_rank;
end $$;

/* ── DERIVATION: late, and days_early ──────────────────────────────────── */
do $$
declare v record;
begin
  insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, status, done_at, done_by)
  values ('Setor laporan BPJS','aaaa0000-0000-0000-0000-00000000d101',
          'ffffffff-0000-0000-0000-00000000bb01', ops_core.office_day() - 5,
          'DONE', now(), 'ffffffff-0000-0000-0000-00000000bb01');
  select * into v from ops_hr.v_task where title = 'Setor laporan BPJS';
  assert v.late,             'finished five days after its date';
  assert v.days_early = -5,  'negative means late, got ' || v.days_early;
  assert not v.overdue,      'a finished task is never overdue, however late it was';
  assert v.queue_rank = 3,   'and it leaves the queue, got ' || v.queue_rank;

  insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, status, done_at, done_by)
  values ('Kirim slip gaji','aaaa0000-0000-0000-0000-00000000d101',
          'ffffffff-0000-0000-0000-00000000bb01', ops_core.office_day() + 2,
          'DONE', now(), 'ffffffff-0000-0000-0000-00000000bb01');
  select * into v from ops_hr.v_task where title = 'Kirim slip gaji';
  assert not v.late,        'finished two days before its date';
  assert v.days_early = 2,  'positive means early, got ' || v.days_early;
end $$;

/* ── DERIVATION: the order somebody actually works down ────────────────── */
do $$
declare ranks int[];
begin
  select array_agg(queue_rank order by queue_rank, due_date) into ranks
    from ops_hr.v_task where assignee_no = 'B-601';
  assert ranks = array[0,1,2,3,3],
    'overdue, blocked, open, then the finished two — got ' || ranks::text;
end $$;

/* ── REFUSAL: a cancelled task with its reason is the record ───────────── */
do $$
begin
  begin
    delete from ops_hr.tasks where assignee_id = 'aaaa0000-0000-0000-0000-00000000d101';
    raise exception 'deleting a task should be refused — that is how a delivery figure improves by forgetting';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
