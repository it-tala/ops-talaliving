-- 0118_acct_book_evidence.sql — one nota, one confirmation, several lines.
--
-- ── What the owner asked for, and why it is not a screen change ─────────
--
-- Owner, 2026-09-23: *alih alih konfirmasi tiap baris, buat per dokumen saja.
-- Jadi user bisa klik 1 dokumen, lalu bisa konfirmasi beberapa line sekaligus
-- berupa deskripsi, qty, satuan, harga — sementara tanggal, vendor, dan
-- project sama semua.*
--
-- That is the shape of a nota, stated exactly: one header everybody shares,
-- several lines that differ. `transactions` + `transaction_lines` have always
-- had that shape. What was missing is a door that writes both **from a
-- document**, in one act.
--
-- ── The two bugs this closes, from john-lau's own backlog ───────────────
--
-- `docs/backlog.md` in `it-tala/john-lau` carries two items marked SEGERA —
-- the level defined there as *uang bisa tercatat salah, atau sesuatu hilang
-- tanpa ada yang tahu*. Both are the same mistake seen from two sides, and
-- both are about the **unit of review**:
--
--   §21  One transfer proof became FOUR queue rows. Hand-patched twice, and
--        the note says *akan terulang*: confirm all four and the same money is
--        booked four times.
--   §14  A nota was read as 3 items of 5. Items four and five exist nowhere,
--        and *tidak satu pun lapisan bisa mengetahuinya*.
--
-- Review row by row and both are invisible: four rows look like four
-- documents, and three lines look like a whole receipt. Review **per
-- document** and §21 cannot happen — one document is one card, whatever the
-- extractor produced — while §14 becomes visible, because the lines are
-- listed against the photo and a person reading both can see the gap.
--
-- ── Why the lines must add up, in the one place this system blocks ──────
--
-- A6 says warn, never block. This refuses, and the test is the one `0205`
-- used for the board going negative: **can the warning be acted on by the
-- person seeing it?** Here it can, and by nobody else afterwards — they are
-- holding the photo, at the moment they are reading it. An hour later the
-- context is gone and a mismatched row is a puzzle for whoever finds it.
--
-- So when lines are given they must sum to the amount, and the refusal names
-- both figures and the gap. That is §14's missing net: a nota read as 3 of 5
-- cannot be confirmed as though it were whole. Somebody who genuinely needs a
-- difference — rounding, an admin fee, PPN — adds a line for it, which is
-- what the document says anyway.
--
-- The alternative was deriving the total from the lines and never asking. It
-- reads simpler and it hides exactly the case this exists to catch: the
-- missing fifth item would make a smaller, perfectly consistent total, and
-- nothing would ever disagree.
--
-- ── Both authorities, because it does both things ───────────────────────
--
-- Posting money is `post_ledger`; deciding what a loose document belongs to
-- is `resolve_inbox` (D24 — modules open screens, authorities allow
-- decisions). This seam does both in one act, so it requires both rather than
-- letting one stand in for the other. Checked against production before
-- shipping: all five people who hold either hold both, so this blocks nobody
-- today — and the day somebody holds only one, the refusal names which.
--
-- ── All or nothing ──────────────────────────────────────────────────────
--
-- `post_transaction` validates its documents and lines **before** it inserts
-- anything, so relaying its refusal leaves nothing written. The inbox row is
-- only marked once the ledger row exists. A document that is booked but still
-- PENDING would be confirmed twice by the next person; one marked CONFIRMED
-- with no ledger row behind it is evidence that has quietly vanished.


/* One spelling of a rupiah figure, so a refusal reads the way the people
   reading it write money. Immutable and tiny on purpose: it is reached from
   inside a message, and a message that can fail is a refusal nobody sees. */
create or replace function ops_acct.rupiah(p_amount numeric)
returns text
language sql immutable set search_path = pg_temp as $$
  select case when p_amount < 0 then '-' else '' end
      || replace(to_char(abs(p_amount), 'FM999,999,999,999,990'), ',', '.')
$$;

