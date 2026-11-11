-- 0288_acct_edit_trx_date.sql — the date of a ledger row can be corrected.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- `edit_transaction` corrects the amount (0101), the vendor, project and type
-- (0105), the account (0204), IN/OUT (0269) and a bill in another currency
-- (0271) — and never the date. The 11 Nov 2026 cross-check against the sheet
-- found four rows on the wrong day (a day/month swap, an invoice date where
-- the transfer date belonged, the first receipt's date on a reimbursement)
-- and the only road was VOID and post again: four new numbers, the evidence
-- moved by hand, and a void that reads like money that never existed. Twelve
-- more rows a day or three off were left undecided because that road is too
-- heavy for a typo.
--
-- ── The number stays (D446) ───────────────────────────────────────────────
--
-- `trx-26-10-02_002` carries the day it was first written. It is kept when
-- the date changes: evidence links, allocations, inbox rows and the audit
-- trail all point at it, and renumbering would break every one of them to
-- make an identifier look like a date it never promised to be. The row's
-- `trx_date` is what balances, the calendar and every report read; the audit
-- row says the number was kept, so a reader who sees a mismatch can find why.
--
-- ── Rules ─────────────────────────────────────────────────────────────────
--
-- * a remark, always — *which document shows the right day*;
-- * not after today on the office clock (`date_in_future`);
-- * refused once a bank statement line is matched to the row: the bank's
--   date is the record (`statement_matched`), as for the amount and account;
-- * a leadership account needs `approve_funds`: the balance moves on both days;
-- * a transfer (0282) moves all its live legs together, each with its own
--   audit row naming the row the edit was made from.
--
-- Not moved: the evidence already filed in Drive under
-- `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` stays in the folder of the day it was
-- filed (D359). A folder is where a file was put, not a claim about the
-- money; moving files on every date fix would be a Drive write inside a
-- database edit.
--
-- ── `p_trx_date` goes LAST ────────────────────────────────────────────────
--
-- Same reason as 0039 and 0271: a defaulted parameter slotted into the middle
-- reassigns every positional call after it. Dropped and created, not
-- `create or replace`, so PostgREST never sees two candidates (PGRST203).

drop function if exists ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text, text, text, numeric);

