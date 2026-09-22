-- 0071_inv_stock.sql — the rack, and the quantity column that is not here.
--
-- **There is no quantity column anywhere.** On-hand is `sum(qty)` over the
-- moves, per item and per location, computed on read (A3, D170). The failure
-- this avoids is the one the spreadsheet already has: a stored quantity that
-- disagrees with its own history, discovered by somebody standing in front of
-- an empty rack.

create type ops_inv.stock_move_kind_t as enum
  ('receipt','issue','return','adjust','transfer');

insert into ops_core.doc_prefixes (prefix, what) values ('stk', 'stock move');

-- Deliberately few: a location nobody walks to is a location nobody counts.
create table ops_inv.stock_locations (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true
);

insert into ops_inv.stock_locations (code, name) values
  ('GUDANG','Gudang utama'),
  ('BENGKEL','Rak bengkel'),
  ('FINISHING','Gudang finishing');

-- Which categories sit on a rack and are counted (D169). Everything else is
-- bought and gone the same day — a service, the electricity bill, an item
-- nobody has filed yet.
--
-- **Data, not a constant.** The demo holds this as a hard-coded set whose
-- members (`kayu`, `panel`, `cat`, `kemasan`…) are not the categories `0006`
-- actually seeded (`raw-wood`, `hardware`, `finishing`…). Two vocabularies for
-- one list, and the swap would have shown a different rack (F110). A table
-- also means the answer changes without a deployment.
create table ops_inv.stocked_categories (
  category_code  text primary key references ops_procure.item_categories(code)
);

insert into ops_inv.stocked_categories (category_code) values
  ('production'), ('raw-wood'), ('hardware'), ('sanding'),
  ('finishing'), ('packing'), ('machining'), ('office');
-- `service` and `uncurated` are deliberately absent: one is never on a rack,
-- and the other is *nobody has filed this yet*, which is not the same as *this
-- lives in the gudang*.

create table ops_inv.stock_settings (
  -- `ops_procure.items.code`, at the seam (ADR-004).
  item_code      text primary key,
  -- Null is not a satisfied minimum — the screen says *belum ditetapkan*.
  min_qty        numeric check (min_qty is null or min_qty >= 0),
  home_location  text references ops_inv.stock_locations(code)
);

create table ops_inv.stock_moves (
  id          uuid primary key default gen_random_uuid(),
  move_no     text not null unique default ops_core.next_doc_number('stk'),
  item_code   text not null,
  location    text not null references ops_inv.stock_locations(code),
  kind        ops_inv.stock_move_kind_t not null,
  -- **Signed.** The kind says what happened; the sign says which way, because
  -- an adjustment can go either way.
  qty         numeric not null,
  uom         text not null,
  -- What one unit cost, where that is known. Null is honest — a transfer has
  -- no price and a receipt off an unpriced line has none either. **Never
  -- written as zero**, because zero quietly values the rack down (D172).
  unit_cost   numeric check (unit_cost is null or unit_cost > 0),
  -- The document behind it: `rcv-…`, `spk-…`, an opname reference.
  ref_no      text,
  reason      text,
  moved_by    uuid not null references ops_core.users(id),
  moved_at    timestamptz not null default now(),

  -- A zero move says nothing and clutters the one history somebody reads.
  constraint qty_says_something check (qty <> 0),
  -- The sentence **is** the record; "adjustment" alone is a shrug (D171).
  constraint adjust_says_why check (
    kind <> 'adjust' or (reason is not null and length(btrim(reason)) > 0)),
  -- A receipt adds stock and an issue takes it off. Getting the sign wrong on
  -- either is a rack that disagrees with the floor, and neither kind has a
  -- reading where the other sign makes sense.
  constraint receipt_adds check (kind <> 'receipt' or qty > 0),
  constraint issue_removes check (kind <> 'issue' or qty < 0)
);

-- Confirming the same delivery twice stocks it once (D170).
create unique index stock_receipt_once_idx
  on ops_inv.stock_moves (ref_no, item_code)
  where kind = 'receipt' and ref_no is not null;

create index stock_item_idx on ops_inv.stock_moves (item_code, location);

-- ── what is on the rack ───────────────────────────────────────────────────
create or replace view ops_inv.v_stock_by_location as
select
  m.item_code,
  m.location,
  l.name as location_name,
  sum(m.qty) as qty
from ops_inv.stock_moves m
join ops_inv.stock_locations l on l.code = m.location
group by m.item_code, m.location, l.name
having sum(m.qty) <> 0;

