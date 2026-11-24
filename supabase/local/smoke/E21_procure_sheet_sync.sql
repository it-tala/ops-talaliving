-- procure — the PR recap sheet, read into the PR module (0296, D454).
--
-- Proved here:
--   * refusals: no settings row; a reader who may not write procurement;
--   * a new sheet row becomes a SUBMITTED line, its tick a GOODS approval
--     channel `sheet`, its PAID AMOUNT an allocation — only to a transaction
--     that already exists, to the rupiah or with a bank fee folded in;
--   * one transfer paying two rows of the same day;
--   * two candidates is nobody: left unmatched, never guessed;
--   * a LINE ID the database does not know makes nothing;
--   * a second run (the write-back failed) makes no second line, approval or
--     allocation;
--   * the daily job writes as the settings' actor, and the timeline view
--     answers typed / approved / paid.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccc0000-0000-0000-0000-00000000e201','shared@talaliving.com','{"full_name":"Shared"}'),
  ('cccc0000-0000-0000-0000-00000000e202','evin@talaliving.com','{"full_name":"Evin"}'),
  ('cccc0000-0000-0000-0000-00000000e203','dewi@talaliving.com','{"full_name":"Dewi"}'),
  ('cccc0000-0000-0000-0000-00000000e204','rina@talaliving.com','{"full_name":"Rina"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('cccc0000-0000-0000-0000-00000000e203','procurement','write'),
  ('cccc0000-0000-0000-0000-00000000e204','procurement','read');

-- The ledger, as accounting already booked it.
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by)
select x.id::uuid, x.no, ops_core.office_day() - 1, a.id, 'OUT', x.amt, 'SUPPLIERS', x.descr, x.no,
       'cccc0000-0000-0000-0000-00000000e203'
  from ops_acct.accounts a,
       (values ('66660000-0000-0000-0000-00000000e201', 'trx-ss-1', 502500,  'BELANJA SARIPAN - NUR'),
               ('66660000-0000-0000-0000-00000000e202', 'trx-ss-2', 4210002, 'DAILY PAYROLL WEEK 2 NOV + RENT GRAND MAX'),
               ('66660000-0000-0000-0000-00000000e203', 'trx-ss-3', 200000,  'DRIVER EJO - FENDI'),
               ('66660000-0000-0000-0000-00000000e204', 'trx-ss-4', 200000,  'PAYMENT DRIVER FENDI')) x(id, no, amt, descr)
 where a.code = 'PETTY CASH';

create temp table _rows as select $j$[
  {"row_no": 10, "line_id": "", "date": "2026-11-19", "description": "BELANJA SARIPAN - BALANCE 71500",
   "keterangan": "", "vendor": "", "qty": 1, "unit": "WEEK ", "price": 500000, "amount": 500000,
   "approved": true, "paid_amount": 500000},
  {"row_no": 11, "line_id": "", "date": "2026-11-12", "description": "DAILY PAYROLL - WEEK2  NOV",
   "keterangan": "", "vendor": "", "qty": 1, "unit": "WEEK", "price": 4140002, "amount": 4140002,
   "approved": true, "paid_amount": 4140002},
  {"row_no": 12, "line_id": "", "date": "2026-11-12", "description": "SEWA GRAND MAX ANDI",
   "keterangan": "", "vendor": "", "qty": 28, "unit": "WEEK", "price": 2500, "amount": 70000,
   "approved": true, "paid_amount": 70000},
  {"row_no": 13, "line_id": "", "date": "2026-11-17", "description": "DRIVER - FENDI X 2",
   "keterangan": "", "vendor": "FENDI", "qty": 1, "unit": "", "price": 200000, "amount": 200000,
   "approved": true, "paid_amount": 200000},
  {"row_no": 14, "line_id": "", "date": "2026-11-24", "description": "CAT DULUX - WHITE",
   "keterangan": "1 PAIL ISI 5KG", "vendor": "", "qty": 1, "unit": "", "price": 210000, "amount": 210000,
   "approved": false, "paid_amount": 0},
  {"row_no": 15, "line_id": "pr-99-01-01_01-L01", "date": "2026-11-24", "description": "NOT OURS",
   "qty": 1, "price": 1000, "amount": 1000, "approved": true, "paid_amount": 0},
  {"row_no": 16, "line_id": "", "date": "", "description": "", "amount": null}
]$j$::jsonb as j;
grant select on _rows to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-00000000e203';

do $$
declare r jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', (select j from _rows));
  assert r->>'outcome' = 'refused' and r->'error'->>'code' = 'not_configured', 'no settings: ' || r::text;
end $$;

reset role;
insert into ops_procure.sheet_sync_settings (spreadsheet_id, actor_id, approver_email)
values ('sheet-e20', 'cccc0000-0000-0000-0000-00000000e201', 'evin@talaliving.com');
set local role authenticated;

set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-00000000e204';
do $$
declare r jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', (select j from _rows));
  assert r->>'outcome' = 'refused' and r->'error'->>'code' = 'forbidden', 'a reader cannot sync: ' || r::text;
end $$;

/* ── the first run ─────────────────────────────────────────────────────── */

