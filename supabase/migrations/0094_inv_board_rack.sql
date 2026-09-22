-- 0094_inv_board_rack.sql — the board rack, D203 answered in SQL.
--
-- `inv.board_moves` is described in prose at `docs/plan/02-database.md:546`
-- and was never migrated: "what happened to the boards after the saw — issue,
-- return, scrap, adjust, signed, each with the work order or the reason
-- behind it. There is no `sawn` row in this table: the incoming side is
-- derived from `inv.sawn_boards`... `purchase_id` is nullable on purpose...
-- it is left null rather than guessed." Both rules are the schema here, not
-- a comment somebody has to remember: `kind` cannot be `'sawn'` (a narrower
-- enum than the contract's `BoardMoveKind`, which also names the synthesized
-- reading `v_board_stock`/`v_board_moves` produce), and `purchase_id` has no
-- `not null`.
--
-- `qty`'s sign follows `ops_inv.stock_moves`'s own convention exactly
-- (`0071`): negative takes boards off the rack. That reuse is what makes
-- `v_board_stock`'s `qty` a plain `sum(n)` rather than a sign-juggling case
-- expression — `sawn_boards.qty` is always positive (what came off the saw),
-- `board_moves.qty` already carries the direction, and a size's on-rack
-- count is nothing more than both sums added together (matches
-- `boardStock()`'s bucket arithmetic in `src/demo/inventory-derive.ts`
-- exactly: `sawn - issued - scrapped + returned + adjusted`, since `issued`
-- and `scrapped` are stored negative and `returned`/`adjusted` carry their
-- own sign already).
create type ops_inv.board_move_kind_t as enum ('issue', 'return', 'adjust', 'scrap');

insert into ops_core.doc_prefixes (prefix, what) values ('ppn', 'board move');

create table ops_inv.board_moves (
  id            uuid primary key default gen_random_uuid(),
  move_no       text not null unique default ops_core.next_doc_number('ppn'),
  at            timestamptz not null default now(),
  -- The size is stated on every row, not joined from `sawn_boards` or looked
  -- up from a size table that does not exist — `board_key` in `0070`'s own
  -- tables is a derived string, never a foreign key, and a move for a size
  -- nobody has sawn yet (a size correction, say) still has to name it.
  species       text not null check (length(btrim(species)) > 0),
  thickness_mm  int not null check (thickness_mm > 0),
  width_mm      int not null check (width_mm > 0),
  length_mm     int not null check (length_mm > 0),
  qty           numeric not null check (qty <> 0),
  kind          ops_inv.board_move_kind_t not null,
  -- Which load these came out of, when anybody knows — left null rather than
  -- guessed (D204). Never enforced against the size on the row: a return or
  -- an adjustment naming a load is trusted, the same way `0071`'s
  -- `stock_moves.item_code` is trusted without a foreign key.
  purchase_id   uuid references ops_inv.log_purchases(id),
  ref_no        text,
  reason        text,
  moved_by      uuid not null references ops_core.users(id),

  constraint issue_removes  check (kind <> 'issue'  or qty < 0),
  constraint scrap_removes  check (kind <> 'scrap'  or qty < 0),
  constraint return_adds    check (kind <> 'return' or qty > 0),
  constraint adjust_says_why check (
    kind <> 'adjust' or (reason is not null and length(btrim(reason)) > 0)),
  constraint scrap_says_why check (
    kind <> 'scrap' or (reason is not null and length(btrim(reason)) > 0)),
  constraint issue_needs_ref check (
    kind <> 'issue' or (ref_no is not null and length(btrim(ref_no)) > 0))
);

create index board_moves_key_idx on ops_inv.board_moves (species, thickness_mm, width_mm, length_mm);

