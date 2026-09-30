-- 0198_inv_stock_input.sql — stock entered from zero, against the catalogue as
-- a list of names, and every entry editable.
--
-- The owner (2026-09-30), looking at *Materials & hardware* listing all 883
-- catalogue items at *0 · never moved*: *ini harusnya menjadi dropdown saja,
-- biarkan user input stok dari awal. kita ingin stok inventory dari awal, jadi
-- biarkan itu menjadi referensi nama saja setiap kali user input. pastikan
-- kita bisa edit setiap data yang diinput.* And, asked, chose: the list shows
-- only what has been entered; an entry is edited in place with its before and
-- after kept; a name not in the catalogue can be added from the form; photos
-- optional on an entry (D348).
--
--   1. **`input_stock`** — one entry: a catalogue item, a location, a quantity
--      and a note. It is an `adjust` move (D171: a declaration of what is on
--      the rack), so `inventory.adjust` gates it as the policy already does.
--   2. **`edit_stock_move` / `delete_stock_move`** — the owner's ruling
--      replaces A5's *a mistake is another move* for the entries people make:
--      an adjustment, an issue or a return is corrected where it stands. What
--      it was is kept in the audit row (`ops_core.ok`'s before/after), and the
--      row says when and by whom it was last changed. Two kinds stay out: a
--      **receipt** belongs to the signed receiving report in procurement and
--      is corrected there, and a **transfer** is two rows that close each
--      other, so it is deleted as a pair and entered again, never half-edited.
--   3. **`update_item_details`** — name, floor name, category and unit from
--      inventory (`inventory.update`), procurement's `update_item` rules for
--      the name. The unit changes only while no move is written in another
--      unit, because on-hand is a sum of quantities in the item's unit.
--   4. The Job Order check (0171) now also holds an edited reference.

-- ── the row says it was changed ────────────────────────────────────────────
alter table ops_inv.stock_moves add column if not exists edited_at timestamptz;
alter table ops_inv.stock_moves add column if not exists edited_by uuid references ops_core.users(id);

comment on column ops_inv.stock_moves.edited_at is
  'When an entry was last corrected in place (0198, D348). What it was is in the audit row.';

-- A reference typed in an edit is held to naming a real Job Order, as one
-- typed at entry is (0171) — only when it changed, so correcting the quantity
-- of an old entry is not refused over a reference nobody touched.
drop trigger if exists check_jo_reference_edit on ops_inv.stock_moves;
create trigger check_jo_reference_edit
  before update of ref_no on ops_inv.stock_moves
  for each row when (new.ref_no is distinct from old.ref_no)
  execute function ops_prod.check_jo_reference();

-- ── what a stock entry may name ─────────────────────────────────────────────
-- The item's unit when it is a live, stocked catalogue item; null otherwise.
create or replace function ops_inv.stock_item_uom(p_code text)
returns text
language sql stable set search_path = ops_inv, ops_procure, pg_temp as $$
  select i.base_uom from ops_procure.items i
   where i.code = p_code and i.merged_into is null and i.archived_at is null and i.kind = 'goods'
     and exists (select 1 from ops_inv.stocked_categories s where s.category_code = i.category_code)
$$;
revoke all on function ops_inv.stock_item_uom(text) from public;

-- ── 1. an entry ─────────────────────────────────────────────────────────────
create or replace function ops_inv.input_stock(
  p_item_code text,
  p_location  text,
  p_qty       numeric,
  p_note      text default null,
  p_key       text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare v_uom text; v_no text; v_on_hand numeric; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'input_stock', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.adjust') then
    return ops_core.refused('inventory','stock_move', null,'input',
      'not_permitted','Input stok butuh izin penyesuaian stok (inventory.adjust).');
  end if;
  if not exists (select 1 from ops_procure.items i where i.code = p_item_code) then
    return ops_core.invalid('inventory','stock_move', null,'input',
      'no_such_item', format('Tidak ada barang %s di katalog.', p_item_code), jsonb_build_object('field','item_code'));
  end if;
  v_uom := ops_inv.stock_item_uom(p_item_code);
  if v_uom is null then
    return ops_core.invalid('inventory','stock_move', null,'input',
      'not_stocked', format('%s tidak dihitung di gudang (digabung, diarsipkan, jasa, atau kategorinya tidak dihitung).', p_item_code),
      jsonb_build_object('field','item_code'));
  end if;
  if not exists (select 1 from ops_inv.stock_locations l where l.code = p_location and l.is_active) then
    return ops_core.invalid('inventory','stock_move', null,'input',
      'location_required','Pilih lokasi yang aktif.', jsonb_build_object('field','location'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('inventory','stock_move', null,'input',
      'qty_invalid','Jumlah harus lebih dari nol.', jsonb_build_object('field','qty'));
  end if;

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
  values (p_item_code, p_location, 'adjust', p_qty, v_uom,
          'Input stok' || coalesce(' — ' || nullif(btrim(p_note), ''), ''), auth.uid())
  returning move_no into v_no;

  select coalesce(sum(qty), 0) into v_on_hand from ops_inv.stock_moves where item_code = p_item_code;

  res := ops_core.ok('inventory','stock_move', v_no,'input',
    jsonb_build_object('move_no', v_no, 'item_code', p_item_code, 'location', p_location,
                       'qty', p_qty, 'uom', v_uom, 'on_hand', v_on_hand),
    null,
    jsonb_build_object('item_code', p_item_code, 'location', p_location, 'qty', p_qty));
  return ops_core.idem_remember('inventory','input_stock', p_key, res);
end $$;

-- ── 2. correcting an entry in place ─────────────────────────────────────────
-- Leave an argument null to keep what is there. `p_qty` is the quantity as the
-- form shows it: signed for an adjustment (an opname difference can go either
-- way), the amount for an issue or a return (the sign follows the kind).
create or replace function ops_inv.edit_stock_move(
  p_move_no   text,
  p_item_code text    default null,
  p_location  text    default null,
  p_qty       numeric default null,
  p_reason    text    default null,
  p_ref_no    text    default null,
  p_clear_ref boolean default false)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  m        ops_inv.stock_moves;
  v_item   text;
  v_uom    text;
  v_loc    text;
  v_qty    numeric;
  v_reason text;
  v_ref    text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not ops_core.has_permission('inventory.adjust') then
    return ops_core.refused('inventory','stock_move', p_move_no,'edit',
      'not_permitted','Mengubah catatan stok butuh izin penyesuaian stok (inventory.adjust).');
  end if;
  select * into m from ops_inv.stock_moves where move_no = p_move_no for update;
  if not found then
    return ops_core.not_found('inventory','stock_move', p_move_no,'edit','Catatan stok tidak ditemukan.');
  end if;
  if m.kind = 'receipt' then
    return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
      'from_receipt','Barang masuk ini dari penerimaan barang di procurement — koreksi di penerimaannya.');
  end if;
  if m.kind = 'transfer' then
    return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
      'transfer_pair','Pindah lokasi tercatat berpasangan (keluar dan masuk). Hapus lalu catat ulang.');
  end if;

  v_item := coalesce(nullif(btrim(p_item_code), ''), m.item_code);
  v_uom  := m.uom;
  if v_item <> m.item_code then
    v_uom := ops_inv.stock_item_uom(v_item);
    if v_uom is null then
      return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
        'not_stocked', format('%s tidak ada di katalog atau tidak dihitung di gudang.', v_item),
        jsonb_build_object('field','item_code'));
    end if;
  end if;

  v_loc := coalesce(nullif(btrim(p_location), ''), m.location);
  if v_loc <> m.location
     and not exists (select 1 from ops_inv.stock_locations l where l.code = v_loc and l.is_active) then
    return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
      'location_required','Pilih lokasi yang aktif.', jsonb_build_object('field','location'));
  end if;

  v_qty := m.qty;
  if p_qty is not null then
    if m.kind = 'adjust' then
      if p_qty = 0 then
        return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
          'qty_invalid','Jumlah tidak boleh nol — hapus catatannya kalau memang tidak ada.', jsonb_build_object('field','qty'));
      end if;
      v_qty := p_qty;
    else
      if p_qty <= 0 then
        return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
          'qty_invalid','Jumlah harus lebih dari nol.', jsonb_build_object('field','qty'));
      end if;
      v_qty := case when m.kind = 'issue' then -abs(p_qty) else abs(p_qty) end;
    end if;
  end if;

  v_reason := case when p_reason is null then m.reason else nullif(btrim(p_reason), '') end;
  if m.kind = 'adjust' and v_reason is null then
    return ops_core.invalid('inventory','stock_move', p_move_no,'edit',
      'reason_required','Penyesuaian stok wajib beralasan.', jsonb_build_object('field','reason'));
  end if;
  v_ref := case when p_clear_ref then null else coalesce(nullif(btrim(p_ref_no), ''), m.ref_no) end;

  v_before := jsonb_build_object('item_code', m.item_code, 'location', m.location, 'qty', m.qty,
                                 'uom', m.uom, 'reason', m.reason, 'ref_no', m.ref_no);
  v_after  := jsonb_build_object('item_code', v_item, 'location', v_loc, 'qty', v_qty,
                                 'uom', v_uom, 'reason', v_reason, 'ref_no', v_ref);
  if v_before = v_after then
    return ops_core.noop('inventory','stock_move', p_move_no,'edit','Tidak ada yang berubah.',
      jsonb_build_object('move_no', p_move_no));
  end if;

  update ops_inv.stock_moves set
    item_code = v_item, location = v_loc, qty = v_qty, uom = v_uom,
    reason = v_reason, ref_no = v_ref,
    edited_at = now(), edited_by = auth.uid()
  where id = m.id;

  return ops_core.ok('inventory','stock_move', p_move_no,'edit',
    jsonb_build_object('move_no', p_move_no) || v_after, v_before, v_after);
