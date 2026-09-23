-- 0104_procure_item_master.sql — Master Data phase 2: the item catalogue.
--
-- The owner's shape (2026-09-23): **Category → Item type → Item**, e.g.
-- *Packing → Foam Sheet → Foam Sheet 2mm*. The bottom level is always the
-- thing bought, with its specification in the name: a different size, colour
-- or unit is a different item. So the tree has two levels of category and the
-- items hang off the second; `item_categories.parent_code` has existed since
-- `0006`, and this file adds what was missing — the seams to build the tree,
-- to edit an item, to archive one and to merge duplicates — plus the one read
-- the drawer needs: every ledger line an item was bought on.
--
-- All of it is `procurement.update` (per-module permissions, owner's choice),
-- and every write goes through `ops_core.say`, so each lands in the IT audit
-- log with its before and after.

-- ── 1. items can be archived ─────────────────────────────────────────────
-- Same shape as vendors (`0099`): out of every picker, history untouched.
alter table ops_procure.items
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references ops_core.users(id);
alter table ops_procure.items drop constraint if exists item_archived_together;
alter table ops_procure.items add constraint item_archived_together
  check ((archived_at is null) = (archived_by is null));

-- ── 2. a merged item's history follows the pointer ───────────────────────
-- `0014`'s view already folds a merged *vendor* into its survivor. Items get
-- the same treatment, so "Foam 2mm" merged into "Foam Sheet 2mm" shows its
-- purchases on the survivor — in the drawer, in "where we buy this", and in a
-- vendor's list of what it sold us. Same columns, same order; only the item
-- id, name and category now come from the survivor.
create or replace view ops_procure.v_purchase_facts as
  select coalesce(i.merged_into, i.id)             as item_id,
         coalesce(im.name, i.name)                 as item_name,
         coalesce(im.category_code, i.category_code) as category_code,
         coalesce(v.merged_into, v.id) as vendor_id,
         coalesce(vm.name, v.name)     as vendor_name,
         l.unit_price,
         l.uom,
         coalesce(d.submitted_at, d.created_at) as at,
         'pr'::text as source
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    join ops_procure.items   i on i.id = l.item_id
    left join ops_procure.items im on im.id = i.merged_into
    join ops_procure.vendors v on v.id = l.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into
   where l.removed_at is null
  union all
  select coalesce(i.merged_into, i.id),
         coalesce(im.name, i.name),
         coalesce(im.category_code, i.category_code),
         coalesce(v.merged_into, v.id),
         coalesce(vm.name, v.name),
         tl.unit_price, tl.uom,
         t.posted_at,
         'ledger'
    from ops_acct.transaction_lines tl
    join ops_acct.transactions t on t.id = tl.trx_id and t.status <> 'VOID'
    join ops_procure.items   i on i.id = tl.item_id
    left join ops_procure.items im on im.id = i.merged_into
    join ops_procure.vendors v on v.id = t.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into;

-- `create or replace view` drops the view's options, `security_invoker`
-- included — without this line the view would run with its owner's rights
-- and hand every ledger line past RLS (`smoke/17_core_view_invoker` catches it).
alter view ops_procure.v_purchase_facts set (security_invoker = on);

-- ── 3. the item view knows where it sits in the tree ─────────────────────
-- Dropped and recreated rather than replaced: `i.*` now expands to the two
-- archive columns, which lands them in the middle of the column list, and
-- `create or replace view` refuses to move a column. Nothing depends on this
-- view (checked against production before applying).
drop view if exists ops_procure.v_item_view;
create view ops_procure.v_item_view as
  select i.*,
         c.name as category_name,
         lv.name as last_vendor_name,
         coalesce(i.standard_price, i.last_price) as suggested_price,
         coalesce(pf.purchase_count, 0)           as purchase_count,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'vendor_id',   s.vendor_id,
                    'vendor_name', s.vendor_name,
                    'is_curated',  s.is_curated,
                    'pic_name',    s.pic_name,
                    'pic_phone',   s.pic_phone,
                    'last_price',  s.last_price,
                    'uom',         s.uom,
                    'last_date',   s.last_date,
                    'times',       s.times) order by s.last_date desc)
             from ops_procure.v_item_sources s
            where s.item_id = i.id
         ), '[]'::jsonb) as sourced_from,
         -- The tree, spelled out: the top-level category and the path a
         -- person reads ("Packing › Foam Sheet").
         coalesce(c.parent_code, c.code)                        as top_category_code,
         case when p.code is null then c.name
              else p.name || ' › ' || c.name end                 as category_path
    from ops_procure.items i
    join ops_procure.item_categories c on c.code = i.category_code
    left join ops_procure.item_categories p on p.code = c.parent_code
    left join ops_procure.vendors lv on lv.id = i.last_vendor_id
    left join (
      select item_id, count(*) as purchase_count
        from ops_procure.v_purchase_facts group by item_id
    ) pf on pf.item_id = i.id;

