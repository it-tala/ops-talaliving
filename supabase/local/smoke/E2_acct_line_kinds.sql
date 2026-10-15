-- acct — every line says what kind of money it is (0271, L4, D435).
--
--   post: item + fee + tax, each with its kind -> stored as sent; a line
--     with no kind is guessed from its description (admin fee -> fee)
--   discount counts minus in the sum: item 125.000 − discount 15.000 + fee
--     4.500 = 114.500 books; the same lines against 144.500 do not
--   a purchase's fee line needs no qty/unit price (D86 is for item lines)
--   a bill in USD paid in IDR is kept beside the rupiah; edit sets, changes
--     and clears it with an audit value `USD 26.64`
--   REFUSALS  a kind nobody knows; a negative amount; currency without
--             amount; IDR as the billed currency; amount edit without currency
--   READS     v_transaction_detail.lines carry id and kind; billed columns
--             at the end; item_purchases skips the fee line

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e271','kind-acct@talaliving.com','{"full_name":"Kind Acct"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e271','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e271','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e271','procurement','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-00000000e271','V-7271','TOKO UJI KIND', true);
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('22220000-0000-0000-0000-00000000e271','I-7271','Kartu nama','finishing','pcs');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-00000000e271','a/nota-kind.jpg','nota-kind.jpg','ffffffff-0000-0000-0000-00000000e271');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e271';

do $$
declare r jsonb; nota jsonb; d record; trx text; k text[];
begin
  nota := jsonb_build_array(jsonb_build_object(
    'attachment_id','44440000-0000-0000-0000-00000000e271','kind','nota'));

  -- ── the guess ────────────────────────────────────────────────────────
  assert ops_acct.line_kind_guess('Transfer admin fee') = 'fee', 'admin fee';
  assert ops_acct.line_kind_guess('BIAYA ADMIN') = 'fee', 'biaya admin';
  assert ops_acct.line_kind_guess('TAX APRIL - AGST 2026') = 'tax', 'tax';
  assert ops_acct.line_kind_guess('Ongkir JNE') = 'shipping', 'ongkir';
  assert ops_acct.line_kind_guess('KAYU JATI incl PPN') = 'item', 'ppn inside a description is not a tax line';
  assert ops_acct.line_kind_guess('Tax Consultant Subadriyah') = 'item', 'a consultant is a service';
  assert ops_acct.line_kind_guess('SARIPAN ELECTRICITY - SHOPEE (+ADMIN FEE 4.000)') = 'item', 'electricity with a fee inside is electricity';
  assert ops_acct.line_kind_guess('ADMIN FEE MONTHLY') = 'fee', 'starts with the fee';
  assert ops_acct.line_kind_guess('Voucher Shopee') = 'item', 'never discount';
  assert ops_acct.line_kind_of('FEE', 'x') = 'fee', 'case-insensitive';
  assert ops_acct.line_kind_of(null, 'Transfer admin fee') = 'fee', 'guessed when absent';
  assert ops_acct.line_kind_of('bonus', 'x') is null, 'unknown is null';

  -- ── refusals ─────────────────────────────────────────────────────────
  r := ops_acct.post_transaction('BCA 271','OUT', 100000,'OTHERS','x', nota, null, null, null,
        jsonb_build_array(jsonb_build_object('kind','bonus','description','x','amount',100000)));
  assert r -> 'error' ->> 'code' = 'unknown_line_kind', format('got %s', r);
  assert r -> 'error' ->> 'message' like '%"bonus"%', 'names the word';

  r := ops_acct.post_transaction('BCA 271','OUT', 100000,'OTHERS','x', nota, null, null, null,
        jsonb_build_array(jsonb_build_object('kind','item','description','x','amount',115000),
                          jsonb_build_object('kind','other','description','potongan','amount',-15000)));
  assert r -> 'error' ->> 'code' = 'line_amount_negative', format('got %s', r);

  -- `other` lines carry no qty, whatever the type's purchase rule says
  r := ops_acct.post_transaction('BCA 271','OUT', 100000,'OTHERS','x', nota, null, 'V-7271', null,
        jsonb_build_array(jsonb_build_object('kind','other','description','x','amount',100000)),
        null, null, null, 'USD', null);
  assert r -> 'error' ->> 'code' = 'billed_together', format('got %s', r);

  r := ops_acct.post_transaction('BCA 271','OUT', 100000,'OTHERS','x', nota, null, 'V-7271', null,
        jsonb_build_array(jsonb_build_object('kind','other','description','x','amount',100000)),
        null, null, null, 'idr', 100000);
  assert r -> 'error' ->> 'code' = 'billed_currency', format('got %s', r);

  -- ── discount counts minus ────────────────────────────────────────────
  r := ops_acct.post_transaction('BCA 271','OUT', 144500,'SUPPLIERS','KARTU HELO OFFICE', nota,
        null, 'V-7271', null,
        jsonb_build_array(
          jsonb_build_object('kind','item','description','Kartu nama Hello Office','qty',1,'unit_price',125000,'amount',125000,
                             'item_id','22220000-0000-0000-0000-00000000e271'),
          jsonb_build_object('kind','discount','description','Voucher Shopee','amount',15000),
          jsonb_build_object('kind','fee','description','Ongkir','amount',4500)));
  assert r -> 'error' ->> 'code' = 'lines_do_not_add_up', format('discount is subtracted, got %s', r);
  assert (r -> 'error' -> 'detail' ->> 'lines_total')::numeric = 114500, format('got %s', r);

  r := ops_acct.post_transaction('BCA 271','OUT', 114500,'SUPPLIERS','KARTU HELO OFFICE', nota,
        null, 'V-7271', null,
        jsonb_build_array(
          jsonb_build_object('kind','item','description','Kartu nama Hello Office','qty',1,'unit_price',125000,'amount',125000,
                             'item_id','22220000-0000-0000-0000-00000000e271'),
          jsonb_build_object('kind','discount','description','Voucher Shopee','amount',15000),
          jsonb_build_object('description','Ongkir','amount',4500)),   -- no kind: guessed
        null, 'kind-shopee');
  assert r ->> 'outcome' = 'ok', format('e-commerce books, got %s', r);
  trx := r -> 'data' ->> 'trx_no';

  select array_agg(kind::text order by line_no) into k
    from ops_acct.transaction_lines l join ops_acct.transactions t on t.id = l.trx_id
   where t.trx_no = trx;
  assert k = array['item','discount','shipping'], format('kinds stored as sent or guessed, got %s', k);

  -- the fee line of a purchase needs no qty (D86 is for the goods)
  r := ops_acct.post_transaction('BCA 271','OUT', 3302500,'SUPPLIERS','SERVICE MESIN', nota,
        null, 'V-7271', null,
        jsonb_build_array(
          jsonb_build_object('kind','item','description','Service blower','qty',2,'unit_price',1650000,'amount',3300000),
          jsonb_build_object('description','Transfer admin fee','amount',2500)),
        null, 'kind-arif');
  assert r ->> 'outcome' = 'ok', format('fee without qty on a purchase, got %s', r);
  -- but an item line still does
  r := ops_acct.post_transaction('BCA 271','OUT', 3302500,'SUPPLIERS','SERVICE MESIN 2', nota,
        null, 'V-7271', null,
        jsonb_build_array(
          jsonb_build_object('kind','item','description','Service blower','amount',3300000),
          jsonb_build_object('kind','fee','description','Transfer admin fee','amount',2500)),
        null, 'kind-arif-2');
  assert r -> 'error' ->> 'code' = 'line_detail_required', format('got %s', r);

  -- ── the bill in USD ──────────────────────────────────────────────────
  r := ops_acct.post_transaction('BCA 271','OUT', 491500,'OTHERS','N8N cloud', nota,
        null, 'V-7271', null,
        jsonb_build_array(
          jsonb_build_object('kind','item','description','n8n starter','qty',1,'unit_price',489000,'amount',489000),
          jsonb_build_object('kind','fee','description','Transfer admin fee','amount',2500)),
        null, 'kind-n8n', null, 'usd', 26.64);
  assert r ->> 'outcome' = 'ok', format('billed usd, got %s', r);
  trx := r -> 'data' ->> 'trx_no';

  select * into d from ops_acct.v_transaction_detail where trx_no = trx;
  assert d.billed_currency = 'USD' and d.billed_amount = 26.64, 'billed kept, upper-cased';
  assert d.lines -> 0 ->> 'kind' = 'item' and d.lines -> 1 ->> 'kind' = 'fee', format('kinds in the detail, got %s', d.lines);
  assert (d.lines -> 0 ->> 'id') is not null, 'lines carry their id';

  -- edit: change, refuse, clear
  r := ops_acct.edit_transaction(trx, p_billed_amount => 25);
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'billed_amount' = '25', format('amount alone when a currency is set, got %s', r);
  r := ops_acct.edit_transaction(trx, p_billed_currency => 'EUR');
  assert r ->> 'outcome' = 'ok', format('currency alone keeps the amount, got %s', r);
  assert (select billed_currency || ' ' || billed_amount from ops_acct.transactions where trx_no = trx) = 'EUR 25', 'EUR 25';
  r := ops_acct.edit_transaction(trx, p_billed_currency => 'IDR');
  assert r -> 'error' ->> 'code' = 'billed_currency', format('got %s', r);
  r := ops_acct.edit_transaction(trx, p_billed_currency => '');
  assert r ->> 'outcome' = 'ok', format('clear, got %s', r);
  assert (select billed_currency is null and billed_amount is null from ops_acct.transactions where trx_no = trx), 'cleared';
  r := ops_acct.edit_transaction(trx, p_billed_amount => 25);
  assert r -> 'error' ->> 'code' = 'billed_together', format('amount without currency, got %s', r);
  r := ops_acct.edit_transaction(trx, p_billed_currency => '');
  assert r ->> 'outcome' = 'noop', format('clearing nothing is nothing, got %s', r);

  -- ── only item lines feed prices ──────────────────────────────────────
  r := ops_procure.item_purchases('I-7271');
  assert jsonb_array_length(r -> 'data') = 1, format('one purchase row, got %s', r);
  assert r -> 'data' -> 0 ->> 'unit_price' = '125000', 'the listed price, not the voucher';
end $$;

-- the trail carries the bill as one readable value
set local role postgres;
do $$
declare a record;
begin
  select * into a from ops_core.audit_log
   where entity_no = (select trx_no from ops_acct.transactions where source_ref = 'kind-n8n')
     and action = 'edit' and outcome = 'ok' order by at asc limit 1;
  assert a.before ->> 'billed' = 'USD 26.64' and a.after ->> 'billed' = 'USD 25',
    format('the trail has USD 26.64 -> USD 25, got %s -> %s', a.before, a.after);
end $$;

rollback;
