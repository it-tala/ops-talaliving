-- prod — the business's estimating norms and finishing recipes, read (0193, D338).
--
--   READ         production (read) sees the norms and the recipes; a person
--                with every procurement right and no production sees none —
--                an empty list, not an error; anon reaches neither table nor
--                either view; nobody signed in can write a row
--   DERIVATIONS  `v_bom_norm` leaves out a norm whose date has not arrived and
--                keeps one with no value; `v_finishing_system` totals a
--                system's steps, sums its optional step apart, counts an
--                unpriced step, lists the optional step last, and names the
--                active rate that already carries it — and only the active one
--
-- Worked out first, with production's own figures (2026-09-25):
--   NC natural   abrasives 9.200 + sealer 13.111 + thinner 4.667
--                + topcoat 22.940 + bleach (optional) 10.000     = 59.918 / m²
--                optional part                                   = 10.000 / m²
--   PU / duco    primer 20.812 + colour 32.925 + filler (unpriced) = 53.737 / m²

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000c921','estimator-norms@talaliving.com','{"full_name":"Estimator"}'),
  ('ffffffff-0000-0000-0000-00000000c922','floor-norms@talaliving.com','{"full_name":"Floor reader"}'),
  ('ffffffff-0000-0000-0000-00000000c923','buyer-norms@talaliving.com','{"full_name":"Buyer"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000c921','production','write'),
  ('ffffffff-0000-0000-0000-00000000c922','production','read'),
  ('ffffffff-0000-0000-0000-00000000c923','procurement','admin');

insert into ops_prod.bom_norms (category, norm, value, unit, basis, remarks, source_kind, effective_on) values
  ('smoke-Panel', 'Plywood cutting waste', 12, '%', 'Industry norm 10-15% (nesting)', null, 'industry', '2026-09-25'),
  ('smoke-Wood',  'Square to finished component yield', 80, '%', 'Industry norm', null, 'industry', '2026-09-25'),
  ('smoke-Packing', 'Packing material per m³ product', null, '', 'Turunkan dari packing list', 'Perlu dihitung per item', 'empirical', '2026-09-25'),
  ('smoke-Future', 'Not yet in force', 7, '%', 'Keputusan yang akan datang', null, 'decision',
     ops_core.office_day() + 30);

insert into ops_prod.finishing_recipes (system, step, product, unit_price, uom, coverage_m2_per_unit, coats, cost_per_m2, remarks, effective_on) values
  ('smoke NC natural', 'Abrasives',         'Sandpaper',          9200,  'm2',   1,   1, 9200,  null, '2026-09-25'),
  ('smoke NC natural', 'Sanding sealer',    'NC clear primer',   59000,  'kg',   9,   2, 13111, null, '2026-09-25'),
  ('smoke NC natural', 'Thinner for sealer','Thinner NC Super',  21000,  'ltr',  9,   2, 4667,  null, '2026-09-25'),
  ('smoke NC natural', 'Topcoat',           'NC matte topcoat',  68820,  'kg',   6,   2, 22940, null, '2026-09-25'),
  ('smoke NC natural', 'Bleach (optional)', 'White agent WA-250',1700000,'pail', 170, 1, 10000, null, '2026-09-25'),
  ('smoke PU / duco',  'Primer',            'PU clear primer',   55500,  'kg',   8,   3, 20812, null, '2026-09-25'),
  ('smoke PU / duco',  'Colour / topcoat',  'Duco paint',       131700,  'ltr',  8,   2, 32925, null, '2026-09-25'),
  ('smoke PU / duco',  'Filler',            'Wood filler NC',     null,  'ltr',  10,  1, null,  'harga belum ada', '2026-09-25');

-- Grants and policies, as the catalogue sees them.
do $$
declare t text;
begin
  foreach t in array array['ops_prod.bom_norms','ops_prod.finishing_recipes'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), format('%s keeps RLS on', t);
    assert has_table_privilege('authenticated', t, 'select'), format('authenticated may select %s', t);
    assert not has_table_privilege('authenticated', t, 'insert')
       and not has_table_privilege('authenticated', t, 'update')
       and not has_table_privilege('authenticated', t, 'delete'),
      format('nobody signed in writes %s', t);
    assert (select array_agg(p.cmd::text) from pg_policies p
             where format('%I.%I', p.schemaname, p.tablename) = t) = array['SELECT'],
      format('%s has one policy, and it reads', t);
  end loop;
  foreach t in array array['ops_prod.bom_norms','ops_prod.finishing_recipes',
                           'ops_prod.v_bom_norm','ops_prod.v_finishing_system'] loop
    assert not has_table_privilege('anon', t, 'select'), format('anon cannot read %s', t);
  end loop;
  assert (select c.reloptions @> array['security_invoker=on'] from pg_class c
           where c.oid = 'ops_prod.v_bom_norm'::regclass), 'v_bom_norm reads as the person';
  assert (select c.reloptions @> array['security_invoker=on'] from pg_class c
           where c.oid = 'ops_prod.v_finishing_system'::regclass), 'v_finishing_system reads as the person';