create function ops_acct.edit_transaction(
  p_trx_no text,
  p_amount numeric default null,
  p_description text default null,
  p_reason text default null,
  p_key text default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_type_code text default null,
  p_account_code text default null,
  p_direction text default null,
  p_billed_currency text default null,  -- 0271: '' clears both; a code sets both with p_billed_amount
  p_billed_amount numeric default null,
  p_trx_date date default null)         -- 0288: appended LAST, see the header
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  t ops_acct.transactions; l ops_acct.transaction_lines;
  v_amount numeric; v_desc text; v_reason text; v_alloc numeric;
  v_lines int; v_synced boolean := false;
  v_vendor uuid; v_project uuid; v_type text; v_dir ops_acct.direction_t;
  acc_from ops_acct.accounts; acc_to ops_acct.accounts;
  v_vendor_set boolean := false; v_project_set boolean := false;
  v_billed_ccy text; v_billed_amt numeric; v_billed_set boolean := false;
  v_date date; v_legs text[] := '{}'; leg record;
  v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb; v_detail jsonb := '{}'::jsonb;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','edit:' || p_trx_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'edit',
      'authority_required','Correcting a ledger row belongs to whoever may post one.');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'edit','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
      'transaction_void', format('%s is VOID — a void row is not edited. Post a new one.', p_trx_no));
  end if;
  if p_description is not null and btrim(p_description) = '' then
    return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
      'description_required','A row with no description is a row nobody can find again.',
      jsonb_build_object('field','description'));
  end if;
  if p_amount is not null and p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
      'amount_positive','An amount is always positive; direction is its own column.',
      jsonb_build_object('field','amount'));
  end if;

  v_amount := coalesce(p_amount, t.amount_idr);
  v_desc   := coalesce(btrim(p_description), t.description);
  v_reason := nullif(btrim(p_reason), '');

  /* ── the three references, resolved before anything is written ────────── */
  v_vendor := t.vendor_id;
  if p_vendor_code is not null then
    v_vendor_set := true;
    if btrim(p_vendor_code) = '' then
      v_vendor := null;
    else
      select id into v_vendor from ops_procure.vendors where code = btrim(p_vendor_code);
      if v_vendor is null then
        return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
          'no_such_vendor', format('There is no vendor %s.', btrim(p_vendor_code)),
          jsonb_build_object('field','vendor_code'));
      end if;
    end if;
  end if;

  v_project := t.project_id;
  if p_project_code is not null then
    v_project_set := true;
    if btrim(p_project_code) = '' then
      v_project := null;
    else
      select id into v_project from ops_procure.projects where code = btrim(p_project_code);
      if v_project is null then
        return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
          'no_such_project', format('There is no project %s.', btrim(p_project_code)),
          jsonb_build_object('field','project_code'));
      end if;
    end if;
  end if;

  v_type := coalesce(nullif(btrim(p_type_code), ''), t.type_code);
  if v_type <> t.type_code
     and not exists (select 1 from ops_acct.transaction_types ty where ty.code = v_type) then
    return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
      'no_such_type', format('There is no transaction type %s.', v_type),
      jsonb_build_object('field','type_code'));
  end if;

  /* ── the account (0204) ─────────────────────────────────────────────── */
  select * into acc_from from ops_acct.accounts where id = t.account_id;
  acc_to := acc_from;
  if nullif(btrim(p_account_code), '') is not null
     and btrim(p_account_code) <> acc_from.code then
    select * into acc_to from ops_acct.accounts where code = btrim(p_account_code);
    if not found then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'no_such_account', format('There is no account %s.', btrim(p_account_code)),
        jsonb_build_object('field','account_code'));
    end if;
    if not acc_to.is_active then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'account_inactive', format('%s is no longer in use — a row is not moved onto it.', acc_to.code),
        jsonb_build_object('field','account_code'));
    end if;
    if acc_to.currency <> acc_from.currency then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'account_currency', format('%s is a %s account and %s is %s. The amount here is in %s, so it cannot simply move — void it and post it on the right account.',
          acc_from.code, acc_from.currency, acc_to.code, acc_to.currency, acc_from.currency),
        jsonb_build_object('field','account_code'));
    end if;
    if (acc_from.custody = 'leadership' or acc_to.custody = 'leadership')
       and not ops_core.has_authority('approve_funds') then
      return ops_core.refused('accounting','transaction', p_trx_no,'edit',
        'authority_required',
        format('Moving a row onto or off %s changes a leadership account''s balance, which needs approve_funds.',
          case when acc_to.custody = 'leadership' then acc_to.code else acc_from.code end));
    end if;
    if exists (select 1 from ops_acct.statement_lines
                where trx_no = p_trx_no and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        format('This row is matched to a %s bank statement line, so the bank says which account it moved through. Unmatch it first.', acc_from.code),
        jsonb_build_object('field','account_code'));
    end if;
  end if;

  /* ── the direction (0269) ───────────────────────────────────────────── */
  v_dir := t.direction;
  if nullif(btrim(p_direction), '') is not null then
    if upper(btrim(p_direction)) not in ('IN','OUT') then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'no_such_direction', 'Direction is IN or OUT.',
        jsonb_build_object('field','direction'));
    end if;
    v_dir := upper(btrim(p_direction))::ops_acct.direction_t;
  end if;
  if v_dir <> t.direction then
    if exists (select 1 from ops_acct.statement_lines
                where trx_no = p_trx_no and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        'This row is matched to a bank statement line, so the bank says whether money came in or went out. Unmatch it first.',
        jsonb_build_object('field','direction'));
    end if;
    if exists (select 1 from ops_acct.payment_allocations
                where trx_id = t.id and superseded_by is null) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'direction_allocated',
        'This row pays request lines or orders. Money that came in paid for nothing — take the allocations off first.',
        jsonb_build_object('field','direction'));
    end if;
    if (acc_from.custody = 'leadership' or acc_to.custody = 'leadership')
       and not ops_core.has_authority('approve_funds') then
      return ops_core.refused('accounting','transaction', p_trx_no,'edit',
        'authority_required',
        'Turning a row around on a leadership account changes its balance, which needs approve_funds.');
    end if;
    if v_reason is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'reason_required','A remark is required when IN/OUT changes — say why it was recorded the wrong way.',
        jsonb_build_object('field','reason'));
    end if;
  end if;

  /* ── the bill in another currency (0271) ───────────────────────────────
   *
   * Null leaves it; '' clears both; a code sets both, with the amount. No
   * remark: the rupiah that moved does not change, only what the invoice
   * said. */
  v_billed_ccy := t.billed_currency; v_billed_amt := t.billed_amount;
  if p_billed_currency is not null then
    v_billed_set := true;
    if btrim(p_billed_currency) = '' then
      v_billed_ccy := null; v_billed_amt := null;
    else
      v_billed_ccy := upper(btrim(p_billed_currency));
      v_billed_amt := coalesce(p_billed_amount, t.billed_amount);
      if v_billed_ccy !~ '^[A-Z]{3}$' or v_billed_ccy = 'IDR' then
        return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
          'billed_currency','The billed currency is a three-letter code other than IDR — USD, SGD, EUR.',
          jsonb_build_object('field','billed_currency','given', v_billed_ccy));
      end if;
      if v_billed_amt is null then
        return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
          'billed_together','A bill in another currency is a currency and an amount, together.',
          jsonb_build_object('field','billed_amount'));
      end if;
      if v_billed_amt <= 0 then
        return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
          'billed_amount_positive','The billed amount is greater than zero.',
          jsonb_build_object('field','billed_amount'));
      end if;
    end if;
  elsif p_billed_amount is not null then
    if t.billed_currency is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'billed_together','An amount in another currency needs the currency with it.',
        jsonb_build_object('field','billed_currency'));
    end if;
    if p_billed_amount <= 0 then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'billed_amount_positive','The billed amount is greater than zero.',
        jsonb_build_object('field','billed_amount'));
    end if;
    v_billed_set := true; v_billed_amt := p_billed_amount;
  end if;

  /* ── the date (0288, D446) ───────────────────────────────────────────
   *
   * The day the money moved, not the day somebody typed it. The number
   * stays: `trx-26-10-02_002` is an identity that evidence, allocations and
   * the audit trail already point at, so it keeps the day it was first
   * written and the row's date is what the balance and every report read.
   * A transfer's legs (`transfer_id`, 0282) happened in one act, so they
   * move together — one leg on another day than its other half would show
   * money in the air overnight. */
  v_date := coalesce(p_trx_date, t.trx_date);
  if v_date <> t.trx_date then
    if v_date > ops_core.office_day() then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'date_in_future', format('%s has not happened yet. A ledger row is the day the money moved.',
          to_char(v_date, 'DD Mon YYYY')),
        jsonb_build_object('field','trx_date'));
    end if;
    if v_reason is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'reason_required','A remark is required when the date changes — say which document shows the right day.',
        jsonb_build_object('field','reason'));
    end if;
    if t.transfer_id is not null then
      select coalesce(array_agg(x.trx_no order by x.trx_no), '{}') into v_legs
        from ops_acct.transactions x
       where x.transfer_id = t.transfer_id and x.id <> t.id and x.status <> 'VOID';
    end if;
    if exists (select 1 from ops_acct.statement_lines
                where (trx_no = p_trx_no or trx_no = any(v_legs))
                  and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        case when cardinality(v_legs) = 0
          then 'This row is matched to a bank statement line, so the bank says which day it moved. Unmatch it first.'
          else 'A leg of this transfer is matched to a bank statement line, so the bank says which day it moved. Unmatch it first.'
        end,
        jsonb_build_object('field','trx_date'));
    end if;
    if exists (select 1 from ops_acct.transactions x
                 join ops_acct.accounts a on a.id = x.account_id
                where (x.id = t.id or x.trx_no = any(v_legs)) and a.custody = 'leadership')
       and not ops_core.has_authority('approve_funds') then
      return ops_core.refused('accounting','transaction', p_trx_no,'edit',
        'authority_required',
        'Moving a row on a leadership account to another day changes that account''s balance on both days, which needs approve_funds.');
    end if;
  end if;

  if v_amount = t.amount_idr and v_desc = t.description
     and v_vendor is not distinct from t.vendor_id
     and v_project is not distinct from t.project_id
     and v_type = t.type_code
     and acc_to.id = acc_from.id
     and v_dir = t.direction
     and v_billed_ccy is not distinct from t.billed_currency
     and v_billed_amt is not distinct from t.billed_amount
     and v_date = t.trx_date then
    return ops_core.noop('accounting','transaction', p_trx_no,'edit',
      'Nothing changed.', jsonb_build_object('trx_no', p_trx_no));
  end if;

  if v_amount <> t.amount_idr then
    if v_reason is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'reason_required','A remark is required when the amount changes — say why the number was wrong.',
        jsonb_build_object('field','reason'));
    end if;

    select coalesce(sum(amount), 0) into v_alloc
      from ops_acct.payment_allocations
     where trx_id = t.id and superseded_by is null;

    if exists (select 1 from ops_acct.statement_lines
                where trx_no = p_trx_no and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        'This row is matched to a bank statement line, so the bank''s amount is the record. Unmatch it first.',
        jsonb_build_object('field','amount'));
    end if;

    select count(*) into v_lines from ops_acct.transaction_lines where trx_id = t.id;
    if v_lines = 1 then
      select * into l from ops_acct.transaction_lines where trx_id = t.id;
      if l.amount = t.amount_idr then
        update ops_acct.transaction_lines
           set amount = v_amount,
               unit_price = case when l.qty is not null and l.unit_price is not null
                                 then round(v_amount / l.qty, 2) else l.unit_price end
         where id = l.id;
        v_synced := true;
      end if;
    end if;

    v_before := v_before || jsonb_build_object('amount_idr', t.amount_idr);
    v_after  := v_after  || jsonb_build_object('amount_idr', v_amount);
    v_detail := v_detail || jsonb_build_object(
      'amount_before', t.amount_idr, 'amount_after', v_amount,
      'lines', case when v_lines = 0 then 'none'
                    when v_synced then 'updated' else 'unchanged' end);
    if v_alloc > v_amount then
      v_detail := v_detail || jsonb_build_object('allocated', v_alloc, 'over_allocated', v_alloc - v_amount);
    end if;
  end if;

  if v_desc <> t.description then
    v_before := v_before || jsonb_build_object('description', t.description);
    v_after  := v_after  || jsonb_build_object('description', v_desc);
    v_detail := v_detail || jsonb_build_object(
      'description_before', t.description, 'description_after', v_desc);
  end if;

  if v_vendor_set and v_vendor is not distinct from t.vendor_id then
    null;
  elsif v_vendor_set then
    v_before := v_before || jsonb_build_object('vendor',
      (select code from ops_procure.vendors where id = t.vendor_id));
    v_after  := v_after  || jsonb_build_object('vendor',
      (select code from ops_procure.vendors where id = v_vendor));
    v_detail := v_detail || jsonb_build_object(
      'vendor_before', (select name from ops_procure.vendors where id = t.vendor_id),
      'vendor_after',  (select name from ops_procure.vendors where id = v_vendor));
  end if;

  if v_project_set and v_project is not distinct from t.project_id then
    null;
  elsif v_project_set then
    v_before := v_before || jsonb_build_object('project',
      (select code from ops_procure.projects where id = t.project_id));
    v_after  := v_after  || jsonb_build_object('project',
      (select code from ops_procure.projects where id = v_project));
  end if;

  if v_type <> t.type_code then
    v_before := v_before || jsonb_build_object('type_code', t.type_code);
    v_after  := v_after  || jsonb_build_object('type_code', v_type);
  end if;

  if acc_to.id <> acc_from.id then
    v_before := v_before || jsonb_build_object('account', acc_from.code);
    v_after  := v_after  || jsonb_build_object('account', acc_to.code);
    v_detail := v_detail || jsonb_build_object(
      'account_before', acc_from.code, 'account_after', acc_to.code);
  end if;

  if v_dir <> t.direction then
    v_before := v_before || jsonb_build_object('direction', t.direction);
    v_after  := v_after  || jsonb_build_object('direction', v_dir);
    v_detail := v_detail || jsonb_build_object(
      'direction_before', t.direction, 'direction_after', v_dir);
  end if;

  /* In the trail as one readable value — `USD 26.64 → USD 25` — not two
     columns somebody has to pair. */
  if v_billed_set and (v_billed_ccy is distinct from t.billed_currency
                       or v_billed_amt is distinct from t.billed_amount) then
    v_before := v_before || jsonb_build_object('billed',
      case when t.billed_currency is null then null else t.billed_currency || ' ' || t.billed_amount::text end);
    v_after  := v_after  || jsonb_build_object('billed',
      case when v_billed_ccy is null then null else v_billed_ccy || ' ' || v_billed_amt::text end);
  end if;

  if v_date <> t.trx_date then
    v_before := v_before || jsonb_build_object('trx_date', t.trx_date);
    v_after  := v_after  || jsonb_build_object('trx_date', v_date);
    v_detail := v_detail || jsonb_build_object(
      'date_before', t.trx_date, 'date_after', v_date, 'trx_no_kept', true);
    if cardinality(v_legs) > 0 then
      v_detail := v_detail || jsonb_build_object('legs_moved', to_jsonb(v_legs));
      /* Each leg gets its own trail row, so *what happened to this row* is
         answered from the row itself, not from its other half. */
      for leg in select x.trx_no, x.trx_date from ops_acct.transactions x
                  where x.trx_no = any(v_legs) loop
        update ops_acct.transactions set trx_date = v_date where trx_no = leg.trx_no;
        perform ops_core.write_audit('accounting','transaction', leg.trx_no,'edit','ok', v_reason,
          jsonb_build_object('trx_date', leg.trx_date), jsonb_build_object('trx_date', v_date),
          jsonb_build_object('date_before', leg.trx_date, 'date_after', v_date,
                             'trx_no_kept', true, 'moved_with', p_trx_no));
      end loop;
    end if;
  end if;

  update ops_acct.transactions
     set amount_idr = v_amount, description = v_desc, trx_date = v_date,
         vendor_id = v_vendor, project_id = v_project, type_code = v_type,
         account_id = acc_to.id, direction = v_dir,
         billed_currency = v_billed_ccy, billed_amount = v_billed_amt
   where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.edited', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'before', v_before, 'after', v_after,
                       'reason', v_reason));

  res := ops_core.say('accounting','transaction', p_trx_no,'edit','ok', 200,
    null, v_reason,
    jsonb_build_object('trx_no', p_trx_no, 'amount_idr', v_amount, 'description', v_desc,
                       'direction', v_dir, 'billed_currency', v_billed_ccy, 'billed_amount', v_billed_amt,
                       'trx_date', v_date),
    v_detail, v_before, v_after);
  return ops_core.idem_remember('accounting','edit:' || p_trx_no, p_key, res);
end $$;

revoke execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text, text, numeric, date) from public;
grant execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text, text, numeric, date) to authenticated;

comment on function ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text, text, text, numeric, date) is
  'Correcting a ledger row in place. Amount and description since 0101; vendor, project and type '
  'since 0105, by code, where null keeps and '''' clears; the account since 0204; IN/OUT since 0269; '
  'the bill in another currency since 0271; the date since 0288 (remark required, not in the future, '
  'refused on a statement-matched row, a transfer''s legs move together, the trx_no is kept — D446). '
  'New arguments are appended after the last so positional callers keep their meaning. (0288)';
