-- 0116_inv_asset_rental.sql — assets the company rents, leases or borrows,
-- and the rent that goes onto the payment calendar.
--
-- The owner's question (2026-09-23): what about things that are rented? A
-- rented generator or a leased car is used exactly like an owned one — it has
-- a tag, a place and somebody holding it — but it has a contract with an end
-- date, a rent that falls due, and it ends by going back rather than being
-- sold or scrapped.
--
--   ownership      owned (the default) · rented · leased · borrowed
--   the lessor     the asset's supplier (`vendor_code`): for a rented thing
--                  the one it came from is the one it goes back to
--   rent           amount per period (monthly · yearly · upfront) and the day
--                  of the month it falls due; borrowed things may have none
--   contract       start and end; `v_asset` flags a contract ending within
--                  thirty days and one that has run out while the thing is
--                  still here
--   returned       the status a non-owned asset ends in (`0115`); it dates
--                  the end like disposed and lost do
--
-- `ops_acct.schedule_asset_rent` turns the rent into payment-calendar lines,
-- once: fixed amounts, marked `source_ref = 'asset:AST-0004'` so the asset
-- can say its rent is on the calendar and a second press is refused. It is an
-- accounting write (the calendar belongs to accounting) and goes through
-- `save_cash_component`, so each line is validated and audited like one typed
-- by hand.

-- ── 1. columns ───────────────────────────────────────────────────────────
alter table ops_inv.assets
  add column if not exists ownership      text not null default 'owned',
  add column if not exists rent_amount    numeric,
  add column if not exists rent_period    text,
  add column if not exists rent_due_day   int,
  add column if not exists contract_start date,
  add column if not exists contract_end   date;

alter table ops_inv.assets drop constraint if exists ownership_known;
alter table ops_inv.assets add constraint ownership_known
  check (ownership in ('owned','rented','leased','borrowed'));
alter table ops_inv.assets drop constraint if exists rent_period_known;
alter table ops_inv.assets add constraint rent_period_known
  check (rent_period is null or rent_period in ('monthly','yearly','upfront'));
alter table ops_inv.assets drop constraint if exists rent_sane;
alter table ops_inv.assets add constraint rent_sane check (
  (rent_amount is null or rent_amount >= 0)
  and (rent_due_day is null or rent_due_day between 1 and 31)
  and (contract_end is null or contract_start is null or contract_end >= contract_start)
  and (ownership <> 'owned' or (rent_amount is null and rent_period is null
                                and contract_start is null and contract_end is null)));

alter table ops_inv.assets drop constraint if exists ended_when_gone;
alter table ops_inv.assets add constraint ended_when_gone check (
  (status in ('disposed','lost','returned')) = (ended_on is not null));

-- ── 2. how many calendar lines an asset's rent has ───────────────────────
-- The register is read under inventory permissions and the calendar under
-- accounting's; this answers only *how many*, so the asset screen can say
-- "on the calendar" without its reader needing the calendar itself.
create or replace function ops_acct.rent_line_count(p_ref text)
returns int
language sql stable security definer set search_path = ops_acct, pg_temp as $$
  select count(*)::int from ops_acct.cash_components where source_ref = p_ref and active;
$$;
grant execute on function ops_acct.rent_line_count(text) to authenticated;

-- ── 3. the view ──────────────────────────────────────────────────────────
-- Dropped rather than replaced: `a.*` gains columns ahead of the computed
-- ones, which `create or replace view` refuses.
drop view if exists ops_inv.v_asset;
create view ops_inv.v_asset as
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
         ops_acct.rent_line_count('asset:' || a.asset_no)                                as rent_lines
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join ops_procure.vendors v on v.code = a.vendor_code;

alter view ops_inv.v_asset set (security_invoker = on);
grant select on ops_inv.v_asset to authenticated;

-- ── 4. the rent rules, shared by create and update ───────────────────────
-- Checked against the row as it will be, so an update is judged on the
-- result and not on the fields it happened to send.
create or replace function ops_inv.asset_rent_invalid(
  p_asset_no text, p_action text, p_ownership text, p_rent_amount numeric,
  p_rent_period text, p_rent_due_day int, p_contract_start date, p_contract_end date)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