end $$;

-- A rate already on the list for one system, and a retired one for the other:
-- the retired one is not a match.
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000c921';
do $$
declare r jsonb;
begin
  r := ops_prod.save_bom_rate(null, 'Finishing smoke NC natural', 'finishing', 'm2', 60000, null, null, null);
  assert r->>'outcome' = 'ok', format('rate for NC natural: %s', r);
  r := ops_prod.save_bom_rate(null, 'Finishing smoke PU / duco', 'finishing', 'm2', 90000, null, null, false);
  assert r->>'outcome' = 'ok', format('retired rate for PU: %s', r);
end $$;

-- The estimator (production write) reads both.
do $$
declare n int; f record; b jsonb;
begin
  select count(*) into n from ops_prod.bom_norms where category like 'smoke-%';
  assert n = 4, format('production reads every norm row, got %s', n);

  select count(*) into n from ops_prod.v_bom_norm where category like 'smoke-%';
  assert n = 3, format('v_bom_norm leaves out the norm not yet in force, got %s', n);
  assert not exists (select 1 from ops_prod.v_bom_norm where norm = 'Not yet in force'),
    'a norm dated next month is not in force today';
  assert exists (select 1 from ops_prod.v_bom_norm
                  where norm = 'Packing material per m³ product' and value is null),
    'a norm with no value stays — its basis is the rule';

  select * into f from ops_prod.v_finishing_system where system = 'smoke NC natural';
  assert f.steps = 5 and f.unpriced_steps = 0, format('NC natural has five priced steps, got %s/%s', f.steps, f.unpriced_steps);
  assert f.cost_per_m2 = 59918, format('NC natural totals 59.918 per m², got %s', f.cost_per_m2);
  assert f.optional_cost_per_m2 = 10000, format('its optional bleach is 10.000, got %s', f.optional_cost_per_m2);
  assert f.rate_name = 'Finishing smoke NC natural', format('candidate name, got %s', f.rate_name);
  assert f.rate_code is not null and f.listed_rate = 60000,
    format('the active rate with that name is found, got %s at %s', f.rate_code, f.listed_rate);
  b := f.breakdown;
  assert jsonb_array_length(b) = 5, 'every step in the breakdown';
  assert (b->4->>'step') = 'Bleach (optional)' and (b->4->>'optional')::boolean,
    format('the optional step is listed last and marked, got %s', b->4);
  assert not (b->0->>'optional')::boolean, 'a required step is not marked optional';

  select * into f from ops_prod.v_finishing_system where system = 'smoke PU / duco';
  assert f.cost_per_m2 = 53737, format('PU totals its priced steps, 53.737, got %s', f.cost_per_m2);
  assert f.unpriced_steps = 1, format('and counts the unpriced filler, got %s', f.unpriced_steps);
  assert f.optional_cost_per_m2 = 0, 'no optional step, nothing optional';
  assert f.rate_code is null and f.listed_rate is null,
    'a retired rate of the same name is not "already on the list"';
end $$;
reset role;

-- A floor reader (production read) reads them too; nothing to write with.
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000c922';
do $$
begin
  assert (select count(*) from ops_prod.v_bom_norm where category like 'smoke-%') = 3,
    'production read sees the norms in force';
  assert (select count(*) from ops_prod.v_finishing_system where system like 'smoke %') = 2,
    'production read sees both systems';
  begin
    insert into ops_prod.bom_norms (category, norm, value) values ('smoke-x', 'typed from a screen', 1);
    assert false, 'a signed-in person cannot add a norm';
  exception when insufficient_privilege then null;
  end;
  begin
    update ops_prod.finishing_recipes set cost_per_m2 = 1 where system = 'smoke NC natural';
    assert false, 'a signed-in person cannot change a recipe';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Every procurement right and no production: the rules are not theirs to read.
-- RLS answers with nothing, not an error.
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000c923';
do $$
begin
  assert (select count(*) from ops_prod.bom_norms) = 0, 'no production, no norms';
  assert (select count(*) from ops_prod.v_bom_norm) = 0, 'no production, no norms through the view';
  assert (select count(*) from ops_prod.v_finishing_system) = 0, 'no production, no finishing systems';
end $$;
reset role;

-- anon: refused outright, not an empty list.
set local role anon;
do $$
begin
  begin
    perform 1 from ops_prod.v_bom_norm;
    assert false, 'anon cannot read v_bom_norm';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from ops_prod.finishing_recipes;
    assert false, 'anon cannot read finishing_recipes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
