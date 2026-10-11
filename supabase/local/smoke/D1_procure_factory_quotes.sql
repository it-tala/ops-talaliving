-- procure — factory prices per design item, and a quotation in IDR or USD
-- (0256, O2, kajian F255 §5.3, D414, D415).
--
-- DERIVATIONS  procurement reads the design it asks prices for; an offer for
--              several items is one document; a supplier given an offer
--              becomes a factory; the first offer for an item is chosen on its
--              own, a newer one from the same factory takes over, another
--              factory's does not; voiding falls back to the same factory's
--              newest live offer; a draft line is costed manual › factory ›
--              BOM, in the quotation's currency at its kurs, priced to the
--              cent in USD; a seller sees the price, not the cost; sending
--              freezes the offer; a revision keeps the currency and kurs;
--              accepting writes rupiah order lines at the kurs; the pipeline
--              reads the quotation in rupiah
-- REFUSALS     a vendor that is QC; an item of another project; a price that
--              is not a positive number; a bad lead time; an item twice; no
--              lines; a currency that is not IDR/USD; recording or choosing
--              without procurement or project.update; voiding without a
--              reason; a USD quotation sent without a kurs; a USD factory cost
--              on an IDR quotation without a kurs; changing a sent
--              quotation's currency; setting a vendor's kind without
--              procurement.update, or to a kind that does not exist

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d1001','proc-fq@talaliving.com','{"full_name":"Andi Pabrik"}'),
  ('aaaa0000-0000-0000-0000-0000000d1002','mkt-fq@talaliving.com','{"full_name":"Rina Pabrik"}'),
  ('aaaa0000-0000-0000-0000-0000000d1003','pm-fq@talaliving.com','{"full_name":"Pimpinan Pabrik"}'),
  ('aaaa0000-0000-0000-0000-0000000d1004','prod-fq@talaliving.com','{"full_name":"Made Pabrik"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d1001','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d1002','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000d1003','project','write'),
  ('aaaa0000-0000-0000-0000-0000000d1004','production','write');

insert into ops_procure.clients (id, code, name) values
  ('d1000000-0000-0000-0000-0000000000c1','CL-0961','PT Contoh Pabrik');
insert into ops_procure.projects (id, code, name, client_id) values
  ('d1000000-0000-0000-0000-0000000000d1','26961','Villa Agen','d1000000-0000-0000-0000-0000000000c1'),
  ('d1000000-0000-0000-0000-0000000000d2','26962','Villa Agen Dua','d1000000-0000-0000-0000-0000000000c1');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d1000000-0000-0000-0000-0000000000f1','V-FQ1','CV Pabrik Satu','supplier'),
  ('d1000000-0000-0000-0000-0000000000f2','V-FQ2','PT Factory Two','factory'),
  ('d1000000-0000-0000-0000-0000000000f3','V-FQ3','QC Lepas','qc');

-- The design, drawn by marketing.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d1002';
do $$
begin
  perform ops_procure.save_design_collection('26961', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26961', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26961', 'A', 'LR', 'Sofa 3 seater', 2, 'tala');
  perform ops_procure.save_design_item('26961', 'A', 'LR', 'Coffee table', 3, 'tala');
  perform ops_procure.save_design_collection('26962', 'A', 'Lobby');
  perform ops_procure.save_design_room('26962', 'A', 'LB', 'Lobby');
  perform ops_procure.save_design_item('26962', 'A', 'LB', 'Bench', 1, 'tala');
end $$;