begin
  if p_ownership not in ('owned','rented','leased','borrowed') then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'ownership_invalid','Owned, rented, leased or borrowed.', jsonb_build_object('field','ownership'));
  end if;
  if p_ownership = 'owned' and (p_rent_amount is not null or p_rent_period is not null
                                or p_contract_start is not null or p_contract_end is not null) then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'rent_on_owned','An owned asset has no rent or contract. Clear them, or change who owns it.',
      jsonb_build_object('field','ownership'));
  end if;
  if p_rent_amount is not null and p_rent_amount < 0 then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'rent_negative','Rent cannot be negative.', jsonb_build_object('field','rent_amount'));
  end if;
  if p_rent_period is not null and p_rent_period not in ('monthly','yearly','upfront') then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'period_invalid','Rent is paid monthly, yearly or once up front.', jsonb_build_object('field','rent_period'));
  end if;
  if coalesce(p_rent_amount, 0) > 0 and p_rent_period is null then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'period_required','Say how often the rent is paid.', jsonb_build_object('field','rent_period'));
  end if;
  if p_rent_due_day is not null and p_rent_due_day not between 1 and 31 then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'due_day_invalid','The rent falls due on a day between 1 and 31.', jsonb_build_object('field','rent_due_day'));
  end if;
  if p_contract_start is not null and p_contract_end is not null and p_contract_end < p_contract_start then
    return ops_core.invalid('inventory','asset', p_asset_no, p_action,
      'contract_dates','The contract ends before it starts.', jsonb_build_object('field','contract_end'));
  end if;
  return null;
end $$;
revoke execute on function ops_inv.asset_rent_invalid(text, text, text, numeric, text, int, date, date) from public;

-- ── 5. create and update, with the rental fields appended ────────────────
drop function if exists ops_inv.create_asset(
  text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text);

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
  p_contract_end date default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare replayed jsonb; bad jsonb; v_no text; res jsonb; v_own text := coalesce(p_ownership, 'owned');
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
  bad := ops_inv.asset_refs_invalid(null, 'create', p_category_code, p_vendor_code, p_trx_no);
  if bad is not null then return bad; end if;
  bad := ops_inv.asset_rent_invalid(null, 'create', v_own, p_rent_amount, nullif(btrim(p_rent_period), ''),
                                    p_rent_due_day, p_contract_start, p_contract_end);
  if bad is not null then return bad; end if;

  insert into ops_inv.assets (name, category_code, brand, model, identifier, location, holder, status,
                              acquired_on, purchase_cost, vendor_code, trx_no, warranty_until, notes, created_by,
                              ownership, rent_amount, rent_period, rent_due_day, contract_start, contract_end)
  values (btrim(p_name), p_category_code, nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''),
          nullif(btrim(p_identifier), ''), nullif(btrim(p_location), ''), nullif(btrim(p_holder), ''),
          coalesce(p_status, 'in_use'), p_acquired_on, p_purchase_cost,
          nullif(btrim(p_vendor_code), ''), nullif(btrim(p_trx_no), ''), p_warranty_until,
          nullif(btrim(p_notes), ''), auth.uid(),
          v_own, p_rent_amount, nullif(btrim(p_rent_period), ''), p_rent_due_day, p_contract_start, p_contract_end)
  returning asset_no into v_no;

  res := ops_core.ok('inventory','asset', v_no,'create',
    jsonb_build_object('asset_no', v_no), null,
    jsonb_build_object('name', btrim(p_name), 'category_code', p_category_code,
                       'location', nullif(btrim(p_location), ''), 'holder', nullif(btrim(p_holder), ''),
                       'ownership', v_own));
  return ops_core.idem_remember('inventory','create_asset', p_key, res);
end $$;

