-- procure — six boxes on every design item: progress and completeness read
-- from the work itself (0247, 0248, Studio Desain S1, D399–D405).
--
-- DERIVATIONS  every item has six rows in v_design_box, all kosong at first;
--              a file in a box fills it, and uploading again is the next
--              version (A, B) with the latest file, who and its note; a
--              version keeps its letter when an earlier one is taken off; a
--              specification is versioned and fills its box; *not needed*
--              counts as filled with its optional note, and *needed again*
--              empties it; a file wins over *not needed*; a product made from
--              the item is inactive and fills the BOM box once it has a BOM,
--              and the first order line naming it makes it active; a DWG is
--              filed beside the item's PDF; v_design_project lists live
--              projects with their item count
-- REFUSALS     an empty specification (and the same text again is a no-op,
--              not a version); a box nobody knows; a second product for the
--              same item; a product from someone without production access;
--              somebody with neither sales nor production access (and they
--              read nothing)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c7001','drafter-boxes@talaliving.com','{"full_name":"Made Drafter"}'),
  ('aaaa0000-0000-0000-0000-0000000c7002','sales-boxes@talaliving.com','{"full_name":"Rina Sales"}'),
  ('aaaa0000-0000-0000-0000-0000000c7003','gudang-boxes@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c7001','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c7002','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c7003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('c7000000-0000-0000-0000-0000000000c1','CL-0971','PT Contoh Kotak');
insert into ops_procure.projects (id, code, name, client_id) values
  ('c7000000-0000-0000-0000-0000000000d1','26971','Villa Kotak','c7000000-0000-0000-0000-0000000000c1');

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug) where slug = 'drafting';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c7001';

