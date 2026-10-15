-- 0275 — one attachment per Drive file (L14, F275).
--
-- `05_evidence.sql` named the gap in September: nothing stopped the same
-- Drive file existing twice in `ops_core.attachments`. By 14 October the
-- app's own capture and upload paths had made 21 files into 48 rows — a
-- photo re-captured from Chat, a proof attached twice from the web — most
-- copies carrying no link, a few carrying the links the original should
-- have had. Nothing read them wrong yet; the next thing that would is a
-- unique-per-file assumption somebody writes without knowing.
--
-- Three parts. (1) The file's identity as a column: `drive_file_id`, derived
-- from wherever the id sits (`web_view_link`, `url`, `storage_path`) the same
-- way `src/lib/drive-links.ts` reads it, so the rule is in one place and the
-- database can hold it. (2) The copies folded into their original: links and
-- every other reference move to the earliest row, the copy keeps its row with
-- `merged_into` pointing at the survivor (A5: nothing is erased, and the
-- copy's id stays resolvable for anything that still holds it), one audit row
-- per fold. (3) A unique index on the live rows, and the four seams that
-- create attachments finding before creating — so a retry or a second
-- capture answers with the row that exists, instead of an exception that
-- rolls its own audit back.

-- ── 1. the file's identity ────────────────────────────────────────────────
-- Immutable, so it can define a stored column. The order is the client's
-- (`driveFileId`): the link Drive gave an upload, then a filed url, then the
-- bare id in `storage_path` (a demo path like `demo/2026-09/x.jpg` is not one).
create or replace function ops_core.drive_file_id_of(p_web_view_link text, p_url text, p_storage_path text)
returns text
language sql immutable parallel safe as $$
  select coalesce(
    substring(p_web_view_link from '/d/([A-Za-z0-9_-]{10,})'),
    substring(p_web_view_link from '[?&]id=([A-Za-z0-9_-]{10,})'),
    substring(p_url from '/d/([A-Za-z0-9_-]{10,})'),
    substring(p_url from '[?&]id=([A-Za-z0-9_-]{10,})'),
    case when btrim(p_storage_path) ~ '^[A-Za-z0-9_-]{20,}$' then btrim(p_storage_path) end)
$$;
revoke all on function ops_core.drive_file_id_of(text, text, text) from public;
grant execute on function ops_core.drive_file_id_of(text, text, text) to authenticated;

alter table ops_core.attachments
  add column if not exists drive_file_id text
    generated always as (ops_core.drive_file_id_of(web_view_link, url, storage_path)) stored,
  add column if not exists merged_into uuid references ops_core.attachments(id);

comment on column ops_core.attachments.drive_file_id is
  'The Drive file behind the row, read from web_view_link, url or storage_path (drive_file_id_of). '
  'Null for a pasted non-Drive link or a demo path. Unique among live rows (0275).';
comment on column ops_core.attachments.merged_into is
  'Set on a copy that was folded into the row for the same Drive file (0275): its links and '
  'references moved there, this row stays so its id still resolves. A live row has it null.';

-- The live row for a Drive file, if any. Follows a fold, so an id that was
-- merged still answers with the survivor.
create or replace function ops_core.live_attachment_for(p_drive_file_id text)
returns uuid
language sql stable set search_path = ops_core, pg_temp as $$
  select a.id from ops_core.attachments a
   where a.drive_file_id = p_drive_file_id and a.merged_into is null
   limit 1
$$;
revoke all on function ops_core.live_attachment_for(text) from public;
grant execute on function ops_core.live_attachment_for(text) to authenticated;

-- ── 2. the copies, folded into their original ────────────────────────────
-- The survivor is the earliest row (uploaded_at, then id): it is the one the
-- first link was made against. Every table that points at a copy is pointed
-- at the survivor; a link the survivor already carries is closed on the copy
-- rather than moved (links_live_idx would refuse the twin). A no-op on the
-- ladder, which has no duplicates; on production it folds 27 rows.
do $$
declare d record; k record; v_n int := 0;
begin
  for d in
    select a.id as copy_id, s.id as keep_id, a.drive_file_id
      from ops_core.attachments a
      join lateral (
        select x.id from ops_core.attachments x
         where x.drive_file_id = a.drive_file_id and x.merged_into is null
         order by x.uploaded_at, x.id limit 1
      ) s on true
     where a.drive_file_id is not null and a.merged_into is null and a.id <> s.id
     order by a.drive_file_id, a.uploaded_at, a.id
  loop
    for k in select * from ops_core.attachment_links where attachment_id = d.copy_id and unlinked_at is null loop
      if exists (select 1 from ops_core.attachment_links s
                  where s.attachment_id = d.keep_id and s.entity = k.entity and s.entity_no = k.entity_no
                    and s.kind = k.kind and s.unlinked_at is null) then
        update ops_core.attachment_links set unlinked_at = now(), unlinked_by = k.linked_by where id = k.id;
      else
        update ops_core.attachment_links set attachment_id = d.keep_id where id = k.id;
      end if;
    end loop;
    update ops_core.attachment_links set attachment_id = d.keep_id where attachment_id = d.copy_id and unlinked_at is not null;

    update ops_acct.evidence_inbox        set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_acct.bank_statements       set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_procure.receiving_inbox_files set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_procure.receiving_inbox_files set original_attachment_id = d.keep_id where original_attachment_id = d.copy_id;
    update ops_procure.design_approvals   set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_procure.design_approvals   set evidence_attachment_id = d.keep_id where evidence_attachment_id = d.copy_id;
    update ops_procure.quotation_lines    set design_file_id = d.keep_id where design_file_id = d.copy_id;
    update ops_procure.quotation_lines    set frozen_design_file_id = d.keep_id where frozen_design_file_id = d.copy_id;
    update ops_procure.project_lines      set design_file_id = d.keep_id where design_file_id = d.copy_id;
    update ops_procure.factory_quotes     set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_procure.round_transfers    set proof_attachment_id = d.keep_id where proof_attachment_id = d.copy_id;
    update ops_prod.design_revisions      set attachment_id = d.keep_id where attachment_id = d.copy_id;
    update ops_dlv.deliveries             set surat_jalan_attachment_id = d.keep_id where surat_jalan_attachment_id = d.copy_id;
    update ops_dlv.deliveries             set photo_attachment_id = d.keep_id where photo_attachment_id = d.copy_id;
    update ops_dlv.snags                  set photo_attachment_id = d.keep_id where photo_attachment_id = d.copy_id;
    update ops_dlv.handovers              set bast_attachment_id = d.keep_id where bast_attachment_id = d.copy_id;
    update ops_hr.scan_locations          set photo_id = d.keep_id where photo_id = d.copy_id;

    update ops_core.attachments set merged_into = d.keep_id where id = d.copy_id;
    perform ops_core.write_audit('documents', 'attachment', d.copy_id::text, 'merge', 'ok',
      'Satu attachment per file Drive (0275, F275): salinan dilebur ke baris pertamanya',
      jsonb_build_object('merged_into', null), jsonb_build_object('merged_into', d.keep_id),
      jsonb_build_object('drive_file_id', d.drive_file_id));
    v_n := v_n + 1;
  end loop;
  raise notice '0275: % attachment copies folded', v_n;
end $$;

-- ── 3. one live row per file, from now on ────────────────────────────────
create unique index if not exists attachments_drive_file_live_idx
  on ops_core.attachments (drive_file_id)
  where drive_file_id is not null and merged_into is null;

-- A folded copy is not a document anybody lists: `v_attachment` (0217's
-- body, with the one filter) shows live rows only. The copy's id still
-- resolves on the table itself, which is what the thumbnail route reads.
create or replace view ops_core.v_attachment as
  select a.id::text                          as id,
         coalesce(a.storage_path, '')        as storage_path,
         a.url,
         a.filename,
         coalesce(a.sha256, '')              as sha256,
         coalesce(a.mime, '')                as mime,
         coalesce(a.bytes, 0)                as bytes,
         coalesce(u.email, 'system')         as uploaded_by,
         a.uploaded_at,
         a.source,
         (a.sha256 is not null and exists (
            select 1 from ops_core.attachments d
             where d.sha256 = a.sha256 and d.merged_into is null
               and (d.uploaded_at, d.id) < (a.uploaded_at, a.id)))  as duplicate_suspect,
         coalesce(c.n, 0)                    as covers_count,
         a.web_view_link,
         case when a.drive_slug is not null
              then concat_ws(' / ', df.label, 'ops-talaliving', a.drive_path) end as filed_in,
         a.origin
    from ops_core.attachments a
    left join ops_core.users u on u.id = a.uploaded_by
    left join ops_core.drive_folders df on df.slug = a.drive_slug
    left join (
      select attachment_id, count(*) as n
        from ops_core.attachment_links
       where unlinked_at is null
       group by attachment_id
    ) c on c.attachment_id = a.id
   where a.merged_into is null;
alter view ops_core.v_attachment set (security_invoker = on);

-- ── 4. the seams find before they create ─────────────────────────────────
-- Bodies as last written (0237, 0203, 0024, 0217); the one change in each is
-- the lookup before the insert, and `reused` in the answer where the caller
-- is a screen.

create or replace function ops_acct.file_evidence(
  p_ref_id          text,
  p_filename        text,
  p_url             text,
  p_origin          ops_acct.inbox_origin_t default 'chat',
  p_reported_by     text    default null,
  p_mime            text    default null,
  p_bytes           bigint  default null,
  p_sha256          text    default null,
  p_extracted       jsonb   default '{}'::jsonb,
  p_money_direction ops_acct.direction_t default null,
  p_reported_at     timestamptz default null,
  p_key             text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  existing   ops_acct.evidence_inbox;
  reporter   uuid;
  n_match    int;
  att        uuid;
  who        text := nullif(btrim(coalesce(p_reported_by, '')), '');
  fallback   text;
  sent_as    text;
  extracted_ jsonb := coalesce(p_extracted, '{}'::jsonb);
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('accounting', 'file_evidence:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_ref_id), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'ref_required','Every filed document needs the source''s own id, so a retry can be recognised.',
      jsonb_build_object('field','ref_id'));
  end if;
  if coalesce(btrim(p_filename), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'filename_required','A document with no name cannot be found again by the person looking for it.',
      jsonb_build_object('field','filename'));
  end if;
  if coalesce(btrim(p_url), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'url_required','Where is the file? A row describing a document nobody can open is not evidence.',
      jsonb_build_object('field','url'));
  end if;

  select * into existing from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if found then
    return ops_core.ok('accounting','inbox', p_ref_id,'file',
      jsonb_build_object('ref_id', p_ref_id, 'status', existing.status, 'already_filed', true),
      null, null);
  end if;

  if who is not null then
    select count(*), (array_agg(u.id))[1] into n_match, reporter
      from ops_core.users u
     where lower(u.email::text) = lower(who) and u.is_active;

    if n_match = 0 then
      select count(*), (array_agg(u.id))[1] into n_match, reporter
        from ops_core.users u
       where lower(u.full_name) = lower(who) and u.is_active;
    end if;

    if n_match > 1 then
      return ops_core.invalid('accounting','inbox', p_ref_id,'file',
        'reporter_ambiguous',
        format('More than one active person is called %L — say which, by email.', who),
        jsonb_build_object('field','reported_by','value',who));
    end if;
    if n_match = 0 then
      reporter := null;
    end if;
  end if;

  reporter := coalesce(reporter, auth.uid());

  -- A name was given and it is nobody active: file it anyway, under the
  -- fallback account, and keep the name as it was given (D390).
  if reporter is null and who is not null then
    fallback := (select s.value #>> '{}' from ops_core.settings s
                  where s.key = 'capture_fallback_reporter');
    if fallback is not null then
      select u.id into reporter
        from ops_core.users u
       where lower(u.email::text) = lower(btrim(fallback)) and u.is_active;
      if reporter is not null then
        sent_as := who;
        extracted_ := extracted_ || jsonb_build_object('reported_as', who);
      end if;
    end if;
  end if;

  if reporter is null then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'reporter_unresolved',
      coalesce(
        format('Nobody active here is %L. Correct the profile, or pass the email.', who),
        'Say who sent this: no name was given and there is no signed-in caller to assume.'),
      jsonb_build_object('field','reported_by','value', who));
  end if;

  -- One attachment per Drive file (0275): a file captured again is the row
  -- it already has, and this capture is its own inbox row against it.
  att := ops_core.live_attachment_for(ops_core.drive_file_id_of(null, btrim(p_url), null));
  if att is null then
    insert into ops_core.attachments
      (url, filename, sha256, mime, bytes, source, uploaded_by)
    values
      (btrim(p_url), btrim(p_filename),
       nullif(btrim(coalesce(p_sha256, '')), ''),
       nullif(btrim(coalesce(p_mime, '')), ''),
       p_bytes,
       case p_origin when 'chat' then 'chat' else 'web' end,
       reporter)
    returning id into att;
  end if;

  insert into ops_acct.evidence_inbox
    (ref_id, origin, attachment_id, reported_by, reported_at, extracted, money_direction)
  values
    (p_ref_id, p_origin, att, reporter, coalesce(p_reported_at, now()),
     extracted_, p_money_direction);

  perform ops_core.emit('accounting','accounting.inbox.filed', p_ref_id,
    jsonb_build_object('ref_id', p_ref_id, 'origin', p_origin,
                       'attachment_id', att, 'reported_by', reporter,
                       'reported_as', sent_as));

  res := ops_core.ok('accounting','inbox', p_ref_id,'file',
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING',
                       'attachment_id', att, 'reported_by', reporter,
                       'reported_as', sent_as),
    null,
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING'));

  return ops_core.idem_remember('accounting','file_evidence:' || p_ref_id, p_key, res);
end $$;

create or replace function ops_procure.file_receiving(
  p_ref_id      text,
  p_files       jsonb,
  p_message     text        default null,
  p_reported_by text        default null,
  p_reported_at timestamptz default null,
  p_extracted   jsonb       default null,
  p_key         text        default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  ib       ops_procure.receiving_inbox;
  who       text := nullif(btrim(coalesce(p_reported_by, '')), '');
  reporter  uuid;
  uploader  uuid;
  n_match   int;
  f         jsonb;
  att       uuid;
  added     int := 0;
  bad       text;
  replayed  jsonb;
  res       jsonb;
begin
  replayed := ops_core.idem_replay('procurement','file_receiving:' || coalesce(p_ref_id, ''), p_key);
  if replayed is not null then return replayed; end if;

  -- The worker calls with no session; a person calling from a screen must be
  -- somebody who may record an arrival.
  if auth.uid() is not null and not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','receiving_inbox', p_ref_id,'file',
      'not_permitted','Filing an arrival needs procurement access.');
  end if;

  if coalesce(btrim(p_ref_id), '') = '' then
    return ops_core.invalid('procurement','receiving_inbox', null,'file',
      'ref_required','Every filed message needs the source''s own id, so a retry can be recognised.',
      jsonb_build_object('field','ref_id'));
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'files_required','A receiving report from chat is a photograph — a message with no file is a conversation.',
      jsonb_build_object('field','files'));
  end if;
  select min(coalesce(x ->> 'filename', '?')) into bad
    from jsonb_array_elements(p_files) x
   where coalesce(btrim(x ->> 'url'), '') = ''
      or coalesce(btrim(x ->> 'filename'), '') = ''
      or coalesce(btrim(x ->> 'source_ref'), '') = '';
  if bad is not null then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'file_incomplete', format('Every file needs where it is, its name and the source''s id for it (%s).', bad),
      jsonb_build_object('field','files'));
  end if;

  -- Who sent it: by email, then by name. Nobody is a fact, not a refusal.
  if who is not null then
    select count(*), (array_agg(u.id))[1] into n_match, reporter
      from ops_core.users u where lower(u.email::text) = lower(who) and u.is_active;
    if n_match = 0 then
      select count(*), (array_agg(u.id))[1] into n_match, reporter
        from ops_core.users u where lower(u.full_name) = lower(who) and u.is_active;
    end if;
    if n_match <> 1 then reporter := null; end if;
  end if;

  select * into ib from ops_procure.receiving_inbox where ref_id = p_ref_id;

  if found and ib.status <> 'PENDING' then
    return ops_core.ok('procurement','receiving_inbox', ib.rr_no,'file',
      jsonb_build_object('rr_no', ib.rr_no, 'status', ib.status, 'already_filed', true));
  end if;

  uploader := coalesce(reporter, ib.reported_by, auth.uid(),
                       (select id from ops_core.users where email = 'shared@talaliving.com'));
  if uploader is null then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'uploader_unresolved',
      'Nobody to record the files against: the sender is unknown, there is no session, and shared@ does not exist.',
      jsonb_build_object('field','reported_by','value', who));
  end if;

  if not found then
    insert into ops_procure.receiving_inbox
      (ref_id, message, sender_name, reported_by, reported_at, extracted)
    values (p_ref_id, nullif(btrim(coalesce(p_message, '')), ''), who, reporter,
            coalesce(p_reported_at, now()), coalesce(p_extracted, '{}'::jsonb))
    returning * into ib;
  else
    -- Still open: the reading and the message may arrive after the files.
    update ops_procure.receiving_inbox
       set extracted   = case when coalesce(p_extracted, '{}'::jsonb) <> '{}'::jsonb
                              then p_extracted else extracted end,
           message     = coalesce(message, nullif(btrim(coalesce(p_message, '')), '')),
           reported_by = coalesce(reported_by, reporter),
           sender_name = coalesce(sender_name, who)
     where id = ib.id
     returning * into ib;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    continue when exists (select 1 from ops_procure.receiving_inbox_files x
                           where x.inbox_id = ib.id and x.source_ref = btrim(f ->> 'source_ref'));
    -- One attachment per Drive file (0275): a photo sent twice is one row.
    att := ops_core.live_attachment_for(ops_core.drive_file_id_of(null, btrim(f ->> 'url'), null));
    if att is null then
      insert into ops_core.attachments (url, filename, sha256, mime, bytes, source, uploaded_by)
      values (btrim(f ->> 'url'), btrim(f ->> 'filename'),
              nullif(btrim(coalesce(f ->> 'sha256', '')), ''),
              nullif(btrim(coalesce(f ->> 'mime', '')), ''),
              nullif(f ->> 'bytes', '')::bigint,
              'chat', uploader)
      returning id into att;
    end if;
    insert into ops_procure.receiving_inbox_files (inbox_id, attachment_id, source_ref)
    values (ib.id, att, btrim(f ->> 'source_ref'));
    added := added + 1;
  end loop;

  if added > 0 then
    perform ops_core.emit('procurement','procurement.receiving.filed', ib.rr_no,
      jsonb_build_object('rr_no', ib.rr_no, 'ref_id', p_ref_id, 'files', added,
                         'reported_by', reporter));
  end if;

  res := ops_core.ok('procurement','receiving_inbox', ib.rr_no,'file',
    jsonb_build_object('rr_no', ib.rr_no, 'status', ib.status, 'files_added', added,
                       'reported_by', reporter));
  return ops_core.idem_remember('procurement','file_receiving:' || p_ref_id, p_key, res);
