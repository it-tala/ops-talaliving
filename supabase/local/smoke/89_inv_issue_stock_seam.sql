-- inv — issue_stock (0097): the one write in the stock_moves family with an
-- idempotency key behind it.
--
-- Worked out first, one item:
--
--   receipt 10 @ 100.000     GUDANG
--   issue_stock(qty=3, key=k1)   → on_hand_after = 7, went_negative = false
--   issue_stock(qty=3, key=k1)   again, same key  → the SAME move_no back,
--                                  no second row — the double tap this exists
--                                  for
--   issue_stock(qty=3, key=k2)   a genuinely different call → a second row,
--                                  on_hand_after = 4
--   issue_stock(qty=20, key=k3)  more than the rack holds → allowed and
--                                  flagged (A6), went_negative = true, never
--                                  refused the way move_boards' D205 refuses
--
--   REFUSALS     qty <= 0; a read-level grant calling it at all
--   DERIVATIONS  the replay returns the first call's own answer, unchanged;
--                a second, differently-keyed call is a second row; on_hand
--                going negative is reported, not blocked

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000003401','budi-seam@talaliving.com','{"full_name":"Budi Seam"}'),
  ('ffffffff-0000-0000-0000-000000003402','tamu-seam@talaliving.com','{"full_name":"Tamu Seam"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000003401','inventory','write'),
  ('ffffffff-0000-0000-0000-000000003402','inventory','read');

insert into ops_procure.items (code, name, category_code, base_uom) values
  ('KAYU-SEAM-01','Papan jati uji seam','raw-wood','lembar');

insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by) values
  ('KAYU-SEAM-01','GUDANG','receipt', 10,'lembar', 100000,'rcv-seam-01','ffffffff-0000-0000-0000-000000003401');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000003401';

/* ── REFUSAL: qty must be positive ─────────────────────────────────────── */
do $$
declare res jsonb;
begin
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 0, 'spk-seam-00', null, null);
  assert res ->> 'outcome' = 'refused', 'a zero qty should be refused, got ' || (res ->> 'outcome');
  assert res -> 'error' ->> 'code' = 'qty_invalid', 'wrong code: ' || (res -> 'error' ->> 'code');
end $$;

/* ── DERIVATION: the first call, and its own answer ────────────────────── */
do $$
declare res jsonb; move_no_1 text;
begin
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 3, 'spk-seam-01', null, 'k1');
  assert res ->> 'outcome' = 'ok', 'expected ok, got ' || (res ->> 'outcome') || ' / ' || (res -> 'error' ->> 'message');
  assert (res -> 'data' ->> 'on_hand_after')::numeric = 7, '10 - 3, got ' || (res -> 'data' ->> 'on_hand_after');
  assert (res -> 'data' ->> 'went_negative')::boolean = false, 'seven is not negative';
  move_no_1 := res -> 'data' ->> 'move_no';
  assert move_no_1 is not null and move_no_1 <> '', 'a real move number';

  -- The exact double tap this migration exists for: same key, same call.
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 3, 'spk-seam-01', null, 'k1');
  assert res ->> 'outcome' = 'duplicate', 'a replay reads as duplicate, got ' || (res ->> 'outcome');
  assert res -> 'data' ->> 'move_no' = move_no_1,
    'the replay is the FIRST call''s own answer, not a new row: ' || (res -> 'data' ->> 'move_no') || ' vs ' || move_no_1;
end $$;

do $$
declare n int;
begin
  select count(*) into n from ops_inv.stock_moves where item_code = 'KAYU-SEAM-01' and kind = 'issue';
  assert n = 1, 'one call replayed under the same key should still be one row, got ' || n;
end $$;

/* ── DERIVATION: a different key is a different call ───────────────────── */
do $$
declare res jsonb; n int;
begin
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 3, 'spk-seam-02', null, 'k2');
  assert res ->> 'outcome' = 'ok', 'expected ok, got ' || (res ->> 'outcome');
  assert (res -> 'data' ->> 'on_hand_after')::numeric = 4, '7 - 3, got ' || (res -> 'data' ->> 'on_hand_after');

  select count(*) into n from ops_inv.stock_moves where item_code = 'KAYU-SEAM-01' and kind = 'issue';
  assert n = 2, 'a genuinely different call is a second row, got ' || n;
end $$;

/* ── DERIVATION: going negative is reported, never refused (A6) ────────── */
do $$
declare res jsonb;
begin
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 20, 'spk-seam-03', null, 'k3');
  assert res ->> 'outcome' = 'ok', 'issuing more than on hand is allowed, got ' || (res ->> 'outcome');
  assert (res -> 'data' ->> 'on_hand_after')::numeric = -16, '4 - 20, got ' || (res -> 'data' ->> 'on_hand_after');
  assert (res -> 'data' ->> 'went_negative')::boolean = true, 'negative sixteen is negative';
end $$;

/* ── REFUSAL: a read grant cannot issue stock through the seam either ──── */
do $$
declare res jsonb;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000003402';
  res := ops_inv.issue_stock('KAYU-SEAM-01','GUDANG', 1, 'spk-seam-04', null, null);
  assert res ->> 'outcome' = 'refused', 'a read grant should be refused, got ' || (res ->> 'outcome');
  assert res -> 'error' ->> 'code' = 'not_permitted', 'wrong code: ' || (res -> 'error' ->> 'code');
end $$;

rollback;
