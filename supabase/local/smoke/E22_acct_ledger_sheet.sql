-- acct — the ops ledger mirrored into the accounting workbook (0297, D455).
--
-- Proved here:
--   * refusal: pressing the sync needs post_ledger; recording a run too, and
--     an outcome other than ok/failed is invalid;
--   * the rows read past `account_rows_readable`: someone with post_ledger but
--     no approve_funds still gets BCA 064 rows (the workbook is the boundary);
--   * one row per line, lettered a/b, a fee line typed BANK CHARGES, the line's
--     running share of the balance and the transaction's own balance on its
--     last line; a void transaction is not a row; another year is not a row;
--   * a line's own document replaces the transaction's of the same kind;
--   * a run is recorded.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000e297','gl-acc@talaliving.com','{"full_name":"GL Acc"}'),
  ('eeee0000-0000-0000-0000-00000000f297','gl-read@talaliving.com','{"full_name":"GL Reader"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('eeee0000-0000-0000-0000-00000000e297','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000e297','accounting','write'),
  ('eeee0000-0000-0000-0000-00000000f297','accounting','read');

insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('44440000-0000-0000-0000-000000000297','drive-297-proof','proof.png','web','eeee0000-0000-0000-0000-00000000e297'),
  ('44440000-0000-0000-0000-000000000298','drive-297-nota','nota.png','web','eeee0000-0000-0000-0000-00000000e297'),
  ('44440000-0000-0000-0000-000000000299','drive-297-nota-b','nota-b.png','web','eeee0000-0000-0000-0000-00000000e297');

-- Far in the future, so nothing else in the ladder sorts after them.
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by, status, void_reason, void_at)
select x.id::uuid, x.no, x.d::date, a.id, x.dir::ops_acct.direction_t, x.amt, 'SUPPLIERS', x.descr, x.no,
       'eeee0000-0000-0000-0000-00000000e297', x.st::ops_acct.trx_status_t,
       case when x.st = 'VOID' then 'typed twice' end, case when x.st = 'VOID' then now() end
  from ops_acct.accounts a,
       (values ('77770000-0000-0000-0000-000000000291', 'trx-gl-1', '2026-12-30', 'OUT', 1000000::numeric, 'TWO THINGS + FEE', 'POSTED', 'BCA 064'),
               ('77770000-0000-0000-0000-000000000292', 'trx-gl-2', '2026-12-30', 'OUT',   50000::numeric, 'VOIDED ONE',       'VOID',   'BCA 064'),
               ('77770000-0000-0000-0000-000000000293', 'trx-gl-3', '2026-12-31', 'IN',   300000::numeric, 'PLAIN IN',         'POSTED', 'BCA 064'),
               ('77770000-0000-0000-0000-000000000294', 'trx-gl-4', '2027-01-02', 'OUT',   10000::numeric, 'NEXT YEAR',        'POSTED', 'BCA 064')
       ) x(id, no, d, dir, amt, descr, st, acct)
 where a.code = x.acct;

insert into ops_acct.transaction_lines (trx_id, line_no, description, qty, amount, kind, attachment_id) values
  ('77770000-0000-0000-0000-000000000291', 1, 'THING A', 1, 600000, 'item', null),
  ('77770000-0000-0000-0000-000000000291', 2, 'THING B', 1, 393500, 'item', '44440000-0000-0000-0000-000000000299'),
  ('77770000-0000-0000-0000-000000000291', 3, 'BIAYA TRANSFER', 1, 6500, 'fee', null);

insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('44440000-0000-0000-0000-000000000297','transaction','trx-gl-1','transfer_proof','eeee0000-0000-0000-0000-00000000e297'),
  ('44440000-0000-0000-0000-000000000298','transaction','trx-gl-1','nota','eeee0000-0000-0000-0000-00000000e297'),
  ('44440000-0000-0000-0000-000000000299','transaction','trx-gl-1','nota','eeee0000-0000-0000-0000-00000000e297');

set local role authenticated;

