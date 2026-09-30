-- inv — stock entered from zero against the catalogue, and every entry
-- editable (0198, D348).
--
-- REFUSALS     a reader cannot enter, edit or delete; an entry needs a live
--              stocked item, an active location and a quantity above zero; a
--              receipt is corrected in procurement, not here; a transfer is
--              not half-edited; a delete needs a reason; an edited Job Order
--              reference must exist; a unit does not change under moves
--              written in another; a name another item has is refused
-- DERIVATIONS  an entry is on the rack; an edit changes the rack, says when
--              and by whom, and keeps before/after in the audit row; moving
--              an entry to another item moves the stock; a delete removes it
--              and a transfer goes as a pair; an item's details change, the
--              old name kept in aka

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019801','gudang-198@talaliving.com','{"full_name":"Gudang 198"}'),
  ('ffffffff-0000-0000-0000-000000019802','baca-198@talaliving.com','{"full_name":"Baca 198"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019801','inventory','write'),
  ('ffffffff-0000-0000-0000-000000019802','inventory','read');

insert into ops_procure.items (code, name, category_code, base_uom, kind) values
  ('I-19801', 'Sandpaper 400 (198)', 'sanding-sandpaper', 'pcs', 'goods'),
  ('I-19802', 'Sandpaper 600 (198)', 'sanding-sandpaper', 'pcs', 'goods'),
  ('I-19803', 'Jasa asah (198)',     'service',           'unit', 'service');
insert into ops_inv.stock_locations (code, name) values ('RAK-198','Rak 198'), ('LAMA-198','Rak lama 198');
update ops_inv.stock_locations set is_active = false where code = 'LAMA-198';
-- a receipt from procurement, written the way 0180's trigger writes it
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by)
values ('I-19801', 'GUDANG', 'receipt', 5, 'pcs', 7000, 'rcv-198', 'ffffffff-0000-0000-0000-000000019801');

set local role authenticated;

/* ── REFUSALS as a reader ─────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019802';
do $$
declare r jsonb; v_no text;
begin
  r := ops_inv.input_stock('I-19801', 'GUDANG', 10);
  assert r->>'outcome' = 'refused', 'a reader cannot enter stock, got ' || r::text;
  select move_no into v_no from ops_inv.stock_moves where ref_no = 'rcv-198';
  r := ops_inv.edit_stock_move(v_no, p_qty => 1);
  assert r->>'outcome' = 'refused', 'a reader cannot edit, got ' || r::text;
  r := ops_inv.delete_stock_move(v_no, 'salah');
  assert r->>'outcome' = 'refused', 'a reader cannot delete, got ' || r::text;
  r := ops_inv.update_item_details('I-19801', p_name => 'X');
  assert r->>'outcome' = 'refused', 'a reader cannot edit an item, got ' || r::text;
  r := ops_inv.stock_entry_history('I-19801');
  assert r->>'outcome' = 'ok', 'a reader may read the corrections, got ' || r::text;
end $$;

/* ── entries, and their refusals ──────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019801';
do $$
declare r jsonb;
begin
  r := ops_inv.input_stock('I-19801', 'LAMA-198', 10);
  assert r->'error'->>'code' = 'location_required', 'inactive location, got ' || r::text;
  r := ops_inv.input_stock('I-19801', 'GUDANG', 0);
  assert r->'error'->>'code' = 'qty_invalid', 'zero, got ' || r::text;
  r := ops_inv.input_stock('I-NOPE', 'GUDANG', 1);
  assert r->'error'->>'code' = 'no_such_item', 'unknown item, got ' || r::text;
  r := ops_inv.input_stock('I-19803', 'GUDANG', 1);
  assert r->'error'->>'code' = 'not_stocked', 'a service, got ' || r::text;

  r := ops_inv.input_stock('I-19801', 'RAK-198', 12, 'hitungan awal', 'k-198-1');
  assert r->>'outcome' = 'ok', 'an entry, got ' || r::text;
  assert (r->'data'->>'on_hand')::numeric = 17, 'on the rack with the receipt, got ' || r::text;
  perform set_config('uji.input', r->'data'->>'move_no', true);
  assert ops_inv.input_stock('I-19801', 'RAK-198', 12, 'hitungan awal', 'k-198-1')->'data'->>'move_no'
         = current_setting('uji.input'), 'a replay is the same entry';
  assert (select reason from ops_inv.stock_moves where move_no = current_setting('uji.input'))
         = 'Input stok — hitungan awal', 'the note on the row';
end $$;

/* ── editing in place ─────────────────────────────────────────────────────── */
do $$
declare r jsonb; v_no text := current_setting('uji.input'); v_rcv text; a record;
begin
  r := ops_inv.edit_stock_move(v_no, p_qty => 20, p_reason => 'Input stok — dihitung ulang');
  assert r->>'outcome' = 'ok', 'edit, got ' || r::text;
  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-19801') = 25, 'the rack follows the edit';
  assert (select edited_at is not null and edited_by = 'ffffffff-0000-0000-0000-000000019801'::uuid
            from ops_inv.stock_moves where move_no = v_no), 'the row says it was changed and by whom';
  -- read back through the storeman's door, not the audit table (IT's)
  select e into a from jsonb_array_elements(ops_inv.stock_entry_history('I-19801')->'data') e
   where e->>'move_no' = v_no and e->>'action' = 'edit' limit 1;
  assert (a.e->'before'->>'qty')::numeric = 12 and (a.e->'after'->>'qty')::numeric = 20,
    'before and after kept, got ' || coalesce(a.e::text, 'nothing');

  r := ops_inv.edit_stock_move(v_no, p_qty => 20);
  assert r->>'outcome' = 'noop', 'the same value is a noop, got ' || r::text;
  r := ops_inv.edit_stock_move(v_no, p_reason => '');
  assert r->'error'->>'code' = 'reason_required', 'an adjustment keeps a reason, got ' || r::text;
  r := ops_inv.edit_stock_move(v_no, p_location => 'LAMA-198');
  assert r->'error'->>'code' = 'location_required', 'inactive location, got ' || r::text;

  -- picked the wrong item: move the entry to the right one
  r := ops_inv.edit_stock_move(v_no, p_item_code => 'I-19802');
  assert r->>'outcome' = 'ok', 'to another item, got ' || r::text;
  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-19802') = 20, 'the stock moved with it';
  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-19801') = 5, 'and left the first item';
  r := ops_inv.edit_stock_move(v_no, p_item_code => 'I-19803');
  assert r->'error'->>'code' = 'not_stocked', 'not onto a service, got ' || r::text;

  select move_no into v_rcv from ops_inv.stock_moves where ref_no = 'rcv-198';
  r := ops_inv.edit_stock_move(v_rcv, p_qty => 6);
  assert r->'error'->>'code' = 'from_receipt', 'a receipt is corrected in procurement, got ' || r::text;
  r := ops_inv.delete_stock_move(v_rcv, 'salah');
  assert r->'error'->>'code' = 'from_receipt', 'and not deleted here, got ' || r::text;
