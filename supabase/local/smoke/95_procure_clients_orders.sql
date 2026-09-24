-- procure — the customer's order: clients, status, lines, and the item code (0111).
--
--   REFUSALS     a second client with the same name; cancelling with no
--                reason; an order line of zero; a line in a unit that does
--                not exist; somebody without project access; making an item
--                code without production access
--   DERIVATIONS  a project code minted after the highest numeric one; every
--                status change logged, and is_active following the status;
--                a client rename reaching the projects that carry it; order
--                value summed from priced lines only; an order line turned
--                into an item code, and a second order for the same thing
--                linking to it rather than duplicating it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000dd01','sales@talaliving.com','{"full_name":"Sales"}'),
  ('ffffffff-0000-0000-0000-00000000dd02','gudang@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000dd01','project','write'),
  ('ffffffff-0000-0000-0000-00000000dd01','production','write'),
  ('ffffffff-0000-0000-0000-00000000dd02','inventory','write');

insert into ops_procure.projects (code, name, is_active) values ('25007', 'Proyek lama', true);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000dd01';

do $$
declare r jsonb; v_line uuid; v_line2 uuid; v jsonb;
begin
  r := ops_procure.save_client(null, 'Hotel Laut Biru', 'Bu Sari', '0812', null, 'Labuan Bajo');
  assert ops_core.said_ok(r), 'client: ' || r::text;
  assert r->'data'->>'code' like 'CL-%', 'client code minted';

  /* REFUSAL: the same client twice */
  r := ops_procure.save_client(null, '  hotel laut biru ');
  assert r->'error'->>'code' = 'client_exists', 'duplicate client: ' || r::text;

  /* DERIVATION: the next code after the highest numeric one */
  r := ops_procure.save_project(null, 'Villa Baby Island', (select code from ops_procure.clients limit 1),
                                null, 'Ryan', current_date, current_date + 30);
  assert ops_core.said_ok(r), 'project: ' || r::text;
  assert r->'data'->>'code' = '25008', 'code after 25007, got ' || (r->'data'->>'code');
  assert (select status from ops_procure.projects where code = '25008') = 'INQUIRY', 'starts as inquiry';
  assert (select client_name from ops_procure.projects where code = '25008') = 'Hotel Laut Biru', 'client name carried';

  /* lines */
  r := ops_procure.save_project_line('25008', null, null, 'Lounge chair jati', 12, 'pcs', 3500000, current_date + 20);
  assert ops_core.said_ok(r), 'line 1: ' || r::text;
  v_line := (r->'data'->>'line_id')::uuid;
  r := ops_procure.save_project_line('25008', null, null, 'Ongkos kirim', 1, 'lot', null, null);
  assert ops_core.said_ok(r), 'line 2: ' || r::text;
  v_line2 := (r->'data'->>'line_id')::uuid;

  /* REFUSALS on a line */
  r := ops_procure.save_project_line('25008', null, null, 'Nol', 0, 'pcs');
  assert r->'error'->>'code' = 'qty_required', 'zero qty: ' || r::text;
  r := ops_procure.save_project_line('25008', null, null, 'Aneh', 1, 'bukan-satuan');
  assert r->'error'->>'code' = 'no_such_uom', 'unknown uom: ' || r::text;

  /* DERIVATION: order value from priced lines only */
  select to_jsonb(x) into v from ops_procure.v_project x where code = '25008';
  assert (v->>'order_value')::numeric = 42000000, 'order value 12 × 3.500.000, got ' || (v->>'order_value');
  assert (v->>'unpriced_lines')::int = 1, 'shipping unpriced';
  assert (v->>'lines_without_item_code')::int = 2, 'no item codes yet';
  assert (v->>'next_delivery')::date = current_date + 20, 'next delivery';

  /* status: logged, and is_active follows */
  r := ops_procure.set_project_status('25008', 'QUOTATION_SENT');
  assert ops_core.said_ok(r), 'quotation: ' || r::text;
  r := ops_procure.set_project_status('25008', 'CANCELLED');
  assert r->'error'->>'code' = 'reason_required', 'cancel needs a reason: ' || r::text;
  r := ops_procure.set_project_status('25008', 'CANCELLED', 'klien menunda ke tahun depan');
  assert ops_core.said_ok(r), 'cancel: ' || r::text;
  assert not (select is_active from ops_procure.projects where code = '25008'), 'cancelled is not active';
  r := ops_procure.set_project_status('25008', 'DEAL');
  assert (select is_active from ops_procure.projects where code = '25008'), 'back to deal is active again';
  assert (select count(*) from ops_procure.project_status_log l
            join ops_procure.projects p on p.id = l.project_id where p.code = '25008') = 4,
    'created + three moves logged';

  /* DERIVATION: a rename reaches the project */
  r := ops_procure.save_client((select code from ops_procure.clients limit 1), 'Hotel Laut Biru Group');
  assert ops_core.said_ok(r), 'rename: ' || r::text;
  assert (select client_name from ops_procure.projects where code = '25008') = 'Hotel Laut Biru Group', 'rename followed';

  /* an order line becomes an item code */
  r := ops_prod.product_from_order_line('25008', v_line, 'sg-01a');
  assert ops_core.said_ok(r), 'item code: ' || r::text;
  assert (select product_code from ops_procure.project_lines where id = v_line) = 'SG-01A', 'line linked';
  assert (select name from ops_prod.products where product_code = 'SG-01A') = 'Lounge chair jati', 'named from the line';
  assert (select product_exists from ops_procure.v_project_line where id = v_line), 'the line view sees it';

  /* the same thing on a second order links, not duplicates */
  r := ops_procure.save_project(null, 'Resort kedua');
  r := ops_procure.save_project_line('25009', null, null, 'Lounge chair jati', 4, 'pcs');
  r := ops_prod.product_from_order_line('25009', (r->'data'->>'line_id')::uuid, 'SG-01A');
  assert ops_core.said_ok(r) and (r->'data'->>'existing')::boolean, 'existing code linked: ' || r::text;
  assert (select count(*) from ops_prod.products where product_code = 'SG-01A') = 1, 'one item code';

  r := ops_procure.remove_project_line('25008', v_line2);
  assert ops_core.said_ok(r), 'remove line: ' || r::text;
end $$;

/* REFUSAL: no project access, no production access */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000dd02';
do $$
declare r jsonb;
begin
  r := ops_procure.save_project(null, 'Diam-diam');
  assert r->'error'->>'code' = 'not_permitted', 'outsider project: ' || r::text;
  r := ops_procure.set_project_status('25008', 'DONE');
  assert r->'error'->>'code' = 'not_permitted', 'outsider status: ' || r::text;
  r := ops_prod.product_from_order_line('25009', (select id from ops_procure.project_lines limit 1), 'X-1');
  assert r->'error'->>'code' = 'not_permitted', 'outsider item code: ' || r::text;
end $$;

rollback;
