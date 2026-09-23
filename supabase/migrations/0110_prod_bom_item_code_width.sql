-- 0110_prod_bom_item_code_width.sql — a new item from the BOM gets a code
-- shaped like the 1.045 already there.
--
-- `create_bom_item` (0109) copied `create_item`'s `'I-' || lpad(n, 4)`, but
-- the imported catalogue is `I-00001` … `I-01045`: five digits. The next code
-- would have been `I-1046`, which sorts between `I-01045` and nothing, and
-- reads as a different series to anybody scanning a list. Five digits, like
-- the rows it sits among.

create or replace function ops_prod.create_bom_item(
  p_name text, p_category_code text default 'uncurated',
  p_base_uom text default 'pcs', p_kind ops_procure.item_kind_t default 'goods',
  p_standard_price numeric default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_procure, ops_core, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_code text; n int; v_existing text;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','item', null,'create_from_bom',
      'not_permitted','Menambah item dari BOM butuh akses produksi (update).');
  end if;
  if v_name = '' then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'name_required','Nama itemnya apa?', jsonb_build_object('field','name'));
  end if;
  if not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'no_such_category', format('Tidak ada kategori %s.', p_category_code), jsonb_build_object('field','category_code'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_base_uom) then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'no_such_uom', format('Tidak ada satuan %s.', p_base_uom), jsonb_build_object('field','base_uom'));
  end if;
  if p_standard_price is not null and p_standard_price < 0 then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'negative_price','Harga tidak bisa negatif.', jsonb_build_object('field','standard_price'));
  end if;

  -- Same name already there: hand it back rather than make its twin.
  select code into v_existing from ops_procure.items
   where lower(name) = lower(v_name) and merged_into is null and archived_at is null
   limit 1;
  if v_existing is not null then
    return ops_core.noop('production','item', v_existing,'create_from_bom',
      format('%s sudah ada di database items (%s) — dipakai yang itu.', v_name, v_existing),
      jsonb_build_object('code', v_existing, 'existing', true));
  end if;

  select count(*) + 1 into n from ops_procure.items;
  v_code := 'I-' || lpad(n::text, 5, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    n := n + 1;
    v_code := 'I-' || lpad(n::text, 5, '0');
  end loop;

  insert into ops_procure.items (code, name, category_code, base_uom, kind, is_curated, standard_price, created_by)
  values (v_code, v_name, p_category_code, p_base_uom, p_kind, false, p_standard_price, auth.uid());

  return ops_core.ok('production','item', v_code,'create_from_bom',
    jsonb_build_object('code', v_code, 'name', v_name, 'existing', false));
end $$;