end $$;

/* ── an issue: the amount keeps its sign; a Job Order reference is checked ── */
do $$
declare r jsonb; v_no text;
begin
  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
  values ('I-19802', 'RAK-198', 'issue', -3, 'pcs', 'dipakai', auth.uid())
  returning move_no into v_no;
  r := ops_inv.edit_stock_move(v_no, p_qty => 4);
  assert r->>'outcome' = 'ok' and (select qty from ops_inv.stock_moves where move_no = v_no) = -4,
    'an issue stays negative, got ' || r::text;
  begin
    r := ops_inv.edit_stock_move(v_no, p_ref_no => 'spk-tidak-ada');
    raise exception 'a Job Order that does not exist should be refused';
  exception when foreign_key_violation then null;
  end;
  assert (select ref_no from ops_inv.stock_moves where move_no = v_no) is null, 'unchanged after the refusal';
end $$;

/* ── deleting ─────────────────────────────────────────────────────────────── */
do $$
declare r jsonb; v_out text; v_before int;
begin
  r := ops_inv.delete_stock_move(current_setting('uji.input'), '  ');
  assert r->'error'->>'code' = 'reason_required', 'a delete says why, got ' || r::text;
  r := ops_inv.delete_stock_move(current_setting('uji.input'), 'diinput dua kali');
  assert r->>'outcome' = 'ok', 'delete, got ' || r::text;
  assert not exists (select 1 from ops_inv.stock_moves where move_no = current_setting('uji.input')), 'gone';
  assert exists (select 1 from jsonb_array_elements(ops_inv.stock_entry_history('I-19802')->'data') e
                  where e->>'move_no' = current_setting('uji.input') and e->>'action' = 'delete'
                    and e->'before'->'rows'->0->>'qty' = '20' and e->>'reason' = 'diinput dua kali'),
    'what it was, and why it went, is kept';

  -- a transfer, written as the screen writes it: two rows in one statement
  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by) values
    ('I-19801', 'GUDANG',  'transfer', -2, 'pcs', auth.uid()),
    ('I-19801', 'RAK-198', 'transfer',  2, 'pcs', auth.uid());
  select move_no into v_out from ops_inv.stock_moves where item_code = 'I-19801' and kind = 'transfer' and qty < 0;
  r := ops_inv.edit_stock_move(v_out, p_qty => 1);
  assert r->'error'->>'code' = 'transfer_pair', 'a transfer is not half-edited, got ' || r::text;
  select count(*) into v_before from ops_inv.stock_moves where item_code = 'I-19801' and kind = 'transfer';
  r := ops_inv.delete_stock_move(v_out, 'salah rak');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'deleted') = 2, 'both rows go, got ' || r::text;
  assert v_before = 2 and not exists (select 1 from ops_inv.stock_moves where item_code = 'I-19801' and kind = 'transfer'),
    'no half of the pair is left';
end $$;

/* ── the item's own details ───────────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_inv.update_item_details('I-19801', p_name => 'Sandpaper 600 (198)');
  assert r->'error'->>'code' = 'name_taken', 'another item''s name, got ' || r::text;
  r := ops_inv.update_item_details('I-19801', p_base_uom => 'lembar');
  assert r->'error'->>'code' = 'uom_has_moves', 'unit under moves in another, got ' || r::text;
  r := ops_inv.update_item_details('I-19801', p_category_code => 'service');
  assert r->'error'->>'code' = 'not_stocked', 'not into a category nobody counts, got ' || r::text;

  r := ops_inv.update_item_details('I-19801', p_name => 'Sandpaper 400 sheet (198)', p_name_local => 'Amplas 400',
                                   p_category_code => 'sanding-sponges');
  assert r->>'outcome' = 'ok', 'details, got ' || r::text;
  assert (select name = 'Sandpaper 400 sheet (198)' and name_local = 'Amplas 400' and category_code = 'sanding-sponges'
                 and 'Sandpaper 400 (198)' = any(aka)
            from ops_procure.items where code = 'I-19801'), 'written, the old name kept in aka';
  r := ops_inv.update_item_details('I-19801', p_clear_local => true);
  assert (select name_local from ops_procure.items where code = 'I-19801') is null, 'the floor name cleared';
end $$;

rollback;
