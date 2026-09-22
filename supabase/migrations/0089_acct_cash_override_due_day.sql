-- 0089_acct_cash_override_due_day.sql — the column `set_cash_override` never
-- wrote to.
--
-- `ops_acct.cash_overrides.due_day` has existed since `0022`: a month can
-- move a bill's due date as well as its amount (an office bill paid on the
-- 5th one month instead of the 10th is still that bill, on a different day).
-- The seam only ever took an amount, a reason and a skip flag — the column
-- was reachable by nothing, on every call, from the day it was created.
--
-- Everything else here is copied unchanged from the version `0022` shipped —
-- same permission check, same validation, same order — with `p_due_day`
-- appended at the end and one line added to the insert and the conflict
-- update. `create or replace function` never treats an appended parameter as
-- the same function (checked against this cluster in `0086`): the old
-- five-argument form is dropped first, so there is exactly one
-- `set_cash_override` afterwards, not two with split grants.
drop function if exists ops_acct.set_cash_override(uuid, text, numeric, text, boolean);

create or replace function ops_acct.set_cash_override(
  p_component_id uuid, p_month text, p_amount numeric default null,
  p_reason text default null, p_skip boolean default false,
  p_due_day int default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_before numeric;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','cash_override', p_month,'override',
      'not_permitted','Changing a month needs accounting access.');
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','cash_override', p_month,'override',
      'month_invalid','A month reads as YYYY-MM.', jsonb_build_object('field','month'));
  end if;
  if not exists (select 1 from ops_acct.cash_components where id = p_component_id) then
    return ops_core.not_found('accounting','cash_override', p_month,'override','No such line.');
  end if;
  if not p_skip and (p_amount is null or p_amount < 0) then
    return ops_core.invalid('accounting','cash_override', p_month,'override',
      'amount_required','Give the amount for this month, or say it is skipped.',
      jsonb_build_object('field','amount'));
  end if;

  select amount into v_before from ops_acct.cash_overrides
   where component_id = p_component_id and month = p_month;

  insert into ops_acct.cash_overrides (component_id, month, amount, due_day, reason, recorded_by)
  values (p_component_id, p_month, case when p_skip then null else p_amount end,
          p_due_day, nullif(btrim(p_reason), ''), auth.uid())
  on conflict (component_id, month) do update
    set amount = excluded.amount, due_day = excluded.due_day, reason = excluded.reason,
        recorded_by = excluded.recorded_by, recorded_at = now();

  return ops_core.ok('accounting','cash_override', p_month,'override',
    jsonb_build_object('component_id', p_component_id, 'month', p_month,
                       'amount', case when p_skip then null else p_amount end,
                       'due_day', p_due_day, 'skipped', p_skip),
    to_jsonb(v_before), to_jsonb(case when p_skip then null else p_amount end));
end $$;

-- The grant belongs to the specific overload's oid, not to the name —
-- dropping the old one dropped its grant with it.
grant execute on function
  ops_acct.set_cash_override(uuid, text, numeric, text, boolean, int)
  to authenticated;
