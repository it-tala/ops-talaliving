-- 0024_core_files_seams.sql — the evidence road: what a screen reads, and the
-- three ways a document gets attached.
--
-- `0005` built the tables. This is B2 and B3 over them: two views for the
-- strip, and three seams — file a link, attach a document to a record, take it
-- back off. The bytes of an uploaded file are not here; that is B6, and the
-- seam that records one takes the path it already landed at.
--
-- ── Two vocabularies, kept from drifting ─────────────────────────────────
--
-- The contract in `src/services/documents/contracts.ts` speaks in **labels** —
-- `DocKind` is the string `Receipt / Invoice / Nota`, because that is what a
-- chip on the screen says. The database stores a **code**, `nota`, because an
-- enum is what a constraint can hold and a label is a thing somebody will
-- reword. `ops_core.doc_kind_labels` exists to join the two, and the
-- translation happens **here** rather than in the client: put it in TypeScript
-- and the day somebody rewords a label is the day the database stops
-- recognising a kind it has stored for a year.
--
-- `link_entity_t` is the same shape of problem in the other direction. The
-- enum is deliberately wider than the contract (`0001`), and two of its names
-- differ: the contract's `po` is `purchase_order` here, its `overtime` is
-- `overtime_sheet`. Translating in the seam means a screen keeps saying `po`
-- and the database keeps meaning the row it can point a foreign key at.

-- ── what the strip reads ──────────────────────────────────────────────────

-- A link, with the label its chip prints and the address of whoever declared
-- it. Unlinked rows are absent, not filtered by the caller: an unlink is a
-- fact about the past (A2), and a screen asking "what is on this record" is
-- asking about now.
create or replace view ops_core.v_attachment_link as
  select l.id::text            as id,
         l.attachment_id::text as attachment_id,
         -- Back to the contract's names, so a screen reads what it wrote.
         case l.entity
           when 'purchase_order' then 'po'
           when 'overtime_sheet' then 'overtime'
           else l.entity::text
         end                   as entity,
         l.entity_no,
         k.label               as kind,
         coalesce(u.email, 'system') as linked_by,
         l.linked_at
    from ops_core.attachment_links l
    join ops_core.doc_kind_labels k on k.kind = l.kind
    left join ops_core.users u on u.id = l.linked_by
   where l.unlinked_at is null;

-- The document itself.
--
-- `duplicate_suspect` is the one derived field, and it is derived rather than
-- stored on purpose (A3, A6): the second photograph of a receipt becomes a
-- suspect the moment the first one exists, and nothing should have to go back
-- and update a row that was written before its twin arrived. Advisory only —
-- the screen warns, the seam never refuses.
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
         -- Ordered by `(uploaded_at, id)`, not by time alone. `now()` is the
         -- *transaction's* clock, so two files recorded in one transaction —
         -- an import, a batch — carry the identical instant, and on time alone
         -- neither would be after the other and neither would be flagged. The
         -- id breaks the tie, which makes exactly one row of any group of
         -- identical bytes the original and every other one a suspect.
         (a.sha256 is not null and exists (
            select 1 from ops_core.attachments d
             where d.sha256 = a.sha256
               and (d.uploaded_at, d.id) < (a.uploaded_at, a.id)))  as duplicate_suspect,
         coalesce(c.n, 0)                    as covers_count
    from ops_core.attachments a
    left join ops_core.users u on u.id = a.uploaded_by
    left join (
      select attachment_id, count(*) as n
        from ops_core.attachment_links
       where unlinked_at is null
       group by attachment_id
    ) c on c.attachment_id = a.id;

alter view ops_core.v_attachment      set (security_invoker = on);
alter view ops_core.v_attachment_link set (security_invoker = on);

grant select on ops_core.v_attachment, ops_core.v_attachment_link to authenticated;

-- ── the seams ─────────────────────────────────────────────────────────────

