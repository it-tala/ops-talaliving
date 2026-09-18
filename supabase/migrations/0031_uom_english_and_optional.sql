-- 0031_uom_english_and_optional.sql — the units the business uses, and the
-- items that have none.
--
-- ── Both halves are the owner's answers, 2026-09-18 ──────────────────────
--
-- Measuring `public.items` against `ops_procure.uom` before the import found
-- 1.020 items in three groups: 288 that match after a case fold, 145 across 32
-- unit names we do not have, and **587 with no unit at all**.
--
--   *"import semuanya, tanpa satuan biarkan apa adanya"*
--   *"tambahkan satuan dalam bahasa inggris"*
--
-- ── `base_uom` becomes nullable, and that is the honest shape ────────────
--
-- *Leave them as they are* cannot be done against `not null`. The alternatives
-- were to invent a unit for 587 things somebody buys, or to leave 58% of the
-- catalogue unimported — and both are worse than admitting what is true: a
-- great many of these items were never recorded with a unit, and a column that
-- forbids saying so forces a lie into every one of those rows.
--
-- A null here means **nobody wrote one down**, which a screen can print as an
-- em dash and a person can fill in. A defaulted `pcs` would mean *one piece*,
-- which is a claim about a thing nobody checked, and it would be indistinguish-
-- able from the items that really are counted in pieces. That is the difference
-- A3 keeps drawing: a missing figure is answerable, a wrong one is not.
--
-- Nothing downstream required it: `create_item` takes the unit as an argument
-- and `v_item_view` reads it. Both carry a null through as a null.

alter table ops_procure.items alter column base_uom drop not null;

comment on column ops_procure.items.base_uom is
  'Nullable: a great many legacy items were recorded with no unit at all (587 of 1.020), '
  'and inventing one would be a claim about a thing nobody checked. Null means nobody '
  'wrote one down, which is a question somebody can answer. (0031)';

-- ── a dimension for the things sold by time ──────────────────────────────
--
-- `day`, `week` and `month` are how a service is bought, and the five
-- dimensions this type had — count, mass, length, area, volume — have nowhere
-- to put them. Calling a day a `count` would let `uom_conversions` one day be
-- asked how many days are in a kilogram.
--
-- Its own statement, before anything uses it: Postgres will not let a new enum
-- value be used in the transaction that added it.
alter type ops_procure.uom_dimension_t add value if not exists 'time';

-- ── the units, in English (owner, 2026-09-18) ────────────────────────────
--
-- Each one is here because items are actually recorded in it, with the count
-- from `public.items` beside it. The existing vocabulary is a mix — `sak`,
-- `lembar`, `batang`, `lusin` are Indonesian — and the owner's instruction is
-- that additions are English, so `kaleng` arrives as `can` rather than as
-- itself.
--
-- **What is deliberately not here** is as much of the decision. Six legacy
-- values fold into units that already exist, so adding them would be two codes
-- for one thing and a catalogue that disagrees with itself:
--
--   liter, l   → ltr        m     → meter      pak → pack
--   btg        → batang     cbm   → m3         dz  → lusin
--
-- And five are genuinely ambiguous — `fil`, `gendel`, `ltrset`, `roll/pcs`,
-- `pail/drum`. The last two name two units at once, which is not a unit. Nine
-- items carry them, and they import with no unit and the original text kept in
-- `legacy_map.note`, where somebody who knows the trade can settle it.
insert into ops_procure.uom (code, name, dimension) values
  ('person', 'Person',     'count'),   -- orang 22, pax 2, person 2
  ('pail',   'Pail',       'count'),   -- 16
  ('lot',    'Lot',        'count'),   -- 10
  ('carton', 'Carton',     'count'),   -- dus 24, dos 3, ds 2
  ('gallon', 'Gallon',     'volume'),  -- galon 5
  ('can',    'Can',        'count'),   -- kaleng 4, blek 1
  ('bottle', 'Bottle',     'count'),   -- botol 2
  ('ream',   'Ream',       'count'),   -- rim 2
  ('drum',   'Drum',       'count'),   -- 1
  ('bale',   'Bale',       'count'),   -- ball 1
  ('bag',    'Bag',        'count'),   -- bg 1
  ('ml',     'Millilitre', 'volume')   -- 1
on conflict (code) do nothing;

-- Separate statement, because these three use the enum value added above and
-- Postgres refuses a new enum label inside the transaction that created it.
insert into ops_procure.uom (code, name, dimension) values
  ('day',   'Day',   'time'),
  ('week',  'Week',  'time'),
  ('month', 'Month', 'time')
on conflict (code) do nothing;

-- Millilitres to litres is a factor like any other; the rest are packaging
-- whose contents vary by supplier, and a factor nobody can defend is worse
-- than none (D153's rule about `factor` versus `yield_ratio`, in a smaller
-- place).
insert into ops_procure.uom_conversions (from_uom, to_uom, factor, note) values
  ('ltr', 'ml', 1000, null)
on conflict (from_uom, to_uom) do nothing;
