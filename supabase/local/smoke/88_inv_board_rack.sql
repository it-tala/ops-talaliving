-- inv — the board rack (0094) and receiving a load atomically (0095).
--
-- Worked on paper:
--
--   purchase A   1 log, 1×1×1 m (square) = 1,0000 m³, Rp 10.000.000, fully
--                sawn into 5 boards of 0,1 m³ each = 0,5 m³
--                cost_per_sawn_m3 = 10.000.000 × (1,0/1,0) / 0,5 = 20.000.000
--
--   after an unattributed issue of 2: rack holds 3 of 5, valued qty is still
--   5 (the issue carries no purchase_id, so it does not enter the weighted
--   average — the same shape as an issue nobody has to price), share =
--   min(3,5)/5 = 0,6, value = round(0,1 × 20.000.000 × 5 × 0,6) = 6.000.000
--
--   REFUSALS     issuing more than the rack holds (D205, the one hard block
--                in this module); an issue with no ref_no; an adjustment
--                with no reason
--   DERIVATIONS  the arithmetic above; `receive_logs` writing a purchase, its
--                logs and its boards in one transaction

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccc0000-0000-0000-0000-000000008801','wati@talaliving.com','{"full_name":"Wati"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('cccc0000-0000-0000-0000-000000008801','inventory','write');
insert into ops_procure.vendors (code, name) values ('V-8801','Kayu Makmur');

set local role authenticated;
set local request.jwt.claim.sub = 'cccc0000-0000-0000-0000-000000008801';

/* ── purchase A: one log, fully sawn ─────────────────────────────────────── */
insert into ops_inv.log_purchases (id, vendor_code, received_on, species, total_cost, measure, created_by)
values ('dddd0000-0000-0000-0000-000000008801','V-8801','2026-09-01','Jati',10000000,'square',
        'cccc0000-0000-0000-0000-000000008801');
insert into ops_inv.log_pieces (id, purchase_id, tag, diameter_cm, length_cm, sawn_on)
values ('eeee0000-0000-0000-0000-000000008801','dddd0000-0000-0000-0000-000000008801','#1',100,100,'2026-09-02');
insert into ops_inv.sawn_boards (purchase_id, log_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
values ('dddd0000-0000-0000-0000-000000008801','eeee0000-0000-0000-0000-000000008801',100,1000,1000,5,'2026-09-02');

/* ── DERIVATION: v_log_purchase's own cost_per_sawn_m3 (the input to
      v_board_stock's valuation) ────────────────────────────────────────── */
do $$
declare v ops_inv.v_log_purchase;
begin
  select * into v from ops_inv.v_log_purchase where id = 'dddd0000-0000-0000-0000-000000008801';
  assert v.log_m3 = 1.0, format('log_m3, got %s', v.log_m3);
  assert v.sawn_m3 = 0.5, format('sawn_m3, got %s', v.sawn_m3);
  assert v.cost_per_sawn_m3 = 20000000, format('cost_per_sawn_m3, got %s', v.cost_per_sawn_m3);
end $$;

/* ── DERIVATION: the rack before anything moves ──────────────────────────── */
do $$
declare s ops_inv.v_board_stock;
begin
  select * into s from ops_inv.v_board_stock where board_key = 'Jati|100x1000x1000';
  assert s.qty = 5, format('qty before any move, got %s', s.qty);
  assert s.sawn_total = 5, format('sawn_total, got %s', s.sawn_total);
  assert s.avg_cost_per_m3 = 20000000, format('avg_cost_per_m3, got %s', s.avg_cost_per_m3);
  assert s.value = 10000000, format('value (0,1 * 20jt * 5, full share), got %s', s.value);
  assert s.unpriced_qty = 0, format('unpriced_qty, got %s', s.unpriced_qty);
end $$;

/* ── REFUSALS on move_boards ──────────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_inv.move_boards('Jati|100x1000x1000', 'issue', 2, null, null, null);
  assert r -> 'error' ->> 'code' = 'ref_required', format('issue with no ref_no, got %s', r);

  r := ops_inv.move_boards('Jati|100x1000x1000', 'adjust', 1, null, null, null);
  assert r -> 'error' ->> 'code' = 'reason_required', format('adjust with no reason, got %s', r);

  r := ops_inv.move_boards('Jati|100x1000x1000', 'issue', 99, 'spk-9999', null, null);
  assert r -> 'error' ->> 'code' = 'not_enough_boards', format('over-issue, got %s', r);
  assert (r -> 'error' -> 'detail' ->> 'on_hand')::numeric = 5, format('on_hand in the refusal, got %s', r);

  r := ops_inv.move_boards('Jati|999x999x999', 'issue', 1, 'spk-1', null, null);
  assert (r -> 'error' ->> 'status')::int = 404, format('a size nobody has sawn, got %s', r);
end $$;

/* ── an unattributed issue of 2 — no purchase_no, so it never enters the
      weighted average (matches an unpriced move leaving no trace on the
      figure it cannot inform) ──────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_inv.move_boards('Jati|100x1000x1000', 'issue', 2, 'spk-100', null, null);
  assert r ->> 'outcome' = 'ok', format('issue failed, got %s', r);
end $$;

do $$
declare s ops_inv.v_board_stock;
begin
  select * into s from ops_inv.v_board_stock where board_key = 'Jati|100x1000x1000';
  assert s.qty = 3, format('qty after issuing 2 of 5, got %s', s.qty);
  assert s.issued_total = 2, format('issued_total, got %s', s.issued_total);
  assert s.avg_cost_per_m3 = 20000000, format('avg_cost_per_m3 unchanged by an unattributed issue, got %s', s.avg_cost_per_m3);
  assert s.value = 6000000, format('value (0,1 * 20jt * 5 * (3/5) share), got %s', s.value);
end $$;

/* ── the board_moves row itself: kept, signed, with a reason and a
      moved_by, the same append-only posture as stock_moves (0071) ──────── */
set local role postgres;
do $$
declare m ops_inv.board_moves;
begin
  select * into m from ops_inv.board_moves where ref_no = 'spk-100';
  assert m.qty = -2, format('issue stored negative, got %s', m.qty);
  assert m.purchase_id is null, format('unattributed issue keeps purchase_id null (D204), got %s', m.purchase_id);
end $$;
set local role authenticated;

/* ── receive_logs: a purchase, its logs and its boards in one call ──────── */
do $$
declare r jsonb; v_no text; n_logs int; n_boards int;
begin
  r := ops_inv.receive_logs(
    'V-8801', '2026-09-10', 'Mahoni', 5000000, null, 'round', null, null, 'Dari nota',
    jsonb_build_array(jsonb_build_object('tag','#1','diameter_cm',30,'length_cm',250)),
    jsonb_build_array(jsonb_build_object('thickness_mm',25,'width_mm',150,'length_mm',2000,'qty',8,'grade','A')),
    'nota-9001');
  assert r ->> 'outcome' = 'ok', format('receive_logs failed, got %s', r);
  v_no := r -> 'data' ->> 'purchase_no';

  select count(*) into n_logs from ops_inv.log_pieces lp
    join ops_inv.log_purchases p on p.id = lp.purchase_id where p.purchase_no = v_no;
  select count(*) into n_boards from ops_inv.sawn_boards sb
    join ops_inv.log_purchases p on p.id = sb.purchase_id where p.purchase_no = v_no;
  assert n_logs = 1, format('one log written with the purchase, got %s', n_logs);
  assert n_boards = 1, format('one board row written with the purchase, got %s', n_boards);

  -- Idempotent: the same key replays the same purchase rather than minting
  -- a second one.
  r := ops_inv.receive_logs(
    'V-8801', '2026-09-10', 'Mahoni', 5000000, null, 'round', null, null, 'Dari nota',
    jsonb_build_array(jsonb_build_object('tag','#1','diameter_cm',30,'length_cm',250)),
    jsonb_build_array(jsonb_build_object('thickness_mm',25,'width_mm',150,'length_mm',2000,'qty',8,'grade','A')),
    'nota-9001');
  assert r -> 'data' ->> 'purchase_no' = v_no, format('replay should answer the same purchase, got %s', r);
end $$;

set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_inv.log_purchases where species = 'Mahoni' and vendor_code = 'V-8801';
  assert n = 1, format('the replay must not have minted a second purchase, got %s', n);
end $$;
set local role authenticated;

rollback;
