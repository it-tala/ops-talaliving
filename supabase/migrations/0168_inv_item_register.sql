-- 0168_inv_item_register.sql — an item registered at the rack, the way the
-- floor names it, with the photos that prove what it is.
--
-- The owner (2026-09-25), ahead of the stock opname: *di inventory user harus
-- bisa input data dengan menambahkan maksimal 4 foto minimal 1 foto per item,
-- tambahkan nama alternatif … pastikan bisa terhubung ke transaksi terkait
-- pembelian item itu.* Four pieces, one per sentence:
--
--   1. **`items.name_local`** — the catalogue is written in English (*Sandpaper
--      240*), the floor says *amplas 240*. One column, not a second catalogue:
--      the item is the same thing under two names, and two rows would be the
--      duplicate the merge tooling in 0104 exists to clean up. `aka` stays what
--      it is — spellings absorbed by a merge — and is not the place for the
--      name somebody is taught to use.
--   2. **1 to 4 photos per item.** Four is a cap the database holds, not the
--      form, because photos also arrive through the generic evidence road
--      (`attach_link`) that knows nothing about items. One is a floor held at
--      the two moments it can be held: an item registered here cannot be
--      created without one, and the last photo of an item cannot be taken off
--      (replace it — add the new one, then remove the old). The 800-odd items
--      catalogued before photos existed are not made invalid by this; they
--      read `photo_count = 0`, which the screen names as a gap (D150).
--   3. **`ops_inv.register_item`** — the one write that does all of it at the
--      rack: the item, its photos and, optionally, the count found on the rack
--      right now, as an opname adjustment against a location (D171 unchanged:
--      the difference from zero is stored, with a sentence).
--   4. **Purchases readable from inventory.** `item_purchases` (0104) already
--      answers "which ledger lines bought this", through
--      `transaction_lines.item_id` — but only for `procurement.read`. An
--      inventory reader already sees what the stock cost (`v_stock_item.
--      avg_cost`), so the lines that price it are no secret from them.

-- ── 1. the floor's name ─────────────────────────────────────────────────────
alter table ops_procure.items add column if not exists name_local text;

do $$ begin
  alter table ops_procure.items add constraint item_name_local_not_blank
    check (name_local is null or length(btrim(name_local)) > 0);
exception when duplicate_object then null; end $$;

comment on column ops_procure.items.name_local is
  'The name the floor uses (Indonesian), beside the catalogue name. Null until '
  'somebody says it. Searched like the name; never a second item (0168).';

create index if not exists items_name_local_search_idx on ops_procure.items
  using gin (to_tsvector('simple'::regconfig, coalesce(name_local, '')));

-- `v_item_view` (0104) was written as `select i.*`, which Postgres expands to
-- the columns that existed on the day — so the new column does not reach the
-- catalogue screen until the view is rebuilt. 0104's body, unchanged. Nothing
-- depends on this view, so drop-and-create is safe.
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

-- ── 2. photo rules ──────────────────────────────────────────────────────────
--
-- Invoker, not definer: `links_read` lets every signed-in user count links, so
-- nothing here needs to see more than the caller already can. The advisory
-- lock serialises two uploads racing for the fourth slot on the same item.
create or replace function ops_inv.item_photo_rules()
returns trigger
language plpgsql set search_path = ops_core, pg_temp as $$
declare v_live int;
begin
  if tg_op = 'INSERT' then
    if new.entity = 'item' and new.kind = 'foto' and new.unlinked_at is null then
      perform pg_advisory_xact_lock(hashtext('item-photo:' || new.entity_no));
      select count(*) into v_live from ops_core.attachment_links l
       where l.entity = 'item' and l.entity_no = new.entity_no
         and l.kind = 'foto' and l.unlinked_at is null;
      if v_live >= 4 then
        raise exception using errcode = 'check_violation',
          message = format('Barang %s sudah punya 4 foto. Hapus satu dulu sebelum menambah.', new.entity_no);
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.entity = 'item' and old.kind = 'foto'
       and old.unlinked_at is null and new.unlinked_at is not null then
      perform pg_advisory_xact_lock(hashtext('item-photo:' || old.entity_no));
      select count(*) into v_live from ops_core.attachment_links l
       where l.entity = 'item' and l.entity_no = old.entity_no
         and l.kind = 'foto' and l.unlinked_at is null;
      if v_live <= 1 then
        raise exception using errcode = 'check_violation',
          message = format('Barang %s harus punya minimal satu foto. Tambahkan foto penggantinya dulu, baru hapus yang ini.', old.entity_no);
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists item_photo_rules on ops_core.attachment_links;
create trigger item_photo_rules
  before insert or update on ops_core.attachment_links
  for each row execute function ops_inv.item_photo_rules();

-- ── 3. registering at the rack ──────────────────────────────────────────────
create or replace function ops_inv.register_item(
  p_name          text,
  p_name_local    text,
  p_category_code text,
  p_base_uom      text,
  p_photo_ids     uuid[],
  p_location      text    default null,
  p_counted       numeric default null,
  p_reason        text    default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  v_code     text;
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
    jsonb_build_object('code', v_code, 'photos', v_photos, 'counted', p_counted));
  return ops_core.idem_remember('inventory','register_item', p_key, res);
end $$;

-- The floor's name for items already in the catalogue — most of the rack.
create or replace function ops_inv.set_item_local_name(p_code text, p_name_local text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare v_before text; v_found boolean;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','item', p_code,'set_local_name',
      'not_permitted','Mengubah nama lapangan butuh akses ubah inventory.');
  end if;
  select i.name_local, true into v_before, v_found from ops_procure.items i where i.code = p_code;
  if not coalesce(v_found, false) then
    return ops_core.not_found('inventory','item', p_code,'set_local_name','Barang tidak ditemukan.');
  end if;
  update ops_procure.items set name_local = nullif(btrim(p_name_local), '') where code = p_code;
  return ops_core.ok('inventory','item', p_code,'set_local_name',
    jsonb_build_object('code', p_code, 'name_local', nullif(btrim(p_name_local), '')),
    jsonb_build_object('name_local', v_before),
    jsonb_build_object('name_local', nullif(btrim(p_name_local), '')));
end $$;

revoke all on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text) from public;
revoke all on function ops_inv.set_item_local_name(text, text) from public;
grant execute on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text) to authenticated;
grant execute on function ops_inv.set_item_local_name(text, text) to authenticated;

-- ── 4. purchases, readable from inventory ───────────────────────────────────
-- 0104's body, unchanged but for the gate.
create or replace function ops_procure.item_purchases(p_code text, p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare i ops_procure.items; rows jsonb;
begin
  if not (ops_core.has_permission('procurement.read') or ops_core.has_permission('inventory.read')) then
    return ops_core.refused('procurement','item', p_code,'purchases',
      'not_permitted','Reading purchase history needs procurement or inventory access.');
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

  return jsonb_build_object('outcome','ok','status',200,'data', rows);
end $$;

-- ── the rack, with the floor's name and how many photos ─────────────────────
-- 0071's columns in 0071's order, then the two new ones — the only change
-- `create or replace view` allows.
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
  coalesce(ph.photo_count, 0)              as photo_count
from ops_procure.items i
join ops_procure.item_categories c on c.code = i.category_code
join ops_inv.stocked_categories sc on sc.category_code = i.category_code
left join ops_inv.stock_settings s on s.item_code = i.code
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