-- ── procurement asks the factories ────────────────────────────────────────
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d1001';
do $$
declare r jsonb; v jsonb; fq1 text; fq2 text; fq3 text; l_old uuid; l_new uuid; l_two uuid;
begin
  assert (select count(*) from ops_procure.v_design_item where project_code = '26961') = 2,
    'procurement reads the design it asks prices for';

  -- refusals, and nothing written by any of them
  r := ops_procure.record_factory_quote('26961', 'V-FQ3', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":100}]');
  assert r->'error'->>'code' = 'not_factory', 'QC is not a factory: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26962-A-LB-01","unit_price":100}]');
  assert r->'error'->>'code' = 'item_unknown', 'an item of this project: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":"murah"}]');
  assert r->'error'->>'code' = 'bad_price', 'a price is a number: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":0}]');
  assert r->'error'->>'code' = 'bad_price', 'a price above zero: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":10,"lead_time_days":-3}]');
  assert r->'error'->>'code' = 'bad_lead_time', 'days, not negative: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR',
    '[{"item_no":"26961-A-LR-01","unit_price":10},{"item_no":"26961-A-LR-01","unit_price":11}]');
  assert r->'error'->>'code' = 'item_twice', 'an item once: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[]');
  assert r->'error'->>'code' = 'no_lines', 'at least one item: ' || r::text;
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'EUR', '[{"item_no":"26961-A-LR-01","unit_price":10}]');
  assert r->'error'->>'code' = 'bad_currency', 'IDR or USD: ' || r::text;
  assert (select count(*) from ops_procure.factory_quotes) = 0, 'a refused offer writes nothing';

  -- a supplier's first offer: one document, two items, both chosen, and the
  -- supplier is now a factory
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR',
    '[{"item_no":"26961-A-LR-01","unit_price":4000000,"lead_time_days":45},
      {"item_no":"26961-A-LR-02","unit_price":1500000,"moq":2}]',
    ops_core.office_day() - 10, ops_core.office_day() + 20, 'via WA');
  assert ops_core.said_ok(r) and (r->'data'->>'lines')::int = 2 and (r->'data'->>'chosen')::int = 2
     and (r->'data'->>'vendor_marked_factory')::boolean, 'first offer: ' || r::text;
  fq1 := r->'data'->>'fq_no';
  assert (select kind from ops_procure.vendors where code = 'V-FQ1') = 'factory', 'a supplier given an offer is a factory';
  assert (select kind from ops_procure.v_vendor_view where code = 'V-FQ1') = 'factory', 'the vendor view says so';
  select id into l_old from ops_procure.v_factory_quote_line where fq_no = fq1 and item_no = '26961-A-LR-01';

  -- another factory's offer does not take the choice
  r := ops_procure.record_factory_quote('26961', 'V-FQ2', 'USD', '[{"item_no":"26961-A-LR-01","unit_price":230.5}]',
    ops_core.office_day() - 5);
  assert ops_core.said_ok(r) and (r->'data'->>'chosen')::int = 0 and not (r->'data'->>'vendor_marked_factory')::boolean,
    'another factory: ' || r::text;
  fq2 := r->'data'->>'fq_no';
  select id into l_two from ops_procure.v_factory_quote_line where fq_no = fq2;

  -- the chosen factory's newer price takes over
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":3800000}]');
  assert ops_core.said_ok(r) and (r->'data'->>'chosen')::int = 1, 'newer from the same factory: ' || r::text;
  fq3 := r->'data'->>'fq_no';
  select id into l_new from ops_procure.v_factory_quote_line where fq_no = fq3;
  select to_jsonb(x) into v from ops_procure.v_factory_quote_line x where id = l_old;
  assert not (v->>'is_latest')::boolean and not (v->>'is_chosen')::boolean, 'the old price is history: ' || v::text;
  select to_jsonb(x) into v from ops_procure.v_factory_quote_line x where id = l_new;
  assert (v->>'is_latest')::boolean and (v->>'is_chosen')::boolean and v->>'vendor_name' = 'CV Pabrik Satu',
    'the new price is the one: ' || v::text;
  assert (select line_count from ops_procure.v_factory_quote where fq_no = fq1) = 2, 'the list counts lines';

  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26961-A-LR-01';
  assert (v->>'factory_unit_price')::numeric = 3800000 and v->>'factory_vendor_name' = 'CV Pabrik Satu'
     and v->>'factory_currency' = 'IDR' and (v->>'factory_offers')::int = 3, 'the item reads its offer: ' || v::text;

  -- choosing
  r := ops_procure.choose_factory_line('26961-A-LR-01', l_two);
  assert ops_core.said_ok(r), 'choose another factory: ' || r::text;
  r := ops_procure.choose_factory_line('26961-A-LR-01', l_two);
  assert r->>'outcome' = 'noop', 'choosing it again changes nothing: ' || r::text;
  r := ops_procure.choose_factory_line('26961-A-LR-02', l_two);
  assert r->'error'->>'code' = 'line_not_for_item', 'an offer for that item: ' || r::text;

  -- voiding: without a reason, no; with one, the item falls back to the same
  -- factory's newest live offer — here none
  r := ops_procure.void_factory_quote(fq2, ' ');
  assert r->'error'->>'code' = 'reason_required', 'a void says why: ' || r::text;
  r := ops_procure.void_factory_quote(fq2, 'Salah item');
  assert ops_core.said_ok(r) and (r->'data'->>'items_repriced')::int = 1, 'voided: ' || r::text;
  assert (select factory_line_id from ops_procure.design_items where item_no = '26961-A-LR-01') is null,
    'no other offer from that factory: nothing chosen';
  r := ops_procure.choose_factory_line('26961-A-LR-01', l_two);
  assert r->'error'->>'code' = 'voided', 'a voided offer cannot be chosen: ' || r::text;
  perform ops_procure.choose_factory_line('26961-A-LR-01', l_new);
  r := ops_procure.void_factory_quote(fq3, 'Harga salah ketik');
  assert ops_core.said_ok(r), 'void the newer one: ' || r::text;
  assert (select factory_line_id from ops_procure.design_items where item_no = '26961-A-LR-01') = l_old,
    'falls back to the same factory''s older offer';

  -- a factory in USD for the second project, before the vendor is retyped
  r := ops_procure.record_factory_quote('26962', 'V-FQ2', 'USD', '[{"item_no":"26962-A-LB-01","unit_price":230.5}]');
  assert ops_core.said_ok(r), 'usd offer: ' || r::text;

  -- the vendor's kind
  r := ops_procure.set_vendor_kind('V-FQ2', 'pabrik');
  assert r->'error'->>'code' = 'bad_kind', 'a kind that exists: ' || r::text;
  r := ops_procure.set_vendor_kind('V-FQ3', 'other');
  assert ops_core.said_ok(r), 'retyped: ' || r::text;
