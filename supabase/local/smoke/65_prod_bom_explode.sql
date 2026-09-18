-- prod — the explosion: every purchasable thing a run needs, sub-assemblies
-- walked through (D257).
--
--   REFUSALS     a reader with no production grant gets an empty explosion
--                rather than the numbers — the functions are `stable`, not
--                `security definer`, so RLS answers for them
--   DERIVATIONS  **waste compounds** down the tree; **one line per thing to
--                buy, with every route named**; a sub-assembly with no
--                released revision **stays in the list** as itself; a
--                **cycle is reported** rather than walked; a sub-assembly is
--                read at its RELEASED revision while the product being asked
--                about is read at its DRAFT (D175); an unpriced line makes
--                the run total **null rather than zero**; labour is null the
--                moment the per-unit figure is (D239)
--
-- Worked out first, for a run of 5 kabinet:
--
--   laci      5 × 2 × 1,10                        =    11 unit
--   plywood   11 × 3 × 1,10                       =  36,3 lembar  ← compounded
--             36,3 × 90.000 (last paid)           = 3.267.000
--   kayu      5 × 4                               =    20 lembar
--             20 × 200.000 (standard)             = 4.000.000
--   sekrup    5 × 12 langsung  +  11 × 8 via laci =   148 pcs     ← one line
--             148 × 500                           =    74.000
--   engsel    5 × 1, tidak bisa diurai            =     5 unit
--   hantu     5 × 1, tak ada di katalog           =     5 unit
--
--   labour    400.000 × 5                         = 2.000.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000006501','tukang@talaliving.com','{"full_name":"Tukang Kayu"}'),
  ('ffffffff-0000-0000-0000-000000006502','staf@talaliving.com','{"full_name":"Staf HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000006501','production','write'),
  -- Somebody signed in, with a grant, and none of it for the workshop.
  ('ffffffff-0000-0000-0000-000000006502','hrd','write');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('KAYU-02','Papan jati 2cm','raw-wood','lembar', 200000, 180000),
  ('PLY-12','Plywood 12mm','raw-wood','lembar',       null,  90000),
  ('SEKRUP-02','Sekrup 4x30','hardware','pcs',         500,    400),
  ('LEM-01','Lem kayu PVAc','hardware','kg',          null,   null);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006501';

insert into ops_prod.products
  (id, product_code, name, category, uom, labour_cost, labour_note, created_by)
values
  ('bbbb6500-0000-0000-0000-0000000000a1','PRD-LAC-02','Laci besar','Lemari','unit',
    50000,'satu tukang × setengah hari','ffffffff-0000-0000-0000-000000006501'),
  ('bbbb6500-0000-0000-0000-0000000000a2','PRD-KAB-02','Kabinet dapur','Lemari','unit',
    400000,'dua tukang × 2 hari × 100.000','ffffffff-0000-0000-0000-000000006501'),
  -- No labour figure at all: nobody has worked it out yet.
  ('bbbb6500-0000-0000-0000-0000000000a3','PRD-ENG-02','Rakitan engsel','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006501'),
  ('bbbb6500-0000-0000-0000-0000000000a4','PRD-CYC-A','Rakitan A','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006501'),
  ('bbbb6500-0000-0000-0000-0000000000a5','PRD-CYC-B','Rakitan B','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006501');

-- ── laci: rev 1 released, rev 2 an open draft ─────────────────────────────
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6500-0000-0000-0000-0000000000a1', 1,'ffffffff-0000-0000-0000-000000006501');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb6500-0000-0000-0000-0000000000a1', 1,'material','PLY-12',    3,'lembar', 10),
  ('bbbb6500-0000-0000-0000-0000000000a1', 1,'material','SEKRUP-02', 8,'pcs',     0);
update ops_prod.bom_revisions
   set released_at = now(), released_by = 'ffffffff-0000-0000-0000-000000006501',
       note = 'rev awal laci'
 where product_id = 'bbbb6500-0000-0000-0000-0000000000a1' and rev = 1;

-- Somebody is in the middle of re-drawing it. Ninety-nine sheets of plywood is
-- the working copy, and no run must ever be costed against it.
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6500-0000-0000-0000-0000000000a1', 2,'ffffffff-0000-0000-0000-000000006501');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb6500-0000-0000-0000-0000000000a1', 2,'material','PLY-12', 99,'lembar', 0);

