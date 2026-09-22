-- 0070_inv_timber.sql — a cubic metre of log is not a cubic metre of wood.
--
-- The narrowest schema in the system and the reason it exists (D153): every
-- figure the business needs about timber lives in the gap between what arrives
-- and what comes off the saw. Inventory takes the **0070 block**, after
-- production's 0060s.
--
-- Two rules carry all the weight, and both are in the views rather than in
-- whoever reads them:
--
--   **Yield and `cost_per_sawn_m3` are computed over the logs actually sawn**,
--   and over their share of the invoice. A load with three of five logs cut
--   otherwise reads as a third of the yield the sawyer is really getting, and
--   prices its wood half again too high.
--
--   **Vendors are compared within one species.** One vendor's mahoni against
--   another's jati is two different woods, and averaging them per vendor makes
--   whoever sells the cheaper species look like the better supplier of the
--   dearer one.

create table ops_inv.log_purchases (
  id            uuid primary key default gen_random_uuid(),
  purchase_no   text not null unique default ops_core.next_doc_number('kyu'),
  -- The vendor's **code**, at the seam (ADR-004). The contract calls the field
  -- `vendor_id` and its own comment calls it *a public vendor code* — C12 for
  -- the second time, and the fourth time a demo id has been both things at
  -- once.
  vendor_code   text not null,
  -- The ledger row that paid, and the request line it came from: both public
  -- codes and both optional, because a load of logs can arrive before either
  -- exists (A6).
  trx_no        text,
  pr_line_no    text,
  received_on   date not null,
  -- Jati, mahoni, sungkai — the workshop's own word, not a catalogue.
  species       text not null check (length(btrim(species)) > 0),
  -- The invoice. **Every per-cubic-metre figure on this record divides this**,
  -- which is the only reason the record exists.
  total_cost    bigint not null check (total_cost > 0),
  -- What the SELLER said the load measured. Kept **beside** our own
  -- measurement and never replaced by it: the difference between the two is
  -- the conversation with the vendor, and keeping one number loses the
  -- argument (D153).
  claimed_m3    numeric check (claimed_m3 is null or claimed_m3 > 0),
  -- Round or square, and they are 21 per cent apart (Q39). A load measured one
  -- way and read the other is a fifth of the wood.
  measure       ops_inv.log_measure_t not null,
  note          text,
  created_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now()
);

create index logs_vendor_idx on ops_inv.log_purchases (vendor_code, species);

-- One stick, with the paint mark on its end.
create table ops_inv.log_pieces (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references ops_inv.log_purchases(id),
  tag          text not null,
  -- The average of both ends. One end of a log is not the other, and the
  -- average is the measurement the yard actually takes.
  diameter_cm  numeric not null check (diameter_cm > 0),
  length_cm    numeric not null check (length_cm > 0),
  -- Null while it is still in the yard. This column is what makes yield
  -- honest: it says which logs the saw has actually seen.
  sawn_on      date,
  note         text,
  constraint piece_tag_once unique (purchase_id, tag)
);

create table ops_inv.sawn_boards (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references ops_inv.log_purchases(id),
  -- Null is ordinary: a day's sawing is usually one pile, and nobody tracks
  -- which board came off which stick.
  log_id        uuid references ops_inv.log_pieces(id),
  thickness_mm  int not null check (thickness_mm > 0),
  width_mm      int not null check (width_mm > 0),
  length_mm     int not null check (length_mm > 0),
  qty           int not null check (qty > 0),
  sawn_on       date not null,
  -- A, B, reject — free text, because the yard's grading is the yard's.
  grade         text,
  note          text,
  constraint board_belongs_to_its_load check (log_id is not null or purchase_id is not null)
);

create index boards_purchase_idx on ops_inv.sawn_boards (purchase_id);

-- A board cut from a stick that belongs to another load is a typo with a
-- foreign key behind it — both halves resolve, and the figure is wrong.
create or replace function ops_inv.board_matches_its_log()
returns trigger
language plpgsql set search_path = ops_inv, pg_temp as $$
declare owner uuid;
begin
  if new.log_id is null then return new; end if;
  select purchase_id into owner from ops_inv.log_pieces where id = new.log_id;
  if owner is distinct from new.purchase_id then
    raise exception 'that log belongs to another load' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger board_matches_its_log
  before insert or update on ops_inv.sawn_boards
  for each row execute function ops_inv.board_matches_its_log();

