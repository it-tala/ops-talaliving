-- 0065_prod_bom_explode.sql — every purchasable thing a run needs, with the
-- sub-assemblies walked through (D257).
--
-- Three things a flat read cannot do, and each is a rule rather than a detail:
--
--   **Waste compounds.** Ten per cent more drawer boxes is ten per cent more
--   of the plywood inside each one. The multiplier carries down the tree, so
--   the figure at the bottom already contains every susut above it.
--
--   **The same material reached by two routes is one line** — a purchase
--   request wants one row per thing to buy — **with both routes named**,
--   because *why do I need forty screws* is the next question.
--
--   **A sub-assembly with no released BOM stays in the list as itself**, named
--   as unexploded. Something that has to be obtained somehow is not nothing,
--   and dropping it would be the silent kind of wrong.
--
-- And a fourth the others make possible: a **cycle** is reported rather than
-- walked. A holds B holds A is a data error somebody has to fix, and a
-- recursion that simply stops leaves them wondering why the list is short.

-- The revision a sub-assembly is read at: its newest **released** one. A draft
-- is somebody's working copy, and a run must not be costed against a list that
-- is still being edited.
create or replace function ops_prod.released_rev(p_product_id uuid)
returns int
language sql stable set search_path = ops_prod, pg_temp as $$
  select max(rev) from ops_prod.bom_revisions
   where product_id = p_product_id and released_at is not null
$$;

-- The revision the **starting** product is read at when the caller names none:
-- the draft if there is one, otherwise the released.
--
-- The opposite preference from a sub-assembly's, and deliberately: *what would
-- this cost* is a question asked **about** a draft, before anybody commits to
-- it (D175). A sub-assembly is not the thing being asked about, so it answers
-- with what the workshop would actually build from.
create or replace function ops_prod.start_rev(p_product_id uuid)
returns int
language sql stable set search_path = ops_prod, pg_temp as $$
  select coalesce(
    (select rev from ops_prod.bom_revisions
      where product_id = p_product_id and released_at is null limit 1),
    ops_prod.released_rev(p_product_id))
$$;

create type ops_prod.bom_exploded_line as (
  ref_code     text,
  ref_name     text,
  kind         ops_prod.bom_ref_t,
  qty          numeric,
  uom          text,
  unit_price   numeric,
  price_source text,
  subtotal     bigint,
  -- Every route this material was reached by, each one a `>`-joined path of
  -- product codes. One entry for a direct component; several when two
  -- sub-assemblies both call for it.
  via          text[],
  depth        int,
  -- A sub-assembly that could not be broken down: no product behind the code,
  -- no released revision, or a released one with nothing in it.
  unexploded   boolean,
  -- This code appears above itself in its own tree.
  cycle        boolean
);

create or replace function ops_prod.explode_bom(
  p_product_code text, p_qty numeric, p_rev int default null)
