-- core — a project's files: ten kinds, who made the file, a folder per client
-- and project (0216, 0217, P1).
--
-- DERIVATIONS  every new kind has a label and a drive (designs to DRAFTING, the
--              paper of a sale to PROJECT MANAGER); a project's file goes to
--              <client>/<project>/<task>; a quotation's to its project's; a
--              client's to <client>/00 UMUM; a project with only a typed client
--              name uses it; with none, TANPA KLIEN; an unknown record still
--              lands in TANPA KLIEN/TANPA PROYEK; a slash in a name never makes
--              a second folder; old kinds keep their folders; the route and the
--              row agree on the folder; origin is recorded and read back; a
--              file links to a client and to a quotation; the two-argument
--              calls of before still answer
-- REFUSALS     an origin nobody knows; an entity nothing is filed against;
--              still one signature per seam (00_no_overloads)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000b8001','sales-files@talaliving.com','{"full_name":"Sales"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000b8001','procurement','write');

insert into ops_procure.clients (id, code, name) values
  ('b8000000-0000-0000-0000-0000000000c1','CL-0901','PT Contoh / Residence');
insert into ops_procure.projects (id, code, name, client_id) values
  ('b8000000-0000-0000-0000-0000000000d1','26901','Residence Kuta','b8000000-0000-0000-0000-0000000000c1');
insert into ops_procure.projects (id, code, name, client_name) values
  ('b8000000-0000-0000-0000-0000000000d2','26902','Villa  Umalas','Bp. Hendra');
insert into ops_procure.projects (id, code, name) values
  ('b8000000-0000-0000-0000-0000000000d3','26903','Stok Showroom');
insert into ops_procure.quotations (id, quote_no, project_id) values
  ('b8000000-0000-0000-0000-0000000000e1','qt-26-10-06_91','b8000000-0000-0000-0000-0000000000d1');

-- Both drives reachable, as in production once IT records PROJECT MANAGER.
update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug)
 where slug in ('project','drafting');

do $$
declare missing text;
begin
  select string_agg(k, ', ') into missing
    from unnest(array['brief','foto_survei','gambar_klien','referensi_klien','moodboard',
                      'layout','render','proposal','notulen','kontrak']) k
   where not exists (select 1 from ops_core.doc_kind_labels l where l.kind::text = k)
      or not exists (select 1 from ops_core.doc_kind_drive d where d.kind::text = k);
  assert missing is null, 'every new kind has a label and a drive, missing: ' || coalesce(missing, '');

  assert (select slug from ops_core.doc_kind_drive where kind = 'render') = 'drafting', 'a render is the drafters''';
  assert (select slug from ops_core.doc_kind_drive where kind = 'gambar_klien') = 'drafting', 'a client drawing is the drafters''';
  assert (select slug from ops_core.doc_kind_drive where kind = 'kontrak') = 'project', 'a contract is the project''s';
  assert (select slug from ops_core.doc_kind_drive where kind = 'notulen') = 'project', 'meeting notes are the project''s';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000b8001';

