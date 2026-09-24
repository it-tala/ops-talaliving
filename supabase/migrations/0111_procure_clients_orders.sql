-- 0111_procure_clients_orders.sql — the customer's order, as the owner runs it.
--
-- The owner's brief (2026-09-23): a BOM is written per item code, and item
-- codes come from orders — old ones and new ones. So a person has to be able
-- to open a project and say **who the client is, what they ordered (add and
-- edit lines), when it ships, and where the order stands** — cancelled,
-- quotation sent, in process and so on. And the client is master data, not a
-- sentence typed on each project (owner: *master klien perlu*).
--
-- `projects` and `project_lines` have existed since `0006`, readable and
-- writable only by table grant. What this adds:
--
--   1. `clients` — the master: a code, a name, who to call, where.
--   2. `projects.client_id` and `projects.status` — the order's state, one of
--      seven (owner confirmed the list), every change logged with who and why.
--      `is_active` stays and is kept in step, because every picker that
--      offers a project to buy for already reads it.
--   3. `project_lines.delivery_date` — a date per line, because an order that
--      ships in two lots has two dates.
--   4. Seams for every write, and `ops_prod.product_from_order_line`: the
--      button that turns an order line into an item code, ready for a BOM.
--   5. `v_project` and `v_project_line` — the list and the lines as the
--      screens read them, the second with each line's item code, its BOM
--      revision and its production cost.

-- ── 1. clients ────────────────────────────────────────────────────────────
create table ops_procure.clients (
  id            uuid primary key default gen_random_uuid(),
  -- CL-0001. Minted by the seam; what a person reads on the list.
  code          text not null unique,
  name          text not null check (length(btrim(name)) > 0),
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  npwp          text,
  note          text,
  archived_at   timestamptz,
  archived_by   uuid references ops_core.users(id),
  created_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint client_archived_together check ((archived_at is null) = (archived_by is null))
);

-- One live client per name, case aside. Two rows for one hotel group is how a
-- client's order history ends up split across two names.
create unique index clients_name_once_idx on ops_procure.clients (lower(btrim(name)))
  where archived_at is null;

-- ── 2. where an order stands ──────────────────────────────────────────────
create type ops_procure.project_status_t as enum
  ('INQUIRY','QUOTATION_SENT','DEAL','IN_PRODUCTION','SHIPPED','DONE','CANCELLED');

alter table ops_procure.projects
  add column if not exists client_id uuid references ops_procure.clients(id),
  add column if not exists status ops_procure.project_status_t not null default 'INQUIRY',
  add column if not exists status_changed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- The projects already here are running orders or closed ones. Which of the
-- seven each one is, nobody has said; this is the nearest honest reading of
-- the flag they carry, and the screen lets somebody move them.
update ops_procure.projects
   set status = case when is_active then 'IN_PRODUCTION'::ops_procure.project_status_t
                     else 'DONE'::ops_procure.project_status_t end;

-- Any client already typed on a project becomes a client, once.
insert into ops_procure.clients (code, name)
select 'CL-' || lpad(row_number() over (order by min(btrim(p.client_name)))::text, 4, '0'),
       min(btrim(p.client_name))
  from ops_procure.projects p
 where coalesce(btrim(p.client_name), '') <> ''
 group by lower(btrim(p.client_name));

update ops_procure.projects p
   set client_id = c.id
  from ops_procure.clients c
 where lower(btrim(p.client_name)) = lower(c.name) and p.client_id is null;

create table ops_procure.project_status_log (
  id           bigserial primary key,
  project_id   uuid not null references ops_procure.projects(id),
  from_status  ops_procure.project_status_t,
  to_status    ops_procure.project_status_t not null,
  reason       text,
  changed_by   uuid references ops_core.users(id),
  changed_at   timestamptz not null default now(),
  -- A cancelled order is a question somebody will ask about. The answer is
  -- written when it happens, not reconstructed.
  constraint cancel_says_why check (
    to_status <> 'CANCELLED' or (reason is not null and length(btrim(reason)) > 0))
);
create index project_status_log_idx on ops_procure.project_status_log (project_id, changed_at desc);

-- ── 3. a date per line ────────────────────────────────────────────────────
alter table ops_procure.project_lines
  add column if not exists delivery_date date,
  add column if not exists updated_at timestamptz not null default now();

