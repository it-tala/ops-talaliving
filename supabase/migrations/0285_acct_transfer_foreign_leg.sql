-- 0285 — a transfer leg on a foreign-currency account is written in that
-- currency (D444, F283).
--
-- 0282 wrote `p_amount` on both legs. Right for rupiah to rupiah; wrong
-- when one end is BCA USD 081, whose rows carry dollars: `edit_transaction`
-- says so ("the amount here is in USD") and `v_account_balance` sums the
-- column as the account's own currency, so a USD leg written in rupiah put
-- Rp 89.625.000 where USD 5.000 belonged. The three legs of 15 October were
-- corrected by hand; from here the seam does it.
--
-- The rule, per leg: an account whose currency is not IDR takes
-- `p_billed_amount` (its own currency, required, `p_billed_currency` must be
-- that currency); a rupiah account takes `p_amount`. On a cross-currency
-- transfer the rupiah leg keeps the foreign amount as its billed columns, so
-- the rate stays readable from either row (0271). Two foreign accounts of
-- one currency move `p_amount` in that currency; two different foreign
-- currencies are refused — no rate lives here. The fee is written on the
-- source in the source's currency, as given. Same signature, no overload.
create or replace function ops_acct.post_transfer(
  p_from_account_code text,
  p_to_account_code   text,
  p_amount            numeric,
  p_documents         jsonb,
  p_trx_date          date    default null,
  p_description       text    default null,
  p_fee               numeric default null,
  p_billed_currency   text    default null,
  p_billed_amount     numeric default null,
  p_key               text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  acc_from ops_acct.accounts; acc_to ops_acct.accounts;
  v_id uuid := gen_random_uuid(); v_desc text; v_day date; v_ccy text;
  from_foreign boolean; to_foreign boolean; leg_ccy text; leg_code text;
  out_amount numeric; in_amount numeric;
  out_bccy text; out_bamt numeric; in_bccy text; in_bamt numeric;
  r_out jsonb; r_in jsonb; r_fee jsonb; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_transfer', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transfer', null,'post_transfer',
      'authority_required','Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'amount_positive','Amount must be greater than zero.', jsonb_build_object('field','amount_idr'));
  end if;
  if p_fee is not null and p_fee < 0 then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'fee_negative','A transfer fee is zero or more.', jsonb_build_object('field','fee'));
  end if;
  select * into acc_from from ops_acct.accounts where code = p_from_account_code;
  if not found then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'no_such_account', format('There is no account %s.', p_from_account_code),
      jsonb_build_object('field','from_account_code'));
  end if;
  select * into acc_to from ops_acct.accounts where code = p_to_account_code;
  if not found then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'no_such_account', format('There is no account %s.', p_to_account_code),
      jsonb_build_object('field','to_account_code'));
  end if;
  if acc_from.id = acc_to.id then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'same_account','A transfer moves money between two different accounts.',
      jsonb_build_object('field','to_account_code'));
  end if;

  -- Which leg is in which currency (D444).
  from_foreign := acc_from.currency <> 'IDR';
  to_foreign   := acc_to.currency   <> 'IDR';
  v_ccy := upper(nullif(btrim(coalesce(p_billed_currency, '')), ''));
  out_amount := p_amount; in_amount := p_amount;
  out_bccy := null; out_bamt := null; in_bccy := null; in_bamt := null;
  if from_foreign and to_foreign then
    if acc_from.currency <> acc_to.currency then
      return ops_core.invalid('accounting','transfer', null,'post_transfer',
        'currency_pair', format('%s is in %s and %s is in %s. A transfer between two foreign currencies is not written here — convert through a rupiah account.',
          acc_from.code, acc_from.currency, acc_to.code, acc_to.currency),
        jsonb_build_object('field','to_account_code'));
    end if;
    -- Both legs move p_amount in that one currency; the billed columns say nothing new.
  elsif from_foreign or to_foreign then
    -- PL/pgSQL reads an IF condition up to the first THEN, so the CASE lives here, not in the IF.
    if from_foreign then leg_ccy := acc_from.currency; leg_code := acc_from.code;
    else                 leg_ccy := acc_to.currency;   leg_code := acc_to.code;
    end if;
    if v_ccy is null or p_billed_amount is null or p_billed_amount <= 0 then
      return ops_core.invalid('accounting','transfer', null,'post_transfer',
        'billed_required', format('%s is a %s account: give the amount in %s with billed_amount, beside the rupiah in amount_idr.',
          leg_code, leg_ccy, leg_ccy),
        jsonb_build_object('field','billed_amount'));
    end if;
    if v_ccy <> leg_ccy then
      return ops_core.invalid('accounting','transfer', null,'post_transfer',
        'billed_currency', format('The foreign leg is on a %s account; billed_currency says %s.', leg_ccy, v_ccy),
        jsonb_build_object('field','billed_currency','given', v_ccy));
    end if;
    if from_foreign then
      out_amount := p_billed_amount;                 -- the dollars that left
      in_bccy := v_ccy; in_bamt := p_billed_amount;  -- the rupiah leg remembers them
    else
      in_amount := p_billed_amount;                  -- the dollars that arrived
      out_bccy := v_ccy; out_bamt := p_billed_amount;
    end if;
  else
    -- Rupiah to rupiah: as 0282 wrote it, the billed columns pass through on the OUT leg.
    out_bccy := v_ccy; out_bamt := p_billed_amount;
  end if;

  v_day  := coalesce(p_trx_date, ops_core.office_day());
  v_desc := coalesce(nullif(btrim(p_description), ''),
                     format('Transfer %s → %s', acc_from.code, acc_to.code));

  r_out := ops_acct.post_transaction(
    p_account_code => acc_from.code, p_direction => 'OUT', p_amount => out_amount,
    p_type_code => 'CASHFLOW', p_description => v_desc, p_documents => p_documents,
    p_trx_date => v_day, p_source_ref => format('transfer:%s:out', v_id),
    p_billed_currency => out_bccy, p_billed_amount => out_bamt);
  if not ops_core.said_ok(r_out) then
    return r_out;
  end if;
  r_in := ops_acct.post_transaction(
    p_account_code => acc_to.code, p_direction => 'IN', p_amount => in_amount,
    p_type_code => 'CASHFLOW', p_description => v_desc, p_documents => p_documents,
    p_trx_date => v_day, p_source_ref => format('transfer:%s:in', v_id),
    p_billed_currency => in_bccy, p_billed_amount => in_bamt);
  if not ops_core.said_ok(r_in) then
    raise exception 'post_transfer: the receiving leg was refused — %', r_in -> 'error' ->> 'message'
      using errcode = 'P0001';
  end if;
  if coalesce(p_fee, 0) > 0 then
    r_fee := ops_acct.post_transaction(
      p_account_code => acc_from.code, p_direction => 'OUT', p_amount => p_fee,
      p_type_code => 'BANK CHARGES',
      p_description => format('Biaya transfer %s → %s', acc_from.code, acc_to.code),
      p_documents => p_documents, p_trx_date => v_day,
      p_source_ref => format('transfer:%s:fee', v_id));
    if not ops_core.said_ok(r_fee) then
      raise exception 'post_transfer: the fee row was refused — %', r_fee -> 'error' ->> 'message'
        using errcode = 'P0001';
    end if;
  end if;

  update ops_acct.transactions set transfer_id = v_id
   where source_ref in (format('transfer:%s:out', v_id), format('transfer:%s:in', v_id), format('transfer:%s:fee', v_id));

  res := ops_core.ok('accounting','transfer', v_id::text,'post_transfer',
    jsonb_build_object('transfer_id', v_id,
                       'from_account', acc_from.code, 'to_account', acc_to.code,
                       'amount', p_amount, 'fee', coalesce(p_fee, 0), 'trx_date', v_day,
                       'out_amount', out_amount, 'in_amount', in_amount,
                       'out_trx_no', r_out -> 'data' ->> 'trx_no',
                       'in_trx_no',  r_in  -> 'data' ->> 'trx_no',
                       'fee_trx_no', r_fee -> 'data' ->> 'trx_no'));
  return ops_core.idem_remember('accounting','post_transfer', p_key, res);
end $$;
grant execute on function ops_acct.post_transfer(text, text, numeric, jsonb, date, text, numeric, text, numeric, text) to authenticated;
comment on function ops_acct.post_transfer(text, text, numeric, jsonb, date, text, numeric, text, numeric, text) is
  'One transfer between our own accounts: the OUT, the IN and the fee as its own BANK CHARGES row, one transfer_id, the same proof on each (0282). '
  'A leg on a non-rupiah account is written in that currency from billed_amount; the rupiah leg carries the foreign amount as its billed columns (0285, D444). post_ledger.';
