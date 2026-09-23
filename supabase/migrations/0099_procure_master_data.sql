-- 0099_procure_master_data.sql — suppliers and units become maintainable.
--
-- The owner's ask (2026-09-23): a Master Data section where suppliers and
-- units can be added, corrected and removed, because the pickers are full of
-- names nobody buys from any more and the unit dropdown shows eighteen of the
-- thirty-three units the database actually holds.
--
-- ── Suppliers: three verbs this schema did not have ─────────────────────────
--
-- *Rename.* `vendors.name` is the name every picker and every printed PO
-- shows, and until now it could only change by merging — which needs a second
-- row to merge into. `rename_vendor` sets it directly and keeps the old
-- spelling in `aka`, so a search for what people used to type still finds
-- the row and the chat extractor still recognises it.
--
-- *Archive.* 245 of 263 live vendors are referenced by a transaction, a
-- request, an order or a planned payment. Deleting any of them would either
-- fail on the foreign key or — worse, where there is none — orphan history.
-- `archived_at` takes a vendor out of every picker (`listVendors`) and out of
-- the default supplier list, and leaves every row that points at it pointing
-- at it. Reversible, because "we stopped buying from them" is sometimes
-- wrong by next quarter.
--
-- *Delete.* Only for a vendor nothing points at — the 18 that were imported
-- or typed and never used. Everything else is refused by name and count,
-- with archive offered as the answer, rather than left to a foreign-key error
-- a person cannot act on.
--
-- ── Units ───────────────────────────────────────────────────────────────────
--
-- `uom` and `uom_conversions` have been read-only since `0006`: RLS grants
-- select and nothing else. These seams are the only way in, for the same
-- reason every other master-data write here is a seam — each one lands an
-- audit row with the before and after (`ops_core.say`), and a unit that
-- quietly changed meaning is exactly the kind of edit somebody asks about
-- later. A unit's `code` never changes: it is the foreign key on every line
-- ever written in it. A unit is deleted only when nothing is measured in it,
-- including `ops_inv.stock_moves.uom`, which carries the code without a
-- foreign key and so would not otherwise stop the delete.
--
-- Permission: `procurement.update`, the same as every vendor and item seam
-- before this one (owner, 2026-09-23: master data is edited by the module
-- that owns it, not by a separate admin role).

alter table ops_procure.vendors
  add column archived_at timestamptz,
  add column archived_by uuid references ops_core.users(id),
  add constraint archived_together check ((archived_at is null) = (archived_by is null));