-- Filing an address as evidence (D125).
--
-- A marketplace listing, a quotation in a portal, an invoice behind a login.
-- Photographing the screen would make it a file and lose the only thing that
-- made it useful — the address somebody else can open to check the price
-- themselves. So it is an attachment like any other: same table, same strip.
-- What it is not is a *primary* document, and nothing here needs to enforce
-- that: `PRIMARY_DOC_KINDS` decides it at the point money is posted.
create or replace function ops_core.attach_url(
  p_url text,
  p_title text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id uuid; v_host text; res jsonb; replayed jsonb;
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

  insert into ops_core.attachments (url, filename, source, uploaded_by)
  values (p_url, coalesce(nullif(btrim(p_title), ''), v_host, p_url), 'web', auth.uid())
  returning id into v_id;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind','link', 'host', v_host));

  res := ops_core.ok('documents','attachment', v_id::text,'attach_url',
    jsonb_build_object('attachment_id', v_id));
  return ops_core.idem_remember('documents','attach_url', p_key, res);
end $$;

-- Recording a file whose bytes have already landed in storage.
--
-- The upload itself is the client's: it puts the object there and then says
-- so here. Splitting it that way keeps large files off the database
-- connection, and it is why this function takes a path rather than bytes.
--
-- The path is **not trusted to be well-formed and is not checked to exist** —
-- storage and Postgres are two systems, and a check here would be a lie the
-- moment an object is removed. What protects the row is that only the
-- uploader can write it (`attachments_write`), and what protects the object is
-- the bucket's own policy.
create or replace function ops_core.attach_file(
  p_storage_path text,
  p_filename text,
  p_mime text default null,
  p_bytes bigint default null,
  p_sha256 text default null,
  p_source text default 'web',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id uuid; v_max bigint; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('documents','attach_file', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_storage_path), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'path_required','A stored file needs its path.',
      jsonb_build_object('field','storage_path'));
  end if;
  if coalesce(btrim(p_filename), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'filename_required','A file needs the name a person will recognise it by.',
      jsonb_build_object('field','filename'));
  end if;

  -- The limit is a setting rather than a constant, because the answer to "why
  -- can I not upload this" should be changeable by whoever is asked it.
  v_max := ops_core.setting_num('upload.max_bytes');
  if v_max is not null and coalesce(p_bytes, 0) > v_max then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'file_too_large',
      format('File is %s MB, over the %s MB limit.',
             round(p_bytes / 1048576.0, 1), round(v_max / 1048576.0)),
      jsonb_build_object('field','bytes','limit', v_max));
  end if;

  insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by)
  values (btrim(p_storage_path), btrim(p_filename), nullif(btrim(p_mime), ''),
          p_bytes, nullif(btrim(p_sha256), ''),
          case when p_source in ('web','chat','api','import') then p_source else 'web' end,
          auth.uid())
  returning id into v_id;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind','file', 'bytes', p_bytes));

  res := ops_core.ok('documents','attachment', v_id::text,'attach_file',
    jsonb_build_object('attachment_id', v_id));
  return ops_core.idem_remember('documents','attach_file', p_key, res);
end $$;

