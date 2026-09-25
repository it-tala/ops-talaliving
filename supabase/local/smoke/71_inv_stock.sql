-- inv — the rack, and the quantity column that is not here.
--
-- Worked out first, one item:
--
--   receipt 10 @ 150.000      GUDANG
--   receipt  5 tanpa harga    GUDANG
--   issue   -4                GUDANG
--   pindah  -3 GUDANG / +3 BENGKEL      (dua baris, satu perpindahan)
--
--   on_hand       10 + 5 − 4 − 3 + 3 = 11
--   avg_cost      1.500.000 ÷ 10     = 150.000   (yang 5 tanpa harga tidak ikut)
--   unpriced_qty  5
--   value         150.000 × (11 − 5) = 900.000   (bukan × 11)
--
--   REFUSALS     a zero move; an adjustment with no sentence; a receipt that
--                removes and an issue that adds; a unit cost of nought; the
--                same delivery twice; an adjustment without the permission;
--                and no UPDATE or DELETE at all
--   DERIVATIONS  on-hand from the moves alone; per location; the average over
--                **priced incoming** only; the value over the part that has a
--                price; an unstated minimum that is not a satisfied one; an
--                item that never moved still on the list; and one that is not
--                stock at all left off it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000003301','budi@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000003302','tamu@talaliving.com','{"full_name":"Tamu"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000003301','inventory','write'),
  ('ffffffff-0000-0000-0000-000000003302','inventory','read');

-- The JO the issues below are written against. Since 0171 an issue whose
-- ref reads like a JO must name one that exists (D312, after F86).
insert into ops_prod.work_orders (wo_no, item_name, qty, uom, route, due_date) values
  ('spk-26-09-03_01', 'Uji', 1, 'unit', 'IN_HOUSE', current_date + 7);

insert into ops_procure.items (code, name, category_code, base_uom) values
  ('KAYU-01','Papan jati 3cm','raw-wood','lembar'),
  ('SEKRUP-01','Sekrup 4x40','hardware','pcs'),
  ('JASA-01','Ongkos kirim','service','unit');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000003301';

/* ── REFUSALS on the move itself ───────────────────────────────────────── */
do $$
begin
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
    values ('KAYU-01','GUDANG','receipt', 0,'lembar','ffffffff-0000-0000-0000-000000003301');
    raise exception 'a zero move should be refused';
  exception when check_violation then null;
  end;

  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
    values ('KAYU-01','GUDANG','adjust', -2,'lembar','ffffffff-0000-0000-0000-000000003301');
    raise exception 'an adjustment with no sentence should be refused — the sentence IS the record';
  exception when check_violation then null;
  end;

  -- A receipt that removes and an issue that adds are a rack that disagrees
  -- with the floor, and neither has a reading where the sign makes sense.
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
    values ('KAYU-01','GUDANG','receipt', -5,'lembar','ffffffff-0000-0000-0000-000000003301');
    raise exception 'a receipt that removes stock should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
    values ('KAYU-01','GUDANG','issue', 5,'lembar','ffffffff-0000-0000-0000-000000003301');
    raise exception 'an issue that adds stock should be refused';
  exception when check_violation then null;
  end;

  -- Zero would quietly value the rack down; unpriced is `null` and says so.
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, moved_by)
    values ('KAYU-01','GUDANG','receipt', 5,'lembar', 0,'ffffffff-0000-0000-0000-000000003301');
    raise exception 'a unit cost of nought should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── the four movements ────────────────────────────────────────────────── */
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by) values
  ('KAYU-01','GUDANG','receipt', 10,'lembar', 150000,'rcv-26-09-01_01','ffffffff-0000-0000-0000-000000003301'),
  ('KAYU-01','GUDANG','receipt',  5,'lembar', null,   'rcv-26-09-02_01','ffffffff-0000-0000-0000-000000003301'),
  ('KAYU-01','GUDANG','issue',   -4,'lembar', null,   'spk-26-09-03_01','ffffffff-0000-0000-0000-000000003301');
-- A transfer is **two rows**, so each location's own history reads correctly
-- on its own.
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, moved_by) values
  ('KAYU-01','GUDANG', 'transfer', -3,'lembar','pindah-01','ffffffff-0000-0000-0000-000000003301'),
  ('KAYU-01','BENGKEL','transfer',  3,'lembar','pindah-01','ffffffff-0000-0000-0000-000000003301');

