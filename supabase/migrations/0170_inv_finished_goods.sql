-- 0170_inv_finished_goods.sql — what the workshop made, on a rack until it ships.
--
-- The owner (2026-09-25): *selain inventory barang produksi, aset perusahaan,
-- tambahkan juga untuk database inventory produk hasil produksi atau kelebihan
-- produksi dari order.* Until now a finished product left the system the
-- moment its work order closed: nothing said the eleven chairs were standing
-- in the finishing shed, and the two made over the order's ten were nowhere
-- at all — found at the next opname, or not.
--
-- ── Why not `stock_moves` ───────────────────────────────────────────────────
--
-- A product is not a catalogue item. `stock_moves.item_code` means
-- `ops_procure.items.code`, and every write path into it refuses a product
-- code (the rack is valued at purchase cost; a chair has no purchase cost).
-- A second ledger with the same shape — signed moves, on-hand computed on read
-- (A3) — keeps both rules intact rather than bending one table to two meanings.
--
-- ── What a finished-goods move carries ──────────────────────────────────────
--
--   **The job order** (`wo_no`) on every `produced` move: goods appear on the
--   rack because a JO made them, never from nowhere (an opname difference is
--   `adjust`, with its sentence, D171). The JO's **customer order line**
--   (`project_line_id`) rides along, derived, never typed — it is what lets
--   the rack say *these six belong to Villa Sanur, these two are over*.
--
-- ── What is derived rather than stored twice (D53, D203) ────────────────────
--
--   **Shipping.** A delivery note (`ops_dlv.delivery_lines`) already records
--   that four chairs left for the site. Writing that again here is the double
--   entry D53 forbids, and the two would drift the first time a delivery is
--   cancelled. So the ledger reads shipments off the delivery notes — for
--   order lines that have finished goods recorded, and only from deliveries
--   made on or after the first one was recorded (history before this
--   migration is not subtracted from a rack it never added to). They leave
--   from the product's home location (`product_settings`, else GUDANG).
--
--   **Overrun** (*kelebihan produksi*). Produced beyond the line's ordered
--   quantity, and — the figure that matters on the floor — **surplus**: what
--   is on the rack beyond what the customer is still owed. Both computed.
--
-- Deliveries are readable only to `ops_dlv.can_read()`; somebody holding
-- `inventory.read` alone would see a rack that never ships. So the ledger is a
-- definer function that decides inside, not an invoker view.

create type ops_inv.product_move_kind_t as enum
  ('produced','adjust','transfer','scrap','sold','return','allocated');

insert into ops_core.doc_prefixes (prefix, what) values ('fgm', 'finished goods move')
  on conflict (prefix) do nothing;

create table ops_inv.product_moves (
  id               uuid primary key default gen_random_uuid(),
  move_no          text not null unique default ops_core.next_doc_number('fgm'),
  -- `ops_prod.products.product_code`, at the seam (ADR-004). Counted in the
  -- product's own unit.
  product_code     text not null,
  location         text not null references ops_inv.stock_locations(code),
  kind             ops_inv.product_move_kind_t not null,
  -- Signed, as `stock_moves.qty`.
  qty              numeric not null,
  -- The JO that made it. Required on `produced`; carried on the rest when the
  -- goods are a JO's batch.
  wo_no            text,
  -- Whose order these are. Null is stock made for nobody in particular.
  project_line_id  uuid references ops_procure.project_lines(id),
  ref_no           text,
  reason           text,
  moved_by         uuid not null references ops_core.users(id),
  moved_at         timestamptz not null default now(),

  constraint fg_qty_says_something check (qty <> 0),
  constraint fg_produced_adds  check (kind <> 'produced' or (qty > 0 and wo_no is not null)),
  constraint fg_return_adds    check (kind <> 'return' or qty > 0),
  constraint fg_scrap_removes  check (kind <> 'scrap' or qty < 0),
  constraint fg_sold_removes   check (kind <> 'sold' or qty < 0),
  -- The sentence is the record (D171).
  constraint fg_says_why check (
    kind not in ('adjust','scrap','sold','return','allocated')
    or (reason is not null and length(btrim(reason)) > 0))
);

