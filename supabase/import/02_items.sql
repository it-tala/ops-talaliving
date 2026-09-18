-- 02_items.sql — all 1.020 of them.
--
-- Step 5 of `04-data-migration.md`, held back from `01_reference.sql` until the
-- owner answered the two questions the measurement raised. Both were answered
-- on 2026-09-18:
--
--   *"import semuanya, tanpa satuan biarkan apa adanya"*
--   *"tambahkan satuan dalam bahasa inggris"*
--
-- `0031` did the second half — twelve units plus three measured in time — and
-- made `base_uom` nullable so the first half is possible at all.
--
-- ── Every item lands. The unit is what may be missing ────────────────────
--
-- Three groups, and the third is the one the design is about:
--
--   288  the unit matches once it is lower-cased
--   136  the unit maps, either to a new code from `0031` or an existing one
--   596  no unit at all — 587 that never had one, and 9 whose legacy value
--        names two units at once or nothing recognisable
--
-- The 596 import with `base_uom` null and their original text preserved in
-- `legacy_map.note`. That is *biarkan apa adanya* made literal: the item is
-- here, findable and orderable, and the one thing nobody wrote down is still
-- the one thing nobody wrote down.
--
-- ── Category ─────────────────────────────────────────────────────────────
--
-- `ops_procure.items.category_code` is `not null`, and 123 legacy items carry
-- `non-item`, which is not one of ours. They land as `uncurated` — a category
-- that exists for exactly this, and which pairs with `is_curated` false so the
-- catalogue says plainly which rows a person has looked at. Guessing between
-- `service` and `office` for 123 rows would put an opinion in a column that is
-- supposed to hold a fact.

\set ON_ERROR_STOP on

begin;

create temp table _run on commit drop as
  select gen_random_uuid() as run_id;

/* The mapping, as a table rather than a `case` a hundred lines long — so it can
 * be read, argued with, and added to without touching the insert below.
 *
 * Only the folds and the new codes are here. A legacy unit that already matches
 * an `ops_procure.uom` code after lower-casing needs no row: the join finds it.
 */
create temp table _unit_map (legacy text primary key, uom text) on commit drop;
insert into _unit_map (legacy, uom) values
  -- fold onto units that already existed
  ('liter','ltr'), ('l','ltr'), ('btg','batang'), ('m','meter'),
  ('cbm','m3'), ('pak','pack'), ('dz','lusin'),
  -- the English additions from 0031
  ('orang','person'), ('pax','person'), ('person','person'),
  ('dus','carton'), ('dos','carton'), ('ds','carton'),
  ('kaleng','can'), ('blek','can'),
  ('galon','gallon'), ('botol','bottle'), ('rim','ream'),
  ('ball','bale'), ('bg','bag'),
  ('pail','pail'), ('lot','lot'), ('drum','drum'), ('ml','ml'),
  ('day','day'), ('week','week'), ('month','month');
  -- Deliberately absent: `fil`, `gendel`, `ltrset`, `roll/pcs`, `pail/drum`.
  -- The last two name two units at once, which is not a unit; the first three
  -- are not recognisable from here. Nine items, and they arrive with no unit
  -- and their original text kept, rather than with a guess.

create temp table _staged on commit drop as
select i.item_id,
       btrim(i.name)                                      as name,
       lower(btrim(coalesce(i.unit, '')))                 as raw_unit,
       coalesce(
         (select u.code from ops_procure.uom u
           where u.code = lower(btrim(coalesce(i.unit, '')))),
         (select m.uom from _unit_map m
           where m.legacy = lower(btrim(coalesce(i.unit, ''))))
       )                                                  as uom_code,
       coalesce(
         (select c.code from ops_procure.item_categories c where c.code = i.category),
         'uncurated')                                     as category_code,
       case when i.kind = 'service' then 'service' else 'goods' end
                                                          as kind,
       i.aka, i.price, i.last_price, i.last_purchase, i.last_vendor,
       row_number() over (order by i.created_at, btrim(i.name)) as seq
  from public.items i
 where coalesce(btrim(i.name), '') <> ''
   and not exists (
     select 1 from ops_core.legacy_map m
      where m.source_table = 'public.items' and m.source_id = i.item_id::text);

/* `last_vendor` is a name in the old schema and a foreign key here. It resolves
 * where the vendor was imported by `01_reference.sql` and is left null where it
 * was not — **never created from the name**, which is the rule that keeps a
 * typo from becoming a vendor nobody can find. */
insert into ops_procure.items
  (code, name, aka, category_code, base_uom, kind, is_curated,
   standard_price, last_price, last_vendor_id, last_purchased_at)
select 'I-' || lpad(
         (coalesce((select max(substring(code from 3)::int)
                      from ops_procure.items where code ~ '^I-[0-9]{5}$'), 0)
          + s.seq)::text, 5, '0'),
       s.name,
       case when jsonb_typeof(s.aka) = 'array'
            then coalesce((select array_agg(x::text) from jsonb_array_elements_text(s.aka) x), '{}')
            else '{}' end,
       s.category_code,
       s.uom_code,
       s.kind::ops_procure.item_kind_t,
       false,
       s.price,
       s.last_price,
       (select v.id from ops_procure.vendors v where v.name = btrim(s.last_vendor)),
       s.last_purchase::timestamptz
  from _staged s
 on conflict (code) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.items',
       s.item_id::text,
       'ops_procure.items',
       t.id,
       'imported',
       nullif(concat_ws('; ',
         case when s.uom_code is null and s.raw_unit = ''
              then 'no unit in the legacy row — imported with none, per the owner''s ruling'
              when s.uom_code is null
              then 'unit ' || quote_literal(s.raw_unit)
                   || ' names two units or none recognisable — imported with no unit, text kept here'
         end,
         case when s.category_code = 'uncurated'
              then 'category did not map; landed uncurated' end,
         case when s.last_vendor is not null
               and not exists (select 1 from ops_procure.vendors v
                                where v.name = btrim(s.last_vendor))
              then 'last vendor ' || quote_literal(btrim(s.last_vendor))
                   || ' not resolved — left null rather than created' end
       ), '')
       ,(select run_id from _run)
  from _staged s
  left join ops_procure.items t on t.name = s.name
 on conflict (source_table, source_id) do nothing;

\echo ''
\echo '── items ───────────────────────────────────────────────────────────'
select count(*)                                    as items,
       count(*) filter (where base_uom is not null) as with_unit,
       count(*) filter (where base_uom is null)     as without_unit,
       count(*) filter (where category_code = 'uncurated') as uncurated_category
  from ops_procure.items;

\echo ''
\echo '── units in use, most first ────────────────────────────────────────'
select coalesce(base_uom, '(none)') as uom, count(*) as items
  from ops_procure.items group by 1 order by 2 desc, 1;

commit;
