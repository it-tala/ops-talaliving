-- 0107_inv_assets.sql — Master Data phase 4: the non-production asset register.
--
-- What the company owns and uses rather than sells or builds from: CCTV,
-- office PCs and laptops, vehicles, printers, network gear, tools (owner,
-- 2026-09-23). None of it is stock — it is never issued to a work order and
-- never counted in the rack's value — so it gets its own register beside the
-- stock tables, under the inventory module's permissions.
--
-- Each asset has a tag (`AST-0001`) meant for a sticker on the thing itself,
-- a category, where it is and who holds it, and a status. What it cost and
-- where it came from are optional and, when given, point by public code at
-- the supplier and the ledger row that paid for it (ADR-004) — validated here,
-- never a foreign key across the service seam.
--
-- Photos, the purchase nota and the warranty card are attached like every
-- other document (`0106` made an asset linkable). Every write goes through
-- `ops_core.say`, so the asset's history is its audit trail.

-- ── 1. categories ────────────────────────────────────────────────────────
create table if not exists ops_inv.asset_categories (
  code        text primary key,
  name        text not null,
  description text,
  is_active   boolean not null default true
);

insert into ops_inv.asset_categories (code, name, description) values
  ('cctv',      'CCTV & security', 'Cameras, DVR/NVR, alarms'),
  ('computer',  'Computers',       'Desktop PCs, laptops, monitors'),
  ('printer',   'Printers & scanners', null),
  ('network',   'Network',         'Routers, switches, access points'),
  ('phone',     'Phones & tablets', null),
  ('vehicle',   'Vehicles',        'Cars, trucks, motorbikes — the plate number goes in the identifier'),
  ('tool',      'Tools & equipment', 'Power tools and equipment that are not stock'),
  ('furniture', 'Office furniture', null),
  ('other',     'Other',           null)
on conflict (code) do nothing;

-- ── 2. the register ──────────────────────────────────────────────────────
do $$ begin
  create type ops_inv.asset_status_t as enum ('in_use','in_storage','under_repair','disposed','lost');
exception when duplicate_object then null; end $$;

create sequence if not exists ops_inv.asset_no_seq;

create table if not exists ops_inv.assets (
  id              uuid primary key default gen_random_uuid(),
  -- The sticker on the thing. Sequential and short, because somebody reads it
  -- off a camera mounted on a wall.
  asset_no        text not null unique
                  default 'AST-' || lpad(nextval('ops_inv.asset_no_seq')::text, 4, '0'),
  name            text not null check (length(btrim(name)) > 0),
  category_code   text not null references ops_inv.asset_categories(code),
  brand           text,
  model           text,
  -- Serial number, IMEI, or a vehicle's plate — whatever tells this one apart.
  identifier      text,
  location        text,
  -- Who has it. A name as people say it, not a login: the driver of the pickup
  -- or the person at that desk may not have an account.
  holder          text,
  status          ops_inv.asset_status_t not null default 'in_use',
  acquired_on     date,
  purchase_cost   numeric check (purchase_cost is null or purchase_cost >= 0),
  -- By public code (ADR-004), validated at the seam.
  vendor_code     text,
  trx_no          text,
  warranty_until  date,
  notes           text,
  -- Set when it leaves: disposed of, or lost.
  ended_on        date,
  created_by      uuid references ops_core.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ended_when_gone check (
    (status in ('disposed','lost')) = (ended_on is not null))
);

create index if not exists assets_category_idx on ops_inv.assets (category_code);
create index if not exists assets_status_idx   on ops_inv.assets (status);

alter table ops_inv.asset_categories enable row level security;
alter table ops_inv.assets           enable row level security;
drop policy if exists asset_cat_read on ops_inv.asset_categories;
create policy asset_cat_read on ops_inv.asset_categories for select to authenticated using (true);
drop policy if exists assets_read on ops_inv.assets;
create policy assets_read on ops_inv.assets for select to authenticated
  using (ops_core.has_permission('inventory.read'));
grant select on ops_inv.asset_categories, ops_inv.assets to authenticated;

-- ── 3. the view the screen reads ─────────────────────────────────────────
create or replace view ops_inv.v_asset as
  select a.*,
         c.name as category_name,
         v.name as vendor_name,
         (select count(*) from ops_core.attachment_links l
           where l.entity = 'asset' and l.entity_no = a.asset_no and l.unlinked_at is null) as document_count,
         (a.warranty_until is not null and a.warranty_until < current_date
          and a.status not in ('disposed','lost'))                                       as warranty_expired
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join ops_procure.vendors v on v.code = a.vendor_code;

