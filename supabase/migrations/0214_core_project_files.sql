-- 0214_core_project_files.sql — a project's files: what they are, who made
-- them, and a folder per client and project (P1, kajian F221, D313).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *Dari mengirim proposal, penawaran, sampai meeting dengan client dan sampai
-- closing atau pun tidak jadi … daftar desain item, drawings, render, dan
-- sebagainya dari kita sendiri maupun gambar desain dari klien* (2026-10-06).
-- P1 is the floor everything after it stands on: a place for every file a sale
-- produces, saying who made it, in a folder of its own.
--
-- ── What changes ──────────────────────────────────────────────────────────
--
-- 1. **Ten kinds get a label and a drive** (`0213` added them). The client's
--    and the designer's pictures go to DRAFTING; the paper of the sale (brief,
--    survey, proposal, notes, contract) to PROJECT MANAGER, beside the BAST
--    that closes it (Q68's default).
-- 2. **A file says who made it.** `attachments.origin`: `tala`, `client`, or
--    `third_party` (the client's architect or designer). A property of the
--    file, not of the link: a render is the client's designer's wherever it is
--    attached. Null for everything filed before, and for anything where nobody
--    said — never guessed.
-- 3. **A folder per client and project.** `drive_paths` learns `{CLIENT}` and
--    `{PROJECT}`, read from the record the file is filed against: a project, a
--    quotation (its project), or a client (no project: `00 UMUM`). A file
--    with no such record still lands somewhere a person can find it:
--    `TANPA KLIEN / TANPA PROYEK`. The drive is still the kind's alone (0035).
-- 4. **The upload names its record.** `drive_folder_for` and `attach_file`
--    take the record's number beside its type, so the route and the row agree
--    on the folder. Both keep every argument they had, in the same order.
--
-- ── How the seams are replaced ────────────────────────────────────────────
--
-- A new argument is a new signature, and two signatures under one name is an
-- overload PostgREST cannot call (`00_no_overloads`), so the old ones are
-- dropped here, as 0210–0212 drop theirs. **Applying this to production:** a
-- `DROP` does not get through the Supabase migration tool (F220). There, run
-- the two `drop function` lines as `alter function … rename to
-- …_retired_0214` plus `revoke all … from public, authenticated`, and apply
-- the rest in the same order.

-- ── 1. labels and drives ──────────────────────────────────────────────────

insert into ops_core.doc_kind_labels (kind, label) values
  ('brief',           'Client Brief'),
  ('foto_survei',     'Site Survey Photo'),
  ('gambar_klien',    'Client Drawing'),
  ('referensi_klien', 'Client Reference'),
  ('moodboard',       'Moodboard'),
  ('layout',          'Layout / Floor Plan'),
  ('render',          'Render'),
  ('proposal',        'Proposal'),
  ('notulen',         'Meeting Notes'),
  ('kontrak',         'Contract / SPK')
on conflict (kind) do nothing;

insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('brief',           'project',  'What the client asked for, in writing. The paper of the sale lives beside its BAST.'),
  ('foto_survei',     'project',  'The site as it was measured.'),
  ('proposal',        'project',  'What was sent to the client.'),
  ('notulen',         'project',  'What was said at a meeting.'),
  ('kontrak',         'project',  'The signed contract, SPK or client PO.'),
  ('gambar_klien',    'drafting', 'A drawing the client brought: the drafters work from it.'),
  ('referensi_klien', 'drafting', 'What the client showed us they like: the drafters work from it.'),
  ('moodboard',       'drafting', 'The concept, drawn by the drafters.'),
  ('layout',          'drafting', 'The floor plan, drawn by the drafters.'),
  ('render',          'drafting', 'A render, drawn by the drafters (not gambar_jadi, the finished piece).')
on conflict (kind) do nothing;

-- ── 2. who made the file ──────────────────────────────────────────────────

alter table ops_core.attachments
  add column if not exists origin text
    constraint origin_known check (origin in ('tala','client','third_party'));

comment on column ops_core.attachments.origin is
  'Who made the file: tala (us), client, or third_party (the client''s architect or designer). '
  'Null where nobody said, including every file filed before 0214. (0214, P1)';

-- Appended at the end, so `create or replace` keeps every column a screen reads.
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
             where d.sha256 = a.sha256
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
    ) c on c.attachment_id = a.id;
alter view ops_core.v_attachment set (security_invoker = on);

-- ── 3. a folder per client and project ────────────────────────────────────

-- A name as one folder: a slash would make two, so it becomes a dash.
create or replace function ops_core.drive_segment(p_name text)
returns text
language sql immutable set search_path = ops_core, pg_temp as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(upper(coalesce(p_name, '')),
                '[/\\]+', '-', 'g'), '\s+', ' ', 'g')), 90), '');
