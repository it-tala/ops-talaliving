-- 05_evidence.sql — the documents behind the money.
--
-- 237 rows in `public.transaction_docs`, each naming a transaction and a Google
-- Drive link. They become attachments and the links that claim what those
-- attachments evidence.
--
-- ── 237 rows, 148 files, and the difference is the point ────────────────
--
-- Only **148 of the links are distinct**: 28 files are cited by more than one
-- transaction. That is not duplication to clean up — it is how this business
-- pays. `guide.pay_line` says it in the words the office uses: *satu bukti
-- transfer boleh menutup beberapa pembelian*.
--
-- So the import creates **148 attachments and 237 links**, and the separation
-- is the whole reason `ops_core` has two tables. An attachment is a file. A
-- link is a claim about what that file evidences. Writing one attachment per
-- doc row would produce 89 copies of files that are the same file, and destroy
-- the fact that one transfer covered five purchases — which is exactly the
-- question somebody asks when a vendor says they were not paid.
--
-- ── Where the file's identity comes from ────────────────────────────────
--
-- `transaction_docs` carries a link and nothing else: no name, no checksum, no
-- size. `public.blobs` carries all three, and **all 237 rows join exactly one
-- blob on `drive_link`** — measured, not hoped. So the join is on the link
-- itself rather than on `event_id`, which fans out: 63 events have more than
-- one blob and one has eleven.
--
-- `filename` is `not null` and Drive did not give one, so it is built the way
-- the live capture pipeline already builds it — `<drive_file_id>.<ext>`, from
-- the blob's own mime type. That is not inventing a fact about the file: it is
-- the file's own identity, spelled the way the 38 attachments already in this
-- database spell it.
--
-- ── The gap this import has to compensate for ───────────────────────────
--
-- **`ops_core.attachments` has no unique key on `url` or `sha256`.** Nothing in
-- the schema stops the same Drive file existing twice under two ids, and there
-- are now two writers: this import, and `ops_acct.file_evidence()` — the live
-- capture door, which has already produced 38 attachments from
-- `ledger_review_queue` and is still working through the queue.
--
-- None of those 38 is one of these 148 today, checked rather than assumed. But
-- *today* is not a guarantee, so every attachment here resolves against an
-- existing `url` first and only creates one when there is none. That is a
-- compensation, not a fix: the fix is a constraint, and adding one would change
-- how `file_evidence()` behaves on a retry — a decision that belongs in a
-- migration with its own reasoning, not in an import. Named in `README.md` as
-- open.
--
-- ── 175 of 237 have no document type ────────────────────────────────────
--
-- `attachment_links.kind` is `not null`, so they are filed `Others` — which is
-- what the new system already calls a document nobody classified, and is a
-- real label in `doc_kind_labels` rather than a placeholder. The same trade as
-- the ten typeless transactions in `03_ledger.sql`, and recorded the same way:
-- each one noted in the map, so *which ones* stays answerable.
--
-- The 62 that do have a type need no mapping at all. `Payment Proof`,
-- `Receipt / Invoice / Nota` and `Others` are `ops_core.doc_kind_labels`
-- verbatim — the new vocabulary was written from the old one.
--
-- ── What this does not import ───────────────────────────────────────────
--
-- **982 transactions carry a `drive_link` of their own and have no
-- `transaction_docs` row.** 702 of them have a blob behind that link and 280
-- have nothing but the URL — no name, no checksum, no type, no size.
--
-- They are left alone, deliberately. Two reasons. The evidence for most of them
-- is already moving through `ops_acct.evidence_inbox`, where a person looks at
-- each one and files it — and an import racing that pipeline would have them
-- both arrive at the same file from different directions. And a row built from
-- a bare URL is an attachment that claims a document exists while knowing
-- nothing about it, which is worse than no row: it looks filed.
--
-- Counted at the bottom so it is a number somebody can act on rather than a
-- silence.

\set ON_ERROR_STOP on
\timing off

begin;

create temp table _run on commit drop as
  select gen_random_uuid() as run_id;

