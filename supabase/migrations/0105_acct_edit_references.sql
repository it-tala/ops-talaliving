-- 0105_acct_edit_references.sql — correcting who, what for, and what kind.
--
-- ── Why the seam was not enough ──────────────────────────────────────────
--
-- `0101` let Accounting fix a ledger row's **amount** and **description**,
-- which is what the owner asked for on 2026-09-23. The import that landed the
-- next day made the gap visible with numbers:
--
--     59   transactions name a vendor that resolves to nobody
--     11   name a project the project table spells differently
--    184   arrived as `OTHERS` because the legacy row had no type
--
-- Every one of those is a correction a person can make from a document in
-- front of them, and none of them was reachable. The screen could fix the
-- number on a row and not who it was paid to.
--
-- Owner, 2026-09-23: extend it to vendor, project and type.
--
-- ── By code, because that is what the ledger already speaks ──────────────
--
-- `post_transaction` (`0021`) takes `p_vendor_code` and `p_project_code`, and
-- refuses a code it cannot find rather than creating one. This does the same,
-- with the same refusal wording, so a person who has seen one has seen both. A
-- uuid would work and would mean two ways of naming a vendor depending on
-- which seam you reached.
--
-- ── Clearing is not the same as leaving alone ────────────────────────────
--
-- `amount` and `description` are `not null`, so for them `null` can safely mean
-- *keep this*. `vendor_id` and `project_id` are nullable — 460 rows carry no
-- vendor and 2.570 no project — so *leave it alone* and *take it off* are two
-- different instructions and both have to be sayable.
--
--   `null`  leave it as it is
--   `''`    clear it
--   a code  resolve it, or refuse
--
-- Somebody who filed a payment against the wrong vendor needs the second one.
-- Without it the only way back is VOID and post again, which is a heavy
-- correction for a field that moves no money.
--
-- `p_type_code` has no clearing case: `type_code` is `not null`, and `OTHERS`
-- is the name this system already uses for *nobody classified this*.
--
-- ── What deliberately did NOT change ─────────────────────────────────────
--
-- The remark stays required for **the amount only**, exactly as `0101` set it.
-- A case can be made that changing the vendor on a paid row deserves one too —
-- it changes who we believe we paid — but that is a rule about what people owe
-- an explanation for, and inventing it inside a migration is how a policy
-- nobody agreed to ends up enforced. Raised with the owner instead; every
-- change lands in the audit either way, with before and after.
--
-- The amount's guards are untouched, and *untouched* had to be checked rather
-- than assumed. This was first written from `0101`'s body — and `0102` had
-- already replaced it, so the first draft silently reinstated the
-- `below_allocated` refusal the owner had removed the day before. A smoke
-- caught it. **When a seam has been replaced, the body to extend is the last
-- one, not the one whose file you happen to be reading.**
--
-- So: below what is already applied stays allowed (`0102`), recorded in the
-- audit detail rather than refused; matched to a bank statement still refuses;
-- a VOID row still refuses. A vendor or project correction is subject to none
-- of those, and should not be — the bank's record is about the number, and an
-- allocation is about money applied, neither of which a vendor name moves.

/* `create or replace` would leave the five-argument version in place beside
   this one, and PostgREST cannot choose between two functions when it calls
   by name with no types — every existing call would start answering
   `PGRST203`. Dropped by full signature so the statement fails loudly if that
   is not what is there. (00_no_overloads.sql) */
drop function if exists ops_acct.edit_transaction(text, numeric, text, text, text);

/* **The new arguments go on the end, after `p_key`.**
 *
 * Every other seam in this ladder ends with `p_key`, and putting the three
 * references before it reads better. It was written that way first, and
 * `92_acct_edit_transaction.sql` failed on the next run with:
 *
 *     expected ok, got refused / There is no vendor nota says 600.
 *
 * Thirteen call sites pass their arguments **positionally**, and position 4
 * had been `p_reason` since `0101`. Inserting `p_vendor_code` there did not
 * break them — it silently changed what they meant, and the only reason it was
 * loud is that a remark does not look like a vendor code. A remark reading
 * `V-9001` would have set a vendor and said nothing.
 *
 * PostgREST calls by name, so the web app never saw it. Everything inside the
 * database does not.
 *
 * So the convention loses to the compatibility: appended at the end, existing
 * positional calls of one to five arguments keep their exact meaning, and the
 * rule going forward is that **a seam's parameters are only ever appended**.
 */
create or replace function ops_acct.edit_transaction(
  p_trx_no text,
  p_amount numeric default null,
  p_description text default null,
  p_reason text default null,
  p_key text default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_type_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  t ops_acct.transactions; l ops_acct.transaction_lines;
  v_amount numeric; v_desc text; v_reason text; v_alloc numeric;
  v_lines int; v_synced boolean := false;
  v_vendor uuid; v_project uuid; v_type text;
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

  if v_amount = t.amount_idr and v_desc = t.description
     and v_vendor is not distinct from t.vendor_id
     and v_project is not distinct from t.project_id
     and v_type = t.type_code then
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

  update ops_acct.transactions
     set amount_idr = v_amount, description = v_desc,
         vendor_id = v_vendor, project_id = v_project, type_code = v_type
   where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.edited', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'before', v_before, 'after', v_after,
                       'reason', v_reason));

  res := ops_core.say('accounting','transaction', p_trx_no,'edit','ok', 200,
    null, v_reason,
    jsonb_build_object('trx_no', p_trx_no, 'amount_idr', v_amount, 'description', v_desc),
    v_detail, v_before, v_after);
  return ops_core.idem_remember('accounting','edit:' || p_trx_no, p_key, res);
end $$;

grant execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text) to authenticated;

comment on function ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text) is
  'Correcting a ledger row in place. Amount and description since 0101; vendor, project and type '
  'since 0105, by code, where null keeps and '''' clears. A remark is required for the amount '
  'only. New arguments are appended after p_key so positional callers keep their meaning. (0105)';
