-- procure — the quotation: released BOM cost to a price, sent, revised,
-- accepted into the order (0133).
--
-- Worked out first, per unit of QT-MEJA (released BOM: one labour line):
--   ongkos produksi                       1.000.000
--   + marketing 5% + overhead 10%    →    1.150.000
--   ÷ (1 − margin 20%)               →    1.437.500   harga jual / unit
--   × 4 unit                         →    5.750.000   subtotal
--   PPN 11%                          →      632.500
--   total                                 6.382.500
-- and a second line priced by hand: ongkos 500.000 manual, same loads, margin
-- overridden to 30% → 500.000 × 1,15 ÷ 0,7 = 821.429 (rounded).
--
--   REFUSALS     a percent of 100; a product that does not exist; sending with
--                a line that has no cost; changing a sent quotation; a second
--                draft on one project; rejecting without a reason; accepting a
--                draft; somebody without project access; a reader writing
--   DERIVATIONS  the formula above; a draft pricing from the released BOM, not
--                the open draft; send freezing the price so a later BOM change
--                does not move it; INQUIRY → QUOTATION_SENT on send; a revision
--                copying the lines and superseding the old one; accept adding
--                the lines to the order at the quoted price once, and moving
--                the project to DEAL; cost hidden from a reader

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e0001','pm-qt@talaliving.com','{"full_name":"PM Quotation"}'),
  ('ffffffff-0000-0000-0000-0000000e0002','baca-qt@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-0000000e0003','luar-qt@talaliving.com','{"full_name":"Orang Luar"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e0001','project','write'),
  ('ffffffff-0000-0000-0000-0000000e0001','production','write'),
  ('ffffffff-0000-0000-0000-0000000e0002','project','read'),
  ('ffffffff-0000-0000-0000-0000000e0003','inventory','write');

insert into ops_procure.projects (id, code, name, is_active, status) values
  ('0e000000-0000-0000-0000-0000000000b1','QT-P1','Villa Quotation', true, 'INQUIRY');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e0001';