create index product_moves_product_idx on ops_inv.product_moves (product_code, location);
create index product_moves_line_idx    on ops_inv.product_moves (project_line_id);
create index product_moves_wo_idx      on ops_inv.product_moves (wo_no);

create table ops_inv.product_settings (
  product_code   text primary key,
  home_location  text references ops_inv.stock_locations(code)
);

alter table ops_inv.product_moves    enable row level security;
alter table ops_inv.product_settings enable row level security;

create policy fg_moves_read on ops_inv.product_moves for select to authenticated
  using ((select ops_core.has_permission('inventory.read')));
create policy fg_settings_read on ops_inv.product_settings for select to authenticated
  using ((select ops_core.has_permission('inventory.read')));
-- Writes only through the seams below.

grant select on ops_inv.product_moves, ops_inv.product_settings to authenticated;

-- ── the ledger: stored moves plus shipments read off the delivery notes ──────
create or replace function ops_inv.product_ledger(p_product_code text default null)
returns table (
  move_no text, product_code text, location text, kind text, qty numeric,
  wo_no text, project_line_id uuid, ref_no text, reason text,
  moved_by uuid, moved_at timestamptz)
language plpgsql stable security definer
set search_path = ops_inv, ops_dlv, ops_procure, ops_core, pg_temp as $$
begin
  if not ops_core.has_permission('inventory.read') then
    return;
  end if;
  return query
  select m.move_no, m.product_code, m.location, m.kind::text, m.qty,
         m.wo_no, m.project_line_id, m.ref_no, m.reason, m.moved_by, m.moved_at
    from ops_inv.product_moves m
   where p_product_code is null or m.product_code = p_product_code
  union all
  select d.delivery_no, pl.product_code,
         coalesce(s.home_location, 'GUDANG'), 'shipped', -dl.qty,
         null::text, dl.project_line_id, d.delivery_no, null::text,
         d.created_by, d.created_at
    from ops_dlv.delivery_lines dl
    join ops_dlv.deliveries d on d.id = dl.delivery_id and d.status <> 'CANCELLED'
    join ops_procure.project_lines pl on pl.id = dl.project_line_id
    join lateral (
      select min(m.moved_at) as since from ops_inv.product_moves m
       where m.project_line_id = dl.project_line_id
    ) f on f.since is not null and d.created_at >= f.since
    left join ops_inv.product_settings s on s.product_code = pl.product_code
   where pl.product_code is not null
     and (p_product_code is null or pl.product_code = p_product_code);
end $$;

-- On hand for one batch at one location — what the seams check against.
create or replace function ops_inv.product_on_hand(
  p_product_code text, p_project_line_id uuid, p_location text)
returns numeric
language sql stable security definer set search_path = ops_inv, ops_core, pg_temp as $$
  select coalesce(sum(l.qty), 0)
    from ops_inv.product_ledger(p_product_code) l
   where l.location = p_location
     and l.project_line_id is not distinct from p_project_line_id;
$$;