do $$
declare r jsonb; v jsonb; a1 text; a2 text; a3 text; l1 uuid;
begin
  -- the drafter builds the tree and an item, from the Design screen
  assert exists (select 1 from ops_procure.v_design_project where project_code = '26971' and client_code = 'CL-0971'),
    'a live project is offered to the drafter';
  perform ops_procure.save_design_collection('26971', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26971', 'A', 'LR', 'Living room');
  r := ops_procure.save_design_item('26971', 'A', 'LR', 'Sofa 3 dudukan', 2, 'tala', 2200, 950, 820);
  assert r->'data'->>'item_no' = '26971-A-LR-01', 'item: ' || r::text;
  assert (select item_count from ops_procure.v_design_project where project_code = '26971') = 1, 'the project counts it';

  assert (select count(*) from ops_procure.v_design_box where item_no = '26971-A-LR-01') = 6, 'six boxes';
  assert (select count(*) from ops_procure.v_design_box where item_no = '26971-A-LR-01' and state = 'kosong') = 6,
    'all empty at first';

  -- a file fills its box; uploading again is the next version
  r := ops_core.attach_file('DRV_PDF_A', 'sofa.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja', 'design_item',
                            null, null, '26971-A-LR-01', 'tala');
  a1 := r->'data'->>'attachment_id';
  r := ops_core.attach_link(a1::uuid, 'design_item', '26971-A-LR-01', 'Gambar Kerja', null, null);
  assert ops_core.said_ok(r), 'pdf A: ' || r::text;
  l1 := (r->'data'->>'link_id')::uuid;
  r := ops_core.attach_file('DRV_PDF_B', 'sofa-v2.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja', 'design_item',
                            null, null, '26971-A-LR-01', 'tala');
  a2 := r->'data'->>'attachment_id';
  r := ops_core.attach_link(a2::uuid, 'design_item', '26971-A-LR-01', 'Gambar Kerja', 'Sandaran turun ke 78 cm', null);
  assert ops_core.said_ok(r), 'pdf B: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_design_box x where item_no = '26971-A-LR-01' and box = 'pdf';
  assert v->>'state' = 'terisi' and v->>'latest_label' = 'B' and (v->>'versions')::int = 2
     and v->>'latest_filename' = 'sofa-v2.pdf' and v->>'latest_note' = 'Sandaran turun ke 78 cm'
     and v->>'latest_by' = 'Made Drafter',
    'the latest version is B, with its note: ' || v::text;

  -- taking A off keeps B its letter
  r := ops_core.attach_unlink(l1, null);
  assert ops_core.said_ok(r), 'unlink A: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_design_box x where item_no = '26971-A-LR-01' and box = 'pdf';
  assert v->>'latest_label' = 'B' and (v->>'versions')::int = 1, 'B stays B: ' || v::text;

  -- the DWG has its own box, and its folder is the item's
  assert ops_core.drive_path_for_record('dwg', 'design_item', '26971-A-LR-01')
       = ops_core.drive_path_for_record('gambar_kerja', 'design_item', '26971-A-LR-01'),
    'a DWG is filed beside the PDF, got ' || ops_core.drive_path_for_record('dwg', 'design_item', '26971-A-LR-01');
  r := ops_core.attach_file('DRV_DWG_A', 'sofa.dwg', 'application/acad', 100, null, 'web', null, 'dwg', 'design_item',
                            null, null, '26971-A-LR-01', 'tala');
  a3 := r->'data'->>'attachment_id';
  assert (select drive_slug from ops_core.attachments where id = a3::uuid) = 'drafting', 'a DWG is filed in DRAFTING';
  r := ops_core.attach_link(a3::uuid, 'design_item', '26971-A-LR-01', 'DWG', null, null);
  assert ops_core.said_ok(r), 'dwg: ' || r::text;
  assert (select state || '/' || latest_label from ops_procure.v_design_box where item_no = '26971-A-LR-01' and box = 'dwg')
       = 'terisi/A', 'the DWG fills its own box';

  -- the specification, versioned
  r := ops_procure.save_design_spec('26971-A-LR-01', '  ');
  assert r->'error'->>'code' = 'spec_empty', 'an empty specification is not a version: ' || r::text;
  r := ops_procure.save_design_spec('26971-A-LR-01', 'Rangka mahoni · busa D32');
  assert ops_core.said_ok(r) and (r->'data'->>'version')::int = 1, 'spec 1: ' || r::text;
  r := ops_procure.save_design_spec('26971-A-LR-01', 'Rangka mahoni · busa D32');
  assert r->>'outcome' = 'noop', 'the same text again is not a version: ' || r::text;
  r := ops_procure.save_design_spec('26971-A-LR-01', 'Rangka mahoni · busa D32 · kain linen', 'kain dari klien');
  assert (r->'data'->>'version')::int = 2, 'spec 2: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_design_box x where item_no = '26971-A-LR-01' and box = 'spec';
  assert v->>'state' = 'terisi' and v->>'latest_label' = '2' and v->>'spec_body' like '%kain linen'
     and v->>'latest_note' = 'kain dari klien', 'the spec box shows version 2: ' || v::text;

  -- the history: both PDFs (A taken off, still listed), and both specs
  assert (select string_agg(label || ':' || removed::text, ',' order by ordinal)
            from ops_procure.v_design_box_version where item_no = '26971-A-LR-01' and box = 'pdf') = 'A:true,B:false',
    'the PDF history keeps A as removed';
  assert (select string_agg(label, ',' order by ordinal)
            from ops_procure.v_design_box_version where item_no = '26971-A-LR-01' and box = 'spec') = '1,2',
    'the spec history';

  -- not needed, optional note; needed again; a file wins
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'sketsa', true);
  assert r->'error'->>'code' = 'unknown_box', 'a known box: ' || r::text;
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'render', true);
  assert ops_core.said_ok(r), 'render not needed, no note: ' || r::text;
  assert (select state from ops_procure.v_design_box where item_no = '26971-A-LR-01' and box = 'render') = 'tidak_perlu',
    'not needed reads';
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'render', true);
  assert r->>'outcome' = 'noop', 'twice is a no-op: ' || r::text;
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'render', false);
  assert ops_core.said_ok(r) and (select state from ops_procure.v_design_box
                                   where item_no = '26971-A-LR-01' and box = 'render') = 'kosong', 'needed again';
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'foto', true, 'Foto setelah produksi');
  assert (select skip_note from ops_procure.v_design_box where item_no = '26971-A-LR-01' and box = 'foto')
       = 'Foto setelah produksi', 'the note is kept';
  assert (select count(*) from ops_procure.design_box_skips) = 3, 'every change is a row';

  -- a product, for the quotation, before any order (D400)
  r := ops_procure.product_from_design_item('26971-A-LR-01');
  assert ops_core.said_ok(r) and r->'data'->>'product_code' = '26971-A-LR-01', 'product: ' || r::text;
  assert (select not active and design_item_no = '26971-A-LR-01' and length_mm = 2200 and uom = 'pcs'
            from ops_prod.products where product_code = '26971-A-LR-01'), 'inactive, from the item';
  r := ops_procure.product_from_design_item('26971-A-LR-01', 'SOFA-X');
  assert r->'error'->>'code' = 'already_product', 'one product per item: ' || r::text;
  assert (select state from ops_procure.v_design_box where item_no = '26971-A-LR-01' and box = 'bom') = 'kosong',
    'a product with no BOM yet is still an empty box';