-- `v.*` in `v_vendor_view` was expanded when the view was created, so the new
-- columns only reach it by recreating it. Nothing depends on this view
-- (checked against `pg_depend` in production), so drop-and-create is safe;
-- the body is `0032`'s, unchanged.
drop view if exists ops_procure.v_vendor_view;
create or replace view ops_procure.v_vendor_view as
  select v.*,

         -- Codes are what the record stores; names are what a person reads.
         -- `coalesce(c.name, code)` so a category that no longer exists shows
         -- its code rather than vanishing from the list.
         coalesce((
           select array_agg(coalesce(c.name, sc) order by ord)
             from unnest(v.supplied_categories) with ordinality as s(sc, ord)
             left join ops_procure.item_categories c on c.code = s.sc
         ), '{}') as supplied_category_names,

         coalesce(t.transaction_count, 0)                as transaction_count,
         -- Money out only. A refund from a supplier is not spending on them,
         -- and netting the two would understate what this vendor has cost.
         coalesce(t.total_spend, 0)::numeric             as total_spend,
         t.last_purchase,
         coalesce(o.open_pr_lines, 0)                    as open_pr_lines,

         -- The rows folded into this one, so a screen can say *also known as*
         -- and show what was merged rather than only that something was.
         coalesce((
           select jsonb_agg(to_jsonb(a) order by a.name)
             from ops_procure.vendors a where a.merged_into = v.id
         ), '[]'::jsonb) as absorbed,

         -- What we have actually bought, never what the record claims to
         -- supply. `supplied_categories` is a statement of intent somebody
         -- typed; this is the purchase history, and where they disagree the
         -- history is the fact.
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'code', f.category_code,
                    'name', coalesce(c.name, f.category_code),
                    'count', cnt) order by cnt desc, f.category_code)
             from (
               select category_code, count(*) as cnt
                 from ops_procure.v_purchase_facts pf
                where pf.vendor_id = v.id
                group by category_code
             ) f
             left join ops_procure.item_categories c on c.code = f.category_code
         ), '[]'::jsonb) as bought_categories,

         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'item_id',    s.item_id,
                    'item_name',  s.item_name,
                    'last_price', s.last_price,
                    'uom',        s.uom,
                    'last_date',  s.last_date,
                    'times',      s.times) order by s.last_date desc)
             from (
               select pf.item_id,
                      max(pf.item_name)                                      as item_name,
                      (array_agg(pf.unit_price order by pf.at desc))[1]      as last_price,
                      (array_agg(pf.uom        order by pf.at desc))[1]      as uom,
                      max(pf.at)                                             as last_date,
                      count(*)                                               as times
                 from ops_procure.v_purchase_facts pf
                where pf.vendor_id = v.id
                group by pf.item_id
             ) s
         ), '[]'::jsonb) as items_bought

    from ops_procure.vendors v
    left join (
      select f.vendor_id,
             count(*)                                                  as transaction_count,
             sum(t.amount_idr) filter (where t.direction = 'OUT')      as total_spend,
             max(t.trx_date)                                           as last_purchase
        from ops_procure.v_vendor_fold f
        join ops_acct.transactions t
          on t.vendor_id = f.any_id and t.status <> 'VOID'
       group by f.vendor_id
    ) t on t.vendor_id = v.id
    left join (
      select f.vendor_id, count(*) as open_pr_lines
        from ops_procure.v_vendor_fold f
        join ops_procure.v_pr_line l on l.vendor_id = f.any_id
       where l.removed_at is null and l.status <> 'COMPLETED'
         and l.doc_status not in ('DRAFT','CANCELLED')
       group by f.vendor_id
    ) o on o.vendor_id = v.id;

alter view ops_procure.v_vendor_view set (security_invoker = on);
grant select on ops_procure.v_vendor_view to authenticated;
comment on view ops_procure.v_vendor_view is
  'A vendor with what was actually bought from it, following merged_into so an absorbed '
  'spelling keeps contributing its history (D41). Recreated in 0099 to carry archived_at.';