-- ── kabinet: the tree with everything awkward in it ───────────────────────
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6500-0000-0000-0000-0000000000a2', 1,'ffffffff-0000-0000-0000-000000006501');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb6500-0000-0000-0000-0000000000a2', 1,'product', 'PRD-LAC-02', 2,'unit',   10),
  ('bbbb6500-0000-0000-0000-0000000000a2', 1,'material','KAYU-02',    4,'lembar',  0),
  ('bbbb6500-0000-0000-0000-0000000000a2', 1,'material','SEKRUP-02', 12,'pcs',     0),
  -- A sub-assembly with a draft and no release: unexploded.
  ('bbbb6500-0000-0000-0000-0000000000a2', 1,'product', 'PRD-ENG-02', 1,'unit',    0),
  -- A sub-assembly code with no product behind it at all: also unexploded.
  ('bbbb6500-0000-0000-0000-0000000000a2', 1,'product', 'PRD-GHOST',  1,'unit',    0);
update ops_prod.bom_revisions
   set released_at = now(), released_by = 'ffffffff-0000-0000-0000-000000006501',
       note = 'rev awal kabinet'
 where product_id = 'bbbb6500-0000-0000-0000-0000000000a2' and rev = 1;

-- The engsel has a list, but nobody has released it.
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6500-0000-0000-0000-0000000000a3', 1,'ffffffff-0000-0000-0000-000000006501');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb6500-0000-0000-0000-0000000000a3', 1,'material','SEKRUP-02', 6,'pcs');

-- ── A holds B holds A ─────────────────────────────────────────────────────
insert into ops_prod.bom_revisions (product_id, rev, created_by) values
  ('bbbb6500-0000-0000-0000-0000000000a4', 1,'ffffffff-0000-0000-0000-000000006501'),
  ('bbbb6500-0000-0000-0000-0000000000a5', 1,'ffffffff-0000-0000-0000-000000006501');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb6500-0000-0000-0000-0000000000a4', 1,'product', 'PRD-CYC-B', 1,'unit'),
  ('bbbb6500-0000-0000-0000-0000000000a5', 1,'product', 'PRD-CYC-A', 1,'unit'),
  ('bbbb6500-0000-0000-0000-0000000000a5', 1,'material','LEM-01',    1,'kg');
update ops_prod.bom_revisions
   set released_at = now(), released_by = 'ffffffff-0000-0000-0000-000000006501',
       note = 'rev awal rakitan'
 where product_id in ('bbbb6500-0000-0000-0000-0000000000a4',
                      'bbbb6500-0000-0000-0000-0000000000a5');

/* ── DERIVATION: waste compounds down the tree ─────────────────────────── */
do $$
declare x record;
begin
  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'PLY-12';
  -- 5 kabinet × 2 laci × 1,10 = 11 laci; 11 × 3 lembar × 1,10 = 36,3.
  -- A walk that applied only the line's own susut would say 33.
  assert x.qty = 36.3,
    '11 laci × 3 lembar × 1,10 susut, got ' || coalesce(x.qty::text,'(null — is the tree being walked at all?)');
  assert x.depth = 2,            'two levels down, got ' || coalesce(x.depth::text,'(null)');
  assert x.unit_price = 90000,   'no catalogue price, so the last one paid, got ' || coalesce(x.unit_price::text,'(null)');
  assert x.price_source = 'last_paid', 'and it says which, got ' || coalesce(x.price_source,'(null)');
  assert x.subtotal = 3267000,   '36,3 × 90.000, got ' || coalesce(x.subtotal::text,'(null)');
  assert x.ref_name = 'Plywood 12mm', 'named from the catalogue, got ' || coalesce(x.ref_name,'(null)');
  assert cardinality(x.via) = 1 and x.via[1] = 'PRD-LAC-02',
    'reached through the laci and only the laci, got ' || coalesce(array_to_string(x.via,'/'),'(null)');
end $$;