-- ── the rack of finished goods ──────────────────────────────────────────────
-- One row per product × order line (null line = stock made for nobody).
create or replace function ops_inv.product_stock(p_product_code text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ops_inv, ops_prod, ops_procure, ops_core, pg_temp as $$
declare v_rows jsonb;
begin
  if not ops_core.has_permission('inventory.read') then
    return ops_core.refused('inventory','product', p_product_code,'stock',
      'not_permitted','Membaca stok barang jadi butuh akses baca inventory.');
  end if;

  with led as (
    select * from ops_inv.product_ledger(p_product_code)
  ), batch as (
    select l.product_code, l.project_line_id,
           sum(l.qty) filter (where l.kind = 'produced')  as produced,
           -sum(l.qty) filter (where l.kind = 'shipped')  as shipped,
           sum(l.qty) filter (where l.kind = 'allocated')  as allocated,
           sum(l.qty) filter (where l.kind not in ('produced','shipped','allocated')) as other,
           sum(l.qty)                                      as on_hand,
           max(l.moved_at)                                 as last_move_at,
           array_remove(array_agg(distinct l.wo_no), null) as wo_nos
      from led l group by l.product_code, l.project_line_id
  ), loc as (
    select l.product_code, l.project_line_id,
           jsonb_object_agg(l.location, l.q order by l.location) as by_location
      from (select product_code, project_line_id, location, sum(qty) as q
              from led group by 1, 2, 3 having sum(qty) <> 0) l
     group by 1, 2
  )
  select coalesce(jsonb_agg(r order by r.product_code, r.project_code nulls first, r.line_no), '[]'::jsonb)
    into v_rows
    from (
      select b.product_code, p.name as product_name, p.uom,
             b.project_line_id, pr.code as project_code, pl.line_no,
             pl.description as line_description, pl.qty as ordered,
             coalesce(b.produced, 0) as produced,
             coalesce(b.shipped, 0)  as shipped,
             coalesce(b.other, 0)    as other,
             -- Net surplus moved in from (+) or out to (−) other orders (D313).
             coalesce(b.allocated, 0) as allocated,
             coalesce(b.on_hand, 0)  as on_hand,
             case when pl.id is not null
               then greatest(coalesce(b.produced, 0) - pl.qty, 0) else 0 end as overrun,
             -- What the customer is still owed out of this batch.
             case when pl.id is not null
               then greatest(pl.qty - coalesce(b.shipped, 0), 0) else 0 end as still_owed,
             -- On the rack beyond anything owed: free to sell or reuse.
             greatest(coalesce(b.on_hand, 0)
                      - case when pl.id is not null
                          then greatest(pl.qty - coalesce(b.shipped, 0), 0) else 0 end, 0) as surplus,
             coalesce(lc.by_location, '{}'::jsonb) as by_location,
             to_jsonb(b.wo_nos) as wo_nos,
             s.home_location,
             b.last_move_at
        from batch b
        left join ops_prod.products p on p.product_code = b.product_code
        left join ops_procure.project_lines pl on pl.id = b.project_line_id
        left join ops_procure.projects pr on pr.id = pl.project_id
        left join loc lc on lc.product_code = b.product_code
                        and lc.project_line_id is not distinct from b.project_line_id
        left join ops_inv.product_settings s on s.product_code = b.product_code
    ) r;

  return jsonb_build_object('outcome','ok','status',200,'data', v_rows);
end $$;

-- ── moving finished goods ───────────────────────────────────────────────────
-- p_qty is always positive; the kind gives the sign.
create or replace function ops_inv.move_product(
  p_product_code    text,
  p_kind            text,
  p_qty             numeric,
  p_location        text,
  p_to_location     text    default null,
  p_wo_no           text    default null,
  p_project_line_id uuid    default null,
  p_ref_no          text    default null,
  p_reason          text    default null,
  p_key             text    default null)
returns jsonb
language plpgsql security definer
set search_path = ops_inv, ops_prod, ops_procure, ops_core, pg_temp as $$
declare
  v_wo       ops_prod.work_orders;
  v_line     uuid := p_project_line_id;
  v_line_pc  text;
  v_have     numeric;
  v_no       text;
  v_no2      text;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'move_product', p_key);
  if replayed is not null then return replayed; end if;

  if p_kind not in ('produced','transfer','scrap','sold','return') then
    return ops_core.invalid('inventory','product', p_product_code,'move',
      'no_such_kind', format('Jenis gerak %s tidak dikenal.', p_kind), jsonb_build_object('field','kind'));
  end if;
  -- Scrapping is declaring goods gone that nobody moved out — the same
  -- permission as an opname difference (D171).
  if not ops_core.has_permission(case when p_kind = 'scrap' then 'inventory.adjust' else 'inventory.create' end) then
    return ops_core.refused('inventory','product', p_product_code,'move',
      'not_permitted','Mencatat gerak barang jadi butuh akses tulis inventory.');
  end if;
  if not exists (select 1 from ops_prod.products p where p.product_code = p_product_code) then
    return ops_core.not_found('inventory','product', p_product_code,'move','Produk tidak ditemukan.');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    return ops_core.invalid('inventory','product', p_product_code,'move',
      'qty_invalid','Jumlah harus lebih dari nol.', jsonb_build_object('field','qty'));
  end if;
  if not exists (select 1 from ops_inv.stock_locations l where l.code = p_location and l.is_active) then
    return ops_core.invalid('inventory','product', p_product_code,'move',
      'no_such_location','Lokasi tidak ada atau tidak aktif.', jsonb_build_object('field','location'));
  end if;
  if p_kind in ('scrap','sold','return') and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('inventory','product', p_product_code,'move',
      'reason_required','Tulis alasannya — siapa pembelinya, kenapa rusak, dari mana kembalinya.',
      jsonb_build_object('field','reason'));
  end if;

  if p_kind = 'produced' then
    select * into v_wo from ops_prod.work_orders w where w.wo_no = p_wo_no;
    if not found then
      return ops_core.invalid('inventory','product', p_product_code,'move',
        'wo_required','Hasil produksi harus menyebut Job Order yang membuatnya.', jsonb_build_object('field','wo_no'));
    end if;
    if v_wo.status = 'CANCELLED' then
      return ops_core.refused('inventory','product', p_product_code,'move',
        'wo_cancelled', format('%s sudah dibatalkan.', v_wo.wo_no));
    end if;
    if v_wo.product_code is distinct from p_product_code then
      return ops_core.invalid('inventory','product', p_product_code,'move',
        'wo_other_product',
        format('%s membuat %s, bukan %s.', v_wo.wo_no, coalesce(v_wo.product_code, 'barang di luar katalog'), p_product_code),
        jsonb_build_object('field','wo_no'));
    end if;
    -- Whose order it is comes from the JO, never from the form.
    v_line := v_wo.project_line_id;
  elsif v_line is not null then
    select pl.product_code into v_line_pc from ops_procure.project_lines pl where pl.id = v_line;
    if not found or v_line_pc is distinct from p_product_code then
      return ops_core.invalid('inventory','product', p_product_code,'move',
        'line_other_product','Baris pesanan itu bukan untuk produk ini.', jsonb_build_object('field','project_line_id'));
    end if;
  end if;

  if p_kind = 'transfer' then
    if p_to_location is null or p_to_location = p_location
       or not exists (select 1 from ops_inv.stock_locations l where l.code = p_to_location and l.is_active) then
      return ops_core.invalid('inventory','product', p_product_code,'move',
        'no_such_location','Lokasi tujuan harus lokasi aktif yang lain.', jsonb_build_object('field','to_location'));
    end if;
  end if;

  if p_kind in ('transfer','scrap','sold') then
    perform pg_advisory_xact_lock(hashtext('fg:' || p_product_code));
    v_have := ops_inv.product_on_hand(p_product_code, v_line, p_location);
    if v_have < p_qty then
      return ops_core.conflict('inventory','product', p_product_code,'move',
        'insufficient', format('Di %s hanya ada %s.', p_location, v_have),
        jsonb_build_object('on_hand', v_have));
    end if;
  end if;

  insert into ops_inv.product_moves (product_code, location, kind, qty, wo_no, project_line_id, ref_no, reason, moved_by)
  values (p_product_code, p_location, p_kind::ops_inv.product_move_kind_t,
          case when p_kind in ('produced','return') then p_qty else -p_qty end,
          coalesce(v_wo.wo_no, nullif(btrim(p_wo_no), '')), v_line,
          nullif(btrim(p_ref_no), ''), nullif(btrim(p_reason), ''), auth.uid())
  returning move_no into v_no;

  if p_kind = 'transfer' then
    insert into ops_inv.product_moves (product_code, location, kind, qty, wo_no, project_line_id, ref_no, reason, moved_by)
    values (p_product_code, p_to_location, 'transfer', p_qty, nullif(btrim(p_wo_no), ''), v_line,
            v_no, nullif(btrim(p_reason), ''), auth.uid())
    returning move_no into v_no2;
  end if;

  perform ops_core.emit('inventory','inventory.product.moved', v_no,
    jsonb_build_object('product_code', p_product_code, 'kind', p_kind, 'qty', p_qty,
                       'location', p_location, 'to_location', p_to_location,
                       'wo_no', v_wo.wo_no, 'project_line_id', v_line));

  res := ops_core.ok('inventory','product', p_product_code,'move',
    jsonb_build_object('move_no', v_no, 'transfer_in_no', v_no2, 'project_line_id', v_line));
  return ops_core.idem_remember('inventory','move_product', p_key, res);
