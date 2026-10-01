-- 0204_procure_receiving_archive.sql — a matched Chat photo is filed into
-- PROCUREMENT / ops-talaliving / RECEIVING REPORT / <YYYY-MM> / <YYYY-MM-DD>
-- (D360).
--
-- The owner, 2026-10-01, after F208 found that the RECEIVING REPORT photos
-- stay in John Lau's own Drive folder and ops only links them: *kerjakan
-- (salin foto Chat ke ops-talaliving/RECEIVING REPORT saat dicocokkan),
-- pastikan aturan penataannya sesuai bulan seperti di akunting.* Accounting's
-- tree is `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` (D359, `0203_core_drive_
-- transactions`), with `drive_paths` reading `{YYYY-MM}` and `{YYYY-MM-DD}`.
--
-- ── 1. the month tree, for every receiving document ───────────────────────
--
-- The four receiving kinds (goods photo, receiving report, delivery note,
-- surat jalan) go to `RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}`. That is every
-- receiving document, not only the ones copied from Chat: one tree, whichever
-- road the file came by. The two files already uploaded to the folder's root
-- stay where they are.
--
-- **The day is the day it arrived, not the day it was filed.** `drive_path_
-- for` reads the office day, which is right for an upload (the photo is taken
-- now). A Chat photo matched three days later belongs to the day it was sent,
-- so the path takes an optional day. Without it, the office day, as before.
--
-- ── 2. the copy, recorded ─────────────────────────────────────────────────
--
-- The copy is made by the server (`/api/procurement/receiving/archive`): it
-- reads the Chat file with `drive.readonly`, writes it with `drive.file` into
-- the folder above, and calls `receiving_file_archived()`. Two seams:
--
--   * `receiving_archive_plan(rr_no)` — what to copy and where: each file of a
--     MATCHED row that is used by a record (a link to a transaction, receipt
--     or asset) and not copied yet, with its kind and the path for its day.
--     A file marked *Not used* is not copied: nothing points at it.
--   * `receiving_file_archived(rr_no, attachment, drive file …)` — the new
--     attachment (an uploaded file, in the procurement drive), and every live
--     link moved to it: the old link unlinked, the same link made for the
--     copy (A2, A5 — never deleted, never edited). So the ledger row's item
--     photo, the receipt and the asset open the file in `ops-talaliving`. The
--     Chat file itself stays in John Lau's folder, untouched, and the row
--     remembers it (`original_attachment_id`).

-- ── 1. a day for the date tokens ──────────────────────────────────────────
-- One signature (PostgREST cannot call an overloaded seam, `00_no_overloads`):
-- the old two-argument form is dropped and the day is an optional third.
-- Every existing caller passes two arguments and keeps today, as before.
drop function if exists ops_core.drive_path_for(ops_core.doc_kind_t, text);

create or replace function ops_core.drive_path_for(
  p_kind ops_core.doc_kind_t, p_entity text, p_day date default null)
returns text
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select replace(replace(
    coalesce(
      (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity::text = p_entity),
      (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity is null),
      upper(replace(p_kind::text, '_', ' '))),
    '{YYYY-MM-DD}', to_char(coalesce(p_day, ops_core.office_day()), 'YYYY-MM-DD')),
    '{YYYY-MM}',    to_char(coalesce(p_day, ops_core.office_day()), 'YYYY-MM'));
$$;
revoke all on function ops_core.drive_path_for(ops_core.doc_kind_t, text, date) from public;
grant execute on function ops_core.drive_path_for(ops_core.doc_kind_t, text, date) to authenticated;

update ops_core.drive_paths
   set path = 'RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}',
       note = coalesce(note, '') || case when note is null then '' else ' ' end
              || 'By month and day, as accounting files TRANSACTIONS (D360).'
 where kind in ('goods_photo','receiving_report','delivery_note','surat_jalan')
   and entity is null
   and path = 'RECEIVING REPORT';