/* ── DERIVATION: one line per thing to buy, every route named ──────────── */
do $$
declare x record; n int;
begin
  select count(*) into n from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'SEKRUP-02';
  assert n = 1, 'a purchase request wants one row per thing to buy, got ' || n;

  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'SEKRUP-02';
  assert x.qty = 148,  '5 × 12 langsung plus 11 × 8 lewat laci, got ' || coalesce(x.qty::text,'(null)');
  assert x.subtotal = 74000, '148 × 500, got ' || coalesce(x.subtotal::text,'(null)');
  -- *Why do I need a hundred and forty-eight screws* is the next question, and
  -- the answer is both routes, not the deepest one.
  assert cardinality(x.via) = 2,
    'both routes named, got ' || coalesce(array_to_string(x.via,' / '),'(null)');
  assert '—' = any(x.via),          'one of them is the kabinet itself';
  assert 'PRD-LAC-02' = any(x.via), 'the other is through the laci';
  assert x.depth = 2, 'the deepest place it turns up, got ' || coalesce(x.depth::text,'(null)');

  -- A material reached only directly still says so, rather than leaving `via`
  -- empty for the reader to interpret.
  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'KAYU-02';
  assert x.qty = 20,                'no susut on the boards, got ' || coalesce(x.qty::text,'(null)');
  assert x.subtotal = 4000000,      '20 × 200.000 standard, got ' || coalesce(x.subtotal::text,'(null)');
  assert x.via = array['—'],        'a direct component, got ' || coalesce(array_to_string(x.via,'/'),'(null)');
end $$;

/* ── DERIVATION: what cannot be broken down stays in the list ──────────── */
do $$
declare x record;
begin
  -- A draft is not a release, so the engsel is something that has to be
  -- obtained somehow. Dropping it would be the silent kind of wrong.
  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'PRD-ENG-02';
  assert x.ref_code is not null, 'a sub-assembly with no released rev is still on the list';
  assert x.unexploded,           'and is named as unexploded rather than priced at zero';
  assert not x.cycle,            'it is missing, not circular';
  assert x.qty = 5,              'one per kabinet, got ' || coalesce(x.qty::text,'(null)');
  assert x.ref_name = 'Rakitan engsel', 'named from the catalogue, got ' || coalesce(x.ref_name,'(null)');
  assert x.subtotal is null,     'nothing prices a sub-assembly, so no subtotal';

  -- And the code with no product behind it at all (A6: shown, not refused).
  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'PRD-GHOST';
  assert x.ref_code is not null, 'a code nobody has catalogued is reported, not dropped';
  assert x.unexploded,           'and reported as unexploded';
  assert x.ref_name is null,     'with no name, because there is none to give';
end $$;

/* ── DERIVATION: a cycle is reported rather than walked ────────────────── */
do $$
declare x record; s ops_prod.bom_explosion_t;
begin
  select * into x from ops_prod.explode_bom('PRD-CYC-A', 1) where ref_code = 'PRD-CYC-A';
  assert x.ref_code is not null,
    'A holds B holds A: a recursion that simply stops leaves the list short with no reason given';
  assert x.cycle,               'and the row says why it stopped';
  assert not x.unexploded,      'circular is a different fault from missing';
  assert x.via = array['PRD-CYC-B'], 'reached through B, got ' || coalesce(array_to_string(x.via,'/'),'(null)');

  -- Everything below the cycle is still collected on the way.
  select * into x from ops_prod.explode_bom('PRD-CYC-A', 1) where ref_code = 'LEM-01';
  assert x.qty = 1, 'the glue inside B is still needed, got ' || coalesce(x.qty::text,'(null)');

  s := ops_prod.explode_summary('PRD-CYC-A', 1);
  assert s.has_cycle, 'and the summary raises it where somebody will see it';
  assert s.lines = 2, 'the glue and the loop, got ' || coalesce(s.lines::text,'(null)');
end $$;

