-- 0035_core_drive_folders.sql — which shared drive a file goes to, decided
-- when it is uploaded.
--
-- ── The owner's answer, 2026-09-21 ───────────────────────────────────────
--
--   *pakai folder ops di tiap module shared drive*
--
-- and the reason, given earlier the same week:
--
--   *saya ingin membuat manusia dan sistem bisa membuka file berdampingan.
--    jadi kalau ini module HRD maka harus di simpan di HRD shared drive.
--    mungkin daripada langsung ke shared drive nya buat saja folder seperti
--    "ops" di tiap module*
--
-- This **supersedes** the two-drive proposal in `docs/plan/phase-2/05-storage.md`
-- (Evidence / People, split by sensitivity). That draft was mine, not the
-- owner's, and it optimised for one thing — the access boundary — at the cost
-- of the thing the business actually does, which is open a file next to the
-- work it belongs to. Seven shared drives already exist and people already use
-- them. A system that files somewhere else creates a second place to look.
--
-- The `ops` subfolder is what keeps the two apart inside one drive: everything
-- this application writes lands there, and nothing a person filed by hand does.
--
-- ── What is lost, and how it is paid for ─────────────────────────────────
--
-- The two-drive split had one real virtue: it made *personal data versus
-- business evidence* a rule in code rather than a habit. Seven drives is seven
-- membership lists, and more people can see more folders.
--
-- So the rule survives, moved: **the drive is chosen from the kind of document,
-- by the database, at the moment of upload.** A KTP resolves to the HRD drive
-- and there is no argument to any function that would send it elsewhere. That
-- is the sensitivity-at-upload decision the owner asked for, and it is why
-- `upload` now carries the kind — it used to take only a filename and a size,
-- which is not enough to know where a file belongs.
--
-- ── Drives, not modules ──────────────────────────────────────────────────
--
-- Keyed by a slug of its own rather than by `module_t`, because the two do not
-- line up and pretending otherwise would bend one of them. There is a DRAFTING
-- shared drive and no drafting module; there are `payroll`, `inventory`,
-- `marketing`, `it` and `settings` modules with no drive of their own. Modelled
-- as what exists.

create table ops_core.drive_folders (
  slug       text primary key,
  label      text not null,
  -- Google's id for the shared drive, and for the `ops` folder inside it.
  -- **Both start null**: they are facts about somebody's Google Workspace, not
  -- about this schema, and a migration that invented them would be a migration
  -- that ships a wrong answer. IT fills them in once, and
  -- `v_drive_readiness` says which are still missing.
  drive_id   text,
  folder_id  text,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references ops_core.users(id)
);

insert into ops_core.drive_folders (slug, label, note) values
  ('hrd',         'HRD',             'Personal data. The one drive whose membership is the narrowest.'),
  ('procurement', 'PROCUREMENT',     'Requests, orders, receiving, and what stands behind them.'),
  ('production',  'PRODUCTION',      'Work orders and what happened on the floor.'),
  ('drafting',    'DRAFTING',        'Working drawings and finished drawings.'),
  ('accounting',  'ACCOUNTING',      'Money: notas, transfer proofs, bank statements.'),
  ('project',     'PROJECT MANAGER', 'Per-project documents — handover, installation, delivery.'),
  ('backup',      'BACKUP',          'Deliberately empty for now (owner, 2026-09-18).')
on conflict (slug) do nothing;

alter table ops_core.drive_folders enable row level security;

-- Readable by anybody signed in: a screen has to be able to say *filed in
-- PROCUREMENT* without holding `it.read`. Writable only by IT, because pointing
-- a folder somewhere else silently redirects every future upload.
create policy drive_folders_read on ops_core.drive_folders
  for select to authenticated using (true);
create policy drive_folders_write on ops_core.drive_folders
  for update to authenticated using (ops_core.has_permission('it.admin'));

grant select on ops_core.drive_folders to authenticated;
grant update (drive_id, folder_id, note, updated_at, updated_by)
  on ops_core.drive_folders to authenticated;

comment on table ops_core.drive_folders is
  'The `ops` folder inside each of the seven shared drives (owner, 2026-09-21). drive_id and '
  'folder_id are null until IT fills them in — they are facts about Google Workspace, not about '
  'this schema. Everything the application writes goes in `ops`; nothing a person filed by hand '
  'does, so the two can be read side by side. (0035)';

-- ── the kind decides the drive ───────────────────────────────────────────
--
-- A table rather than a `case` inside a function, for two reasons. It can be
-- corrected without a migration, by the people who know which drive a `foto`
-- belongs in better than this file does. And it can be *read* — a screen can
-- say where a document will be filed before somebody uploads it, which is the
-- difference between a rule and a surprise.
--
-- Several of these are judgement calls and are marked as such. An `invoice` is
-- a bill somebody has to pay, so it goes with the money; a `quotation` is what
-- a request was built from, so it goes with the request. `other` goes to
-- procurement because that is where the exception road already runs, and it is
-- the row most likely to be corrected.

create table ops_core.doc_kind_drive (
  kind       ops_core.doc_kind_t primary key,
  slug       text not null references ops_core.drive_folders(slug),
  -- Why, where it is not obvious. Read by nobody; written for whoever asks.
  rationale  text
);

insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  -- Money.
  ('nota',            'accounting',  null),
  ('transfer_proof',  'accounting',  null),
  ('rekening_koran',  'accounting',  null),
  ('invoice',         'accounting',  'A bill somebody has to pay goes with the money.'),
  -- Buying and receiving.
  ('purchase_order',  'procurement', null),
  ('quotation',       'procurement', 'What a request was built from (D125).'),
  ('goods_photo',     'procurement', null),
  ('delivery_note',   'procurement', null),
  ('surat_jalan',     'procurement', 'The vendor''s own delivery paper.'),
  ('other',           'procurement', 'The exception road already runs here — and this is the row most likely to be corrected.'),
  ('foto',            'procurement', 'Judgement call: a photograph with no stated purpose.'),
  ('sertifikat',      'procurement', 'Judgement call: material certificates arrive with goods.'),
  -- Drawings.
  ('gambar_kerja',    'drafting',    null),
  ('gambar_jadi',     'drafting',    null),
  -- People. Every one of these, without exception.
  ('ktp',             'hrd', null),
  ('kartu_keluarga',  'hrd', null),
  ('ijazah',          'hrd', null),
  ('cv',              'hrd', null),
  ('kontrak_kerja',   'hrd', null),
  ('npwp',            'hrd', null),
  ('bpjs',            'hrd', null),
  ('surat_dokter',    'hrd', null),
  ('surat_lembur',    'hrd', null),
  ('laporan_lembur',  'hrd', null),
  ('surat_peringatan','hrd', null)
on conflict (kind) do nothing;

alter table ops_core.doc_kind_drive enable row level security;
create policy doc_kind_drive_read on ops_core.doc_kind_drive
  for select to authenticated using (true);
create policy doc_kind_drive_write on ops_core.doc_kind_drive
  for update to authenticated using (ops_core.has_permission('it.admin'));
grant select on ops_core.doc_kind_drive to authenticated;
grant update (slug, rationale) on ops_core.doc_kind_drive to authenticated;

comment on table ops_core.doc_kind_drive is
  'Which shared drive each kind of document is filed in. This is where the personal-data '
  'boundary lives now that there are seven drives rather than two: a KTP resolves to HRD and '
  'no argument to any function can send it elsewhere. (0035)';

-- **Every kind must resolve.** A kind added later with no row here would fall
-- through to *nowhere*, and the most likely nowhere is whichever folder the
-- code happened to default to. A constraint cannot span two tables, so it is
-- asserted at the end of the ladder and again in the smoke file.
do $$
declare v_missing text;
begin
  select string_agg(e.enumlabel, ', ') into v_missing
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'doc_kind_t'
     and not exists (select 1 from ops_core.doc_kind_drive d
                      where d.kind::text = e.enumlabel);
  if v_missing is not null then
    raise exception 'every doc kind needs a drive; these have none: %', v_missing;
  end if;
end $$;

-- ── what the upload route asks ───────────────────────────────────────────

/* Where does a file of this kind go, and is that folder ready?
 *
 * Returns the envelope rather than a bare id, so the one thing a person can
 * actually act on — *nobody has told the system where the HRD drive's `ops`
 * folder is* — reaches them as a sentence instead of a null. The upload route
 * has no business inventing that message; it does not know which drives exist.
 */
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

  select d.slug, df.label, df.drive_id, df.folder_id
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

  if f.folder_id is null then
    return ops_core.invalid('documents','attachment', null,'file',
      'drive_not_configured',
      format('The %s shared drive has no `ops` folder recorded yet, so a %s cannot be filed. IT sets it in ops_core.drive_folders.',
             f.label, v_kind),
      jsonb_build_object('field','kind','slug', f.slug, 'label', f.label));
  end if;

  return ops_core.ok('documents','attachment', null,'file',
    jsonb_build_object('kind', v_kind, 'slug', f.slug, 'label', f.label,
                       'drive_id', f.drive_id, 'folder_id', f.folder_id));
end $$;

grant execute on function ops_core.drive_folder_for(text) to authenticated;

-- ── is this deployment able to file anything at all ──────────────────────
--
-- Read by `/it` so the answer to *why can nobody upload* is a screen rather
-- than an afternoon. Counts kinds, not drives: BACKUP is deliberately empty
-- (owner, 2026-09-18) and having no folder is not a fault there.

create or replace view ops_core.v_drive_readiness as
  select df.slug, df.label,
         df.drive_id is not null  as has_drive,
         df.folder_id is not null as has_folder,
         count(d.kind)            as kinds,
         df.updated_at, df.note
    from ops_core.drive_folders df
    left join ops_core.doc_kind_drive d on d.slug = df.slug
   group by df.slug, df.label, df.drive_id, df.folder_id, df.updated_at, df.note;

alter view ops_core.v_drive_readiness set (security_invoker = on);
grant select on ops_core.v_drive_readiness to authenticated;

comment on view ops_core.v_drive_readiness is
  'Which shared drives have their `ops` folder recorded, and how many kinds of document each '
  'one takes. A drive with kinds and no folder cannot file them. (0035)';
