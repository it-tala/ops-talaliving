-- 0161_acct_book_evidence_group.sql — one photo, several inbox rows, one booking.
--
-- ── What 0124 fixed, and what it left ───────────────────────────────────
--
-- Owner, 2026-09-24: *harusnya 1 dokumen bisa memiliki beberapa line …
-- alih-alih ada 5 dokumen yang sama untuk di record ke ledger satu satu lebih
-- baik 1 dokumen ada 5 line untuk di approve jadi satu.*
--
-- `book_evidence` (0124) made one inbox row carry several lines. But the
-- capture worker in john-lau does not file one row per photo: it files one
-- row per **slot** the extractor read — `<event>~x0`, `<event>~x1`, … — each
-- with its own attachment row pointing at the same Drive file. On
-- 2026-09-24 ten of the pending documents were split that way, the usual
-- shape being a transfer and its admin fee. So the queue still showed the same
-- photo two, three, five times, and each copy could only be booked on its own.
--
-- The screen now groups those rows back into the document they came from and
-- this seam books the group in one act: one ledger row, every line, and every
-- inbox row of the photo marked CONFIRMED against it — or nothing.
--
-- ── Why a new name rather than a new parameter ──────────────────────────
--
-- An optional `p_also_ref_ids` on `book_evidence` would be a second signature
-- and break every existing caller (see `00_no_overloads.sql`). So this is a
-- separate function that **calls** `book_evidence` for the first row — every
-- rule about money, authority and the lines adding up stays in exactly one
-- place — and only adds what is new: that the other rows exist, are still
-- PENDING, are the same file, and are closed by the same booking.
--
-- ── Why "the same file" is checked, not trusted ─────────────────────────
--
-- The screen groups by the `<event>` prefix of `ref_id`. The seam does not
-- rely on that: it refuses unless every row's attachment is the same URL. Two
-- different photos confirmed as one would file one of them against a ledger
-- row it does not prove, and the other nowhere.

create or replace function ops_acct.book_evidence_group(
  p_ref_ids       text[],
  p_account_code  text,
  p_direction     ops_acct.direction_t,
  p_amount        numeric,
  p_type_code     text,
  p_description   text,
  p_trx_date      date    default null,
  p_vendor_code   text    default null,
  p_project_code  text    default null,
  p_lines         jsonb   default '[]'::jsonb,
  p_remark        text    default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  refs      text[];
  head      text;
  n_found   int;
  n_pending int;
  n_urls    int;
  posted    jsonb;
  trx       text;
begin
  /* Order-preserving, blanks and repeats dropped: the first row is the one
     the ledger row's `source_ref` and the document link are taken from. */
  select coalesce(array_agg(r order by ord), '{}')
    into refs
    from (select distinct on (btrim(r)) btrim(r) as r, ord
            from unnest(coalesce(p_ref_ids, '{}')) with ordinality as u(r, ord)
           where coalesce(btrim(r), '') <> ''
           order by btrim(r), ord) d;

  if cardinality(refs) = 0 then
    return ops_core.invalid('accounting','inbox', null,'book',
      'ref_required', 'Say which inbox rows this document is.',
      jsonb_build_object('field','ref_ids'));
  end if;
  head := refs[1];

  /* The authority checks are `book_evidence`'s; they are repeated here only
     so a caller without them learns nothing about the rows below. */
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','inbox', head,'book',
      'authority_required',
      'Booking a document into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', head,'book',
      'authority_required',
      'This also decides what the document belongs to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;

  /* Locked, so two people confirming the same photo from two screens cannot
     both get past the PENDING check. */
  perform 1 from ops_acct.evidence_inbox
   where ref_id = any(refs) order by ref_id for update;

  select count(*),
         count(*) filter (where i.status = 'PENDING'),
         count(distinct coalesce(a.url, a.storage_path, a.id::text))
    into n_found, n_pending, n_urls
    from ops_acct.evidence_inbox i
    join ops_core.attachments a on a.id = i.attachment_id
   where i.ref_id = any(refs);

  if n_found <> cardinality(refs) then
    return ops_core.not_found('accounting','inbox', head,'book',
      format('%s of the %s inbox rows named do not exist.',
             cardinality(refs) - n_found, cardinality(refs)));
  end if;
  if n_pending <> n_found then
    return ops_core.conflict('accounting','inbox', head,'book',
      'already_resolved',
      format('%s of the %s rows of this document are already decided — nothing changed. '
             || 'Reload the queue.', n_found - n_pending, n_found));
  end if;
  if n_urls > 1 then
    return ops_core.invalid('accounting','inbox', head,'book',
      'not_one_document',
      'These inbox rows are different files. Only rows of the same photo can be booked as one document.',
      jsonb_build_object('field','ref_ids','files',n_urls));
  end if;

  /* Everything about money, the lines and the first row is decided there. */
  posted := ops_acct.book_evidence(
    p_ref_id       => head,
    p_account_code => p_account_code,
    p_direction    => p_direction,
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => p_description,
    p_trx_date     => p_trx_date,
    p_vendor_code  => p_vendor_code,
    p_project_code => p_project_code,
    p_lines        => p_lines,
    p_remark       => p_remark,
    p_key          => p_key);

  if not ops_core.said_ok(posted) then
    return posted;
  end if;

  trx := posted -> 'data' ->> 'trx_no';

  /* The rest of the photo's rows close against the same ledger row. Not
     linked a second time: they are the same file, and one link is the proof. */
  update ops_acct.evidence_inbox
     set status          = 'CONFIRMED',
         produced_trx_no = trx,
         resolved_by     = auth.uid(),
         resolved_at     = now(),
         resolve_note    = format('Booked with %s as one document.', head)
   where ref_id = any(refs[2:])
     and status = 'PENDING';

  return jsonb_set(posted, '{data,ref_ids}', to_jsonb(refs));
end $$;

comment on function ops_acct.book_evidence_group(text[], text, ops_acct.direction_t, numeric, text,
                                                 text, date, text, text, jsonb, text, text) is
  'One photo filed as several inbox rows, booked as one document: calls book_evidence '
  'for the first row, then marks every other row of the same file CONFIRMED against '
  'the same ledger row. Refuses unless all rows exist, are PENDING and are one file.';

revoke execute on function ops_acct.book_evidence_group(text[], text, ops_acct.direction_t, numeric, text,
                                                        text, date, text, text, jsonb, text, text)
  from public;
grant execute on function ops_acct.book_evidence_group(text[], text, ops_acct.direction_t, numeric, text,
                                                       text, date, text, text, jsonb, text, text)
  to authenticated;
