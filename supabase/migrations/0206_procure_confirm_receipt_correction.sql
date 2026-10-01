-- 0206_procure_confirm_receipt_correction.sql — the daylight count reaches the
-- database (F215, D364).
--
-- `/procurement/penerimaan` completes a reported arrival: the signed tanda
-- terima, who checked it, and **what the quantity and condition turned out to
-- be** once somebody counted in daylight (D131). The screen has always sent
-- `qty_received` and `condition`; the demo applied them; the real client never
-- passed them, because `confirm_receipt` (0086) had no parameter to receive
-- them. So in production the night's rough count was what got signed for —
-- and what `ops_inv.stock_from_receipt` put on the rack — while the toast said
-- the corrected number "now counts as received".
--
-- Both parameters are optional and appended, so every existing caller (the
-- smoke files, John Lau's catalogue) means what it meant: omitted = the
-- reported figure stands.
--
-- **The correction and the status change are one UPDATE.** Stock is written
-- by the `stock_from_receipt` trigger (`after update of status`), which reads
-- `new.qty_received` and `new.condition`. Correcting the quantity in a second
-- statement after the status flip would stock the night's number; before it,
-- in its own statement, would be a window where the row says one thing and
-- the trigger has not run. One statement leaves neither.
--
-- The row is now read `for update`: two people completing the same arrival at
-- once would otherwise both see REPORTED, and the second one's correction
-- would overwrite the first one's after the first one's quantity was already
-- stocked. Now the second waits, sees CONFIRMED, and is told so (409).
--
-- The audit row carries before and after (`ops_core.ok`'s `p_before` /
-- `p_after`) — `{qty, condition, status}`, the same shape the demo writes —
-- because a corrected quantity is exactly the change somebody will later ask
-- *who* made. The outbox event carries the corrected figures, not the
-- reported ones.
--
-- Unchanged: the three refusals (not permitted, no such receipt, already
-- confirmed), the optional tanda terima (0086's reasoning stands), the
-- idempotency key. New: a corrected quantity of zero or less is refused the
-- same way `create_receipt` refuses one (`bad_qty`), rather than reaching the
-- table's check constraint as an exception.

drop function if exists ops_procure.confirm_receipt(text, uuid, text, text, uuid);

create or replace function ops_procure.confirm_receipt(
  p_receipt_no text,
  p_qc_by uuid default null,
  p_note text default null,
  p_key text default null,
  p_delivery_note_attachment_id uuid default null,
  p_qty numeric default null,
  p_condition ops_procure.receipt_condition_t default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.receipts; c ops_procure.receipts; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','confirm_receipt:' || p_receipt_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receipt', p_receipt_no,'confirm',
      'not_permitted',
      'Signing for a delivery is procurement''s — they hold the order and can check what arrived against it.');
  end if;

  select * into r from ops_procure.receipts where receipt_no = p_receipt_no for update;
  if not found then
    return ops_core.not_found('procurement','receipt', p_receipt_no,'confirm','No such receipt.');
  end if;
  if r.status = 'CONFIRMED' then
    return ops_core.conflict('procurement','receipt', p_receipt_no,'confirm',
      'already_confirmed', format('%s was already signed for.', p_receipt_no));
  end if;
  if p_qty is not null and p_qty <= 0 then
    return ops_core.invalid('procurement','receipt', p_receipt_no,'confirm',
      'bad_qty','Nothing arriving is not an arrival. If none of it came, say so in the note and leave the quantity as reported.',
      jsonb_build_object('field','qty_received'));
  end if;

  -- One statement: the corrected figures are what the stock trigger sees.
  update ops_procure.receipts
     set qty_received = coalesce(p_qty, qty_received),
         condition    = coalesce(p_condition, condition),
         status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now(),
         qc_by = coalesce(p_qc_by, auth.uid()),
         note  = coalesce(nullif(btrim(p_note), ''), note)
   where id = r.id
  returning * into c;

  if p_delivery_note_attachment_id is not null then
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (p_delivery_note_attachment_id, 'receipt', p_receipt_no, 'delivery_note', auth.uid());
  end if;

  perform ops_core.emit('procurement','procurement.receipt.confirmed', p_receipt_no,
    jsonb_build_object('receipt_no', p_receipt_no, 'qty', c.qty_received,
                       'condition', c.condition));
  res := ops_core.ok('procurement','receipt', p_receipt_no,'confirm',
    jsonb_build_object('receipt_no', p_receipt_no, 'status','CONFIRMED',
                       'qty_received', c.qty_received, 'condition', c.condition),
    jsonb_build_object('qty', r.qty_received, 'condition', r.condition, 'status', r.status),
    jsonb_build_object('qty', c.qty_received, 'condition', c.condition, 'status', c.status));
  return ops_core.idem_remember('procurement','confirm_receipt:' || p_receipt_no, p_key, res);
end $$;

-- A new identity, so its grants are restated: off PUBLIC (and so off `anon`,
-- 0125), onto `authenticated`, which decides inside.
revoke all on function ops_procure.confirm_receipt(
  text, uuid, text, text, uuid, numeric, ops_procure.receipt_condition_t) from public;
grant execute on function ops_procure.confirm_receipt(
  text, uuid, text, text, uuid, numeric, ops_procure.receipt_condition_t) to authenticated;