-- Attaching a document to a record — the road the whole design is built around
-- (ADR-010, D91). Somebody opens the row and says *this file belongs here*, so
-- the link is declared rather than guessed from a filename.
--
-- The same file on the same record under the same kind twice is a **no-op**,
-- not a second piece of evidence and not an error: the person clicked twice,
-- or two people filed the same nota, and neither is a mistake worth a red
-- message. `links_live_idx` is what makes that true rather than hoped for.
create or replace function ops_core.attach_link(
  p_attachment_id uuid,
  p_entity text,
  p_entity_no text,
  p_kind text,
  p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_entity ops_core.link_entity_t; v_kind ops_core.doc_kind_t;
        v_id uuid; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('documents',
    'attach_link:' || coalesce(p_attachment_id::text,'') || ':' || coalesce(p_entity_no,''), p_key);
  if replayed is not null then return replayed; end if;

  if not exists (select 1 from ops_core.attachments where id = p_attachment_id) then
    return ops_core.not_found('documents','attachment', p_attachment_id::text,'attach_link',
      'File not found.');
  end if;

  -- The contract's name, to the enum's. An unknown one is a refusal with the
  -- name in it, because "invalid entity" sends somebody reading source.
  begin
    v_entity := (case p_entity
                   when 'po' then 'purchase_order'
                   when 'overtime' then 'overtime_sheet'
                   else p_entity
                 end)::ops_core.link_entity_t;
  exception when invalid_text_representation then
    return ops_core.invalid('documents','attachment', p_entity_no,'attach_link',
      'unknown_entity', format('Nothing here is attached to a %s.', p_entity),
      jsonb_build_object('field','entity','given', p_entity));
  end;

  -- The label, to the code. One vocabulary, and this is where it is enforced.
  select kind into v_kind from ops_core.doc_kind_labels where label = p_kind;
  if v_kind is null then
    begin
      v_kind := p_kind::ops_core.doc_kind_t;      -- a code is accepted too
    exception when invalid_text_representation then
      return ops_core.invalid('documents','attachment', p_entity_no,'attach_link',
        'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
        jsonb_build_object('field','kind','given', p_kind));
    end;
  end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
  values (p_attachment_id, v_entity, btrim(p_entity_no), v_kind, nullif(btrim(p_note), ''), auth.uid())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from ops_core.attachment_links
     where attachment_id = p_attachment_id and entity = v_entity
       and entity_no = btrim(p_entity_no) and kind = v_kind and unlinked_at is null;
    return ops_core.noop('documents','attachment', p_entity_no,'attach_link',
      'That document is already on this record under the same kind.',
      jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id));
  end if;

  perform ops_core.emit('documents','documents.attachment.linked', btrim(p_entity_no),
    jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id,
                       'entity', v_entity, 'kind', v_kind));

  res := ops_core.ok('documents','attachment', btrim(p_entity_no),'attach_link',
    jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id));
  return ops_core.idem_remember('documents',
    'attach_link:' || p_attachment_id::text || ':' || coalesce(p_entity_no,''), p_key, res);
end $$;

-- Taking a document back off a record.
--
-- **An update, never a DELETE** (A2, A5). The file stopped belonging to the
-- row at a moment and somebody decided that, and both halves are worth
-- keeping: a document that silently leaves a ledger row is the shape of the
-- problem this system exists to end.
create or replace function ops_core.attach_unlink(
  p_link_id uuid,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare l ops_core.attachment_links; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('documents','attach_unlink:' || coalesce(p_link_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  select * into l from ops_core.attachment_links where id = p_link_id;
  if not found then
    return ops_core.not_found('documents','attachment', p_link_id::text,'attach_unlink',
      'That document is not attached here.');
  end if;
  -- Already off. Saying so is not an error — the row is in the state the
  -- caller wanted it in.
  if l.unlinked_at is not null then
    return ops_core.noop('documents','attachment', l.entity_no,'attach_unlink',
      'That document was already taken off this record.',
      jsonb_build_object('link_id', l.id));
  end if;

  update ops_core.attachment_links
     set unlinked_at = now(), unlinked_by = auth.uid()
   where id = p_link_id;

  perform ops_core.emit('documents','documents.attachment.unlinked', l.entity_no,
    jsonb_build_object('link_id', l.id, 'attachment_id', l.attachment_id,
                       'entity', l.entity, 'kind', l.kind));

  res := ops_core.ok('documents','attachment', l.entity_no,'attach_unlink',
    jsonb_build_object('link_id', l.id));
  return ops_core.idem_remember('documents','attach_unlink:' || p_link_id::text, p_key, res);
end $$;

grant execute on function
  ops_core.attach_url(text, text, text),
  ops_core.attach_file(text, text, text, bigint, text, text, text),
  ops_core.attach_link(uuid, text, text, text, text, text),
  ops_core.attach_unlink(uuid, text)
  to authenticated;

-- The limit `attach_file` reads. A setting rather than a constant so the
-- answer to "why can I not upload this" is changeable by whoever is asked it;
-- 25 MB is a photograph from a phone with room to spare, and small enough that
-- somebody uploading a video notices before the bucket does.
insert into ops_core.settings (key, value, note) values
  ('upload.max_bytes', '26214400'::jsonb,
   'Largest file that may be attached, in bytes. A phone photograph is 3–8 MB.')
on conflict (key) do nothing;
