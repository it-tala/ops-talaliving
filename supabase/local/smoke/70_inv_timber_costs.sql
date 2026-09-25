-- inv — what the wood cost once it was on the rack (0156).
--
-- Worked out on paper first.
--
--   kyu-bc-01  Jati 12jt, 5 × Ø30 × 300 round, three sawn, 20 papan 3×20×300
--              + angkut 1,2jt (nota truk) + potong 0,6jt (nota sawmill)
--     landed          12 + 1,2 + 0,6                  = 13.800.000
--     per m³ papan    13,8jt × 0,6 ÷ 0,36             = 23.000.000   (kayu saja 20jt)
--     m² papan        20 × 0,20 × 3,00                = 12 m²
--     per m² papan    13,8jt × 0,6 ÷ 12               = 690.000
--
--   kyu-bc-02  Jati bought **as boards**: 10 papan 3×20×300, 5,4jt + angkut 0,6jt
--     per m³ papan    5,4jt ÷ 0,18                    = 30.000.000   (was: nothing)
--     landed per m³   6jt ÷ 0,18                      = 33.333.333
--     landed per m²   6jt ÷ 6                         = 1.000.000
--
--   kyu-bc-03  Mahoni, 2 × Ø30 × 300, boards reported as a pile, no log marked
--     yield           0,18 ÷ 0,4241                   = 42%          (was: nothing)
--     per m³ papan    3jt ÷ 0,18                      = 16.666.667   (was: 0)
--
--   REFUSALS     an unknown kind; a cost of nothing; and no DELETE
--   DERIVATIONS  the figures above; the cost's own nota never counts as the
--                load's; the vendor rollup sums the costs and keeps species apart

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000002302','sari@talaliving.com','{"full_name":"Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000002302','inventory','write');
insert into ops_procure.vendors (code, name) values ('V-8002','Jati Makmur');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-000000002302','a/truk.jpg','nota-truk.jpg','ffffffff-0000-0000-0000-000000002302');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002302';

insert into ops_inv.log_purchases (purchase_no, vendor_code, received_on, species, total_cost, measure)
values ('kyu-bc-01','V-8002', current_date,'Jati', 12000000,'round'),
       ('kyu-bc-02','V-8002', current_date,'Jati',  5400000,'round'),
       ('kyu-bc-03','V-8002', current_date,'Mahoni', 3000000,'round');

insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm, sawn_on)
select p.id, 'L' || n, 30, 300, case when n <= 3 then current_date end
  from ops_inv.log_purchases p, generate_series(1, 5) n where p.purchase_no = 'kyu-bc-01';
insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm)
select p.id, 'M' || n, 30, 300
  from ops_inv.log_purchases p, generate_series(1, 2) n where p.purchase_no = 'kyu-bc-03';

