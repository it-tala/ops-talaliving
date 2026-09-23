-- acct — confirm_incoming (0098): the second road out of the inbox,
-- money coming IN rather than a purchase matched to a request.
--
-- Worked out first:
--
--   a transfer proof from chat, PENDING, money_direction IN, no note typed
--   confirm_incoming(BCA 271, 2.500.000, description omitted)
--     -> a POSTED transaction, description falls back to the AI's own
--        `extracted.note` (D81's "a proposal, never a posting", A13)
--   the same call again, same key -> the FIRST call's own trx_no back, no
--     second row (idempotency, same as post_transaction)
--   the same ref_id again, a DIFFERENT key -> refused: already CONFIRMED
--     (checked before the source_ref guard, the more specific answer)
--
--   REFUSALS     post_ledger required, not just accounting.create (D24, same
--                split 06_acct.sql proves for post_transaction); amount <= 0;
--                an account that does not exist; a row already resolved
--   DERIVATIONS  the proof attached to the transaction it produced; the
--                inbox row closed with the trx_no a screen can follow back

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000d001','rina-in@talaliving.com','{"full_name":"Rina In"}'),
  ('ffffffff-0000-0000-0000-00000000d002','dewi-in@talaliving.com','{"full_name":"Dewi In"}'),
  ('ffffffff-0000-0000-0000-00000000d003','budi-chat@talaliving.com','{"full_name":"Budi Chat"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000d001','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000d001','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000d002','accounting','admin');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000d1','a/transfer.jpg','bukti-transfer.jpg','ffffffff-0000-0000-0000-00000000d003');

insert into ops_acct.evidence_inbox (ref_id, origin, attachment_id, reported_by, extracted, money_direction) values
  ('evt-in-0001~x0','chat','44440000-0000-0000-0000-0000000000d1',
   'ffffffff-0000-0000-0000-00000000d003',
   jsonb_build_object('note','Transfer dari Budi utk DP proyek'), 'IN');

set local role authenticated;

/* ── REFUSAL: accounting.admin is not post_ledger (D24) ────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000d002';
do $$
declare r jsonb;
begin
  r := ops_acct.confirm_incoming('evt-in-0001~x0','BCA 271','2026-09-20',2500000, null, null);
  assert r ->> 'outcome' = 'refused', 'admin without post_ledger should be refused, got ' || (r ->> 'outcome');
  assert r -> 'error' ->> 'code' = 'authority_required', 'wrong code: ' || (r -> 'error' ->> 'code');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000d001';

/* ── REFUSALS on the input itself ──────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.confirm_incoming('evt-in-0001~x0','BCA 271','2026-09-20', 0, null, null);
  assert r ->> 'outcome' = 'refused', 'a zero amount should be refused, got ' || (r ->> 'outcome');
  assert r -> 'error' ->> 'code' = 'amount_positive', 'wrong code: ' || (r -> 'error' ->> 'code');

  r := ops_acct.confirm_incoming('evt-in-0001~x0','NO SUCH ACCOUNT','2026-09-20', 2500000, null, null);
  assert r ->> 'outcome' = 'refused', 'an unknown account should be refused, got ' || (r ->> 'outcome');
  assert r -> 'error' ->> 'code' = 'no_such_account', 'wrong code: ' || (r -> 'error' ->> 'code');
end $$;

/* ── DERIVATION: the first call, its fallback description, its replay ──── */
do $$
declare r jsonb; trx_1 text;
begin
  r := ops_acct.confirm_incoming('evt-in-0001~x0','BCA 271','2026-09-20', 2500000, null, 'k1');
  assert r ->> 'outcome' = 'ok', 'expected ok, got ' || (r ->> 'outcome') || ' / ' || (r -> 'error' ->> 'message');
  assert r -> 'data' ->> 'description' = 'Transfer dari Budi utk DP proyek',
    'falls back to the AI''s own reading, got ' || (r -> 'data' ->> 'description');
  assert (r -> 'data' ->> 'amount_idr')::numeric = 2500000, 'wrong amount: ' || (r -> 'data' ->> 'amount_idr');
  assert r -> 'data' ->> 'account_code' = 'BCA 271', 'wrong account: ' || (r -> 'data' ->> 'account_code');
  assert r -> 'data' ->> 'proof_filename' = 'bukti-transfer.jpg', 'wrong filename: ' || (r -> 'data' ->> 'proof_filename');
  trx_1 := r -> 'data' ->> 'trx_no';
  assert trx_1 is not null and trx_1 <> '', 'a real trx_no';

  -- Double tap, same key: the first call's own answer, not a second row.
  r := ops_acct.confirm_incoming('evt-in-0001~x0','BCA 271','2026-09-20', 2500000, null, 'k1');
  assert r ->> 'outcome' = 'duplicate', 'a replay reads as duplicate, got ' || (r ->> 'outcome');
  assert r -> 'data' ->> 'trx_no' = trx_1, 'the SAME trx_no back, got ' || (r -> 'data' ->> 'trx_no');
end $$;

do $$
declare n int; row_status text; row_trx text;
begin
  select count(*) into n from ops_acct.transactions where source_ref = 'inbox-in:evt-in-0001~x0';
  assert n = 1, 'one call replayed under the same key should still be one transaction, got ' || n;

  select status, produced_trx_no into row_status, row_trx
    from ops_acct.evidence_inbox where ref_id = 'evt-in-0001~x0';
  assert row_status = 'CONFIRMED', 'the inbox row should read CONFIRMED, got ' || row_status;
  assert row_trx is not null, 'and point at the transaction it produced';

  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = row_trx and kind = 'transfer_proof' and unlinked_at is null;
  assert n = 1, 'the proof follows the money onto the ledger row, got ' || n;
end $$;

/* ── REFUSAL: a row already resolved, checked before source_ref (D81) ──── */
do $$
declare r jsonb;
begin
  -- A genuinely different key: not a replay, so this asks the row itself.
  r := ops_acct.confirm_incoming('evt-in-0001~x0','BCA 271','2026-09-20', 2500000, null, 'k2');
  assert r ->> 'outcome' = 'duplicate', 'an already-resolved row reads as duplicate, got ' || (r ->> 'outcome');
  assert r -> 'error' ->> 'code' = 'already_resolved', 'wrong code: ' || (r -> 'error' ->> 'code');
end $$;

rollback;
