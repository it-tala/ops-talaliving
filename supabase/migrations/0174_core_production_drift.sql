-- 0174_core_production_drift.sql — what production had that no file here said.
--
-- Comparing the live project with a fresh ladder on 2026-09-25 (F167) found
-- objects that were created **straight on production**, outside any migration:
--
--   * `ops_procure.items.evidence_url`, `evidence_ref` — the receipt each item
--     was first seen on (*Struk trx-26-07-13_014 (2026-07-02)*), filled for
--     735 items by the item-master import.
--   * `ops_procure.item_master_staging` (592 rows), `item_vendor_prices` (820)
--     and `item_vendor_prices_staging` (820) — that import's working tables
--     and its result, a price per item per vendor (2026-09-24).
--   * `ops_prod.bom_norms` (28) and `ops_prod.finishing_recipes` (13) — the
--     rules of thumb a BOM is estimated from, and the finishing systems with
--     their cost per m² (2026-09-25).
--
-- A fresh ladder did not have them, so a local rebuild, the smoke suite and
-- any branch database were all a different schema from the one in use.
-- This file is that schema, written down.
--
-- **Every statement is a no-op on production**, apart from the three things
-- listed last. `if not exists` everywhere, and **nothing is dropped**: these
-- tables hold the only copy of what the import produced.
--
-- What does change on production:
--
--   1. **Row-level security goes on** for the five tables, with no policy.
--      They had none and no grant either, so the API could not read them
--      anyway. What changes is the database's own guarantee: a grant added
--      later by mistake still reaches nothing, and the advisor stops reporting
--      five tables with RLS disabled. Reading them through the app, when a
--      screen wants the vendor prices, is a seam or a policy of its own
--      (`procurement.read`), decided then, not a grant slipped in here.
--   2. **`v_item_view` is rebuilt** with its columns named. 0168 rebuilt it as
--      `select i.*`, which on production expanded to include the two evidence
--      columns — **before** `name_local`, because they were added to `items`
--      first there. A fresh ladder added `name_local` first, so the two views
--      disagreed about their columns. Named columns in production's order make
--      both the same, and a later column on `items` no longer changes the
--      view without anybody deciding it. Nothing depends on the view.
--   3. Comments.

-- ── items: the receipt an item was first seen on ─────────────────────────
alter table ops_procure.items add column if not exists evidence_url text;
alter table ops_procure.items add column if not exists evidence_ref text;

comment on column ops_procure.items.evidence_url is
  'Link to the receipt the item was first seen on, set by the 2026-09-24 item-master import. (0174)';
comment on column ops_procure.items.evidence_ref is
  'That receipt in words, e.g. "Struk trx-26-07-13_014 (2026-07-02)". (0174)';

-- ── the item-master import (2026-09-24) ──────────────────────────────────
create table if not exists ops_procure.item_master_staging (
  code           text primary key,
  is_new         boolean,
  name           text,
  aka            text[],
  category_code  text,
  base_uom       text,
  kind           text,
  standard_price numeric,
  price_min      numeric,
  price_max      numeric,
  obs            int,
  quality        text,
  vendors        text,
  remarks        text
);

create table if not exists ops_procure.item_vendor_prices (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid references ops_procure.items(id),
  item_code    text,
  vendor_id    uuid references ops_procure.vendors(id),
  vendor_name  text,
  unit_price   numeric not null,
  uom          text references ops_procure.uom(code),
  obs          int default 0,
  quality      text,
  source       text,
  effective_on date,
  is_cheapest  boolean default false,
  created_at   timestamptz default now()
);
-- Added on production after the table, in this order.
alter table ops_procure.item_vendor_prices add column if not exists evidence_url text;
alter table ops_procure.item_vendor_prices add column if not exists source_ref   text;
create index if not exists ivp_item on ops_procure.item_vendor_prices (item_id);

create table if not exists ops_procure.item_vendor_prices_staging (
  item_code   text,
  vendor_name text,
  unit_price  numeric,
  uom         text,
  obs         int,
  quality     text,
  source      text,
  effective   text,
  is_cheapest boolean
);

