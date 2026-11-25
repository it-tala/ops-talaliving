-- acct — BCA USD 081 and BCA 064 are read from the bank's own screen (0298,
-- D456): a conversion records USD awal · dikonversi · kurs · IDR diterima and
-- the state after it; a screenshot re-anchors the balance; what the rows did
-- not explain is shown as unrecorded, never booked.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000a295','lead@talaliving.com','{"full_name":"Lead Funds"}'),
  ('ffffffff-0000-0000-0000-00000000b295','acc@talaliving.com','{"full_name":"Acc Only"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000a295','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000a295','resolve_inbox'),
  ('ffffffff-0000-0000-0000-00000000a295','approve_funds'),
  ('ffffffff-0000-0000-0000-00000000b295','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000b295','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000a295','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000b295','accounting','write');
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('55550000-0000-0000-0000-000000000001','drive-295-1','advice-2000.png','chat','ffffffff-0000-0000-0000-00000000a295'),
  ('55550000-0000-0000-0000-000000000002','drive-295-2','summary-2210.png','chat','ffffffff-0000-0000-0000-00000000a295'),
  ('55550000-0000-0000-0000-000000000003','drive-295-3','summary-0111.png','chat','ffffffff-0000-0000-0000-00000000a295'),
  ('55550000-0000-0000-0000-000000000004','drive-295-4','advice-6000.png','chat','ffffffff-0000-0000-0000-00000000a295'),
  ('55550000-0000-0000-0000-000000000005','drive-295-5','summary-1511.png','chat','ffffffff-0000-0000-0000-00000000a295');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('msg1~advice','chat','PENDING','55550000-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000a295',
   '{"doc_type":"Payment Proof","amount_idr":36056000,"caption":"USD=IDR1 @2000 @ 18028= 36,056,000"}'::jsonb),
  ('msg1~summary','chat','PENDING','55550000-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-00000000a295',
   '{"doc_type":"Others","note":"Account Portfolio Summary"}'::jsonb),
  ('msg2~summary','chat','PENDING','55550000-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-00000000a295',
   '{"doc_type":"Others","note":"Account Portfolio Summary"}'::jsonb),
  ('msg3~summary','chat','PENDING','55550000-0000-0000-0000-000000000005','ffffffff-0000-0000-0000-00000000a295',
   '{"doc_type":"Others","note":"Account Portfolio Summary"}'::jsonb);

do $$
begin
  assert (select balance_mode from ops_acct.accounts where code = 'BCA USD 081') = 'state_only', '081: no row balance';
  assert (select balance_mode from ops_acct.accounts where code = 'BCA 064') = 'anchored', '064: anchored';
  assert (select balance_mode from ops_acct.accounts where code = 'BCA 271') = 'running', 'others unchanged';
end $$;

set local role authenticated;

/* ── REFUSAL: a leadership account needs approve_funds ─────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000b295';
do $$
declare r jsonb;
begin
  r := ops_acct.record_conversion('2026-10-22', 2295.14, 2000, 36056000, 18028, 47051568, 'msg1~advice');
  assert r -> 'error' ->> 'code' = 'leadership_account', format('got %s', r);
  r := ops_acct.record_account_state('BCA 064', '2026-10-21', 10995568, 'msg1~summary');
  assert r -> 'error' ->> 'code' = 'leadership_account', format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000a295';

/* ── a reading anchors 064 ─────────────────────────────────────────────── */
do $$
declare r jsonb; b record;
begin
  r := ops_acct.record_account_state('BCA 271', '2026-10-21', 1000, null, '55550000-0000-0000-0000-000000000002');
  assert r -> 'error' ->> 'code' = 'running_account', format('a running account is not set by a reading, got %s', r);
  r := ops_acct.record_account_state('BCA 064', '2026-10-21', 10995568);
  assert r -> 'error' ->> 'code' = 'evidence_required', format('got %s', r);

  -- End of 21/10: the screenshot the day before the conversion.
  r := ops_acct.record_account_state('BCA 064', '2026-10-21', 10995568, null, '55550000-0000-0000-0000-000000000002');
  assert ops_core.said_ok(r), format('got %s', r);
  select * into b from ops_acct.v_account_balance where code = 'BCA 064';
  assert b.balance = 10995568 and b.balance_anchored_on = '2026-10-21',
    format('the balance is the reading, got %s on %s', b.balance, b.balance_anchored_on);