end $$;

create or replace function ops_inv.delete_stock_move(p_move_no text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare m ops_inv.stock_moves; v_pair ops_inv.stock_moves; v_before jsonb; v_nos text[];
begin
  if not ops_core.has_permission('inventory.adjust') then
    return ops_core.refused('inventory','stock_move', p_move_no,'delete',
      'not_permitted','Menghapus catatan stok butuh izin penyesuaian stok (inventory.adjust).');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('inventory','stock_move', p_move_no,'delete',
      'reason_required','Tulis alasan menghapus catatan ini.', jsonb_build_object('field','reason'));
  end if;
  select * into m from ops_inv.stock_moves where move_no = p_move_no for update;
  if not found then
    return ops_core.not_found('inventory','stock_move', p_move_no,'delete','Catatan stok tidak ditemukan.');
  end if;
  if m.kind = 'receipt' then
    return ops_core.invalid('inventory','stock_move', p_move_no,'delete',
      'from_receipt','Barang masuk ini dari penerimaan barang di procurement — koreksi di penerimaannya.');
  end if;

  v_before := jsonb_build_array(to_jsonb(m) - 'id');
  v_nos := array[m.move_no];
  -- A transfer is written as two rows in one statement: same item, same
  -- instant, same person, opposite quantities. Both go, or neither.
  if m.kind = 'transfer' then
    select * into v_pair from ops_inv.stock_moves x
     where x.kind = 'transfer' and x.id <> m.id and x.item_code = m.item_code
       and x.moved_at = m.moved_at and x.moved_by = m.moved_by and x.qty = -m.qty
     order by x.move_no limit 1 for update;
    if found then
      v_before := v_before || jsonb_build_array(to_jsonb(v_pair) - 'id');
      v_nos := v_nos || v_pair.move_no;
      delete from ops_inv.stock_moves where id = v_pair.id;
    end if;
  end if;
  delete from ops_inv.stock_moves where id = m.id;

  return ops_core.ok('inventory','stock_move', p_move_no,'delete',
    jsonb_build_object('deleted', to_jsonb(v_nos), 'reason', btrim(p_reason), 'item_code', m.item_code),
    jsonb_build_object('rows', v_before, 'reason', btrim(p_reason)), null);
end $$;

-- ── 3. the item's own details, from inventory ──────────────────────────────
create or replace function ops_inv.update_item_details(
  p_code          text,
  p_name          text default null,
  p_name_local    text default null,
  p_category_code text default null,
  p_base_uom      text default null,
  p_clear_local   boolean default false)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare i ops_procure.items; v_name text; v_local text; v_cat text; v_uom text; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','item', p_code,'update_details',
      'not_permitted','Mengubah data barang butuh akses ubah inventory.');
  end if;
  select * into i from ops_procure.items where code = p_code for update;
  if not found then
    return ops_core.not_found('inventory','item', p_code,'update_details','Barang tidak ditemukan.');
  end if;
  if i.merged_into is not null then
    return ops_core.invalid('inventory','item', p_code,'update_details',
      'already_merged','Barang ini sudah digabung ke barang lain; ubah yang itu.');
  end if;
  if p_name is not null and btrim(p_name) = '' then
    return ops_core.invalid('inventory','item', p_code,'update_details',
      'name_required','Barang butuh nama katalog.', jsonb_build_object('field','name'));
  end if;

  v_name  := coalesce(btrim(p_name), i.name);
  v_local := case when p_clear_local then null else coalesce(nullif(btrim(p_name_local), ''), i.name_local) end;
  v_cat   := coalesce(p_category_code, i.category_code);
  v_uom   := coalesce(p_base_uom, i.base_uom);

  if lower(v_name) <> lower(i.name) and exists (
       select 1 from ops_procure.items x
        where lower(x.name) = lower(v_name) and x.id <> i.id and x.merged_into is null) then
    return ops_core.conflict('inventory','item', p_code,'update_details',
      'name_taken', format('Sudah ada barang bernama "%s". Kalau sama, gabungkan di Procurement.', v_name),
      jsonb_build_object('field','name'));
  end if;
  if v_cat <> i.category_code
     and not exists (select 1 from ops_inv.stocked_categories s where s.category_code = v_cat) then
    return ops_core.invalid('inventory','item', p_code,'update_details',
      'not_stocked', format('Kategori %s tidak dihitung di gudang.', v_cat), jsonb_build_object('field','category_code'));
  end if;
  if v_uom <> i.base_uom then
    if not exists (select 1 from ops_procure.uom u where u.code = v_uom) then
      return ops_core.invalid('inventory','item', p_code,'update_details',
        'no_such_uom', format('Tidak ada satuan %s.', v_uom), jsonb_build_object('field','base_uom'));
    end if;
    if exists (select 1 from ops_inv.stock_moves where item_code = i.code and uom <> v_uom) then
      return ops_core.invalid('inventory','item', p_code,'update_details',
        'uom_has_moves', format('Stok barang ini sudah dicatat dalam %s. Ubah atau hapus catatannya dulu, baru ganti satuan.', i.base_uom),
        jsonb_build_object('field','base_uom'));
    end if;
  end if;

  v_before := jsonb_build_object('name', i.name, 'name_local', i.name_local,
                                 'category_code', i.category_code, 'base_uom', i.base_uom);
  v_after  := jsonb_build_object('name', v_name, 'name_local', v_local,
                                 'category_code', v_cat, 'base_uom', v_uom);
  if v_before = v_after then
    return ops_core.noop('inventory','item', p_code,'update_details','Tidak ada yang berubah.',
      jsonb_build_object('code', p_code));
  end if;

  -- A new name keeps the old one in `aka`, as procurement's rename does
  -- (0104), so search still finds what people used to type.
  update ops_procure.items set
    name          = v_name,
    aka           = case when v_name <> i.name
                         then (select coalesce(array_agg(distinct x), '{}')
                                 from unnest(i.aka || array[i.name]) x
                                where lower(x) <> lower(v_name))
                         else aka end,
    name_local    = v_local,
    category_code = v_cat,
    base_uom      = v_uom
  where id = i.id;

  return ops_core.ok('inventory','item', p_code,'update_details',
    jsonb_build_object('code', p_code) || v_after, v_before, v_after);
