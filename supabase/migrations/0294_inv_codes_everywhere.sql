-- 0294_inv_codes_everywhere.sql — the one code where people look, and at registration.
--
-- 0293 gave every asset and catalogue item its code (`S2-29`, `S3-001`) and
-- the found-asset form a family, a name in the 2013 format and a sentence on
-- what it is (D451). This carries that to the rest of inventory:
--
--   1. `v_asset` and `v_stock_item` show the code, the family and the
--      sentence, so the Assets and Materials lists can show and search them.
--      `v_asset` spells its columns out: `a.*` would now put the code columns
--      in the middle, which `create or replace view` refuses.
--   2. `create_asset` takes a family and a sentence. Picked, the family numbers
--      the code and the name is written uppercase, as the 2013 register did;
--      left out, the category's default family numbers it, as before, so the
--      imports and old callers still work. The screen asks for both.
--   3. `register_item` takes the sentence; its family is its category's, as
--      it already was in 0293.
--   4. `describe_record(kind, no, text)`: the sentence written later, for the
--      thousands of items and assets that came before.
--   5. Labels print the code: `label_rows` carries it (and the sentence), and
--      finds a record by it or by its 2013 code; the public card shows it too.
--      The QR still carries the token and the key, which never change.

-- ── 1. the reads ──────────────────────────────────────────────────────────

create or replace view ops_inv.v_asset as
  select a.id, a.asset_no, a.name, a.category_code, a.brand, a.model, a.identifier, a.location,
         a.holder, a.status, a.acquired_on, a.purchase_cost, a.vendor_code, a.trx_no,
         a.warranty_until, a.notes, a.ended_on, a.created_by, a.created_at, a.updated_at,
         a.ownership, a.rent_amount, a.rent_period, a.rent_due_day, a.contract_start,
         a.contract_end,
         c.name as category_name,
         v.name as vendor_name,
         (select count(*) from ops_core.attachment_links l
           where l.entity = 'asset' and l.entity_no = a.asset_no and l.unlinked_at is null) as document_count,
         (a.warranty_until is not null and a.warranty_until < current_date
          and a.status not in ('disposed','lost','returned'))                            as warranty_expired,
         (a.ownership <> 'owned' and a.contract_end is not null
          and a.contract_end between current_date and current_date + 30
          and a.status not in ('disposed','lost','returned'))                            as contract_ending,
         (a.ownership <> 'owned' and a.contract_end is not null
          and a.contract_end < current_date
          and a.status not in ('disposed','lost','returned'))                            as contract_expired,
         ops_acct.rent_line_count('asset:' || a.asset_no)                                as rent_lines,
         sv.last_service_on,
         sv.next_service_due,
         (sv.next_service_due is not null and sv.next_service_due <= current_date + 14
          and a.status not in ('disposed','lost','returned'))                            as service_due,
         coalesce(sv.service_count, 0)                                                   as service_count,
         -- ── 0294: the one code (D451) ──
         a.code,
         a.family_code,
         f.label_en                                                                      as family_label,
         f.label_id                                                                      as family_label_id,
         a.description,
         a.legacy_code
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join ops_procure.vendors v on v.code = a.vendor_code
    left join ops_inv.code_families f on f.code = a.family_code
    left join lateral (
      select max(s.service_date) as last_service_on,
             -- The next due is the one the latest job *that set one* set. A
             -- repair in between (a new battery) does not cancel the oil
             -- change; a routine service done after it does, because that
             -- service was the one that was due.
             (select s2.next_due from ops_inv.asset_services s2
               where s2.asset_id = a.id and s2.next_due is not null
                 and not exists (select 1 from ops_inv.asset_services s3
                                  where s3.asset_id = a.id and s3.kind = 'service'
                                    and s3.service_date > s2.service_date)
               order by s2.service_date desc, s2.recorded_at desc limit 1) as next_service_due,
             count(*) as service_count
        from ops_inv.asset_services s where s.asset_id = a.id
    ) sv on true;

alter view ops_inv.v_asset set (security_invoker = on);