/* ── REFUSAL: no post_ledger ───────────────────────────────────────────── */
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000f297';
do $$
declare r jsonb;
begin
  r := ops_acct.ledger_sheet_rows();
  assert r->>'outcome' = 'refused' and r->'error'->>'code' = 'forbidden', 'reader may not sync: ' || r::text;
  r := ops_acct.record_ledger_sheet_run(1, 'ok');
  assert r->>'outcome' = 'refused', 'reader may not record a run: ' || r::text;
end $$;

/* ── DERIVATION: the rows ──────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000e297';
do $$
declare
  r    jsonb;
  rows jsonb;
  mine jsonb;
  bal_before numeric;
begin
  assert not ops_core.has_authority('approve_funds'), 'this caller has no approve_funds';
  assert not exists (select 1 from ops_acct.v_transaction where trx_no = 'trx-gl-1'),
    'the screen hides BCA 064 from this caller';

  r := ops_acct.ledger_sheet_rows();
  assert r->>'outcome' = 'ok', 'rows: ' || r::text;
  assert r->'data'->>'tab' = 'GL OPS 2026' and (r->'data'->>'year')::int = 2026, 'settings carried';
  rows := r->'data'->'rows';

  select coalesce(jsonb_agg(e order by ord), '[]') into mine
    from jsonb_array_elements(rows) with ordinality as t(e, ord)
   where e->>'trx_no' like 'trx-gl-%';

  assert jsonb_array_length(mine) = 4, 'three lines + one plain row, no void, no 2027: ' || mine::text;
  assert mine->0->>'line' = 'a' and mine->1->>'line' = 'b' and mine->2->>'line' = 'c', 'lettered';
  assert mine->3->>'line' is null, 'a transaction without lines has no letter';
  assert mine->0->>'description' = 'THING A' and (mine->0->>'amount')::numeric = 600000, 'line amount';
  assert mine->2->>'type' = 'BANK CHARGES', 'fee line typed BANK CHARGES';
  assert mine->0->>'type' = 'SUPPLIERS', 'item line keeps its type';
  assert mine->0->>'account' = 'BCA 064', 'leadership account included';

  bal_before := (mine->2->>'balance')::numeric + 1000000;
  assert (mine->0->>'balance')::numeric = bal_before - 600000, 'line a: its share';
  assert (mine->1->>'balance')::numeric = bal_before - 993500, 'line b: running share';
  assert (mine->2->>'balance')::numeric = (select balance_after from ops_acct.transactions t
      join lateral (select a.opening_balance + sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end) as balance_after
                      from ops_acct.transactions x join ops_acct.accounts a on a.id = x.account_id
                     where x.account_id = t.account_id and x.status <> 'VOID'
                       and (x.trx_date, x.trx_no) <= (t.trx_date, t.trx_no)
                     group by a.opening_balance) b on true
     where t.trx_no = 'trx-gl-1'), 'last line: the transaction''s balance';
  assert (mine->3->>'balance')::numeric = (mine->2->>'balance')::numeric + 300000, 'the void one moved nothing';

  -- Line b carries its own nota instead of the transaction's; a and c the transaction's.
  assert (select count(*) from jsonb_array_elements(mine->1->'docs') d where d->>'kind' = 'nota') = 1
     and exists (select 1 from jsonb_array_elements(mine->1->'docs') d where d->>'href' like '%drive-297-nota-b%'),
    'line b: its own nota only: ' || (mine->1->'docs')::text;
  assert (select count(*) from jsonb_array_elements(mine->0->'docs')) = 3, 'line a: every document of the transaction';

  r := ops_acct.record_ledger_sheet_run(jsonb_array_length(rows), 'ok');
  assert r->>'outcome' = 'ok', 'run recorded: ' || r::text;
  r := ops_acct.record_ledger_sheet_run(1, 'maybe');
  assert (r->>'status')::int = 422 and r->'error'->>'code' = 'bad_outcome', 'outcome is ok or failed: ' || r::text;
  assert (select count(*) from ops_acct.ledger_sheet_runs where run_by = 'eeee0000-0000-0000-0000-00000000e297') = 1, 'one run kept';
end $$;

rollback;