-- ── rename ───────────────────────────────────────────────────────────────────
create or replace function ops_procure.rename_vendor(p_code text, p_name text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors; v_name text := btrim(coalesce(p_name, '')); v_clash text;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'rename',
      'not_permitted','Renaming a vendor needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'rename','No such vendor.');
  end if;
  if v_name = '' then
    return ops_core.invalid('procurement','vendor', p_code,'rename',
      'name_required','A vendor needs a name.', jsonb_build_object('field','name'));
  end if;
  if v_name = v.name then
    return ops_core.noop('procurement','vendor', p_code,'rename',
      'already named that', jsonb_build_object('code', p_code, 'name', v_name));
  end if;

  -- Two live vendors with one display name is two rows a picker cannot tell
  -- apart. Merged-away rows do not count: their names already live on as the
  -- winner's aka.
  select code into v_clash from ops_procure.vendors
   where lower(name) = lower(v_name) and id <> v.id and merged_into is null
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('procurement','vendor', p_code,'rename',
      'name_taken', format('%s already uses the name "%s" — merge the two instead.', v_clash, v_name),
      jsonb_build_object('field','name','vendor_code', v_clash));
  end if;

  update ops_procure.vendors set
    name = v_name,
    -- The old name joins the aliases; the new one leaves them if it was there,
    -- so a spelling is never both the name and an alias of itself.
    aka = coalesce((select array_agg(distinct x order by x)
                      from unnest(v.aka || array[v.name]) x
                     where lower(x) <> lower(v_name)), '{}'),
    updated_at = now()
  where id = v.id;

  return ops_core.ok('procurement','vendor', p_code,'rename',
    jsonb_build_object('code', p_code, 'name', v_name),
    jsonb_build_object('name', v.name), jsonb_build_object('name', v_name));
end $$;

-- ── archive ──────────────────────────────────────────────────────────────────
create or replace function ops_procure.archive_vendor(p_code text, p_archived boolean)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'archive',
      'not_permitted','Archiving a vendor needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'archive','No such vendor.');
  end if;
  if v.merged_into is not null then
    return ops_core.invalid('procurement','vendor', p_code,'archive',
      'already_merged','This vendor was merged into another — archive that one instead.');
  end if;
  if (v.archived_at is not null) = p_archived then
    return ops_core.noop('procurement','vendor', p_code,'archive',
      'already in that state', jsonb_build_object('code', p_code, 'archived', p_archived));
  end if;

  update ops_procure.vendors set
    archived_at = case when p_archived then now() end,
    archived_by = case when p_archived then auth.uid() end,
    updated_at  = now()
  where id = v.id;

  return ops_core.ok('procurement','vendor', p_code, case when p_archived then 'archive' else 'unarchive' end,
    jsonb_build_object('code', p_code, 'archived', p_archived),
    jsonb_build_object('archived_at', v.archived_at),
    jsonb_build_object('archived', p_archived));
end $$;

-- ── delete, only what nothing remembers ─────────────────────────────────────
create or replace function ops_procure.delete_vendor(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_acct, ops_inv, ops_core, pg_temp as $$
declare v ops_procure.vendors; v_uses jsonb; v_total int;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'delete',
      'not_permitted','Deleting a vendor needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'delete','No such vendor.');
  end if;

  -- Every place a vendor can be remembered, counted, so the refusal can say
  -- what is holding it rather than surfacing a constraint name.
  v_uses := jsonb_strip_nulls(jsonb_build_object(
    'transactions',    nullif((select count(*) from ops_acct.transactions   where vendor_id = v.id), 0),
    'request_lines',   nullif((select count(*) from ops_procure.pr_lines    where vendor_id = v.id), 0),
    'purchase_orders', nullif((select count(*) from ops_procure.purchase_orders where vendor_id = v.id), 0),
    'planned_payments',nullif((select count(*) from ops_acct.cash_components where vendor_id = v.id), 0),
    'items_last_bought', nullif((select count(*) from ops_procure.items     where last_vendor_id = v.id), 0),
    'merged_vendors',  nullif((select count(*) from ops_procure.vendors     where merged_into = v.id), 0),
    'log_purchases',   nullif((select count(*) from ops_inv.log_purchases   where vendor_code = v.code), 0)));
  select coalesce(sum(value::int), 0) into v_total from jsonb_each_text(v_uses);

  if v_total > 0 then
    return ops_core.conflict('procurement','vendor', p_code,'delete',
      'vendor_in_use',
      format('%s is used by %s record(s) — archive it instead, so the history keeps its name.', v.name, v_total),
      jsonb_build_object('uses', v_uses));
  end if;

  delete from ops_procure.vendors where id = v.id;

  return ops_core.ok('procurement','vendor', p_code,'delete',
    jsonb_build_object('code', p_code, 'deleted', true),
    to_jsonb(v), null);
end $$;

-- ── units ────────────────────────────────────────────────────────────────────
create or replace function ops_procure.create_uom(
  p_code text, p_name text, p_dimension ops_procure.uom_dimension_t)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_code text := lower(btrim(coalesce(p_code, ''))); v_name text := btrim(coalesce(p_name, ''));
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','uom', v_code,'create',
      'not_permitted','Adding a unit needs procurement access.');
  end if;
  -- The code is what every line is written in, forever: short, lower-case,
  -- no spaces, so `Pcs`, `pcs ` and `pcs` can never become three units.
  if v_code !~ '^[a-z0-9][a-z0-9_-]{0,19}$' then
    return ops_core.invalid('procurement','uom', v_code,'create',
      'code_invalid','A unit code is 1–20 lower-case letters, digits, "-" or "_", with no spaces.',
      jsonb_build_object('field','code'));
  end if;
  if v_name = '' then
    return ops_core.invalid('procurement','uom', v_code,'create',
      'name_required','A unit needs a name.', jsonb_build_object('field','name'));
  end if;
  if exists (select 1 from ops_procure.uom where code = v_code) then
    return ops_core.conflict('procurement','uom', v_code,'create',
      'uom_exists', format('The unit "%s" already exists.', v_code), jsonb_build_object('field','code'));
  end if;

  insert into ops_procure.uom (code, name, dimension) values (v_code, v_name, p_dimension);
  return ops_core.ok('procurement','uom', v_code,'create',
    jsonb_build_object('code', v_code, 'name', v_name, 'dimension', p_dimension),
    null, jsonb_build_object('name', v_name, 'dimension', p_dimension));
end $$;

create or replace function ops_procure.update_uom(
  p_code text, p_name text, p_dimension ops_procure.uom_dimension_t)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare u ops_procure.uom; v_name text := btrim(coalesce(p_name, ''));
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','uom', p_code,'update',
      'not_permitted','Editing a unit needs procurement access.');
  end if;
  select * into u from ops_procure.uom where code = p_code;
  if not found then
    return ops_core.not_found('procurement','uom', p_code,'update','No such unit.');
  end if;
  if v_name = '' then
    return ops_core.invalid('procurement','uom', p_code,'update',
      'name_required','A unit needs a name.', jsonb_build_object('field','name'));
  end if;
  if u.name = v_name and u.dimension = p_dimension then
    return ops_core.noop('procurement','uom', p_code,'update',
      'nothing changed', jsonb_build_object('code', p_code, 'name', u.name, 'dimension', u.dimension));
  end if;

  update ops_procure.uom set name = v_name, dimension = p_dimension where code = p_code;
  return ops_core.ok('procurement','uom', p_code,'update',
    jsonb_build_object('code', p_code, 'name', v_name, 'dimension', p_dimension),
    jsonb_build_object('name', u.name, 'dimension', u.dimension),
    jsonb_build_object('name', v_name, 'dimension', p_dimension));
