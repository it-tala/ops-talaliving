-- 0173_core_drive_manage_permission.sql — the drive-choosing tables become
-- writable by somebody (F166, D314).
--
-- `0035` guarded `ops_core.drive_folders` and `ops_core.doc_kind_drive` with
-- `has_permission('it.admin')`. There is no `admin` action in
-- `permission_catalog` — the IT verbs are `read`, `update`, `manage_users`,
-- `manage_roles`, `purge_activity` — so `has_permission` joined to nothing and
-- answered false for everybody, an IT user at module level `admin` included.
-- The same silent shape `it.purge_activity` had before `0026` added its row:
-- no error, no refusal, an UPDATE that touches 0 rows (F163).
--
-- ── which permission, and why admin-only ─────────────────────────────────
--
-- A new action, `it.manage_drives`, reserved for `admin`, rather than
-- `it.update`:
--
--   * `doc_kind_drive` **is** the personal-data boundary now that there are
--     seven drives instead of two (`0035`): the row that says a KTP goes to
--     HRD. Moving it is a decision about who can see personal documents, the
--     same weight as `manage_roles`, not an edit.
--   * `drive_folders.parent_folder_id` repoints every future upload for a
--     drive — HRD's included — at a folder somebody else chose.
--
-- `it.update` comes with `write`, and `write` on IT is handed out for the
-- ordinary IT chores (`0027`'s activity-log corrections, `0118`'s calendar).
-- `0035`'s own intent was *admin*; this keeps the intent and spells it with a
-- verb that exists.
--
-- **`ops_core.drive_paths` (`0172`) stays on `it.update`, deliberately.** A
-- task folder only chooses *where under OPS* in a drive `doc_kind_drive`
-- already chose; it cannot move a file across the boundary. Correcting
-- `INVENTORY/ITEMS` is an IT chore, not a policy decision.
--
-- `record_ops_folder` (`0036`) is untouched: it is the security-definer
-- blank-fill the upload route uses, and it never needed a policy.

insert into ops_core.permission_catalog (module, action, admin_only) values
  ('it', 'manage_drives', true)
on conflict do nothing;

drop policy if exists drive_folders_write on ops_core.drive_folders;
create policy drive_folders_write on ops_core.drive_folders
  for update to authenticated
  using ((select ops_core.has_permission('it.manage_drives')))
  with check ((select ops_core.has_permission('it.manage_drives')));

drop policy if exists doc_kind_drive_write on ops_core.doc_kind_drive;
create policy doc_kind_drive_write on ops_core.doc_kind_drive
  for update to authenticated
  using ((select ops_core.has_permission('it.manage_drives')))
  with check ((select ops_core.has_permission('it.manage_drives')));

comment on function ops_core.record_ops_folder(text, text) is
  'Writes down the `ops` folder id the upload route found or created. Fills a blank only — '
  'changing one that is set would let any uploader redirect a whole drive, so that stays '
  'it.manage_drives (admin only, 0173). (0036)';