do $$
declare r jsonb; a jsonb; v_id text; p text;
begin
  -- the folder, by record
  p := ops_core.drive_path_for_record('brief', 'project', '26901');
  assert p = 'CL-0901 PT CONTOH - RESIDENCE/26901 RESIDENCE KUTA/01 BRIEF & SURVEI',
    'a project''s brief, by client and project, got ' || p;
  p := ops_core.drive_path_for_record('proposal', 'quotation', 'qt-26-10-06_91');
  assert p = 'CL-0901 PT CONTOH - RESIDENCE/26901 RESIDENCE KUTA/03 PROPOSAL & PENAWARAN',
    'a quotation''s file goes to its project, got ' || p;
  p := ops_core.drive_path_for_record('kontrak', 'client', 'CL-0901');
  assert p = 'CL-0901 PT CONTOH - RESIDENCE/00 UMUM/05 KONTRAK', 'a client''s own file, got ' || p;
  p := ops_core.drive_path_for_record('render', 'project', '26902');
  assert p = 'BP. HENDRA/26902 VILLA UMALAS/00 KONSEP', 'a typed client name, one space, got ' || p;
  p := ops_core.drive_path_for_record('gambar_klien', 'project', '26903');
  assert p = 'TANPA KLIEN/26903 STOK SHOWROOM/00 DARI KLIEN', 'no client at all, got ' || p;
  p := ops_core.drive_path_for_record('moodboard', 'project', '99999');
  assert p = 'TANPA KLIEN/TANPA PROYEK/00 KONSEP', 'a record that is not there still lands somewhere, got ' || p;
  p := ops_core.drive_path_for_record('render', 'product', 'KS-001');
  assert p = 'TANPA KLIEN/TANPA PROYEK/00 KONSEP', 'a record with no client or project, got ' || p;
  assert ops_core.drive_path_for_record('foto', 'item', 'I-0001') = 'INVENTORY/ITEMS', 'old task folders unchanged';
  assert ops_core.drive_path_for_record('purchase_order', null, null) = 'PURCHASE ORDER', 'old kind folders unchanged';

  -- the route asks the same question
  r := ops_core.drive_folder_for('Client Drawing', 'project', '26901');
  assert r->>'outcome' = 'ok' and r->'data'->>'slug' = 'drafting'
     and r->'data'->>'path' = 'CL-0901 PT CONTOH - RESIDENCE/26901 RESIDENCE KUTA/00 DARI KLIEN',
    'the route reads the same folder, got ' || r::text;
  r := ops_core.drive_folder_for('Meeting Notes', 'quotation', 'qt-26-10-06_91');
  assert r->'data'->>'slug' = 'project' and r->'data'->>'path' like '%/04 MEETING', 'notes to PROJECT MANAGER, got ' || r::text;
  r := ops_core.drive_folder_for('Foto', 'item');
  assert r->'data'->>'path' = 'INVENTORY/ITEMS', 'two arguments still answer, got ' || r::text;
  r := ops_core.drive_folder_for('Render', 'meeting', '1');
  assert r->'error'->>'code' = 'unknown_entity', 'an entity nothing is filed against, got ' || r::text;

  -- the row agrees with the route, and says who made the file
  r := ops_core.attach_file('DRIVE_RENDER_1', 'sofa-render-b.jpg', 'image/jpeg', 1000, repeat('e', 64),
                            'web', null, 'render', 'project', 'https://drive.google.com/file/d/X/view',
                            'FOLDER_X', '26901', 'client');
  assert r->>'outcome' = 'ok', 'filed, got ' || r::text;
  v_id := r->'data'->>'attachment_id';
  select to_jsonb(x) into a from ops_core.v_attachment x where x.id = v_id;
  assert a->>'origin' = 'client', 'origin read back, got ' || a::text;
  assert a->>'filed_in' = 'DRAFTING / ops-talaliving / CL-0901 PT CONTOH - RESIDENCE/26901 RESIDENCE KUTA/00 KONSEP',
    'the row says where, got ' || coalesce(a->>'filed_in', 'null');

  r := ops_core.attach_file('DRIVE_RENDER_2', 'x.jpg', null, 10, null, 'web', null, 'render', 'project', null, null, '26901', 'Klien');
  assert r->'error'->>'code' = 'unknown_origin', 'an origin nobody knows, got ' || r::text;

  r := ops_core.attach_file('DRIVE_RENDER_3', 'y.jpg', null, 10, null, 'web', null, 'render', 'project', null, null, '26901', ' TALA ');
  assert r->>'outcome' = 'ok', 'origin is read case-blind, got ' || r::text;
  assert (select origin from ops_core.attachments where id = (r->'data'->>'attachment_id')::uuid) = 'tala', 'stored lower case';

  -- the positional call of before, with nothing to say about origin
  r := ops_core.attach_file('DRIVE_OLD', 'old.pdf', null, 10, null, 'web', null, 'purchase_order', null, null, null);
  assert r->>'outcome' = 'ok', 'the old eleven arguments still file, got ' || r::text;
  assert (select origin from ops_core.attachments where id = (r->'data'->>'attachment_id')::uuid) is null,
    'origin is never guessed';

  -- linked to the records a sale is made of
  r := ops_core.attach_link(v_id::uuid, 'quotation', 'qt-26-10-06_91', 'Render');
  assert r->>'outcome' = 'ok', 'a file on a quotation, got ' || r::text;
  r := ops_core.attach_link(v_id::uuid, 'client', 'CL-0901', 'render');
  assert r->>'outcome' = 'ok', 'a file on a client, got ' || r::text;
  assert (select count(*) from ops_core.v_attachment_link where attachment_id = v_id
           and entity in ('quotation','client') and kind = 'Render') = 2, 'both links read back by label';
end $$;

-- one signature each, open to a signed-in person
do $$
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_core' and p.proname in ('attach_file','drive_folder_for')) = 2,
    'one attach_file and one drive_folder_for (00_no_overloads)';
  assert has_function_privilege('authenticated',
    'ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
    'the new attach_file is open';
  assert has_function_privilege('authenticated', 'ops_core.drive_folder_for(text, text, text)', 'EXECUTE'),
    'the new drive_folder_for is open';
end $$;

rollback;