-- ── the volume of a stick ─────────────────────────────────────────────────
--
-- Round is π/4 × d² × L; square is d² × L, and the two are 21 per cent apart
-- (Q39) — which is why `measure` is on the purchase and not assumed.
create or replace function ops_inv.log_volume_m3(p_measure ops_inv.log_measure_t,
                                                 p_diameter_cm numeric, p_length_cm numeric)
returns numeric
language sql immutable as $$
  select case when p_measure = 'round' then pi()::numeric / 4 else 1 end
       * (p_diameter_cm / 100) ^ 2
       * (p_length_cm / 100)
$$;

-- ── per load ──────────────────────────────────────────────────────────────
create or replace view ops_inv.v_log_purchase as
select
  p.*,
  v.name as vendor_name,
  round(coalesce(pc.log_m3, 0), 4)        as log_m3,
  round(coalesce(pc.sawn_logs_m3, 0), 4)  as sawn_logs_m3,
  round(coalesce(pc.log_m3, 0) - coalesce(pc.sawn_logs_m3, 0), 4) as unsawn_m3,
  pc.pieces,
  pc.pieces_sawn,
  round(coalesce(b.sawn_m3, 0), 4)        as sawn_m3,
  -- **Over the logs actually sawn.** Dividing by the whole load reports the
  -- sawyer's work as a third of what it is, every time a load is half cut.
  case when coalesce(pc.sawn_logs_m3, 0) > 0
    then round(coalesce(b.sawn_m3, 0) / pc.sawn_logs_m3 * 100)::int end as yield_percent,
  case when coalesce(pc.log_m3, 0) > 0
    then round(p.total_cost / pc.log_m3)::bigint end as cost_per_log_m3,
  -- **Their share of the invoice**, not all of it. The two unsawn sticks are
  -- still in the yard and have not been paid for by this board.
  case when coalesce(b.sawn_m3, 0) > 0 and coalesce(pc.log_m3, 0) > 0
    then round(p.total_cost * (pc.sawn_logs_m3 / pc.log_m3) / b.sawn_m3)::bigint end
    as cost_per_sawn_m3,
  -- Ours minus theirs. Positive means we measured more than the seller
  -- claimed; the number is the conversation, so it is never resolved into one
  -- figure (D153).
  case when p.claimed_m3 is not null
    then round(coalesce(pc.log_m3, 0) - p.claimed_m3, 4) end as claimed_gap_m3,
  -- **A load is entered from its nota** (D201): the paper carries the price,
  -- the sizes and the date, and a load typed without one is a figure whose
  -- source is somebody's memory. Reported, never refused — a load that arrived
  -- is a fact whether or not the paper reached the office (A6).
  n.entity_no is not null as has_nota
from ops_inv.log_purchases p
left join ops_procure.vendors v on v.code = p.vendor_code
left join lateral (
  select
    count(*)::int                                                        as pieces,
    count(*) filter (where sawn_on is not null)::int                     as pieces_sawn,
    sum(ops_inv.log_volume_m3(p.measure, diameter_cm, length_cm))        as log_m3,
    sum(ops_inv.log_volume_m3(p.measure, diameter_cm, length_cm))
      filter (where sawn_on is not null)                                 as sawn_logs_m3
  from ops_inv.log_pieces lp where lp.purchase_id = p.id
) pc on true
left join lateral (
  select sum((thickness_mm / 1000.0) * (width_mm / 1000.0) * (length_mm / 1000.0) * qty) as sawn_m3
  from ops_inv.sawn_boards sb where sb.purchase_id = p.id
) b on true
left join lateral (
  -- The evidence road, the same one every nota and receiving photo takes
  -- (ADR-010, D91–D92). The contract carries a `nota_attachment_id` column;
  -- that is a **second road** and this schema does not open one — C14.
  select l.entity_no from ops_core.attachment_links l
   where l.entity = 'log_purchase' and l.entity_no = p.purchase_no
     and l.kind = 'nota' and l.unlinked_at is null limit 1
) n on true;