-- ── 4. access ─────────────────────────────────────────────────────────────
alter table ops_procure.clients            enable row level security;
alter table ops_procure.project_status_log enable row level security;

-- A client's phone and address are read by whoever works the order: the
-- project people, procurement buying for it, production making it.
create policy clients_read on ops_procure.clients for select to authenticated
  using (ops_core.has_permission('project.read')
         or ops_core.has_permission('procurement.read')
         or ops_core.has_permission('production.read'));
create policy pstatus_read on ops_procure.project_status_log for select to authenticated using (true);

grant select on ops_procure.clients, ops_procure.project_status_log to authenticated;

-- ── 5. the seams ──────────────────────────────────────────────────────────

create or replace function ops_procure.save_client(
  p_code text, p_name text,
  p_contact_name text default null, p_phone text default null, p_email text default null,
  p_address text default null, p_npwp text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.clients; v_name text := btrim(coalesce(p_name, '')); v_code text; n int;
begin
  if v_name = '' then
    return ops_core.invalid('project','client', p_code,'save',
      'name_required','Nama kliennya siapa?', jsonb_build_object('field','name'));
  end if;

  if p_code is null or btrim(p_code) = '' then
    if not ops_core.has_permission('project.create') then
      return ops_core.refused('project','client', null,'create',
        'not_permitted','Menambah klien butuh akses proyek (create).');
    end if;
    select * into c from ops_procure.clients
     where lower(btrim(name)) = lower(v_name) and archived_at is null;
    if found then
      return ops_core.conflict('project','client', c.code,'create',
        'client_exists', format('%s sudah ada sebagai %s.', c.name, c.code),
        jsonb_build_object('code', c.code));
    end if;
    select count(*) + 1 into n from ops_procure.clients;
    v_code := 'CL-' || lpad(n::text, 4, '0');
    while exists (select 1 from ops_procure.clients x where x.code = v_code) loop
      n := n + 1; v_code := 'CL-' || lpad(n::text, 4, '0');
    end loop;
    insert into ops_procure.clients (code, name, contact_name, phone, email, address, npwp, note, created_by)
    values (v_code, v_name, nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''),
            nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), nullif(btrim(p_npwp), ''),
            nullif(btrim(p_note), ''), auth.uid());
    return ops_core.ok('project','client', v_code,'create', jsonb_build_object('code', v_code));
  end if;

  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','client', p_code,'update',
      'not_permitted','Mengubah klien butuh akses proyek (update).');
  end if;
  select * into c from ops_procure.clients where code = p_code;
  if not found then
    return ops_core.not_found('project','client', p_code,'update', format('Tidak ada klien %s.', p_code));
  end if;
  if exists (select 1 from ops_procure.clients x
              where lower(btrim(x.name)) = lower(v_name) and x.archived_at is null and x.id <> c.id) then
    return ops_core.conflict('project','client', p_code,'update',
      'client_exists', format('Sudah ada klien lain bernama %s.', v_name));
  end if;
  update ops_procure.clients set
    name = v_name,
    contact_name = nullif(btrim(p_contact_name), ''), phone = nullif(btrim(p_phone), ''),
    email = nullif(btrim(p_email), ''), address = nullif(btrim(p_address), ''),
    npwp = nullif(btrim(p_npwp), ''), note = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = c.id;
  -- The name typed on each project follows, so every screen that still reads
  -- `projects.client_name` reads the new one.
  update ops_procure.projects set client_name = v_name where client_id = c.id;
  return ops_core.ok('project','client', p_code,'update', jsonb_build_object('code', p_code),
    to_jsonb(c), (select to_jsonb(x) from ops_procure.clients x where x.id = c.id));
end $$;

create or replace function ops_procure.archive_client(p_code text, p_archived boolean default true)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.clients;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','client', p_code,'archive',
      'not_permitted','Mengarsipkan klien butuh akses proyek (update).');
  end if;
  select * into c from ops_procure.clients where code = p_code;
  if not found then
    return ops_core.not_found('project','client', p_code,'archive', format('Tidak ada klien %s.', p_code));
  end if;
  if (c.archived_at is not null) = p_archived then
    return ops_core.noop('project','client', p_code,'archive','Sudah begitu.', jsonb_build_object('code', p_code));
  end if;
  update ops_procure.clients
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then auth.uid() end
   where id = c.id;
  return ops_core.ok('project','client', p_code, case when p_archived then 'archive' else 'restore' end,
    jsonb_build_object('code', p_code));