end $$;

-- ── 4. the corrections, readable where the item is ─────────────────────────
-- The audit trail is IT's to read (0003). The corrections to one item's
-- entries are the storeman's own business, so they are read through here:
-- every edit and delete whose row named this item before or after.
-- Volatile, like every browser-callable read that can answer with a refusal
-- (F169: the refusal writes its audit row).
create or replace function ops_inv.stock_entry_history(p_item_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare rows jsonb;
begin
  if not ops_core.has_permission('inventory.read') then
    return ops_core.refused('inventory','stock_move', p_item_code,'history',
      'not_permitted','Riwayat perubahan stok butuh akses baca inventory.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', a.at, 'action', a.action, 'move_no', a.entity_no,
           'by_name', coalesce(u.full_name, u.email::text),
           'before', a.before, 'after', a.after,
           'reason', a.before->>'reason') order by a.at desc, a.id desc), '[]'::jsonb)
    into rows
    from ops_core.audit_log a
    left join ops_core.users u on u.id = a.actor_id
   where a.service = 'inventory' and a.entity = 'stock_move' and a.outcome = 'ok'
     and a.action in ('edit','delete')
     and (a.before->>'item_code' = p_item_code or a.after->>'item_code' = p_item_code
          or exists (select 1 from jsonb_array_elements(coalesce(a.before->'rows', '[]'::jsonb)) r
                      where r->>'item_code' = p_item_code));
  -- A read: answered without an audit row, as `label_sources` is.
  return jsonb_build_object('outcome','ok','status',200,'data', rows);
end $$;

revoke all on function ops_inv.stock_entry_history(text) from public;
grant execute on function ops_inv.stock_entry_history(text) to authenticated;

revoke all on function ops_inv.input_stock(text, text, numeric, text, text) from public;
revoke all on function ops_inv.edit_stock_move(text, text, text, numeric, text, text, boolean) from public;
revoke all on function ops_inv.delete_stock_move(text, text) from public;
revoke all on function ops_inv.update_item_details(text, text, text, text, text, boolean) from public;
grant execute on function ops_inv.input_stock(text, text, numeric, text, text) to authenticated;
grant execute on function ops_inv.edit_stock_move(text, text, text, numeric, text, text, boolean) to authenticated;
grant execute on function ops_inv.delete_stock_move(text, text) to authenticated;
grant execute on function ops_inv.update_item_details(text, text, text, text, text, boolean) to authenticated;

analyze ops_inv.stock_moves;