end $$;

-- ── counting the finished-goods rack (opname) ──────────────────────────────
-- The difference is stored, with the sentence (D171). Zero difference is an
-- answer too, and writes nothing.
create or replace function ops_inv.count_product(
  p_product_code    text,
  p_location        text,
  p_counted         numeric,
  p_reason          text,
  p_project_line_id uuid default null,
  p_key             text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_inv, ops_prod, ops_procure, ops_core, pg_temp as $$
declare
  v_have     numeric;
  v_diff     numeric;
  v_no       text;
  v_line_pc  text;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'count_product', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.adjust') then
    return ops_core.refused('inventory','product', p_product_code,'count',
      'not_permitted','Mencatat hasil hitung butuh izin penyesuaian stok.');
  end if;
  if not exists (select 1 from ops_prod.products p where p.product_code = p_product_code) then
    return ops_core.not_found('inventory','product', p_product_code,'count','Produk tidak ditemukan.');
  end if;
  if p_counted is null or p_counted < 0 then
    return ops_core.invalid('inventory','product', p_product_code,'count',
      'counted_invalid','Hasil hitung tidak boleh kosong atau minus.', jsonb_build_object('field','counted'));
  end if;
  if not exists (select 1 from ops_inv.stock_locations l where l.code = p_location and l.is_active) then
    return ops_core.invalid('inventory','product', p_product_code,'count',
      'no_such_location','Lokasi tidak ada atau tidak aktif.', jsonb_build_object('field','location'));
  end if;
  if p_project_line_id is not null then
    select pl.product_code into v_line_pc from ops_procure.project_lines pl where pl.id = p_project_line_id;
    if not found or v_line_pc is distinct from p_product_code then
      return ops_core.invalid('inventory','product', p_product_code,'count',
        'line_other_product','Baris pesanan itu bukan untuk produk ini.', jsonb_build_object('field','project_line_id'));
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('fg:' || p_product_code));
  v_have := ops_inv.product_on_hand(p_product_code, p_project_line_id, p_location);
  v_diff := p_counted - v_have;
  if v_diff = 0 then
    return ops_core.ok('inventory','product', p_product_code,'count',
      jsonb_build_object('diff', 0, 'on_hand', v_have));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('inventory','product', p_product_code,'count',
      'reason_required', format('Sistem mencatat %s, dihitung %s. Tulis kenapa berbeda.', v_have, p_counted),
      jsonb_build_object('field','reason','on_hand', v_have));
  end if;

  insert into ops_inv.product_moves (product_code, location, kind, qty, project_line_id, reason, moved_by)
  values (p_product_code, p_location, 'adjust', v_diff, p_project_line_id, btrim(p_reason), auth.uid())
  returning move_no into v_no;

  perform ops_core.emit('inventory','inventory.product.counted', v_no,
    jsonb_build_object('product_code', p_product_code, 'location', p_location,
                       'was', v_have, 'counted', p_counted, 'diff', v_diff));

  res := ops_core.ok('inventory','product', p_product_code,'count',
    jsonb_build_object('move_no', v_no, 'diff', v_diff, 'on_hand', p_counted),
    jsonb_build_object('on_hand', v_have), jsonb_build_object('on_hand', p_counted));
  return ops_core.idem_remember('inventory','count_product', p_key, res);
