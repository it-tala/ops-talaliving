-- inv/acct — rented, leased and borrowed assets, and their rent on the
-- payment calendar (0109, 0110).
--
--   rina  inventory write            — registers and edits
--   anggun inventory read + accounting write — schedules the rent
--
--   REFUSALS     rent on an owned asset; a bad ownership; rent with no period;
--                a contract ending before it starts; an owned asset returned;
--                scheduling without accounting access; scheduling an owned
--                asset; yearly with no end; scheduling twice; a new asset
--                born returned
--   DERIVATIONS  ownership defaults to owned; an update judged on the row as
--                it will be; returned dates the end; contract_ending and
--                contract_expired; monthly rent → one monthly line ending the
--                month before the contract's last due day; yearly → a one-off
--                per anniversary from this month on; upfront → one one-off;
--                rent_lines counts them; source_ref marks them

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009971','rina-rent@talaliving.com','{"full_name":"Rina Rent"}'),
  ('ffffffff-0000-0000-0000-000000009972','anggun-rent@talaliving.com','{"full_name":"Anggun Rent"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009971','inventory','write'),
  ('ffffffff-0000-0000-0000-000000009972','inventory','read'),
  ('ffffffff-0000-0000-0000-000000009972','accounting','write');
insert into ops_procure.vendors (id, code, name) values
  ('99710000-0000-0000-0000-000000000001','V-9971','Rental Genset Bali');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009971';

do $$
declare r jsonb; v_gen text; v_car text; v_hall text; v_pc text;
begin
  r := ops_inv.create_asset('Genset', 'tool', p_rent_amount => 1000000);
  assert r -> 'error' ->> 'code' = 'rent_on_owned', 'rent on owned, got ' || r::text;
  r := ops_inv.create_asset('Genset', 'tool', p_ownership => 'stolen');
  assert r -> 'error' ->> 'code' = 'ownership_invalid', 'bad ownership, got ' || r::text;
  r := ops_inv.create_asset('Genset', 'tool', p_ownership => 'rented', p_rent_amount => 1000000);
  assert r -> 'error' ->> 'code' = 'period_required', 'no period, got ' || r::text;
  r := ops_inv.create_asset('Genset', 'tool', p_ownership => 'rented',
         p_contract_start => current_date, p_contract_end => current_date - 1);
  assert r -> 'error' ->> 'code' = 'contract_dates', 'backwards contract, got ' || r::text;
  r := ops_inv.create_asset('Genset', 'tool', p_status => 'returned', p_ownership => 'rented');
  assert r -> 'error' ->> 'code' = 'status_invalid', 'born returned, got ' || r::text;

  -- Monthly: a year from the 15th two months ago, due on the 15th.
  r := ops_inv.create_asset('Genset 20 kVA', 'tool', p_vendor_code => 'V-9971', p_location => 'Workshop',
         p_ownership => 'rented', p_rent_amount => 2500000, p_rent_period => 'monthly', p_rent_due_day => 15,
         p_contract_start => (date_trunc('month', current_date) - interval '2 months')::date + 14,
         p_contract_end   => (date_trunc('month', current_date) + interval '10 months')::date + 14);
  assert r ->> 'outcome' = 'ok', 'rented genset, got ' || r::text;
  v_gen := r -> 'data' ->> 'asset_no';

  -- Yearly lease, three years, started last year on today's date.
  r := ops_inv.create_asset('Pickup L300', 'vehicle', p_identifier => 'DK 1234 XY',
         p_ownership => 'leased', p_rent_amount => 36000000, p_rent_period => 'yearly',
         p_contract_start => (current_date - interval '1 year')::date,
         p_contract_end   => (current_date + interval '2 years')::date);
  v_car := r -> 'data' ->> 'asset_no';

  -- Paid up front, ending within the month.
  r := ops_inv.create_asset('Event hall tent', 'other', p_ownership => 'rented',
         p_rent_amount => 5000000, p_rent_period => 'upfront',
         p_contract_start => current_date, p_contract_end => current_date + 20);
  v_hall := r -> 'data' ->> 'asset_no';

  r := ops_inv.create_asset('Forklift', 'tool', p_ownership => 'leased', p_rent_amount => 12000000,
         p_rent_period => 'yearly', p_contract_start => current_date);
  r := ops_inv.create_asset('Office chair', 'furniture');

  -- An update is judged on the result: making it owned while rent stays is refused,
  -- clearing the rent with it is fine.
  r := ops_inv.create_asset('Laptop pinjaman', 'computer', p_ownership => 'borrowed',
         p_contract_start => current_date - 60, p_contract_end => current_date - 1);
  v_pc := r -> 'data' ->> 'asset_no';
  r := ops_inv.update_asset(v_gen, p_ownership => 'owned');
  assert r -> 'error' ->> 'code' = 'rent_on_owned', 'owned with rent kept, got ' || r::text;
  r := ops_inv.update_asset(v_pc, p_ownership => 'owned', p_clear => array['contract_start','contract_end']);
  assert r ->> 'outcome' = 'ok' and (select ownership from ops_inv.assets where asset_no = v_pc) = 'owned',
    'owned once cleared, got ' || r::text;
  r := ops_inv.set_asset_status(v_pc, 'returned');
  assert r -> 'error' ->> 'code' = 'status_invalid', 'owned is not returned, got ' || r::text;
  r := ops_inv.update_asset(v_pc, p_ownership => 'borrowed', p_contract_end => current_date - 1);
  assert r ->> 'outcome' = 'ok', 'borrowed again, got ' || r::text;