-- ── 2. which Chat file a copy came from ───────────────────────────────────
alter table ops_procure.receiving_inbox_files
  add column original_attachment_id uuid references ops_core.attachments(id);

comment on column ops_procure.receiving_inbox_files.original_attachment_id is
  'The Chat capture this file was copied from, once it is filed in ops-talaliving (0204, D360). '
  'Null while the row still points at the capture itself.';

-- The view: each file says whether it is filed in ops-talaliving, and where.
create or replace view ops_procure.v_receiving_inbox as
  select i.rr_no,
         i.ref_id,
         i.status,
         i.message,
         coalesce(u.full_name, i.sender_name) as sender_name,
         i.reported_at,
         i.extracted,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'attachment_id', a.id, 'url', coalesce(a.web_view_link, a.url),
                    'filename', a.filename, 'mime', a.mime,
                    'archived', f.original_attachment_id is not null,
                    'drive_path', a.drive_path) order by f.added_at, a.filename)
             from ops_procure.receiving_inbox_files f
             join ops_core.attachments a on a.id = f.attachment_id
            where f.inbox_id = i.id), '[]'::jsonb) as files,
         i.matched_to,
         i.trx_no,
         i.po_no,
         i.receipt_nos,
         i.move_nos,
         i.asset_nos,
         r.full_name as resolved_by_name,
         i.resolved_at,
         i.resolve_note
    from ops_procure.receiving_inbox i
    left join ops_core.users u on u.id = i.reported_by
    left join ops_core.users r on r.id = i.resolved_by;

alter view ops_procure.v_receiving_inbox set (security_invoker = on);
grant select on ops_procure.v_receiving_inbox to authenticated;

-- ── 3. what to copy, and where ────────────────────────────────────────────
create or replace function ops_procure.receiving_archive_plan(p_rr_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare ib ops_procure.receiving_inbox; v_day date; v_files jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'archive',
      'not_permitted','Filing an arrival''s photos needs procurement write access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'archive',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'MATCHED' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'archive',
      'not_matched', format('%s is %s — its photos are filed once it is matched.', p_rr_no, lower(ib.status::text)));
  end if;

  v_day := ops_core.office_day(ib.reported_at);

  -- A file is filed under the kind it was used as: a signed sheet as the
  -- receiving report, the tanda terima as the delivery note, else a photo.
  select coalesce(jsonb_agg(jsonb_build_object(
           'attachment_id', a.id, 'url', a.url, 'filename', a.filename, 'mime', a.mime,
           'kind', x.kind,
           'path', ops_core.drive_path_for(x.kind, null, v_day)) order by f.added_at), '[]'::jsonb)
    into v_files
    from ops_procure.receiving_inbox_files f
    join ops_core.attachments a on a.id = f.attachment_id
    cross join lateral (
      select case
               when bool_or(k.kind = 'receiving_report') then 'receiving_report'
               when bool_or(k.kind = 'delivery_note')    then 'delivery_note'
               else 'goods_photo' end::ops_core.doc_kind_t as kind,
             count(*) as n
        from ops_core.attachment_links k
       where k.attachment_id = a.id and k.unlinked_at is null
    ) x
   where f.inbox_id = ib.id
     and f.original_attachment_id is null
     and a.url is not null
     and x.n > 0;

  return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object(
    'rr_no', ib.rr_no, 'day', v_day, 'files', v_files));
end $$;