-- ── per vendor, per species ───────────────────────────────────────────────
--
-- `cost_per_sawn_m3` is the column that decides a supplier, and it is only a
-- comparison **within one species**.
create or replace view ops_inv.v_timber_by_vendor as
select
  p.vendor_code,
  max(p.vendor_name)                          as vendor_name,
  p.species,
  count(*)::int                               as loads,
  sum(p.total_cost)::bigint                   as total_cost,
  round(sum(p.log_m3), 4)                     as log_m3,
  round(sum(p.sawn_logs_m3), 4)               as sawn_logs_m3,
  round(sum(p.sawn_m3), 4)                    as sawn_m3,
  case when sum(p.sawn_logs_m3) > 0
    then round(sum(p.sawn_m3) / sum(p.sawn_logs_m3) * 100)::int end as yield_percent,
  case when sum(p.log_m3) > 0
    then round(sum(p.total_cost) / sum(p.log_m3))::bigint end as cost_per_log_m3,
  case when sum(p.sawn_m3) > 0 and sum(p.log_m3) > 0
    then round(sum(p.total_cost * (p.sawn_logs_m3 / p.log_m3)) / sum(p.sawn_m3))::bigint end
    as cost_per_sawn_m3
from ops_inv.v_log_purchase p
where p.log_m3 > 0
group by p.vendor_code, p.species;

-- ── access ────────────────────────────────────────────────────────────────
--
-- The third additive policy on `ops_procure.vendors`, after production's in
-- 0063 — and three one-offs is the point at which the rule belongs somewhere
-- else. It cannot go there yet: `vendors_read` lives in `0006`, which has been
-- applied (0028), so the additive policy is the only door left. Worth raising
-- with the procurement session rather than adding a fourth (F104).
create policy vendors_read_inventory on ops_procure.vendors for select to authenticated
  using (ops_core.has_permission('inventory.read'));

alter table ops_inv.log_purchases enable row level security;
alter table ops_inv.log_pieces    enable row level security;
alter table ops_inv.sawn_boards   enable row level security;

create policy logs_read on ops_inv.log_purchases for select to authenticated
  using (ops_core.has_permission('inventory.read'));
create policy logs_new  on ops_inv.log_purchases for insert to authenticated
  with check (ops_core.has_permission('inventory.create'));
create policy logs_edit on ops_inv.log_purchases for update to authenticated
  using (ops_core.has_permission('inventory.update')) with check (ops_core.has_permission('inventory.update'));

create policy pieces_read on ops_inv.log_pieces for select to authenticated
  using (ops_core.has_permission('inventory.read'));
-- Insert and update, never delete (A2). A mis-measured stick is corrected by
-- re-measuring it; a stick that was never there is a row somebody has to
-- explain, and deleting it removes the explanation along with the mistake.
create policy pieces_new  on ops_inv.log_pieces for insert to authenticated
  with check (ops_core.has_permission('inventory.create'));
create policy pieces_edit on ops_inv.log_pieces for update to authenticated
  using (ops_core.has_permission('inventory.update')) with check (ops_core.has_permission('inventory.update'));

create policy boards_read on ops_inv.sawn_boards for select to authenticated
  using (ops_core.has_permission('inventory.read'));
create policy boards_new  on ops_inv.sawn_boards for insert to authenticated
  with check (ops_core.has_permission('inventory.create'));
create policy boards_edit on ops_inv.sawn_boards for update to authenticated
  using (ops_core.has_permission('inventory.update')) with check (ops_core.has_permission('inventory.update'));

alter view ops_inv.v_log_purchase     set (security_invoker = on);
alter view ops_inv.v_timber_by_vendor set (security_invoker = on);

grant usage on schema ops_inv to authenticated;
grant select on all tables in schema ops_inv to authenticated;
grant insert, update on ops_inv.log_purchases to authenticated;
grant insert, update on ops_inv.log_pieces, ops_inv.sawn_boards to authenticated;