end $$;

/* ── the conversion, from the inbox, the four figures ──────────────────── */
do $$
declare r jsonb; c record; o record; i record; n int;
begin
  r := ops_acct.record_conversion('2026-10-22', 2295.14, 2000, 36056000, 18000, 47051568, 'msg1~advice');
  assert r -> 'error' ->> 'code' = 'rate_mismatch', format('the advice must agree with itself, got %s', r);
  r := ops_acct.record_conversion('2026-10-22', 1500, 2000, 36056000, 18028, 47051568, 'msg1~advice');
  assert r -> 'error' ->> 'code' = 'before_short', format('got %s', r);

  r := ops_acct.record_conversion('2026-10-22', 2295.14, 2000, 36056000, 18028, 47051568,
                                  'msg1~advice', array['msg1~summary']);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'foreign_after')::numeric = 295.14, format('USD sisa, got %s', r -> 'data');

  select * into o from ops_acct.transactions where trx_no = r -> 'data' ->> 'out_trx_no';
  assert o.amount_idr = 2000 and o.direction = 'OUT', 'the 081 leg in dollars';
  select * into o from ops_acct.transactions where trx_no = r -> 'data' ->> 'in_trx_no';
  assert o.amount_idr = 36056000 and o.billed_amount = 2000, 'the 064 leg in rupiah, the dollars beside it';

  select * into c from ops_acct.v_fx_conversion where transfer_id = (r -> 'data' ->> 'transfer_id')::uuid;
  assert c.foreign_before = 2295.14 and c.foreign_amount = 2000 and c.fx_rate = 18028
     and c.idr_amount = 36056000 and c.foreign_after = 295.14 and c.idr_after = 47051568,
    format('the log row, got %s', to_jsonb(c));
  assert c.foreign_jump is null, 'the first conversion has nothing to jump from';
  assert jsonb_array_length(c.documents) = 2, format('both files of the message, got %s', c.documents);

  select count(*) into n from ops_acct.evidence_inbox where ref_id like 'msg1~%' and status = 'CONFIRMED';
  assert n = 2, 'the whole message closed';

  -- 081 prints no row balance; 064 counts from the reading.
  select * into o from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'out_trx_no';
  assert o.balance_after is null and o.balance_before is null, '081 rows show no balance';
  select * into o from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'in_trx_no';
  assert o.balance_before = 10995568 and o.balance_after = 47051568,
    format('064 from the reading before it, got %s → %s', o.balance_before, o.balance_after);
  assert (select balance from ops_acct.v_account_balance where code = 'BCA USD 081') = 295.14, '081 = USD sisa';
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 47051568, '064 = IDR sisa';
end $$;

/* ── a documented outflow, then a screenshot that shows a bank fee ─────── */
do $$
declare r jsonb; s record;
begin
  r := ops_acct.post_transfer('BCA 064', 'BCA 271', 20000000,
         '[{"attachment_id":"55550000-0000-0000-0000-000000000003","kind":"transfer_proof"}]'::jsonb, '2026-10-30');
  assert ops_core.said_ok(r), format('got %s', r);
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 27051568, 'the row counts after the anchor';

  -- 1/11: the bank shows 27.031.568 — Rp 20.000 nobody recorded.
  r := ops_acct.record_account_state('BCA 064', '2026-11-01', 27031568, 'msg2~summary');
  assert ops_core.said_ok(r), format('got %s', r);
  select * into s from ops_acct.v_account_state where account_code = 'BCA 064' and as_of = '2026-11-01';
  assert s.previous_balance = 47051568 and s.recorded_movement = -20000000 and s.unrecorded = -20000,
    format('shown, never booked: got prev %s moved %s unrecorded %s', s.previous_balance, s.recorded_movement, s.unrecorded);
  assert (select status from ops_acct.evidence_inbox where ref_id = 'msg2~summary') = 'NOTED', 'the screenshot is filed';
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 27031568, 're-anchored';
  assert not exists (select 1 from ops_acct.transactions where amount_idr = 20000), 'no GAP row';

  -- The same screenshot again: already recorded, nothing new.
  r := ops_acct.record_account_state('BCA 064', '2026-11-01', 27031568, 'msg2~summary');
  assert (r -> 'data' ->> 'already_recorded')::boolean, format('got %s', r);