end $$;

create or replace function ops_core.attach_url(
  p_url text,
  p_title text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id uuid; v_host text; res jsonb; replayed jsonb; v_reused boolean := false;
begin
  replayed := ops_core.idem_replay('documents','attach_url', p_key);
  if replayed is not null then return replayed; end if;

  p_url := btrim(coalesce(p_url, ''));
  if p_url = '' then
    return ops_core.invalid('documents','attachment', null,'attach_url',
      'url_required','An address is required.', jsonb_build_object('field','url'));
  end if;
  -- Only the two schemes a browser can open. `javascript:` and `data:` are the
  -- reason this is a check and not a trim: a filed link is rendered as
  -- something somebody clicks.
  if p_url !~* '^https?://' then
    return ops_core.invalid('documents','attachment', null,'attach_url',
      'url_scheme','Only http and https links can be filed.',
      jsonb_build_object('field','url'));
  end if;

  -- The host, for a title nobody typed. `tokopedia.com` reads better in a chip
  -- than the whole address, and the whole address is still on the row.
  v_host := substring(p_url from '^https?://([^/?#]+)');

  -- A pasted Drive link to a file already filed is that file (0275).
  v_id := ops_core.live_attachment_for(ops_core.drive_file_id_of(null, p_url, null));
  v_reused := v_id is not null;
  if v_id is null then
    insert into ops_core.attachments (url, filename, source, uploaded_by)
    values (p_url, coalesce(nullif(btrim(p_title), ''), v_host, p_url), 'web', auth.uid())
    returning id into v_id;
  end if;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind','link', 'host', v_host));

  res := ops_core.ok('documents','attachment', v_id::text,'attach_url',
    jsonb_build_object('attachment_id', v_id, 'reused', v_reused));
  return ops_core.idem_remember('documents','attach_url', p_key, res);
end $$;

create or replace function ops_core.attach_file(
  p_storage_path text,
  p_filename text,
  p_mime text default null,
  p_bytes bigint default null,
  p_sha256 text default null,
  p_source text default 'web',
  p_key text default null,
  p_kind text default null,
  p_entity text default null,
  p_web_view_link text default null,
  p_folder_id text default null,
  p_entity_no text default null,
  p_origin text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id uuid; v_max bigint; res jsonb; replayed jsonb;
        v_kind ops_core.doc_kind_t; v_slug text; v_path text; v_link text; v_where text;
        v_origin text := nullif(lower(btrim(p_origin)), ''); v_reused boolean := false;
begin
  replayed := ops_core.idem_replay('documents','attach_file', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_storage_path), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'path_required','A stored file needs the id Drive gave it.',
      jsonb_build_object('field','storage_path'));
  end if;
  if coalesce(btrim(p_filename), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'filename_required','A file needs the name a person will recognise it by.',
      jsonb_build_object('field','filename'));
  end if;
  if v_origin is not null and v_origin not in ('tala','client','third_party') then
    return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
      'unknown_origin',
      format('"%s" is not who made a file: say tala, client or third_party.', p_origin),
      jsonb_build_object('field','origin','given', p_origin));
  end if;

  v_max := ops_core.setting_num('upload.max_bytes');
  if v_max is not null and coalesce(p_bytes, 0) > v_max then
    return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
      'file_too_large',
      format('File is %s MB, over the %s MB limit.',
             round(p_bytes / 1048576.0, 1), round(v_max / 1048576.0)),
      jsonb_build_object('field','bytes','limit', v_max));
  end if;

  if p_kind is not null then
    v_kind := ops_core.doc_kind_of(p_kind);
    if v_kind is null then
      return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
        'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
        jsonb_build_object('field','kind','given', p_kind));
    end if;
    select d.slug into v_slug from ops_core.doc_kind_drive d where d.kind = v_kind;
    if v_slug is null then
      return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
        'no_drive_for_kind', format('Nothing says which shared drive a %s belongs in.', v_kind),
        jsonb_build_object('field','kind','kind', v_kind));
    end if;
    -- The same folder `drive_folder_for` gave the route, for the same record.
    v_path := ops_core.drive_path_for_record(v_kind, p_entity, p_entity_no);
  end if;

  v_link := nullif(btrim(p_web_view_link), '');
  if v_link is not null and v_link !~ '^https://(drive|docs)\.google\.com/' then
    return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
      'not_a_drive_link', 'The link recorded for an uploaded file must be the one Google Drive gave it.',
      jsonb_build_object('field','web_view_link'));
  end if;

  -- The same Drive id registered twice (a retry that lost its key, a file
  -- picked twice) is one attachment (0275).
  v_id := ops_core.live_attachment_for(ops_core.drive_file_id_of(v_link, null, btrim(p_storage_path)));
  v_reused := v_id is not null;
  if v_id is null then
    insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by,
                                      web_view_link, drive_slug, drive_path, drive_folder_id, origin)
    values (btrim(p_storage_path), btrim(p_filename), nullif(btrim(p_mime), ''),
            p_bytes, nullif(btrim(p_sha256), ''),
            case when p_source in ('web','chat','api','import') then p_source else 'web' end,
            auth.uid(),
            v_link, v_slug, v_path, nullif(btrim(p_folder_id), ''), v_origin)
    returning id into v_id;
  end if;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind', coalesce(v_kind::text, 'file'),
                       'bytes', p_bytes, 'drive', v_slug, 'path', v_path, 'origin', v_origin));

  select concat_ws(' / ', df.label, 'ops-talaliving', v_path) into v_where
    from ops_core.drive_folders df where df.slug = v_slug;

  res := ops_core.say('documents','attachment', btrim(p_filename),'attach_file','ok',200,
    null,
    case when v_where is not null then format('%s → %s', btrim(p_filename), v_where) end,
    jsonb_build_object('attachment_id', v_id, 'web_view_link', v_link,
                       'drive', v_slug, 'path', v_path, 'reused', v_reused),
    jsonb_strip_nulls(jsonb_build_object('attachment_id', v_id, 'drive_file_id', btrim(p_storage_path),
                       'kind', v_kind, 'drive', v_slug, 'path', v_path, 'origin', v_origin,
                       'web_view_link', v_link, 'bytes', p_bytes)));
  return ops_core.idem_remember('documents','attach_file', p_key, res);
end $$;

grant execute on function
  ops_acct.file_evidence(text, text, text, ops_acct.inbox_origin_t, text, text,
                         bigint, text, jsonb, ops_acct.direction_t, timestamptz, text)
  to authenticated;
grant execute on function ops_procure.file_receiving(text, jsonb, text, text, timestamptz, jsonb, text) to authenticated;
grant execute on function ops_core.attach_url(text, text, text) to authenticated;
grant execute on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text, text, text) to authenticated;

analyze ops_core.attachments;
analyze ops_core.attachment_links;
