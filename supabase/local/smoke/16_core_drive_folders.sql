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
  -- 26 since `0101` added the receiving report.
  assert n = 26, format('every kind is mapped, got %s', n);
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
  -- `0036` recorded the eight module folders the owner gave, so the drives
  -- resolve — with `folder_id` still null, meaning *the `ops` folder has not
  -- been located yet*. That is the route's job, not a person's.
  r := ops_core.drive_folder_for('nota');
  assert ops_core.said_ok(r), format('a drive with a parent folder resolves, got %s', r);
  assert r -> 'data' ->> 'parent_folder_id' is not null, 'the module folder is recorded';
  assert r -> 'data' ->> 'folder_id' is null,
    format('and `ops` is not located yet, got %s', r -> 'data' ->> 'folder_id');
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

-- The route's write-back, after it has found or created `ops` in Drive. Run as
-- an ordinary uploader on purpose: `drive_folders` is `it.admin` to write, and
-- this narrow `security definer` fill is the exception.
do $$
declare r jsonb;
begin
  r := ops_core.record_ops_folder('hrd', '1hrd_ops_example');
  assert ops_core.said_ok(r), format('the route writes down what it found, got %s', r);

  -- **Only ever fills a blank.** A caller that could change a folder already
  -- set could redirect every future upload for that drive — HRD's included —
  -- just by being the next person to upload anything.
  r := ops_core.record_ops_folder('hrd', '1somewhere_else');
  assert r ->> 'outcome' = 'noop', format('a second call changes nothing, got %s', r);
  assert r -> 'data' ->> 'folder_id' = '1hrd_ops_example',
    format('and answers the id that is there, got %s', r -> 'data');

  r := ops_core.record_ops_folder('procurement', '1proc_ops_example');
  assert ops_core.said_ok(r), format('got %s', r);

  r := ops_core.record_ops_folder('nosuchdrive', '1x');
  assert r -> 'error' ->> 'code' = 'not_found', format('got %s', r);
end $$;

do $$
declare r jsonb;
begin
  r := ops_core.drive_folder_for('ktp');
  assert ops_core.said_ok(r), format('a located drive resolves, got %s', r);
  assert r -> 'data' ->> 'slug' = 'hrd', format('a KTP goes to HRD, got %s', r -> 'data');
  assert r -> 'data' ->> 'folder_id' = '1hrd_ops_example', 'and names the ops folder';

  -- The label works as well as the code, because that is what every screen
  -- passes (`DocKind` is the label). `0034` made that one definition.
  r := ops_core.drive_folder_for('Receiving Item');
  assert ops_core.said_ok(r), format('the label resolves, got %s', r);
  assert r -> 'data' ->> 'slug' = 'procurement',
    format('a goods photo goes to PROCUREMENT, got %s', r -> 'data');

  -- Accounting's `ops` is still not located, and it answers that rather than
  -- borrowing a folder from a drive that happens to be ready.
  r := ops_core.drive_folder_for('nota');
  assert r -> 'data' ->> 'folder_id' is null,
    format('one located drive is not all of them, got %s', r -> 'data');
  assert r -> 'data' ->> 'slug' = 'accounting', 'and it is still the right drive';
end $$;

/* ── what /it reads ────────────────────────────────────────────────────── */

do $$
declare r record; n int;
begin
  select count(*) into n from ops_core.v_drive_readiness;
  assert n = 8, format('eight shared drives — IT was added 2026-09-21, got %s', n);

  select * into r from ops_core.v_drive_readiness where slug = 'hrd';
  assert r.has_folder, 'HRD is ready';
  assert r.kinds = 11, format('and takes eleven kinds of document, got %s', r.kinds);

  select * into r from ops_core.v_drive_readiness where slug = 'backup';
  assert r.has_parent, 'BACKUP has a module folder';
  assert not r.has_folder, 'and no `ops` inside it yet';
  -- Which is not a fault: it is deliberately empty (owner, 2026-09-18), so
  -- nothing maps to it and nothing will ever go looking.
  assert r.kinds = 0, format('nothing is filed there, got %s', r.kinds);

  -- Every drive the owner named has its module folder recorded.
  select count(*) into n from ops_core.v_drive_readiness where not has_parent;
  assert n = 0, format('%s drives still have no module folder', n);
end $$;

/* ── REFUSAL: pointing a folder somewhere else is IT's ─────────────────── */

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000d1d';
do $$
declare n int;
begin
  -- Procurement holds `procurement.write` and no `it.admin`. Repointing a
  -- folder silently redirects every future upload, including HRD's.
  update ops_core.drive_folders set parent_folder_id = '1somewhere_else' where slug = 'hrd';
  get diagnostics n = row_count;
  assert n = 0, 'only IT repoints a shared drive folder';
end $$;

do $$
declare f text;
begin
  select parent_folder_id into f from ops_core.drive_folders where slug = 'hrd';
  assert f = '1qQzgoHOWqSs49EZNzHHoyJU0aK2v7X2J', format('and it did not move, got %s', f);
end $$;

rollback;