/* ── DERIVATION: draft for the product asked about, released below (D175) ─ */
do $$
declare x record;
begin
  -- *What would this cost* is a question asked ABOUT a draft, before anybody
  -- commits to it: the starting product answers with its working copy.
  select * into x from ops_prod.explode_bom('PRD-LAC-02', 10) where ref_code = 'PLY-12';
  assert x.qty = 990, '10 × 99, the open draft, got ' || coalesce(x.qty::text,'(null)');

  -- Named explicitly, the released one.
  select * into x from ops_prod.explode_bom('PRD-LAC-02', 10, 1) where ref_code = 'PLY-12';
  assert x.qty = 33, '10 × 3 × 1,10, rev 1, got ' || coalesce(x.qty::text,'(null)');

  -- And inside somebody else's tree the laci is not the thing being asked
  -- about, so it answers with what the workshop would actually build from —
  -- never the ninety-nine sheets of a list still being edited.
  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'PLY-12';
  assert x.qty = 36.3, 'a sub-assembly is read at its RELEASED rev, got ' || coalesce(x.qty::text,'(null)');
end $$;

/* ── DERIVATION: the run total, and what makes it unknowable ───────────── */
do $$
declare s ops_prod.bom_explosion_t;
begin
  s := ops_prod.explode_summary('PRD-KAB-02', 5);
  assert s.rev = 1,        'no draft on the kabinet, so the released one, got ' || coalesce(s.rev::text,'(null)');
  assert s.lines = 5,      'kayu, sekrup, plywood, engsel, hantu, got ' || coalesce(s.lines::text,'(null)');
  assert s.unexploded = 2, 'the engsel and the ghost, got ' || coalesce(s.unexploded::text,'(null)');
  assert s.unpriced = 2,   'the same two, and nothing else, got ' || coalesce(s.unpriced::text,'(null)');
  -- A total that quietly omits two lines is the number somebody quotes from.
  assert s.material_cost is null, 'unpriced lines make the run total unknown, not cheap';
  assert s.labour_total = 2000000, '400.000 × 5, got ' || coalesce(s.labour_total::text,'(null)');

  -- Everything priced, so there is a number.
  s := ops_prod.explode_summary('PRD-LAC-02', 10, 1);
  assert s.lines = 2,      'plywood and sekrup, got ' || coalesce(s.lines::text,'(null)');
  assert s.unpriced = 0,   'both priced, got ' || coalesce(s.unpriced::text,'(null)');
  assert s.material_cost = 3010000, '2.970.000 + 40.000, got ' || coalesce(s.material_cost::text,'(null)');
  assert s.labour_total = 500000,   '50.000 × 10, got ' || coalesce(s.labour_total::text,'(null)');

  -- A run of three costs three times an unknown, which is still unknown (D239).
  s := ops_prod.explode_summary('PRD-ENG-02', 3);
  assert s.material_cost = 9000,  '18 sekrup × 500, off the draft, got ' || coalesce(s.material_cost::text,'(null)');
  assert s.labour_cost is null,   'nobody has worked the labour out';
  assert s.labour_total is null,  'so the run has no labour figure either — not zero';
end $$;

/* ── REFUSAL: no production grant, no prices ───────────────────────────── */
--
-- The workshop catalogue is readable by everybody who has to name a thing
-- (`products_read … using (true)`, and deliberately). What is gated is
-- **procurement's** side of the seam: `items_read_production` hands the item
-- list to `production.read` and nobody else, so somebody from HRD gets the
-- structure of the tree and not a single rupiah of it.
--
-- Worth pinning rather than leaving implicit, because the failure it would
-- turn into is F104's: not an error, just plausible nulls.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006502';
do $$
declare x record; n int; s ops_prod.bom_explosion_t;
begin
  assert not ops_core.has_permission('production.read'), 'HRD holds no workshop grant';

  -- `explode_bom` is `stable`, not `security definer`: it reads both sides of
  -- the seam as the caller, and RLS filters rather than raises.
  select count(*) into n from ops_prod.explode_bom('PRD-KAB-02', 5);
  assert n = 5, 'the shape of the tree is not the secret, got ' || n || ' lines';

  select * into x from ops_prod.explode_bom('PRD-KAB-02', 5) where ref_code = 'KAYU-02';
  assert x.unit_price is null, 'what a board costs is procurement''s, and stays there';
  assert x.ref_name is null,   'and so is its catalogue name';
  assert x.subtotal is null,   'so the line cannot be totalled';

  s := ops_prod.explode_summary('PRD-KAB-02', 5);
  assert s.unpriced = 5,          'every line, not two, got ' || coalesce(s.unpriced::text,'(null)');
  assert s.material_cost is null, 'and no run total at all — never a zero that reads as free';
end $$;

rollback;
