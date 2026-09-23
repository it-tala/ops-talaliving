-- acct — master data (0105): accounts and transaction types from a screen.
--
--   rina   accounting write + post_ledger         — may edit accounting accounts
--   budi   accounting write + post_ledger + approve_funds — may touch leadership's
--   dewi   accounting write only                  — may edit types, not accounts
--
--   REFUSALS     dewi on an account; rina on a leadership account (create,
--                edit, moving one into leadership); a leadership account set
--                to pay; a bad code or currency; a duplicate account or type;
--                an opening balance change with no reason; a currency change
--                on an account with transactions; deleting an account or a
--                type in use
--   DERIVATIONS  an account created, edited (reason in the audit), deactivated
--                and deleted; a type created, retired, described and deleted

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009941','rina-am@talaliving.com','{"full_name":"Rina AM"}'),
  ('ffffffff-0000-0000-0000-000000009942','budi-am@talaliving.com','{"full_name":"Budi AM"}'),
  ('ffffffff-0000-0000-0000-000000009943','dewi-am@talaliving.com','{"full_name":"Dewi AM"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009941','accounting','write'),
  ('ffffffff-0000-0000-0000-000000009942','accounting','write'),
  ('ffffffff-0000-0000-0000-000000009943','accounting','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000009941','post_ledger'),
  ('ffffffff-0000-0000-0000-000000009942','post_ledger'),
  ('ffffffff-0000-0000-0000-000000009942','approve_funds');

-- One transaction on BNI 325, so it is "in use".
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select 'trx-am-1', '2026-09-10', a.id, 'OUT', 1000, 'BANK CHARGES', 'admin', 'trx-am-1',
       'ffffffff-0000-0000-0000-000000009941'
  from ops_acct.accounts a where a.code = 'BNI 325';

set local role authenticated;

/* ── dewi: types yes, accounts no ──────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009943';
do $$
declare r jsonb;
begin
  r := ops_acct.create_account('MANDIRI 999', 'Mandiri', 'accounting', true);
  assert r -> 'error' ->> 'code' = 'authority_required', 'no post_ledger, got ' || r::text;

  r := ops_acct.create_transaction_type('  fuel   &  toll ');
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'code' = 'FUEL & TOLL', 'normalised type, got ' || r::text;
  r := ops_acct.create_transaction_type('FUEL & TOLL');
  assert r -> 'error' ->> 'code' = 'type_exists', 'duplicate type, got ' || r::text;
  r := ops_acct.create_transaction_type('x');
  assert r -> 'error' ->> 'code' = 'code_invalid', 'too short, got ' || r::text;

  r := ops_acct.update_transaction_type('FUEL & TOLL', false, null, null, 'Solar, bensin, e-toll', false);
  assert r ->> 'outcome' = 'ok', 'update type, got ' || r::text;
  assert (select not is_active and not is_purchase and description = 'Solar, bensin, e-toll'
            from ops_acct.transaction_types where code = 'FUEL & TOLL'), 'type fields written';
  r := ops_acct.update_transaction_type('FUEL & TOLL', false, null, null, null, false);
  assert r ->> 'outcome' = 'noop', 'same values is a noop, got ' || r::text;

  r := ops_acct.delete_transaction_type('BANK CHARGES');
  assert r -> 'error' ->> 'code' = 'type_in_use', 'type in use, got ' || r::text;
  r := ops_acct.delete_transaction_type('FUEL & TOLL');
  assert r ->> 'outcome' = 'ok', 'unused type deletes, got ' || r::text;
end $$;

/* ── rina: accounting accounts, never leadership's ─────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009941';
do $$
declare r jsonb;
begin
  r := ops_acct.create_account('BCA 999', 'BCA pimpinan baru', 'leadership');
  assert r -> 'error' ->> 'code' = 'leadership_account', 'leadership needs approve_funds, got ' || r::text;
  r := ops_acct.update_account('BCA 064', 'renamed');
  assert r -> 'error' ->> 'code' = 'leadership_account', 'editing leadership needs approve_funds, got ' || r::text;
  r := ops_acct.update_account('BNI 325', null, 'leadership', false);
  assert r -> 'error' ->> 'code' = 'leadership_account', 'moving into leadership needs approve_funds, got ' || r::text;

  r := ops_acct.create_account('m', 'x', 'accounting');
  assert r -> 'error' ->> 'code' = 'code_invalid', 'bad code, got ' || r::text;
  r := ops_acct.create_account('MANDIRI 999', 'Mandiri', 'accounting', true, 'rupiah');
  assert r -> 'error' ->> 'code' = 'currency_invalid', 'bad currency, got ' || r::text;
  r := ops_acct.create_account('bca 271', 'dup', 'accounting');
  assert r -> 'error' ->> 'code' = 'account_exists', 'duplicate, got ' || r::text;

  r := ops_acct.create_account(' mandiri 999 ', 'Mandiri operasional', 'accounting', true, 'idr', 1500000, '2026-09-01');
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'code' = 'MANDIRI 999', 'create, got ' || r::text;

  r := ops_acct.update_account('MANDIRI 999', null, null, null, null, 2000000);
  assert r -> 'error' ->> 'code' = 'reason_required', 'opening balance needs a reason, got ' || r::text;
  r := ops_acct.update_account('MANDIRI 999', null, null, null, null, 2000000, null, null, 'saldo awal per rekening koran Sept');
  assert r ->> 'outcome' = 'ok', 'opening balance with reason, got ' || r::text;
  assert (select opening_balance from ops_acct.accounts where code = 'MANDIRI 999') = 2000000, 'balance written';

  r := ops_acct.update_account('BNI 325', null, null, null, 'USD');
  assert r -> 'error' ->> 'code' = 'currency_locked', 'currency fixed once used, got ' || r::text;

  r := ops_acct.update_account('MANDIRI 999', null, null, null, null, null, null, false);
  assert r ->> 'outcome' = 'ok' and not (select is_active from ops_acct.accounts where code = 'MANDIRI 999'),
    'deactivated, got ' || r::text;

  r := ops_acct.delete_account('BNI 325');
  assert r -> 'error' ->> 'code' = 'account_in_use', 'in use, got ' || r::text;
  r := ops_acct.delete_account('MANDIRI 999');
  assert r ->> 'outcome' = 'ok', 'unused account deletes, got ' || r::text;
end $$;

/* ── budi: approve_funds reaches leadership, rules still hold ───────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009942';
do $$
declare r jsonb;
begin
  r := ops_acct.update_account('BCA 064', null, null, true);
  assert r -> 'error' ->> 'code' = 'leadership_not_paying', 'leadership never pays, got ' || r::text;
  r := ops_acct.update_account('BCA 064', 'BCA ...064 (pimpinan utama)');
  assert r ->> 'outcome' = 'ok', 'approve_funds may rename leadership, got ' || r::text;
end $$;

reset role;

do $$
declare a record;
begin
  select reason, detail into a from ops_core.audit_log
   where entity = 'account' and entity_no = 'MANDIRI 999' and action = 'update' and outcome = 'ok'
     and detail ? 'opening_balance_after';
  assert a.reason = 'saldo awal per rekening koran Sept', 'reason in the audit, got ' || coalesce(a.reason, 'null');
  assert (a.detail ->> 'opening_balance_before')::numeric = 1500000
     and (a.detail ->> 'opening_balance_after')::numeric = 2000000, 'before/after in detail, got ' || a.detail::text;
end $$;

rollback;
