-- acct — the two seams `0092`/`0093` added.
--
-- `save_cash_component` could set `ends_on`/`active` on insert (the table's
-- own defaults) but never on an edit — a line could be created closing next
-- June and never retired. `complete_transaction` did not exist at all:
-- `markComplete` had a screen (`/accounting/ledger`) and nothing behind it.
--
-- Proved here:
--   * a component created with `ends_on`/`active` carries both
--   * an edit that never mentions them (the seam's full-replace update) does
--     not blank them back to null/true — `updateComponent`'s merge, on the
--     client, is what protects this; the seam itself would blank them if
--     called with nulls, which is why the client always reads the row first
--   * `complete_transaction`: 404 on a row that does not exist, 409 on a row
--     already COMPLETED, and the transition itself — status, and an audit
--     row naming what it was and what it became (D84)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5e50000-0000-0000-0000-00000000f11a','sari@talaliving.com','{"full_name":"Sari Wulandari"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('e5e50000-0000-0000-0000-00000000f11a','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('e5e50000-0000-0000-0000-00000000f11a','accounting','admin');

insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('e5e50000-0000-0000-0000-000000000002','https://drive.example/nota','nota.pdf',
   'e5e50000-0000-0000-0000-00000000f11a');

set local role authenticated;
set local request.jwt.claim.sub = 'e5e50000-0000-0000-0000-00000000f11a';

/* ── save_cash_component: ends_on / active reach the row now ────────────── */
do $$
declare r jsonb; v_id uuid; row ops_acct.cash_components;
begin
  r := ops_acct.save_cash_component(
    'Sewa gudang sementara', 8000000, 'monthly', 'OUT', 10, null, null,
    'WAREHOUSE', null, null, '2026-01', null, null, '2026-06', false);
  v_id := (r -> 'data' ->> 'component_id')::uuid;
  select * into row from ops_acct.cash_components where id = v_id;
  assert row.ends_on = '2026-06', format('ends_on not written on insert, got %s', row.ends_on);
  assert row.active = false, format('active not written on insert, got %s', row.active);

  -- An edit that repeats every field, ends_on/active included (this is what
  -- `updateComponent`'s client-side merge always does — the seam itself has
  -- no partial-update semantics, on this field or any other).
  r := ops_acct.save_cash_component(
    'Sewa gudang sementara', 8500000, 'monthly', 'OUT', 10, null, null,
    'WAREHOUSE', null, null, '2026-01', null, v_id, '2026-06', false);
  select * into row from ops_acct.cash_components where id = v_id;
  assert row.amount = 8500000, format('amount not updated, got %s', row.amount);
  assert row.ends_on = '2026-06', format('ends_on lost on update, got %s', row.ends_on);
  assert row.active = false, format('active lost on update, got %s', row.active);
end $$;

/* ── complete_transaction ────────────────────────────────────────────────── */
do $$
declare r jsonb; v_trx text;
begin
  r := ops_acct.complete_transaction('trx-does-not-exist');
  assert (r -> 'error' ->> 'status')::int = 404, format('got %s', r);

  r := ops_acct.post_transaction(
    'PETTY CASH', 'OUT', 250000, 'BANK CHARGES', 'Biaya admin bank',
    jsonb_build_array(jsonb_build_object('attachment_id','e5e50000-0000-0000-0000-000000000002','kind','nota')));
  assert r ->> 'outcome' = 'ok', format('posting failed, got %s', r);
  v_trx := r -> 'data' ->> 'trx_no';

  r := ops_acct.complete_transaction(v_trx);
  assert r ->> 'outcome' = 'ok', format('complete failed, got %s', r);
  assert exists (select 1 from ops_acct.transactions where trx_no = v_trx and status = 'COMPLETED'),
    'status did not move to COMPLETED';

  r := ops_acct.complete_transaction(v_trx);
  assert r -> 'error' ->> 'code' = 'already_complete', format('got %s', r);
end $$;

-- `ops_core.audit_log` is `it.read` (0003) — sari holds only `accounting`.
set local role postgres;
do $$
declare n int; v_trx text;
begin
  select trx_no into v_trx from ops_acct.transactions where description = 'Biaya admin bank';
  select count(*) into n from ops_core.audit_log
   where entity = 'transaction' and entity_no = v_trx and action = 'complete' and outcome = 'ok';
  assert n = 1, format('no audit row for the completion, saw %s', n);
end $$;
set local role authenticated;

rollback;
