-- 0061_prod_orders.sql — the vocabulary, the order it goes in, and the order itself.
--
-- The ladder's row for this file said *seven stages as data (Q35)*. There are
-- **four**, and that is not a drafting slip: the owner named his own when Q47
-- asked whether ours were right (D275), and Q52 then made them a property of
-- the product rather than of the route (D278). Two of ours are not in his list
-- and the absence is the substance of the answer.
--
--   *Pembuatan* is gone because the business buys `barang mentah` — the rough
--   piece arrives cut and assembled, so the first thing that happens to it
--   here is sanding. Ours began with a stage the workshop does not do.
--
--   *QC* is gone too and nothing in his answers explains it, so it was asked
--   again as Q51 and confirmed: his four stand. Old `QC` entries are not
--   orphaned — they roll into Packing, the step they always came immediately
--   before.
--
-- Stages are **seeded rather than typed**, so every screen says the same thing
-- and the order is checkable. The roll-up needs the old codes too, which is
-- why there are three tables here and not one.

create type ops_prod.route_t as enum ('IN_HOUSE','SUBCON');

-- The owner's four.
create table ops_prod.process_stages (
  code    text primary key,
  name    text not null,
  -- 1-based. A piece cannot be finished before it is built, and the order is
  -- what makes that checkable.
  seq     int not null unique check (seq > 0),
  -- What the workshop actually does inside it, for the screen. Not stages —
  -- nobody reports against these; they are here so a one-word stage name is
  -- not something somebody has to interpret.
  covers  text not null
);

insert into ops_prod.process_stages (code, name, seq, covers) values
  ('AMPLAS',   'Sanding / amplas',      1, 'menghaluskan barang mentah dari vendor'),
  ('FINISHING','Finishing',             2, 'cat · coating · politur'),
  ('MACHINERY','Machinery / instalasi', 3, 'lampu, kabel, rel, mekanisme'),
  ('PACKING',  'Packing',               4, 'bungkus, siap kirim');

-- Every stage code that counts towards one of the four, old and new.
--
-- Progress already recorded **keeps its own stage code** — nothing that
-- happened is rewritten (A5) — so the old codes stay in the data and roll up
-- on read. Two things about that roll-up, and the second is the trap.
--
-- **It is a minimum, not a sum.** Four chairs cut, four planed and four
-- assembled is four chairs made, not twelve.
--
-- **A stage is a source of itself.** `FINISHING` names one of the four *and*
-- one of the seven that collapsed into it, so an entry reading `FINISHING`
-- cannot be told apart from a new one — and adding "the direct entries" to
-- "the rolled-up ones" counted the same pieces twice, as amplas 4 + finishing
-- 3 = 7 of an order for 4 (F74). Listing every source, the stage's own code
-- included, removes the distinction rather than trying to guess it.
create table ops_prod.stage_sources (
  source_code  text primary key,
  source_name  text not null,
  stage_code   text not null references ops_prod.process_stages(code)
);

insert into ops_prod.stage_sources (source_code, source_name, stage_code) values
  ('AMPLAS',   'Amplas',                'AMPLAS'),
  ('FINISHING','Finishing',             'FINISHING'),
  ('MACHINERY','Machinery / instalasi', 'MACHINERY'),
  ('QC',       'QC',                    'PACKING'),
  ('PACKING',  'Packing',               'PACKING');

-- Codes that were once part of the route and roll into **nothing**.
--
-- Not a roll-up target: `POTONG`, `SERUT` and `RAKIT` are work the business
-- now buys in as barang mentah, and folding them into Sanding would claim that
-- six pieces were sanded because six were cut. They keep their names so a work
-- order from August still reads correctly, and they sit outside the four
-- rather than inside one of them (D275).
create table ops_prod.retired_stages (
  code  text primary key,
  name  text not null
);

insert into ops_prod.retired_stages (code, name) values
  ('POTONG',   'Potong'),
  ('SERUT',    'Serut / bentuk'),
  ('RAKIT',    'Rakit'),
  ('PEMBUATAN','Pembuatan');

-- The label a screen prints, kept beside the code the column stores — the same
-- arrangement `core.doc_kind_labels` uses, and for the same reason: a stored
-- value should not change when somebody rewords a label.
create table ops_prod.routes (
  code         ops_prod.route_t primary key,
  name         text not null,
  description  text not null
);

insert into ops_prod.routes (code, name, description) values
  ('IN_HOUSE','Dikerjakan sendiri',
   'Barang mentah dihaluskan, difinishing, dipasangi kelengkapannya, lalu dibungkus di bengkel sendiri.'),
  ('SUBCON','Dilempar ke vendor',
   'Ada proses yang dikerjakan vendor. Yang membedakan bukan tahapannya, melainkan siapa yang memegang barangnya dan kapan.');

-- A route is a **list of stages**, not a flag, because what differs between
-- them is exactly which stages apply (D254). A subcontracted order does not
-- have *Pembuatan at 0%* — it does not have Pembuatan, and rendering an absent
-- stage as an empty bar says *nobody has started building this*, which is
-- false about goods a vendor already built.
--
-- The two lists are identical today, and that is the honest reading of the
-- owner's answers rather than an oversight: once barang mentah is bought in
-- for everything (Q48), what separates a subcontracted order is **who held the
-- piece and when** — which is the vendor leg's job, not the route's.
create table ops_prod.route_stages (
  route_code  ops_prod.route_t not null references ops_prod.routes(code),
  stage_code  text not null references ops_prod.process_stages(code),
  seq         int not null check (seq > 0),
  primary key (route_code, stage_code),
  constraint route_seq_once unique (route_code, seq)
);

