-- procure — item master (0104): the category tree, editing, archiving,
-- merging and filing items, and an item's purchase history.
--
--   Packing (stocked) → "Foam Sheet" (created here) → ITM-9931 "Foam Sheet 2mm"
--   ITM-9932 "FOAM 2MM"  a duplicate, bought once on the ledger
--   ITM-9933 "Lakban"    sitting in "Not yet curated"
--
--   REFUSALS     a read grant editing; a third level; a type under
--                "Not yet curated"; a duplicate name under one parent; moving
--                a category that has types under another; deleting one in
--                use; deleting "Not yet curated"; renaming an item onto
--                another live item's name; merging into itself; merging an
--                item that holds stock
--   DERIVATIONS  a type under a stocked category is stocked; a rename keeps
--                the old name in aka; archive out and back; a merge folds the
--                loser's purchases into the survivor; bulk filing; the
--                purchase history follows the merge

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009931','rina-im@talaliving.com','{"full_name":"Rina IM"}'),
  ('ffffffff-0000-0000-0000-000000009932','tamu-im@talaliving.com','{"full_name":"Tamu IM"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009931','procurement','write'),
  ('ffffffff-0000-0000-0000-000000009932','procurement','read');

insert into ops_procure.vendors (id, code, name) values
  ('99310000-0000-0000-0000-000000000001','V-9931','Toko Foam');
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('99310000-0000-0000-0000-0000000000a1','ITM-9931','Foam Sheet 2mm','packing','lembar'),
  ('99310000-0000-0000-0000-0000000000a2','ITM-9932','FOAM 2MM','uncurated', null),
  ('99310000-0000-0000-0000-0000000000a3','ITM-9933','Lakban','uncurated','roll'),
  ('99310000-0000-0000-0000-0000000000a4','ITM-9934','Lem Kuning','finishing','can');

-- One ledger purchase of the duplicate.
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, description, source_ref, posted_by)
select '99310000-0000-0000-0000-0000000000b1', 'trx-im-1', '2026-09-10', a.id, 'OUT', 150000,
       'SUPPLIERS', '99310000-0000-0000-0000-000000000001', 'foam', 'trx-im-1',
       'ffffffff-0000-0000-0000-000000009931'
  from ops_acct.accounts a where a.code = 'BCA 271';
insert into ops_acct.transaction_lines (trx_id, line_no, item_id, description, qty, uom, unit_price, amount) values
  ('99310000-0000-0000-0000-0000000000b1', 1, '99310000-0000-0000-0000-0000000000a2', 'FOAM 2MM', 10, 'lembar', 15000, 150000);

-- ITM-9934 holds stock, so it cannot be merged away.
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
select 'ITM-9934', l.code, 'adjust', 3, 'can', 'opening', 'ffffffff-0000-0000-0000-000000009931'
  from ops_inv.stock_locations l limit 1;

set local role authenticated;

/* ── REFUSAL: a read grant does not edit ───────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009932';
do $$
declare r jsonb;
begin
  r := ops_procure.create_category('Foam Sheet', 'packing');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant should be refused, got ' || r::text;
  r := ops_procure.update_item('ITM-9931', 'Foam 3mm');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant should be refused, got ' || r::text;
  -- ...but it may read the history.
  r := ops_procure.item_purchases('ITM-9932');
  assert r ->> 'outcome' = 'ok', 'a read grant reads history, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009931';

/* ── the tree ──────────────────────────────────────────────────────────── */
do $$
declare r jsonb; v_type text; v_top text;
begin
  r := ops_procure.create_category('Foam Sheet', 'packing');
  assert r ->> 'outcome' = 'ok', 'type under packing, got ' || r::text;
  v_type := r -> 'data' ->> 'code';
  assert v_type = 'packing-foam-sheet', 'slugged code, got ' || v_type;
  assert exists (select 1 from ops_inv.stocked_categories where category_code = v_type),
    'a type under a stocked category is stocked too';

  r := ops_procure.create_category('foam sheet', 'packing');
  assert r -> 'error' ->> 'code' = 'name_taken', 'duplicate under one parent, got ' || r::text;

  r := ops_procure.create_category('Thin', v_type);
  assert r -> 'error' ->> 'code' = 'too_deep', 'no third level, got ' || r::text;

  r := ops_procure.create_category('Anything', 'uncurated');
  assert r -> 'error' ->> 'code' = 'parent_reserved', 'uncurated takes no types, got ' || r::text;

  r := ops_procure.create_category('Assets IT', null);
  assert r ->> 'outcome' = 'ok', 'top-level category, got ' || r::text;
  v_top := r -> 'data' ->> 'code';

  -- packing has a type now, so it cannot become one.
  r := ops_procure.update_category('packing', 'Packing', v_top);
  assert r -> 'error' ->> 'code' = 'has_children', 'a parent stays top-level, got ' || r::text;

  r := ops_procure.update_category(v_type, 'Foam Sheets', 'packing');
  assert r ->> 'outcome' = 'ok', 'rename a type, got ' || r::text;
  r := ops_procure.update_category(v_type, 'Foam Sheets', 'packing');
  assert r ->> 'outcome' = 'noop', 'same values is a noop, got ' || r::text;

  r := ops_procure.delete_category('uncurated');
  assert r -> 'error' ->> 'code' = 'reserved', 'uncurated stays, got ' || r::text;
  r := ops_procure.delete_category('packing');
  assert r -> 'error' ->> 'code' = 'category_in_use', 'in use, got ' || r::text;
  r := ops_procure.delete_category(v_top);
  assert r ->> 'outcome' = 'ok', 'an empty category deletes, got ' || r::text;
