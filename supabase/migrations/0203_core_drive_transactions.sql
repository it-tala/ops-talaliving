-- 0203_core_drive_transactions.sql — money evidence filed by month, and the
-- same bytes never filed twice (D359, F209).
--
-- Two things the owner saw in the ACCOUNTING drive on 2026-10-01:
--
--   1. **Two trees for one kind of document.** Google Chat captures (John
--      Lau's `capture-worker`) were filed `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>`,
--      which the owner calls the right scheme. Uploads from this app went to
--      `ops-talaliving/NOTA` and `ops-talaliving/TRANSFER PROOF` — the kind's
--      own name, because 0172 had no row for them. The owner's ruling: one
--      folder, `ops-talaliving`, and inside it the month tree.
--
--   2. **The same receipt in both.** 28 files uploaded here between 28/09 and
--      01/10 were byte-for-byte a file the chat had already filed: somebody
--      downloaded it from Drive and attached it again from *New ledger entry*.
--
-- So, two changes:
--
--   * `drive_paths` learns two date tokens, `{YYYY-MM}` and `{YYYY-MM-DD}`,
--     read from the **office day** (WITA, never the server's — F17), so a
--     nota or a transfer proof can go to `TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}`,
--     the names the capture worker files to. The rows that say so wait for
--     the move (below). The path is still only a folder **inside**
--     the drive `doc_kind_drive` chose — the personal-data boundary (0035)
--     does not move.
--
--   * `same_bytes(sha256, kind)` answers *is this exact file already filed
--     where this kind would go?* The upload route asks before it sends
--     anything to Drive, and when the answer is yes it hands back the file
--     that is there instead of making a second one. Only within the same
--     drive, or a Google Chat capture for an ACCOUNTING kind: returning a file
--     from another drive would let the same bytes reach a record through a
--     drive the person may not be able to open.

-- ── 1. Date tokens in a task path ──────────────────────────────────────────

create or replace function ops_core.drive_path_for(p_kind ops_core.doc_kind_t, p_entity text)
returns text
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select replace(replace(
    coalesce(
      (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity::text = p_entity),
      (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity is null),
      upper(replace(p_kind::text, '_', ' '))),
    -- The longer token first: `{YYYY-MM}` is not a substring of
    -- `{YYYY-MM-DD}` (the braces see to that), but reading it in this order
    -- means nobody has to check.
    '{YYYY-MM-DD}', to_char(ops_core.office_day(), 'YYYY-MM-DD')),
    '{YYYY-MM}',    to_char(ops_core.office_day(), 'YYYY-MM'));
$$;
revoke all on function ops_core.drive_path_for(ops_core.doc_kind_t, text) from public;
grant execute on function ops_core.drive_path_for(ops_core.doc_kind_t, text) to authenticated;

-- **No row is added here, on purpose.** Pointing a nota at
-- `TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}` before the capture worker's tree has
-- been moved under `ops-talaliving` would start a third tree beside the two
-- the owner already has. IT adds the two rows (nota, transfer_proof) in
-- `ops_core.drive_paths` once the move is done — the table is IT's to edit
-- (0172), and the smoke file proves the path they will write resolves.

comment on table ops_core.drive_paths is
  'Which task folder under a drive''s ops-talaliving folder a file goes in, by kind and by the record it is '
  'filed against. No row = the kind''s own name. `{YYYY-MM}` and `{YYYY-MM-DD}` are the office day. '
  'Never chooses the drive (0035). (0172, 0203)';

-- ── 2. The same bytes, already filed ───────────────────────────────────────

create or replace function ops_core.same_bytes(p_sha256 text, p_kind text)
returns jsonb
-- Volatile, not stable: a refusal writes its audit row, and PostgREST runs a
-- stable function read-only (the 175 smoke guards exactly that).
language plpgsql volatile security definer set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t; v_slug text; a record;
begin
  if auth.uid() is null then
    return ops_core.refused('documents','attachment', null,'same_bytes',
      'not_signed_in','Please sign in first.');
  end if;
  v_kind := ops_core.doc_kind_of(p_kind);
  if v_kind is null then
    return ops_core.invalid('documents','attachment', null,'same_bytes',
      'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;
  if coalesce(btrim(p_sha256), '') !~ '^[0-9a-f]{64}$' then
    return ops_core.invalid('documents','attachment', null,'same_bytes',
      'sha256_required','A SHA-256 of the file, in hex, is required.',
      jsonb_build_object('field','sha256'));
  end if;
  select d.slug into v_slug from ops_core.doc_kind_drive d where d.kind = v_kind;

  -- A file this app filed in the same drive first, then a chat capture; the
  -- oldest of either, because it is the one the other records already point at.
  select x.id, x.filename, coalesce(x.web_view_link, x.url) as link, x.source
    into a
    from ops_core.attachments x
   where x.sha256 = btrim(p_sha256)
     and (x.drive_slug = v_slug
          or (x.source = 'chat' and x.url is not null and v_slug = 'accounting'))
   order by (x.drive_slug = v_slug) desc nulls last, x.uploaded_at
   limit 1;

  if not found then
    return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object('found', false));
  end if;
  return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object(
    'found', true, 'attachment_id', a.id, 'filename', a.filename,
    'link', a.link, 'source', a.source));
end $$;
revoke all on function ops_core.same_bytes(text, text) from public;
grant execute on function ops_core.same_bytes(text, text) to authenticated;

comment on function ops_core.same_bytes(text, text) is
  'Is this exact file (by SHA-256) already filed where this kind of document goes? Asked by the upload '
  'route before Drive, so a receipt the chat already filed is linked, not copied (0203, D359).';
