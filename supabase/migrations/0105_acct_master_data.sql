-- 0105_acct_master_data.sql — Master Data phase 3: accounts and transaction
-- types, maintained from a screen instead of a migration.
--
-- Until now both lists could change only through SQL: the six accounts and
-- the types were seeded in `0013`/`0042`, and the screens picked from a
-- hard-coded list of thirteen types while production holds eighteen (five —
-- TRANSPORT, EJO, OVERTIME and the monthly and weekly payroll types — could
-- not be picked in any form). The pickers now read the table; these seams are how it
-- changes.
--
-- **Who may.** A transaction type is bookkeeping vocabulary: `accounting.update`.
-- An account is money: `accounting.update` *and* the `post_ledger` authority,
-- and anything that touches a leadership account — creating one, editing
-- one, or moving one into or out of leadership custody — also needs
-- `approve_funds`. Moving BCA 064 into accounting custody would otherwise be
-- a way for the ledger to start paying from leadership's money (D87).
--
-- **What never changes.** An account's or type's code is what every ledger row
-- is written against, so it is fixed at creation. An account's currency is
-- fixed once a transaction is booked on it. Deleting is only for a row
-- nothing references; everything else is deactivated, which takes it out of
-- the pickers and leaves the history alone.
--
-- Every write goes through `ops_core.say`, so each lands in the IT audit log
-- with its before and after; an opening balance change needs a reason, like
-- an amount edit on the ledger (`0101`).

-- ── 1. types can be described and retired ────────────────────────────────
alter table ops_acct.transaction_types
  add column if not exists description text,
  add column if not exists is_active boolean not null default true;

-- ── 2. who may touch an account ──────────────────────────────────────────
-- Answers null when allowed, or the refusal to return.
create or replace function ops_acct.account_guard(
  p_code text, p_action text, p_touches_leadership boolean)
returns jsonb
language plpgsql stable security definer set search_path = ops_acct, ops_core, pg_temp as $$
begin
  if not ops_core.has_permission('accounting.update') or not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','account', p_code, p_action,
      'authority_required','Editing an account belongs to Accounting (accounting write access and post_ledger).');
  end if;
  if p_touches_leadership and not ops_core.has_authority('approve_funds') then
    return ops_core.refused('accounting','account', p_code, p_action,
      'leadership_account','Leadership accounts are changed only by someone who approves funds.');
  end if;
  return null;
end $$;

-- ── 3. accounts ──────────────────────────────────────────────────────────
create or replace function ops_acct.create_account(
  p_code text,
  p_name text,
  p_custody ops_acct.account_custody_t,
  p_is_paying boolean default false,
  p_currency text default 'IDR',
  p_opening_balance numeric default 0,
  p_opened_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_cur text := upper(btrim(coalesce(p_currency, 'IDR')));
        denied jsonb; v_id uuid;
begin
  denied := ops_acct.account_guard(v_code, 'create', p_custody = 'leadership');
  if denied is not null then return denied; end if;

  if v_code !~ '^[A-Z0-9][A-Z0-9 .\-]{1,23}$' then
    return ops_core.invalid('accounting','account', v_code,'create',
      'code_invalid','An account code is 2–24 characters: letters, digits, spaces, dots or dashes — e.g. "BCA 271".',
      jsonb_build_object('field','code'));
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('accounting','account', v_code,'create',
      'name_required','An account needs a name.', jsonb_build_object('field','name'));
  end if;
  if v_cur !~ '^[A-Z]{3}$' then
    return ops_core.invalid('accounting','account', v_code,'create',
      'currency_invalid','A currency is a three-letter code, e.g. IDR or USD.', jsonb_build_object('field','currency'));
  end if;
  if p_custody = 'leadership' and coalesce(p_is_paying, false) then
    return ops_core.invalid('accounting','account', v_code,'create',
      'leadership_not_paying','A leadership account never pays a vendor directly (D87).',
      jsonb_build_object('field','is_paying'));
  end if;
  if exists (select 1 from ops_acct.accounts where upper(code) = v_code) then
    return ops_core.conflict('accounting','account', v_code,'create',
      'account_exists', format('Account %s already exists.', v_code), jsonb_build_object('field','code'));
  end if;

  insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on)
  values (v_code, btrim(p_name), p_custody, coalesce(p_is_paying, false), v_cur,
          coalesce(p_opening_balance, 0), coalesce(p_opened_on, current_date))
  returning id into v_id;

  return ops_core.ok('accounting','account', v_code,'create',
    jsonb_build_object('code', v_code, 'id', v_id), null,
    jsonb_build_object('name', btrim(p_name), 'custody', p_custody, 'is_paying', coalesce(p_is_paying, false),
                       'currency', v_cur, 'opening_balance', coalesce(p_opening_balance, 0)));