do $$
declare r jsonb; qt text; qt2 text; v jsonb; l1 uuid; l2 uuid;
begin
  /* a product with a released BOM costing exactly 1.000.000 */
  r := ops_prod.save_product('QT-MEJA', 'Meja makan jati', 'Meja', 'unit', p_lead_time_days => 21);
  assert ops_core.said_ok(r), 'product: ' || r::text;
  r := ops_prod.save_bom_line('QT-MEJA', null, 'labour', null, 'Borongan meja', 1, 'unit', 1000000);
  assert ops_core.said_ok(r), 'bom line: ' || r::text;
  r := ops_prod.release_bom('QT-MEJA', 'rilis untuk quotation');
  assert ops_core.said_ok(r), 'release: ' || r::text;

  /* REFUSAL: a margin of 100% has no price */
  r := ops_procure.save_quotation(null, 'QT-P1', p_margin_pct => 100);
  assert r->'error'->>'code' = 'bad_percent', '100%: ' || r::text;

  r := ops_procure.save_quotation(null, 'QT-P1', current_date + 14, 5, 10, 20, true, 11, 'DP 50%', null, 'qt-smoke-1');
  assert ops_core.said_ok(r), 'create: ' || r::text;
  qt := r->'data'->>'quote_no';
  assert qt like 'qt-%', 'qt number';

  /* REFUSAL: one draft per project */
  r := ops_procure.save_quotation(null, 'QT-P1');
  assert r->'error'->>'code' = 'draft_exists', 'second draft: ' || r::text;

  r := ops_procure.save_quotation_line(qt, null, 'NOPE-1', null, 1, 'unit');
  assert r->'error'->>'code' = 'product_not_found', 'unknown product: ' || r::text;
  r := ops_procure.save_quotation_line(qt, null, 'qt-meja', null, 4, 'unit');
  assert ops_core.said_ok(r), 'line 1: ' || r::text;
  l1 := (r->'data'->>'line_id')::uuid;
  r := ops_procure.save_quotation_line(qt, null, null, 'Lampu gantung custom', 2, 'unit');
  l2 := (r->'data'->>'line_id')::uuid;

  /* DERIVATION: the formula, and the name and lead time from the catalogue */
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where id = l1;
  assert v->>'description' = 'Meja makan jati' and (v->>'lead_time_days')::int = 21, 'from the catalogue: ' || v::text;
  assert (v->>'unit_cost')::numeric = 1000000 and v->>'cost_source' = 'bom', 'bom cost: ' || v::text;
  assert (v->>'unit_price')::numeric = 1437500, 'price 1.437.500, got ' || (v->>'unit_price');

  /* REFUSAL: a line with no cost cannot go out */
  r := ops_procure.send_quotation(qt);
  assert r->'error'->>'code' = 'cost_missing', 'no cost: ' || r::text;
  r := ops_procure.save_quotation_line(qt, l2, null, 'Lampu gantung custom', 2, 'unit',
         p_manual_unit_cost => 500000, p_margin_pct => 30);
  assert ops_core.said_ok(r), 'manual cost: ' || r::text;
  assert (select unit_price from ops_procure.v_quotation_line where id = l2) = 821429, 'manual line price';

  select to_jsonb(x) into v from ops_procure.v_quotation x where quote_no = qt;
  assert (v->>'subtotal')::numeric = 5750000 + 2 * 821429, 'subtotal: ' || v::text;
  assert (v->>'vat_amount')::numeric = round((5750000 + 2 * 821429) * 0.11), 'vat';

  /* DERIVATION: a draft BOM does not move a draft quotation's cost */
  r := ops_prod.save_bom_line('QT-MEJA', null, 'labour', null, 'Finishing tambahan', 1, 'unit', 200000);
  assert (select unit_cost from ops_procure.v_quotation_line where id = l1) = 1000000, 'released cost only';

  r := ops_procure.send_quotation(qt);
  assert ops_core.said_ok(r), 'send: ' || r::text;
  assert (select status from ops_procure.projects where code = 'QT-P1') = 'QUOTATION_SENT', 'inquiry → quotation sent';

  /* DERIVATION: frozen — a new release does not move what was sent */
  r := ops_prod.release_bom('QT-MEJA', 'finishing tambahan');
  assert ops_core.said_ok(r), 'rev 2: ' || r::text;
  assert (select unit_price from ops_procure.v_quotation_line where id = l1) = 1437500, 'frozen price';

  /* REFUSAL: a sent quotation is not edited */
  r := ops_procure.save_quotation_line(qt, l1, 'QT-MEJA', null, 5, 'unit');
  assert r->'error'->>'code' = 'not_draft', 'edit sent: ' || r::text;
  r := ops_procure.decide_quotation(qt, false, ' ');
  assert r->'error'->>'code' = 'reason_required', 'silent rejection: ' || r::text;

  /* a revision: copies the lines, supersedes the old, prices from rev 2 */
  r := ops_procure.revise_quotation(qt);
  assert ops_core.said_ok(r), 'revise: ' || r::text;
  qt2 := r->'data'->>'quote_no';
  assert (r->'data'->>'rev')::int = 2, 'rev 2';
  assert (select status from ops_procure.quotations where quote_no = qt) = 'SUPERSEDED', 'old superseded';
  assert (select count(*) from ops_procure.quotation_lines l join ops_procure.quotations q on q.id = l.quotation_id
           where q.quote_no = qt2) = 2, 'lines copied';
  assert (select unit_cost from ops_procure.v_quotation_line where quote_no = qt2 and product_code = 'QT-MEJA') = 1200000,
    'the new revision prices from the new release';

  r := ops_procure.decide_quotation(qt2, true);
  assert r->'error'->>'code' = 'not_sent', 'accept a draft: ' || r::text;
  r := ops_procure.send_quotation(qt2);
  assert ops_core.said_ok(r), 'send rev 2: ' || r::text;

  /* DERIVATION: accept makes the order, once */
  r := ops_procure.decide_quotation(qt2, true);
  assert ops_core.said_ok(r) and (r->'data'->>'order_lines_added')::int = 2, 'accept: ' || r::text;
  assert (select status from ops_procure.projects where code = 'QT-P1') = 'DEAL', 'quotation sent → deal';
  assert (select unit_price from ops_procure.project_lines where product_code = 'QT-MEJA'
            and project_id = '0e000000-0000-0000-0000-0000000000b1') = round(1200000 * 1.15 / 0.8),
    'ordered at the quoted price';
  r := ops_procure.decide_quotation(qt2, true);
  assert r->'error'->>'code' = 'not_sent', 'accept twice: ' || r::text;
  assert (select count(*) from ops_procure.project_lines where project_id = '0e000000-0000-0000-0000-0000000000b1') = 2,
    'no double order';
  assert exists (select 1 from ops_procure.project_status_log l join ops_procure.projects p on p.id = l.project_id
                  where p.code = 'QT-P1' and l.reason like 'Quotation % disetujui'), 'move logged';
end $$;

/* a reader sees the price, not the cost, and cannot write */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e0002';
do $$
declare r jsonb; v jsonb;
begin
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where product_code = 'QT-MEJA' and status = 'ACCEPTED';
  assert v->>'unit_price' is not null and v->>'unit_cost' is null and not (v->>'cost_visible')::boolean,
    'reader: ' || v::text;
  r := ops_procure.save_quotation(null, 'QT-P1');
  assert r->'error'->>'code' = 'not_permitted', 'reader create: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e0003';
do $$
begin
  assert (select count(*) from ops_procure.quotations) = 0, 'outsider reads nothing';
end $$;

rollback;
