-- 0232 — the two reads John Lau's capture bot makes.
--
-- Derivations: the catalogue is curated and live only; a balance is the
-- ledger screen's own figure. Refusals: a leadership account's figure is
-- withheld, and neither the browser key nor a signed-in user can call either.
begin;

insert into ops_procure.vendors (id, code, name, is_curated, aka) values
  ('23200000-0000-0000-0000-000000000001', 'V-2321', 'TOKO KURASI',   true,  '{"TK KURASI"}'),
  ('23200000-0000-0000-0000-000000000002', 'V-2322', 'TOKO MENTAH',   false, '{}'),
  ('23200000-0000-0000-0000-000000000003', 'V-2323', 'TOKO TERSERAP', true,  '{}');
update ops_procure.vendors set merged_into = '23200000-0000-0000-0000-000000000001'
 where id = '23200000-0000-0000-0000-000000000003';

insert into ops_procure.items (id, code, name, category_code, base_uom, kind, is_curated) values
  ('23200000-0000-0000-0000-0000000000a1', 'I-2321', 'Plywood 232', 'raw-wood', 'lembar', 'goods', true),
  ('23200000-0000-0000-0000-0000000000a2', 'I-2322', 'Barang mentah 232', 'raw-wood', 'lembar', 'goods', false);

insert into ops_procure.projects (id, code, name, is_active) values
  ('23200000-0000-0000-0000-0000000000b1', '23201', 'PROYEK AKTIF 232', true),
  ('23200000-0000-0000-0000-0000000000b2', '23202', 'PROYEK SELESAI 232', false);

-- ── 1. the catalogue: curated and live only ──────────────────────────────
do $$
declare r jsonb := ops_procure.extraction_reference();
begin
  assert r->'vendors' @> '[{"name":"TOKO KURASI","aka":["TK KURASI"]}]',
    'a curated vendor must be listed with its aliases: ' || (r->'vendors')::text;
  assert not (r->'vendors' @> '[{"name":"TOKO MENTAH"}]'),
    'an uncurated vendor must not reach the prompt';
  assert not (r->'vendors' @> '[{"name":"TOKO TERSERAP"}]'),
    'a vendor merged into another must not be listed — the survivor carries the name';
  assert r->'items' @> '[{"name":"Plywood 232","category":"raw-wood","unit":"lembar"}]',
    'a curated item must be listed with its category and unit';
  assert not (r->'items' @> '[{"name":"Barang mentah 232"}]'),
    'an uncurated item must not reach the prompt';
  assert r->'projects' @> '["PROYEK AKTIF 232"]' and not (r->'projects' @> '["PROYEK SELESAI 232"]'),
    'only active projects are named: ' || (r->'projects')::text;
end $$;

-- ── 2. balances: the screen's figure, leadership withheld (D87) ──────────
update ops_acct.accounts set opening_balance = 1250000 where code = 'PETTY CASH';
do $$
declare
  b    jsonb := ops_acct.bot_balances();
  cash jsonb;
  boss jsonb;
begin
  select e into cash from jsonb_array_elements(b) e where e->>'code' = 'PETTY CASH';
  select e into boss from jsonb_array_elements(b) e where e->>'code' = 'BCA 064';
  assert (cash->>'balance')::numeric = (select balance from ops_acct.v_account_balance where code = 'PETTY CASH'),
    'the card must read the same balance the ledger screen does, opening balance included';
  assert (cash->>'balance')::numeric >= 1250000 and not (cash->>'locked')::boolean,
    'an accounting account carries its figure: ' || cash::text;
  assert (boss->>'locked')::boolean and boss->'balance' = 'null'::jsonb,
    'a leadership account is listed with its figure withheld: ' || boss::text;
end $$;

-- ── 3. only the worker may call either ───────────────────────────────────
do $$
begin
  assert has_function_privilege('service_role', 'ops_procure.extraction_reference()', 'EXECUTE'),
    'the worker must be able to read the catalogue';
  assert has_function_privilege('service_role', 'ops_acct.bot_balances()', 'EXECUTE'),
    'the worker must be able to read balances';
  assert not has_function_privilege('anon', 'ops_procure.extraction_reference()', 'EXECUTE')
     and not has_function_privilege('anon', 'ops_acct.bot_balances()', 'EXECUTE'),
    'the browser key must not reach either';
  assert not has_function_privilege('authenticated', 'ops_procure.extraction_reference()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'ops_acct.bot_balances()', 'EXECUTE'),
    'a signed-in user must not reach either — bot_balances withholds by custody, not by the caller''s authority';
end $$;

rollback;
