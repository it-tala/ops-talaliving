-- 0222_procure_design_items.sql — a project's design: collections, rooms and
-- the items in them, each with its files and the client's approval (P4).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *Berarti kita harus memiliki daftar desain item, drawings nya, rendernya, dan
-- sebagainya dari kita sendiri maupun gambar desain dari klien itu sendiri*
-- (2026-10-06), and how the drafters work: *client - project - koleksi /
-- catalog - ruangan - item/produk* (D379). Until now a drawing could only be
-- filed on a **product**, and a product exists only once something is ordered —
-- so a proposal's items, their renders and the client's own drawings had no
-- record to belong to (kajian F224, G9).
--
-- ── What this adds ────────────────────────────────────────────────────────
--
--   design_collections  a project's collection or catalogue: `A · TYPE 2BR`
--   design_rooms        a room in it: `LR · LIVING ROOM`
--   design_items        a thing designed for that room: `26007-A-LR-01 Sofa`,
--                       with its size, how many, and who designed it — ours,
--                       the client's, or adapted from the client's reference
--   design_approvals    the client's approval of an item, append-only, with
--                       the file that was approved and the evidence (D378)
--
-- **Status is read, never stored** (A3): CONCEPT until a drawing or render is
-- on the item, DRAWN once one is, APPROVED while the latest approval stands,
-- DROPPED when the item is taken out (with a reason). P5 adds QUOTED and
-- ORDERED from the quotation lines; P6 adds the drafters' release.
--
-- An item becomes a product when it is ordered: `product_code` is empty until
-- then and is filled by the road that already makes products (P5).
--
-- ── Who ───────────────────────────────────────────────────────────────────
--
-- `may_design(level)`: whoever sells (D375) and the drafters, who hold the
-- production module. Read by the same, so the drafting team sees the client's
-- drawings without the price of the sale.
--
-- ── Files and folders ─────────────────────────────────────────────────────
--
-- A file on an item goes to `<client>/<project>/<collection>/<room>/<item>` in
-- DRAFTING; on a collection, to `<client>/<project>/<collection>/00 KOLEKSI`
-- (D313). A collection is named by its public code, `<project>-<code>`
-- (`26007-A`), never its uuid (ADR-004); an item by its number. `drive_path_for_record` learns `{COLLECTION}`, `{ROOM}` and `{ITEM}`.
--
-- ── Applying this to production ───────────────────────────────────────────
--
-- Nothing here drops anything, and no function body deletes (F226: the
-- production tool holds any statement with that word, bodies included). Every
-- function is `create or replace`; the two drive functions keep their
-- signatures.

-- ── 1. who may design ─────────────────────────────────────────────────────

create or replace function ops_procure.may_design(p_level text)
returns boolean
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_procure.may_sell(p_level) or ops_core.has_permission('production.' || p_level);
$$;
revoke all on function ops_procure.may_design(text) from public;
grant execute on function ops_procure.may_design(text) to authenticated;

comment on function ops_procure.may_design(text) is
  'Whoever sells (may_sell) and the drafters (production access), at this level. (0222)';

-- ── 2. the tables ─────────────────────────────────────────────────────────

create table ops_procure.design_collections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references ops_procure.projects(id),
  -- A, B, KAT1: short, fixed once — it is inside every item number.
  code        text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name        text not null check (length(btrim(name)) > 0),
  note        text,
  created_by  uuid references ops_core.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint collection_code_once unique (project_id, code)
);

create table ops_procure.design_rooms (
  id             uuid primary key default gen_random_uuid(),
  collection_id  uuid not null references ops_procure.design_collections(id),
  code           text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name           text not null check (length(btrim(name)) > 0),
  sort           int not null default 0,
  created_by     uuid references ops_core.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint room_code_once unique (collection_id, code)
);

create table ops_procure.design_items (
  id           uuid primary key default gen_random_uuid(),
  -- 26007-A-LR-01: project, collection, room, number in the room.
  item_no      text not null unique,
  room_id      uuid not null references ops_procure.design_rooms(id),
  seq          int not null check (seq > 0),
  name         text not null check (length(btrim(name)) > 0),
  qty          numeric not null check (qty > 0),
  length_mm    numeric check (length_mm is null or length_mm > 0),
  width_mm     numeric check (width_mm is null or width_mm > 0),
  height_mm    numeric check (height_mm is null or height_mm > 0),
  -- Who designed it: us, the client (we make what they drew), or adapted from
  -- the client's reference.
  origin       text not null check (origin in ('tala','client','adapted')),
  -- Filled when the item is ordered and becomes a product (P5).
  product_code text,
  note         text,
  dropped_at   timestamptz,
  dropped_by   uuid references ops_core.users(id),
  drop_reason  text,
  created_by   uuid references ops_core.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint item_seq_once unique (room_id, seq),
  constraint dropped_says_why check (
    (dropped_at is null and drop_reason is null)
    or (dropped_at is not null and length(btrim(drop_reason)) > 0))
);

