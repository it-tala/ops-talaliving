-- 0036_core_drive_ops_folder.sql — the eight module folders, and letting the
-- application find its own `ops` inside each.
--
-- ── What the owner actually handed over ──────────────────────────────────
--
-- `0035` asked for the id of the `ops` folder in each shared drive. What
-- arrived (owner, 2026-09-21) were the ids of the **module folders
-- themselves** — PROCUREMENT, ACCOUNTING, HRD and five more — which is the
-- more useful thing to have been given, and is not the same thing.
--
-- Every id begins with `1`, so each is an ordinary folder rather than a shared
-- drive root (those begin with `0A`). And the note beside ACCOUNTING —
-- *"disini sudah ada folder TRANSACTIONS yang didapat dari user upload google
-- chat channel"* — says plainly what these are: containers that already hold
-- folders people made.
--
-- Recording one of them as the upload target would drop every file the system
-- writes straight in beside those, which is the exact thing the `ops` folder
-- was for.
--
-- ── So the two are stored apart, and the second fills itself in ──────────
--
-- `parent_folder_id` is the module folder: given once, by a person, from a URL
-- they can see. `folder_id` is the `ops` folder inside it, and **the upload
-- route fills it in the first time it files something there** — finding the
-- folder if somebody already made it, creating it if not.
--
-- Asking for eight more ids would have worked and would have been eight more
-- chances to paste the wrong one into a column that silently redirects
-- everything afterwards. A name is checkable; an id is not.
--
-- ── A new drive ─────────────────────────────────────────────────────────
--
-- IT, added by the owner in the same message. Nothing maps to it yet — it is
-- here so it can be pointed at rather than invented later.

insert into ops_core.drive_folders (slug, label, note) values
  ('it', 'IT', 'Added 2026-09-21. Nothing is filed here yet.')
on conflict (slug) do nothing;

alter table ops_core.drive_folders
  add column if not exists parent_folder_id text;

-- Granted alongside the columns `0035` listed. A column added without this is
-- a column nobody can write through PostgREST — including IT, from the screen
-- that exists to set it — and the refusal reads `permission denied for table`
-- rather than naming the policy, which sends somebody looking in the wrong
-- place entirely.
grant update (parent_folder_id) on ops_core.drive_folders to authenticated;

comment on column ops_core.drive_folders.parent_folder_id is
  'The module folder inside the shared drive — what a person can read off a Drive URL. Set '
  'by hand, once. (0036)';

comment on column ops_core.drive_folders.folder_id is
  'The `ops` folder inside parent_folder_id, where everything this application writes goes. '
  'Filled in automatically by /api/documents/upload the first time it files something, and '
  'changed thereafter only by IT — repointing it silently redirects every future upload. (0036)';

-- ── the eight, as given ──────────────────────────────────────────────────
--
-- Recorded verbatim. **Unverified**: the Drive connector available here cannot
-- see them — *Requested entity was not found* — which means either that its
-- identity is not a member of those drives or that an id is wrong. The first
-- upload to each will say which, by name, and that is a better check than any
-- assertion this file could make.

update ops_core.drive_folders set parent_folder_id = '16btMmcBqIDzEHLnT8cBJyTr7Mu6RnnIo', updated_at = now() where slug = 'procurement';
update ops_core.drive_folders set parent_folder_id = '1jBvEUZ1RT36QEe8bGFsGVJCVVthC1E-7', updated_at = now() where slug = 'accounting';
update ops_core.drive_folders set parent_folder_id = '1ae0Y9iLQFZZw-PT71m-ElhCF3mte3l7h', updated_at = now() where slug = 'backup';
update ops_core.drive_folders set parent_folder_id = '1KfLidSiE0LWp_cZeZ6eClWakpW5Odjom', updated_at = now() where slug = 'drafting';
update ops_core.drive_folders set parent_folder_id = '1qQzgoHOWqSs49EZNzHHoyJU0aK2v7X2J', updated_at = now() where slug = 'hrd';
update ops_core.drive_folders set parent_folder_id = '1BaRp9019P5E1jfBhXj5E8xkeJvtOx2uT', updated_at = now() where slug = 'production';
update ops_core.drive_folders set parent_folder_id = '1A4WaSSRzCgx8bjR5fe6eZd9N7nV2KDfo', updated_at = now() where slug = 'project';
update ops_core.drive_folders set parent_folder_id = '1N3M7iE3PTFNOfFPOvrhsF7pZtJ_apN4C', updated_at = now() where slug = 'it';

-- ── what the route asks now ──────────────────────────────────────────────
--
-- Answers both ids. A null `folder_id` is not a refusal any more — it means
-- *the `ops` folder has not been located yet*, and locating it is the route's
-- next step rather than a person's.
--
-- The refusal that remains is the one that still needs a human: no
-- `parent_folder_id` at all, because nothing but somebody with Drive open can
-- supply that.

