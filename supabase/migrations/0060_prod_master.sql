-- 0060_prod_master.sql — the things we make, and what goes into one.
--
-- ## Why 0060 rather than 0050
--
-- HR took 0040–0049 and `0050_hr_kpi` is a reserved row in the ladder.
-- Production takes **0060 upward**, so the two can be worked on in either
-- order without either one reaching into the other's numbers. The reservation
-- costs nothing: `rebuild.sh` applies in lexical order and never asks why 0050
-- is missing.
--
-- ## Why products are not `procure.items` (D149)
--
-- Those are things we *buy*, and half of them are uncurated by design, because
-- a purchase can name something nobody has catalogued. A product is the
-- opposite: quoted to a client, put on a work order, made. It exists before
-- anything references it and is always curated. The two meet in
-- `bom_components`, which points at an item **by code**, at the seam — never a
-- foreign key across services (ADR-004).

create type ops_prod.bom_ref_t as enum ('material','product');

create table ops_prod.products (
  id              uuid primary key default gen_random_uuid(),
  -- On the drawing, the work order and every BOM that references it, so it is
  -- set once — see the trigger below.
  product_code    text not null unique,
  name            text not null check (length(btrim(name)) > 0),
  -- Meja, Kursi, Lemari, Pintu — a word, not a hierarchy.
  category        text not null,
  uom             text not null,
  description     text,
  -- Millimetres, one number per axis (D150). Structured rather than free text
  -- because *ukuran* is a thing the system has to be able to check for, and a
  -- sentence cannot be checked. Anything that is not an axis — a diameter, a
  -- thickness, a radius — goes in `dimension_note`, which is where the free
  -- text went rather than being lost.
  length_mm       int check (length_mm is null or length_mm > 0),
  width_mm        int check (width_mm  is null or width_mm  > 0),
  height_mm       int check (height_mm is null or height_mm > 0),
  dimension_note  text,
  -- A hint for promising a date, never a schedule: the work order carries the
  -- date that was actually promised.
  lead_time_days  int check (lead_time_days is null or lead_time_days >= 0),
  -- Which of the owner's four stages this product actually goes through (Q52,
  -- D278). **Null is not "all four"** — it means nobody has said yet, and the
  -- board falls back to the route's stages and marks the product as one
  -- somebody should look at. What is missing is named, never filled in by
  -- software (D150).
  --
  -- Not a foreign key into `process_stages`: that table arrives with
  -- `prod_orders`, and a product catalogued before the stage list exists is
  -- the ordinary case rather than an error (A6).
  stages          text[],
  -- What the workshop's own time on one unit costs, **typed by a person**
  -- (D239). Nothing here derives it — not from the pay rules, not from
  -- recorded hours, not from a rate times a guess. Labour is where an invented
  -- number does the most damage, because it flows straight into a quoted price.
  labour_cost     bigint check (labour_cost is null or labour_cost >= 0),
  labour_note     text,
  active          boolean not null default true,
  note            text,
  created_by      uuid references ops_core.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A labour cost with no working behind it is a number the next person can
  -- neither check nor update.
  constraint labour_shows_its_working check (
    labour_cost is null or (labour_note is not null and length(btrim(labour_note)) > 0)),
  -- An empty array is a different claim from null and a meaningless one: it
  -- says *this product goes through no stages at all*.
  constraint stages_not_empty check (stages is null or cardinality(stages) > 0)
);

create index products_active_idx on ops_prod.products (category) where active;

-- `product_code` is on the drawing, the work order and every BOM line that
-- quotes it. Changing it silently re-points every one of those at nothing, and
-- none of them is a foreign key that would complain (ADR-004).
create or replace function ops_prod.product_code_is_permanent()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
begin
  if new.product_code is distinct from old.product_code then
    raise exception 'product_code % is on drawings and work orders and cannot be changed to %',
      old.product_code, new.product_code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger product_code_is_permanent
  before update on ops_prod.products
  for each row execute function ops_prod.product_code_is_permanent();

-- ── the bill of material, versioned ───────────────────────────────────────
--
-- The owner reversed the default on Q36: a BOM **is** versioned (D256). The
-- default had been current-state with every change audited, which keeps the
-- history and loses the **pinning** — a wardrobe built in June reads today as
-- though it had always used today's components, and the projection against
-- what was actually bought becomes a comparison with the wrong list.
create table ops_prod.bom_revisions (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references ops_prod.products(id),
  rev          int not null check (rev > 0),
  -- Null while it is a draft. Set once and never cleared: releasing is what
  -- makes the revision a fact rather than a working copy (A5).
  released_at  timestamptz,
  released_by  uuid references ops_core.users(id),
  -- Why this version exists. Required to release — *rev 3* with no sentence is
  -- a number somebody has to reverse-engineer from a diff.
  note         text,
  created_by   uuid references ops_core.users(id),
  created_at   timestamptz not null default now(),
  constraint rev_once unique (product_id, rev),
  constraint release_is_signed check ((released_at is null) = (released_by is null)),
  constraint release_says_why check (
    released_at is null or (note is not null and length(btrim(note)) > 0))
);