-- ── the rack ──────────────────────────────────────────────────────────────
--
-- Ported field for field from `boardStock()`/`boardCostIndex()` — no
-- procedural loop needed, unlike `cash_plan` (`0091`): there is no claim
-- order and no occurrence-date arithmetic here, only a per-`(board_key,
-- purchase_id)` net quantity and a rate to apply to it, both expressible as
-- plain aggregates.
--
--   `per_purchase_net` — `sawn_boards.qty` and `board_moves.qty` for one size
--     and one load (or no load, for an unattributed move), summed together.
--     This is `boardStock()`'s `byPurchase` map, one row per entry.
--   `cost_index` / `dearest` — each load's own `cost_per_sawn_m3`
--     (`v_log_purchase`, `0070`) and the dearest costed load **per species**
--     (D232, Q43: timber only gets more expensive, so the dearest rate seen
--     is a safe fallback, and never borrowed across species).
--   `totals` — for each size, `qty` is every `per_purchase_net` row summed
--     (positive and negative, attributed and not); `valued_qty`/`valued_raw`
--     are summed only over the rows with a rate, `estimated_qty` only over
--     the ones that needed the species fallback rather than their own load,
--     `unpriced_qty` the rest.
--
-- `avg_cost_per_m3` drops the `m3_each` factor `boardStock()` carries through
-- its arithmetic: `valued / (m3Each * valuedQty)` is `(m3Each * Σ(rate·n)) /
-- (m3Each * valuedQty)`, and `m3Each` cancels — `Σ(rate·n) / valuedQty` is
-- the same number without multiplying and dividing by the same figure.
-- `value` still needs it, so it is applied once, there.
create or replace view ops_inv.v_board_stock as
with sizes as (
  select distinct p.species, sb.thickness_mm, sb.width_mm, sb.length_mm
    from ops_inv.sawn_boards sb join ops_inv.log_purchases p on p.id = sb.purchase_id
  union
  select distinct m.species, m.thickness_mm, m.width_mm, m.length_mm
    from ops_inv.board_moves m
),
cost_index as (
  select p.id as purchase_id, p.species, v.cost_per_sawn_m3
    from ops_inv.log_purchases p
    join ops_inv.v_log_purchase v on v.id = p.id
),
dearest as (
  select species, max(cost_per_sawn_m3) as rate
    from cost_index where cost_per_sawn_m3 is not null
   group by species
),
per_purchase as (
  select p.species, sb.thickness_mm, sb.width_mm, sb.length_mm,
         sb.purchase_id, sum(sb.qty)::numeric as n
    from ops_inv.sawn_boards sb join ops_inv.log_purchases p on p.id = sb.purchase_id
   group by p.species, sb.thickness_mm, sb.width_mm, sb.length_mm, sb.purchase_id
   union all
  select m.species, m.thickness_mm, m.width_mm, m.length_mm, m.purchase_id, sum(m.qty)
    from ops_inv.board_moves m
   group by m.species, m.thickness_mm, m.width_mm, m.length_mm, m.purchase_id
),
per_purchase_net as (
  select species, thickness_mm, width_mm, length_mm, purchase_id, sum(n) as n
    from per_purchase
   group by species, thickness_mm, width_mm, length_mm, purchase_id
),
per_purchase_rated as (
  select ppn.*,
         coalesce(ci.cost_per_sawn_m3, d.rate) as rate,
         (ci.cost_per_sawn_m3 is null and d.rate is not null) as is_estimated
    from per_purchase_net ppn
    left join cost_index ci on ci.purchase_id = ppn.purchase_id
    left join dearest d on d.species = ppn.species
),
totals as (
  select species, thickness_mm, width_mm, length_mm,
         sum(n) as qty,
         sum(n) filter (where n > 0 and rate is not null) as valued_qty,
         sum(n * rate) filter (where n > 0 and rate is not null) as valued_raw,
         sum(n) filter (where n > 0 and is_estimated) as estimated_qty,
         sum(n) filter (where n > 0 and rate is null) as unpriced_qty
    from per_purchase_rated
   group by species, thickness_mm, width_mm, length_mm
),
sawn_totals as (
  select p.species, sb.thickness_mm, sb.width_mm, sb.length_mm,
         sum(sb.qty) as sawn_total, max(sb.sawn_on::text) as last_sawn
    from ops_inv.sawn_boards sb join ops_inv.log_purchases p on p.id = sb.purchase_id
   group by p.species, sb.thickness_mm, sb.width_mm, sb.length_mm
),
move_totals as (
  select species, thickness_mm, width_mm, length_mm,
         sum(-qty) filter (where kind = 'issue') as issued_total,
         sum(-qty) filter (where kind = 'scrap') as scrapped_total,
         max(at::text) as last_move
    from ops_inv.board_moves
   group by species, thickness_mm, width_mm, length_mm
)
select
  s.species || '|' || s.thickness_mm || 'x' || s.width_mm || 'x' || s.length_mm as board_key,
  s.species, s.thickness_mm, s.width_mm, s.length_mm,
  (s.thickness_mm / 10.0) || ' × ' || (s.width_mm / 10.0) || ' × ' || (s.length_mm / 10.0) || ' cm' as size,
  coalesce(t.qty, 0)                          as qty,
  coalesce(st.sawn_total, 0)                  as sawn_total,
  coalesce(mt.issued_total, 0)                as issued_total,
  coalesce(mt.scrapped_total, 0)               as scrapped_total,
  round(((s.thickness_mm / 1000.0) * (s.width_mm / 1000.0) * (s.length_mm / 1000.0))::numeric, 4) as m3_each,
  round(((s.thickness_mm / 1000.0) * (s.width_mm / 1000.0) * (s.length_mm / 1000.0))
        * coalesce(t.qty, 0), 4)              as m3,
  case when coalesce(t.valued_qty, 0) > 0 then round(t.valued_raw / t.valued_qty) end as avg_cost_per_m3,
  case when coalesce(t.valued_qty, 0) > 0 then
    round(((s.thickness_mm / 1000.0) * (s.width_mm / 1000.0) * (s.length_mm / 1000.0)) * t.valued_raw
          * (greatest(least(coalesce(t.qty, 0), t.valued_qty), 0) / t.valued_qty))
  end                                         as value,
  round(least(coalesce(t.estimated_qty, 0), greatest(coalesce(t.qty, 0), 0))::numeric, 3) as estimated_qty,
  case when coalesce(t.estimated_qty, 0) > 0 then d.rate end as estimate_per_m3,
  round(least(coalesce(t.unpriced_qty, 0), greatest(coalesce(t.qty, 0), 0))::numeric, 3) as unpriced_qty,
  greatest(st.last_sawn, mt.last_move)        as last_move_at
