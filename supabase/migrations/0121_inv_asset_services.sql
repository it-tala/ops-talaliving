-- 0121_inv_asset_services.sql — Master Data phase 5: an asset's service and
-- repair log.
--
-- The register (`0107`) knew an asset was *under repair* and nothing else:
-- not when the AC was last serviced, what the gearbox cost, or when the
-- pickup's next oil change is. The only history was the audit trail, which
-- records edits to the record, not work done on the thing.
--
--   one row per job     a service, a repair, an inspection — dated, described,
--                       who did it (a supplier, by public code, ADR-004), what
--                       it cost and the ledger row that paid for it
--   next_due            when the next one is due, if it recurs; `v_asset`
--                       takes it from the latest job that set one — a repair
--                       in between does not cancel it, a later routine
--                       service does — and flags it two weeks ahead
--   deleting            only for a row entered by mistake, and audited
--
-- Written through seams under `inventory.update`, like the register itself.

create table if not exists ops_inv.asset_services (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references ops_inv.assets(id),
  service_date date not null,
  kind         text not null default 'service' check (kind in ('service','repair','inspection','other')),
  description  text not null check (length(btrim(description)) > 0),
  vendor_code  text,
  cost         numeric check (cost is null or cost >= 0),
  trx_no       text,
  next_due     date,
  recorded_by  uuid references ops_core.users(id),
  recorded_at  timestamptz not null default now(),
  constraint next_after_this check (next_due is null or next_due > service_date)
);
create index if not exists asset_services_asset_idx on ops_inv.asset_services (asset_id, service_date desc);

alter table ops_inv.asset_services enable row level security;
drop policy if exists asset_services_read on ops_inv.asset_services;
create policy asset_services_read on ops_inv.asset_services for select to authenticated
  using (ops_core.has_permission('inventory.read'));
grant select on ops_inv.asset_services to authenticated;

-- The log as the drawer reads it: the asset's tag and the supplier's name.
create or replace view ops_inv.v_asset_service as
  select s.id, a.asset_no, s.service_date, s.kind, s.description, s.vendor_code,
         v.name as vendor_name, s.cost, s.trx_no, s.next_due, s.recorded_by, s.recorded_at
    from ops_inv.asset_services s
    join ops_inv.assets a on a.id = s.asset_id
    left join ops_procure.vendors v on v.code = s.vendor_code;
alter view ops_inv.v_asset_service set (security_invoker = on);
grant select on ops_inv.v_asset_service to authenticated;

-- ── the register view, with the service columns appended ─────────────────
-- Appended at the end, so `create or replace` keeps every existing column.
create or replace view ops_inv.v_asset as
  select a.*,
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
         coalesce(sv.service_count, 0)                                                   as service_count
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join ops_procure.vendors v on v.code = a.vendor_code
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
grant select on ops_inv.v_asset to authenticated;

-- ── seams ────────────────────────────────────────────────────────────────
create or replace function ops_inv.add_asset_service(
  p_asset_no text,
  p_service_date date,
  p_description text,
  p_kind text default 'service',
  p_vendor_code text default null,
  p_cost numeric default null,
  p_trx_no text default null,
  p_next_due date default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; bad jsonb; v_id uuid;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', p_asset_no,'service',
      'not_permitted','Logging a service needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = p_asset_no;
  if not found then
    return ops_core.not_found('inventory','asset', p_asset_no,'service','No such asset.');
  end if;
  if p_service_date is null then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'date_required','When was the work done?', jsonb_build_object('field','service_date'));
  end if;
  if p_service_date > current_date then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'date_in_future','A job is logged once it is done. Put a future date in "next due".',
      jsonb_build_object('field','service_date'));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'description_required','Say what was done.', jsonb_build_object('field','description'));
  end if;
  if coalesce(p_kind, 'service') not in ('service','repair','inspection','other') then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'kind_invalid','A service, a repair, an inspection or other.', jsonb_build_object('field','kind'));
  end if;
  if p_cost is not null and p_cost < 0 then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'cost_negative','A cost cannot be negative.', jsonb_build_object('field','cost'));
  end if;
  if p_next_due is not null and p_next_due <= p_service_date then
    return ops_core.invalid('inventory','asset', p_asset_no,'service',
      'next_due_invalid','The next one is due after this one.', jsonb_build_object('field','next_due'));
  end if;
  bad := ops_inv.asset_refs_invalid(p_asset_no, 'service', null, p_vendor_code, p_trx_no);
  if bad is not null then return bad; end if;

  insert into ops_inv.asset_services (asset_id, service_date, kind, description, vendor_code, cost, trx_no, next_due, recorded_by)
  values (a.id, p_service_date, coalesce(p_kind, 'service'), btrim(p_description),
          nullif(btrim(p_vendor_code), ''), p_cost, nullif(btrim(p_trx_no), ''), p_next_due, auth.uid())
  returning id into v_id;

  return ops_core.ok('inventory','asset', p_asset_no,'service',
    jsonb_build_object('id', v_id, 'asset_no', p_asset_no),
    null,
    jsonb_build_object('service_date', p_service_date, 'kind', coalesce(p_kind, 'service'),
                       'description', btrim(p_description), 'cost', p_cost,
                       'vendor_code', nullif(btrim(p_vendor_code), ''), 'next_due', p_next_due));
end $$;

create or replace function ops_inv.delete_asset_service(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare s ops_inv.asset_services; v_no text;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', null,'service_delete',
      'not_permitted','Deleting a service entry needs inventory write access.');
  end if;
  select * into s from ops_inv.asset_services where id = p_id;
  if not found then
    return ops_core.not_found('inventory','asset', null,'service_delete','No such service entry.');
  end if;
  select asset_no into v_no from ops_inv.assets where id = s.asset_id;
  delete from ops_inv.asset_services where id = p_id;
  return ops_core.say('inventory','asset', v_no,'service_delete','ok', 200, null, nullif(btrim(p_reason), ''),
    jsonb_build_object('id', p_id, 'deleted', true),
    jsonb_build_object('service_date', s.service_date, 'description', s.description, 'cost', s.cost),
    to_jsonb(s) - 'recorded_by', null);
end $$;

grant execute on function
  ops_inv.add_asset_service(text, date, text, text, text, numeric, text, date),
  ops_inv.delete_asset_service(uuid, text)
  to authenticated;
