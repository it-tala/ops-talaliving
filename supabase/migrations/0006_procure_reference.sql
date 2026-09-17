-- 0006_procure_reference.sql — the reference data every other schema points at.
--
-- This is the worked pattern for a domain schema: uncurated rows are allowed
-- in, curation is a flag rather than a gate, a merge is a pointer and never a
-- delete, and **nothing is referenced by uuid across a service seam** — the
-- code is the reference (ADR-004).

create table ops_procure.vendors (
  id                     uuid primary key default gen_random_uuid(),
  -- What every other service quotes. Stable for the life of the vendor.
  code                   text not null unique,
  name                   text not null,
  -- The spellings this vendor arrives under in the wild. Searching has to find
  -- "CV. Sumber Kayu" when somebody typed "sumberkayu" (D31).
  aka                    text[] not null default '{}',
  -- A merge is a pointer. The old row stays, so a PO raised against it in
  -- March still resolves (A5, D33).
  merged_into            uuid references ops_procure.vendors(id),
  -- Curated means somebody checked the name, the bank account and the PIC.
  -- Uncurated rows are still usable: refusing them is how a workshop ends up
  -- buying off-system (D30).
  is_curated             boolean not null default false,
  phone                  text,
  address                text,
  pic_name               text,
  pic_phone              text,
  bank_account           text,
  bank_account_secondary text,
  npwp                   text,
  supplied_categories    text[] not null default '{}',
  created_by             uuid references ops_core.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint merge_not_self check (merged_into is null or merged_into <> id)
);

create table ops_procure.uom (
  code       text primary key,
  name       text not null,
  dimension  ops_procure.uom_dimension_t not null
);

-- Two units are related by a factor, and sometimes by a **yield** as well —
-- a cubic metre of log is not a cubic metre of board (D153, F46). Keeping the
-- two apart is what stops a conversion quietly pricing waste as product.
create table ops_procure.uom_conversions (
  id          uuid primary key default gen_random_uuid(),
  from_uom    text not null references ops_procure.uom(code),
  to_uom      text not null references ops_procure.uom(code),
  factor      numeric not null check (factor > 0),
  yield_ratio numeric check (yield_ratio > 0 and yield_ratio <= 1),
  note        text,
  unique (from_uom, to_uom)
);

create table ops_procure.item_categories (
  code        text primary key,
  parent_code text references ops_procure.item_categories(code),
  name        text not null
);

create table ops_procure.items (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  aka               text[] not null default '{}',
  merged_into       uuid references ops_procure.items(id),
  category_code     text not null references ops_procure.item_categories(code),
  base_uom          text not null references ops_procure.uom(code),
  -- `goods` or `service`, and the distinction earns its place: a service line
  -- completes on payment proof alone, because mowing the grass never gets
  -- delivered (D25).
  kind              ops_procure.item_kind_t not null default 'goods',
  is_curated        boolean not null default false,
  -- The catalogue price, and what was actually paid last. Both nullable: a
  -- price nobody has set is missing, not zero (D149).
  standard_price    numeric,
  last_price        numeric,
  last_vendor_id    uuid references ops_procure.vendors(id),
  last_purchased_at timestamptz,
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now(),
  constraint item_merge_not_self check (merged_into is null or merged_into <> id)
);

-- Searching has to find the item under the name somebody actually typed. The
-- config is cast to `regconfig` so the expression is immutable — with the
-- bare literal Postgres treats it as stable and refuses to index it, which is
-- correct of it: a search config that can change would silently rot the index.
create index items_search_idx on ops_procure.items
  using gin (to_tsvector('simple'::regconfig, name));
-- The alternate spellings are searched as an array containment or an ILIKE on
-- the unnested values; indexing them into the same vector needs a stored
-- column, which is work for the day the catalogue is big enough to need it.
create index items_aka_idx on ops_procure.items using gin (aka);

-- The dimension every service hangs on: procurement buys for it, production
-- makes for it, the ledger spends on it. The **code** is the part that must
-- never move (D149).
create table ops_procure.projects (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  is_active      boolean not null default true,
  client_name    text,
  location       text,
  pic            text,
  started_on     date,
  target_date    date,
  contract_value numeric,
  note           text,
  created_by     uuid references ops_core.users(id),
  created_at     timestamptz not null default now()
);

-- What the customer actually ordered. This is what turns a project from a
-- label spending gets tagged with into an order (D150).
create table ops_procure.project_lines (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references ops_procure.projects(id) on delete restrict,
  line_no      int not null,
  -- Points at `ops_prod.products.product_code` by code, across the seam (ADR-004).
  product_code text,
  description  text not null,
  qty          numeric not null check (qty > 0),
  uom          text not null references ops_procure.uom(code),
  unit_price   numeric,
  note         text,
  created_at   timestamptz not null default now(),
  unique (project_id, line_no)
);