end $$;

/* ── dollars that arrived with a proof are an IN row (owner, Q3) ───────── */
do $$
declare r jsonb;
begin
  insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr, type_code,
                                     description, source_ref, posted_by)
  select 'trx-295-ll', '2026-11-10', a.id, 'IN', 8000.87, 'CASHFLOW', 'LIANLIAN WITHDRAWAL',
         'trx-295-ll', 'ffffffff-0000-0000-0000-00000000a295'
    from ops_acct.accounts a where a.code = 'BCA USD 081';
  assert (select balance from ops_acct.v_account_balance where code = 'BCA USD 081') = 8296.01, 'IN after the anchor';
end $$;

/* ── the next conversion starts from a USD awal nobody saw arrive ─────── */
do $$
declare r jsonb; c record;
begin
  r := ops_acct.record_conversion('2026-11-18', 10211.01, 6000, 109374000, 18229, null, null, null,
         '[{"attachment_id":"55550000-0000-0000-0000-000000000004","kind":"transfer_proof"}]'::jsonb);
  assert ops_core.said_ok(r), format('got %s', r);
  select * into c from ops_acct.v_fx_conversion where transfer_id = (r -> 'data' ->> 'transfer_id')::uuid;
  assert c.previous_foreign_after = 295.14 and c.foreign_jump = 9915.87,
    format('a new state, the jump shown, got %s / %s', c.previous_foreign_after, c.foreign_jump);
  assert (select balance from ops_acct.v_account_balance where code = 'BCA USD 081') = 4211.01, 'USD sisa is the new state';
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 136405568,
    '064 without a reading: the last one plus the rows after it';
end $$;

/* ── a wrong reading is voided, the one before it takes over ──────────── */
do $$
declare r jsonb; sid uuid;
begin
  r := ops_acct.record_account_state('BCA 064', '2026-11-19', 1, 'msg3~summary', null, null, 'salah ketik');
  sid := (r -> 'data' ->> 'id')::uuid;
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 1, 'the latest reading wins';
  r := ops_acct.void_account_state(sid, '');
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);
  r := ops_acct.void_account_state(sid, 'salah ketik');
  assert ops_core.said_ok(r), format('got %s', r);
  assert (select balance from ops_acct.v_account_balance where code = 'BCA 064') = 136405568, 'back to the one before';
end $$;

/* ── the sheet mirror prints what the ledger prints (D456) ─────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000a295';
do $$
declare r jsonb; e jsonb; n int := 0;
begin
  r := ops_acct.ledger_sheet_rows();
  assert ops_core.said_ok(r), format('got %s', r);
  for e in select * from jsonb_array_elements(r->'data'->'rows') loop
    if e->>'account' = 'BCA USD 081' then
      assert e->>'balance' is null, format('081 prints no balance, got %s', e);
    elsif e->>'account' = 'BCA 064' and e->>'line' is null then
      n := n + 1;
      assert (e->>'balance')::numeric is not distinct from
             (select v.balance_after from ops_acct.v_transaction v where v.trx_no = e->>'trx_no'),
        format('064 sheet balance follows the reading, got %s', e);
    end if;
  end loop;
  assert n > 0, 'some 064 rows were checked';
end $$;

/* ── a reader without approve_funds sees none of it ────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000b295';
do $$
begin
  assert (select count(*) from ops_acct.v_account_state) = 0, 'readings hidden';
  assert (select count(*) from ops_acct.v_fx_conversion) = 0, 'conversions hidden';
  assert (select count(*) from ops_acct.account_states) = 0, 'table hidden too';
end $$;

rollback;