create table ops_procure.design_approvals (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid not null references ops_procure.design_items(id),
  -- A client can take an approval back; that is a row too, never an edit.
  decision                text not null check (decision in ('approved','withdrawn')),
  decided_on              date not null,
  channel                 text not null check (channel in ('whatsapp','meeting','email','signed','other')),
  -- Who said yes, on the client's side, in their words.
  client_person           text not null check (length(btrim(client_person)) > 0),
  -- The file that was approved (a render, a drawing), when it is on the item.
  attachment_id           uuid references ops_core.attachments(id),
  -- The proof: a screenshot, a signed print, an email.
  evidence_attachment_id  uuid references ops_core.attachments(id),
  note                    text,
  recorded_by             uuid references ops_core.users(id),
  -- The clock, not the transaction: the latest decision is the one that
  -- counts, and two in one transaction must still have an order.
  recorded_at             timestamptz not null default clock_timestamp()
);
create index design_approvals_item_idx on ops_procure.design_approvals (item_id, recorded_at desc);
create index design_rooms_collection_idx on ops_procure.design_rooms (collection_id, sort);
create index design_items_room_idx on ops_procure.design_items (room_id, seq);

alter table ops_procure.design_collections enable row level security;
alter table ops_procure.design_rooms       enable row level security;
alter table ops_procure.design_items       enable row level security;
alter table ops_procure.design_approvals   enable row level security;

-- Read by whoever sells or drafts; written only through the seams below.
create policy design_collections_read on ops_procure.design_collections for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_rooms_read on ops_procure.design_rooms for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_items_read on ops_procure.design_items for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_approvals_read on ops_procure.design_approvals for select to authenticated
  using (ops_procure.may_design('read'));

grant select on ops_procure.design_collections, ops_procure.design_rooms,
                ops_procure.design_items, ops_procure.design_approvals to authenticated;

-- ── 3. the seams ──────────────────────────────────────────────────────────