create or replace view ops_inv.v_stock_item as
select
  i.code                                   as item_code,
  i.name                                   as item_name,
  i.category_code,
  c.name                                   as category_name,
  i.base_uom                               as uom,
  coalesce(mv.on_hand, 0)                  as on_hand,
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty)::bigint end as avg_cost,
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty
               * greatest(coalesce(mv.on_hand, 0)
                          - least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)), 0))::bigint
    end as value,
  least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)) as unpriced_qty,
  s.min_qty,
  (s.min_qty is not null and coalesce(mv.on_hand, 0) < s.min_qty) as below_min,
  s.home_location,
  mv.last_move_at,
  coalesce(mv.moves_count, 0)              as moves_count,
  -- ── 0168 ──
  i.name_local                             as item_name_local,
  coalesce(ph.photo_count, 0)              as photo_count,
  -- ── 0178 ──
  i.created_at                             as registered_at,
  -- ── 0294: the one code (D451) ──
  ic.code,
  ic.family_code,
  f.label_en                               as family_label,
  ic.description
from ops_procure.items i
join ops_procure.item_categories c on c.code = i.category_code
join ops_inv.stocked_categories sc on sc.category_code = i.category_code
left join ops_inv.stock_settings s on s.item_code = i.code
left join ops_inv.item_codes ic on ic.item_code = i.code
left join ops_inv.code_families f on f.code = ic.family_code
left join lateral (
  select
    sum(qty)                                                        as on_hand,
    sum(qty) filter (where qty > 0 and unit_cost is not null)       as priced_qty,
    sum(qty * unit_cost) filter (where qty > 0 and unit_cost is not null) as priced_cost,
    sum(qty) filter (where qty > 0 and unit_cost is null and kind = 'receipt') as unpriced_in,
    max(moved_at)                                                   as last_move_at,
    count(*)::int                                                   as moves_count
  from ops_inv.stock_moves m where m.item_code = i.code
) mv on true
left join lateral (
  select count(*)::int as photo_count
    from ops_core.attachment_links l
   where l.entity = 'item' and l.entity_no = i.code
     and l.kind = 'foto' and l.unlinked_at is null
) ph on true
where i.merged_into is null;

alter view ops_inv.v_stock_item set (security_invoker = on);

-- ── 2. create_asset ───────────────────────────────────────────────────────

drop function if exists ops_inv.create_asset(text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text, text, numeric, text, int, date, date);