-- ── estimating norms (2026-09-25) ────────────────────────────────────────
create table if not exists ops_prod.bom_norms (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,
  norm         text not null,
  value        numeric,
  unit         text,
  basis        text,
  remarks      text,
  source_kind  text check (source_kind in ('empirical', 'industry', 'decision')),
  effective_on date default current_date,
  created_at   timestamptz default now(),
  unique (category, norm)
);

create table if not exists ops_prod.finishing_recipes (
  id                   uuid primary key default gen_random_uuid(),
  system               text not null,
  step                 text not null,
  product              text,
  unit_price           numeric,
  uom                  text,
  coverage_m2_per_unit numeric,
  coats                int,
  cost_per_m2          numeric,
  remarks              text,
  effective_on         date default current_date,
  created_at           timestamptz default now(),
  unique (system, step)
);

-- ── off the API, by the database's own word ──────────────────────────────
alter table ops_procure.item_master_staging        enable row level security;
alter table ops_procure.item_vendor_prices         enable row level security;
alter table ops_procure.item_vendor_prices_staging enable row level security;
alter table ops_prod.bom_norms                     enable row level security;
alter table ops_prod.finishing_recipes             enable row level security;

comment on table ops_procure.item_master_staging is
  'Working table of the 2026-09-24 item-master import. Not read by the app; RLS on, no policy. (0174)';
comment on table ops_procure.item_vendor_prices is
  'Price per item per vendor from the 2026-09-24 import; is_cheapest marks the best. '
  'Not read by the app yet; RLS on, no policy — a screen gets a seam or policy of its own. (0174)';
comment on table ops_procure.item_vendor_prices_staging is
  'Working table of the 2026-09-24 vendor-price import. Not read by the app; RLS on, no policy. (0174)';
comment on table ops_prod.bom_norms is
  'Rules of thumb a BOM is estimated from, per category, with where each came from. '
  'Not read by the app yet; RLS on, no policy. (0174)';
comment on table ops_prod.finishing_recipes is
  'Finishing systems step by step, with coverage and cost per m². '
  'Not read by the app yet; RLS on, no policy. (0174)';

-- ── v_item_view, with its columns named ──────────────────────────────────
drop view if exists ops_procure.v_item_view;
create view ops_procure.v_item_view as
  select i.id, i.code, i.name, i.aka, i.merged_into, i.category_code,
         i.base_uom, i.kind, i.is_curated, i.standard_price, i.last_price,
         i.last_vendor_id, i.last_purchased_at, i.created_by, i.created_at,
         i.archived_at, i.archived_by,
         i.evidence_url, i.evidence_ref,
         i.name_local,
         c.name as category_name,
         lv.name as last_vendor_name,
         coalesce(i.standard_price, i.last_price) as suggested_price,
         coalesce(pf.purchase_count, 0)           as purchase_count,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'vendor_id',   s.vendor_id,
                    'vendor_name', s.vendor_name,
                    'is_curated',  s.is_curated,
                    'pic_name',    s.pic_name,
                    'pic_phone',   s.pic_phone,
                    'last_price',  s.last_price,
                    'uom',         s.uom,
                    'last_date',   s.last_date,
                    'times',       s.times) order by s.last_date desc)
             from ops_procure.v_item_sources s
            where s.item_id = i.id
         ), '[]'::jsonb) as sourced_from,
         coalesce(c.parent_code, c.code)                        as top_category_code,
         case when p.code is null then c.name
              else p.name || ' › ' || c.name end                 as category_path
    from ops_procure.items i
    join ops_procure.item_categories c on c.code = i.category_code
    left join ops_procure.item_categories p on p.code = c.parent_code
    left join ops_procure.vendors lv on lv.id = i.last_vendor_id
    left join (
      select item_id, count(*) as purchase_count
        from ops_procure.v_purchase_facts group by item_id
    ) pf on pf.item_id = i.id;

alter view ops_procure.v_item_view set (security_invoker = on);
grant select on ops_procure.v_item_view to authenticated;
comment on view ops_procure.v_item_view is
  'An item with where it has been bought and where it sits in the category tree. '
  'Merged items fold into their survivor through v_purchase_facts. (0032, 0104)';

analyze ops_procure.items;
analyze ops_procure.item_master_staging;
analyze ops_procure.item_vendor_prices;
analyze ops_procure.item_vendor_prices_staging;
analyze ops_prod.bom_norms;
analyze ops_prod.finishing_recipes;