-- A collection of a project, created or renamed. The code is fixed once.
create or replace function ops_procure.save_design_collection(
  p_project_code text, p_code text, p_name text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; c ops_procure.design_collections;
        v_code text := upper(btrim(coalesce(p_code, ''))); v_name text := btrim(coalesce(p_name, ''));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_collection', p_project_code,'save',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into pr from ops_procure.projects where code = btrim(coalesce(p_project_code, ''));
  if not found then
    return ops_core.not_found('project','design_collection', p_project_code,'save', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if v_code !~ '^[A-Z0-9]{1,6}$' then
    return ops_core.invalid('project','design_collection', pr.code,'save', 'bad_code',
      'Kode koleksi 1–6 huruf atau angka, mis. A, B, KAT1. Kode ini masuk ke nomor setiap item.',
      jsonb_build_object('field','code'));
  end if;
  if v_name = '' then
    return ops_core.invalid('project','design_collection', pr.code,'save', 'name_required',
      'Koleksinya dinamai apa? mis. TYPE 2BR.', jsonb_build_object('field','name'));
  end if;

  select * into c from ops_procure.design_collections where project_id = pr.id and code = v_code;
  if found then
    update ops_procure.design_collections
       set name = v_name, note = nullif(btrim(p_note), ''), updated_at = now()
     where id = c.id;
    return ops_core.ok('project','design_collection', pr.code || '-' || v_code,'update',
      jsonb_build_object('project_code', pr.code, 'code', v_code),
      jsonb_build_object('name', c.name, 'note', c.note),
      jsonb_build_object('name', v_name, 'note', nullif(btrim(p_note), '')));
  end if;
  insert into ops_procure.design_collections (project_id, code, name, note, created_by)
  values (pr.id, v_code, v_name, nullif(btrim(p_note), ''), auth.uid());
  return ops_core.ok('project','design_collection', pr.code || '-' || v_code,'create',
    jsonb_build_object('project_code', pr.code, 'code', v_code));
end $$;
revoke all on function ops_procure.save_design_collection(text, text, text, text) from public;
grant execute on function ops_procure.save_design_collection(text, text, text, text) to authenticated;

-- A room in a collection, created or renamed. The code is fixed once.
create or replace function ops_procure.save_design_room(
  p_project_code text, p_collection_code text, p_code text, p_name text, p_sort int default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.design_collections; r ops_procure.design_rooms;
        v_code text := upper(btrim(coalesce(p_code, ''))); v_name text := btrim(coalesce(p_name, ''));
        v_ref text := btrim(coalesce(p_project_code, '')) || '-' || upper(btrim(coalesce(p_collection_code, '')));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_room', v_ref,'save',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select dc.* into c from ops_procure.design_collections dc
    join ops_procure.projects p on p.id = dc.project_id
   where p.code = btrim(coalesce(p_project_code, '')) and dc.code = upper(btrim(coalesce(p_collection_code, '')));
  if not found then
    return ops_core.not_found('project','design_room', v_ref,'save', format('Tidak ada koleksi %s.', v_ref));
  end if;
  if v_code !~ '^[A-Z0-9]{1,6}$' then
    return ops_core.invalid('project','design_room', v_ref,'save', 'bad_code',
      'Kode ruangan 1–6 huruf atau angka, mis. LR, MB, DN. Kode ini masuk ke nomor setiap item.',
      jsonb_build_object('field','code'));
  end if;
  if v_name = '' then
    return ops_core.invalid('project','design_room', v_ref,'save', 'name_required',
      'Ruangannya apa? mis. Living room.', jsonb_build_object('field','name'));
  end if;

  select * into r from ops_procure.design_rooms where collection_id = c.id and code = v_code;
  if found then
    update ops_procure.design_rooms
       set name = v_name, sort = coalesce(p_sort, sort), updated_at = now()
     where id = r.id;
    return ops_core.ok('project','design_room', v_ref || '-' || v_code,'update',
      jsonb_build_object('code', v_code), jsonb_build_object('name', r.name), jsonb_build_object('name', v_name));
  end if;
  insert into ops_procure.design_rooms (collection_id, code, name, sort, created_by)
  values (c.id, v_code, v_name,
          coalesce(p_sort, (select coalesce(max(sort), 0) + 1 from ops_procure.design_rooms where collection_id = c.id)),
          auth.uid());
  return ops_core.ok('project','design_room', v_ref || '-' || v_code,'create', jsonb_build_object('code', v_code));
end $$;
revoke all on function ops_procure.save_design_room(text, text, text, text, int) from public;
grant execute on function ops_procure.save_design_room(text, text, text, text, int) to authenticated;

-- An item: created in a room (numbered there), or corrected by its number.
-- It never moves room: its number says where it is.
create or replace function ops_procure.save_design_item(
  p_project_code text, p_collection_code text, p_room_code text,
  p_name text, p_qty numeric, p_origin text,
  p_length_mm numeric default null, p_width_mm numeric default null, p_height_mm numeric default null,
  p_note text default null, p_item_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.design_rooms; i ops_procure.design_items; v_seq int; v_no text;
        v_name text := btrim(coalesce(p_name, '')); v_origin text := lower(btrim(coalesce(p_origin, '')));
        v_ref text := coalesce(nullif(btrim(p_item_no), ''),
                               btrim(coalesce(p_project_code, '')) || '-' || upper(btrim(coalesce(p_collection_code, '')))
                               || '-' || upper(btrim(coalesce(p_room_code, ''))));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', v_ref,'save',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  if v_name = '' then
    return ops_core.invalid('project','design_item', v_ref,'save', 'name_required',
      'Itemnya apa? mis. Sofa 3 seater.', jsonb_build_object('field','name'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('project','design_item', v_ref,'save', 'qty_required',
      'Berapa unit?', jsonb_build_object('field','qty'));
  end if;
  if v_origin not in ('tala','client','adapted') then
    return ops_core.invalid('project','design_item', v_ref,'save', 'unknown_origin',
      'Siapa yang mendesain: tala, client, atau adapted (dari referensi klien)?', jsonb_build_object('field','origin'));
  end if;
  if coalesce(p_length_mm, 1) <= 0 or coalesce(p_width_mm, 1) <= 0 or coalesce(p_height_mm, 1) <= 0 then
    return ops_core.invalid('project','design_item', v_ref,'save', 'bad_size',
      'Ukuran dalam mm, lebih dari nol — atau kosongkan.', jsonb_build_object('field','length_mm'));
  end if;

  if nullif(btrim(p_item_no), '') is not null then
    select * into i from ops_procure.design_items where item_no = btrim(p_item_no);
    if not found then
      return ops_core.not_found('project','design_item', p_item_no,'update', format('Tidak ada item %s.', p_item_no));
    end if;
    update ops_procure.design_items set
      name = v_name, qty = p_qty, origin = v_origin,
      length_mm = p_length_mm, width_mm = p_width_mm, height_mm = p_height_mm,
      note = nullif(btrim(p_note), ''), updated_at = now()
    where id = i.id;
    return ops_core.ok('project','design_item', i.item_no,'update', jsonb_build_object('item_no', i.item_no),
      to_jsonb(i), (select to_jsonb(x) from ops_procure.design_items x where x.id = i.id));
  end if;

  select dr.* into r from ops_procure.design_rooms dr
    join ops_procure.design_collections dc on dc.id = dr.collection_id
    join ops_procure.projects p on p.id = dc.project_id
   where p.code = btrim(coalesce(p_project_code, ''))
     and dc.code = upper(btrim(coalesce(p_collection_code, '')))
     and dr.code = upper(btrim(coalesce(p_room_code, '')));
  if not found then
    return ops_core.not_found('project','design_item', v_ref,'create', format('Tidak ada ruangan %s.', v_ref));
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from ops_procure.design_items where room_id = r.id;
  v_no := v_ref || '-' || lpad(v_seq::text, 2, '0');
  insert into ops_procure.design_items (item_no, room_id, seq, name, qty, length_mm, width_mm, height_mm,
                                        origin, note, created_by)
  values (v_no, r.id, v_seq, v_name, p_qty, p_length_mm, p_width_mm, p_height_mm,
          v_origin, nullif(btrim(p_note), ''), auth.uid());
  return ops_core.ok('project','design_item', v_no,'create', jsonb_build_object('item_no', v_no));
end $$;
revoke all on function ops_procure.save_design_item(text, text, text, text, numeric, text, numeric, numeric, numeric, text, text) from public;
grant execute on function ops_procure.save_design_item(text, text, text, text, numeric, text, numeric, numeric, numeric, text, text) to authenticated;

-- Taking an item out of the design (and putting it back). Never removed: it
-- was proposed, and that is part of the sale's record.
create or replace function ops_procure.set_design_item_dropped(
  p_item_no text, p_dropped boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items;
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', p_item_no,'drop',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('project','design_item', p_item_no,'drop', format('Tidak ada item %s.', p_item_no));
  end if;
  if (i.dropped_at is not null) = coalesce(p_dropped, false) then
    return ops_core.noop('project','design_item', i.item_no,'drop','Sudah begitu.', jsonb_build_object('item_no', i.item_no));
  end if;
  if p_dropped and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('project','design_item', i.item_no,'drop', 'reason_required',
      'Kenapa item ini dikeluarkan dari desain? Satu kalimat.', jsonb_build_object('field','reason'));
  end if;
  update ops_procure.design_items set
    dropped_at = case when p_dropped then now() end,
    dropped_by = case when p_dropped then auth.uid() end,
    drop_reason = case when p_dropped then btrim(p_reason) end,
    updated_at = now()
  where id = i.id;
  return ops_core.ok('project','design_item', i.item_no, case when p_dropped then 'drop' else 'restore' end,
    jsonb_build_object('item_no', i.item_no), null, jsonb_build_object('reason', nullif(btrim(p_reason), '')));
end $$;
revoke all on function ops_procure.set_design_item_dropped(text, boolean, text) from public;
grant execute on function ops_procure.set_design_item_dropped(text, boolean, text) to authenticated;

-- The client approved an item (or took an approval back). Recorded with who
-- said so and how; never required before a drawing is released (D378).
create or replace function ops_procure.record_design_approval(
  p_item_no text, p_decision text, p_decided_on date, p_channel text, p_client_person text,
  p_attachment_id uuid default null, p_evidence_attachment_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items; v_id uuid;
        v_decision text := lower(btrim(coalesce(p_decision, '')));
        v_channel text := lower(btrim(coalesce(p_channel, '')));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_approval', p_item_no,'record',
      'not_permitted','Mencatat persetujuan klien butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('project','design_approval', p_item_no,'record', format('Tidak ada item %s.', p_item_no));
  end if;
  if v_decision not in ('approved','withdrawn') then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'unknown_decision',
      'Disetujui (approved) atau ditarik kembali (withdrawn)?', jsonb_build_object('field','decision'));
  end if;
  if v_channel not in ('whatsapp','meeting','email','signed','other') then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'unknown_channel',
      'Lewat apa: whatsapp, meeting, email, signed (tanda tangan), atau other?', jsonb_build_object('field','channel'));
  end if;
  if p_decided_on is null or p_decided_on > ops_core.office_day() then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'bad_date',
      'Tanggal persetujuan tidak boleh kosong atau di masa depan.', jsonb_build_object('field','decided_on'));
  end if;
  if coalesce(btrim(p_client_person), '') = '' then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'client_person_required',
      'Siapa di pihak klien yang menyetujui?', jsonb_build_object('field','client_person'));
  end if;
  if p_attachment_id is not null and not exists (
       select 1 from ops_core.attachment_links l
        where l.attachment_id = p_attachment_id and l.entity = 'design_item'
          and l.entity_no = i.item_no and l.unlinked_at is null) then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'file_not_on_item',
      'File yang disetujui harus file item ini. Unggah dulu render atau gambarnya ke item.',
      jsonb_build_object('field','attachment_id'));
  end if;
  if p_evidence_attachment_id is not null
     and not exists (select 1 from ops_core.attachments a where a.id = p_evidence_attachment_id) then
    return ops_core.invalid('project','design_approval', i.item_no,'record', 'evidence_not_found',
      'Bukti persetujuan tidak ditemukan.', jsonb_build_object('field','evidence_attachment_id'));
  end if;

  insert into ops_procure.design_approvals (item_id, decision, decided_on, channel, client_person,
                                            attachment_id, evidence_attachment_id, note, recorded_by)
  values (i.id, v_decision, p_decided_on, v_channel, btrim(p_client_person),
          p_attachment_id, p_evidence_attachment_id, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return ops_core.ok('project','design_approval', i.item_no, v_decision,
    jsonb_build_object('approval_id', v_id, 'item_no', i.item_no));
end $$;
revoke all on function ops_procure.record_design_approval(text, text, date, text, text, uuid, uuid, text) from public;
grant execute on function ops_procure.record_design_approval(text, text, date, text, text, uuid, uuid, text) to authenticated;

-- ── 4. what the screens read ──────────────────────────────────────────────

create or replace view ops_procure.v_design_item as
select
  i.id, i.item_no, i.seq, i.name, i.qty, i.length_mm, i.width_mm, i.height_mm,
  i.origin, i.product_code, i.note, i.dropped_at, i.drop_reason, i.created_at, i.updated_at,
  r.code  as room_code,  r.name as room_name, r.sort as room_sort,
  c.code  as collection_code, c.name as collection_name,
  p.code  as project_code, p.name as project_name,
  cl.code as client_code, coalesce(cl.name, p.client_name) as client_display,
  coalesce(f.design_files, 0)  as design_files,
  coalesce(f.client_files, 0)  as client_files,
  coalesce(f.all_files, 0)     as all_files,
  ap.decision      as approval_decision,
  ap.decided_on    as approval_on,
  ap.channel       as approval_channel,
  ap.client_person as approval_by,
  case
    when i.dropped_at is not null       then 'DROPPED'
    when ap.decision = 'approved'       then 'APPROVED'
    when coalesce(f.drawn, 0) > 0       then 'DRAWN'
    else 'CONCEPT'
  end as status
from ops_procure.design_items i
join ops_procure.design_rooms r on r.id = i.room_id
join ops_procure.design_collections c on c.id = r.collection_id
join ops_procure.projects p on p.id = c.project_id
left join ops_procure.clients cl on cl.id = p.client_id
left join lateral (
  select count(*) filter (where l.kind in ('render','moodboard','layout','gambar_kerja','gambar_jadi'))::int as design_files,
         count(*) filter (where l.kind in ('gambar_klien','referensi_klien'))::int                         as client_files,
         count(*)::int                                                                                      as all_files,
         count(*) filter (where l.kind in ('render','layout','gambar_kerja','gambar_jadi','gambar_klien'))::int as drawn
    from ops_core.attachment_links l
   where l.entity = 'design_item' and l.entity_no = i.item_no and l.unlinked_at is null
) f on true
left join lateral (
  select a.decision, a.decided_on, a.channel, a.client_person
    from ops_procure.design_approvals a
   where a.item_id = i.id
   order by a.recorded_at desc limit 1
) ap on true;
alter view ops_procure.v_design_item set (security_invoker = on);

create or replace view ops_procure.v_design_room as
select r.id, r.code, r.name, r.sort, c.code as collection_code, p.code as project_code,
       (select count(*) from ops_procure.design_items i where i.room_id = r.id and i.dropped_at is null)::int as item_count
  from ops_procure.design_rooms r
  join ops_procure.design_collections c on c.id = r.collection_id
  join ops_procure.projects p on p.id = c.project_id;
alter view ops_procure.v_design_room set (security_invoker = on);

create or replace view ops_procure.v_design_collection as
select c.id, c.code, c.name, c.note, c.created_at, p.code as project_code, p.name as project_name,
       (select count(*) from ops_procure.design_rooms r where r.collection_id = c.id)::int as room_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status <> 'DROPPED')::int as item_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status = 'APPROVED')::int as approved_count
  from ops_procure.design_collections c
  join ops_procure.projects p on p.id = c.project_id;
alter view ops_procure.v_design_collection set (security_invoker = on);

create or replace view ops_procure.v_design_approval as
select a.id, i.item_no, a.decision, a.decided_on, a.channel, a.client_person, a.note,
       a.attachment_id::text as attachment_id, fa.filename as attachment_filename,
       a.evidence_attachment_id::text as evidence_attachment_id, fe.filename as evidence_filename,
       coalesce(u.full_name, u.email) as recorded_by_name, a.recorded_at
  from ops_procure.design_approvals a
  join ops_procure.design_items i on i.id = a.item_id
  left join ops_core.attachments fa on fa.id = a.attachment_id
  left join ops_core.attachments fe on fe.id = a.evidence_attachment_id
  left join ops_core.users u on u.id = a.recorded_by;
alter view ops_procure.v_design_approval set (security_invoker = on);

grant select on ops_procure.v_design_item, ops_procure.v_design_room,
                ops_procure.v_design_collection, ops_procure.v_design_approval to authenticated;

-- ── 5. the client's approval is a document, filed with the item ───────────

insert into ops_core.doc_kind_labels (kind, label) values ('persetujuan_klien', 'Client Approval')
on conflict (kind) do nothing;
insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('persetujuan_klien', 'drafting', 'The client''s yes to a design, filed beside the drawing it approves (D378).')
on conflict (kind) do nothing;

-- ── 6. a folder per collection, room and item (D379, D313) ────────────────

-- A design record's project, for {CLIENT} and {PROJECT}: 0217's three records,
-- plus a design item and a collection.
create or replace function ops_procure.drive_context(p_entity text, p_entity_no text)
returns table (client_folder text, project_folder text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  with p as (
    select pr.code, pr.name, pr.client_id, pr.client_name
      from ops_procure.projects pr
     where (p_entity = 'project' and pr.code = btrim(p_entity_no))
        or (p_entity = 'quotation' and pr.id = (select q.project_id from ops_procure.quotations q
                                                  where q.quote_no = btrim(p_entity_no)))
        or (p_entity = 'design_item' and pr.id = (select dc.project_id from ops_procure.design_items di
                                                     join ops_procure.design_rooms dr on dr.id = di.room_id
                                                     join ops_procure.design_collections dc on dc.id = dr.collection_id
                                                    where di.item_no = btrim(p_entity_no)))
        or (p_entity = 'design_collection' and pr.id = (select dc.project_id from ops_procure.design_collections dc
                                                           join ops_procure.projects x on x.id = dc.project_id
                                                          where x.code || '-' || dc.code = btrim(p_entity_no)))
  )
  select coalesce(ops_core.drive_segment(c.code || ' ' || c.name),
                  ops_core.drive_segment(p.client_name),
                  'TANPA KLIEN'),
         ops_core.drive_segment(p.code || ' ' || p.name)
    from p
    left join ops_procure.clients c on c.id = p.client_id
  union all
  select ops_core.drive_segment(c.code || ' ' || c.name), '00 UMUM'
    from ops_procure.clients c
   where p_entity = 'client' and c.code = btrim(p_entity_no);
$$;

-- The collection, room and item folders of a design record.
create or replace function ops_procure.drive_context_design(p_entity text, p_entity_no text)
returns table (collection_folder text, room_folder text, item_folder text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_core.drive_segment('KOLEKSI ' || dc.code || ' ' || dc.name),
         ops_core.drive_segment(dr.name),
         ops_core.drive_segment(di.item_no || ' ' || di.name)
    from ops_procure.design_items di
    join ops_procure.design_rooms dr on dr.id = di.room_id
    join ops_procure.design_collections dc on dc.id = dr.collection_id
   where p_entity = 'design_item' and di.item_no = btrim(p_entity_no)
  union all
  select ops_core.drive_segment('KOLEKSI ' || dc.code || ' ' || dc.name), null, null
    from ops_procure.design_collections dc
    join ops_procure.projects x on x.id = dc.project_id
   where p_entity = 'design_collection' and x.code || '-' || dc.code = btrim(p_entity_no);
$$;
revoke all on function ops_procure.drive_context_design(text, text) from public;
grant execute on function ops_procure.drive_context_design(text, text) to authenticated;

create or replace function ops_core.drive_path_for_record(
  p_kind ops_core.doc_kind_t, p_entity text, p_entity_no text, p_day date default null)
returns text
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_path text; v_client text; v_project text; v_coll text; v_room text; v_item text;
begin
  v_path := ops_core.drive_path_for(p_kind, p_entity, p_day);
  if v_path !~ '\{(CLIENT|PROJECT|COLLECTION|ROOM|ITEM)\}' then
    return v_path;
  end if;
  if p_entity_no is not null then
    select x.client_folder, x.project_folder into v_client, v_project
      from ops_procure.drive_context(p_entity, p_entity_no) x
     limit 1;
    if v_path ~ '\{(COLLECTION|ROOM|ITEM)\}' then
      select x.collection_folder, x.room_folder, x.item_folder into v_coll, v_room, v_item
        from ops_procure.drive_context_design(p_entity, p_entity_no) x
       limit 1;
    end if;
  end if;
  return replace(replace(replace(replace(replace(v_path,
    '{CLIENT}',     coalesce(v_client,  'TANPA KLIEN')),
    '{PROJECT}',    coalesce(v_project, 'TANPA PROYEK')),
    '{COLLECTION}', coalesce(v_coll,    'TANPA KOLEKSI')),
    '{ROOM}',       coalesce(v_room,    'TANPA RUANGAN')),
    '{ITEM}',       coalesce(v_item,    'TANPA ITEM'));
end $$;

comment on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) is
  'drive_path_for, with {CLIENT}, {PROJECT}, {COLLECTION}, {ROOM} and {ITEM} read from the record the file '
  'is filed against (TANPA … where it says nothing). (0217, 0222)';

insert into ops_core.drive_paths (kind, entity, path, note) values
  -- On an item: everything about it in its own folder.
  ('render',            'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', 'A design item''s files, in its own folder (P4, D379).'),
  ('moodboard',         'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('layout',            'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('gambar_klien',      'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('referensi_klien',   'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('gambar_kerja',      'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('gambar_jadi',       'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  ('persetujuan_klien', 'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', null),
  -- On a collection: its concept, beside the rooms.
  ('render',            'design_collection', '{CLIENT}/{PROJECT}/{COLLECTION}/00 KOLEKSI', 'A collection''s own files (P4).'),
  ('moodboard',         'design_collection', '{CLIENT}/{PROJECT}/{COLLECTION}/00 KOLEKSI', null),
  ('layout',            'design_collection', '{CLIENT}/{PROJECT}/{COLLECTION}/00 KOLEKSI', null),
  ('gambar_klien',      'design_collection', '{CLIENT}/{PROJECT}/{COLLECTION}/00 KOLEKSI', null),
  ('referensi_klien',   'design_collection', '{CLIENT}/{PROJECT}/{COLLECTION}/00 KOLEKSI', null),
  -- Anywhere else, the approval still sits with the project's design.
  ('persetujuan_klien', null,          '{CLIENT}/{PROJECT}/00 PERSETUJUAN',            null)
on conflict (kind, entity) do nothing;

analyze ops_procure.design_collections;
analyze ops_procure.design_rooms;
analyze ops_procure.design_items;
analyze ops_procure.design_approvals;