end $$;

-- Every argument but the code may be left null to keep what is there.
create or replace function ops_acct.update_account(
  p_code text,
  p_name text default null,
  p_custody ops_acct.account_custody_t default null,
  p_is_paying boolean default null,
  p_currency text default null,
  p_opening_balance numeric default null,
  p_opened_on date default null,
  p_is_active boolean default null,
  p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare a ops_acct.accounts; denied jsonb; v_before jsonb; v_after jsonb;
        v_custody ops_acct.account_custody_t; v_paying boolean; v_cur text; v_reason text;
begin
  select * into a from ops_acct.accounts where code = p_code;
  if not found then
    return ops_core.not_found('accounting','account', p_code,'update','No such account.');
  end if;
  v_custody := coalesce(p_custody, a.custody);
  denied := ops_acct.account_guard(p_code, 'update', a.custody = 'leadership' or v_custody = 'leadership');
  if denied is not null then return denied; end if;

  if p_name is not null and btrim(p_name) = '' then
    return ops_core.invalid('accounting','account', p_code,'update',
      'name_required','An account needs a name.', jsonb_build_object('field','name'));
  end if;
  v_paying := coalesce(p_is_paying, a.is_paying);
  if v_custody = 'leadership' and v_paying then
    return ops_core.invalid('accounting','account', p_code,'update',
      'leadership_not_paying','A leadership account never pays a vendor directly (D87).',
      jsonb_build_object('field','is_paying'));
  end if;
  v_cur := coalesce(upper(btrim(p_currency)), a.currency);
  if v_cur !~ '^[A-Z]{3}$' then
    return ops_core.invalid('accounting','account', p_code,'update',
      'currency_invalid','A currency is a three-letter code, e.g. IDR or USD.', jsonb_build_object('field','currency'));
  end if;
  if v_cur <> a.currency and exists (select 1 from ops_acct.transactions where account_id = a.id) then
    return ops_core.conflict('accounting','account', p_code,'update',
      'currency_locked', format('%s already has transactions in %s; its currency cannot change.', p_code, a.currency),
      jsonb_build_object('field','currency'));
  end if;
  v_reason := nullif(btrim(p_reason), '');
  if p_opening_balance is not null and p_opening_balance <> a.opening_balance and v_reason is null then
    return ops_core.invalid('accounting','account', p_code,'update',
      'reason_required','Changing an opening balance moves every balance after it — say why.',
      jsonb_build_object('field','reason'));
  end if;

  v_before := jsonb_build_object('name', a.name, 'custody', a.custody, 'is_paying', a.is_paying,
    'currency', a.currency, 'opening_balance', a.opening_balance, 'opened_on', a.opened_on, 'is_active', a.is_active);

  update ops_acct.accounts set
    name            = coalesce(btrim(p_name), name),
    custody         = v_custody,
    is_paying       = v_paying,
    currency        = v_cur,
    opening_balance = coalesce(p_opening_balance, opening_balance),
    opened_on       = coalesce(p_opened_on, opened_on),
    is_active       = coalesce(p_is_active, is_active)
  where id = a.id;

  select jsonb_build_object('name', name, 'custody', custody, 'is_paying', is_paying,
    'currency', currency, 'opening_balance', opening_balance, 'opened_on', opened_on, 'is_active', is_active)
    into v_after from ops_acct.accounts where id = a.id;

  if v_after = v_before then
    return ops_core.noop('accounting','account', p_code,'update','Nothing changed.',
      jsonb_build_object('code', p_code));
  end if;

  return ops_core.say('accounting','account', p_code,'update','ok', 200,
    null, v_reason,
    jsonb_build_object('code', p_code),
    case when p_opening_balance is not null and p_opening_balance <> a.opening_balance
         then jsonb_build_object('opening_balance_before', a.opening_balance,
                                 'opening_balance_after', p_opening_balance) end,
    v_before, v_after);
end $$;

create or replace function ops_acct.delete_account(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare a ops_acct.accounts; denied jsonb; n_trx int; n_stmt int; n_cash int;
begin
  select * into a from ops_acct.accounts where code = p_code;
  if not found then
    return ops_core.not_found('accounting','account', p_code,'delete','No such account.');
  end if;
  denied := ops_acct.account_guard(p_code, 'delete', a.custody = 'leadership');
  if denied is not null then return denied; end if;

  select count(*) into n_trx  from ops_acct.transactions    where account_id = a.id;
  select count(*) into n_stmt from ops_acct.bank_statements where account_id = a.id;
  select count(*) into n_cash from ops_acct.cash_components where account_id = a.id;
  if n_trx + n_stmt + n_cash > 0 then
    return ops_core.conflict('accounting','account', p_code,'delete',
      'account_in_use',
      format('%s has %s transaction(s), %s bank statement(s) and %s planned payment(s). Deactivate it instead.',
             p_code, n_trx, n_stmt, n_cash),
      jsonb_build_object('transactions', n_trx, 'statements', n_stmt, 'cash_components', n_cash));
  end if;

  delete from ops_acct.accounts where id = a.id;
  return ops_core.ok('accounting','account', p_code,'delete',
    jsonb_build_object('code', p_code, 'deleted', true),
    jsonb_build_object('name', a.name, 'custody', a.custody, 'currency', a.currency), null);
end $$;

-- ── 4. transaction types ─────────────────────────────────────────────────
-- Written the way the data spells them: upper case, words separated by
-- spaces and " - " (`RECCURING - UTILITIES` keeps its doubled C).
create or replace function ops_acct.create_transaction_type(
  p_code text,
  p_is_purchase boolean default true,
  p_auto_complete boolean default false,
  p_creates_catalog_item boolean default false,
  p_description text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_code text := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', ' ', 'g'));
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','transaction_type', v_code,'create',
      'not_permitted','Editing transaction types needs accounting write access.');
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9 &/.\-]{1,39}$' then
    return ops_core.invalid('accounting','transaction_type', v_code,'create',
      'code_invalid','A type is 2–40 characters: letters, digits, spaces, "&", "/", "." or "-" — e.g. "TRANSPORT".',
      jsonb_build_object('field','code'));
  end if;
  if exists (select 1 from ops_acct.transaction_types where code = v_code) then
    return ops_core.conflict('accounting','transaction_type', v_code,'create',
      'type_exists', format('%s already exists.', v_code), jsonb_build_object('field','code'));
  end if;

  insert into ops_acct.transaction_types (code, is_purchase, auto_complete, creates_catalog_item, description)
  values (v_code, coalesce(p_is_purchase, true), coalesce(p_auto_complete, false),
          coalesce(p_creates_catalog_item, false), nullif(btrim(p_description), ''));

  return ops_core.ok('accounting','transaction_type', v_code,'create',
    jsonb_build_object('code', v_code), null,
    jsonb_build_object('is_purchase', coalesce(p_is_purchase, true),
                       'auto_complete', coalesce(p_auto_complete, false),
                       'creates_catalog_item', coalesce(p_creates_catalog_item, false)));
end $$;

create or replace function ops_acct.update_transaction_type(
  p_code text,
  p_is_purchase boolean default null,
  p_auto_complete boolean default null,
  p_creates_catalog_item boolean default null,
  p_description text default null,
  p_is_active boolean default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transaction_types; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','transaction_type', p_code,'update',
      'not_permitted','Editing transaction types needs accounting write access.');
  end if;
  select * into t from ops_acct.transaction_types where code = p_code;
  if not found then
    return ops_core.not_found('accounting','transaction_type', p_code,'update','No such transaction type.');
  end if;

  v_before := jsonb_build_object('is_purchase', t.is_purchase, 'auto_complete', t.auto_complete,
    'creates_catalog_item', t.creates_catalog_item, 'description', t.description, 'is_active', t.is_active);

  update ops_acct.transaction_types set
    is_purchase          = coalesce(p_is_purchase, is_purchase),
    auto_complete        = coalesce(p_auto_complete, auto_complete),
    creates_catalog_item = coalesce(p_creates_catalog_item, creates_catalog_item),
    -- An empty string clears the description; null keeps it.
    description          = case when p_description is null then description
                                else nullif(btrim(p_description), '') end,
    is_active            = coalesce(p_is_active, is_active)
  where code = t.code;

  select jsonb_build_object('is_purchase', is_purchase, 'auto_complete', auto_complete,
    'creates_catalog_item', creates_catalog_item, 'description', description, 'is_active', is_active)
    into v_after from ops_acct.transaction_types where code = t.code;

  if v_after = v_before then
    return ops_core.noop('accounting','transaction_type', p_code,'update','Nothing changed.',
      jsonb_build_object('code', p_code));
  end if;
  return ops_core.ok('accounting','transaction_type', p_code,'update',
    jsonb_build_object('code', p_code), v_before, v_after);
end $$;

create or replace function ops_acct.delete_transaction_type(p_code text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transaction_types; n_trx int; n_cash int;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','transaction_type', p_code,'delete',
      'not_permitted','Editing transaction types needs accounting write access.');
  end if;
  select * into t from ops_acct.transaction_types where code = p_code;
  if not found then
    return ops_core.not_found('accounting','transaction_type', p_code,'delete','No such transaction type.');
  end if;
  select count(*) into n_trx  from ops_acct.transactions    where type_code = t.code;
  select count(*) into n_cash from ops_acct.cash_components where type_code = t.code;
  if n_trx + n_cash > 0 then
    return ops_core.conflict('accounting','transaction_type', p_code,'delete',
      'type_in_use',
      format('%s is on %s transaction(s) and %s planned payment(s). Deactivate it instead.', p_code, n_trx, n_cash),
      jsonb_build_object('transactions', n_trx, 'cash_components', n_cash));
  end if;

  delete from ops_acct.transaction_types where code = t.code;
  return ops_core.ok('accounting','transaction_type', p_code,'delete',
    jsonb_build_object('code', p_code, 'deleted', true),
    jsonb_build_object('is_purchase', t.is_purchase, 'description', t.description), null);
end $$;

revoke execute on function ops_acct.account_guard(text, text, boolean) from public;
grant execute on function
  ops_acct.create_account(text, text, ops_acct.account_custody_t, boolean, text, numeric, date),
  ops_acct.update_account(text, text, ops_acct.account_custody_t, boolean, text, numeric, date, boolean, text),
  ops_acct.delete_account(text),
  ops_acct.create_transaction_type(text, boolean, boolean, boolean, text),
  ops_acct.update_transaction_type(text, boolean, boolean, boolean, text, boolean),
  ops_acct.delete_transaction_type(text)
  to authenticated;
