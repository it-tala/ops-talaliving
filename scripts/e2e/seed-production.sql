-- People and reference data for the production walk (scripts/e2e/walk-production.mjs),
-- on top of seed-procurement.sql. The same roles as 99_sim_production_to_handover:
--   Ryan   — sales / PM: project write (klien, proyek, quotation, BAST)
--   Wayan  — PPIC / mandor: production write, procurement write, project read, hrd read
--   Komang — pengiriman: delivery write, production read, project read
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2e00000-0000-0000-0000-0000000007a1','ryan@talaliving.com','{"full_name":"Ryan Pratama"}'),
  ('e2e00000-0000-0000-0000-0000000007b2','wayan@talaliving.com','{"full_name":"Wayan Sudarma"}'),
  ('e2e00000-0000-0000-0000-0000000007c3','komang@talaliving.com','{"full_name":"Komang Adi"}')
on conflict do nothing;
insert into ops_core.user_modules (user_id, module, level) values
  ('e2e00000-0000-0000-0000-0000000007a1','project','write'),
  ('e2e00000-0000-0000-0000-0000000007a1','production','read'),
  ('e2e00000-0000-0000-0000-0000000007b2','production','write'),
  ('e2e00000-0000-0000-0000-0000000007b2','procurement','write'),
  ('e2e00000-0000-0000-0000-0000000007b2','project','read'),
  ('e2e00000-0000-0000-0000-0000000007b2','hrd','read'),
  ('e2e00000-0000-0000-0000-0000000007c3','delivery','write'),
  ('e2e00000-0000-0000-0000-0000000007c3','production','read'),
  ('e2e00000-0000-0000-0000-0000000007c3','project','read')
on conflict do nothing;

-- The items a BOM is built from and a finishing vendor: master data is
-- procurement's walk, and this one starts from a database that has it.
insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('E2E-JATI','Kayu jati kering','raw-wood','m3', 5000000, 4800000),
  ('E2E-CAT','Cat PU clear','finishing','ltr', 85000, 80000)
on conflict do nothing;
insert into ops_procure.vendors (code, name, is_curated) values ('V-E2EFIN','CV FINISHING SIMULASI', true)
on conflict do nothing;