alter view ops_procure.v_item_view set (security_invoker = on);
grant select on ops_procure.v_item_view to authenticated;
comment on view ops_procure.v_item_view is
  'An item with where it has been bought and where it sits in the category tree. '
  'Merged items fold into their survivor through v_purchase_facts. (0032, 0104)';

-- ── 4. the category tree ─────────────────────────────────────────────────
--
-- Two levels, never three: a top-level category and the item types under it.
-- `uncurated` is the holding pen for what nobody has filed yet — it takes no
-- children, cannot move and cannot be deleted.

create or replace function ops_procure.category_slug(p_text text)
returns text language sql immutable as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')), 40)
$$;

create or replace function ops_procure.create_category(
  p_name text, p_parent_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_parent ops_procure.item_categories;
        v_base text; v_code text; n int := 1;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','category', null,'create',
      'not_permitted','Editing categories needs procurement access.');
  end if;
  if v_name = '' then
    return ops_core.invalid('procurement','category', null,'create',
      'name_required','A category needs a name.', jsonb_build_object('field','name'));
  end if;

  if p_parent_code is not null then
    select * into v_parent from ops_procure.item_categories where code = p_parent_code;
    if not found then
      return ops_core.invalid('procurement','category', null,'create',
        'parent_unknown', format('No category %s.', p_parent_code), jsonb_build_object('field','parent_code'));
    end if;
    if v_parent.parent_code is not null then
      return ops_core.invalid('procurement','category', null,'create',
        'too_deep', format('%s is already an item type; types cannot have sub-types. The item itself is the third level.', v_parent.name),
        jsonb_build_object('field','parent_code'));
    end if;
    if v_parent.code = 'uncurated' then
      return ops_core.invalid('procurement','category', null,'create',
        'parent_reserved','"Not yet curated" is a holding pen and takes no item types.',
        jsonb_build_object('field','parent_code'));
    end if;
  end if;

  if exists (select 1 from ops_procure.item_categories
              where lower(name) = lower(v_name)
                and parent_code is not distinct from p_parent_code) then
    return ops_core.conflict('procurement','category', null,'create',
      'name_taken', format('"%s" already exists there.', v_name), jsonb_build_object('field','name'));
  end if;

  v_base := ops_procure.category_slug(
    case when p_parent_code is null then v_name else p_parent_code || '-' || v_name end);
  if v_base = '' then v_base := 'category'; end if;
  v_code := v_base;
  while exists (select 1 from ops_procure.item_categories where code = v_code) loop
    n := n + 1;
    v_code := v_base || '-' || n;
  end loop;

  insert into ops_procure.item_categories (code, parent_code, name)
  values (v_code, p_parent_code, v_name);

  -- A type under a category that sits on a rack sits on the rack too —
  -- otherwise moving an item into "Packing › Foam Sheet" would quietly take
  -- it off the stock list (`ops_inv.v_stock_item` joins on the exact code).
  if p_parent_code is not null
     and exists (select 1 from ops_inv.stocked_categories where category_code = p_parent_code) then
    insert into ops_inv.stocked_categories (category_code) values (v_code)
    on conflict do nothing;
  end if;

  return ops_core.ok('procurement','category', v_code,'create',
    jsonb_build_object('code', v_code, 'name', v_name, 'parent_code', p_parent_code),
    null, jsonb_build_object('name', v_name, 'parent_code', p_parent_code));
end $$;