alter view ops_inv.v_asset set (security_invoker = on);
grant select on ops_inv.v_asset to authenticated;

-- ── 4. validation shared by create and update ────────────────────────────
-- Answers null when the references are fine, or the refusal to return.
create or replace function ops_inv.asset_refs_invalid(
  p_asset_no text, p_action text, p_category text, p_vendor text, p_trx text)
returns jsonb
language plpgsql stable security definer set search_path = ops_inv, ops_core, pg_temp as $$
begin
  if p_category is not null
     and not exists (select 1 from ops_inv.asset_categories where code = p_category) then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'category_unknown', format('No asset category %s.', p_category), jsonb_build_object('field','category_code'));
  end if;
  if nullif(btrim(p_vendor), '') is not null
     and not exists (select 1 from ops_procure.vendors where code = btrim(p_vendor)) then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'vendor_unknown', format('No supplier %s.', p_vendor), jsonb_build_object('field','vendor_code'));
  end if;
  if nullif(btrim(p_trx), '') is not null
     and not exists (select 1 from ops_acct.transactions where trx_no = btrim(p_trx)) then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'trx_unknown', format('No ledger row %s.', p_trx), jsonb_build_object('field','trx_no'));
  end if;
  return null;
end $$;

-- ── 5. the seams ─────────────────────────────────────────────────────────
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
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare replayed jsonb; bad jsonb; v_no text; res jsonb;
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
  if p_status in ('disposed','lost') then
    return ops_core.invalid('inventory','asset', null,'create',
      'status_invalid','A new asset is in use, in storage or under repair.', jsonb_build_object('field','status'));
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    return ops_core.invalid('inventory','asset', null,'create',
      'cost_negative','A purchase cost cannot be negative.', jsonb_build_object('field','purchase_cost'));
  end if;
  bad := ops_inv.asset_refs_invalid(null, 'create', p_category_code, p_vendor_code, p_trx_no);
  if bad is not null then return bad; end if;

  insert into ops_inv.assets (name, category_code, brand, model, identifier, location, holder, status,
                              acquired_on, purchase_cost, vendor_code, trx_no, warranty_until, notes, created_by)
  values (btrim(p_name), p_category_code, nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''),
          nullif(btrim(p_identifier), ''), nullif(btrim(p_location), ''), nullif(btrim(p_holder), ''),
          coalesce(p_status, 'in_use'), p_acquired_on, p_purchase_cost,
          nullif(btrim(p_vendor_code), ''), nullif(btrim(p_trx_no), ''), p_warranty_until,
          nullif(btrim(p_notes), ''), auth.uid())
  returning asset_no into v_no;

  res := ops_core.ok('inventory','asset', v_no,'create',
    jsonb_build_object('asset_no', v_no), null,
    jsonb_build_object('name', btrim(p_name), 'category_code', p_category_code,
                       'location', nullif(btrim(p_location), ''), 'holder', nullif(btrim(p_holder), '')));
  return ops_core.idem_remember('inventory','create_asset', p_key, res);
end $$;