create or replace function ops_inv.create_asset(
  p_name text,
  p_category_code text,
  p_brand text default null,
  p_model text default null,
  p_identifier text default null,
  p_location text default null,
  p_holder text default null,
  p_status ops_inv.asset_status_t default 'in_use',
  p_acquired_on date default null,
  p_purchase_cost numeric default null,
  p_vendor_code text default null,
  p_trx_no text default null,
  p_warranty_until date default null,
  p_notes text default null,
  p_key text default null,
  p_ownership text default null,
  p_rent_amount numeric default null,
  p_rent_period text default null,
  p_rent_due_day int default null,
  p_contract_start date default null,
  p_contract_end date default null,
  p_family_code text default null,
  p_description text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare replayed jsonb; bad jsonb; v_no text; v_code text; v_name text; res jsonb; v_own text := coalesce(p_ownership, 'owned');
begin
  replayed := ops_core.idem_replay('inventory','create_asset', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','asset', null,'create',
      'not_permitted','Registering an asset needs inventory write access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('inventory','asset', null,'create',
      'name_required','An asset needs a name.', jsonb_build_object('field','name'));
  end if;
  if p_category_code is null then
    return ops_core.invalid('inventory','asset', null,'create',
      'category_required','Pick a category.', jsonb_build_object('field','category_code'));
  end if;
  if p_status in ('disposed','lost','returned') then
    return ops_core.invalid('inventory','asset', null,'create',
      'status_invalid','A new asset is in use, in storage or under repair.', jsonb_build_object('field','status'));
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    return ops_core.invalid('inventory','asset', null,'create',
      'cost_negative','A purchase cost cannot be negative.', jsonb_build_object('field','purchase_cost'));
  end if;
  -- The family is what kind of thing it is (D451). Picked, it names the code
  -- and the name is written in the 2013 register's uppercase; left out, the
  -- category's default family numbers it, as before.
  if p_family_code is not null and not exists (
       select 1 from ops_inv.code_families f
        where f.code = p_family_code and f.kind = 'unit' and not f.reserved and f.is_active) then
    return ops_core.invalid('inventory','asset', null,'create',
      'family_unknown', format('No family %s for things counted one by one.', p_family_code),
      jsonb_build_object('field','family_code'));
  end if;
  v_name := case when p_family_code is not null then upper(btrim(p_name)) else btrim(p_name) end;
  bad := ops_inv.asset_refs_invalid(null, 'create', p_category_code, p_vendor_code, p_trx_no);
  if bad is not null then return bad; end if;
  bad := ops_inv.asset_rent_invalid(null, 'create', v_own, p_rent_amount, nullif(btrim(p_rent_period), ''),
                                    p_rent_due_day, p_contract_start, p_contract_end);
  if bad is not null then return bad; end if;

  insert into ops_inv.assets (name, category_code, brand, model, identifier, location, holder, status,
                              acquired_on, purchase_cost, vendor_code, trx_no, warranty_until, notes, created_by,
                              ownership, rent_amount, rent_period, rent_due_day, contract_start, contract_end,
                              family_code, description)
  values (v_name, p_category_code, nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''),
          nullif(btrim(p_identifier), ''), nullif(btrim(p_location), ''), nullif(btrim(p_holder), ''),
          coalesce(p_status, 'in_use'), p_acquired_on, p_purchase_cost,
          nullif(btrim(p_vendor_code), ''), nullif(btrim(p_trx_no), ''), p_warranty_until,
          nullif(btrim(p_notes), ''), auth.uid(),
          v_own, p_rent_amount, nullif(btrim(p_rent_period), ''), p_rent_due_day, p_contract_start, p_contract_end,
          p_family_code, nullif(btrim(p_description), ''))
  returning asset_no, code into v_no, v_code;

  res := ops_core.ok('inventory','asset', v_no,'create',
    jsonb_build_object('asset_no', v_no, 'code', v_code), null,
    jsonb_build_object('name', v_name, 'category_code', p_category_code, 'code', v_code,
                       'description', nullif(btrim(p_description), ''),
                       'location', nullif(btrim(p_location), ''), 'holder', nullif(btrim(p_holder), ''),
                       'ownership', v_own));
  return ops_core.idem_remember('inventory','create_asset', p_key, res);
end $$;

revoke all on function ops_inv.create_asset(text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text, text, numeric, text, int, date, date, text, text) from public;
grant execute on function ops_inv.create_asset(text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text, text, numeric, text, int, date, date, text, text) to authenticated;

-- ── 3. register_item ──────────────────────────────────────────────────────

drop function if exists ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text);