-- ── seeds ─────────────────────────────────────────────────────────────────
-- The units, the conversions and the categories are seeds rather than forms,
-- for the reason in `01-schema.md`: `items.base_uom` and `items.category_code`
-- are foreign keys, so until these rows exist **nothing can be inserted into
-- this schema at all**. The first cut of this migration shipped the constraints
-- without the rows they point at, which made a correct-looking schema an empty
-- one. Eighteen units, spelled as the running system spells them.
insert into ops_procure.uom (code, name, dimension) values
  ('pcs','Pieces','count'),      ('buah','Buah (each)','count'),
  ('kg','Kilogram','mass'),      ('gr','Gram','mass'),
  ('meter','Meter','length'),    ('m2','Square metre','area'),
  ('m3','Cubic metre','volume'), ('cm','Centimetre','length'),
  ('sak','Sak (bag)','count'),   ('box','Box','count'),
  ('roll','Roll','count'),       ('set','Set','count'),
  ('pack','Pack','count'),       ('ltr','Liter','volume'),
  ('lembar','Lembar (sheet)','count'), ('batang','Batang (bar)','count'),
  ('unit','Unit','count'),       ('lusin','Lusin (dozen)','count');

-- Three packaging factors and one that is not a factor at all. A cubic metre of
-- log does not become a cubic metre of board: 55 sheets come out of it and
-- roughly half the wood goes to the floor as sawdust and offcut. `factor` and
-- `yield_ratio` are kept apart precisely so a conversion cannot quietly price
-- the waste as product (D153, F46).
insert into ops_procure.uom_conversions (from_uom, to_uom, factor, yield_ratio, note) values
  ('lusin','pcs',12,   null, null),
  ('kg','gr',1000,     null, null),
  ('box','pcs',100,    null, 'screws, per factory box'),
  ('m3','lembar',55,   0.52, 'teak log -> 3cm board, 45-60% yield');

-- `uncurated` is a category like any other, and that is the point: a row nobody
-- has classified still has somewhere to go, so refusing it is never the reason
-- a workshop buys off-system (D30).
insert into ops_procure.item_categories (code, parent_code, name) values
  ('production', null,         'Production'),
  ('sanding',    null,         'Sanding'),
  ('finishing',  null,         'Finishing'),
  ('packing',    null,         'Packing'),
  ('machining',  null,         'Machining'),
  ('office',     null,         'Office'),
  ('service',    null,         'Services'),
  ('uncurated',  null,         'Not yet curated'),
  ('raw-wood',   'production', 'Timber & panels'),
  ('hardware',   'production', 'Hardware');

alter table ops_procure.vendors          enable row level security;
alter table ops_procure.uom              enable row level security;
alter table ops_procure.uom_conversions  enable row level security;
alter table ops_procure.item_categories  enable row level security;
alter table ops_procure.items            enable row level security;
alter table ops_procure.projects         enable row level security;
alter table ops_procure.project_lines    enable row level security;

-- The pattern, repeated for every domain table: read on the module's read
-- permission, insert and update on its create/update permission, **no delete
-- policy and no delete grant** (A2).
create policy vendors_read   on ops_procure.vendors        for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy uom_read       on ops_procure.uom            for select to authenticated using (true);
create policy uomconv_read   on ops_procure.uom_conversions for select to authenticated using (true);
create policy cats_read      on ops_procure.item_categories for select to authenticated using (true);
create policy items_read     on ops_procure.items          for select to authenticated using (ops_core.has_permission('procurement.read'));
-- Projects are read by everybody who can open any module that spends against
-- them; hiding the list would make every "which job is this for?" unanswerable.
create policy projects_read  on ops_procure.projects       for select to authenticated using (true);
create policy plines_read    on ops_procure.project_lines  for select to authenticated using (true);

create policy vendors_new    on ops_procure.vendors        for insert to authenticated with check (ops_core.has_permission('procurement.create'));
create policy vendors_edit   on ops_procure.vendors        for update to authenticated using (ops_core.has_permission('procurement.update')) with check (ops_core.has_permission('procurement.update'));
create policy items_new      on ops_procure.items          for insert to authenticated with check (ops_core.has_permission('procurement.create'));
create policy items_edit     on ops_procure.items          for update to authenticated using (ops_core.has_permission('procurement.update')) with check (ops_core.has_permission('procurement.update'));
create policy projects_new   on ops_procure.projects       for insert to authenticated with check (ops_core.has_permission('project.create'));
create policy projects_edit  on ops_procure.projects       for update to authenticated using (ops_core.has_permission('project.update')) with check (ops_core.has_permission('project.update'));
create policy plines_write   on ops_procure.project_lines  for all    to authenticated using (ops_core.has_permission('project.update')) with check (ops_core.has_permission('project.update'));

grant usage on schema ops_procure to authenticated;
grant select on all tables in schema ops_procure to authenticated;
grant insert, update on ops_procure.vendors, ops_procure.items, ops_procure.projects, ops_procure.project_lines to authenticated;