create or replace function ops_procure.update_category(
  p_code text, p_name text, p_parent_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.item_categories; v_parent ops_procure.item_categories;
        v_name text := btrim(coalesce(p_name, ''));
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','category', p_code,'update',
      'not_permitted','Editing categories needs procurement access.');
  end if;
  select * into c from ops_procure.item_categories where code = p_code;
  if not found then
    return ops_core.not_found('procurement','category', p_code,'update','No such category.');
  end if;
  if v_name = '' then
    return ops_core.invalid('procurement','category', p_code,'update',
      'name_required','A category needs a name.', jsonb_build_object('field','name'));
  end if;
  if c.code = 'uncurated' and p_parent_code is not null then
    return ops_core.invalid('procurement','category', p_code,'update',
      'reserved','"Not yet curated" stays at the top level.', jsonb_build_object('field','parent_code'));
  end if;

  if p_parent_code is not null then
    if p_parent_code = c.code then
      return ops_core.invalid('procurement','category', p_code,'update',
        'parent_self','A category cannot sit under itself.', jsonb_build_object('field','parent_code'));
    end if;
    select * into v_parent from ops_procure.item_categories where code = p_parent_code;
    if not found then
      return ops_core.invalid('procurement','category', p_code,'update',
        'parent_unknown', format('No category %s.', p_parent_code), jsonb_build_object('field','parent_code'));
    end if;
    if v_parent.parent_code is not null or v_parent.code = 'uncurated' then
      return ops_core.invalid('procurement','category', p_code,'update',
        'too_deep', format('%s cannot hold item types.', v_parent.name), jsonb_build_object('field','parent_code'));
    end if;
    if exists (select 1 from ops_procure.item_categories where parent_code = c.code) then
      return ops_core.invalid('procurement','category', p_code,'update',
        'has_children', format('%s has item types of its own, so it stays a top-level category.', c.name),
        jsonb_build_object('field','parent_code'));
    end if;
  end if;

  if exists (select 1 from ops_procure.item_categories
              where lower(name) = lower(v_name) and code <> c.code
                and parent_code is not distinct from p_parent_code) then
    return ops_core.conflict('procurement','category', p_code,'update',
      'name_taken', format('"%s" already exists there.', v_name), jsonb_build_object('field','name'));
  end if;

  if c.name = v_name and c.parent_code is not distinct from p_parent_code then
    return ops_core.noop('procurement','category', p_code,'update','Nothing changed.',
      jsonb_build_object('code', c.code, 'name', c.name, 'parent_code', c.parent_code));
  end if;

  update ops_procure.item_categories set name = v_name, parent_code = p_parent_code where code = c.code;

  if p_parent_code is not null
     and exists (select 1 from ops_inv.stocked_categories where category_code = p_parent_code) then
    insert into ops_inv.stocked_categories (category_code) values (c.code)
    on conflict do nothing;
  end if;

  return ops_core.ok('procurement','category', p_code,'update',
    jsonb_build_object('code', c.code, 'name', v_name, 'parent_code', p_parent_code),
    jsonb_build_object('name', c.name, 'parent_code', c.parent_code),
    jsonb_build_object('name', v_name, 'parent_code', p_parent_code));
end $$;

create or replace function ops_procure.delete_category(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.item_categories; n_items int; n_children int; n_vendors int;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','category', p_code,'delete',
      'not_permitted','Editing categories needs procurement access.');
  end if;
  select * into c from ops_procure.item_categories where code = p_code;
  if not found then
    return ops_core.not_found('procurement','category', p_code,'delete','No such category.');
  end if;
  if c.code = 'uncurated' then
    return ops_core.invalid('procurement','category', p_code,'delete',
      'reserved','"Not yet curated" is where new items land and cannot be deleted.');
  end if;

  select count(*) into n_items from ops_procure.items where category_code = c.code;
  select count(*) into n_children from ops_procure.item_categories where parent_code = c.code;
  select count(*) into n_vendors from ops_procure.vendors where c.code = any(supplied_categories);
  if n_items + n_children > 0 then
    return ops_core.conflict('procurement','category', p_code,'delete',
      'category_in_use',
      format('%s still has %s item(s) and %s item type(s). Move them first.', c.name, n_items, n_children),
      jsonb_build_object('items', n_items, 'children', n_children));
  end if;

  -- A vendor's declared list and the rack list name categories by code; a
  -- deleted code would linger there as a word nobody can resolve.
  update ops_procure.vendors set supplied_categories = array_remove(supplied_categories, c.code)
   where c.code = any(supplied_categories);
  delete from ops_inv.stocked_categories where category_code = c.code;
  delete from ops_procure.item_categories where code = c.code;

  return ops_core.ok('procurement','category', p_code,'delete',
    jsonb_build_object('code', c.code, 'deleted', true, 'vendors_updated', n_vendors),
    jsonb_build_object('name', c.name, 'parent_code', c.parent_code), null);