create or replace function ops_inv.register_item(
  p_name          text,
  p_name_local    text,
  p_category_code text,
  p_base_uom      text,
  p_photo_ids     uuid[],
  p_location      text    default null,
  p_counted       numeric default null,
  p_reason        text    default null,
  p_key           text    default null,
  p_description   text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  v_code     text;
  v_display  text;
  v_n        int;
  v_photos   int := coalesce(array_length(p_photo_ids, 1), 0);
  v_existing text;
  v_photo    uuid;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'register_item', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','item', null,'register',
      'not_permitted','Mendaftarkan barang butuh akses tulis inventory.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('inventory','item', null,'register',
      'name_required','Barang butuh nama katalog.', jsonb_build_object('field','name'));
  end if;
  if v_photos < 1 then
    return ops_core.invalid('inventory','item', null,'register',
      'photo_required','Barang butuh minimal satu foto.', jsonb_build_object('field','photos'));
  end if;
  if v_photos > 4 then
    return ops_core.invalid('inventory','item', null,'register',
      'too_many_photos','Paling banyak empat foto per barang.',
      jsonb_build_object('field','photos','given', v_photos));
  end if;
  if (select count(distinct x) from unnest(p_photo_ids) x) <> v_photos then
    return ops_core.invalid('inventory','item', null,'register',
      'duplicate_photo','Foto yang sama dikirim dua kali.', jsonb_build_object('field','photos'));
  end if;
  if exists (select 1 from unnest(p_photo_ids) x
              where not exists (select 1 from ops_core.attachments a where a.id = x)) then
    return ops_core.not_found('inventory','item', null,'register','Salah satu foto tidak ditemukan.');
  end if;
  if not exists (select 1 from ops_procure.item_categories c where c.code = p_category_code) then
    return ops_core.invalid('inventory','item', null,'register',
      'no_such_category', format('Tidak ada kategori %s.', p_category_code),
      jsonb_build_object('field','category_code'));
  end if;
  -- Registered at a rack means counted on a rack. A category nobody stocks
  -- would make the item vanish from the very screen it was entered on.
  if not exists (select 1 from ops_inv.stocked_categories s where s.category_code = p_category_code) then
    return ops_core.invalid('inventory','item', null,'register',
      'not_stocked', format('Kategori %s tidak dihitung di gudang.', p_category_code),
      jsonb_build_object('field','category_code'));
  end if;
  if not exists (select 1 from ops_procure.uom u where u.code = p_base_uom) then
    return ops_core.invalid('inventory','item', null,'register',
      'no_such_uom', format('Tidak ada satuan %s.', p_base_uom), jsonb_build_object('field','base_uom'));
  end if;
  if p_counted is not null then
    if p_counted <= 0 then
      return ops_core.invalid('inventory','item', null,'register',
        'counted_invalid','Jumlah hasil hitung harus lebih dari nol — kosongkan kalau belum dihitung.',
        jsonb_build_object('field','counted'));
    end if;
    if not ops_core.has_permission('inventory.adjust') then
      return ops_core.refused('inventory','item', null,'register',
        'not_permitted','Mencatat hasil hitung butuh izin penyesuaian stok.');
    end if;
    if not exists (select 1 from ops_inv.stock_locations l where l.code = p_location and l.is_active) then
      return ops_core.invalid('inventory','item', null,'register',
        'location_required','Hasil hitung butuh lokasi rak yang aktif.', jsonb_build_object('field','location'));
    end if;
  end if;

  -- An exact name already in the catalogue is the same item, not a new one:
  -- count it there. Anything fuzzier is the merge tooling's job (0104).
  select i.code into v_existing from ops_procure.items i
   where i.merged_into is null and i.archived_at is null
     and (lower(btrim(i.name)) = lower(btrim(p_name))
          or (p_name_local is not null
              and lower(btrim(i.name_local)) = lower(btrim(p_name_local))))
   limit 1;
  if v_existing is not null then
    return ops_core.conflict('inventory','item', v_existing,'register',
      'already_catalogued', format('Barang ini sudah ada sebagai %s — hitung di sana.', v_existing),
      jsonb_build_object('existing_code', v_existing));
  end if;

  -- The catalogue's own numbering (0112), not a second series.
  select count(*) + 1 into v_n from ops_procure.items;
  v_code := 'I-' || lpad(v_n::text, 5, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    v_n := v_n + 1;
    v_code := 'I-' || lpad(v_n::text, 5, '0');
  end loop;

  insert into ops_procure.items (code, name, name_local, category_code, base_uom, kind, is_curated, created_by)
  values (v_code, btrim(p_name), nullif(btrim(p_name_local), ''), p_category_code, p_base_uom,
          'goods', false, auth.uid());

  -- The insert trigger gave it its code in its category's family (0293);
  -- the sentence on what it is goes with that code.
  update ops_inv.item_codes set description = nullif(btrim(p_description), '')
   where item_code = v_code
  returning code into v_display;

  foreach v_photo in array p_photo_ids loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'item', v_code, 'foto', auth.uid());
  end loop;

  if p_counted is not null then
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, ref_no, moved_by)
    values (v_code, p_location, 'adjust', p_counted, p_base_uom,
            coalesce(nullif(btrim(p_reason), ''), 'Opname: barang baru didaftarkan, dihitung saat didaftarkan'),
            null, auth.uid());
  end if;

  perform ops_core.emit('inventory','inventory.item.registered', v_code,
    jsonb_build_object('code', v_code, 'photos', v_photos, 'counted', p_counted, 'location', p_location));

  res := ops_core.ok('inventory','item', v_code,'register',
    jsonb_build_object('code', v_code, 'display_code', v_display, 'photos', v_photos, 'counted', p_counted));
  return ops_core.idem_remember('inventory','register_item', p_key, res);
end $$;

revoke all on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text, text) from public;
grant execute on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text, text) to authenticated;

-- ── 4. describe_record ────────────────────────────────────────────────────