returns setof ops_prod.bom_exploded_line
language sql stable set search_path = ops_prod, pg_temp as $$
  with recursive root as (
    select p.id, p.product_code, coalesce(p_rev, ops_prod.start_rev(p.id)) as rev
      from ops_prod.products p where p.product_code = p_product_code
  ),
  walk as (
    select
      c.ref_code,
      c.kind,
      c.uom,
      -- The root's own quantity times the line, times its waste.
      (p_qty * c.qty * (1 + c.waste_percent / 100))::numeric as amount,
      array[r.product_code]::text[]                          as chain,
      array[]::text[]                                        as path,
      1                                                      as depth
    from root r
    join ops_prod.bom_components c on c.product_id = r.id and c.rev = r.rev
    union all
    select
      c.ref_code,
      c.kind,
      c.uom,
      -- **Waste compounds**: the parent's amount already carries its own.
      (w.amount * c.qty * (1 + c.waste_percent / 100))::numeric,
      w.chain || sub.product_code,
      w.path  || sub.product_code,
      w.depth + 1
    from walk w
    join ops_prod.products sub on sub.product_code = w.ref_code
    join ops_prod.bom_components c
      on c.product_id = sub.id and c.rev = ops_prod.released_rev(sub.id)
    where w.kind = 'product'
      -- A code already on the way down is not walked again. The row itself is
      -- kept and reported as a cycle below.
      and not (sub.product_code = any(w.chain))
  ),
  classified as (
    select
      w.*,
      (w.kind = 'product' and w.ref_code = any(w.chain))            as is_cycle,
      (w.kind = 'product' and w.ref_code <> all(w.chain)
       and not exists (
         select 1 from ops_prod.products s
           join ops_prod.bom_components bc
             on bc.product_id = s.id and bc.rev = ops_prod.released_rev(s.id)
          where s.product_code = w.ref_code))                       as is_unexploded
    from walk w
  ),
  -- A product row that WAS expanded contributes its children, not itself.
  kept as (
    select * from classified where kind = 'material' or is_cycle or is_unexploded
  ),
  merged as (
    select
      k.ref_code,
      min(k.kind::text)                                        as kind,
      round(sum(k.amount), 4)                                  as qty,
      min(k.uom)                                               as uom,
      max(k.depth)                                             as depth,
      bool_or(k.is_unexploded)                                 as unexploded,
      bool_or(k.is_cycle)                                      as cycle,
      -- Both routes named. `'—'` is the direct one: a component of the product
      -- itself, reached through nothing.
      array_agg(distinct case when cardinality(k.path) = 0 then '—'
                              else array_to_string(k.path, ' > ') end) as via
    from kept k group by k.ref_code
  )
  select
    m.ref_code,
    coalesce(i.name, sub.name),
    m.kind::ops_prod.bom_ref_t,
    m.qty,
    m.uom,
    coalesce(i.standard_price, i.last_price),
    case when i.standard_price is not null then 'standard'
         when i.last_price     is not null then 'last_paid'
         else null end,
    case when coalesce(i.standard_price, i.last_price) is null then null
         else round(m.qty * coalesce(i.standard_price, i.last_price))::bigint end,
    m.via,
    m.depth,
    m.unexploded,
    m.cycle
  from merged m
  left join ops_procure.items i    on i.code = m.ref_code and m.kind = 'material'
  left join ops_prod.products sub  on sub.product_code = m.ref_code and m.kind = 'product'
  order by m.depth, m.ref_code
$$;

-- What the run comes to, and how much of it is known.
create type ops_prod.bom_explosion_t as (
  product_code  text,
  qty           numeric,
  rev           int,
  lines         int,
  unpriced      int,
  unexploded    int,
  has_cycle     boolean,
  material_cost bigint,
  labour_cost   bigint,
  labour_total  bigint
);

create or replace function ops_prod.explode_summary(
  p_product_code text, p_qty numeric, p_rev int default null)
returns ops_prod.bom_explosion_t
language sql stable set search_path = ops_prod, pg_temp as $$
  select (
    p.product_code,
    p_qty,
    coalesce(p_rev, ops_prod.start_rev(p.id)),
    count(l.*)::int,
    count(*) filter (where l.subtotal is null)::int,
    count(*) filter (where l.unexploded)::int,
    coalesce(bool_or(l.cycle), false),
    -- **Null, not zero, while anything is unpriced.** A run total that quietly
    -- omits a line is the number somebody quotes from (the same rule
    -- `v_product_cost` follows).
    case when count(*) filter (where l.subtotal is null) > 0 then null
         else sum(l.subtotal)::bigint end,
    p.labour_cost,
    -- Null the moment the per-unit figure is: a run of twelve costs twelve
    -- times an unknown, which is still unknown (D239).
    case when p.labour_cost is null then null
         else round(p.labour_cost * p_qty)::bigint end
  )::ops_prod.bom_explosion_t
  from ops_prod.products p
  left join lateral ops_prod.explode_bom(p_product_code, p_qty, p_rev) l on true
  where p.product_code = p_product_code
  group by p.product_code, p.id, p.labour_cost
$$;

grant execute on function ops_prod.explode_bom(text, numeric, int),
                          ops_prod.explode_summary(text, numeric, int),
                          ops_prod.released_rev(uuid), ops_prod.start_rev(uuid)
  to authenticated;