end $$;

-- The flags, read by the inventory user.
do $$
declare v record;
begin
  select * into v from ops_inv.v_asset where name = 'Event hall tent';
  assert v.contract_ending and not v.contract_expired and v.rent_lines = 0, 'ending soon, got ' || row_to_json(v)::text;
  select * into v from ops_inv.v_asset where name = 'Laptop pinjaman';
  assert v.contract_expired and not v.contract_ending, 'expired, got ' || row_to_json(v)::text;
  select * into v from ops_inv.v_asset where name = 'Genset 20 kVA';
  assert v.ownership = 'rented' and not v.contract_ending and not v.contract_expired, 'running, got ' || row_to_json(v)::text;
end $$;

-- Inventory write is not accounting.
do $$
declare r jsonb; n text := (select asset_no from ops_inv.assets where name = 'Genset 20 kVA');
begin
  r := ops_acct.schedule_asset_rent(n);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'inventory cannot schedule, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009972';

do $$
declare r jsonb; c ops_acct.cash_components; n int;
        v_gen text := (select asset_no from ops_inv.assets where name = 'Genset 20 kVA');
        v_car text := (select asset_no from ops_inv.assets where name = 'Pickup L300');
        v_hall text := (select asset_no from ops_inv.assets where name = 'Event hall tent');
        v_pc text := (select asset_no from ops_inv.assets where name = 'Laptop pinjaman');
begin
  r := ops_acct.schedule_asset_rent(v_pc);
  assert r -> 'error' ->> 'code' = 'rent_missing', 'no rent, got ' || r::text;
  r := ops_acct.schedule_asset_rent((select asset_no from ops_inv.assets where name = 'Office chair'));
  assert r -> 'error' ->> 'code' = 'not_rented', 'owned has no rent, got ' || r::text;
  r := ops_acct.schedule_asset_rent((select asset_no from ops_inv.assets where name = 'Forklift'));
  assert r -> 'error' ->> 'code' = 'contract_end_required', 'yearly needs an end, got ' || r::text;
  r := ops_acct.schedule_asset_rent(v_gen, 'BCA 271', 'NOPE');
  assert r -> 'error' ->> 'code' = 'no_such_type', 'bad type, got ' || r::text;

  r := ops_acct.schedule_asset_rent(v_gen, 'BCA 271', 'OTHERS');
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'lines')::int = 1, 'monthly scheduled, got ' || r::text;
  select * into c from ops_acct.cash_components where source_ref = 'asset:' || v_gen;
  assert c.frequency = 'monthly' and c.due_day = 15 and c.amount = 2500000 and c.amount_kind = 'fixed'
     and c.starts_on = to_char(current_date - interval '2 months', 'YYYY-MM')
     and c.ends_on   = to_char(current_date + interval '9 months', 'YYYY-MM')
     and c.vendor_id = '99710000-0000-0000-0000-000000000001', 'monthly line, got ' || row_to_json(c)::text;

  r := ops_acct.schedule_asset_rent(v_gen);
  assert r -> 'error' ->> 'code' = 'already_scheduled', 'twice refused, got ' || r::text;

  -- Yearly: started a year ago, so the first anniversary is gone; this year's
  -- (today) and next year's are left.
  r := ops_acct.schedule_asset_rent(v_car);
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'lines')::int = 2, 'two years left, got ' || r::text;
  select count(*) into n from ops_acct.cash_components
   where source_ref = 'asset:' || v_car and frequency = 'once' and due_date in (current_date, (current_date + interval '1 year')::date);
  assert n = 2, 'anniversaries dated, got ' || n;

  r := ops_acct.schedule_asset_rent(v_hall);
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'lines')::int = 1, 'upfront, got ' || r::text;
  assert (select due_date from ops_acct.cash_components where source_ref = 'asset:' || v_hall) = current_date, 'upfront dated';

  assert (select rent_lines from ops_inv.v_asset where asset_no = v_car) = 2, 'rent_lines counts';

end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009971';
do $$
declare r jsonb; v_pc text := (select asset_no from ops_inv.assets where name = 'Laptop pinjaman');
begin
  r := ops_inv.set_asset_status(v_pc, 'returned');
  assert r ->> 'outcome' = 'ok' and (select ended_on from ops_inv.assets where asset_no = v_pc) = current_date,
    'returned dates the end, got ' || r::text;
  assert not (select contract_expired from ops_inv.v_asset where asset_no = v_pc), 'a returned thing is not overdue';
end $$;

rollback;