/* ── REFUSAL: confirming the same delivery twice stocks it once ────────── */
do $$
begin
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by)
    values ('KAYU-01','GUDANG','receipt', 10,'lembar', 150000,'rcv-26-09-01_01',
            'ffffffff-0000-0000-0000-000000003301');
    raise exception 'the same receipt twice should be refused (D170)';
  exception when unique_violation then null;
  end;
end $$;

/* ── DERIVATION: on-hand comes from the moves, and nowhere else ────────── */
do $$
declare v record; g numeric; b numeric;
begin
  select * into v from ops_inv.v_stock_item where item_code = 'KAYU-01';
  assert v.on_hand = 11,      '10 + 5 − 4 − 3 + 3, got ' || v.on_hand;

  select qty into g from ops_inv.v_stock_by_location where item_code = 'KAYU-01' and location = 'GUDANG';
  select qty into b from ops_inv.v_stock_by_location where item_code = 'KAYU-01' and location = 'BENGKEL';
  assert g = 8, 'the gudang kept eight, got ' || g;
  assert b = 3, 'and three walked to the bengkel, got ' || b;

  /* The average is over the **priced incoming** moves only. The five that
     arrived unpriced are counted as stock and left out of the average rather
     than valued at nought (D172), and the transfer carries no price at all. */
  assert v.avg_cost = 150000,  '1.500.000 ÷ 10, got ' || coalesce(v.avg_cost::text,'(null)');
  assert v.unpriced_qty = 5,   'five arrived with no price, got ' || v.unpriced_qty;
  -- **Incomplete, not wrong.** Valuing all eleven at 150.000 would invent
  -- 750.000 of stock nobody has a nota for.
  assert v.value = 900000,     '150.000 × (11 − 5), got ' || coalesce(v.value::text,'(null)');
  assert v.moves_count = 5,    'five rows of history, got ' || v.moves_count;
end $$;

/* ── DERIVATION: an unstated minimum is not a satisfied one ────────────── */
do $$
declare v record;
begin
  select * into v from ops_inv.v_stock_item where item_code = 'KAYU-01';
  assert v.min_qty is null, 'nobody has set one yet';
  assert not v.below_min,   'and that is not the same as being in good order — it is unknown';

  insert into ops_inv.stock_settings (item_code, min_qty, home_location)
  values ('KAYU-01', 15,'GUDANG');
  select * into v from ops_inv.v_stock_item where item_code = 'KAYU-01';
  assert v.below_min, 'eleven is under fifteen';
end $$;

/* ── DERIVATION: never moved is on the list; never stocked is not ──────── */
do $$
declare v record; n int;
begin
  -- *We have none* and *nobody has ever bought this* look identical on a
  -- screen that hides the second, and they lead to opposite actions.
  select * into v from ops_inv.v_stock_item where item_code = 'SEKRUP-01';
  assert v.on_hand = 0,      'none on the rack, got ' || v.on_hand;
  assert v.moves_count = 0,  'and no history at all, got ' || v.moves_count;
  assert v.avg_cost is null, 'so nothing to value it at';

  -- An ongkos kirim is bought and gone the same day; it is not stock (D169).
  select count(*) into n from ops_inv.v_stock_item where item_code = 'JASA-01';
  assert n = 0, 'a service is not on a rack, got ' || n;
end $$;

/* ── REFUSAL: a mistake is another move, never an edit ─────────────────── */
do $$
declare n int;
begin
  begin
    update ops_inv.stock_moves set qty = 99 where item_code = 'KAYU-01';
    raise exception 'editing a move should be refused (A5, D171)';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from ops_inv.stock_moves where item_code = 'KAYU-01';
    raise exception 'deleting a move should be refused';
  exception when insufficient_privilege then null;
  end;

  -- The correction is a move of its own, with its sentence.
  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
  values ('KAYU-01','GUDANG','adjust', -1,'lembar','opname 18 Sep: satu lembar pecah',
          'ffffffff-0000-0000-0000-000000003301');
  select on_hand into n from ops_inv.v_stock_item where item_code = 'KAYU-01';
  assert n = 10, 'and the rack follows its own history, got ' || n;
end $$;

/* ── REFUSAL: reading the rack is not moving it ────────────────────────── */
do $$
declare n int;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000003302';
  select count(*) into n from ops_inv.v_stock_item;
  assert n = 2, 'a read grant sees the rack, got ' || n;

  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
    values ('KAYU-01','GUDANG','adjust', -5,'lembar','katanya kurang',
            'ffffffff-0000-0000-0000-000000003302');
    raise exception 'a read grant should not be able to adjust the rack';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
