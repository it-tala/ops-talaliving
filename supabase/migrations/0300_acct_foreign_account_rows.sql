-- 0300 — a single row on a non-rupiah account must say its amount is in that
-- currency (D458, F299).
--
-- On a foreign-currency account (BCA USD 081) the amount column is that
-- account's own currency (0285, D444): dollars. The transfer seam already
-- knows this — a transfer that touches a USD account needs the dollars in
-- `billed_amount`, and a conversion goes through `record_conversion` (0298).
-- The single-row seam did not: on 18/11 a USD → IDR conversion was booked
-- from Purchase Verification as two plain rows, 081 OUT "109.374.000" and
-- 064 IN, so the dollar account lost a hundred million dollars on paper and
-- the pair was not a transfer (RUNLOG 2026-11-25, D456).
--
-- The rule, in `post_transaction` (every single-row path goes through it:
-- book_evidence, book_evidence_to_line, book_evidence_group, post_from_line,
-- the form's own post):
--
-- * an account whose currency is IDR: unchanged;
-- * a non-IDR account, written as one leg of `post_transfer` (which settles
--   the currency itself, 0285): unchanged. Told apart by the call stack
--   (`pg_context`), not by an argument the client could fill in;
-- * a non-IDR account, written as a row of its own: refused
--   (`foreign_account`) unless the caller states the currency —
--   `p_billed_currency` = the account's currency and `p_billed_amount` = the
--   amount. The refusal names the right road: a conversion is
--   *Rekening pimpinan → Catat konversi*, a move between our accounts is a
--   transfer.
--
-- The seams that book from the inbox carry no billed arguments, so from
-- Verifikasi a single row on 081 is now always refused — which is D456: what
-- arrives on 081 unseen is a bank reading, not a typed row. Rupiah accounts,
-- 064 included, book as before. Same signature, no overload; the body is
-- 0271's with the guard added after the billed checks.

create or replace function ops_acct.post_transaction(
  p_account_code text,
  p_direction ops_acct.direction_t,
  p_amount numeric,
  p_type_code text,
  p_description text,
  p_documents jsonb,                   -- [{"attachment_id":…,"kind":"nota"}]
  p_trx_date date default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_lines jsonb default '[]'::jsonb,   -- [{"kind":"item","description":…,"qty":…,"unit_price":…,"amount":…}]
  p_remark text default null,
  p_source_ref text default null,
  p_key text default null,
  p_billed_currency text default null, -- 0271: the bill's own currency, with p_billed_amount
  p_billed_amount numeric default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  acc ops_acct.accounts; ty ops_acct.transaction_types;
  ven uuid; proj uuid; v_trx_no text; v_trx_id uuid;
  has_primary boolean; n_lines int; n_items int; lines_total numeric; missing text;
  any_negative boolean; v_billed_ccy text;
  ctx text;
  src text; existing text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_transaction', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_source_ref,'post',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'amount_positive',
      'Amount must be greater than zero. Direction lives in the IN/OUT column.',
      jsonb_build_object('field','amount_idr'));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'description_required','Description is required.',
      jsonb_build_object('field','description'));
  end if;

  select * into acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_account', format('There is no account %s.', p_account_code),
      jsonb_build_object('field','account_code'));
  end if;
  select * into ty from ops_acct.transaction_types where code = p_type_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_type', format('There is no transaction type %s.', p_type_code),
      jsonb_build_object('field','type_code'));
  end if;

  -- The evidence rule (D85), through `doc_kind_of` (0034).
  select bool_or(ops_core.doc_kind_of(d ->> 'kind')
                   in ('nota','transfer_proof','goods_photo','rekening_koran'))
    into has_primary
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d;

  select string_agg(d ->> 'kind', ', ') into missing
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d
   where ops_core.doc_kind_of(d ->> 'kind') is null;
  if missing is not null then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'unknown_kind',
      format('"%s" is not a kind of document this system files.', missing),
      jsonb_build_object('field','documents','given', missing));
  end if;
  if not coalesce(has_primary, false) then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'evidence_required',
      'A ledger row needs at least one nota, transfer proof, bank statement or photo of what arrived. Supporting documents are welcome, but they cannot stand alone.',
      jsonb_build_object('field','documents'));
  end if;

  /* ── the lines, read once (0271) ──────────────────────────────────────
   *
   * Each line's kind is what the caller sent, or what its description
   * suggests. The amount is always positive; a discount is subtracted in
   * the sum. A word that is not a kind is a refusal that names it. */
  select count(*),
         coalesce(sum(case when x.kind = 'discount' then -x.amount else x.amount end), 0),
         count(*) filter (where x.kind = 'item'),
         coalesce(bool_or(x.amount < 0), false),
         string_agg(x.raw_kind, ', ') filter (where x.kind is null)
    into n_lines, lines_total, n_items, any_negative, missing
    from (select l ->> 'kind' as raw_kind,
                 ops_acct.line_kind_of(l ->> 'kind', l ->> 'description') as kind,
                 coalesce((l ->> 'amount')::numeric, 0) as amount
            from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l) x;

  if missing is not null then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'unknown_line_kind',
      format('"%s" is not a kind of line. A line is item, fee, tax, shipping, discount or other.', missing),
      jsonb_build_object('field','lines','given', missing));
  end if;
  if any_negative then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'line_amount_negative',
      'A line''s amount is always positive. A voucher or a refund netted in is a discount line — the kind carries the sign.',
      jsonb_build_object('field','lines'));
  end if;

  if ty.is_purchase then
    if coalesce(n_lines, 0) = 0 then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'detail_required',
        format('%s is a purchase: it needs what was bought, how many and at what price. An amount on its own cannot be checked against a delivery, a quote or next month.', p_type_code),
        jsonb_build_object('field','lines'));
    end if;
    /* D86 on the goods only: a fee, a tax or the courier is an amount, not a
       quantity of anything. */
    select l ->> 'description' into missing
      from jsonb_array_elements(p_lines) l
     where ops_acct.line_kind_of(l ->> 'kind', l ->> 'description') = 'item'
       and (nullif(l ->> 'qty','') is null or nullif(l ->> 'unit_price','') is null)
     limit 1;
    if missing is not null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'line_detail_required',
        format('"%s" has no quantity or no unit price. Both are what make a price comparable to the next one.', missing),
        jsonb_build_object('field','lines'));
    end if;
    if p_vendor_code is null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'vendor_required',
        'A purchase has somebody it was bought from. Without it the question "where do we buy this" has no answer.',
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;

  -- The detail and the total are two statements about the same event, and
  -- **the ledger will not guess which one is wrong.** Discounts count minus.
  if coalesce(n_lines, 0) > 0 and lines_total <> p_amount then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'lines_do_not_add_up',
      format('The detail adds up to %s but the transaction is %s. One of the two is wrong, and the ledger will not guess which.',
             lines_total, p_amount),
      jsonb_build_object('field','lines','lines_total', lines_total,'amount', p_amount));
  end if;

  /* ── the bill in another currency (0271) ─────────────────────────────── */
  v_billed_ccy := upper(nullif(btrim(coalesce(p_billed_currency, '')), ''));
  if (v_billed_ccy is null) <> (p_billed_amount is null) then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'billed_together',
      'A bill in another currency is a currency and an amount, together. Give both or neither.',
      jsonb_build_object('field','billed_amount'));
  end if;
  if v_billed_ccy is not null then
    if v_billed_ccy !~ '^[A-Z]{3}$' or v_billed_ccy = 'IDR' then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'billed_currency',
        'The billed currency is a three-letter code other than IDR — USD, SGD, EUR.',
        jsonb_build_object('field','billed_currency','given', v_billed_ccy));
    end if;
    if p_billed_amount <= 0 then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'billed_amount_positive','The billed amount is greater than zero.',
        jsonb_build_object('field','billed_amount'));
    end if;
  end if;

  /* ── a non-rupiah account (0300, D458) ────────────────────────────────
   *
   * Its amount is in its own currency. A leg written by post_transfer has
   * had that settled there (0285); any other row must say so itself. */
  if acc.currency <> 'IDR' then
    get diagnostics ctx = pg_context;
    -- The stack names a function unqualified when its schema is on the
    -- search_path, as it is inside these seams.
    if ctx !~ 'function (ops_acct\.)?post_transfer\(' then
      if v_billed_ccy is distinct from acc.currency or p_billed_amount <> p_amount then
        return ops_core.invalid('accounting','transaction', p_source_ref,'post',
          'foreign_account',
          format('%s is a %s account: an amount on it is in %s, never rupiah. A %s → IDR conversion is recorded at Leadership accounts → Record conversion; money moving to another of our accounts is a transfer. A single row here must state billed_currency %s with billed_amount equal to the amount.',
                 acc.code, acc.currency, acc.currency, acc.currency, acc.currency),
          jsonb_build_object('field','account_code','account', acc.code,'currency', acc.currency,
                             'road','record_conversion'));
      end if;
    end if;
  end if;

  if p_vendor_code is not null then
    select id into ven from ops_procure.vendors where code = p_vendor_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_vendor', format('There is no vendor %s.', p_vendor_code),
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;
  if p_project_code is not null then
    select id into proj from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_project', format('There is no project %s.', p_project_code),
        jsonb_build_object('field','project_code'));
    end if;
  end if;

  -- The idempotency claim on the row itself (A4).
  src := coalesce(nullif(btrim(p_source_ref), ''), ops_core.new_token('src'));
  select t.trx_no into existing from ops_acct.transactions t where t.source_ref = src;
  if existing is not null then
    return ops_core.conflict('accounting','transaction', existing,'post',
      'already_posted', format('Already booked as %s — nothing changed.', existing),
      jsonb_build_object('trx_no', existing));
  end if;

  v_trx_no := ops_core.next_doc_number('trx');

  insert into ops_acct.transactions
    (trx_no, trx_date, account_id, direction, amount_idr, type_code,
     vendor_id, project_id, description, remark, status, source_ref, posted_by,
     billed_currency, billed_amount)
  values (v_trx_no, coalesce(p_trx_date, ops_core.office_day()), acc.id, p_direction,
          p_amount, p_type_code, ven, proj, btrim(p_description),
          nullif(btrim(p_remark), ''), 'POSTED', src, auth.uid(),
          v_billed_ccy, p_billed_amount)
  returning id into v_trx_id;

  if coalesce(n_lines, 0) > 0 then
    insert into ops_acct.transaction_lines
      (trx_id, line_no, kind, item_id, description, qty, uom, unit_price, amount)
    select v_trx_id, ord,
           ops_acct.line_kind_of(l ->> 'kind', l ->> 'description'),
           nullif(l ->> 'item_id','')::uuid,
           l ->> 'description',
           nullif(l ->> 'qty','')::numeric,
           nullif(l ->> 'uom',''),
           nullif(l ->> 'unit_price','')::numeric,
           (l ->> 'amount')::numeric
      from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select (d ->> 'attachment_id')::uuid, 'transaction', v_trx_no,
         ops_core.doc_kind_of(d ->> 'kind'), auth.uid()
    from jsonb_array_elements(p_documents) d;

  perform ops_core.emit('accounting','accounting.transaction.posted', v_trx_no,
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'account', p_account_code,
                       'lines', coalesce(n_lines, 0), 'item_lines', coalesce(n_items, 0),
                       'billed', case when v_billed_ccy is null then null
                                      else jsonb_build_object('currency', v_billed_ccy, 'amount', p_billed_amount) end));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post',
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'status','POSTED'));
  return ops_core.idem_remember('accounting','post_transaction', p_key, res);
end $$;

revoke execute on function ops_acct.post_transaction(
  text, ops_acct.direction_t, numeric, text, text, jsonb, date, text, text, jsonb, text, text, text, text, numeric) from public;
grant execute on function ops_acct.post_transaction(
  text, ops_acct.direction_t, numeric, text, text, jsonb, date, text, text, jsonb, text, text, text, text, numeric) to authenticated;

comment on function ops_acct.post_transaction(
  text, ops_acct.direction_t, numeric, text, text, jsonb, date, text, text, jsonb, text, text, text, text, numeric) is
  'The one write seam for money (ADR-006). Since 0271 each line carries a kind (item, fee, tax, '
  'shipping, discount, other — sent, or guessed from the description), amounts stay positive and '
  'a discount counts minus in the sum; the D86 qty/unit-price rule applies to item lines only; '
  'p_billed_currency + p_billed_amount keep a bill written in another currency. Since 0300 a row '
  'of its own on a non-IDR account must state that currency (billed_currency = the account''s, '
  'billed_amount = the amount); a leg of post_transfer is settled there (D458).';
