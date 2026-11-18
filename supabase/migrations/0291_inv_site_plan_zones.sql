-- 0291_inv_site_plan_zones.sql — the 2024 site plan's zones on the shared location list.
--
-- PT Talahome's site plan (Jepara, 25 Nov 2024, 1:350), which the owner
-- confirmed matches the building today, names the zones a checker walks to
-- (D447; `docs/handoff/inventory-verification/data/zones.csv`). The ones that
-- hold things — `holds_items` yes or maybe — join the one location list (D347)
-- so an asset can be placed in them. Yards and parking hold nothing and are
-- left off.
--
-- Additive only. `GUDANG`, `BENGKEL`, `FINISHING` and every location typed in
-- production stay as they are, and nothing is moved into a zone: how the old
-- rows map to the new zones is still the owner's to say (step 1 answer 2).
-- A code already present keeps its name.

insert into ops_inv.stock_locations (code, name) values
  ('PRD', 'Production'),
  ('FN1', 'Finishing 1'),
  ('FN2', 'Finishing 2'),
  ('OVN', 'Oven'),
  ('GD1', 'Warehouse 1 (front left)'),
  ('GD2', 'Warehouse 2 (front right)'),
  ('GD3', 'Warehouse 3 (small)'),
  ('GD4', 'Warehouse 4 (small)'),
  ('PKG', 'Packaging'),
  ('LOG', 'Logistics'),
  ('B1',  'Block 1 (storage + maintenance)'),
  ('B2',  'Block 2 (storage + maintenance)'),
  ('B3',  'Block 3 (storage + maintenance)'),
  ('KT1', 'Office (upper)'),
  ('KT2', 'Office (lower)'),
  ('R06', 'Shared break room'),
  ('MES', 'Staff housing')
on conflict (code) do nothing;

analyze ops_inv.stock_locations;