create or replace function ops_core.drive_folder_for(p_kind text)
returns jsonb
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t; f record;
begin
  v_kind := ops_core.doc_kind_of(p_kind);
  if v_kind is null then
    return ops_core.invalid('documents','attachment', null,'file',
      'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;

  select d.slug, df.label, df.drive_id, df.folder_id, df.parent_folder_id
    into f
    from ops_core.doc_kind_drive d
    join ops_core.drive_folders df on df.slug = d.slug
   where d.kind = v_kind;

  if not found then
    return ops_core.invalid('documents','attachment', null,'file',
      'no_drive_for_kind',
      format('Nothing says which shared drive a %s belongs in.', v_kind),
      jsonb_build_object('field','kind','kind', v_kind));
  end if;

  if f.parent_folder_id is null and f.folder_id is null then
    return ops_core.invalid('documents','attachment', null,'file',
      'drive_not_configured',
      format('The %s shared drive has no folder recorded yet, so a %s cannot be filed. IT sets it in ops_core.drive_folders.',
             f.label, v_kind),
      jsonb_build_object('field','kind','slug', f.slug, 'label', f.label));
  end if;

  return ops_core.ok('documents','attachment', null,'file',
    jsonb_build_object('kind', v_kind, 'slug', f.slug, 'label', f.label,
                       'drive_id', f.drive_id,
                       'parent_folder_id', f.parent_folder_id,
                       -- Null means *not located yet*; the route finds or
                       -- creates it and calls `record_ops_folder` below.
                       'folder_id', f.folder_id));
end $$;

grant execute on function ops_core.drive_folder_for(text) to authenticated;

-- ── filling it in, once ──────────────────────────────────────────────────

/* The route's write-back, after it has found or created `ops` in Drive.
 *
 * **It only ever fills a blank.** A caller that could change a folder already
 * set would be a caller that could redirect every future upload for that drive
 * — including HRD's — from a browser, by being the next person to upload
 * anything. So the update is `where folder_id is null`, and a second call
 * answers `noop` with the id that is already there rather than overwriting it.
 *
 * `security definer` because the route runs as whoever is uploading, and
 * `drive_folders` is writable only by `it.admin` — correctly. This is the one
 * narrow write that is not a decision: the folder exists, and this is where its
 * id is written down.
 */
create or replace function ops_core.record_ops_folder(p_slug text, p_folder_id text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare f ops_core.drive_folders;
begin
  if coalesce(btrim(p_folder_id), '') = '' then
    return ops_core.invalid('documents','drive_folder', p_slug,'record_folder',
      'folder_required','A folder id is required.', jsonb_build_object('field','folder_id'));
  end if;

  select * into f from ops_core.drive_folders where slug = p_slug;
  if not found then
    return ops_core.not_found('documents','drive_folder', p_slug,'record_folder',
      format('There is no shared drive %s.', p_slug));
  end if;

  if f.folder_id is not null then
    -- Already located. Not an error and not an overwrite: two uploads racing
    -- on the first file of the day is exactly how this happens.
    return ops_core.noop('documents','drive_folder', p_slug,'record_folder',
      'already located', jsonb_build_object('slug', p_slug, 'folder_id', f.folder_id));
  end if;

  update ops_core.drive_folders
     set folder_id = btrim(p_folder_id), updated_at = now(), updated_by = auth.uid()
   where slug = p_slug and folder_id is null;

  return ops_core.ok('documents','drive_folder', p_slug,'record_folder',
    jsonb_build_object('slug', p_slug, 'folder_id', btrim(p_folder_id)),
    to_jsonb(f.folder_id),
    to_jsonb(btrim(p_folder_id)));
end $$;

grant execute on function ops_core.record_ops_folder(text, text) to authenticated;

comment on function ops_core.record_ops_folder(text, text) is
  'Writes down the `ops` folder id the upload route found or created. Fills a blank only — '
  'changing one that is set would let any uploader redirect a whole drive, so that stays '
  'it.admin. (0036)';

-- ── readiness, now in two stages ─────────────────────────────────────────

-- Dropped rather than replaced: `create or replace view` may add columns at
-- the end and may not rename one, and `has_folder` now sits after `has_parent`
-- because that is the order somebody reads them in — a person fills the first,
-- the route fills the second.
drop view if exists ops_core.v_drive_readiness;

create or replace view ops_core.v_drive_readiness as
  select df.slug, df.label,
         df.drive_id is not null         as has_drive,
         df.parent_folder_id is not null as has_parent,
         -- The `ops` folder itself. False is normal before the first upload:
         -- the route locates it, not a person.
         df.folder_id is not null        as has_folder,
         count(d.kind)                   as kinds,
         df.updated_at, df.note
    from ops_core.drive_folders df
    left join ops_core.doc_kind_drive d on d.slug = df.slug
   group by df.slug, df.label, df.drive_id, df.parent_folder_id, df.folder_id,
            df.updated_at, df.note;

alter view ops_core.v_drive_readiness set (security_invoker = on);
grant select on ops_core.v_drive_readiness to authenticated;

comment on view ops_core.v_drive_readiness is
  'Per shared drive: whether somebody has recorded the module folder (a person does this), '
  'whether the `ops` folder inside it has been located (the upload route does this on first '
  'use), and how many kinds of document are filed there. (0036)';