$$;
revoke all on function ops_core.drive_segment(text) from public;
grant execute on function ops_core.drive_segment(text) to authenticated;

-- Which client and project a record belongs to, as folder names. Lives with
-- the tables it reads. Answers nothing but two names, and only for the three
-- records a sale's files are filed against.
create or replace function ops_procure.drive_context(p_entity text, p_entity_no text)
returns table (client_folder text, project_folder text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  with p as (
    select pr.code, pr.name, pr.client_id, pr.client_name
      from ops_procure.projects pr
     where (p_entity = 'project' and pr.code = btrim(p_entity_no))
        or (p_entity = 'quotation' and pr.id = (select q.project_id from ops_procure.quotations q
                                                  where q.quote_no = btrim(p_entity_no)))
  )
  select coalesce(ops_core.drive_segment(c.code || ' ' || c.name),
                  ops_core.drive_segment(p.client_name),
                  'TANPA KLIEN'),
         ops_core.drive_segment(p.code || ' ' || p.name)
    from p
    left join ops_procure.clients c on c.id = p.client_id
  union all
  select ops_core.drive_segment(c.code || ' ' || c.name), '00 UMUM'
    from ops_procure.clients c
   where p_entity = 'client' and c.code = btrim(p_entity_no);
$$;
revoke all on function ops_procure.drive_context(text, text) from public;
grant execute on function ops_procure.drive_context(text, text) to authenticated;

comment on function ops_procure.drive_context(text, text) is
  'The client and project folder names for a record a file is filed against: a project, a '
  'quotation (its project) or a client (00 UMUM). No row for anything else. (0214)';

-- The folder for a kind **and a particular record**: `drive_path_for`, with
-- `{CLIENT}` and `{PROJECT}` read from that record. Where the record says
-- nothing, the folder still exists and says so.
create or replace function ops_core.drive_path_for_record(
  p_kind ops_core.doc_kind_t, p_entity text, p_entity_no text, p_day date default null)
returns text
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_path text; v_client text; v_project text;
begin
  v_path := ops_core.drive_path_for(p_kind, p_entity, p_day);
  if v_path not like '%{CLIENT}%' and v_path not like '%{PROJECT}%' then
    return v_path;
  end if;
  if p_entity_no is not null then
    select x.client_folder, x.project_folder into v_client, v_project
      from ops_procure.drive_context(p_entity, p_entity_no) x
     limit 1;
  end if;
  return replace(replace(v_path,
    '{CLIENT}',  coalesce(v_client,  'TANPA KLIEN')),
    '{PROJECT}', coalesce(v_project, 'TANPA PROYEK'));
end $$;
revoke all on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) from public;
grant execute on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) to authenticated;

comment on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) is
  'drive_path_for, with {CLIENT} and {PROJECT} read from the record the file is filed against '
  '(TANPA KLIEN / TANPA PROYEK where it says nothing). (0214)';

insert into ops_core.drive_paths (kind, entity, path, note) values
  -- PROJECT MANAGER / ops-talaliving
  ('brief',           null, '{CLIENT}/{PROJECT}/01 BRIEF & SURVEI',        'The paper of a sale, by client and project (P1).'),
  ('foto_survei',     null, '{CLIENT}/{PROJECT}/01 BRIEF & SURVEI',        null),
  ('proposal',        null, '{CLIENT}/{PROJECT}/03 PROPOSAL & PENAWARAN',  null),
  ('notulen',         null, '{CLIENT}/{PROJECT}/04 MEETING',               null),
  ('kontrak',         null, '{CLIENT}/{PROJECT}/05 KONTRAK',               null),
  -- DRAFTING / ops-talaliving. P4 adds the collection, room and item levels.
  ('gambar_klien',    null, '{CLIENT}/{PROJECT}/00 DARI KLIEN',            'What the client brought, by client and project (P1, D375).'),
  ('referensi_klien', null, '{CLIENT}/{PROJECT}/00 DARI KLIEN',            null),
  ('moodboard',       null, '{CLIENT}/{PROJECT}/00 KONSEP',                null),
  ('layout',          null, '{CLIENT}/{PROJECT}/00 KONSEP',                null),
  ('render',          null, '{CLIENT}/{PROJECT}/00 KONSEP',                null)
