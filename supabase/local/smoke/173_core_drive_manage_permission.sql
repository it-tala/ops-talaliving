-- core — the drive-choosing tables are writable by IT admin, and only by IT
-- admin (0173, D314, F166).
--
-- `0035` guarded both with `it.admin`, which is not in `permission_catalog`, so
-- the UPDATE touched nothing for anybody — and an UPDATE hidden by RLS does not
-- raise (F163). Every assertion here is therefore on the row count, never on
-- the absence of an error.
--
--   * IT at `admin` repoints a drive's OPS folder and moves a kind to a drive
--   * IT at `write` does neither: `it.update` is not enough for the boundary
--   * procurement does neither
--   * `drive_paths` (0172) stays on `it.update`, deliberately

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000001731','it-admin@talaliving.com','{"full_name":"IT admin"}'),
  ('aaaa0000-0000-0000-0000-000000001732','it-write@talaliving.com','{"full_name":"IT write"}'),
  ('aaaa0000-0000-0000-0000-000000001733','proc@talaliving.com',    '{"full_name":"Procurement"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000001731','it','admin'),
  ('aaaa0000-0000-0000-0000-000000001732','it','write'),
  ('aaaa0000-0000-0000-0000-000000001733','procurement','write');

/* ── the verb exists, and is admin's ───────────────────────────────────── */

do $$
declare a boolean;
begin
  select admin_only into a from ops_core.permission_catalog
   where module = 'it' and action = 'manage_drives';
  assert a, format('it.manage_drives is in the catalogue and admin-only, got %s', a);
  -- The permission 0035 named is still not a thing, so nothing may use it.
  assert not exists (select 1 from pg_policies
                      where schemaname = 'ops_core'
                        and (qual like '%it.admin%' or with_check like '%it.admin%')),
    'no policy tests the permission that does not exist';
end $$;

set local role authenticated;

/* ── REFUSAL: procurement ──────────────────────────────────────────────── */

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000001733';
do $$
declare n int;
begin
  update ops_core.drive_folders set parent_folder_id = '1somewhere_else' where slug = 'hrd';
  get diagnostics n = row_count;
  assert n = 0, format('procurement does not repoint a drive, touched %s', n);

  update ops_core.doc_kind_drive set slug = 'procurement' where kind = 'ktp';
  get diagnostics n = row_count;
  assert n = 0, format('procurement does not move a KTP out of HRD, touched %s', n);
end $$;

/* ── REFUSAL: IT at write — the boundary is admin's ────────────────────── */

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000001732';
do $$
declare n int;
begin
  assert ops_core.has_permission('it.update'), 'IT at write holds it.update';
  assert not ops_core.has_permission('it.manage_drives'), 'and not it.manage_drives';

  update ops_core.drive_folders set parent_folder_id = '1somewhere_else' where slug = 'hrd';
  get diagnostics n = row_count;
  assert n = 0, format('it.update does not repoint a drive, touched %s', n);

  update ops_core.doc_kind_drive set slug = 'procurement' where kind = 'ktp';
  get diagnostics n = row_count;
  assert n = 0, format('it.update does not move a KTP, touched %s', n);

  -- The task folder under OPS is an IT chore and stays one (0172).
  update ops_core.drive_paths set note = 'checked' where kind = 'foto' and entity = 'item';
  get diagnostics n = row_count;
  assert n = 1, format('it.update still corrects a task folder, touched %s', n);
end $$;

/* ── nothing moved ─────────────────────────────────────────────────────── */

do $$
declare f text; s text;
begin
  select parent_folder_id into f from ops_core.drive_folders where slug = 'hrd';
  assert f = '1qQzgoHOWqSs49EZNzHHoyJU0aK2v7X2J', format('HRD did not move, got %s', f);
  select slug into s from ops_core.doc_kind_drive where kind = 'ktp';
  assert s = 'hrd', format('a KTP still goes to HRD, got %s', s);
end $$;

/* ── IT admin corrects both ────────────────────────────────────────────── */

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000001731';
do $$
declare n int; f text; s text; r jsonb;
begin
  assert ops_core.has_permission('it.manage_drives'), 'IT admin holds it.manage_drives';

  update ops_core.drive_folders
     set parent_folder_id = '1corrected_ops', updated_at = now(), updated_by = auth.uid()
   where slug = 'procurement';
  get diagnostics n = row_count;
  assert n = 1, format('IT admin repoints a drive folder, touched %s', n);

  -- `other` is the row 0035 said was most likely to be corrected.
  update ops_core.doc_kind_drive set slug = 'accounting' where kind = 'other';
  get diagnostics n = row_count;
  assert n = 1, format('IT admin moves a kind to another drive, touched %s', n);

  select parent_folder_id into f from ops_core.drive_folders where slug = 'procurement';
  assert f = '1corrected_ops', format('and the folder is the new one, got %s', f);
  select slug into s from ops_core.doc_kind_drive where kind = 'other';
  assert s = 'accounting', format('and the kind resolves there, got %s', s);

  r := ops_core.drive_folder_for('other');
  assert r -> 'data' ->> 'slug' = 'accounting',
    format('the upload route follows the correction, got %s', r);
end $$;

rollback;
