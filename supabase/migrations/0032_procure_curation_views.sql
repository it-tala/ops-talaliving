-- 0032_procure_curation_views.sql — the two curation views, returning what the
-- contract says they return.
--
-- ── A cast is not an implementation ───────────────────────────────────────
--
-- `listVendorViews` and `listItemViews` are not in `_pending.ts`: their
-- TypeScript signatures match the demo exactly, so `check-api-parity.mjs` is
-- satisfied and CI is green. They are also both a lie, and the lie is one
-- character wide:
--
--     return fromRows<ItemView[]>(SERVICE, data as ItemView[], error);
--                                               ^^^^^^^^^^^^
--
-- `VendorView` promises `supplied_category_names`, `total_spend`, `absorbed`,
-- `bought_categories` and `items_bought`. `v_vendor_view` returned none of the
-- five. `ItemView` promises `sourced_from`; `v_item_view` did not have it.
-- `as` does not check anything — it instructs the compiler to stop checking —
-- so the first screen to read `item.sourced_from.length` would have thrown on
-- `undefined`, in production, on the catalogue page.
--
-- Nobody met it because `/procurement/catalog` and `/procurement/supplier` are
-- dark, held back by five other functions. That is the guard working, and it is
-- also exactly why this has to be fixed **before** those five: unblocking the
-- routes without this would open two screens onto a crash.
--
-- ── Three columns that already existed and disagreed ──────────────────────
--
-- Worth naming, because the same cast hid them. The old view's
-- `transaction_count` counted rows of `v_purchase_facts` — purchase *lines*,
-- including requests that were never ordered and never paid — where the
-- contract counts transactions. `last_purchase` was the newest of those lines,
-- so a request submitted this morning made a vendor look freshly paid. And
-- `open_pr_lines` joined on `vendors.id` alone, so absorbing a duplicate
-- spelling **dropped** the absorbed row's open lines from the surviving
-- vendor's count — the one thing D41 says a merge must not do. (The other two
-- read `v_purchase_facts`, which already folds, so they were wrong about the
-- unit rather than about the merge.)
--
-- The demo is the contract here (ADR-009), so the demo's definitions win.
--
-- ── Dropped and recreated rather than replaced ────────────────────────────
--
-- `create or replace view` may add columns at the end and may not change a
-- column's type. `last_purchase` goes from `timestamptz` (the newest purchase
-- line) to `date` (the newest transaction's date), which is the correction
-- above. Nothing reads these two views but the client — checked, not assumed —
-- so a drop costs nothing and keeps the definition readable instead of
-- accreting a cast to preserve a type that was wrong.

drop view if exists ops_procure.v_vendor_view;
drop view if exists ops_procure.v_item_view;

-- A vendor and the rows absorbed into it. Every total below reads through this
-- rather than `vendors.id` directly: a merge is a pointer, not a delete (D33),
-- so the history sitting on the absorbed row is still this vendor's history.
--
-- `v_purchase_facts` already folds — `coalesce(v.merged_into, v.id)` — which is
-- why the two aggregates built on it below do not join here.
create or replace view ops_procure.v_vendor_fold as
  select v.id as vendor_id, x.id as any_id
    from ops_procure.vendors v
    join ops_procure.vendors x on x.id = v.id or x.merged_into = v.id;

alter view ops_procure.v_vendor_fold set (security_invoker = on);
grant select on ops_procure.v_vendor_fold to authenticated;

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

create or replace view ops_procure.v_item_view as
  select i.*,
         c.name as category_name,
         lv.name as last_vendor_name,
         -- What a form would prefill: the curated price if there is one,
         -- otherwise the last price paid. A hint, never a price list.
         coalesce(i.standard_price, i.last_price) as suggested_price,
         coalesce(pf.purchase_count, 0)           as purchase_count,

         -- "We need thinner — where do we buy it?", answered from what was
         -- bought rather than from a supplier list somebody maintains.
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
         ), '[]'::jsonb) as sourced_from

    from ops_procure.items i
    -- `join`, unchanged: `category_code` is `not null` with a foreign key to
    -- this table, so every item has exactly one category row and the inner
    -- join cannot drop one. (Checked rather than assumed — a left join here
    -- would be defending against a state the schema forbids, and
    -- `ItemView.category_name` is typed `string`.)
    join ops_procure.item_categories c on c.code = i.category_code
    left join ops_procure.vendors lv on lv.id = i.last_vendor_id
    left join (
      select item_id, count(*) as purchase_count
        from ops_procure.v_purchase_facts group by item_id
    ) pf on pf.item_id = i.id;

