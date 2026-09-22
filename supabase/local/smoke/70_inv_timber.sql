-- inv — a cubic metre of log is not a cubic metre of wood.
--
-- Worked out on paper first. Five sticks, 30 cm across and 3 m long, round:
--
--   log_m3        5 × π/4 × 0,30² × 3      = 1,0603 m³
--   sawn_logs_m3  tiga dari lima dibelah   = 0,6362 m³
--   sawn_m3       20 papan 3×20×300 cm     = 0,3600 m³
--   yield         0,36 / 0,6362            = 57%      (34% kalau dibagi seluruh load)
--   per m³ gergajian  12jt × 0,6 / 0,36    = 20.000.000  (33,3jt kalau dibagi seluruh faktur)
--
--   REFUSALS     a load with no invoice; the same paint mark twice; a board cut
--                from another load's stick; and no DELETE
--   DERIVATIONS  the six figures above; round against square (21% apart, Q39);
--                the seller's claim kept beside ours, never resolved; the nota
--                on the evidence road; and vendors compared **within a species**

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000002301','budi@talaliving.com','{"full_name":"Budi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000002301','inventory','write');
insert into ops_procure.vendors (code, name) values ('V-8001','Kayu Jaya');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-000000002301','a/nota.jpg','nota-kayu.jpg','ffffffff-0000-0000-0000-000000002301');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002301';

/* ── REFUSAL: without the invoice there is no price per m³ ─────────────── */
do $$
begin
  begin
    insert into ops_inv.log_purchases (vendor_code, received_on, species, total_cost, measure, created_by)
    values ('V-8001', current_date,'Jati', 0,'round','ffffffff-0000-0000-0000-000000002301');
    raise exception 'a load with no invoice should be refused — it is the only reason the record exists';
  exception when check_violation then null;
  end;
end $$;

insert into ops_inv.log_purchases
  (purchase_no, vendor_code, received_on, species, total_cost, claimed_m3, measure, created_by)
values ('kyu-uji-01','V-8001', current_date,'Jati', 12000000, 1.2,'round',
        'ffffffff-0000-0000-0000-000000002301');

insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm, sawn_on)
select p.id, 'L' || n, 30, 300, case when n <= 3 then current_date end
  from ops_inv.log_purchases p, generate_series(1, 5) n where p.purchase_no = 'kyu-uji-01';

insert into ops_inv.sawn_boards (purchase_id, thickness_mm, width_mm, length_mm, qty, sawn_on, grade)
select id, 30, 200, 3000, 20, current_date, 'A'
  from ops_inv.log_purchases where purchase_no = 'kyu-uji-01';

/* ── REFUSALS on the sticks and the boards ─────────────────────────────── */
do $$
declare pid uuid; other uuid; lid uuid;
begin
  select id into pid from ops_inv.log_purchases where purchase_no = 'kyu-uji-01';

  begin
    insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm)
    values (pid,'L1', 28, 280);
    raise exception 'the same paint mark twice should be refused — it identifies the stick';
  exception when unique_violation then null;
  end;

  -- A board cut from a stick that belongs to another load: both halves
  -- resolve, and the figure is wrong.
  insert into ops_inv.log_purchases (purchase_no, vendor_code, received_on, species, total_cost, measure, created_by)
  values ('kyu-uji-lain','V-8001', current_date,'Jati', 1000000,'round',
          'ffffffff-0000-0000-0000-000000002301') returning id into other;
  insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm)
  values (other,'X1', 25, 250) returning id into lid;

  begin
    insert into ops_inv.sawn_boards (purchase_id, log_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
    values (pid, lid, 30, 200, 3000, 1, current_date);
    raise exception 'a board from another load''s stick should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── DERIVATION: the six figures ───────────────────────────────────────── */
do $$
declare v record;
begin
  select * into v from ops_inv.v_log_purchase where purchase_no = 'kyu-uji-01';
  assert v.log_m3 = 1.0603,        '5 × π/4 × 0,30² × 3, got ' || v.log_m3;
  assert v.sawn_logs_m3 = 0.6362,  'three of the five, got ' || v.sawn_logs_m3;
  assert v.unsawn_m3 = 0.4241,     'two still in the yard, got ' || v.unsawn_m3;
  assert v.sawn_m3 = 0.3600,       '20 papan 3×20×300 cm, got ' || v.sawn_m3;

  /* **Over the logs actually sawn.** Dividing 0,36 by the whole 1,0603 gives
     34%, and reports the sawyer as getting a third of what he is getting. */
  assert v.yield_percent = 57,     '0,36 of the 0,6362 that met the saw, got ' || v.yield_percent;

  /* **Their share of the invoice**, not all of it. The two sticks still in the
     yard have not been paid for by this board: 12jt / 0,36 would price the
     wood at 33,3jt — half again too high. */
  assert v.cost_per_sawn_m3 = 20000000, '12jt × 0,6 ÷ 0,36, got ' || v.cost_per_sawn_m3;
  assert v.cost_per_log_m3 = 11317685,  '12jt ÷ 1,0603, got ' || v.cost_per_log_m3;

  -- The seller said 1,2 and we measured 1,0603. **Both numbers stay.** The
  -- difference is the conversation with the vendor, and resolving it into one
  -- figure loses the argument (D153).
  assert v.claimed_m3 = 1.2,       'what the seller said, got ' || v.claimed_m3;
  assert v.claimed_gap_m3 = -0.1397, 'and how far off it was, got ' || v.claimed_gap_m3;
end $$;

/* ── DERIVATION: round and square are a fifth of the wood apart (Q39) ──── */
do $$
declare a numeric; b numeric;
begin
  insert into ops_inv.log_purchases (purchase_no, vendor_code, received_on, species, total_cost, measure, created_by)
  values ('kyu-uji-sq','V-8001', current_date,'Jati', 12000000,'square',
          'ffffffff-0000-0000-0000-000000002301');
  insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm)
  select p.id, 'S' || n, 30, 300 from ops_inv.log_purchases p, generate_series(1, 5) n
   where p.purchase_no = 'kyu-uji-sq';

  select log_m3 into a from ops_inv.v_log_purchase where purchase_no = 'kyu-uji-01';
  select log_m3 into b from ops_inv.v_log_purchase where purchase_no = 'kyu-uji-sq';
  assert b = 1.3500, 'square is d² × L, got ' || b;
  -- A load measured one way and read the other is a fifth of the wood.
  assert round((1 - a / b) * 100) = 21, 'and the two are 21% apart, got ' || round((1 - a/b) * 100);
