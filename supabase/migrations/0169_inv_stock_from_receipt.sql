-- 0169_inv_stock_from_receipt.sql — a delivery signed for is stock on a rack.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
--
-- 03-api.md has said since M27: *"`procurement.receipt.confirmed` is consumed
-- here: a confirmed delivery becomes a `receipt` move at the item's home
-- location."* The demo does it, inside `confirmReceipt`. **The live system
-- never did.** `confirm_receipt` (0086) emits the event and nothing consumes
-- it; `stockFromReceipt` exists in `src/lib/api/inventory.ts` and nothing calls
-- it. Found tracing the owner's chain (2026-09-25): *barangnya masuk gudang,
-- masuk ke receiving report, stok nambah* — the third step did not happen.
--
-- ── The shape ───────────────────────────────────────────────────────────────
--
-- A trigger on the receipt turning CONFIRMED, not a second client call: a
-- signature and the stock it puts on the rack land in one transaction, so a
-- dropped connection cannot leave a signed delivery with nothing counted.
-- Security definer because the person who signs for a delivery is
-- procurement (0086's gate), and holding `inventory.create` is not part of
-- signing — the stock move is the consequence of the signature, the same
-- argument D147 makes for a signed lembur sheet posting to production.
-- Idempotent through `stock_receipt_once_idx` (0071).
--
-- ── Two corrections to the demo's rule, made in both places ─────────────────
--
--   **Goods that are not being kept are not stock.** A receipt marked
--   `WRONG ITEM` or `RETURN TO SENDER` records that something arrived and is
--   going back; the demo stocked it anyway. `DAMAGED` and the partial
--   conditions are stocked — the goods are in the building, and whether they
--   get used or returned is a later move with its own reason.
--
--   **Units.** A line bought per `box` and an item counted per `pcs` cannot be
--   added together. Where the line's unit differs from the item's base unit,
--   the quantity is converted through `uom_conversions` (either direction);
--   where no conversion exists, **nothing is stocked** and the event says why,
--   rather than a sum that mixes boxes with pieces.
--
-- No backfill. Receipts confirmed before this migration stay unstocked: issues
-- were not recorded then either, so replaying months of deliveries would put
-- everything ever bought back on the rack. The opname sets the baseline.

create or replace function ops_inv.stock_from_receipt()
returns trigger
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  v_item_id   uuid;
  v_line_uom  text;
  v_price     numeric;
  v_item      ops_procure.items;
  v_qty       numeric;
  v_cost      numeric;
  v_factor    numeric;
  v_location  text;
  v_why       text;
begin
  if new.status <> 'CONFIRMED' or old.status = 'CONFIRMED' then
    return new;
  end if;

  if new.po_line_id is not null then
    select pl.item_id, pl.uom, pl.unit_price into v_item_id, v_line_uom, v_price
      from ops_procure.po_lines pl where pl.id = new.po_line_id;
  else
    select pr.item_id, pr.uom, pr.unit_price into v_item_id, v_line_uom, v_price
      from ops_procure.pr_lines pr where pr.id = new.line_id;
  end if;

  if v_item_id is null then
    v_why := 'the line names no catalogue item';
  else
    select * into v_item from ops_procure.items i where i.id = v_item_id;
    -- A merged item is counted under the one it was merged into.
    if v_item.merged_into is not null then
      select * into v_item from ops_procure.items i where i.id = v_item.merged_into;
    end if;
    if not exists (select 1 from ops_inv.stocked_categories s where s.category_code = v_item.category_code) then
      v_why := format('%s is not a counted category', v_item.category_code);
    elsif new.condition in ('WRONG ITEM', 'RETURN TO SENDER') then
      v_why := format('marked %s — not kept', new.condition);
    end if;
  end if;

  if v_why is null then
    v_line_uom := coalesce(v_line_uom, v_item.base_uom);
    if v_line_uom = v_item.base_uom then
      v_factor := 1;
    else
      select c.factor into v_factor from ops_procure.uom_conversions c
       where c.from_uom = v_line_uom and c.to_uom = v_item.base_uom;
      if v_factor is null then
        select 1 / c.factor into v_factor from ops_procure.uom_conversions c
         where c.from_uom = v_item.base_uom and c.to_uom = v_line_uom;
      end if;
      if v_factor is null then
        v_why := format('bought per %s, counted per %s, and no conversion between them', v_line_uom, v_item.base_uom);
      end if;
    end if;
  end if;

  if v_why is not null then
    perform ops_core.emit('inventory','inventory.receipt.not_stocked', new.receipt_no,
      jsonb_build_object('receipt_no', new.receipt_no, 'why', v_why));
    return new;
  end if;

  v_qty := new.qty_received * v_factor;
  -- Never zero (D172): an unpriced line leaves the move unpriced, not free.
  v_cost := case when coalesce(v_price, 0) > 0 then v_price / v_factor end;
  select coalesce(s.home_location, 'GUDANG') into v_location
    from (select 1) one left join ops_inv.stock_settings s on s.item_code = v_item.code;

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by)
  values (v_item.code, v_location, 'receipt', v_qty, v_item.base_uom, v_cost, new.receipt_no,
          coalesce(new.confirmed_by, auth.uid()))
  on conflict do nothing;

  perform ops_core.emit('inventory','inventory.stock.received', new.receipt_no,
    jsonb_build_object('receipt_no', new.receipt_no, 'item_code', v_item.code,
                       'qty', v_qty, 'uom', v_item.base_uom, 'location', v_location));
  return new;
end $$;

-- The ladder's rule (A2_core_execute_grants): every definer function is
-- executable by `authenticated` and decides inside. A trigger function refuses
-- a direct call on its own ("can only be called as triggers"), so the grant
-- opens nothing.
revoke all on function ops_inv.stock_from_receipt() from public;
grant execute on function ops_inv.stock_from_receipt() to authenticated;

drop trigger if exists stock_from_receipt on ops_procure.receipts;
create trigger stock_from_receipt
  after update of status on ops_procure.receipts
  for each row execute function ops_inv.stock_from_receipt();