-- At most one draft per product. A second would raise the question of which
-- the next work order pins to, and there is no answer to that worth having.
create unique index bom_one_draft_idx on ops_prod.bom_revisions (product_id)
  where released_at is null;

create or replace function ops_prod.release_is_permanent()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
begin
  if old.released_at is not null and new.released_at is distinct from old.released_at then
    raise exception 'rev % was released on %; a released revision is frozen (A5)',
      old.rev, old.released_at using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger release_is_permanent
  before update on ops_prod.bom_revisions
  for each row execute function ops_prod.release_is_permanent();

create table ops_prod.bom_components (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references ops_prod.products(id),
  -- The revision this line belongs to. A line is never moved between them:
  -- opening a new draft **copies** the released one, so the released lines
  -- stay exactly as they were released (A5).
  rev            int not null check (rev > 0),
  kind           ops_prod.bom_ref_t not null,
  -- `ops_procure.items.code`, or another `products.product_code`.
  --
  -- **Deliberately not a foreign key.** The workshop knows it needs a steel
  -- frame before procurement has a code for one, and refusing the line would
  -- send the drawing back to paper. Unresolved codes are shown, not refused
  -- (A6) — `v_product_bom` reports them as unpriced and unnamed.
  ref_code       text not null check (length(btrim(ref_code)) > 0),
  -- Per ONE unit of the parent.
  qty            numeric not null check (qty > 0),
  uom            text not null,
  -- Susut. 10 means 10%, so 2 m² of board at 10% needs 2,2 m² bought. Kept
  -- apart from `qty` because what the drawing says goes in and what has to be
  -- bought are different numbers, and a workshop that conflates them runs out
  -- on a Saturday (D149).
  waste_percent  numeric not null default 0 check (waste_percent >= 0 and waste_percent <= 90),
  note           text,
  -- One line per component per revision. Change the quantity; do not add a
  -- second row.
  constraint component_once unique (product_id, rev, ref_code),
  constraint component_belongs_to_a_rev
    foreign key (product_id, rev) references ops_prod.bom_revisions (product_id, rev)
);

-- A product cannot be a component of itself. The **indirect** case — A holds
-- B holds A — needs a walk of the whole tree and belongs with the explosion
-- (D257), which is a migration of its own; this catches the one that is a
-- typo rather than a design error.
create or replace function ops_prod.component_is_not_its_parent()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
declare parent text;
begin
  if new.kind <> 'product' then return new; end if;
  select product_code into parent from ops_prod.products where id = new.product_id;
  if parent = new.ref_code then
    raise exception '% cannot be a component of itself', parent using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger component_is_not_its_parent
  before insert or update on ops_prod.bom_components
  for each row execute function ops_prod.component_is_not_its_parent();

-- ── what one unit is made of, priced ──────────────────────────────────────
--
-- One level deep. Walking sub-assemblies compounds the waste and merges the
-- same material reached by two routes, and that is `explodeBom`'s job (D257)
-- — a recursive walk with cycle detection, in its own migration.
--
-- The price is the catalogue's **standard price**, falling back to the **last
-- price paid**, and the view says which. A component nobody has priced makes
-- the total **incomplete, never zero**: a zero would read as free.
create or replace view ops_prod.v_product_bom as
select
  c.id,
  c.product_id,
  p.product_code,
  c.rev,
  c.kind,
  c.ref_code,
  coalesce(i.name, sub.name)                           as ref_name,
  c.qty,
  c.uom,
  c.waste_percent,
  round(c.qty * (1 + c.waste_percent / 100), 4)        as qty_with_waste,
  coalesce(i.standard_price, i.last_price)             as unit_price,
  case when i.standard_price is not null then 'standard'
       when i.last_price     is not null then 'last_paid'
       else null end                                   as price_source,
  case when coalesce(i.standard_price, i.last_price) is null then null
       else round(c.qty * (1 + c.waste_percent / 100)
                  * coalesce(i.standard_price, i.last_price)) end as subtotal,
  c.note
from ops_prod.bom_components c
join ops_prod.products p on p.id = c.product_id
-- Resolved by **code**, at the seam. Not a join a foreign key guarantees —
-- which is the point: a code procurement has never heard of comes back null
-- and is reported, not refused.
left join ops_procure.items i on i.code = c.ref_code and c.kind = 'material'
left join ops_prod.products sub on sub.product_code = c.ref_code and c.kind = 'product';