end $$;

-- A project: created with a code (typed, or the next one after the highest
-- numeric code), or corrected. The code never moves afterwards — it is on
-- purchase requests, work orders and ledger rows (D149).
create or replace function ops_procure.save_project(
  p_code text, p_name text, p_client_code text default null,
  p_location text default null, p_pic text default null,
  p_started_on date default null, p_target_date date default null,
  p_contract_value numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; c ops_procure.clients; v_code text := btrim(coalesce(p_code, ''));
        v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then
    return ops_core.invalid('project','project', v_code,'save',
      'name_required','Proyeknya dikenal dengan nama apa?', jsonb_build_object('field','name'));
  end if;
  if p_target_date is not null and p_started_on is not null and p_target_date < p_started_on then
    return ops_core.invalid('project','project', v_code,'save',
      'dates_reversed','Tanggal kirim lebih awal dari tanggal mulai.', jsonb_build_object('field','target_date'));
  end if;
  if p_contract_value is not null and p_contract_value < 0 then
    return ops_core.invalid('project','project', v_code,'save',
      'negative_value','Nilai kontrak tidak bisa negatif.', jsonb_build_object('field','contract_value'));
  end if;
  if coalesce(btrim(p_client_code), '') <> '' then
    select * into c from ops_procure.clients where code = btrim(p_client_code);
    if not found then
      return ops_core.invalid('project','project', v_code,'save',
        'client_unknown', format('Tidak ada klien %s.', p_client_code), jsonb_build_object('field','client_code'));
    end if;
  end if;

  if v_code <> '' then
    select * into pr from ops_procure.projects where code = v_code;
  end if;

  if pr.id is null then
    if not ops_core.has_permission('project.create') then
      return ops_core.refused('project','project', v_code,'create',
        'not_permitted','Membuat proyek butuh akses proyek (create).');
    end if;
    if v_code = '' then
      select coalesce(max(code::bigint), (to_char(now(), 'YY') || '000')::bigint) + 1
        into v_code from ops_procure.projects where code ~ '^[0-9]+$';
      v_code := coalesce(v_code, to_char(now(), 'YY') || '001');
    end if;
    insert into ops_procure.projects
      (code, name, client_id, client_name, location, pic, started_on, target_date,
       contract_value, note, status, status_changed_at, is_active, created_by)
    values (v_code, v_name, c.id, c.name, nullif(btrim(p_location), ''), nullif(btrim(p_pic), ''),
            p_started_on, p_target_date, p_contract_value, nullif(btrim(p_note), ''),
            'INQUIRY', now(), true, auth.uid())
    returning * into pr;
    insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
    values (pr.id, null, 'INQUIRY', 'proyek dibuat', auth.uid());
    return ops_core.ok('project','project', v_code,'create', jsonb_build_object('code', v_code));
  end if;

  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','project', v_code,'update',
      'not_permitted','Mengubah proyek butuh akses proyek (update).');
  end if;
  update ops_procure.projects set
    name = v_name,
    client_id = c.id,
    client_name = c.name,
    location = nullif(btrim(p_location), ''),
    pic = nullif(btrim(p_pic), ''),
    started_on = p_started_on,
    target_date = p_target_date,
    contract_value = p_contract_value,
    note = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = pr.id;
  return ops_core.ok('project','project', v_code,'update', jsonb_build_object('code', v_code),
    to_jsonb(pr), (select to_jsonb(x) from ops_procure.projects x where x.id = pr.id));
end $$;