end $$;

create or replace function ops_procure.delete_uom(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_acct, ops_inv, ops_core, pg_temp as $$
declare u ops_procure.uom; v_uses jsonb; v_total int;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','uom', p_code,'delete',
      'not_permitted','Deleting a unit needs procurement access.');
  end if;
  select * into u from ops_procure.uom where code = p_code;
  if not found then
    return ops_core.not_found('procurement','uom', p_code,'delete','No such unit.');
  end if;

  v_uses := jsonb_strip_nulls(jsonb_build_object(
    'items',             nullif((select count(*) from ops_procure.items          where base_uom = p_code), 0),
    'request_lines',     nullif((select count(*) from ops_procure.pr_lines       where uom = p_code), 0),
    'order_lines',       nullif((select count(*) from ops_procure.po_lines       where uom = p_code), 0),
    'project_lines',     nullif((select count(*) from ops_procure.project_lines  where uom = p_code), 0),
    'transaction_lines', nullif((select count(*) from ops_acct.transaction_lines where uom = p_code), 0),
    'stock_moves',       nullif((select count(*) from ops_inv.stock_moves        where uom = p_code), 0),
    'conversions',       nullif((select count(*) from ops_procure.uom_conversions
                                  where from_uom = p_code or to_uom = p_code), 0)));
  select coalesce(sum(value::int), 0) into v_total from jsonb_each_text(v_uses);

  if v_total > 0 then
    return ops_core.conflict('procurement','uom', p_code,'delete',
      'uom_in_use',
      format('"%s" is used by %s record(s) and cannot be deleted.', p_code, v_total),
      jsonb_build_object('uses', v_uses));
  end if;

  delete from ops_procure.uom where code = p_code;
  return ops_core.ok('procurement','uom', p_code,'delete',
    jsonb_build_object('code', p_code, 'deleted', true), to_jsonb(u), null);
