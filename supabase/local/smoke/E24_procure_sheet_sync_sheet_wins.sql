-- procure — the PR recap sheet is the record (0299, D457).
--
-- Proved here:
--   * a row with no amount yet is still a request: a line at Rp 0, marked;
--   * the next run brings that line to the amount the office filled in, and a
--     line whose amount or words changed on the sheet to the sheet — `updated`,
--     before → after in the audit trail and the run's summary;
--   * spacing alone is not a difference;
--   * the moved row keeps one trace row, and a third run changes nothing.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccc0000-0000-0000-0000-00000000e241','shared@talaliving.com','{"full_name":"Shared"}'),
  ('cccc0000-0000-0000-0000-00000000e243','dewi@talaliving.com','{"full_name":"Dewi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('cccc0000-0000-0000-0000-00000000e243','procurement','write');
insert into ops_procure.sheet_sync_settings (spreadsheet_id, actor_id, approver_email)
values ('sheet-e24', 'cccc0000-0000-0000-0000-00000000e241', 'evin@talaliving.com');

set local role authenticated;
set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-00000000e243';

create temp table _l (k text primary key, no text);
grant all on _l to authenticated;

/* ── first run: a priced row, an unpriced row, a row typed with two spaces ── */

do $$
declare r jsonb; c jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', $j$[
    {"row_no": 10, "line_id": "", "date": "2026-11-11", "description": "LISTRIK SARIPAN",
     "qty": 1, "price": 500000, "amount": 500000, "approved": false, "paid_amount": null},
    {"row_no": 11, "line_id": "", "date": "2026-11-25", "description": "ONGKIR JOHAR WOOD FROM SOLO - JEPARA",
     "qty": 1, "unit": "", "price": null, "amount": null, "approved": false, "paid_amount": null},
    {"row_no": 12, "line_id": "", "date": "2026-11-12", "description": "DAILY PAYROLL - WEEK2  NOV",
     "qty": 1, "price": 4140002, "amount": 4140002, "approved": false, "paid_amount": null}
  ]$j$::jsonb);
  assert r->>'outcome' = 'ok', 'first run: ' || r::text;
  c := r->'data'->'counts';
  assert (c->>'created')::int = 3 and (c->>'skipped')::int = 0, 'the unpriced row is a request too: ' || c::text;
  insert into _l select 'r' || (e->>'row_no'), e->>'line_no_full' from jsonb_array_elements(r->'data'->'rows') e;
end $$;

do $$
begin
  assert (select item_total from ops_procure.pr_lines where line_no_full = (select no from _l where k = 'r11')) = 0,
         'no amount yet is Rp 0';
  assert (select purpose from ops_procure.pr_lines where line_no_full = (select no from _l where k = 'r11'))
         like '%amount not on the sheet yet%', 'and says so';
end $$;

/* ── second run: the LINE IDs written back, the office edited two rows ───── */

do $$
declare r jsonb; c jsonb; rows jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', jsonb_build_array(
    jsonb_build_object('row_no', 10, 'line_id', (select no from _l where k = 'r10'), 'date', '2026-11-11',
      'description', 'LISTRIK SARIPAN', 'qty', 1, 'price', 504000, 'amount', 504000, 'approved', false),
    jsonb_build_object('row_no', 11, 'line_id', (select no from _l where k = 'r11'), 'date', '2026-11-25',
      'description', 'ONGKIR JOHAR WOOD FROM SOLO - JEPARA', 'qty', 1, 'price', 75000, 'amount', 75000, 'approved', false),
    jsonb_build_object('row_no', 12, 'line_id', (select no from _l where k = 'r12'), 'date', '2026-11-12',
      'description', 'DAILY PAYROLL - WEEK2 NOV', 'qty', 1, 'price', 4140002, 'amount', 4140002, 'approved', false)));
  c := r->'data'->'counts';
  rows := r->'data'->'rows';
  assert (c->>'updated')::int = 2 and (c->>'created')::int = 0, 'two lines brought to the sheet: ' || c::text;
  assert (select e->>'status' from jsonb_array_elements(rows) e where (e->>'row_no')::int = 12) = 'seen',
         'spacing is not a difference: ' || rows::text;
end $$;

reset role;
do $$
declare l10 text := (select no from _l where k = 'r10'); l11 text := (select no from _l where k = 'r11');
begin
  assert (select item_total from ops_procure.pr_lines where line_no_full = l10) = 504000, 'the sheet figure';
  assert (select item_total from ops_procure.pr_lines where line_no_full = l11) = 75000, 'the amount filled later';
  assert (select (before->>'item_total')::numeric from ops_core.audit_log
           where entity = 'pr_line' and entity_no = l10 and action = 'sheet_update') = 500000,
         'what it said before is kept';
  assert (select count(*) from ops_procure.sheet_pr_rows s join ops_procure.pr_lines l on l.id = s.line_id
           where l.line_no_full in (l10, l11)) = 2, 'one trace row each, not one per figure';
  assert (select jsonb_array_length(summary->'updates') from ops_procure.sheet_sync_runs
           order by run_at desc, id limit 1) = 2, 'the run lists what it changed';
end $$;

/* ── third run: the same sheet changes nothing ─────────────────────────── */

set local role authenticated;
set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-00000000e243';
do $$
declare r jsonb;
begin
  r := ops_procure.sync_pr_sheet('NOVEMBER  PR RECAP', jsonb_build_array(
    jsonb_build_object('row_no', 10, 'line_id', (select no from _l where k = 'r10'), 'date', '2026-11-11',
      'description', 'LISTRIK SARIPAN', 'qty', 1, 'price', 504000, 'amount', 504000),
    jsonb_build_object('row_no', 11, 'line_id', (select no from _l where k = 'r11'), 'date', '2026-11-25',
      'description', 'ONGKIR JOHAR WOOD FROM SOLO - JEPARA', 'qty', 1, 'price', 75000, 'amount', 75000)));
  assert (r->'data'->'counts'->>'updated')::int = 0, 'nothing twice: ' || r::text;
end $$;

rollback;