create or replace function ops_inv.describe_record(p_kind text, p_no text, p_description text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare v_before text; v_after text := nullif(btrim(p_description), ''); v_found boolean;
begin
  if p_kind is null or p_kind not in ('asset','item') then
    return ops_core.invalid('inventory', coalesce(p_kind, 'record'), p_no,'describe',
      'unknown_kind', format('"%s" is not an asset or an item.', p_kind), jsonb_build_object('field','kind'));
  end if;
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory', p_kind, p_no,'describe',
      'not_permitted','Changing what a record says it is needs inventory update access.');
  end if;
  if p_kind = 'asset' then
    select a.description, true into v_before, v_found from ops_inv.assets a where a.asset_no = p_no;
    if not coalesce(v_found, false) then
      return ops_core.not_found('inventory','asset', p_no,'describe','No such asset.');
    end if;
    if v_before is not distinct from v_after then
      return ops_core.noop('inventory','asset', p_no,'describe', 'Already says that.', jsonb_build_object('asset_no', p_no, 'description', v_after));
    end if;
    update ops_inv.assets set description = v_after, updated_at = now() where asset_no = p_no;
  else
    select c.description, true into v_before, v_found from ops_inv.item_codes c where c.item_code = p_no;
    if not coalesce(v_found, false) then
      -- A service, or an item in a category with no family: it has no code
      -- to describe.
      return ops_core.not_found('inventory','item', p_no,'describe','No coded item by that number.');
    end if;
    if v_before is not distinct from v_after then
      return ops_core.noop('inventory','item', p_no,'describe', 'Already says that.', jsonb_build_object('code', p_no, 'description', v_after));
    end if;
    update ops_inv.item_codes set description = v_after where item_code = p_no;
  end if;
  return ops_core.ok('inventory', p_kind, p_no,'describe',
    jsonb_build_object('no', p_no, 'description', v_after),
    jsonb_build_object('description', v_before),
    jsonb_build_object('description', v_after));
end $$;

revoke all on function ops_inv.describe_record(text, text, text) from public;
grant execute on function ops_inv.describe_record(text, text, text) to authenticated;

comment on function ops_inv.describe_record(text, text, text) is
  'The one sentence on what an asset or catalogue item is and what it is used for (D451). '
  'Blank clears it; the before and after go to the audit trail. (0294)';

-- ── 5. labels ─────────────────────────────────────────────────────────────

create or replace function ops_inv.label_rows(
  p_kind  text,
  p_since date   default null,
  p_codes text[] default null,
  p_q     text   default null)
