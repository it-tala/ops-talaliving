-- _units.sql — the legacy unit vocabulary, in one place.
--
-- Included with `\ir` by every file that has to read a unit somebody typed into
-- the old system. It was inline in `02_items.sql`, which was right while items
-- were the only thing with units; `04_lines.sql` reads the same column on
-- `item_purchases`, and two copies of *what does `dus` mean* is how the
-- catalogue and the ledger end up disagreeing about a carton.
--
-- A table rather than a `case` a hundred lines long, so it can be read, argued
-- with and added to without touching an insert.
--
-- **Only the folds and the new codes are here.** A legacy unit that already
-- matches an `ops_procure.uom` code after lower-casing needs no row: the join
-- finds it.
--
-- Temporary, and deliberately not a table in the ladder. These are facts about
-- what the *old* system's users typed, not about this business's vocabulary —
-- `ops_procure.uom` holds that. When the old system is gone this file goes with
-- it, and nothing in `ops_*` will have a column that remembers `blek`.

create temp table _unit_map (legacy text primary key, uom text) on commit drop;
insert into _unit_map (legacy, uom) values
  -- fold onto units that already existed
  ('liter','ltr'), ('l','ltr'), ('btg','batang'), ('m','meter'),
  ('cbm','m3'), ('pak','pack'), ('dz','lusin'),
  -- the English additions from 0031
  ('orang','person'), ('pax','person'), ('person','person'),
  ('dus','carton'), ('dos','carton'), ('ds','carton'), ('duss','carton'),
  ('kaleng','can'), ('blek','can'),
  ('galon','gallon'), ('botol','bottle'), ('rim','ream'),
  ('ball','bale'), ('bg','bag'),
  ('pail','pail'), ('lot','lot'), ('drum','drum'), ('ml','ml'),
  ('day','day'), ('week','week'), ('month','month'), ('hari','day');
  -- `duss` and `hari` arrived with `item_purchases` (04) — one row each, and
  -- both unambiguous: a second spelling of `dus`, and the Indonesian for a day.
  --
  -- Deliberately absent, here as in 02: `fil`, `gendel`, `ltrset`, `roll/pcs`,
  -- `pail/drum`, and now `rem`, `slop`, `slp`. The pairs name two units at
  -- once, which is not a unit; the rest are not recognisable from here. Eleven
  -- purchase lines and nine items, and they arrive with no unit and their
  -- original text kept, rather than with a guess. `rem` looks like `rim` and is
  -- one row — close enough to guess is exactly the reason not to.