end $$;

-- One row per pair, and never both directions: `lusin → pcs = 12` and
-- `pcs → lusin = 0.0833` are one fact written twice, and the two copies are
-- how a catalogue ends up disagreeing with itself.
create or replace function ops_procure.save_uom_conversion(
  p_from text, p_to text, p_factor numeric,
  p_yield_ratio numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.uom_conversions; v_key text := coalesce(p_from,'') || '->' || coalesce(p_to,'');
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','uom_conversion', v_key,'save',
      'not_permitted','Editing unit conversions needs procurement access.');
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_from)
     or not exists (select 1 from ops_procure.uom where code = p_to) then
    return ops_core.invalid('procurement','uom_conversion', v_key,'save',
      'uom_unknown','Both units must exist.', jsonb_build_object('field','from_uom'));
  end if;
  if p_from = p_to then
    return ops_core.invalid('procurement','uom_conversion', v_key,'save',
      'same_uom','A unit does not convert into itself.', jsonb_build_object('field','to_uom'));
  end if;
  if p_factor is null or p_factor <= 0 then
    return ops_core.invalid('procurement','uom_conversion', v_key,'save',
      'factor_invalid','The factor must be greater than zero.', jsonb_build_object('field','factor'));
  end if;
  if p_yield_ratio is not null and (p_yield_ratio <= 0 or p_yield_ratio > 1) then
    return ops_core.invalid('procurement','uom_conversion', v_key,'save',
      'yield_invalid','Yield is a share of the input: more than 0, at most 1.',
      jsonb_build_object('field','yield_ratio'));
  end if;
  if exists (select 1 from ops_procure.uom_conversions where from_uom = p_to and to_uom = p_from) then
    return ops_core.conflict('procurement','uom_conversion', v_key,'save',
      'reverse_exists', format('%s → %s is already defined; edit that one instead.', p_to, p_from),
      jsonb_build_object('field','from_uom'));
  end if;

  select * into c from ops_procure.uom_conversions where from_uom = p_from and to_uom = p_to;
  insert into ops_procure.uom_conversions (from_uom, to_uom, factor, yield_ratio, note)
  values (p_from, p_to, p_factor, p_yield_ratio, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (from_uom, to_uom) do update
     set factor = excluded.factor, yield_ratio = excluded.yield_ratio, note = excluded.note;

  return ops_core.ok('procurement','uom_conversion', v_key, case when c.id is null then 'create' else 'update' end,
    jsonb_build_object('from_uom', p_from, 'to_uom', p_to, 'factor', p_factor),
    case when c.id is null then null else to_jsonb(c) end,
    jsonb_build_object('factor', p_factor, 'yield_ratio', p_yield_ratio, 'note', p_note));
end $$;

create or replace function ops_procure.delete_uom_conversion(p_from text, p_to text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.uom_conversions; v_key text := coalesce(p_from,'') || '->' || coalesce(p_to,'');
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','uom_conversion', v_key,'delete',
      'not_permitted','Editing unit conversions needs procurement access.');
  end if;
  select * into c from ops_procure.uom_conversions where from_uom = p_from and to_uom = p_to;
  if not found then
    return ops_core.not_found('procurement','uom_conversion', v_key,'delete','No such conversion.');
  end if;
  delete from ops_procure.uom_conversions where id = c.id;
  return ops_core.ok('procurement','uom_conversion', v_key,'delete',
    jsonb_build_object('from_uom', p_from, 'to_uom', p_to, 'deleted', true), to_jsonb(c), null);
end $$;

grant execute on function
  ops_procure.rename_vendor(text, text),
  ops_procure.archive_vendor(text, boolean),
  ops_procure.delete_vendor(text),
  ops_procure.create_uom(text, text, ops_procure.uom_dimension_t),
  ops_procure.update_uom(text, text, ops_procure.uom_dimension_t),
  ops_procure.delete_uom(text),
  ops_procure.save_uom_conversion(text, text, numeric, numeric, text),
  ops_procure.delete_uom_conversion(text, text)
  to authenticated;