end $$;

-- ── 5. editing an item ───────────────────────────────────────────────────
--
-- Every argument but the code may be left null to keep what is there. A new
-- name keeps the old one in `aka`, as a vendor rename does (`0099`), so the
-- extractor and search still recognise what people used to type. A standard
-- price is cleared only on purpose (`p_clear_standard_price`), never by
-- leaving the field out.
create or replace function ops_procure.update_item(
  p_code text,
  p_name text default null,
  p_category_code text default null,
  p_base_uom text default null,
  p_kind ops_procure.item_kind_t default null,
  p_standard_price numeric default null,
  p_clear_standard_price boolean default false)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.items; v_name text; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', p_code,'update',
      'not_permitted','Editing an item needs procurement access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'update','No such item.');
  end if;
  if i.merged_into is not null then
    return ops_core.invalid('procurement','item', p_code,'update',
      'already_merged','This item was merged into another; edit that one.');
  end if;

  if p_name is not null and btrim(p_name) = '' then
    return ops_core.invalid('procurement','item', p_code,'update',
      'name_required','An item needs a name.', jsonb_build_object('field','name'));
  end if;
  v_name := coalesce(btrim(p_name), i.name);
  if lower(v_name) <> lower(i.name) and exists (
       select 1 from ops_procure.items
        where lower(name) = lower(v_name) and id <> i.id and merged_into is null) then
    return ops_core.conflict('procurement','item', p_code,'update',
      'name_taken', format('Another item is already called "%s". If they are the same thing, merge them.', v_name),
      jsonb_build_object('field','name'));
  end if;
  if p_category_code is not null
     and not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('procurement','item', p_code,'update',
      'category_unknown', format('No category %s.', p_category_code), jsonb_build_object('field','category_code'));
  end if;
  if p_base_uom is not null and not exists (select 1 from ops_procure.uom where code = p_base_uom) then
    return ops_core.invalid('procurement','item', p_code,'update',
      'uom_unknown', format('No unit %s.', p_base_uom), jsonb_build_object('field','base_uom'));
  end if;
  if p_standard_price is not null and p_standard_price < 0 then
    return ops_core.invalid('procurement','item', p_code,'update',
      'price_negative','A standard price cannot be negative.', jsonb_build_object('field','standard_price'));
  end if;

  v_before := jsonb_build_object('name', i.name, 'category_code', i.category_code,
    'base_uom', i.base_uom, 'kind', i.kind, 'standard_price', i.standard_price);

  update ops_procure.items set
    name           = v_name,
    aka            = case when v_name <> i.name
                          then (select coalesce(array_agg(distinct x), '{}')
                                  from unnest(i.aka || array[i.name]) x
                                 where lower(x) <> lower(v_name))
                          else aka end,
    category_code  = coalesce(p_category_code, category_code),
    base_uom       = coalesce(p_base_uom, base_uom),
    kind           = coalesce(p_kind, kind),
    standard_price = case when p_clear_standard_price then null
                          else coalesce(p_standard_price, standard_price) end
  where id = i.id;

  select jsonb_build_object('name', name, 'category_code', category_code,
    'base_uom', base_uom, 'kind', kind, 'standard_price', standard_price)
    into v_after from ops_procure.items where id = i.id;

  if v_after = v_before then
    return ops_core.noop('procurement','item', p_code,'update','Nothing changed.',
      jsonb_build_object('code', p_code));
  end if;

  return ops_core.ok('procurement','item', p_code,'update',
    jsonb_build_object('code', p_code), v_before, v_after);