create or replace function ops_acct.book_evidence(
  p_ref_id        text,
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
  row       ops_acct.evidence_inbox;
  replayed  jsonb;
  posted    jsonb;
  trx       text;
  line_sum  numeric;
  n_lines   int;
begin
  replayed := ops_core.idem_replay('accounting','book_evidence:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book',
      'authority_required',
      'Booking a document into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book',
      'authority_required',
      'This also decides what the document belongs to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book','No such inbox row.');
  end if;
  if row.status <> 'PENDING' then
    return ops_core.conflict('accounting','inbox', p_ref_id,'book',
      'already_resolved', format('This document is already %s — nothing changed.', row.status));
  end if;

  /* The net §14 asks for. Counted before anything is written, and the message
     carries both numbers because *they disagree* is not actionable and
     *2.500 against 15.850.000* is. */
  select count(*), coalesce(sum((l ->> 'amount')::numeric), 0)
    into n_lines, line_sum
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  if n_lines > 0 and line_sum <> p_amount then
    return ops_core.invalid('accounting','inbox', p_ref_id,'book',
      'lines_do_not_add_up',
      /* Grouped with `.`, not with whatever the server's locale happens to
         use. `to_char`'s `G` gave `500,000` here, and to an Indonesian reader
         that is five hundred and a decimal — the one kind of ambiguity a
         message about money cannot afford. Caught by the smoke file, which
         asserts the figures rather than the wording. */
      format('The document says %s and its %s line(s) add up to %s — a difference of %s. '
             || 'Add a line for the rest, or correct one, before booking it.',
             ops_acct.rupiah(p_amount),
             n_lines,
             ops_acct.rupiah(line_sum),
             ops_acct.rupiah(line_sum - p_amount)),
      jsonb_build_object('field','lines','amount',p_amount,
                         'lines_total',line_sum,'difference',line_sum - p_amount));
  end if;

  /* One act: the ledger row, its lines, and this document filed against it.
     `post_transaction` owns every rule about money — the account, the type,
     the vendor, the direction — and none of them is restated here. A second
     copy of those rules is a second answer to the same question. */
  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => p_direction,
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => p_description,
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', row.attachment_id,
                        'kind', coalesce(row.extracted ->> 'doc_kind', 'nota'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => p_vendor_code,
    p_project_code => p_project_code,
    p_lines        => coalesce(p_lines, '[]'::jsonb),
    p_remark       => p_remark,
    p_source_ref   => 'inbox:' || p_ref_id);

  /* Relayed whole, not summarised. Its refusals name the account that does
     not exist or the vendor that does not resolve, and those are the words
     the person needs. Nothing has been written at this point. */
  if not ops_core.said_ok(posted) then
    return posted;
  end if;

  trx := posted -> 'data' ->> 'trx_no';

  update ops_acct.evidence_inbox
     set status          = 'CONFIRMED',
         produced_trx_no = trx,
         resolved_by     = auth.uid(),
         resolved_at     = now()
   where ref_id = p_ref_id;

  return ops_core.idem_remember('accounting','book_evidence:' || p_ref_id, p_key,
    ops_core.ok('accounting','inbox', p_ref_id,'book',
      jsonb_build_object('trx_no', trx, 'lines', n_lines, 'amount', p_amount),
      to_jsonb(row),
      jsonb_build_object('status','CONFIRMED','trx_no',trx)));
end $$;

comment on function ops_acct.book_evidence(text, text, ops_acct.direction_t, numeric, text,
                                           text, date, text, text, jsonb, text, text) is
  'One nota, one confirmation, several lines. Books the ledger row, its lines and '
  'this document in a single act, then marks the inbox row CONFIRMED. Refuses when '
  'the lines do not add up to the document total — the one moment somebody is '
  'holding the photo and can fix it.';

/* **Revoked from PUBLIC first, then granted.** A new function is executable
   by PUBLIC the moment it exists, and `0125` — which moved all 175 of the
   ones that existed then — has already run by the time this file does. A
   migration cannot fix the future, so every migration after it carries these
   two lines.
   This is not a rule anybody has to remember: `98_core_execute_grants.sql`
   derives the set from `pg_proc` and fails naming the function. It caught
   this one on the first run, before it reached a review, let alone
   production. */
revoke execute on function ops_acct.book_evidence(text, text, ops_acct.direction_t, numeric, text,
                                                  text, date, text, text, jsonb, text, text)
  from public;
grant execute on function ops_acct.book_evidence(text, text, ops_acct.direction_t, numeric, text,
                                                 text, date, text, text, jsonb, text, text)
  to authenticated;