set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-00000000e203';
do $$
declare r jsonb; c jsonb; rows jsonb; l10 text; l11 text; l12 text; l13 text; l14 text;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', (select j from _rows));
  assert r->>'outcome' = 'ok', 'first run: ' || r::text;
  c := r->'data'->'counts';
  rows := r->'data'->'rows';
  assert (c->>'read')::int = 6 and (c->>'skipped')::int = 1, 'read/skipped: ' || c::text;
  assert (c->>'created')::int = 5, 'five lines made: ' || c::text;
  assert (c->>'unknown_line')::int = 1, 'the foreign LINE ID made nothing: ' || c::text;
  assert (c->>'approved')::int = 4, 'four ticks became approvals: ' || c::text;
  assert (c->>'matched')::int = 3, 'saripan alone, payroll + grand max together: ' || c::text;
  assert (c->>'unmatched')::int = 1, 'fendi has two candidates: ' || c::text;

  select e->>'line_no_full' into l10 from jsonb_array_elements(rows) e where (e->>'row_no')::int = 10;
  select e->>'line_no_full' into l11 from jsonb_array_elements(rows) e where (e->>'row_no')::int = 11;
  select e->>'line_no_full' into l12 from jsonb_array_elements(rows) e where (e->>'row_no')::int = 12;
  select e->>'line_no_full' into l13 from jsonb_array_elements(rows) e where (e->>'row_no')::int = 13;
  select e->>'line_no_full' into l14 from jsonb_array_elements(rows) e where (e->>'row_no')::int = 14;

  assert l10 like 'pr-26-11-19\_%-L01', 'numbered by its request date: ' || coalesce(l10, 'null');
  assert split_part(l11, '-L', 1) = split_part(l12, '-L', 1), 'one document per date';
  assert (select e->>'trx_nos' from jsonb_array_elements(rows) e where (e->>'row_no')::int = 10) = 'trx-ss-1',
         'the fee-folded transfer: ' || rows::text;
  assert (select e->>'trx_nos' from jsonb_array_elements(rows) e where (e->>'row_no')::int = 12) = 'trx-ss-2',
         'the shared transfer';
  assert (select e->>'trx_nos' from jsonb_array_elements(rows) e where (e->>'row_no')::int = 13) is null,
         'two candidates is nobody';
  assert (select e->>'paid_status' from jsonb_array_elements(rows) e where (e->>'row_no')::int = 13) = 'unmatched';

  assert (select amount from ops_acct.payment_allocations where pr_line_no = l10) = 500000,
         'the sheet figure, not the fee';
  assert (select uom from ops_procure.pr_lines where line_no_full = l10) = 'week', 'unit resolved';
  assert (select channel::text from ops_procure.pr_approvals a join ops_procure.pr_lines l on l.id = a.line_id
           where l.line_no_full = l10) = 'sheet', 'approval through the sheet';
  assert not exists (select 1 from ops_procure.pr_approvals a join ops_procure.pr_lines l on l.id = a.line_id
                      where l.line_no_full = l14), 'an unticked row is not approved';
  assert (select requested_by from ops_procure.pr_documents d join ops_procure.pr_lines l on l.doc_id = d.id
           where l.line_no_full = l10) = 'cccc0000-0000-0000-0000-00000000e203', 'written as the person';
end $$;

/* ── the second run: the write-back never landed ───────────────────────── */

do $$
declare r jsonb; c jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', (select j from _rows));
  c := r->'data'->'counts';
  assert (c->>'created')::int = 0 and (c->>'approved')::int = 0 and (c->>'matched')::int = 0,
         'nothing twice: ' || c::text;
end $$;

-- Counted as the owner: Dewi writes procurement and may not read the ledger.
reset role;
do $$
begin
  assert (select count(*) from ops_acct.payment_allocations x join ops_acct.transactions t on t.id = x.trx_id
           where t.trx_no like 'trx-ss-%') = 3, 'still three allocations';
  assert (select count(distinct a.id) from ops_procure.pr_approvals a
           join ops_procure.sheet_pr_rows s on s.line_id = a.line_id) = 4, 'still four approvals';
end $$;

/* ── the daily job: as the settings' actor ─────────────────────────────── */

reset role;
set local role service_role;
do $$
declare r jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP',
         '[{"row_no": 20, "line_id": "", "date": "2026-11-25", "description": "JOHAR WOOD",
            "qty": 6, "price": 26000, "amount": 156000, "approved": false, "paid_amount": 0}]'::jsonb, 'cron');
  assert r->>'outcome' = 'ok' and (r->'data'->'counts'->>'created')::int = 1, 'cron run: ' || r::text;
end $$;
reset role;

do $$
begin
  assert (select d.requested_by from ops_procure.pr_documents d join ops_procure.pr_lines l on l.doc_id = d.id
           where l.description = 'JOHAR WOOD') = 'cccc0000-0000-0000-0000-00000000e201', 'the job writes as the actor';
  assert (select count(*) from ops_procure.sheet_sync_runs where trigger = 'cron') = 1, 'the run is kept';
  assert exists (select 1 from ops_procure.v_line_timeline t
                  where t.description like 'BELANJA SARIPAN%' and t.requested_on = '2026-11-19'
                    and t.recorded_on is not null and t.approved_on is not null
                    and t.paid_on = ops_core.office_day() - 1 and t.trx_nos = 'trx-ss-1' and t.from_sheet),
         'typed, approved, paid';
end $$;

rollback;