returns jsonb
language plpgsql stable set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_rows jsonb; v_q text := nullif(btrim(p_q), '');
begin
  if p_kind = 'item' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'item' as kind, i.code, ic.code as display_code, ic.description, i.name, i.name_local,
               c.name as category, i.base_uom as uom, i.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', b.location, 'name', b.location_name, 'qty', b.qty)
                                   order by b.qty desc, b.location)
                    from ops_inv.v_stock_by_location b
                   where b.item_code = i.code and b.qty > 0),
                 case when s.home_location is not null then
                   jsonb_build_array(jsonb_build_object('code', s.home_location,
                     'name', (select l.name from ops_inv.stock_locations l where l.code = s.home_location),
                     'qty', null)) end,
                 '[]'::jsonb) as locations,
               exists (select 1 from ops_inv.label_categories lc where lc.category_code = i.category_code) as labelled,
               jsonb_build_object('category_code', i.category_code) as extra
          from ops_procure.items i
          join ops_procure.item_categories c on c.code = i.category_code
          join ops_inv.stocked_categories sc on sc.category_code = i.category_code
          left join ops_inv.stock_settings s on s.item_code = i.code
          left join ops_inv.item_codes ic on ic.item_code = i.code
         where i.merged_into is null and i.archived_at is null and i.kind = 'goods'
           and (p_since is null or i.created_at >= p_since)
           and (p_codes is null or i.code = any(p_codes))
           and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
                or coalesce(ic.code, '') ilike '%' || v_q || '%'
                or coalesce(i.name_local, '') ilike '%' || v_q || '%')
         order by i.created_at desc, i.code
         limit 500
      ) r;

  elsif p_kind = 'asset' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'asset' as kind, a.asset_no as code, a.code as display_code, a.description, a.name, null::text as name_local,
               ac.name as category, null::text as uom, a.created_at as registered_at,
               case when a.location is not null
                 then jsonb_build_array(jsonb_build_object('code', a.location, 'name', coalesce(al.name, a.location), 'qty', null))
                 else '[]'::jsonb end as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'ownership', a.ownership, 'holder', a.holder, 'identifier', a.identifier,
                 'brand', a.brand, 'model', a.model, 'status', a.status,
                 'acquired_on', a.acquired_on, 'contract_end', a.contract_end)) as extra
          from ops_inv.assets a
          join ops_inv.asset_categories ac on ac.code = a.category_code
          left join ops_inv.stock_locations al on al.code = a.location
         where a.status::text not in ('disposed','lost','returned')
           and (p_since is null or a.created_at >= p_since)
           and (p_codes is null or a.asset_no = any(p_codes))
           and (v_q is null or a.asset_no ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%'
                or coalesce(a.identifier, '') ilike '%' || v_q || '%'
                or coalesce(a.code, '') ilike '%' || v_q || '%'
                or coalesce(a.legacy_code, '') ilike '%' || v_q || '%')
         order by a.created_at desc, a.asset_no
         limit 500
      ) r;

  elsif p_kind = 'product' then
    with led as (
      select l.product_code, l.location, sum(l.qty) as q
        from ops_inv.product_ledger(null) l
       group by 1, 2 having sum(l.qty) > 0
    )
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'product' as kind, p.product_code as code, null::text as display_code, null::text as description, p.name, null::text as name_local,
               p.category, p.uom, p.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', led.location, 'name', sl.name, 'qty', led.q)
                                   order by led.q desc, led.location)
                    from led left join ops_inv.stock_locations sl on sl.code = led.location
                   where led.product_code = p.product_code),
                 '[]'::jsonb) as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'length_mm', p.length_mm, 'width_mm', p.width_mm, 'height_mm', p.height_mm,
                 'dimension_note', p.dimension_note)) as extra
          from ops_prod.products p
         where p.active
           and (p_since is null or p.created_at >= p_since)
           and (p_codes is null or p.product_code = any(p_codes))
           and (v_q is null or p.product_code ilike '%' || v_q || '%' or p.name ilike '%' || v_q || '%')
         order by p.created_at desc, p.product_code
         limit 500
      ) r;
  end if;

  return v_rows;
end $$;

revoke all on function ops_inv.label_rows(text, date, text[], text) from public;

create or replace function ops_inv.label_card(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare t ops_inv.label_tokens; r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('outcome','refused','status',404,
      'error', jsonb_build_object('code','not_found','message','Label ini tidak dikenal.','outcome','refused','status',404));
  end if;

  select * into t from ops_inv.label_tokens where token = p_token;
  if found then
    r := ops_inv.label_rows(t.kind, null, array[t.code], null) -> 0;
  end if;
  if r is null then
    -- No token, or the record has gone (archived, disposed): the same answer,
    -- so a guess learns nothing.
    return jsonb_build_object('outcome','refused','status',404,
      'error', jsonb_build_object('code','not_found','message','Label ini tidak dikenal.','outcome','refused','status',404));
  end if;

  return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object(
    'kind', r->>'kind', 'code', r->>'code', 'display_code', r->>'display_code',
    'description', r->>'description', 'name', r->>'name', 'name_local', r->>'name_local',
    'category', r->>'category', 'uom', r->>'uom', 'registered_at', r->>'registered_at',
    -- Where it belongs, not how many: names only.
    'locations', coalesce((select jsonb_agg(coalesce(l->>'name', l->>'code')) from jsonb_array_elements(r->'locations') l), '[]'::jsonb),
    -- Nothing personal, nothing priced: ownership and contract end for an
    -- asset, size for a product.
    'extra', jsonb_strip_nulls(jsonb_build_object(
      'ownership', r->'extra'->>'ownership', 'status', r->'extra'->>'status',
      'contract_end', r->'extra'->>'contract_end',
      'length_mm', r->'extra'->'length_mm', 'width_mm', r->'extra'->'width_mm',
      'height_mm', r->'extra'->'height_mm', 'dimension_note', r->'extra'->>'dimension_note'))));
end $$;

revoke all on function ops_inv.label_card(text) from public;
grant execute on function ops_inv.label_card(text) to anon, authenticated;
