-- 0092_acct_cash_component_lifecycle.sql — the two fields `save_cash_component`
-- could set on insert (their table defaults) but never let an edit touch.
--
-- `CashComponent.ends_on` and `.active` have existed since `0022`'s table.
-- The demo's `updateComponent` edits both — an end date closing out a line
-- that is going away, and `active: false` retiring one without deleting it
-- (D84: a plan's history stays legible, so a component that once existed
-- keeps existing, just not counted). The seam had no parameter to reach
-- either, on insert or on update: a new line could never be given an end
-- date at creation, and no line could ever be retired at all.
--
-- Same shape as `0086`/`0089`: `create or replace function` never treats an
-- appended parameter as the same function (checked against this cluster in
-- `0086`) — the old thirteen-argument form is dropped first, so there is
-- exactly one `save_cash_component` afterwards, not two with split grants.
-- Everything else — every check, every existing column write, the clash
-- rule this migration does not touch — is copied unchanged from `0022`.
drop function if exists ops_acct.save_cash_component(
  text, numeric, ops_acct.cash_frequency_t, ops_acct.direction_t, int, int, date,
  text, text, text, text, text, uuid);

create or replace function ops_acct.save_cash_component(
  p_name text,
  p_amount numeric,
  p_frequency ops_acct.cash_frequency_t,
  p_direction ops_acct.direction_t default 'OUT',
  p_due_day int default null,
  p_due_weekday int default null,
  p_due_date date default null,
  p_type_code text default null,
  p_vendor_code text default null,
  p_account_code text default null,
  p_starts_on text default null,
  p_note text default null,
  p_id uuid default null,
  p_ends_on text default null,
  p_active boolean default true)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare v_id uuid; v_vendor uuid; v_account uuid;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','cash_component', p_name,'save',
      'not_permitted','Editing the payment calendar needs accounting access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('accounting','cash_component', null,'save',
      'name_required','A line on the calendar needs a name somebody will recognise.',
      jsonb_build_object('field','name'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'amount_required','An estimate of zero plans nothing. Put the number you expect, even roughly.',
      jsonb_build_object('field','amount'));
  end if;
  if p_frequency = 'monthly' and (p_due_day is null or p_due_day not between 1 and 31) then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'due_day_out_of_range','The day of the month it is due, between 1 and 31.',
      jsonb_build_object('field','due_day'));
  end if;
  if p_frequency = 'weekly' and (p_due_weekday is null or p_due_weekday not between 0 and 6) then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'weekday_required','Which day of the week it goes out.',
      jsonb_build_object('field','due_weekday'));
  end if;
  if p_frequency = 'once' and p_due_date is null then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'date_required','A one-off needs the date it falls on.',
      jsonb_build_object('field','due_date'));
  end if;

  if p_vendor_code is not null then
    select id into v_vendor from ops_procure.vendors where code = p_vendor_code;
    if not found then
      return ops_core.invalid('accounting','cash_component', p_name,'save',
        'no_such_vendor', format('There is no vendor %s.', p_vendor_code));
    end if;
  end if;
  if p_account_code is not null then
    select id into v_account from ops_acct.accounts where code = p_account_code;
    if not found then
      return ops_core.invalid('accounting','cash_component', p_name,'save',
        'no_such_account', format('There is no account %s.', p_account_code));
    end if;
  end if;

  if p_id is null then
    insert into ops_acct.cash_components
      (name, direction, amount, frequency, due_day, due_weekday, due_date,
       type_code, vendor_id, account_id, starts_on, ends_on, note, active, created_by)
    values (btrim(p_name), p_direction, p_amount, p_frequency,
            p_due_day, p_due_weekday, p_due_date, p_type_code, v_vendor, v_account,
            coalesce(p_starts_on, to_char(ops_core.office_day(), 'YYYY-MM')),
            p_ends_on, nullif(btrim(p_note), ''), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update ops_acct.cash_components set
      name = btrim(p_name), direction = p_direction, amount = p_amount,
      frequency = p_frequency, due_day = p_due_day, due_weekday = p_due_weekday,
      due_date = p_due_date, type_code = p_type_code,
      vendor_id = v_vendor, account_id = v_account,
      ends_on = p_ends_on, active = coalesce(p_active, true),
      note = nullif(btrim(p_note), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      return ops_core.not_found('accounting','cash_component', p_id::text,'save','No such line.');
    end if;
  end if;

  return ops_core.ok('accounting','cash_component', btrim(p_name),'save',
    jsonb_build_object('component_id', v_id, 'name', btrim(p_name),
                       'frequency', p_frequency, 'amount', p_amount));
end $$;

grant execute on function
  ops_acct.save_cash_component(
    text, numeric, ops_acct.cash_frequency_t, ops_acct.direction_t, int, int, date,
    text, text, text, text, text, uuid, text, boolean)
  to authenticated;