end $$;

create or replace function ops_inv.set_product_home(p_product_code text, p_location text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_prod, ops_core, pg_temp as $$
declare v_before text;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','product', p_product_code,'set_home',
      'not_permitted','Mengubah lokasi rumah butuh akses ubah inventory.');
  end if;
  if not exists (select 1 from ops_prod.products p where p.product_code = p_product_code) then
    return ops_core.not_found('inventory','product', p_product_code,'set_home','Produk tidak ditemukan.');
  end if;
  if p_location is not null
     and not exists (select 1 from ops_inv.stock_locations l where l.code = p_location and l.is_active) then
    return ops_core.invalid('inventory','product', p_product_code,'set_home',
      'no_such_location','Lokasi tidak ada atau tidak aktif.', jsonb_build_object('field','location'));
  end if;
  select s.home_location into v_before from ops_inv.product_settings s where s.product_code = p_product_code;
  insert into ops_inv.product_settings (product_code, home_location) values (p_product_code, p_location)
    on conflict (product_code) do update set home_location = excluded.home_location;
  return ops_core.ok('inventory','product', p_product_code,'set_home',
    jsonb_build_object('product_code', p_product_code, 'home_location', p_location),
    jsonb_build_object('home_location', v_before), jsonb_build_object('home_location', p_location));