create temp table _fallback_actor on commit drop as
  select id from ops_core.users where email = 'shared@talaliving.com';

do $$
begin
  if not exists (select 1 from _fallback_actor) then
    raise exception
      'shared@talaliving.com is not in ops_core.users. Every document whose uploader the old '
      'system did not record needs a name, and picking one by accident puts a false name on '
      'evidence.';
  end if;
end $$;

/* ── the files ───────────────────────────────────────────────────────────
 *
 * One row per blob that a `transaction_docs` row points at, which is 148 of the
 * 1.442 blobs in the old system. The rest are not transaction evidence and are
 * not this file's business.
 */
create temp table _files on commit drop as
select distinct on (b.blob_id)
       b.blob_id,
       b.drive_link,
       b.drive_file_id,
       b.sha256,
       b.mime_type,
       b.size_bytes,
       b.duplicate_suspect,
       b.drive_file_id || case b.mime_type
         when 'application/pdf' then '.pdf'
         when 'image/jpeg'      then '.jpg'
         when 'image/png'       then '.png'
         when 'image/webp'      then '.webp'
         else '' end                                as filename,
       coalesce(u.id, (select id from _fallback_actor)) as uploaded_by,
       (u.id is null)                               as uploader_borrowed,
       b.created_at,
       /* An attachment for this file may already exist — the live capture door
          writes them too. Resolved here rather than inserted blindly. */
       (select a.id from ops_core.attachments a where a.url = b.drive_link limit 1) as existing_id
  from public.blobs b
  join public.transaction_docs d on d.drive_link = b.drive_link
  left join public.raw_events e on e.event_id = b.event_id
  left join public.chat_users cu on cu.user_id = e.sender
  left join ops_core.users u on u.email = cu.email
 where not exists (
   select 1 from ops_core.legacy_map m
    where m.source_table = 'public.blobs' and m.source_id = b.blob_id::text)
   /* **At least one of the documents citing it has to land.** A file whose
      only mention is on a transaction `03_ledger.sql` refused would arrive as
      an attachment with nothing linked to it — a document the system claims to
      hold and nothing points at. That is noise at best and, on an evidence
      screen, a row that reads as filed.

      Any one is enough: a transfer proof covering five purchases where four
      imported is still that proof. */
   and exists (
     select 1 from public.transaction_docs d2
      join ops_acct.transactions t2 on t2.trx_no = d2.trx_id
     where d2.drive_link = b.drive_link);

insert into ops_core.attachments
  (url, filename, sha256, mime, bytes, source, uploaded_by, uploaded_at)
select f.drive_link, f.filename, f.sha256, f.mime_type, f.size_bytes,
       'import', f.uploaded_by, f.created_at
  from _files f
 where f.existing_id is null;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.blobs', f.blob_id::text, 'ops_core.attachments',
       coalesce(f.existing_id, a.id),
       'imported',
       nullif(concat_ws('; ',
         case when f.existing_id is not null
              then 'this file was already filed by the capture pipeline — linked, not duplicated' end,
         case when f.uploader_borrowed
              then 'no uploader in the legacy row — recorded as shared@talaliving.com' end,
         case when f.sha256 is null then 'no checksum in the legacy row' end,
         case when f.duplicate_suspect then 'the old system marked this a possible duplicate' end
       ), ''),
       (select run_id from _run)
  from _files f
  left join ops_core.attachments a on a.url = f.drive_link
 on conflict (source_table, source_id) do nothing;

/* ── the claims ──────────────────────────────────────────────────────────
 *
 * One per `transaction_docs` row. Several may point at one attachment, which is
 * the arrangement this table exists for.
 */
