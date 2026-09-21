-- core — which shared drive a document goes to, and the rule that survived
-- the move from two drives to seven.
--
-- The owner's arrangement (2026-09-21) is an `ops` folder inside each module's
-- existing shared drive, so people and the system open the same files side by
-- side. The cost is that the personal-data boundary is no longer *a different
-- drive with a different membership list* — it is a row in
-- `ops_core.doc_kind_drive`, consulted at the moment of upload.
--
-- So that row is what this file guards:
--
--   * every kind of document resolves to a drive — none falls through
--   * every personal kind resolves to HRD, without exception
--   * a folder nobody has configured refuses, and says which drive and why
--   * a kind nobody has heard of refuses rather than defaulting anywhere
--   * the label and the code both resolve (`doc_kind_of`, 0034)
--
-- The upload itself is not testable here and is not meant to be: it is a
-- `fetch` to Google from a Worker. What is testable is every decision made
-- before the bytes move, which is all of them.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000001717','it@talaliving.com',  '{"full_name":"IT"}'),
  ('aaaa0000-0000-0000-0000-000000000d1d','proc@talaliving.com','{"full_name":"Procurement"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000001717','it','admin'),
  ('aaaa0000-0000-0000-0000-000000000d1d','procurement','write');

/* ── nothing falls through ─────────────────────────────────────────────── */

do $$
declare v_missing text; n int;
begin
  -- The same assertion the migration makes, kept here too: a kind added later
  -- with no row would resolve to nowhere, and the most likely nowhere is
  -- whichever folder the code happened to default to.
  select string_agg(e.enumlabel, ', ') into v_missing
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'doc_kind_t'
     and not exists (select 1 from ops_core.doc_kind_drive d where d.kind::text = e.enumlabel);
  assert v_missing is null, format('these kinds have no drive: %s', v_missing);

  -- And every drive a kind points at has to exist, which the foreign key
  -- guarantees — asserted anyway, because the count is the thing a person
  -- reads when they ask whether this is set up.
  select count(*) into n from ops_core.doc_kind_drive;
  assert n = 25, format('every kind is mapped, got %s', n);
end $$;

/* ── the boundary that had to survive the move ─────────────────────────── */

do $$
declare v_strays text;
begin
  -- Eleven kinds are personal data. Every one goes to HRD, and this is the
  -- assertion that would fail if somebody "tidied" the mapping.
  select string_agg(kind::text || '→' || slug, ', ') into v_strays
    from ops_core.doc_kind_drive
   where kind in ('ktp','kartu_keluarga','ijazah','cv','kontrak_kerja','npwp','bpjs',
                  'surat_dokter','surat_lembur','laporan_lembur','surat_peringatan')
     and slug <> 'hrd';
  assert v_strays is null,
    format('personal documents must be filed in HRD and these are not: %s', v_strays);
end $$;

/* ── REFUSAL: a folder nobody has configured ───────────────────────────── */

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000d1d';

do $$
declare r jsonb;
begin
  -- Nothing is configured in a fresh ladder, which is correct: `drive_id` and
  -- `folder_id` are facts about somebody's Google Workspace, and a migration
  -- that invented them would ship a wrong answer.
  r := ops_core.drive_folder_for('nota');
  assert r ->> 'outcome' = 'refused', format('an unconfigured drive refuses, got %s', r);
  assert r -> 'error' ->> 'code' = 'drive_not_configured', format('got %s', r);
  -- And it names the drive and the remedy, because "upload failed" sends
  -- somebody to IT with nothing to say.
  assert r -> 'error' ->> 'message' like '%ACCOUNTING%',
    format('it names the drive, got %s', r -> 'error' ->> 'message');
  assert r -> 'error' ->> 'message' like '%drive_folders%',
    format('and where to set it, got %s', r -> 'error' ->> 'message');
end $$;

/* ── REFUSAL: a kind nobody has heard of ───────────────────────────────── */

do $$
declare r jsonb;
begin
  r := ops_core.drive_folder_for('Bukti Transfer');
  assert r -> 'error' ->> 'code' = 'unknown_kind', format('got %s', r);
  -- Deliberately *before* the folder lookup: an unknown kind has no drive to
  -- be unconfigured, and answering `drive_not_configured` would send somebody
  -- to fix the wrong thing.
  assert r -> 'error' ->> 'message' not like '%shared drive has no%',
    format('and not as a configuration problem, got %s', r -> 'error' ->> 'message');
end $$;

/* ── once IT fills it in ───────────────────────────────────────────────── */

set local role postgres;
update ops_core.drive_folders
   set drive_id = '0AD_hrd_example', folder_id = '1hrd_ops_example'
 where slug = 'hrd';
update ops_core.drive_folders
   set drive_id = '0AD_proc_example', folder_id = '1proc_ops_example'
 where slug = 'procurement';
set local role authenticated;

do $$
declare r jsonb;
begin
  r := ops_core.drive_folder_for('ktp');
  assert ops_core.said_ok(r), format('a configured drive resolves, got %s', r);
  assert r -> 'data' ->> 'slug' = 'hrd', format('a KTP goes to HRD, got %s', r -> 'data');
  assert r -> 'data' ->> 'folder_id' = '1hrd_ops_example', 'and names the ops folder';

  -- The label works as well as the code, because that is what every screen
  -- passes (`DocKind` is the label). `0034` made that one definition.
  r := ops_core.drive_folder_for('Receiving Item');
  assert ops_core.said_ok(r), format('the label resolves, got %s', r);
  assert r -> 'data' ->> 'slug' = 'procurement',
    format('a goods photo goes to PROCUREMENT, got %s', r -> 'data');

  -- Accounting is still unset, and still says so rather than falling back to
  -- a drive that happens to be ready.
  r := ops_core.drive_folder_for('nota');
  assert r -> 'error' ->> 'code' = 'drive_not_configured',
    format('one configured drive is not all of them, got %s', r);
end $$;

/* ── what /it reads ────────────────────────────────────────────────────── */

do $$
declare r record; n int;
begin
  select count(*) into n from ops_core.v_drive_readiness;
  assert n = 7, format('seven shared drives, got %s', n);

  select * into r from ops_core.v_drive_readiness where slug = 'hrd';
  assert r.has_folder, 'HRD is ready';
  assert r.kinds = 11, format('and takes eleven kinds of document, got %s', r.kinds);

  select * into r from ops_core.v_drive_readiness where slug = 'backup';
  assert not r.has_folder, 'BACKUP has no folder';
  -- And that is not a fault: it is deliberately empty (owner, 2026-09-18), so
  -- nothing maps to it and nothing will fail for want of it.
  assert r.kinds = 0, format('nothing is filed there, got %s', r.kinds);
end $$;

/* ── REFUSAL: pointing a folder somewhere else is IT's ─────────────────── */

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000d1d';
do $$
declare n int;
begin
  -- Procurement holds `procurement.write` and no `it.admin`. Repointing a
  -- folder silently redirects every future upload, including HRD's.
  update ops_core.drive_folders set folder_id = '1somewhere_else' where slug = 'hrd';
  get diagnostics n = row_count;
  assert n = 0, 'only IT repoints a shared drive folder';
end $$;

do $$
declare f text;
begin
  select folder_id into f from ops_core.drive_folders where slug = 'hrd';
  assert f = '1hrd_ops_example', format('and it did not move, got %s', f);
end $$;

rollback;