-- The roll-up, per product per revision. `material_cost` is null — not zero —
-- while anything in the list has no price, because a total that silently omits
-- a line is the number somebody quotes from.
create or replace view ops_prod.v_product_cost as
select
  b.product_id,
  b.product_code,
  b.rev,
  count(*)::int                                          as components,
  count(*) filter (where b.unit_price is null)::int      as unpriced,
  count(*) filter (where b.ref_name is null)::int        as unresolved,
  case when count(*) filter (where b.unit_price is null) > 0 then null
       else sum(b.subtotal)::bigint end                  as material_cost,
  sum(b.subtotal)::bigint                                as priced_subtotal,
  p.labour_cost
from ops_prod.v_product_bom b
join ops_prod.products p on p.id = b.product_id
group by b.product_id, b.product_code, b.rev, p.labour_cost;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_prod.products       enable row level security;
alter table ops_prod.bom_revisions  enable row level security;
alter table ops_prod.bom_components enable row level security;

-- The catalogue is read by everybody who has to name a thing: production,
-- procurement raising a PR from a BOM, and the project screens quoting one.
create policy products_read on ops_prod.products for select to authenticated using (true);
create policy products_new  on ops_prod.products for insert to authenticated
  with check (ops_core.has_permission('production.create'));
create policy products_edit on ops_prod.products for update to authenticated
  using (ops_core.has_permission('production.update')) with check (ops_core.has_permission('production.update'));

-- Deleting needs a word about rule 1 — *nothing is deleted, no DELETE policy,
-- no DELETE grant* (A2). A **draft** revision is the exception that proves it:
-- it is a working copy nobody has released, removing a line from it is
-- ordinary editing, and there is no record to lose. A **released** revision is
-- the opposite — it is the thing a June work order is pinned to, and a line
-- deleted out of it silently rewrites what that wardrobe was made of.
--
-- So DELETE exists and is bounded by the draft, in the policy rather than in
-- whoever is calling: a blanket grant here would have let a released BOM be
-- edited by deletion, which is precisely the pinning D256 exists to protect.
create policy bomrev_read  on ops_prod.bom_revisions for select to authenticated using (true);
create policy bomrev_new   on ops_prod.bom_revisions for insert to authenticated
  with check (ops_core.has_permission('production.create'));
create policy bomrev_edit  on ops_prod.bom_revisions for update to authenticated
  using (ops_core.has_permission('production.update'))
  with check (ops_core.has_permission('production.update'));
create policy bomrev_drop  on ops_prod.bom_revisions for delete to authenticated
  using (ops_core.has_permission('production.update') and released_at is null);

create policy bomcomp_read on ops_prod.bom_components for select to authenticated using (true);
create policy bomcomp_new  on ops_prod.bom_components for insert to authenticated
  with check (ops_core.has_permission('production.create')
              and exists (select 1 from ops_prod.bom_revisions r
                           where r.product_id = bom_components.product_id
                             and r.rev = bom_components.rev and r.released_at is null));
create policy bomcomp_edit on ops_prod.bom_components for update to authenticated
  using (ops_core.has_permission('production.update')
         and exists (select 1 from ops_prod.bom_revisions r
                      where r.product_id = bom_components.product_id
                        and r.rev = bom_components.rev and r.released_at is null))
  with check (ops_core.has_permission('production.update'));
create policy bomcomp_drop on ops_prod.bom_components for delete to authenticated
  using (ops_core.has_permission('production.update')
         and exists (select 1 from ops_prod.bom_revisions r
                      where r.product_id = bom_components.product_id
                        and r.rev = bom_components.rev and r.released_at is null));

-- ── one policy on somebody else's table, and why ──────────────────────────
--
-- `v_product_bom` resolves a component to a name and a price out of
-- `ops_procure.items`, and the view carries the reader's rights. A workshop
-- user holds `production` and not `procurement`, so `items_read` hid every row
-- from them and the whole BOM came back **unnamed and unpriced** — not an
-- error, just plausible nulls, which is the failure mode this project keeps
-- finding (F104).
--
-- Policies are OR'd, so this is additive: procurement's own policy is
-- untouched and this one sits beside it. The argument is procurement's own,
-- written in `0006` about projects — *read by everybody who can open any
-- module that spends against them; hiding the list would make every "which job
-- is this for?" unanswerable*. A BOM line whose item cannot be named makes
-- *what is this component* unanswerable in exactly the same way.
--
-- Scoped to `production.read`, not `true`: the rest of procurement — vendors,
-- orders, what was paid — stays where it was.
create policy items_read_production on ops_procure.items for select to authenticated
  using (ops_core.has_permission('production.read'));

alter view ops_prod.v_product_bom  set (security_invoker = on);
alter view ops_prod.v_product_cost set (security_invoker = on);

grant usage on schema ops_prod to authenticated;
grant select on all tables in schema ops_prod to authenticated;
grant insert, update on ops_prod.products to authenticated;
grant insert, update, delete on ops_prod.bom_revisions, ops_prod.bom_components to authenticated;