on conflict (kind, entity) do nothing;

-- ── 4. the upload names its record ────────────────────────────────────────

drop function if exists ops_core.drive_folder_for(text, text);

create or replace function ops_core.drive_folder_for(
  p_kind text, p_entity text default null, p_entity_no text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t; f record;
begin
  v_kind := ops_core.doc_kind_of(p_kind);
  if v_kind is null then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;
  if p_entity is not null
     and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                      where t.typname = 'link_entity_t' and e.enumlabel = p_entity) then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'unknown_entity', format('"%s" is not a record a document can be filed against.', p_entity),
      jsonb_build_object('field','entity','given', p_entity));
  end if;

  select d.slug, df.label, df.drive_id, df.folder_id, df.parent_folder_id
    into f
    from ops_core.doc_kind_drive d
    join ops_core.drive_folders df on df.slug = d.slug
   where d.kind = v_kind;

  if not found then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'no_drive_for_kind',
      format('Nothing says which shared drive a %s belongs in.', v_kind),
      jsonb_build_object('field','kind','kind', v_kind));
  end if;

  if f.parent_folder_id is null and f.folder_id is null then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'drive_not_configured',
      format('Nothing records which shared drive is %s, so a %s cannot be filed. IT sets it in ops_core.drive_folders.',
             f.label, v_kind),
      jsonb_build_object('field','kind','slug', f.slug, 'label', f.label));
  end if;

  -- Unlogged when answered, as since 0177: asking where a file goes changes nothing.
  return jsonb_strip_nulls(jsonb_build_object('outcome','ok','status',200,'data',
    jsonb_build_object('kind', v_kind, 'slug', f.slug, 'label', f.label,
                       'drive_id', f.drive_id,
                       'parent_folder_id', f.parent_folder_id,
                       'folder_id', f.folder_id,
                       'path', ops_core.drive_path_for_record(v_kind, p_entity, p_entity_no))));
end $$;
revoke all on function ops_core.drive_folder_for(text, text, text) from public;
grant execute on function ops_core.drive_folder_for(text, text, text) to authenticated;

drop function if exists ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text);

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
        v_origin text := nullif(lower(btrim(p_origin)), '');
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

  insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by,
                                    web_view_link, drive_slug, drive_path, drive_folder_id, origin)
  values (btrim(p_storage_path), btrim(p_filename), nullif(btrim(p_mime), ''),
          p_bytes, nullif(btrim(p_sha256), ''),
          case when p_source in ('web','chat','api','import') then p_source else 'web' end,
          auth.uid(),
          v_link, v_slug, v_path, nullif(btrim(p_folder_id), ''), v_origin)
  returning id into v_id;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind', coalesce(v_kind::text, 'file'),
                       'bytes', p_bytes, 'drive', v_slug, 'path', v_path, 'origin', v_origin));

  select concat_ws(' / ', df.label, 'ops-talaliving', v_path) into v_where
    from ops_core.drive_folders df where df.slug = v_slug;

  res := ops_core.say('documents','attachment', btrim(p_filename),'attach_file','ok',200,
    null,
    case when v_where is not null then format('%s → %s', btrim(p_filename), v_where) end,
    jsonb_build_object('attachment_id', v_id, 'web_view_link', v_link,
                       'drive', v_slug, 'path', v_path),
    jsonb_strip_nulls(jsonb_build_object('attachment_id', v_id, 'drive_file_id', btrim(p_storage_path),
                       'kind', v_kind, 'drive', v_slug, 'path', v_path, 'origin', v_origin,
                       'web_view_link', v_link, 'bytes', p_bytes)));
  return ops_core.idem_remember('documents','attach_file', p_key, res);
end $$;
revoke all on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text, text, text) from public;
grant execute on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text, text, text) to authenticated;

comment on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text, text, text) is
  'Records an uploaded file: where it went (decided here from the kind and the record) and who made it '
  '(origin). The arguments of 0177, in the same order, then p_entity_no and p_origin. (0214)';