end $$;

create or replace function ops_procure.archive_item(p_code text, p_archived boolean)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.items;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', p_code,'archive',
      'not_permitted','Archiving an item needs procurement access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'archive','No such item.');
  end if;
  if i.merged_into is not null then
    return ops_core.invalid('procurement','item', p_code,'archive',
      'already_merged','This item was merged into another and is already out of every list.');
  end if;
  if (i.archived_at is not null) = p_archived then
    return ops_core.noop('procurement','item', p_code,'archive',
      case when p_archived then 'Already archived.' else 'Not archived.' end,
      jsonb_build_object('code', p_code, 'archived', p_archived));
  end if;

  update ops_procure.items
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then auth.uid() end
   where id = i.id;

  return ops_core.ok('procurement','item', p_code, case when p_archived then 'archive' else 'restore' end,
    jsonb_build_object('code', p_code, 'archived', p_archived),
    jsonb_build_object('archived', i.archived_at is not null),
    jsonb_build_object('archived', p_archived));
end $$;

-- **A merge is a pointer, never a delete** — the same rule as vendors (D33,
-- D41). The loser row stays, so every ledger line written against it still
-- resolves; `v_purchase_facts` folds its history into the survivor. Its name
-- and spellings move into the survivor's `aka`, and the survivor takes the
-- loser's last purchase if that one is more recent.
--
-- Refused while the loser holds stock or sits in a bill of materials: those
-- name the item by code, and a merge that left half a rack under a code
-- nobody lists is worse than asking somebody to move it first.
create or replace function ops_procure.merge_item(p_loser_code text, p_winner_code text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare loser ops_procure.items; winner ops_procure.items; n_stock int; n_bom int;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', p_loser_code,'merge',
      'not_permitted','Merging items needs procurement access.');
  end if;
  select * into loser from ops_procure.items where code = p_loser_code;
  if not found then
    return ops_core.not_found('procurement','item', p_loser_code,'merge','No such item.');
  end if;
  select * into winner from ops_procure.items where code = p_winner_code;
  if not found then
    return ops_core.not_found('procurement','item', p_winner_code,'merge','No such item.');
  end if;
  if loser.id = winner.id then
    return ops_core.invalid('procurement','item', p_loser_code,'merge',
      'merge_into_self','An item cannot absorb itself.');
  end if;
  if loser.merged_into is not null then
    return ops_core.conflict('procurement','item', p_loser_code,'merge',
      'already_merged', format('%s has already been merged away.', loser.name));
  end if;
  if winner.merged_into is not null then
    return ops_core.invalid('procurement','item', p_loser_code,'merge',
      'winner_merged', format('%s was itself merged away; merge into the item it points at.', winner.name));
  end if;
  select count(*) into n_stock from ops_inv.stock_moves where item_code = loser.code;
  select count(*) into n_bom from ops_prod.bom_components where ref_code = loser.code and kind = 'material';
  if n_stock + n_bom > 0 then
    return ops_core.conflict('procurement','item', p_loser_code,'merge',
      'item_in_use_by_code',
      format('%s has %s stock movement(s) and is in %s bill(s) of materials, which name it by code. Move those first.',
             loser.name, n_stock, n_bom),
      jsonb_build_object('stock_moves', n_stock, 'bom_components', n_bom));
  end if;

  -- One level of pointers only: anything already merged into the loser moves
  -- to the survivor with it, so no reader ever has to follow two hops.
  update ops_procure.items set merged_into = winner.id where merged_into = loser.id;

  update ops_procure.items
     set aka = (select coalesce(array_agg(distinct x), '{}')
                  from unnest(winner.aka || loser.aka || array[loser.name]) x
                 where lower(x) <> lower(winner.name)),
         last_price        = case when loser.last_purchased_at > coalesce(winner.last_purchased_at, '-infinity')
                                  then loser.last_price else last_price end,
         last_vendor_id    = case when loser.last_purchased_at > coalesce(winner.last_purchased_at, '-infinity')
                                  then loser.last_vendor_id else last_vendor_id end,
         last_purchased_at = greatest(winner.last_purchased_at, loser.last_purchased_at),
         base_uom          = coalesce(winner.base_uom, loser.base_uom)
   where id = winner.id;

  update ops_procure.items set merged_into = winner.id where id = loser.id;

  perform ops_core.emit('procurement','procurement.item.merged', p_loser_code,
    jsonb_build_object('loser', p_loser_code, 'winner', p_winner_code));
  return ops_core.ok('procurement','item', p_loser_code,'merge',
    jsonb_build_object('loser', p_loser_code, 'winner', p_winner_code),
    jsonb_build_object('name', loser.name, 'merged_into', null),
    jsonb_build_object('merged_into', p_winner_code, 'winner_name', winner.name));
