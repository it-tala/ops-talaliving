-- 0129 — a lump-sum request line can be paid from its row (B9, D298).
--
-- Found by the second procurement walk (F149): paying the delivery charge — a
-- line with no quantity, by design (D75) — from *Post Rp… to the ledger* as
-- SUPPLIERS was refused `line_detail_required`, because a purchase type asks
-- every detail line for a quantity and a unit price, and `post_from_line`
-- passed the line's own, which are empty. The requests board offers that
-- button on every approved line.
--
-- Owner's choice (2026-09-23): the detail is **1 lot × the amount paid**.
-- Only the ledger's detail line says so; the request line keeps no quantity,
-- so nothing downstream starts computing a price per unit that was never
-- quoted. A line with a quantity is posted exactly as before.

create or replace function ops_acct.post_from_line(p_line_no text, p_amount numeric, p_account_code text, p_type_code text, p_attachment_id uuid, p_trx_date date DEFAULT NULL::date, p_document_kind text DEFAULT 'Payment Proof'::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_acct', 'ops_core', 'ops_procure', 'pg_temp'
AS $$
declare
  l record; v_ven text; v_proj text; v_src text;
  posted jsonb; allocated jsonb; v_trx_no text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_from_line:' || p_line_no, p_key);
  if replayed is not null then return replayed; end if;

  -- **The authority is checked here as well as inside `post_transaction`.**
  -- Not belt and braces: the refusal below names the line, which is what the
  -- person is looking at, and it happens before anything is read about a line
  -- they may not be allowed to see either.
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_line_no,'post_from_line',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  -- The project hangs off the **document**, not the line: a request is raised
  -- for one project and its lines inherit it. Reading it from the line would
  -- find no column, which is how the first draft of this seam failed.
  select pl.id, pl.line_no_full, pl.description, pl.qty, pl.uom, pl.unit_price,
         pl.removed_at, v.code as vendor_code, pj.code as project_code
    into l
    from ops_procure.pr_lines pl
    join ops_procure.pr_documents d on d.id = pl.doc_id
    left join ops_procure.vendors  v  on v.id  = pl.vendor_id
    left join ops_procure.projects pj on pj.id = d.project_id
   where pl.line_no_full = p_line_no;

  if not found then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'pr_line_not_found', format('Line %s does not exist in procurement.', p_line_no),
      jsonb_build_object('field','line_no'));
  end if;
  -- Removed, not deleted (A2/A5). The row is still there and still readable,
  -- and paying against it is the thing that must not happen.
  if l.removed_at is not null then
    return ops_core.conflict('accounting','transaction', p_line_no,'post_from_line',
      'line_removed', format('Line %s has been removed.', p_line_no));
  end if;

  -- **No proof, no payment** (D85). Stated here rather than left to
  -- `post_transaction`'s document check, because the message a person needs at
  -- this screen names the transfer receipt, not "documents".
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt or the nota before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  -- The same `source_ref` the demo builds, and it is load-bearing: two people
  -- paying the same line for the same amount on the same day is a duplicate,
  -- and `post_transaction` refuses a repeated `source_ref` with the number of
  -- the row that already exists. An idempotency key protects one double tap;
  -- this protects two laptops.
  v_src := format('pr-line:%s:%s:%s', p_line_no,
                  coalesce(p_trx_date, ops_core.office_day()), p_amount);

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    -- The line number lives in the description too, so the ledger reads
    -- correctly on its own without opening the request.
    p_description  => format('%s — %s', l.description, p_line_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => l.vendor_code,
    p_project_code => l.project_code,
    -- What was bought, how many, at what price — so the ledger row can be read
    -- without opening the PR (D86).
    --
    -- A lump-sum line — delivery, a service, a deposit — has no quantity, on
    -- purpose (D75). A purchase type still asks every detail line for one, so
    -- the detail says what it is: **1 lot at the amount paid** (D298, B9). Not
    -- a quantity invented for the request line, which stays without one; a
    -- description of this payment, which really was one lot of that service.
    p_lines        => jsonb_build_array(jsonb_build_object(
                        'description', l.description,
                        'qty',         coalesce(l.qty, 1),
                        'uom',         case when l.qty is null then 'lot' else l.uom end,
                        'unit_price',  case when l.qty is null then p_amount else l.unit_price end,
                        'amount',      p_amount)),
    p_source_ref   => v_src,
    p_key          => null);

  -- Its refusal, verbatim. Rewording it here would be a second description of a
  -- rule this function does not own (A7) — and `post_transaction` refuses for
  -- reasons this one cannot see, such as a type code that does not exist.
  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';

  allocated := ops_acct.allocate_payment(
    p_trx_no      => v_trx_no,
    p_amount      => p_amount,
    p_pr_line_no  => p_line_no,
    p_method      => 'transfer',
    p_key         => null);

  -- **The posting stands even if the allocation does not.** The money has left
  -- the account; saying otherwise would be a lie, and re-posting to "fix" it is
  -- how a supplier gets paid twice. The refusal names the transaction that
  -- exists, so somebody can allocate it by hand.
  if allocated ->> 'outcome' <> 'ok' then
    return ops_core.conflict('accounting','transaction', v_trx_no,'post_from_line',
      'allocation_failed',
      format('%s was posted, but could not be counted against %s: %s',
             v_trx_no, p_line_no, allocated -> 'error' ->> 'message'),
      jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                         'from', allocated -> 'error'));
  end if;

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_from_line',
    jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                       'amount', p_amount, 'account', p_account_code,
                       'type', p_type_code,
                       'document', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof')));
  return ops_core.idem_remember('accounting','post_from_line:' || p_line_no, p_key, res);
end $$;
