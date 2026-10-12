-- 0268_acct_edit_direction.sql — IN/OUT corrected with Edit (D429).
--
-- Owner, 2026-10-12, right after the ledger got its balance columns (D428):
-- *tambahkan edit IN/OUT juga.* A row typed as OUT that was really money in
-- is off by twice its amount in every balance after it, and until now the
-- only fix was VOID and post again — a new number, the evidence attached
-- again. Like the account (0204), it is one wrong field on a row that is
-- otherwise right, so it is a correction.
--
-- ── guards ─────────────────────────────────────────────────────────────────
--
--   * **A remark is required**, as for the amount (0101): the balance moves.
--   * **Matched to a bank statement → refused.** The bank says which way the
--     money went; unmatch first, the same refusal the amount and account get.
--   * **Paying request lines or orders → refused.** Money that came in paid
--     for nothing; leaving the allocations on an IN row would mark lines paid
--     by a receipt. Take them off first.
--   * **A leadership account → `approve_funds`** (D87), like the account.
--
-- Because the balances are computed (0267), every later row's balance moves
-- by itself; nothing else is written.
--
-- `p_direction` is appended after `p_account_code` (0105's rule).

drop function if exists ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text);

create or replace function ops_acct.edit_transaction(
  p_trx_no text,
  p_amount numeric default null,
  p_description text default null,
  p_reason text default null,
  p_key text default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_type_code text default null,
  p_account_code text default null,
  p_direction text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  t ops_acct.transactions; l ops_acct.transaction_lines;
  v_amount numeric; v_desc text; v_reason text; v_alloc numeric;
  v_lines int; v_synced boolean := false;
  v_vendor uuid; v_project uuid; v_type text; v_dir ops_acct.direction_t;
  acc_from ops_acct.accounts; acc_to ops_acct.accounts;
  v_vendor_set boolean := false; v_project_set boolean := false;
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

  /* ── the three references, resolved before anything is written ──────────
   *
   * All of it up front: a run that wrote the amount and then refused an
   * unknown vendor code would leave the row half corrected, and the person
   * looking at the screen would have no way to tell which half.
   */
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

  /* ── the account (0204) ───────────────────────────────────────────────
   *
   * Resolved with the other references, before anything is written. No
   * clearing case: `account_id` is `not null` — money always moved through
   * somewhere.
   */
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
    /* D87: a leadership account's balance is `approve_funds`' to see, and
       moving a row on or off it changes that balance. */
    if (acc_from.custody = 'leadership' or acc_to.custody = 'leadership')
       and not ops_core.has_authority('approve_funds') then
      return ops_core.refused('accounting','transaction', p_trx_no,'edit',
        'authority_required',
        format('Moving a row onto or off %s changes a leadership account''s balance, which needs approve_funds.',
          case when acc_to.custody = 'leadership' then acc_to.code else acc_from.code end));
    end if;
    /* The statement is one account's. A row the bank confirmed there is the
       bank's record — the same refusal the amount gets. */
    if exists (select 1 from ops_acct.statement_lines
                where trx_no = p_trx_no and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        format('This row is matched to a %s bank statement line, so the bank says which account it moved through. Unmatch it first.', acc_from.code),
        jsonb_build_object('field','account_code'));
    end if;
  end if;

  /* ── the direction (0268) ─────────────────────────────────────────────
   *
   * IN ↔ OUT turns the row's effect on the balance around by twice its
   * amount, so it is guarded like the amount and the account together: a
   * remark (below), the bank statement, a leadership account, and — its own
   * guard — a row already paying request lines or orders, because money that
   * came **in** cannot have paid for anything.
   */
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

  if v_amount = t.amount_idr and v_desc = t.description
     and v_vendor is not distinct from t.vendor_id
     and v_project is not distinct from t.project_id
     and v_type = t.type_code
     and acc_to.id = acc_from.id
     and v_dir = t.direction then
    return ops_core.noop('accounting','transaction', p_trx_no,'edit',
      'Nothing changed.', jsonb_build_object('trx_no', p_trx_no));
  end if;

  if v_amount <> t.amount_idr then
    if v_reason is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'reason_required','A remark is required when the amount changes — say why the number was wrong.',
        jsonb_build_object('field','reason'));
    end if;

    /* **Below what is already applied is allowed** — `0102`, the owner's
       answer: a discount after the request was paid, a refund netted into the
       transfer. Not silent, and not a refusal: the audit detail carries
       `allocated` and `over_allocated`, and the drawer warns before saving.
       Allocating *new* money past the amount is still refused by
       `allocate_payment`; only this correction is let through. */
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

  /* The references go into the trail **by code, not by uuid**. An audit row
     reading `vendor: V-0117 → V-0042` can be understood by the person who
     reads it; one reading two uuids has to be joined before it means
     anything, and nobody joins an audit row at 7pm. */
  if v_vendor_set and v_vendor is not distinct from t.vendor_id then
    null;  -- the same vendor, said again
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

  /* By code in the trail, like the vendor: `BCA 271 → JAGO` is read without
     a join. */
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

  update ops_acct.transactions
     set amount_idr = v_amount, description = v_desc,
         vendor_id = v_vendor, project_id = v_project, type_code = v_type,
         account_id = acc_to.id, direction = v_dir
   where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.edited', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'before', v_before, 'after', v_after,
                       'reason', v_reason));

  res := ops_core.say('accounting','transaction', p_trx_no,'edit','ok', 200,
    null, v_reason,
    jsonb_build_object('trx_no', p_trx_no, 'amount_idr', v_amount, 'description', v_desc,
                       'direction', v_dir),
    v_detail, v_before, v_after);
  return ops_core.idem_remember('accounting','edit:' || p_trx_no, p_key, res);
end $$;

revoke execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text) from public;
grant execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text) to authenticated;

comment on function ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text, text) is
  'Correcting a ledger row in place. Amount and description since 0101; vendor, project and type '
  'since 0105, by code, where null keeps and '''' clears; the account since 0204; IN/OUT since 0268, '
  'refused when matched to a statement or when the row pays request lines or orders, and needing a '
  'remark. Account and direction need approve_funds on a leadership account. New arguments are '
  'appended after p_key so positional callers keep their meaning. (0268)';