create temp table _links on commit drop as
select d.doc_id,
       d.trx_id,
       t.id                                      as trx_uuid,
       m.target_id                               as attachment_id,
       coalesce(ops_core.doc_kind_of(d.doc_type), 'other'::ops_core.doc_kind_t) as kind,
       d.doc_type,
       nullif(btrim(d.caption), '')              as caption,
       f.uploaded_by,
       d.created_at,
       case
         when t.id is null
           then 'transaction ' || d.trx_id || ' was not imported — see its own row in this map'
         when m.target_id is null
           then 'the file behind this document was not imported'
       end                                       as refused_because
  from public.transaction_docs d
  left join ops_acct.transactions t on t.trx_no = d.trx_id
  left join public.blobs b on b.drive_link = d.drive_link
  left join ops_core.legacy_map m on m.source_table = 'public.blobs'
                                 and m.source_id = b.blob_id::text
  left join _files f on f.blob_id = b.blob_id
 where not exists (
   select 1 from ops_core.legacy_map lm
    where lm.source_table = 'public.transaction_docs' and lm.source_id = d.doc_id::text);

insert into ops_core.attachment_links
  (attachment_id, entity, entity_no, kind, note, linked_by, linked_at)
select l.attachment_id, 'transaction'::ops_core.link_entity_t, l.trx_id, l.kind,
       l.caption,
       coalesce(l.uploaded_by, (select id from _fallback_actor)),
       l.created_at
  from _links l
 where l.refused_because is null
 on conflict do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.transaction_docs', l.doc_id::text, 'ops_core.attachment_links', k.id,
       case when l.refused_because is null then 'imported' else 'refused' end,
       coalesce(l.refused_because, nullif(concat_ws('; ',
         case when coalesce(btrim(l.doc_type), '') = ''
              then 'no document type in the legacy row — filed as Others, which is '
                   'indistinguishable on screen from one somebody chose' end,
         case when l.caption is null then 'no caption' end
       ), '')),
       (select run_id from _run)
  from _links l
  left join ops_core.attachment_links k
         on k.attachment_id = l.attachment_id
        and k.entity = 'transaction' and k.entity_no = l.trx_id and k.kind = l.kind
 on conflict (source_table, source_id) do nothing;

\echo ''
\echo '── what came across ────────────────────────────────────────────────'
select (select count(*) from ops_core.attachments where source = 'import')   as files,
       (select count(*) from ops_core.attachment_links)                      as claims,
       (select count(distinct entity_no) from ops_core.attachment_links)     as transactions_evidenced,
       (select count(*) from ops_core.attachments where source = 'import' and sha256 is null) as no_checksum;

\echo ''
\echo '── one file, several transactions ──────────────────────────────────'
select a.filename, count(*) as transactions
  from ops_core.attachment_links k
  join ops_core.attachments a on a.id = k.attachment_id
 group by a.filename having count(*) > 1
 order by 2 desc, 1 limit 10;

\echo ''
\echo '── what kind of document ───────────────────────────────────────────'
select kind::text, count(*) from ops_core.attachment_links group by 1 order by 2 desc;

\echo ''
\echo '── refused, and why ────────────────────────────────────────────────'
select regexp_replace(note, 'trx-[0-9-]+_[0-9]+', 'trx-…', 'g') as reason, count(*)
  from ops_core.legacy_map
 where source_table = 'public.transaction_docs' and outcome = 'refused'
 group by 1 order by 2 desc;

/* ── what is still out there ─────────────────────────────────────────────
 *
 * A number rather than a silence. These are transactions whose only evidence is
 * a URL on the transaction row itself, with no `transaction_docs` entry — the
 * ones the capture pipeline is working through, and the ones nobody has a file
 * for beyond a link.
 */
\echo ''
\echo '── transactions with a link this file did not import ───────────────'
select count(*) filter (where has_blob)     as have_a_file_behind_the_link,
       count(*) filter (where not has_blob) as nothing_but_a_url
  from (
    select t.trx_id,
           exists (select 1 from public.blobs b where b.event_id = t.event_id) as has_blob
      from public.transactions t
     where coalesce(t.drive_link, '') <> ''
       and not exists (select 1 from public.transaction_docs d where d.trx_id = t.trx_id)
     group by t.trx_id, t.event_id) x;

commit;