from sizes s
left join totals      t  on t.species = s.species  and t.thickness_mm = s.thickness_mm  and t.width_mm = s.width_mm  and t.length_mm = s.length_mm
left join sawn_totals st on st.species = s.species and st.thickness_mm = s.thickness_mm and st.width_mm = s.width_mm and st.length_mm = s.length_mm
left join move_totals mt on mt.species = s.species and mt.thickness_mm = s.thickness_mm and mt.width_mm = s.width_mm and mt.length_mm = s.length_mm
left join dearest      d  on d.species = s.species;

alter view ops_inv.v_board_stock set (security_invoker = on);
-- `0070`/`0071`'s `grant select on all tables in schema ops_inv` ran before
-- this view existed — a schema-wide grant is a snapshot, not a standing
-- rule, so a view created afterwards needs its own.
grant select on ops_inv.v_board_stock to authenticated;

-- ── writing ───────────────────────────────────────────────────────────────
--
-- The one hard block in this module (D205): issuing or scrapping more than
-- `v_board_stock` currently shows is refused, not flagged — unlike
-- `ops_inv.stock_moves` (`0071`) and everywhere else in this system (A6). A
-- board stack cannot read visually negative the way a numeric rack can, so
-- there is no "went_negative" to report; the message names the way through,
-- an opname with a reason, the same one `adjustStock`'s demo counterpart
-- gives.
--
-- Split by `kind` the same way `0071`'s `moves_new` policy splits
-- `stock_moves` — `adjust`/`scrap` need `inventory.adjust`, `issue`/`return`
-- need `inventory.create` — even though nothing upstream of this migration
-- decided that split for boards specifically; it is this migration's own
-- extension of `0071`'s precedent, for the same reason `0071` gives: a
-- declared discrepancy is a different decision from the ordinary day.
create or replace function ops_inv.move_boards(
  p_board_key text, p_kind ops_inv.board_move_kind_t, p_qty numeric,
  p_ref_no text default null, p_purchase_no text default null, p_reason text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  stack ops_inv.v_board_stock;
  purchase ops_inv.log_purchases;
  outward boolean := p_kind in ('issue', 'scrap');
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'move_boards:' || p_board_key, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission(
    case when p_kind in ('adjust', 'scrap') then 'inventory.adjust' else 'inventory.create' end
  ) then
    return ops_core.refused('inventory', 'board_move', p_board_key, p_kind::text,
      'not_permitted', 'Mengubah rak papan perlu akses inventory.');
  end if;

  select * into stack from ops_inv.v_board_stock where board_key = p_board_key;
  if not found then
    return ops_core.not_found('inventory', 'board_move', p_board_key, p_kind::text, 'Ukuran itu tidak ada di rak.');
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('inventory', 'board_move', p_board_key, p_kind::text,
      'qty_required', 'Berapa lembar?', jsonb_build_object('field', 'qty'));
  end if;
  if outward and p_qty > stack.qty then
    return ops_core.conflict('inventory', 'board_move', p_board_key, p_kind::text,
      'not_enough_boards',
      format('Di rak ada %s lembar %s %s, diminta %s. Kalau fisiknya memang ada, catat sebagai penyesuaian opname dengan alasannya.',
             stack.qty, stack.size, stack.species, p_qty),
      jsonb_build_object('on_hand', stack.qty, 'asked', p_qty));
  end if;
  if p_kind = 'issue' and coalesce(btrim(p_ref_no), '') = '' then
    return ops_core.invalid('inventory', 'board_move', p_board_key, p_kind::text,
      'ref_required', 'Dipakai untuk pekerjaan yang mana?', jsonb_build_object('field', 'ref_no'));
  end if;
  if p_kind in ('adjust', 'scrap') and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('inventory', 'board_move', p_board_key, p_kind::text,
      'reason_required', 'Tulis alasannya.', jsonb_build_object('field', 'reason'));
  end if;

  if p_purchase_no is not null then
    select * into purchase from ops_inv.log_purchases where purchase_no = p_purchase_no;
    if not found then
      return ops_core.not_found('inventory', 'board_move', p_board_key, p_kind::text,
        format('Tidak ada kiriman %s.', p_purchase_no));
    end if;
  end if;

  insert into ops_inv.board_moves
    (species, thickness_mm, width_mm, length_mm, qty, kind, purchase_id, ref_no, reason, moved_by)
  values
    (stack.species, stack.thickness_mm, stack.width_mm, stack.length_mm,
     case when outward then -abs(p_qty) else abs(p_qty) end,
     p_kind, purchase.id, nullif(btrim(p_ref_no), ''), nullif(btrim(p_reason), ''), auth.uid());

  res := ops_core.ok('inventory', 'board_move', p_board_key, p_kind::text,
    jsonb_build_object('board_key', p_board_key, 'kind', p_kind, 'qty', p_qty));
  return ops_core.idem_remember('inventory', 'move_boards:' || p_board_key, p_key, res);
end $$;

grant execute on function
  ops_inv.move_boards(text, ops_inv.board_move_kind_t, numeric, text, text, text, text)
  to authenticated;

alter table ops_inv.board_moves enable row level security;

create policy board_moves_read on ops_inv.board_moves for select to authenticated
  using (ops_core.has_permission('inventory.read'));
-- No direct insert policy: every write goes through `move_boards()`, which
-- runs `security definer` precisely because "not enough boards" (D205) is a
-- rule RLS cannot express — it depends on every other row for this size, not
-- on the row being written.

grant select on ops_inv.board_moves to authenticated;