end $$;

-- Filing many at once: the 877 items sitting in "Not yet curated" are not
-- going to be opened one drawer at a time. One audit row for the batch, with
-- every code and where each came from.
create or replace function ops_procure.set_items_category(
  p_codes text[], p_category_code text, p_curate boolean default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_before jsonb; v_n int;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', null,'set_category',
      'not_permitted','Filing items needs procurement access.');
  end if;
  if coalesce(array_length(p_codes, 1), 0) = 0 then
    return ops_core.invalid('procurement','item', null,'set_category',
      'codes_required','Pick at least one item.', jsonb_build_object('field','codes'));
  end if;
  if not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('procurement','item', null,'set_category',
      'category_unknown', format('No category %s.', p_category_code), jsonb_build_object('field','category_code'));
  end if;

  select jsonb_object_agg(code, category_code) into v_before
    from ops_procure.items where code = any(p_codes) and merged_into is null;

  update ops_procure.items
     set category_code = p_category_code,
         is_curated = coalesce(p_curate, is_curated)
   where code = any(p_codes) and merged_into is null;
  get diagnostics v_n = row_count;

  return ops_core.ok('procurement','item', null,'set_category',
    jsonb_build_object('updated', v_n, 'category_code', p_category_code),
    jsonb_build_object('categories', coalesce(v_before, '{}'::jsonb)),
    jsonb_build_object('category_code', p_category_code, 'curated', p_curate, 'count', v_n));
end $$;

-- ── 6. what an item was bought on ────────────────────────────────────────
-- Every live ledger line for the item and anything merged into it, newest
-- first. A definer function rather than a view so the procurement screen can
-- show the purchase history without the reader also holding accounting's
-- read grant on every transaction — it answers only these columns, and only
-- to somebody with `procurement.read`.
create or replace function ops_procure.item_purchases(p_code text, p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare i ops_procure.items; rows jsonb;
begin
  if not ops_core.has_permission('procurement.read') then
    return ops_core.refused('procurement','item', p_code,'purchases',
      'not_permitted','Reading purchase history needs procurement access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'purchases','No such item.');
  end if;

  select coalesce(jsonb_agg(r order by r.trx_date desc, r.trx_no desc), '[]'::jsonb) into rows
    from (
      select t.trx_no, t.trx_date, t.status::text as status, a.code as account_code,
             coalesce(vm.name, v.name) as vendor_name,
             tl.description, tl.qty, tl.uom, tl.unit_price, tl.amount,
             src.code as item_code, src.name as item_name
        from ops_acct.transaction_lines tl
        join ops_acct.transactions t on t.id = tl.trx_id and t.status <> 'VOID'
        join ops_acct.accounts a on a.id = t.account_id
        join ops_procure.items src on src.id = tl.item_id
        left join ops_procure.vendors v on v.id = t.vendor_id
        left join ops_procure.vendors vm on vm.id = v.merged_into
       where src.id = i.id or src.merged_into = i.id
       order by t.trx_date desc, t.trx_no desc
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) r;

  -- A read, not a decision: answered straight, with no audit row.
  return jsonb_build_object('outcome','ok','status',200,'data', rows);
end $$;

grant execute on function
  ops_procure.create_category(text, text),
  ops_procure.update_category(text, text, text),
  ops_procure.delete_category(text),
  ops_procure.update_item(text, text, text, text, ops_procure.item_kind_t, numeric, boolean),
  ops_procure.archive_item(text, boolean),
  ops_procure.merge_item(text, text),
  ops_procure.set_items_category(text[], text, boolean),
  ops_procure.item_purchases(text, int)
  to authenticated;