drop function if exists ops_inv.update_asset(
  text, text, text, text, text, text, text, text, date, numeric, text, text, date, text, text[]);

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
  p_clear text[] default '{}',
  p_ownership text default null,
  p_rent_amount numeric default null,
  p_rent_period text default null,
  p_rent_due_day int default null,
  p_contract_start date default null,
  p_contract_end date default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; bad jsonb; v_before jsonb; v_after jsonb;
        v_own text; v_amt numeric; v_period text; v_day int; v_start date; v_end date;
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

  -- The rental fields as they will be, judged whole.
  v_own    := coalesce(nullif(btrim(p_ownership), ''), a.ownership);
  v_amt    := case when 'rent_amount'    = any(p_clear) then null else coalesce(p_rent_amount, a.rent_amount) end;
  v_period := case when 'rent_period'    = any(p_clear) then null
                   else coalesce(nullif(btrim(p_rent_period), ''), a.rent_period) end;
  v_day    := case when 'rent_due_day'   = any(p_clear) then null else coalesce(p_rent_due_day, a.rent_due_day) end;
  v_start  := case when 'contract_start' = any(p_clear) then null else coalesce(p_contract_start, a.contract_start) end;
  v_end    := case when 'contract_end'   = any(p_clear) then null else coalesce(p_contract_end, a.contract_end) end;
  bad := ops_inv.asset_rent_invalid(p_asset_no, 'update', v_own, v_amt, v_period, v_day, v_start, v_end);
  if bad is not null then return bad; end if;
  if v_own = 'owned' and a.status = 'returned' then
    return ops_core.invalid('inventory','asset', p_asset_no,'update',
      'ownership_returned','A returned asset was never ours. Change its status before calling it owned.',
      jsonb_build_object('field','ownership'));
  end if;

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
    ownership      = v_own,
    rent_amount    = v_amt,
    rent_period    = v_period,
    rent_due_day   = v_day,
    contract_start = v_start,
    contract_end   = v_end,
    updated_at     = now()
  where id = a.id;

  select to_jsonb(x) - 'id' - 'created_by' - 'created_at' - 'updated_at' into v_after
    from ops_inv.assets x where x.id = a.id;

  if v_after = v_before then
    update ops_inv.assets set updated_at = a.updated_at where id = a.id;
    return ops_core.noop('inventory','asset', p_asset_no,'update','Nothing changed.',
      jsonb_build_object('asset_no', p_asset_no));
  end if;

  return ops_core.say('inventory','asset', p_asset_no,'update','ok', 200, null, null,
    jsonb_build_object('asset_no', p_asset_no),
    (select jsonb_object_agg(k, jsonb_build_object('from', v_before -> k, 'to', v_after -> k))
       from jsonb_object_keys(v_after) k where v_before -> k is distinct from v_after -> k),
    v_before, v_after);
end $$;

-- ── 6. status: `returned` is how a thing that was not ours leaves ────────
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
  if p_status = 'returned' and a.ownership = 'owned' then
    return ops_core.invalid('inventory','asset', p_asset_no,'status',
      'status_invalid','Only a rented, leased or borrowed asset is returned. An owned one is disposed of.',
      jsonb_build_object('field','status'));
  end if;
  if p_status in ('disposed','lost') and v_note is null then
    return ops_core.invalid('inventory','asset', p_asset_no,'status',
      'note_required','Say how it left — sold, scrapped, stolen, where it was last seen.',
      jsonb_build_object('field','note'));
  end if;

  update ops_inv.assets set
    status     = p_status,
    ended_on   = case when p_status in ('disposed','lost','returned') then coalesce(p_on, current_date) end,
    updated_at = now()
  where id = a.id;

  return ops_core.say('inventory','asset', p_asset_no,'status','ok', 200, null, v_note,
    jsonb_build_object('asset_no', p_asset_no, 'status', p_status),
    jsonb_build_object('status_before', a.status, 'status_after', p_status),
    jsonb_build_object('status', a.status), jsonb_build_object('status', p_status));
end $$;