-- Every field may be left null to keep it; an empty string clears a text
-- field, and `p_clear` names the date and number fields to clear.
create or replace function ops_inv.update_asset(
  p_asset_no text,
  p_name text default null,
  p_category_code text default null,
  p_brand text default null,
  p_model text default null,
  p_identifier text default null,
  p_location text default null,
  p_holder text default null,
  p_acquired_on date default null,
  p_purchase_cost numeric default null,
  p_vendor_code text default null,
  p_trx_no text default null,
  p_warranty_until date default null,
  p_notes text default null,
  p_clear text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; bad jsonb; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', p_asset_no,'update',
      'not_permitted','Editing an asset needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = p_asset_no;
  if not found then
    return ops_core.not_found('inventory','asset', p_asset_no,'update','No such asset.');
  end if;
  if p_name is not null and btrim(p_name) = '' then
    return ops_core.invalid('inventory','asset', p_asset_no,'update',
      'name_required','An asset needs a name.', jsonb_build_object('field','name'));
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    return ops_core.invalid('inventory','asset', p_asset_no,'update',
      'cost_negative','A purchase cost cannot be negative.', jsonb_build_object('field','purchase_cost'));
  end if;
  bad := ops_inv.asset_refs_invalid(p_asset_no, 'update', p_category_code, p_vendor_code, p_trx_no);
  if bad is not null then return bad; end if;

  v_before := to_jsonb(a) - 'id' - 'created_by' - 'created_at' - 'updated_at';

  update ops_inv.assets set
    name           = coalesce(btrim(p_name), name),
    category_code  = coalesce(p_category_code, category_code),
    brand          = case when p_brand      is null then brand      else nullif(btrim(p_brand), '') end,
    model          = case when p_model      is null then model      else nullif(btrim(p_model), '') end,
    identifier     = case when p_identifier is null then identifier else nullif(btrim(p_identifier), '') end,
    location       = case when p_location   is null then location   else nullif(btrim(p_location), '') end,
    holder         = case when p_holder     is null then holder     else nullif(btrim(p_holder), '') end,
    vendor_code    = case when p_vendor_code is null then vendor_code else nullif(btrim(p_vendor_code), '') end,
    trx_no         = case when p_trx_no     is null then trx_no     else nullif(btrim(p_trx_no), '') end,
    notes          = case when p_notes      is null then notes      else nullif(btrim(p_notes), '') end,
    acquired_on    = case when 'acquired_on'    = any(p_clear) then null else coalesce(p_acquired_on, acquired_on) end,
    purchase_cost  = case when 'purchase_cost'  = any(p_clear) then null else coalesce(p_purchase_cost, purchase_cost) end,
    warranty_until = case when 'warranty_until' = any(p_clear) then null else coalesce(p_warranty_until, warranty_until) end,
    updated_at     = now()
  where id = a.id;

  select to_jsonb(x) - 'id' - 'created_by' - 'created_at' - 'updated_at' into v_after
    from ops_inv.assets x where x.id = a.id;

  if v_after = v_before then
    update ops_inv.assets set updated_at = a.updated_at where id = a.id;
    return ops_core.noop('inventory','asset', p_asset_no,'update','Nothing changed.',
      jsonb_build_object('asset_no', p_asset_no));
  end if;

  -- Only what moved goes into the trail, so the history reads as a list of
  -- changes rather than two copies of the whole record.
  return ops_core.say('inventory','asset', p_asset_no,'update','ok', 200, null, null,
    jsonb_build_object('asset_no', p_asset_no),
    (select jsonb_object_agg(k, jsonb_build_object('from', v_before -> k, 'to', v_after -> k))
       from jsonb_object_keys(v_after) k where v_before -> k is distinct from v_after -> k),
    v_before, v_after);
end $$;

-- In use, in storage, under repair — or gone. Going (disposed, lost) needs a
-- note, and dates the asset's end; coming back clears it.
create or replace function ops_inv.set_asset_status(
  p_asset_no text, p_status ops_inv.asset_status_t, p_note text default null, p_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; v_note text := nullif(btrim(p_note), '');
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', p_asset_no,'status',
      'not_permitted','Changing an asset''s status needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = p_asset_no;
  if not found then
    return ops_core.not_found('inventory','asset', p_asset_no,'status','No such asset.');
  end if;
  if a.status = p_status then
    return ops_core.noop('inventory','asset', p_asset_no,'status','Already in that status.',
      jsonb_build_object('asset_no', p_asset_no, 'status', p_status));
  end if;
  if p_status in ('disposed','lost') and v_note is null then
    return ops_core.invalid('inventory','asset', p_asset_no,'status',
      'note_required','Say how it left — sold, scrapped, stolen, where it was last seen.',
      jsonb_build_object('field','note'));
  end if;

  update ops_inv.assets set
    status     = p_status,
    ended_on   = case when p_status in ('disposed','lost') then coalesce(p_on, current_date) end,
    updated_at = now()
  where id = a.id;

  return ops_core.say('inventory','asset', p_asset_no,'status','ok', 200, null, v_note,
    jsonb_build_object('asset_no', p_asset_no, 'status', p_status),
    jsonb_build_object('status_before', a.status, 'status_after', p_status),
    jsonb_build_object('status', a.status), jsonb_build_object('status', p_status));
end $$;

-- For a record entered by mistake. Anything with documents on it is a real
-- asset with a history, and is disposed of rather than erased.
create or replace function ops_inv.delete_asset(p_asset_no text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; n_docs int;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', p_asset_no,'delete',
      'not_permitted','Deleting an asset needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = p_asset_no;
  if not found then
    return ops_core.not_found('inventory','asset', p_asset_no,'delete','No such asset.');
  end if;
  select count(*) into n_docs from ops_core.attachment_links
   where entity = 'asset' and entity_no = a.asset_no and unlinked_at is null;
  if n_docs > 0 then
    return ops_core.conflict('inventory','asset', p_asset_no,'delete',
      'asset_has_documents',
      format('%s has %s document(s) attached. Mark it disposed instead, so the record stays.', a.asset_no, n_docs),
      jsonb_build_object('documents', n_docs));
  end if;

  delete from ops_inv.assets where id = a.id;
  return ops_core.ok('inventory','asset', p_asset_no,'delete',
    jsonb_build_object('asset_no', p_asset_no, 'deleted', true),
    to_jsonb(a) - 'id' - 'created_by' - 'created_at' - 'updated_at', null);
end $$;

-- ── 6. categories ────────────────────────────────────────────────────────
create or replace function ops_inv.save_asset_category(
  p_code text, p_name text, p_description text default null, p_is_active boolean default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare c ops_inv.asset_categories; v_code text := lower(btrim(coalesce(p_code, '')));
        v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset_category', v_code,'save',
      'not_permitted','Editing asset categories needs inventory write access.');
  end if;
  if v_code !~ '^[a-z0-9][a-z0-9_-]{1,29}$' then
    return ops_core.invalid('inventory','asset_category', v_code,'save',
      'code_invalid','A category code is 2–30 lower-case letters, digits, "-" or "_", e.g. "cctv".',
      jsonb_build_object('field','code'));
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('inventory','asset_category', v_code,'save',
      'name_required','A category needs a name.', jsonb_build_object('field','name'));
  end if;

  select * into c from ops_inv.asset_categories where code = v_code;
  if not found then
    insert into ops_inv.asset_categories (code, name, description, is_active)
    values (v_code, btrim(p_name), nullif(btrim(p_description), ''), coalesce(p_is_active, true));
    return ops_core.ok('inventory','asset_category', v_code,'create',
      jsonb_build_object('code', v_code), null,
      jsonb_build_object('name', btrim(p_name), 'description', nullif(btrim(p_description), '')));
  end if;

  v_before := jsonb_build_object('name', c.name, 'description', c.description, 'is_active', c.is_active);
  update ops_inv.asset_categories set
    name        = btrim(p_name),
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    is_active   = coalesce(p_is_active, is_active)
  where code = v_code;
  select jsonb_build_object('name', name, 'description', description, 'is_active', is_active)
    into v_after from ops_inv.asset_categories where code = v_code;
  if v_after = v_before then
    return ops_core.noop('inventory','asset_category', v_code,'update','Nothing changed.',
      jsonb_build_object('code', v_code));
  end if;
  return ops_core.ok('inventory','asset_category', v_code,'update',
    jsonb_build_object('code', v_code), v_before, v_after);
end $$;

create or replace function ops_inv.delete_asset_category(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare c ops_inv.asset_categories; n int;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset_category', p_code,'delete',
      'not_permitted','Editing asset categories needs inventory write access.');
  end if;
  select * into c from ops_inv.asset_categories where code = p_code;
  if not found then
    return ops_core.not_found('inventory','asset_category', p_code,'delete','No such category.');
  end if;
  select count(*) into n from ops_inv.assets where category_code = c.code;
  if n > 0 then
    return ops_core.conflict('inventory','asset_category', p_code,'delete',
      'category_in_use', format('%s still has %s asset(s). Move them or retire the category.', c.name, n),
      jsonb_build_object('assets', n));
  end if;
  delete from ops_inv.asset_categories where code = c.code;
  return ops_core.ok('inventory','asset_category', p_code,'delete',
    jsonb_build_object('code', p_code, 'deleted', true),
    jsonb_build_object('name', c.name), null);
end $$;

revoke execute on function ops_inv.asset_refs_invalid(text, text, text, text, text) from public;
grant execute on function
  ops_inv.create_asset(text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text),
  ops_inv.update_asset(text, text, text, text, text, text, text, text, date, numeric, text, text, date, text, text[]),
  ops_inv.set_asset_status(text, ops_inv.asset_status_t, text, date),
  ops_inv.delete_asset(text),
  ops_inv.save_asset_category(text, text, text, boolean),
  ops_inv.delete_asset_category(text)
  to authenticated;