end $$;

-- ── without procurement or project.update ─────────────────────────────────
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d1004';
do $$
declare r jsonb;
begin
  r := ops_procure.record_factory_quote('26961', 'V-FQ1', 'IDR', '[{"item_no":"26961-A-LR-01","unit_price":10}]');
  assert r->'error'->>'code' = 'not_permitted', 'production does not record factory prices: ' || r::text;
  r := ops_procure.choose_factory_line('26961-A-LR-01', null);
  assert r->'error'->>'code' = 'not_permitted', 'nor choose: ' || r::text;
  r := ops_procure.set_vendor_kind('V-FQ1', 'supplier');
  assert r->'error'->>'code' = 'not_permitted', 'nor retype a vendor: ' || r::text;
end $$;

-- ── a quotation priced from the factory, in USD ───────────────────────────
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d1002';
do $$
declare r jsonb; v jsonb; qt text; qt2 text; ql uuid;
begin
  -- a seller does not see factory prices on the item
  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26961-A-LR-01';
  assert v->>'factory_unit_price' is null and (v->>'factory_offers')::int = 0, 'masked for a seller: ' || v::text;

  r := ops_procure.save_quotation(null, '26961', ops_core.office_day() + 14, 0, 0, 20);
  qt := r->'data'->>'quote_no';
  perform ops_procure.add_quotation_lines_from_design(qt, array['26961-A-LR-01', '26961-A-LR-02']);
  r := ops_procure.save_quotation_line(qt, null, null, 'Ongkos kirim kontainer', 1, 'unit', null, 100);
  assert ops_core.said_ok(r), 'manual line: ' || r::text;

  -- IDR: the factory's rupiah price is the cost; the seller sees the price only
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 1;
  assert v->>'unit_cost' is null and v->>'cost_source' is null and v->>'factory_vendor_name' is null
     and (v->>'unit_price')::numeric = 5000000 and not (v->>'cost_missing')::boolean,
    'a seller sees the price from the factory, not the cost: ' || v::text;

  -- USD without a kurs: the rupiah costs are not costs yet
  r := ops_procure.set_quotation_currency(qt, 'USD', null);
  assert ops_core.said_ok(r), 'usd: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 1;
  assert (v->>'cost_needs_rate')::boolean and v->>'unit_price' is null and v->>'currency' = 'USD', 'needs a kurs: ' || v::text;
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 3;
  assert not (v->>'cost_needs_rate')::boolean and (v->>'unit_price')::numeric = 125.00,
    'a typed cost is in the quotation''s own currency: ' || v::text;
  r := ops_procure.send_quotation(qt);
  assert r->'error'->>'code' = 'rate_required', 'no kurs, not sent: ' || r::text;
  r := ops_procure.set_quotation_currency(qt, 'USD', -1);
  assert r->'error'->>'code' = 'bad_rate', 'a kurs above zero: ' || r::text;

  r := ops_procure.set_quotation_currency(qt, 'USD', 16000);
  assert ops_core.said_ok(r), 'kurs: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 1;
  assert (v->>'unit_price')::numeric = 312.50, 'Rp 4.000.000 at 16.000 = USD 250, ÷ 0.8 = 312.50: ' || v::text;
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 2;
  assert (v->>'unit_price')::numeric = 117.19, 'Rp 1.500.000 at 16.000 = 93.75, ÷ 0.8, to the cent: ' || v::text;
  select to_jsonb(x) into v from ops_procure.v_quotation x where quote_no = qt;
  assert (v->>'grand_total')::numeric = 312.50 * 2 + 117.19 * 3 + 125.00
     and (v->>'grand_total_idr')::numeric = round((312.50 * 2 + 117.19 * 3 + 125.00) * 16000),
    'the total, and in rupiah at the kurs: ' || v::text;

  r := ops_procure.send_quotation(qt);
  assert ops_core.said_ok(r), 'sent: ' || r::text;
  r := ops_procure.set_quotation_currency(qt, 'IDR', null);
  assert r->'error'->>'code' = 'not_draft', 'a sent offer keeps its currency: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_project x where code = '26961';
  assert v->>'current_quote_currency' = 'USD' and (v->>'current_quote_total_own')::numeric = 312.50 * 2 + 117.19 * 3 + 125.00
     and (v->>'current_quote_total')::numeric = round((312.50 * 2 + 117.19 * 3 + 125.00) * 16000),
    'the pipeline reads it in rupiah: ' || v::text;

  -- a revision keeps the currency and the kurs
  r := ops_procure.revise_quotation(qt);
  qt2 := r->'data'->>'quote_no';
  select to_jsonb(x) into v from ops_procure.v_quotation x where quote_no = qt2;
  assert v->>'currency' = 'USD' and (v->>'fx_rate')::numeric = 16000, 'the revision keeps them: ' || v::text;
  r := ops_procure.send_quotation(qt2);
  assert ops_core.said_ok(r), 'revision sent: ' || r::text;

  -- accepted: the order is in rupiah at the kurs
  r := ops_procure.decide_quotation(qt2, true);
  assert ops_core.said_ok(r) and (r->'data'->>'order_lines_added')::int = 3, 'accepted: ' || r::text;
  select to_jsonb(x) into v from ops_procure.project_lines x
   where project_id = 'd1000000-0000-0000-0000-0000000000d1' and line_no = 1;
  assert (v->>'unit_price')::numeric = 5000000 and v->>'note' like '%USD 312.50 × kurs 16000%',
    'USD 312.50 × 16.000 = Rp 5.000.000, and the line says so: ' || v::text;

  -- an IDR quotation priced from a USD factory needs the kurs too
  r := ops_procure.save_quotation(null, '26962', ops_core.office_day() + 14, 0, 0, 0);
  qt := r->'data'->>'quote_no';
  perform ops_procure.add_quotation_lines_from_design(qt, array['26962-A-LB-01']);
  r := ops_procure.send_quotation(qt);
  assert r->'error'->>'code' = 'rate_required', 'a USD cost needs the kurs: ' || r::text;
  perform ops_procure.set_quotation_currency(qt, 'IDR', 16000);
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt;
  assert (v->>'unit_price')::numeric = 3688000, 'USD 230.50 × 16.000: ' || v::text;
end $$;

-- ── whoever sees cost sees where it came from ─────────────────────────────
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d1003';
do $$
declare v jsonb; qt text;
begin
  select quote_no into qt from ops_procure.v_quotation where project_code = '26961' and rev = 1;
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 1;
  assert v->>'cost_source' = 'factory' and (v->>'unit_cost')::numeric = 250.00 and v->>'cost_currency' = 'IDR'
     and (v->>'cost_original')::numeric = 4000000 and v->>'factory_vendor_name' = 'CV Pabrik Satu'
     and v->>'factory_quote_no' is not null, 'frozen: the factory, its price, the cost in USD: ' || v::text;
  assert (select frozen_factory_line_id from ops_procure.quotation_lines where id = (v->>'id')::uuid) is not null,
    'sending froze the offer';
  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26961-A-LR-01';
  assert v->>'factory_vendor_name' = 'CV Pabrik Satu', 'a project editor reads the factory''s name: ' || v::text;
end $$;

rollback;