end $$;

-- ── surplus used for another order (D313) ───────────────────────────────────
-- The owner (2026-09-25): *surplus finished goods bisa dipakai untuk order
-- lain.* Two rows, like a transfer, but between order lines at one location:
-- out of the batch it was made for, into the order it now serves. Only the
-- **surplus** may move — what the source order is still owed stays with it —
-- and stock made for nobody (null line) is all surplus. The target must be an
-- order line for the same product. Produced and overrun stay on the source
-- line: they are what happened; the move is what was decided afterwards.
create or replace function ops_inv.allocate_product(
  p_product_code    text,
  p_from_line_id    uuid,
  p_to_line_id      uuid,
  p_location        text,
  p_qty             numeric,
  p_reason          text,
  p_key             text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_inv, ops_prod, ops_procure, ops_core, pg_temp as $$
declare
  v_to_pc     text;
  v_from_pc   text;
  v_ordered   numeric;
  v_shipped   numeric;
  v_on_hand   numeric;
  v_here      numeric;
  v_surplus   numeric;
  v_no        text;
  v_no2       text;
  res         jsonb;
  replayed    jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'allocate_product', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','product', p_product_code,'allocate',
      'not_permitted','Memindahkan surplus ke pesanan lain butuh akses tulis inventory.');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    return ops_core.invalid('inventory','product', p_product_code,'allocate',
      'qty_invalid','Jumlah harus lebih dari nol.', jsonb_build_object('field','qty'));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('inventory','product', p_product_code,'allocate',
      'reason_required','Tulis alasannya — kenapa surplus ini dipakai untuk pesanan itu.',
      jsonb_build_object('field','reason'));
  end if;
  select pl.product_code into v_to_pc from ops_procure.project_lines pl where pl.id = p_to_line_id;
  if not found or v_to_pc is distinct from p_product_code then
    return ops_core.invalid('inventory','product', p_product_code,'allocate',
      'line_other_product','Pesanan tujuan bukan untuk produk ini.', jsonb_build_object('field','to_line_id'));
  end if;
  if p_to_line_id is not distinct from p_from_line_id then
    return ops_core.invalid('inventory','product', p_product_code,'allocate',
      'same_line','Pesanan asal dan tujuan sama.', jsonb_build_object('field','to_line_id'));
  end if;
  if p_from_line_id is not null then
    select pl.product_code, pl.qty into v_from_pc, v_ordered from ops_procure.project_lines pl where pl.id = p_from_line_id;
    if not found or v_from_pc is distinct from p_product_code then
      return ops_core.invalid('inventory','product', p_product_code,'allocate',
        'line_other_product','Batch asal bukan untuk produk ini.', jsonb_build_object('field','from_line_id'));
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('fg:' || p_product_code));
  select coalesce(sum(l.qty), 0),
         coalesce(-sum(l.qty) filter (where l.kind = 'shipped'), 0),
         coalesce(sum(l.qty) filter (where l.location = p_location), 0)
    into v_on_hand, v_shipped, v_here
    from ops_inv.product_ledger(p_product_code) l
   where l.project_line_id is not distinct from p_from_line_id;
  v_surplus := greatest(v_on_hand - case when p_from_line_id is null then 0
                                         else greatest(v_ordered - v_shipped, 0) end, 0);
  if p_qty > least(v_surplus, v_here) then
    return ops_core.conflict('inventory','product', p_product_code,'allocate',
      'insufficient',
      format('Yang bisa dipindah dari batch ini di %s hanya %s (surplus %s, di lokasi ini %s).',
             p_location, greatest(least(v_surplus, v_here), 0), v_surplus, v_here),
      jsonb_build_object('surplus', v_surplus, 'at_location', v_here));
  end if;

  insert into ops_inv.product_moves (product_code, location, kind, qty, project_line_id, reason, moved_by)
  values (p_product_code, p_location, 'allocated', -p_qty, p_from_line_id, btrim(p_reason), auth.uid())
  returning move_no into v_no;
  insert into ops_inv.product_moves (product_code, location, kind, qty, project_line_id, ref_no, reason, moved_by)
  values (p_product_code, p_location, 'allocated', p_qty, p_to_line_id, v_no, btrim(p_reason), auth.uid())
  returning move_no into v_no2;

  perform ops_core.emit('inventory','inventory.product.allocated', v_no,
    jsonb_build_object('product_code', p_product_code, 'qty', p_qty, 'location', p_location,
                       'from_line_id', p_from_line_id, 'to_line_id', p_to_line_id));

  res := ops_core.ok('inventory','product', p_product_code,'allocate',
    jsonb_build_object('move_no', v_no, 'in_move_no', v_no2));
  return ops_core.idem_remember('inventory','allocate_product', p_key, res);
end $$;

revoke all on function ops_inv.product_ledger(text) from public;
revoke all on function ops_inv.product_on_hand(text, uuid, text) from public;
revoke all on function ops_inv.product_stock(text) from public;
revoke all on function ops_inv.move_product(text, text, numeric, text, text, text, uuid, text, text, text) from public;
revoke all on function ops_inv.count_product(text, text, numeric, text, uuid, text) from public;
revoke all on function ops_inv.set_product_home(text, text) from public;
revoke all on function ops_inv.allocate_product(text, uuid, uuid, text, numeric, text, text) from public;
grant execute on function ops_inv.product_ledger(text) to authenticated;
grant execute on function ops_inv.product_on_hand(text, uuid, text) to authenticated;
grant execute on function ops_inv.product_stock(text) to authenticated;
grant execute on function ops_inv.move_product(text, text, numeric, text, text, text, uuid, text, text, text) to authenticated;
grant execute on function ops_inv.count_product(text, text, numeric, text, uuid, text) to authenticated;
grant execute on function ops_inv.set_product_home(text, text) to authenticated;
grant execute on function ops_inv.allocate_product(text, uuid, uuid, text, numeric, text, text) to authenticated;

analyze ops_inv.product_moves;
analyze ops_inv.product_settings;