end $$;

-- the BOM fills the box; an order line activates the product
reset role;
insert into ops_prod.bom_revisions (product_id, rev)
  select id, 1 from ops_prod.products where product_code = '26971-A-LR-01';
set local role authenticated;
do $$
begin
  assert (select state || '/' || coalesce(latest_label, '-') from ops_procure.v_design_box
           where item_no = '26971-A-LR-01' and box = 'bom') in ('terisi/1'),
    'a BOM revision fills the box: ' || (select to_jsonb(x)::text from ops_procure.v_design_box x
                                         where item_no = '26971-A-LR-01' and box = 'bom');
  assert (select count(*) filter (where state <> 'kosong') from ops_procure.v_design_box
           where item_no = '26971-A-LR-01') = 5, 'five of six: pdf, dwg, spec, foto (not needed), bom';
end $$;
reset role;
insert into ops_procure.project_lines (project_id, line_no, product_code, description, qty, uom, design_item_id)
  select 'c7000000-0000-0000-0000-0000000000d1', 1, '26971-A-LR-01', 'Sofa', 2, 'pcs', id
    from ops_procure.design_items where item_no = '26971-A-LR-01';
do $$
begin
  assert (select active from ops_prod.products where product_code = '26971-A-LR-01'), 'ordered: active now';
end $$;
set local role authenticated;

-- sales design too, but a product needs production
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c7002';
do $$
declare r jsonb;
begin
  r := ops_procure.save_design_item('26971', 'A', 'LR', 'Coffee table', 1, 'adapted');
  assert r->'data'->>'item_no' = '26971-A-LR-02', 'sales adds an item: ' || r::text;
  r := ops_procure.save_design_spec('26971-A-LR-02', 'Top travertine');
  assert ops_core.said_ok(r), 'and a spec: ' || r::text;
  r := ops_procure.product_from_design_item('26971-A-LR-02');
  assert r->'error'->>'code' = 'not_permitted', 'a product needs production: ' || r::text;
  assert (select count(*) from ops_procure.v_design_box where project_code = '26971') = 12, 'and reads every box';
end $$;

-- somebody with neither
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c7003';
do $$
declare r jsonb;
begin
  r := ops_procure.save_design_spec('26971-A-LR-01', 'Diam-diam');
  assert r->'error'->>'code' = 'not_permitted', 'outsider spec: ' || r::text;
  r := ops_procure.set_design_box_skip('26971-A-LR-01', 'pdf', true);
  assert r->'error'->>'code' = 'not_permitted', 'outsider skip: ' || r::text;
  assert (select count(*) from ops_procure.v_design_box) = 0, 'outsider reads no box';
  assert (select count(*) from ops_procure.v_design_project) = 0, 'and no project';
end $$;

rollback;