insert into ops_prod.route_stages (route_code, stage_code, seq)
select r.code, s.code, s.seq
  from ops_prod.routes r cross join ops_prod.process_stages s;

-- ── the order ─────────────────────────────────────────────────────────────
create table ops_prod.work_orders (
  id                uuid primary key default gen_random_uuid(),
  wo_no             text not null unique default ops_core.next_doc_number('spk'),
  -- The catalogue product, where there is one — which is what lets a
  -- customer's order line and the floor be compared (D150). Null for a one-off
  -- nobody has catalogued. A code at the seam, never a foreign key (ADR-004).
  product_code      text,
  -- What is being made, in the workshop's own words. Kept even when a product
  -- is named: a work order says what it said on the day it was written.
  item_name         text not null check (length(btrim(item_name)) > 0),
  description       text,
  qty               numeric not null check (qty > 0),
  uom               text not null,
  project_code      text,
  -- The whole point of the record. A workshop always knows what it is
  -- building; what it loses track of is which of the eleven things on the
  -- floor is the one that is late. So: not null, and a promise rather than a
  -- plan.
  due_date          date not null,
  route             ops_prod.route_t not null references ops_prod.routes(code),
  -- The BOM revision this order was written against, pinned at creation
  -- (D256). **Null is not "the current one"** — it means the order predates
  -- versioning or its product has no released BOM, and the screen says so
  -- rather than showing today's list as though it were the one used. A figure
  -- may be missing; it may not be quietly wrong.
  bom_rev           int check (bom_rev is null or bom_rev > 0),
  status            ops_prod.work_order_status_t not null default 'OPEN',
  cancelled_reason  text,
  note              text,
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now(),

  constraint pinned_rev_needs_a_product check (bom_rev is null or product_code is not null),
  constraint cancel_says_why check (
    status <> 'CANCELLED' or (cancelled_reason is not null and length(btrim(cancelled_reason)) > 0))
);

create index wo_open_idx on ops_prod.work_orders (due_date) where status = 'OPEN';
create index wo_project_idx on ops_prod.work_orders (project_code);

-- A pin points at a **released** revision of **this order's own product**.
-- Neither half is a foreign key that could enforce it: `product_code` is a
-- code at the seam, and `released_at` is a column rather than a table.
create or replace function ops_prod.pin_is_a_released_rev()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
begin
  if new.bom_rev is null then return new; end if;
  if not exists (
    select 1 from ops_prod.bom_revisions r
      join ops_prod.products p on p.id = r.product_id
     where p.product_code = new.product_code
       and r.rev = new.bom_rev
       and r.released_at is not null
  ) then
    raise exception 'rev % of % is not a released revision; an order cannot pin to a draft',
      new.bom_rev, new.product_code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger pin_is_a_released_rev
  before insert or update on ops_prod.work_orders
  for each row execute function ops_prod.pin_is_a_released_rev();

-- ── which stages this order actually goes through ─────────────────────────
--
-- The product's own, where somebody has set them (Q52, D278) — a dining table
-- has no lamps or cables in it, and drawing it a *Machinery* column it will
-- never fill made every later stage look like it had jumped a step (F92).
--
-- **Null is not "all four".** It means nobody has set the product up, the
-- order falls back to its route's stages, and `stages_from` says which of the
-- two is happening rather than leaving the reader to guess. What is missing is
-- named, never filled in by software (D150).
create or replace view ops_prod.v_work_order_stage as
select
  w.id            as wo_id,
  w.wo_no,
  s.code          as stage_code,
  s.name          as stage_name,
  s.seq,
  case when p.stages is null then 'route' else 'product' end as stages_from
from ops_prod.work_orders w
left join ops_prod.products p on p.product_code = w.product_code
join ops_prod.process_stages s
  on s.code = any(coalesce(
       p.stages,
       (select array_agg(rs.stage_code order by rs.seq)
          from ops_prod.route_stages rs where rs.route_code = w.route)));

-- ── access ────────────────────────────────────────────────────────────────
--
-- The vocabulary is reference data: readable by anyone signed in, the same as
-- `uom` and `item_categories` in `0006`. Nothing writes it but a migration.
alter table ops_prod.process_stages enable row level security;
alter table ops_prod.stage_sources  enable row level security;
alter table ops_prod.retired_stages enable row level security;
alter table ops_prod.routes         enable row level security;
alter table ops_prod.route_stages   enable row level security;
alter table ops_prod.work_orders    enable row level security;

create policy stages_read   on ops_prod.process_stages for select to authenticated using (true);
create policy sources_read  on ops_prod.stage_sources  for select to authenticated using (true);
create policy retired_read  on ops_prod.retired_stages for select to authenticated using (true);
create policy routes_read   on ops_prod.routes         for select to authenticated using (true);
create policy rstages_read  on ops_prod.route_stages   for select to authenticated using (true);

-- The order is read by the floor, by the project screens asking where their
-- goods are, and by procurement raising a PR against it.
create policy wo_read on ops_prod.work_orders for select to authenticated using (true);
create policy wo_new  on ops_prod.work_orders for insert to authenticated
  with check (ops_core.has_permission('production.create'));
create policy wo_edit on ops_prod.work_orders for update to authenticated
  using (ops_core.has_permission('production.update'))
  with check (ops_core.has_permission('production.update'));
-- No delete: a cancelled order with its reason is the record (A2).

alter view ops_prod.v_work_order_stage set (security_invoker = on);

grant select on all tables in schema ops_prod to authenticated;
grant insert, update on ops_prod.work_orders to authenticated;