-- ── 7. the rent onto the payment calendar ────────────────────────────────
--   monthly   one monthly line from the contract's first month to the last
--             month whose due day falls before the contract ends; open-ended
--             when there is no end
--   yearly    a one-off per contract year, on each anniversary before the
--             end (at most ten); needs an end date
--   upfront   one one-off on the day the contract starts
-- A one-off dated before this month is left out: it was paid or missed before
-- the calendar knew of it, and the ledger is where that lives.
create or replace function ops_acct.schedule_asset_rent(
  p_asset_no text, p_account_code text default null, p_type_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; v_ref text := 'asset:' || p_asset_no; v_name text; v_day int;
        v_last date; v_ends text; r jsonb; v_ids jsonb := '[]'::jsonb; v_on date; k int := 0;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','asset', p_asset_no,'schedule_rent',
      'not_permitted','Putting rent on the payment calendar needs accounting access.');
  end if;
  select * into a from ops_inv.assets where asset_no = p_asset_no;
  if not found then
    return ops_core.not_found('accounting','asset', p_asset_no,'schedule_rent','No such asset.');
  end if;
  if a.ownership = 'owned' then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'not_rented', format('%s has no rent to pay.', a.asset_no));
  end if;
  if coalesce(a.rent_amount, 0) <= 0 or a.rent_period is null then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'rent_missing','Enter the rent and how often it is paid on the asset first.',
      jsonb_build_object('field','rent_amount'));
  end if;
  if a.contract_start is null then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'contract_start_required','Enter when the contract starts on the asset first.',
      jsonb_build_object('field','contract_start'));
  end if;
  if a.rent_period = 'yearly' and a.contract_end is null then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'contract_end_required','Yearly rent needs the contract''s end date, so the calendar knows how many years.',
      jsonb_build_object('field','contract_end'));
  end if;
  if a.status in ('disposed','lost','returned') then
    return ops_core.conflict('accounting','asset', p_asset_no,'schedule_rent',
      'asset_gone', format('%s is %s — there is no rent left to pay.', a.asset_no, a.status));
  end if;
  if exists (select 1 from ops_acct.cash_components where source_ref = v_ref and active) then
    return ops_core.conflict('accounting','asset', p_asset_no,'schedule_rent',
      'already_scheduled', format('The rent for %s is already on the payment calendar. Change it there.', a.asset_no));
  end if;
  if p_type_code is not null and not exists (select 1 from ops_acct.transaction_types where code = p_type_code) then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'no_such_type', format('There is no transaction type %s.', p_type_code), jsonb_build_object('field','type_code'));
  end if;

  v_name := format('Rent — %s (%s)', a.name, a.asset_no);

  if a.rent_period = 'monthly' then
    v_day := coalesce(a.rent_due_day, extract(day from a.contract_start)::int);
    if a.contract_end is not null then
      -- The last payment is the last due day before the contract ends.
      v_last := (date_trunc('month', a.contract_end)
                 + make_interval(days => least(v_day,
                     extract(day from (date_trunc('month', a.contract_end) + interval '1 month - 1 day'))::int) - 1))::date;
      v_ends := to_char(case when v_last >= a.contract_end then v_last - interval '1 month' else v_last end, 'YYYY-MM');
      if v_ends < to_char(a.contract_start, 'YYYY-MM') then v_ends := to_char(a.contract_start, 'YYYY-MM'); end if;
    end if;
    r := ops_acct.save_cash_component(
      v_name, a.rent_amount, 'monthly', 'OUT', v_day, null, null,
      p_type_code, a.vendor_code, p_account_code, to_char(a.contract_start, 'YYYY-MM'),
      format('From %s', a.asset_no), null, v_ends, true, 'fixed');
    if r ->> 'outcome' <> 'ok' then return r; end if;
    v_ids := v_ids || jsonb_build_array(r -> 'data' ->> 'component_id');
  else
    v_on := a.contract_start;
    loop
      exit when k >= case when a.rent_period = 'upfront' then 1 else 10 end;
      exit when a.rent_period = 'yearly' and v_on >= a.contract_end;
      -- A payment in a month already behind us was made or missed before the
      -- calendar knew of it; the ledger is where it lives, not here.
      if v_on < date_trunc('month', ops_core.office_day())::date then
        k := k + 1;
        v_on := (a.contract_start + make_interval(years => k))::date;
        continue;
      end if;
      r := ops_acct.save_cash_component(
        case when a.rent_period = 'yearly' then format('%s · year %s', v_name, k + 1) else v_name end,
        a.rent_amount, 'once', 'OUT', null, null, v_on,
        p_type_code, a.vendor_code, p_account_code, to_char(v_on, 'YYYY-MM'),
        format('From %s', a.asset_no), null, to_char(v_on, 'YYYY-MM'), true, 'fixed');
      if r ->> 'outcome' <> 'ok' then return r; end if;
      v_ids := v_ids || jsonb_build_array(r -> 'data' ->> 'component_id');
      k := k + 1;
      v_on := (a.contract_start + make_interval(years => k))::date;
    end loop;
  end if;

  if jsonb_array_length(v_ids) = 0 then
    return ops_core.invalid('accounting','asset', p_asset_no,'schedule_rent',
      'nothing_to_schedule', format('Every rent payment for %s falls before this month.', a.asset_no));
  end if;

  update ops_acct.cash_components set source_ref = v_ref
   where id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x);

  return ops_core.ok('accounting','asset', p_asset_no,'schedule_rent',
    jsonb_build_object('asset_no', p_asset_no, 'component_ids', v_ids, 'lines', jsonb_array_length(v_ids)),
    null,
    jsonb_build_object('rent_amount', a.rent_amount, 'rent_period', a.rent_period,
                       'contract_start', a.contract_start, 'contract_end', a.contract_end,
                       'lines', jsonb_array_length(v_ids)));
end $$;

grant execute on function
  ops_inv.create_asset(text, text, text, text, text, text, text, ops_inv.asset_status_t, date, numeric, text, text, date, text, text,
                       text, numeric, text, int, date, date),
  ops_inv.update_asset(text, text, text, text, text, text, text, text, date, numeric, text, text, date, text, text[],
                       text, numeric, text, int, date, date),
  ops_inv.set_asset_status(text, ops_inv.asset_status_t, text, date),
  ops_acct.schedule_asset_rent(text, text, text)
  to authenticated;