-- Where the order stands. Any status can follow any other — orders do go back
-- from *deal* to *quotation* when the client changes the brief — but every
-- move is logged, and cancelling says why.
create or replace function ops_procure.set_project_status(
  p_code text, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; v_to ops_procure.project_status_t;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','project', p_code,'set_status',
      'not_permitted','Mengubah status proyek butuh akses proyek (update).');
  end if;
  select * into pr from ops_procure.projects where code = p_code;
  if not found then
    return ops_core.not_found('project','project', p_code,'set_status', format('Tidak ada proyek %s.', p_code));
  end if;
  begin
    v_to := p_status::ops_procure.project_status_t;
  exception when invalid_text_representation then
    return ops_core.invalid('project','project', p_code,'set_status',
      'unknown_status', format('"%s" bukan status proyek.', p_status), jsonb_build_object('field','status'));
  end;
  if v_to = pr.status then
    return ops_core.noop('project','project', p_code,'set_status','Statusnya sudah itu.',
      jsonb_build_object('code', p_code, 'status', v_to));
  end if;
  if v_to = 'CANCELLED' and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('project','project', p_code,'set_status',
      'reason_required','Kenapa dibatalkan? Satu kalimat — pertanyaan ini pasti datang lagi.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_procure.projects
     set status = v_to, status_changed_at = now(), updated_at = now(),
         is_active = v_to not in ('DONE','CANCELLED')
   where id = pr.id;
  insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
  values (pr.id, pr.status, v_to, nullif(btrim(p_reason), ''), auth.uid());
  return ops_core.ok('project','project', p_code,'set_status',
    jsonb_build_object('code', p_code, 'status', v_to), to_jsonb(pr.status), to_jsonb(v_to));
end $$;

create or replace function ops_procure.save_project_line(
  p_project_code text, p_line_id uuid default null,
  p_product_code text default null, p_description text default null,
  p_qty numeric default null, p_uom text default 'unit',
  p_unit_price numeric default null, p_delivery_date date default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; l ops_procure.project_lines; v_id uuid; v_no int;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','project', p_project_code,'save_line',
      'not_permitted','Mengubah pesanan butuh akses proyek (update).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'save_line',
      format('Tidak ada proyek %s.', p_project_code));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('project','project', p_project_code,'save_line',
      'description_required','Barangnya apa? Klien membaca baris ini.', jsonb_build_object('field','description'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('project','project', p_project_code,'save_line',
      'qty_required','Pesanan nol bukan pesanan.', jsonb_build_object('field','qty'));
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    return ops_core.invalid('project','project', p_project_code,'save_line',
      'negative_price','Harga tidak bisa negatif.', jsonb_build_object('field','unit_price'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_uom) then
    return ops_core.invalid('project','project', p_project_code,'save_line',
      'no_such_uom', format('Tidak ada satuan %s.', p_uom), jsonb_build_object('field','uom'));
  end if;

  if p_line_id is not null then
    select * into l from ops_procure.project_lines where id = p_line_id and project_id = pr.id;
    if not found then
      return ops_core.not_found('project','project', p_project_code,'save_line','Baris itu tidak ada.');
    end if;
    update ops_procure.project_lines set
      product_code = nullif(upper(btrim(p_product_code)), ''),
      description = btrim(p_description), qty = p_qty, uom = p_uom,
      unit_price = p_unit_price, delivery_date = p_delivery_date,
      note = nullif(btrim(p_note), ''), updated_at = now()
    where id = l.id returning id into v_id;
  else
    select coalesce(max(line_no), 0) + 1 into v_no from ops_procure.project_lines where project_id = pr.id;
    insert into ops_procure.project_lines
      (project_id, line_no, product_code, description, qty, uom, unit_price, delivery_date, note)
    values (pr.id, v_no, nullif(upper(btrim(p_product_code)), ''), btrim(p_description), p_qty, p_uom,
            p_unit_price, p_delivery_date, nullif(btrim(p_note), ''))
    returning id into v_id;
  end if;
  return ops_core.ok('project','project', p_project_code,
    case when p_line_id is null then 'add_line' else 'update_line' end,
    jsonb_build_object('line_id', v_id),
    case when l.id is null then null else to_jsonb(l) end,
    (select to_jsonb(x) from ops_procure.project_lines x where x.id = v_id));
end $$;

create or replace function ops_procure.remove_project_line(p_project_code text, p_line_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; l ops_procure.project_lines;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','project', p_project_code,'remove_line',
      'not_permitted','Mengubah pesanan butuh akses proyek (update).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'remove_line',
      format('Tidak ada proyek %s.', p_project_code));
  end if;
  select * into l from ops_procure.project_lines where id = p_line_id and project_id = pr.id;
  if not found then
    return ops_core.not_found('project','project', p_project_code,'remove_line','Baris itu tidak ada.');
  end if;
  delete from ops_procure.project_lines where id = l.id;
  return ops_core.ok('project','project', p_project_code,'remove_line',
    jsonb_build_object('line_id', l.id), to_jsonb(l), null);
end $$;

grant execute on function
  ops_procure.save_client(text, text, text, text, text, text, text, text),
  ops_procure.archive_client(text, boolean),
  ops_procure.save_project(text, text, text, text, text, date, date, numeric, text),
  ops_procure.set_project_status(text, text, text),
  ops_procure.save_project_line(text, uuid, text, text, numeric, text, numeric, date, text),
  ops_procure.remove_project_line(text, uuid)
  to authenticated;

-- An order line becomes an item code. The product is production's, so this
-- lives in production's schema and asks for production's permission; it
-- writes one column back onto the order line — the link — and nothing else.
-- A code that already exists is linked rather than duplicated: the same
-- lounge chair ordered by two hotels is one item code with one BOM.
create or replace function ops_prod.product_from_order_line(
  p_project_code text, p_line_id uuid, p_product_code text,
  p_name text default null, p_category text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_procure, ops_core, pg_temp as $$
declare l ops_procure.project_lines; pr ops_procure.projects;
        v_code text := upper(btrim(coalesce(p_product_code, ''))); v_existing ops_prod.products;
begin
  if not ops_core.has_permission('production.create') then
    return ops_core.refused('production','product', v_code,'from_order_line',
      'not_permitted','Membuat item code butuh akses produksi (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  select * into l from ops_procure.project_lines where id = p_line_id and project_id = pr.id;
  if l.id is null then
    return ops_core.not_found('production','product', v_code,'from_order_line','Baris pesanan itu tidak ada.');
  end if;
  if v_code = '' then
    return ops_core.invalid('production','product', null,'from_order_line',
      'code_required','Item code-nya apa? Kode ini dipakai di gambar, BOM dan SPK.',
      jsonb_build_object('field','product_code'));
  end if;

  select * into v_existing from ops_prod.products where product_code = v_code;
  if v_existing.id is null then
    insert into ops_prod.products (product_code, name, category, uom, created_by)
    values (v_code, coalesce(nullif(btrim(p_name), ''), l.description),
            coalesce(nullif(btrim(p_category), ''), 'Belum dikategorikan'), l.uom, auth.uid());
  end if;
  update ops_procure.project_lines set product_code = v_code, updated_at = now() where id = l.id;

  return ops_core.ok('production','product', v_code,'from_order_line',
    jsonb_build_object('product_code', v_code, 'existing', v_existing.id is not null,
                       'project_code', p_project_code, 'line_id', l.id));
end $$;
grant execute on function ops_prod.product_from_order_line(text, uuid, text, text, text) to authenticated;

-- ── 6. what the screens read ──────────────────────────────────────────────
create or replace view ops_procure.v_project as
select
  p.*,
  c.code                                                    as client_code,
  coalesce(c.name, p.client_name)                           as client_display,
  c.contact_name                                            as client_contact,
  c.phone                                                   as client_phone,
  coalesce(ls.lines, 0)                                     as line_count,
  coalesce(ls.unlinked, 0)                                  as lines_without_item_code,
  ls.order_value,
  coalesce(ls.unpriced, 0)                                  as unpriced_lines,
  ls.next_delivery
from ops_procure.projects p
left join ops_procure.clients c on c.id = p.client_id
left join lateral (
  select count(*)::int                                           as lines,
         count(*) filter (where l.product_code is null)::int     as unlinked,
         case when count(*) filter (where l.unit_price is not null) = 0 then null
              else sum(l.qty * l.unit_price) filter (where l.unit_price is not null) end as order_value,
         count(*) filter (where l.unit_price is null)::int       as unpriced,
         min(l.delivery_date)                                    as next_delivery
    from ops_procure.project_lines l where l.project_id = p.id
) ls on true;

create or replace view ops_procure.v_project_line as
select
  l.*,
  p.code                          as project_code,
  s.name                          as product_name,
  s.current_rev                   as product_current_rev,
  s.draft_rev                     as product_draft_rev,
  s.production_cost               as product_production_cost,
  (s.id is not null)              as product_exists
from ops_procure.project_lines l
join ops_procure.projects p on p.id = l.project_id
left join ops_prod.v_product_summary s on s.product_code = l.product_code;

alter view ops_procure.v_project      set (security_invoker = on);
alter view ops_procure.v_project_line set (security_invoker = on);
grant select on ops_procure.v_project, ops_procure.v_project_line to authenticated;
