-- inv — an asset's service and repair log (0121).
--
--   REFUSALS     a read grant; no date; a date in the future; no
--                description; a bad kind; a negative cost; next due not
--                after the job; an unknown supplier or ledger row
--   DERIVATIONS  v_asset reads the last service date, the next due from the
--                latest job, the count, and flags a due within two weeks;
--                v_asset_service names the supplier; a mistaken row deletes,
--                audited with what it said

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009991','rina-sv@talaliving.com','{"full_name":"Rina SV"}'),
  ('ffffffff-0000-0000-0000-000000009992','tamu-sv@talaliving.com','{"full_name":"Tamu SV"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009991','inventory','write'),
  ('ffffffff-0000-0000-0000-000000009992','inventory','read');
insert into ops_procure.vendors (id, code, name) values
  ('99910000-0000-0000-0000-000000000001','V-9991','Bengkel AC Dingin');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009991';

do $$
declare r jsonb; v_ac text; v_id uuid;
begin
  r := ops_inv.create_asset('AC office', 'other');
  v_ac := r -> 'data' ->> 'asset_no';

  r := ops_inv.add_asset_service(v_ac, null, 'Cuci AC');
  assert r -> 'error' ->> 'code' = 'date_required', 'no date, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date + 1, 'Cuci AC');
  assert r -> 'error' ->> 'code' = 'date_in_future', 'future, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, '  ');
  assert r -> 'error' ->> 'code' = 'description_required', 'no description, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, 'Cuci AC', 'wash');
  assert r -> 'error' ->> 'code' = 'kind_invalid', 'bad kind, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, 'Cuci AC', p_cost => -1);
  assert r -> 'error' ->> 'code' = 'cost_negative', 'negative, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, 'Cuci AC', p_next_due => current_date);
  assert r -> 'error' ->> 'code' = 'next_due_invalid', 'next due not after, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, 'Cuci AC', p_vendor_code => 'V-NOPE');
  assert r -> 'error' ->> 'code' = 'vendor_unknown', 'bad vendor, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date, 'Cuci AC', p_trx_no => 'trx-nope');
  assert r -> 'error' ->> 'code' = 'trx_unknown', 'bad trx, got ' || r::text;

  -- An old job with a next due long past, then this week's with the next in ten days.
  r := ops_inv.add_asset_service(v_ac, current_date - 200, 'Isi freon', 'repair', 'V-9991', 450000, null, current_date - 20);
  assert r ->> 'outcome' = 'ok', 'old job, got ' || r::text;
  r := ops_inv.add_asset_service(v_ac, current_date - 2, 'Cuci AC rutin', 'service', 'V-9991', 150000, null, current_date + 10);
  assert r ->> 'outcome' = 'ok', 'this job, got ' || r::text;
  v_id := (r -> 'data' ->> 'id')::uuid;

  -- A repair after it sets no next due, and does not cancel this one.
  r := ops_inv.add_asset_service(v_ac, current_date - 1, 'Ganti kapasitor', 'repair');
  assert r ->> 'outcome' = 'ok', 'repair, got ' || r::text;

  r := ops_inv.create_asset('PC gudang', 'computer');
  r := ops_inv.add_asset_service(r -> 'data' ->> 'asset_no', current_date - 1, 'Ganti RAM', 'repair');
  assert r ->> 'outcome' = 'ok', 'no next due is fine, got ' || r::text;
end $$;

-- Read by the inventory reader.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009992';
do $$
declare v record; r jsonb;
begin
  r := ops_inv.add_asset_service((select asset_no from ops_inv.assets where name = 'AC office'), current_date, 'x');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant refused, got ' || r::text;

  select * into v from ops_inv.v_asset where name = 'AC office';
  assert v.last_service_on = current_date - 1 and v.next_service_due = current_date + 10
     and v.service_due and v.service_count = 3, 'service columns, a repair keeps the next due, got ' || row_to_json(v)::text;
  select * into v from ops_inv.v_asset where name = 'PC gudang';
  assert v.next_service_due is null and not v.service_due and v.service_count = 1, 'no next due, got ' || row_to_json(v)::text;
  assert (select vendor_name from ops_inv.v_asset_service where description = 'Isi freon') = 'Bengkel AC Dingin', 'supplier named';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009991';
do $$
declare r jsonb; v_id uuid := (select id from ops_inv.asset_services where description = 'Cuci AC rutin');
begin
  r := ops_inv.delete_asset_service(v_id, 'Wrong asset');
  assert r ->> 'outcome' = 'ok', 'delete, got ' || r::text;
  assert (select next_service_due from ops_inv.v_asset where name = 'AC office') = current_date - 20,
    'next due falls back to the older job';
  -- A routine service after it clears the old next due.
  r := ops_inv.add_asset_service((select asset_no from ops_inv.assets where name = 'AC office'), current_date, 'Cuci AC');
  assert (select next_service_due from ops_inv.v_asset where name = 'AC office') is null,
    'a later service clears the older next due';
  r := ops_inv.delete_asset_service(v_id);
  assert r -> 'error' ->> 'code' is not null or r ->> 'outcome' = 'not_found', 'gone, got ' || r::text;
end $$;

reset role;
do $$
declare a record;
begin
  /* `outcome = 'ok'` dan `id desc`, dua-duanya perlu. Blok di atas memanggil
     `delete_asset_service` **dua kali** — sekali berhasil, sekali untuk
     membuktikan barangnya sudah hilang — jadi ada dua baris `service_delete`
     dengan `at` yang sama persis, sebab `now()` adalah waktu transaksi.
     Tanpa saringan outcome, yang dimaksud adalah yang berhasil; tanpa `id`,
     mana yang terakhir terserah planner. Yang ini dulu lolos karena
     kebetulan, dan gagal satu kali dari sekian (F146). */
  select * into a from ops_core.audit_log
   where action = 'service_delete' and outcome = 'ok'
   order by at desc, id desc limit 1;
  assert a.reason = 'Wrong asset' and a.detail ->> 'description' = 'Cuci AC rutin', 'audited, got ' || row_to_json(a)::text;
end $$;

rollback;