end $$;

/* ── editing an item ───────────────────────────────────────────────────── */
do $$
declare r jsonb; i ops_procure.items;
begin
  r := ops_procure.update_item('ITM-9931', 'Foam Sheet 2mm White', 'packing-foam-sheet', null, null, 12000);
  assert r ->> 'outcome' = 'ok', 'edit, got ' || r::text;
  select * into i from ops_procure.items where code = 'ITM-9931';
  assert i.name = 'Foam Sheet 2mm White' and i.category_code = 'packing-foam-sheet' and i.standard_price = 12000,
    'fields written, got ' || row_to_json(i)::text;
  assert 'Foam Sheet 2mm' = any(i.aka), 'old name kept as alias, got ' || i.aka::text;

  r := ops_procure.update_item('ITM-9931', 'lakban');
  assert r -> 'error' ->> 'code' = 'name_taken', 'another live item holds it, got ' || r::text;

  r := ops_procure.update_item('ITM-9931', null, null, 'nope');
  assert r -> 'error' ->> 'code' = 'uom_unknown', 'unknown unit, got ' || r::text;

  r := ops_procure.update_item('ITM-9931', null, null, null, null, null, true);
  assert r ->> 'outcome' = 'ok', 'clearing the price, got ' || r::text;
  assert (select standard_price from ops_procure.items where code = 'ITM-9931') is null, 'price cleared';

  r := ops_procure.update_item('ITM-9931');
  assert r ->> 'outcome' = 'noop', 'nothing given is a noop, got ' || r::text;

  r := ops_procure.archive_item('ITM-9933', true);
  assert r ->> 'outcome' = 'ok', 'archive, got ' || r::text;
  assert (select archived_at from ops_procure.items where code = 'ITM-9933') is not null, 'archived';
  r := ops_procure.archive_item('ITM-9933', true);
  assert r ->> 'outcome' = 'noop', 'archiving twice is a noop';
  r := ops_procure.archive_item('ITM-9933', false);
  assert r ->> 'outcome' = 'ok' and (select archived_at from ops_procure.items where code = 'ITM-9933') is null,
    'restored';
end $$;

/* ── merging and filing ────────────────────────────────────────────────── */
do $$
declare r jsonb; w ops_procure.items; h jsonb; n int;
begin
  r := ops_procure.merge_item('ITM-9931', 'ITM-9931');
  assert r -> 'error' ->> 'code' = 'merge_into_self', 'self merge, got ' || r::text;
  r := ops_procure.merge_item('ITM-9934', 'ITM-9931');
  assert r -> 'error' ->> 'code' = 'item_in_use_by_code', 'stock held, got ' || r::text;

  r := ops_procure.merge_item('ITM-9932', 'ITM-9931');
  assert r ->> 'outcome' = 'ok', 'merge, got ' || r::text;
  select * into w from ops_procure.items where code = 'ITM-9931';
  assert 'FOAM 2MM' = any(w.aka), 'loser name kept on the survivor, got ' || w.aka::text;
  r := ops_procure.merge_item('ITM-9932', 'ITM-9931');
  assert r -> 'error' ->> 'code' = 'already_merged', 'merging twice, got ' || r::text;

  -- The history, through the definer read: a procurement user sees the
  -- ledger line without holding accounting's grants.
  r := ops_procure.item_purchases('ITM-9931');
  h := r -> 'data';
  assert jsonb_array_length(h) = 1 and h -> 0 ->> 'trx_no' = 'trx-im-1'
     and h -> 0 ->> 'item_code' = 'ITM-9932' and (h -> 0 ->> 'unit_price')::numeric = 15000,
    'history follows the merge, got ' || r::text;

  r := ops_procure.set_items_category(array['ITM-9933','ITM-9931'], 'packing-foam-sheet', true);
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'updated')::int = 2, 'bulk filing, got ' || r::text;
  assert (select is_curated from ops_procure.items where code = 'ITM-9933'), 'curated along the way';
  r := ops_procure.set_items_category(array['ITM-9933'], 'nope');
  assert r -> 'error' ->> 'code' = 'category_unknown', 'unknown category, got ' || r::text;

  select category_path into h from (select to_jsonb(category_path) as category_path
    from ops_procure.v_item_view where code = 'ITM-9933') x;
  assert h #>> '{}' = 'Packing › Foam Sheets', 'path reads parent › type, got ' || h::text;
end $$;

reset role;

do $$
declare n int;
begin
  -- The views run with the reader's rights (`17_core_view_invoker`), so the
  -- fold is checked as the owner: the loser's ledger purchase reads as the
  -- survivor's.
  select count(*) into n from ops_procure.v_purchase_facts
   where item_id = '99310000-0000-0000-0000-0000000000a1';
  assert n = 1, 'the purchase folds into the survivor, got ' || n;
  select purchase_count into n from ops_procure.v_item_view where code = 'ITM-9931';
  assert n = 1, 'the view counts it, got ' || n;

  select count(*) into n from ops_core.audit_log
   where service = 'procurement' and entity in ('item','category') and outcome = 'ok'
     and at > now() - interval '1 hour'
     and (entity_no like 'ITM-993%' or entity_no like 'packing-foam%' or action = 'set_category');
  assert n >= 8, 'every write is in the audit log, got ' || n;
end $$;

rollback;
