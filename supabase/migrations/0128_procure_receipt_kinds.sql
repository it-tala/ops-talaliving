-- 0128 — a receipt reads its documents the way every other seam does (B5).
--
-- Found by the procurement walk (F149): `ReceiveForm` sends the kinds it shows,
-- *Receiving Item* and *Delivery Note*, and `create_receipt` compared them to
-- the codes `goods_photo` and `delivery_note`. So a photograph that was there
-- read as missing, and in the live system no arrival could be recorded at all.
-- `05_procure_lifecycle` never saw it, because it passes the codes — the test
-- called the seam the way its author expected, not the way the screen does.
--
-- The fix is in the seam and not the screen: labels are what every other
-- evidence road accepts (`post_transaction`, `post_from_line`), through
-- `ops_core.doc_kind_of`, and a seam that alone insists on codes is the
-- exception that will be tripped over again.

create or replace function ops_procure.create_receipt(p_qty numeric, p_condition ops_procure.receipt_condition_t, p_documents jsonb, p_line_no text DEFAULT NULL::text, p_po_line_id uuid DEFAULT NULL::uuid, p_qc_by uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $$
declare
  l ops_procure.pr_lines; rcv_no text; rcv_id uuid;
  has_photo boolean; has_note boolean; confirmed boolean; notified boolean;
  replayed jsonb; res jsonb; v_docs jsonb; unknown text;
begin
  replayed := ops_core.idem_replay('procurement',
    format('create_receipt:%s:%s', coalesce(p_line_no, p_po_line_id::text), p_qty), p_key);
  if replayed is not null then return replayed; end if;

  if not (ops_core.has_permission('procurement.create') or ops_core.has_permission('inventory.create')) then
    return ops_core.refused('procurement','receipt', null,'report',
      'not_permitted','Recording an arrival needs procurement or inventory access.');
  end if;

  if (p_line_no is null) = (p_po_line_id is null) then
    return ops_core.invalid('procurement','receipt', null,'report',
      'anchor_required','A receiving report must point at a PR line or a PO line, and at exactly one.',
      jsonb_build_object('field','line_no'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('procurement','receipt', null,'report',
      'bad_qty','Nothing arriving is not an arrival.');
  end if;

  -- **Labels or codes, resolved once, here** (B5). The screen sends what it
  -- shows — *Receiving Item*, *Delivery Note* — as every other evidence road
  -- does, and `post_transaction` has read those through `doc_kind_of` since
  -- 0034. This seam compared the raw string to the code, so a photograph that
  -- was attached read as absent and every live receipt was refused
  -- `photo_required` (F149). A kind that resolves to nothing is named, rather
  -- than dropped into the same refusal.
  select jsonb_agg(jsonb_set(d, '{kind}', to_jsonb(ops_core.doc_kind_of(d ->> 'kind')::text))),
         min(d ->> 'kind') filter (where ops_core.doc_kind_of(d ->> 'kind') is null)
    into v_docs, unknown
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d;
  if unknown is not null then
    return ops_core.invalid('procurement','receipt', null,'report',
      'unknown_kind', format('"%s" is not a kind of document this system knows.', unknown),
      jsonb_build_object('field','documents'));
  end if;
  v_docs := coalesce(v_docs, '[]'::jsonb);

  select bool_or(d ->> 'kind' = 'goods_photo'),
         bool_or(d ->> 'kind' = 'delivery_note')
    into has_photo, has_note
    from jsonb_array_elements(v_docs) d;

  if not coalesce(has_photo, false) then
    return ops_core.invalid('procurement','receipt', null,'report',
      'photo_required',
      'A photograph of what arrived is required — it is the one thing whoever is there can always produce.',
      jsonb_build_object('field','documents'));
  end if;

  if p_line_no is not null then
    select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
    if not found then
      return ops_core.not_found('procurement','receipt', null,'report',
        format('Line %s not found.', p_line_no));
    end if;
  elsif not exists (select 1 from ops_procure.po_lines where id = p_po_line_id) then
    return ops_core.not_found('procurement','receipt', null,'report','No such order line.');
  end if;

  confirmed := coalesce(has_note, false);
  notified  := ops_procure.receipt_is_problem(p_condition);
  rcv_no    := ops_core.next_doc_number('rcv');

  insert into ops_procure.receipts
    (receipt_no, line_id, po_line_id, qty_received, condition,
     received_by, qc_by, note, status, confirmed_by, confirmed_at)
  values (rcv_no, l.id, p_po_line_id, p_qty, p_condition,
          auth.uid(),
          case when confirmed then coalesce(p_qc_by, auth.uid()) else null end,
          nullif(btrim(p_note), ''),
          case when confirmed then 'CONFIRMED' else 'REPORTED' end::ops_procure.receipt_status_t,
          case when confirmed then auth.uid() else null end,
          case when confirmed then now() else null end)
  returning id into rcv_id;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select (d ->> 'attachment_id')::uuid, 'receipt', rcv_no,
         (d ->> 'kind')::ops_core.doc_kind_t, auth.uid()
    from jsonb_array_elements(v_docs) d;

  perform ops_core.emit('procurement','procurement.receipt.recorded', rcv_no,
    jsonb_build_object('receipt_no', rcv_no, 'condition', p_condition,
                       'notified', notified,
                       'status', case when confirmed then 'CONFIRMED' else 'REPORTED' end));

  res := ops_core.ok('procurement','receipt', rcv_no,
    case when confirmed then 'receive' else 'report' end,
    jsonb_build_object('receipt_no', rcv_no, 'qty', p_qty,
                       'condition', p_condition, 'notified', notified,
                       'status', case when confirmed then 'CONFIRMED' else 'REPORTED' end));
  return ops_core.idem_remember('procurement',
    format('create_receipt:%s:%s', coalesce(p_line_no, p_po_line_id::text), p_qty), p_key, res);
end $$;