end $$;

/* ── DERIVATION: the nota arrives on the evidence road (D201, ADR-010) ─── */
do $$
declare v record;
begin
  select * into v from ops_inv.v_log_purchase where purchase_no = 'kyu-uji-01';
  -- Reported, never refused: a load that arrived is a fact whether or not the
  -- paper reached the office (A6).
  assert not v.has_nota, 'no nota yet, and the load is still recorded';

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values ('44440000-0000-0000-0000-000000002301','log_purchase','kyu-uji-01','nota',
          'ffffffff-0000-0000-0000-000000002301');

  select * into v from ops_inv.v_log_purchase where purchase_no = 'kyu-uji-01';
  assert v.has_nota, 'and the same road every nota takes brings it in';
end $$;

/* ── DERIVATION: one vendor, two species, two answers ──────────────────── */
do $$
declare jati record; mahoni record; v_rows int;
begin
  -- Cheaper wood from the same vendor. Averaged together it would make him
  -- look like a better supplier of jati than he is.
  insert into ops_inv.log_purchases (purchase_no, vendor_code, received_on, species, total_cost, measure, created_by)
  values ('kyu-uji-mh','V-8001', current_date,'Mahoni', 3000000,'round',
          'ffffffff-0000-0000-0000-000000002301');
  insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm, sawn_on)
  select p.id, 'M' || n, 30, 300, current_date
    from ops_inv.log_purchases p, generate_series(1, 2) n where p.purchase_no = 'kyu-uji-mh';
  insert into ops_inv.sawn_boards (purchase_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
  select id, 30, 200, 3000, 10, current_date
    from ops_inv.log_purchases where purchase_no = 'kyu-uji-mh';

  -- **Two rows for one vendor**, and that is the assertion: grouping by vendor
  -- alone collapses them into an average that is right about neither wood.
  select count(*) into v_rows from ops_inv.v_timber_by_vendor where vendor_code = 'V-8001';
  assert v_rows = 2, 'one row per species, got ' || v_rows;

  select * into jati   from ops_inv.v_timber_by_vendor where vendor_code = 'V-8001' and species = 'Jati';
  select * into mahoni from ops_inv.v_timber_by_vendor where vendor_code = 'V-8001' and species = 'Mahoni';

  assert jati.vendor_name = 'Kayu Jaya', 'named by code at the seam, got ' || coalesce(jati.vendor_name,'(null)');
  assert mahoni.cost_per_sawn_m3 = 16666667, 'mahoni at 3jt ÷ 0,18, got ' || mahoni.cost_per_sawn_m3;
  -- One vendor's mahoni against another's jati is two different woods.
  -- Averaged, this vendor would read 18,9jt for both and be right about
  -- neither.
  assert jati.cost_per_sawn_m3 <> mahoni.cost_per_sawn_m3,
    'the two woods keep their own figures';
  assert mahoni.yield_percent = 42, 'and their own yields, got ' || mahoni.yield_percent;
end $$;

/* ── REFUSAL: a stick that was never there is a row somebody explains ──── */
do $$
begin
  begin
    delete from ops_inv.log_pieces where tag = 'L1';
    raise exception 'deleting a measured stick should be refused (A2)';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
