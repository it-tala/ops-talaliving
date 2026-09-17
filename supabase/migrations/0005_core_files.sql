-- 0005_core_files.sql — evidence: a file **or a link**, attached from the
-- record it belongs to.
--
-- The main road (ADR-010, D91): somebody opens the PR line or the ledger row
-- and attaches the file *there*, so the link is declared rather than inferred
-- from a filename. Many-to-many from the start — one nota covering four lines
-- is the normal case, not the exception — and every link records **who** said
-- so, which is the column that answers "why is this file on this row".
--
-- A link is first-class evidence (D125): a marketplace page is not a file, and
-- photographing the screen loses the address somebody else can open.

create table ops_core.attachments (
  id                uuid primary key default gen_random_uuid(),
  -- One of these two is set, never both: `storage_path` for an uploaded file,
  -- `url` for a link.
  storage_path      text,
  url               text,
  filename          text not null,
  -- Advisory duplicate detection only. Identical bytes are a warning on the
  -- screen, never a refusal (A6).
  sha256            text,
  mime              text,
  bytes             bigint,
  source            text not null default 'web' check (source in ('web','chat','api','import')),
  uploaded_by       uuid not null references ops_core.users(id),
  uploaded_at       timestamptz not null default now(),
  constraint file_or_link check (
    (storage_path is not null and url is null) or
    (storage_path is null and url is not null))
);

create index attachments_sha_idx on ops_core.attachments (sha256) where sha256 is not null;

create table ops_core.attachment_links (
  id             uuid primary key default gen_random_uuid(),
  attachment_id  uuid not null references ops_core.attachments(id) on delete restrict,
  entity         ops_core.link_entity_t not null,
  -- The public code again, never a uuid (ADR-004): `pr-26-09-11_03`,
  -- `trx-26-09-10_014`. It survives a service being split out.
  entity_no      text not null,
  kind           ops_core.doc_kind_t not null,
  note           text,
  linked_by      uuid not null references ops_core.users(id),
  linked_at      timestamptz not null default now(),
  -- Unlinking is this, never a DELETE (A2, A5): the file stopped belonging to
  -- the row at a moment, and somebody decided that.
  unlinked_at    timestamptz,
  unlinked_by    uuid references ops_core.users(id),
  constraint unlink_has_who check (unlinked_at is null or unlinked_by is not null)
);

-- The same file on the same record twice is a no-op, not a second piece of
-- evidence — but a file unlinked in error may be attached again.
create unique index links_live_idx on ops_core.attachment_links (attachment_id, entity, entity_no, kind)
  where unlinked_at is null;

create index links_entity_idx on ops_core.attachment_links (entity, entity_no);

-- The label a screen prints, kept beside the code it stores. The demo carries
-- these as display strings ("Receipt / Invoice / Nota"); the database stores a
-- code, and this table is what keeps the two from drifting into two
-- vocabularies (see docs/plan/phase-2/01-schema.md).
create table ops_core.doc_kind_labels (
  kind  ops_core.doc_kind_t primary key,
  label text not null
);

insert into ops_core.doc_kind_labels (kind, label) values
  ('nota','Receipt / Invoice / Nota'),
  ('transfer_proof','Payment Proof'),
  ('goods_photo','Receiving Item'),
  ('delivery_note','Delivery Note'),
  ('purchase_order','Purchase Order'),
  ('quotation','Reference Link'),
  ('invoice','Invoice'),
  ('surat_jalan','Surat Jalan'),
  ('rekening_koran','Rekening Koran'),
  ('surat_dokter','Surat Dokter'),
  ('surat_lembur','Surat Lembur'),
  ('laporan_lembur','Laporan Lembur'),
  ('gambar_kerja','Gambar Kerja'),
  ('gambar_jadi','Gambar Jadi'),
  -- Berkas 201. The wording is the screen's; the code is what is stored, so
  -- renaming "Foto" to "Pas Foto" one day is a row here and not a migration.
  ('ktp','KTP'),
  ('kartu_keluarga','Kartu Keluarga'),
  ('ijazah','Ijazah'),
  ('cv','CV'),
  ('kontrak_kerja','Kontrak Kerja'),
  ('npwp','NPWP'),
  ('bpjs','BPJS'),
  ('foto','Foto'),
  ('sertifikat','Sertifikat'),
  ('surat_peringatan','Surat Peringatan'),
  ('other','Others');

-- Every kind has a label, checked here rather than hoped for. A kind the UI
-- cannot name renders as a blank chip, and the first person to notice is a
-- user rather than whoever added the enum value.
do $$
declare missing text;
begin
  select string_agg(e.enumlabel, ', ') into missing
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'ops_core' and t.typname = 'doc_kind_t'
     and not exists (select 1 from ops_core.doc_kind_labels l
                      where l.kind::text = e.enumlabel);
  if missing is not null then
    raise exception 'doc_kind_t has no label for: %', missing;
  end if;
end $$;

alter table ops_core.attachments       enable row level security;
alter table ops_core.attachment_links  enable row level security;
alter table ops_core.doc_kind_labels   enable row level security;

-- Anybody signed in may see that evidence exists and open it; the records it
-- hangs on are what carry the real access rules. Hiding the strip would make
-- every "is this paid for?" question unanswerable without a second screen.
create policy attachments_read on ops_core.attachments for select to authenticated using (true);
create policy links_read       on ops_core.attachment_links for select to authenticated using (true);
create policy kinds_read       on ops_core.doc_kind_labels for select to authenticated using (true);

create policy attachments_write on ops_core.attachments
  for insert to authenticated with check (uploaded_by = auth.uid());

-- A link is declared by the person looking at the record. Unlinking is an
-- update that stamps `unlinked_at`; there is no delete policy and DELETE is
-- not granted (A2, A5).
create policy links_write on ops_core.attachment_links
  for insert to authenticated with check (linked_by = auth.uid());
create policy links_unlink on ops_core.attachment_links
  for update to authenticated
  using (true) with check (unlinked_by = auth.uid());

grant select on ops_core.attachments, ops_core.attachment_links, ops_core.doc_kind_labels to authenticated;
grant insert on ops_core.attachments, ops_core.attachment_links to authenticated;
grant update (unlinked_at, unlinked_by) on ops_core.attachment_links to authenticated;
