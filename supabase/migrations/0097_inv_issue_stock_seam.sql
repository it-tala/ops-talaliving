-- 0097_inv_issue_stock_seam.sql — issueStock gets a key a double-tap can be
-- recognised by, the same as move_boards (0094) and receive_logs (0095).
--
-- `stock_moves` writes go straight through RLS on purpose — `src/lib/api/
-- inventory.ts`'s own header says so: "no server-side function to ask for a
-- before/after either... those figures are read here, a select before the
-- insert, the same arithmetic the demo's own callers do." That stands for
-- returnStock, adjustStock and transferStock, whose demo counterparts take
-- no idempotency key either. issueStock's demo counterpart does — a double
-- tap on the floor turns one bundle of material leaving the rack into two,
-- silently, with no error to notice by — and `ops_core.idem_replay`/
-- `idem_remember` (0015) are revoked from `public` and reachable only from a
-- `security definer` function, on purpose: a client that could call them
-- directly could read another caller's cached answer. So a real idempotency
-- key for issueStock needs a seam of its own; the other three keep the plain
-- insert, matching the demo exactly either way.
--
-- A `security definer` function runs as its owner, which bypasses RLS
-- entirely (as every other seam in this schema notes) — `moves_new`'s
-- `inventory.create` check is re-asked here for the same reason `move_boards`
-- re-asks its own.
create or replace function ops_inv.issue_stock(
  p_item_code text, p_location text, p_qty numeric,
  p_wo_no text default null, p_reason text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  item      ops_procure.items;
  cat       ops_inv.stocked_categories;
  before_qty numeric;
  after_qty  numeric;
  mv        ops_inv.stock_moves;
  res       jsonb;
  replayed  jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'issue_stock:' || p_item_code, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory', 'stock_move', p_item_code, 'issue',
      'not_permitted', 'Mengeluarkan stok perlu akses inventory.');
  end if;

  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('inventory', 'stock_move', p_item_code, 'issue',
      'qty_invalid', 'Jumlah keluar harus lebih dari nol.', jsonb_build_object('field', 'qty'));
  end if;

  -- Same question `stockable()` asks client-side before every write: is this
  -- a real, un-merged, catalogue item sitting in a category `0071` actually
  -- counts (D169)?
  select * into item from ops_procure.items where code = p_item_code;
  if not found then
    return ops_core.invalid('inventory', 'stock_move', p_item_code, 'issue',
      'not_stocked', format('No catalogue item %s.', p_item_code), jsonb_build_object('field', 'item_code'));
  end if;
  if item.merged_into is not null then
    return ops_core.invalid('inventory', 'stock_move', p_item_code, 'issue',
      'not_stocked', format('%s was merged into another item.', item.name), jsonb_build_object('field', 'item_code'));
  end if;
  select * into cat from ops_inv.stocked_categories where category_code = item.category_code;
  if not found then
    return ops_core.invalid('inventory', 'stock_move', p_item_code, 'issue',
      'not_stocked',
      format('%s sits in %s, which is not counted — it is bought and used, not stocked (D169).',
             item.name, item.category_code),
      jsonb_build_object('field', 'item_code'));
  end if;

  -- Issuing more than the record shows is allowed and flagged, never
  -- refused (A6): `went_negative` says so in the answer rather than the
  -- write being blocked — unlike `move_boards`' D205, which does refuse.
  select coalesce(sum(qty), 0) into before_qty
    from ops_inv.stock_moves where item_code = p_item_code;
  after_qty := round(before_qty - p_qty, 3);

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, reason, moved_by)
  values (p_item_code, p_location, 'issue', -abs(p_qty), item.base_uom,
          nullif(btrim(coalesce(p_wo_no, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning * into mv;

  res := ops_core.ok('inventory', 'stock_move', p_item_code, 'issue',
    jsonb_build_object('move_no', mv.move_no, 'on_hand_after', after_qty, 'went_negative', after_qty < 0));
  return ops_core.idem_remember('inventory', 'issue_stock:' || p_item_code, p_key, res);
end $$;

grant execute on function
  ops_inv.issue_stock(text, text, numeric, text, text, text)
  to authenticated;
