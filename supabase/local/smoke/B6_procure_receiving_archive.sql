-- procure — a matched Chat photo is filed into ops-talaliving / RECEIVING
-- REPORT / <YYYY-MM> / <YYYY-MM-DD> (0204, D360).
--
--   REFUSALS     planning or recording without procurement write; a row not
--                matched yet; a file from another message; no Drive file or
--                folder named; a link that is not Drive's
--   DERIVATIONS  every receiving kind resolves to the month tree, by the day
--                given or else today; the plan lists only the files a record
--                uses, under the kind they were used as and the day the
--                message was sent; recording a copy moves every live link to
--                it (old unlinked, never deleted) and the row remembers the
--                capture; a second recording is a no-op and the plan is empty

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b6000000-0000-0000-0000-0000000000a1','buyer-arc@talaliving.com','{"full_name":"Pembeli Arsip"}'),
  ('b6000000-0000-0000-0000-0000000000a4','view-arc@talaliving.com','{"full_name":"Lihat Arsip"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('b6000000-0000-0000-0000-0000000000a1','procurement','write'),
  ('b6000000-0000-0000-0000-0000000000a4','procurement','read');

insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by)
values ('trx-b6-out', date '2026-09-30', (select id from ops_acct.accounts where code = 'BCA 271'), 'OUT',
        250000, 'SUPPLIERS', 'Beli lakban', 'smoke-b6-out', 'b6000000-0000-0000-0000-0000000000a1');

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

/* ── 1. the month tree ─────────────────────────────────────────────────── */
do $$
begin
  assert ops_core.drive_path_for('goods_photo', null, date '2026-09-30') = 'RECEIVING REPORT/2026-09/2026-09-30',
    format('got %s', ops_core.drive_path_for('goods_photo', null, date '2026-09-30'));
  assert ops_core.drive_path_for('receiving_report', null, date '2026-10-02') = 'RECEIVING REPORT/2026-10/2026-10-02',
    'the signed sheet in the same tree';
  assert ops_core.drive_path_for('delivery_note', null)
       = 'RECEIVING REPORT/' || to_char(ops_core.office_day(), 'YYYY-MM') || '/' || to_char(ops_core.office_day(), 'YYYY-MM-DD'),
    'no day: today, as an upload has always been filed';
  assert ops_core.drive_path_for('foto', 'item') = 'INVENTORY/ITEMS', 'other kinds untouched';
end $$;