alter view ops_procure.v_vendor_view set (security_invoker = on);
alter view ops_procure.v_item_view   set (security_invoker = on);
grant select on ops_procure.v_vendor_view to authenticated;
grant select on ops_procure.v_item_view   to authenticated;

comment on view ops_procure.v_vendor_view is
  'A vendor with what was actually bought from it, following merged_into so an absorbed '
  'spelling keeps contributing its history (D41). Returns the whole VendorView contract; '
  'the client used to cast five missing columns into existence. (0032)';
comment on view ops_procure.v_item_view is
  'An item with where it has been bought. `sourced_from` completes the ItemView contract, '
  'which the client previously cast rather than read. (0032)';

-- ── two seams that could not do what the screens ask ──────────────────────
--
-- The catalogue screen curates an item **and** files it under a category and
-- sets its standard price, in one action, because that is one decision: *this
-- is a real catalogue entry, it is a finishing material, and it costs about
-- this much*. `curate_item` took a boolean and nothing else, so two thirds of
-- that decision had nowhere to go.
--
-- Same for the supplier screen and `supplied_categories`: what a vendor says it
-- supplies is part of its contact record, and the seam that writes the contact
-- record could not write it.
--
-- Both take their new parameters **defaulted**, so every existing call — the
-- smoke files, anything already deployed — keeps working and means exactly what
-- it meant before.
--
-- ── and both must drop the old signature first ────────────────────────────
--
-- `create or replace function` matches on name **and argument types**. Adding a
-- parameter therefore does not replace anything: it creates a second function,
-- and then a two-argument call matches both — the old one exactly, the new one
-- through its defaults. Postgres refuses to choose:
--
--     ERROR:  function ops_procure.curate_item(unknown, boolean) is not unique
--     HINT:   Could not choose a best candidate function.
--
-- Which makes *adding an optional parameter* — the safest-sounding change in
-- SQL — break every existing caller, at run time, with an error about types
-- that names nothing about what actually happened. Found by running it, and
-- it had already happened once against the project before it was caught.
--
-- So each new signature is preceded by a drop of the exact old one. Not `drop
-- … cascade` and not a guess at the arguments: the full identity list, so the
-- statement fails loudly if the signature is not what this file thinks it is.
-- A5 is about rows; a superseded function signature whose replacement is a
-- strict superset is replaced, not deleted.

drop function if exists ops_procure.curate_item(text, boolean);
drop function if exists ops_procure.update_vendor_contact(
  text, text, text, text, text, text, text, text);