-- ── 4. the copy, recorded ─────────────────────────────────────────────────
create or replace function ops_procure.receiving_file_archived(
  p_rr_no          text,
  p_attachment_id  uuid,
  p_drive_file_id  text,
  p_web_view_link  text,
  p_folder_id      text,
  p_path           text,
  p_bytes          bigint default null,
  p_sha256         text   default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  ib    ops_procure.receiving_inbox;
  v_old ops_core.attachments;
  v_new uuid;
  k     ops_core.attachment_links;
  n     int := 0;
  v_link text := nullif(btrim(coalesce(p_web_view_link, '')), '');
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'archive',
      'not_permitted','Filing an arrival''s photos needs procurement write access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no for update;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'archive',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'MATCHED' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'archive',
      'not_matched', format('%s is %s — its photos are filed once it is matched.', p_rr_no, lower(ib.status::text)));
  end if;

  -- Already filed: the row now points at the copy and remembers the capture.
  if exists (select 1 from ops_procure.receiving_inbox_files f
              where f.inbox_id = ib.id and f.original_attachment_id = p_attachment_id) then
    return ops_core.noop('procurement','receiving_inbox', p_rr_no,'archive',
      'already_filed', jsonb_build_object('rr_no', p_rr_no, 'attachment_id', p_attachment_id));
  end if;
  if not exists (select 1 from ops_procure.receiving_inbox_files f
                  where f.inbox_id = ib.id and f.attachment_id = p_attachment_id) then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'file_not_on_report', 'Only a file that came with this message can be filed from it.',
      jsonb_build_object('field','attachment_id'));
  end if;
  if coalesce(btrim(p_drive_file_id), '') = '' or coalesce(btrim(p_folder_id), '') = ''
     or coalesce(btrim(p_path), '') = '' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'drive_file_required','Say which Drive file the copy is, the folder it is in, and its path.',
      jsonb_build_object('field','drive_file_id'));
  end if;
  if v_link is not null and v_link !~ '^https://(drive|docs)\.google\.com/' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'not_a_drive_link','The link recorded for a filed copy must be the one Google Drive gave it.',
      jsonb_build_object('field','web_view_link'));
  end if;

  select * into v_old from ops_core.attachments where id = p_attachment_id;

  insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by,
                                    web_view_link, drive_slug, drive_path, drive_folder_id)
  values (btrim(p_drive_file_id), v_old.filename, v_old.mime, coalesce(p_bytes, v_old.bytes),
          coalesce(nullif(btrim(coalesce(p_sha256, '')), ''), v_old.sha256),
          'chat', auth.uid(),
          coalesce(v_link, format('https://drive.google.com/file/d/%s/view', btrim(p_drive_file_id))),
          (select d.slug from ops_core.doc_kind_drive d where d.kind = 'goods_photo'),
          btrim(p_path), btrim(p_folder_id))
  returning id into v_new;

  -- Every record that shows the capture now shows the copy: the old link is
  -- unlinked, the same link made for the copy.
  for k in
    select * from ops_core.attachment_links
     where attachment_id = v_old.id and unlinked_at is null
  loop
    update ops_core.attachment_links
       set unlinked_at = now(), unlinked_by = auth.uid()
     where id = k.id;
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
    values (v_new, k.entity, k.entity_no, k.kind,
            coalesce(k.note, format('Filed in RECEIVING REPORT from %s', p_rr_no)), auth.uid())
    on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;
    n := n + 1;
  end loop;

  update ops_procure.receiving_inbox_files
     set attachment_id = v_new, original_attachment_id = v_old.id
   where inbox_id = ib.id and attachment_id = v_old.id;

  perform ops_core.emit('procurement','procurement.receiving.archived', p_rr_no,
    jsonb_build_object('rr_no', p_rr_no, 'from', v_old.id, 'attachment_id', v_new,
                       'drive_file_id', btrim(p_drive_file_id), 'path', btrim(p_path), 'links', n));

  return ops_core.ok('procurement','receiving_inbox', p_rr_no,'archive',
    jsonb_build_object('rr_no', p_rr_no, 'attachment_id', v_new, 'from', v_old.id,
                       'path', btrim(p_path), 'links_moved', n));
end $$;

revoke execute on function
  ops_procure.receiving_archive_plan(text),
  ops_procure.receiving_file_archived(text, uuid, text, text, text, text, bigint, text)
  from public;
grant execute on function
  ops_procure.receiving_archive_plan(text),
  ops_procure.receiving_file_archived(text, uuid, text, text, text, text, bigint, text)
  to authenticated;

analyze ops_procure.receiving_inbox_files;