insert into ops_inv.sawn_boards (purchase_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
select id, 30, 200, 3000, case purchase_no when 'kyu-bc-01' then 20 else 10 end, current_date
  from ops_inv.log_purchases where purchase_no in ('kyu-bc-01','kyu-bc-02','kyu-bc-03');

/* ── REFUSALS ──────────────────────────────────────────────────────────── */
do $$
declare pid uuid;
begin
  select id into pid from ops_inv.log_purchases where purchase_no = 'kyu-bc-01';
  begin
    insert into ops_inv.log_costs (purchase_id, kind, amount, incurred_on)
    values (pid, 'makan', 50000, current_date);
    raise exception 'a kind outside the four should be refused — `lain` with a note carries the rest';
  exception when check_violation then null;
  end;
  begin
    insert into ops_inv.log_costs (purchase_id, kind, amount, incurred_on)
    values (pid, 'angkut', 0, current_date);
    raise exception 'a cost of nothing should be refused';
  exception when check_violation then null;
  end;
end $$;

insert into ops_inv.log_costs (cost_no, purchase_id, kind, amount, incurred_on, payee)
select 'kyb-uji-01', id, 'angkut', 1200000, current_date, 'Pak Darto (truk)'
  from ops_inv.log_purchases where purchase_no = 'kyu-bc-01';
insert into ops_inv.log_costs (purchase_id, kind, amount, incurred_on, payee)
select id, 'potong', 600000, current_date, 'Sawmill Sinar'
  from ops_inv.log_purchases where purchase_no = 'kyu-bc-01';
insert into ops_inv.log_costs (purchase_id, kind, amount, incurred_on)
select id, 'angkut', 600000, current_date
  from ops_inv.log_purchases where purchase_no = 'kyu-bc-02';

/* ── DERIVATION: a load with its costs ─────────────────────────────────── */
do $$
declare v record;
begin
  select * into v from ops_inv.v_log_purchase where purchase_no = 'kyu-bc-01';
  assert v.cost_per_sawn_m3 = 20000000,  'the wood alone is still 20jt, got ' || v.cost_per_sawn_m3;
  assert v.cost_angkut = 1200000 and v.cost_potong = 600000, 'the two notas, by kind';
  assert v.extra_cost = 1800000,         'costs beyond the invoice, got ' || v.extra_cost;
  assert v.landed_cost = 13800000,       'and the whole bill, got ' || v.landed_cost;
  assert v.total_cost = 12000000,        'the timber invoice is never rewritten';
  assert v.sawn_m2 = 12,                 '20 × 0,20 × 3,00, got ' || v.sawn_m2;
  assert v.landed_cost_per_sawn_m3 = 23000000, '13,8jt × 0,6 ÷ 0,36, got ' || v.landed_cost_per_sawn_m3;
  assert v.landed_cost_per_sawn_m2 = 690000,   '13,8jt × 0,6 ÷ 12, got ' || v.landed_cost_per_sawn_m2;
  assert v.landed_cost_per_log_m3 = 13015338,  '13,8jt ÷ 1,06029 (unrounded), got ' || v.landed_cost_per_log_m3;
end $$;

/* ── DERIVATION: bought as boards, and sawn as a pile ──────────────────── */
do $$
declare b record; c record;
begin
  select * into b from ops_inv.v_log_purchase where purchase_no = 'kyu-bc-02';
  assert b.log_m3 = 0 and b.yield_percent is null, 'no logs, so no yield';
  assert b.cost_per_sawn_m3 = 30000000,        'the whole invoice is its boards, got ' || coalesce(b.cost_per_sawn_m3::text,'(null)');
  assert b.landed_cost_per_sawn_m3 = 33333333, 'with the truck, got ' || b.landed_cost_per_sawn_m3;
  assert b.landed_cost_per_sawn_m2 = 1000000,  '6jt ÷ 6 m², got ' || b.landed_cost_per_sawn_m2;
  assert b.unsawn_m3 = 0,                      'nothing waiting in the yard';

  select * into c from ops_inv.v_log_purchase where purchase_no = 'kyu-bc-03';
  assert c.yield_percent = 42,          'a pile means the load was sawn, got ' || coalesce(c.yield_percent::text,'(null)');
  assert c.cost_per_sawn_m3 = 16666667, '3jt ÷ 0,18, got ' || coalesce(c.cost_per_sawn_m3::text,'(null)');
  assert c.unsawn_m3 = 0,               'and nothing is left unsawn, got ' || c.unsawn_m3;
  assert c.extra_cost = 0 and c.landed_cost = c.total_cost, 'no costs is not a null';
end $$;

/* ── DERIVATION: the truck's nota is not the load's nota ───────────────── */
do $$
declare v record;
begin
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values ('44440000-0000-0000-0000-000000002302','log_cost','kyb-uji-01','nota',
          'ffffffff-0000-0000-0000-000000002302');
  select * into v from ops_inv.v_log_purchase where purchase_no = 'kyu-bc-01';
  assert not v.has_nota, 'a transport nota does not stand in for the timber seller''s';
end $$;

/* ── DERIVATION: per vendor, per species, with the costs ───────────────── */
do $$
declare j record; m record;
begin
  select * into j from ops_inv.v_timber_by_vendor where vendor_code = 'V-8002' and species = 'Jati';
  select * into m from ops_inv.v_timber_by_vendor where vendor_code = 'V-8002' and species = 'Mahoni';
  assert j.loads = 2,                  'the board-only load is counted, got ' || j.loads;
  assert j.cost_angkut = 1800000,      'both trucks, got ' || j.cost_angkut;
  assert j.cost_potong = 600000,       'one sawmill, got ' || j.cost_potong;
  assert j.landed_cost = 19800000,     '13,8 + 6, got ' || j.landed_cost;
  assert j.sawn_m2 = 18,               '12 + 6, got ' || j.sawn_m2;
  -- (23jt × 0,36 + 33,33jt × 0,18) ÷ 0,54
  assert j.landed_cost_per_sawn_m3 = 26444444, 'weighted by board volume, got ' || j.landed_cost_per_sawn_m3;
  -- (690rb × 12 + 1jt × 6) ÷ 18
  assert j.landed_cost_per_sawn_m2 = 793333,   'weighted by board face, got ' || j.landed_cost_per_sawn_m2;
  assert j.yield_percent = 57,         'the board-only load has no yield to lend, got ' || j.yield_percent;
  assert m.yield_percent = 42 and m.extra_cost = 0, 'mahoni keeps its own row';
end $$;

/* ── REFUSAL: a cost somebody paid is a row somebody explains (A2) ─────── */
do $$
begin
  begin
    delete from ops_inv.log_costs where cost_no = 'kyb-uji-01';
    raise exception 'deleting a cost should be refused (A2)';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