create or replace function ops_procure.curate_item(
  p_code text,
  p_curated boolean,
  p_category_code text default null,
  p_standard_price numeric default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.items; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', p_code,'curate',
      'not_permitted','Curating needs procurement access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'curate','No such item.');
  end if;

  -- A price is a number somebody will pay against. Below zero is not a
  -- discount, it is a typo, and the refusal says which field.
  if p_standard_price is not null and p_standard_price < 0 then
    return ops_core.invalid('procurement','item', p_code,'curate',
      'price_negative','A standard price cannot be negative.',
      jsonb_build_object('field','standard_price'));
  end if;
  if p_category_code is not null
     and not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('procurement','item', p_code,'curate',
      'category_unknown', format('No category %s.', p_category_code),
      jsonb_build_object('field','category_code'));
  end if;

  -- **Not a noop when only the flag is unchanged.** The old version returned
  -- early the moment `is_curated` already matched, which was right when the
  -- flag was all this seam could set — and would now silently discard a
  -- category and a price on every item already curated. It is a noop only when
  -- there is genuinely nothing to write.
  if i.is_curated = p_curated and p_category_code is null and p_standard_price is null then
    return ops_core.noop('procurement','item', p_code,'curate','already in that state',
      jsonb_build_object('code', p_code, 'is_curated', p_curated));
  end if;

  v_before := jsonb_build_object('is_curated', i.is_curated,
    'category_code', i.category_code, 'standard_price', i.standard_price);

  update ops_procure.items set
    is_curated     = p_curated,
    category_code  = coalesce(p_category_code, category_code),
    -- `standard_price` is the curated price and only ever set by a person.
    -- `last_price` is a trace of what was actually paid and is never touched
    -- here: conflating them is how one panic purchase becomes the official
    -- price.
    standard_price = coalesce(p_standard_price, standard_price)
  where id = i.id;

  select jsonb_build_object('is_curated', is_curated,
    'category_code', category_code, 'standard_price', standard_price)
    into v_after from ops_procure.items where id = i.id;

  return ops_core.ok('procurement','item', p_code,'curate',
    jsonb_build_object('code', p_code, 'is_curated', p_curated), v_before, v_after);
end $$;

create or replace function ops_procure.update_vendor_contact(
  p_code text,
  p_pic_name text default null, p_pic_phone text default null,
  p_phone text default null, p_address text default null,
  p_bank_account text default null, p_bank_account_secondary text default null,
  p_npwp text default null,
  p_supplied_categories text[] default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors; v_before jsonb; v_after jsonb; v_unknown text[];
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'update_contact',
      'not_permitted','Editing a vendor needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'update_contact','No such vendor.');
  end if;

  -- A category nobody has heard of is a typo that would then be displayed back
  -- as though it were real. Named in the refusal, all of them at once, because
  -- being told about one bad code at a time is how a form takes four attempts.
  if p_supplied_categories is not null then
    select array_agg(c) into v_unknown
      from unnest(p_supplied_categories) as c
     where not exists (select 1 from ops_procure.item_categories ic where ic.code = c);
    if v_unknown is not null then
      return ops_core.invalid('procurement','vendor', p_code,'update_contact',
        'category_unknown',
        format('No such category: %s.', array_to_string(v_unknown, ', ')),
        jsonb_build_object('field','supplied_categories','unknown', to_jsonb(v_unknown)));
    end if;
  end if;

  v_before := jsonb_build_object('pic_name', v.pic_name, 'pic_phone', v.pic_phone,
    'phone', v.phone, 'address', v.address, 'bank_account', v.bank_account,
    'bank_account_secondary', v.bank_account_secondary, 'npwp', v.npwp,
    'supplied_categories', to_jsonb(v.supplied_categories));

  update ops_procure.vendors set
    pic_name  = coalesce(nullif(btrim(p_pic_name), ''), pic_name),
    pic_phone = coalesce(nullif(btrim(p_pic_phone), ''), pic_phone),
    phone     = coalesce(nullif(btrim(p_phone), ''), phone),
    address   = coalesce(nullif(btrim(p_address), ''), address),
    bank_account = coalesce(nullif(btrim(p_bank_account), ''), bank_account),
    bank_account_secondary =
      coalesce(nullif(btrim(p_bank_account_secondary), ''), bank_account_secondary),
    npwp      = coalesce(nullif(btrim(p_npwp), ''), npwp),
    -- Replaced wholesale, not merged: the screen sends the list it wants, and
    -- a set you can add to but never remove from is not a set anybody can
    -- correct. `{}` clears it; null leaves it alone, like every field above.
    supplied_categories = coalesce(p_supplied_categories, supplied_categories),
    updated_at = now()
  where id = v.id;

  select jsonb_build_object('pic_name', pic_name, 'pic_phone', pic_phone,
    'phone', phone, 'address', address, 'bank_account', bank_account,
    'bank_account_secondary', bank_account_secondary, 'npwp', npwp,
    'supplied_categories', to_jsonb(supplied_categories))
    into v_after from ops_procure.vendors where id = v.id;

  return ops_core.ok('procurement','vendor', p_code,'update_contact',
    jsonb_build_object('code', p_code), v_before, v_after);
end $$;

grant execute on function ops_procure.curate_item(text, boolean, text, numeric)
  to authenticated;
grant execute on function ops_procure.update_vendor_contact(
  text, text, text, text, text, text, text, text, text[]) to authenticated;