-- One row per stocked item, **including the ones that have never moved**.
-- *We have none* and *nobody has ever bought this* look identical on a screen
-- that hides the second, and they lead to opposite actions (D170).
create or replace view ops_inv.v_stock_item as
select
  i.code                                   as item_code,
  i.name                                   as item_name,
  i.category_code,
  c.name                                   as category_name,
  i.base_uom                               as uom,
  coalesce(mv.on_hand, 0)                  as on_hand,
  -- Weighted average over the **priced incoming** moves, applied to what is on
  -- hand. Two decisions, both deliberate (D172): a move that arrived unpriced
  -- is counted and left out of the average rather than valued at nought, and
  -- **issues are not valued at all** — costing what left the rack is a
  -- different question with three answers and nobody has chosen (Q43).
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty)::bigint end as avg_cost,
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty
               * greatest(coalesce(mv.on_hand, 0)
                          - least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)), 0))::bigint
    end as value,
  -- Capped at what is actually still on the rack: eight unpriced sheets that
  -- have since been used are not eight unknowns today.
  least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)) as unpriced_qty,
  s.min_qty,
  -- False when nobody set one. **An unstated minimum is not a satisfied one**,
  -- and it must not read as a rack in good order.
  (s.min_qty is not null and coalesce(mv.on_hand, 0) < s.min_qty) as below_min,
  s.home_location,
  mv.last_move_at,
  coalesce(mv.moves_count, 0)              as moves_count
from ops_procure.items i
join ops_procure.item_categories c on c.code = i.category_code
join ops_inv.stocked_categories sc on sc.category_code = i.category_code
left join ops_inv.stock_settings s on s.item_code = i.code
left join lateral (
  select
    sum(qty)                                                        as on_hand,
    sum(qty) filter (where qty > 0 and unit_cost is not null)       as priced_qty,
    sum(qty * unit_cost) filter (where qty > 0 and unit_cost is not null) as priced_cost,
    -- Only a **receipt** can arrive unpriced and still be stock somebody has
    -- to account for; a transfer in has a price somewhere else already.
    sum(qty) filter (where qty > 0 and unit_cost is null and kind = 'receipt') as unpriced_in,
    max(moved_at)                                                   as last_move_at,
    count(*)::int                                                   as moves_count
  from ops_inv.stock_moves m where m.item_code = i.code
) mv on true
-- A merged item is the same thing under an old name; counting it twice is the
-- merge undone (D33).
where i.merged_into is null;

-- ── access ────────────────────────────────────────────────────────────────
-- The **fourth** additive policy on a procurement table, and the second on
-- `items` (F104, F111). A stock list reads the catalogue for every name,
-- category and unit it shows; without this, `v_stock_item` returns not a
-- single row to somebody holding `inventory` — no error, an empty rack.
--
-- Four is past the point where this belongs in one place. It cannot go there
-- from here: `items_read` lives in `0006`, which has been applied (0028), so
-- an additive policy is the only door left open to this branch. What the
-- procurement session should write instead is named in F111.
create policy items_read_inventory on ops_procure.items for select to authenticated
  using (ops_core.has_permission('inventory.read'));

alter table ops_inv.stock_locations     enable row level security;
alter table ops_inv.stocked_categories  enable row level security;
alter table ops_inv.stock_settings      enable row level security;
alter table ops_inv.stock_moves         enable row level security;

create policy loc_read  on ops_inv.stock_locations    for select to authenticated using (true);
create policy scat_read on ops_inv.stocked_categories for select to authenticated using (true);

create policy setting_read on ops_inv.stock_settings for select to authenticated
  using (ops_core.has_permission('inventory.read'));
create policy setting_new  on ops_inv.stock_settings for insert to authenticated
  with check (ops_core.has_permission('inventory.update'));
create policy setting_edit on ops_inv.stock_settings for update to authenticated
  using (ops_core.has_permission('inventory.update')) with check (ops_core.has_permission('inventory.update'));

create policy moves_read on ops_inv.stock_moves for select to authenticated
  using (ops_core.has_permission('inventory.read'));
-- An **adjustment** asks for `inventory.adjust`, not `inventory.create`.
-- Receiving and issuing are the ordinary day; declaring that the rack holds
-- something other than its own history says is the one move nobody counted
-- into (D171).
--
-- Be exact about what that buys today: the catalogue lists `adjust` as its own
-- action but **not** as `admin_only`, so anybody at `write` already holds both
-- and the policy separates nothing for them. It bites for a `read`-level user,
-- and it is written this way so that making `adjust` admin-only is one row in
-- `permission_catalog` rather than a policy change here. Whether it *should*
-- be admin-only is the owner's call and has not been asked.
create policy moves_new on ops_inv.stock_moves for insert to authenticated
  with check (
    (kind = 'adjust' and ops_core.has_permission('inventory.adjust'))
    or (kind <> 'adjust' and ops_core.has_permission('inventory.create')));
-- No update policy and no delete policy: a mistake is another move with a
-- reason (A5, D171).

alter view ops_inv.v_stock_by_location set (security_invoker = on);
alter view ops_inv.v_stock_item        set (security_invoker = on);

grant select on all tables in schema ops_inv to authenticated;
grant insert, update on ops_inv.stock_settings to authenticated;
grant insert on ops_inv.stock_moves to authenticated;