/* ── 2. a message, matched to a transaction ───────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_procure.file_receiving('ev-b6-1',
         '[{"url":"https://drive.google.com/file/d/CHATFILE000000000001/view","filename":"barang.jpg","source_ref":"b1","mime":"image/jpeg"},
           {"url":"https://drive.google.com/file/d/CHATFILE000000000002/view","filename":"sheet.jpg","source_ref":"b2","mime":"image/jpeg"},
           {"url":"https://drive.google.com/file/d/CHATFILE000000000003/view","filename":"lain.jpg","source_ref":"b3","mime":"image/jpeg"}]'::jsonb,
         'Lakban 10', 'buyer-arc@talaliving.com', timestamptz '2026-09-30 10:00+07');
  assert ops_core.said_ok(r), format('%s', r);
  insert into t_ctx values ('rr', r->'data'->>'rr_no');
  r := ops_procure.file_receiving('ev-b6-2',
         '[{"url":"https://drive.google.com/file/d/CHATFILE000000000009/view","filename":"x.jpg","source_ref":"b9"}]'::jsonb,
         'belum dicocokkan', 'buyer-arc@talaliving.com');
  insert into t_ctx values ('rr_open', r->'data'->>'rr_no');
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';

do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr'); fa uuid; fb uuid; fc uuid;
begin
  select (files->0->>'attachment_id')::uuid, (files->1->>'attachment_id')::uuid, (files->2->>'attachment_id')::uuid
    into fa, fb, fc from ops_procure.v_receiving_inbox where rr_no = rr;
  insert into t_ctx values ('fa', fa::text), ('fb', fb::text), ('fc', fc::text);

  r := ops_procure.receiving_archive_plan((select v from t_ctx where k = 'rr_open'));
  assert r->'error'->>'code' = 'not_matched', format('open rows are not filed: %s', r);

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b6-out', array[fa], array[fb]);
  assert ops_core.said_ok(r), format('%s', r);

  r := ops_procure.receiving_archive_plan(rr);
  assert ops_core.said_ok(r), format('%s', r);
  assert r->'data'->>'day' = '2026-09-30', format('the day it was sent: %s', r);
  assert jsonb_array_length(r->'data'->'files') = 2, format('the unused third file is not copied: %s', r);
  assert (select f->>'path' from jsonb_array_elements(r->'data'->'files') f where (f->>'attachment_id')::uuid = fa)
       = 'RECEIVING REPORT/2026-09/2026-09-30', format('%s', r);
  assert (select f->>'kind' from jsonb_array_elements(r->'data'->'files') f where (f->>'attachment_id')::uuid = fb)
       = 'receiving_report', format('filed as what it was used for: %s', r);
end $$;

/* ── 3. who may record ─────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a4';
do $$
declare r jsonb;
begin
  r := ops_procure.receiving_archive_plan((select v from t_ctx where k = 'rr'));
  assert r->'error'->>'code' = 'not_permitted', format('%s', r);
  r := ops_procure.receiving_file_archived((select v from t_ctx where k = 'rr'), (select v::uuid from t_ctx where k = 'fa'),
         'COPY0000000000000001', null, 'FOLDER01', 'RECEIVING REPORT/2026-09/2026-09-30');
  assert r->'error'->>'code' = 'not_permitted', format('%s', r);
end $$;

/* ── 4. recording the copy ────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr');
        fa uuid := (select v::uuid from t_ctx where k = 'fa'); new_id uuid; vf jsonb;
begin
  r := ops_procure.receiving_file_archived(rr, gen_random_uuid(), 'COPY0000000000000001', null, 'FOLDER01', 'P');
  assert r->'error'->>'code' = 'file_not_on_report', format('%s', r);
  r := ops_procure.receiving_file_archived(rr, fa, '', null, 'FOLDER01', 'P');
  assert r->'error'->>'code' = 'drive_file_required', format('%s', r);
  r := ops_procure.receiving_file_archived(rr, fa, 'COPY0000000000000001', 'https://evil.example/x', 'FOLDER01', 'P');
  assert r->'error'->>'code' = 'not_a_drive_link', format('%s', r);
  r := ops_procure.receiving_file_archived((select v from t_ctx where k = 'rr_open'), fa, 'COPY0000000000000001', null, 'FOLDER01', 'P');
  assert r->'error'->>'code' = 'not_matched', format('%s', r);

  r := ops_procure.receiving_file_archived(rr, fa, 'COPY0000000000000001',
         'https://drive.google.com/file/d/COPY0000000000000001/view', 'FOLDER01',
         'RECEIVING REPORT/2026-09/2026-09-30', 1234);
  assert ops_core.said_ok(r) and (r->'data'->>'links_moved')::int = 1, format('%s', r);
  new_id := (r->'data'->>'attachment_id')::uuid;

  assert (select attachment_id from ops_core.attachment_links
           where entity = 'transaction' and entity_no = 'trx-b6-out' and kind = 'goods_photo' and unlinked_at is null) = new_id,
    'the ledger row''s item photo is now the copy';
  assert (select count(*) from ops_core.attachment_links
           where attachment_id = fa and unlinked_at is not null and unlinked_by is not null) = 1,
    'the capture''s link was unlinked, by somebody, not deleted';
  assert (select storage_path || '|' || drive_slug || '|' || drive_path from ops_core.attachments where id = new_id)
       = 'COPY0000000000000001|procurement|RECEIVING REPORT/2026-09/2026-09-30', 'the copy is an uploaded file, in procurement';

  select f into vf from ops_procure.v_receiving_inbox i, jsonb_array_elements(i.files) f
   where i.rr_no = rr and (f->>'attachment_id')::uuid = new_id;
  assert (vf->>'archived')::boolean and vf->>'drive_path' = 'RECEIVING REPORT/2026-09/2026-09-30'
     and vf->>'url' like 'https://drive.google.com/file/d/COPY%', format('the screen sees it filed: %s', vf);

  r := ops_procure.receiving_file_archived(rr, fa, 'COPY0000000000000002', null, 'FOLDER01', 'P');
  assert r->>'outcome' = 'noop', format('a second copy of the same capture is not recorded: %s', r);

  r := ops_procure.receiving_archive_plan(rr);
  assert jsonb_array_length(r->'data'->'files') = 1, format('only the sheet is left to copy: %s', r);
end $$;

/* ── 5. a receipt / nota, and a fuller inventory line (D360) ─────────────── */
reset role;
insert into ops_procure.item_categories (code, name) values ('arc-uji','Bahan arsip (uji)') on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('arc-uji') on conflict do nothing;
insert into ops_procure.items (code, name, category_code, base_uom) values ('ITM-ARC1','Lakban uji','arc-uji','lembar');
do $$
declare r jsonb;
begin
  r := ops_procure.file_receiving('ev-b6-3',
         '[{"url":"https://drive.google.com/file/d/CHATFILE000000000031/view","filename":"nota.jpg","source_ref":"b31"},
           {"url":"https://drive.google.com/file/d/CHATFILE000000000032/view","filename":"tv.jpg","source_ref":"b32"}]'::jsonb,
         'Nota TV + lakban', 'buyer-arc@talaliving.com', timestamptz '2026-09-29 15:00+07');
  insert into t_ctx values ('rr3', r->'data'->>'rr_no');
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr3'); fn uuid; ft uuid; a record;
begin
  select (files->0->>'attachment_id')::uuid, (files->1->>'attachment_id')::uuid into fn, ft
    from ops_procure.v_receiving_inbox where rr_no = rr;

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b6-out', array[fn], p_notas => array[fn]);
  assert r->'error'->>'code' = 'file_twice', format('one file is one thing: %s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b6-out', '{}'::uuid[], '{}'::uuid[],
         '[{"kind":"material","item_code":"ITM-ARC1","qty":3,"unit_cost":0}]', p_notas => array[fn]);
  assert r->'error'->>'code' = 'cost_not_positive', format('a price is above zero or empty: %s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b6-out', '{}'::uuid[], '{}'::uuid[],
         '[{"kind":"asset","name":"TV","category_code":"computer","location":"RUANG ANTAH"}]', p_notas => array[fn]);
  assert r->'error'->>'code' = 'location_unknown', format('a place on the list: %s', r);

  -- Only the nota as evidence, a priced material and a full asset.
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b6-out', '{}'::uuid[], '{}'::uuid[],
         '[{"kind":"material","item_code":"ITM-ARC1","qty":3,"unit_cost":12500},
           {"kind":"asset","name":"TV 43 inch","category_code":"computer","brand":"LG","location":"gudang","holder":"Kantor bawah","unit_cost":4200000}]',
         null, null, array[fn]);
  assert ops_core.said_ok(r) and (r->'data'->>'notas')::int = 1, format('nota only is enough: %s', r);
  assert (select count(*) from ops_core.attachment_links
           where entity = 'transaction' and entity_no = 'trx-b6-out' and kind = 'nota' and attachment_id = fn
             and unlinked_at is null) = 1, 'the nota is the ledger row''s Receipt / Nota';

  r := ops_procure.receiving_archive_plan(rr);
  assert jsonb_array_length(r->'data'->'files') = 1
     and r->'data'->'files'->0->>'kind' = 'nota' and r->'data'->'files'->0->>'path' = 'NOTA',
    format('a nota is filed where every nota is (the unused tv photo is not): %s', r);
end $$;
reset role;
do $$
declare a record; m record; rr text := (select v from t_ctx where k = 'rr3');
begin
  select * into a from ops_inv.assets where trx_no = 'trx-b6-out' and name = 'TV 43 inch';
  assert a.brand = 'LG' and a.location = 'GUDANG' and a.holder = 'Kantor bawah' and a.purchase_cost = 4200000,
    format('the asset carries brand, place (resolved to its code) and holder: %s', to_jsonb(a));
  select * into m from ops_inv.stock_moves where ref_no = rr and item_code = 'ITM-ARC1';
  assert m.qty = 3 and m.unit_cost = 12500, format('the rack knows the price: %s', to_jsonb(m));
end $$;

rollback;
