-- 0112_procure_item_code_width.sql — an item added in Procurement gets a code
-- shaped like the 1.045 already there.
--
-- `create_item` (0017) mints `'I-' || lpad(n, 4)`, but the imported catalogue
-- is `I-00001` … `I-01045`: five digits, and none with four (production,
-- 2026-09-23). The next item would have been `I-1046`, which sorts and reads
-- as a different series. Five digits, like the rows it sits among — the same
-- fix `0110` made to `ops_prod.create_bom_item`. Nothing else in the function
-- changes.

create or replace function ops_procure.create_item(
  p_name text, p_category_code text default 'uncurated',
  p_base_uom text default 'pcs', p_kind ops_procure.item_kind_t default 'goods',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_code text; n int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_item', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','item', null,'create',
      'not_permitted','Adding an item needs procurement access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('procurement','item', null,'create','name_required','An item needs a name.');
  end if;
  if not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('procurement','item', null,'create',
      'no_such_category', format('There is no category %s.', p_category_code));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_base_uom) then
    return ops_core.invalid('procurement','item', null,'create',
      'no_such_uom', format('There is no unit %s.', p_base_uom));
  end if;

  select count(*) + 1 into n from ops_procure.items;
  v_code := 'I-' || lpad(n::text, 5, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    n := n + 1;
    v_code := 'I-' || lpad(n::text, 5, '0');
  end loop;

  insert into ops_procure.items (code, name, category_code, base_uom, kind, is_curated, created_by)
  values (v_code, btrim(p_name), p_category_code, p_base_uom, p_kind, false, auth.uid());

  res := ops_core.ok('procurement','item', v_code,'create',
    jsonb_build_object('code', v_code, 'name', btrim(p_name), 'is_curated', false));
  return ops_core.idem_remember('procurement','create_item', p_key, res);
end $$;
