-- 0086_acct_procure_parity_fixes.sql — three gaps `check-api-parity.mjs` found
-- between the demo and the real client, closed at the seam rather than papered
-- over in TypeScript.
--
-- Each one is a case where the real client would otherwise have had to
-- reimplement, guess at, or silently drop something that belongs in the
-- database — exactly the trap F94 already named once: a cast is not an
-- implementation.

-- ── 1. `ops_core.v_audit` was missing `actor_id` ────────────────────────────
--
-- The `AuditRow` contract (`src/demo/state.ts`) carries both `actor_id` and
-- `actor_email` — the uuid for anything that needs to act on it, the email
-- because nobody wants to resolve a uuid to read a trail. `0023` only ever
-- exposed the email. Nothing reads `actor_id` off this view today, but the
-- contract requires it, and a view that silently drops a contracted field is
-- the same shape of bug the accounting client was just fixed for.
-- `create or replace view` refuses to change an existing column's position or
-- name — proved against this cluster — so the new column is appended at the
-- end rather than restated next to `actor_id`'s natural place beside `at`.
-- `AuditRow` is read as a named object, never positionally, so this changes
-- nothing for any reader.
create or replace view ops_core.v_audit as
  select a.id::text                     as id,
         a.at,
         coalesce(u.email, 'system')    as actor_email,
         a.service,
         a.entity,
         coalesce(a.entity_no, '')      as entity_no,
         a.action,
         a.outcome,
         a.reason,
         a.detail,
         a.actor_id
    from ops_core.audit_log a
    left join ops_core.users u on u.id = a.actor_id;

alter view ops_core.v_audit set (security_invoker = on);

-- ── 2. `confirm_receipt` had nowhere to put the signed tanda terima ────────
--
-- **Not made required here, and that is deliberate, not an oversight.**
-- `smoke/05_procure_lifecycle.sql` already asserts, on purpose, that a
-- confirmed receipt's `delivery_note_attachment_id` reads null — "confirmed
-- by a person, not by a document." Requiring it at the seam would reverse
-- that decision, and reversing a documented evidence-control rule is not this
-- migration's call to make. The demo's screen requires it in its own
-- validation, which is a stricter UX rule the seam is not obligated to
-- mirror — `confirmReceipt` stays on `PENDING_PARITY` for that reason.
--
-- What was genuinely missing: **no parameter existed to record one at all.**
-- A screen (or a future stricter workflow) that has a signed tanda terima in
-- hand had no way to attach it while confirming — only a separate call after
-- the fact, racing the status change. `p_delivery_note_attachment_id` is
-- optional; when given, it is linked in the same transaction as the status
-- change, because a confirmation and its evidence are one fact when both are
-- offered together (rule 3, `docs/plan/phase-2/README.md`).
-- `create or replace function` only replaces an existing definition when the
-- argument *types*, in order, are unchanged (proved against this cluster —
-- appending a parameter otherwise leaves both versions as overloads). The new
-- parameter goes at the end and the old four-argument form is dropped first,
-- so there is exactly one `confirm_receipt` afterwards, not two.
drop function if exists ops_procure.confirm_receipt(text, uuid, text, text);

create or replace function ops_procure.confirm_receipt(
  p_receipt_no text,
  p_qc_by uuid default null,
  p_note text default null,
  p_key text default null,
  p_delivery_note_attachment_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.receipts; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','confirm_receipt:' || p_receipt_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receipt', p_receipt_no,'confirm',
      'not_permitted',
      'Signing for a delivery is procurement''s — they hold the order and can check what arrived against it.');
  end if;

  select * into r from ops_procure.receipts where receipt_no = p_receipt_no;
  if not found then
    return ops_core.not_found('procurement','receipt', p_receipt_no,'confirm','No such receipt.');
  end if;
  if r.status = 'CONFIRMED' then
    return ops_core.conflict('procurement','receipt', p_receipt_no,'confirm',
      'already_confirmed', format('%s was already signed for.', p_receipt_no));
  end if;
  update ops_procure.receipts
     set status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now(),
         qc_by = coalesce(p_qc_by, auth.uid()),
         note  = coalesce(nullif(btrim(p_note), ''), note)
   where id = r.id;

  if p_delivery_note_attachment_id is not null then
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (p_delivery_note_attachment_id, 'receipt', p_receipt_no, 'delivery_note', auth.uid());
  end if;

  perform ops_core.emit('procurement','procurement.receipt.confirmed', p_receipt_no,
    jsonb_build_object('receipt_no', p_receipt_no, 'qty', r.qty_received,
                       'condition', r.condition));
  res := ops_core.ok('procurement','receipt', p_receipt_no,'confirm',
    jsonb_build_object('receipt_no', p_receipt_no, 'status','CONFIRMED'));
  return ops_core.idem_remember('procurement','confirm_receipt:' || p_receipt_no, p_key, res);
end $$;

-- ── 3. `set_expected_delivery` had nowhere to put the reason for moving a
--       date the supplier already agreed to ─────────────────────────────────
--
-- The screen refuses to move an issued order's already-agreed date without a
-- reason (D135's sibling rule) — "the date was agreed with the supplier;
-- moving it is something they said, write what they said" — but the seam had
-- no parameter to carry that sentence into the audit trail. Optional, because
-- the rule about *when* a reason is required is the screen's to enforce (it
-- is UX, not a security boundary): a date that was never agreed needs no
-- explanation for changing.
drop function if exists ops_procure.set_expected_delivery(text, date);

create or replace function ops_procure.set_expected_delivery(
  p_po_no text, p_date date, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'set_expected',
      'not_permitted','Setting the expected date needs procurement access.');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'set_expected','No such order.');
  end if;

  update ops_procure.purchase_orders set expected_delivery = p_date where id = po.id;
  return ops_core.say('procurement','purchase_order', p_po_no,'set_expected','ok', 200,
    null, p_reason,
    jsonb_build_object('po_no', p_po_no, 'expected_delivery', p_date),
    null, to_jsonb(po.expected_delivery), to_jsonb(p_date));
end $$;

-- Both functions changed identity (new argument lists), so both need their
-- `grant execute` restated — a grant belongs to a specific overload's oid,
-- not to the name, and dropping the old overload dropped its grant with it.
grant execute on function
  ops_procure.confirm_receipt(text, uuid, text, text, uuid),
  ops_procure.set_expected_delivery(text, date, text)
  to authenticated;
