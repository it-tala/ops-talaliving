-- 0271_acct_line_kinds.sql — every ledger line says what kind of money it is
-- (L4, D433/D435/D437).
--
-- A transfer of Rp 3.302.500 to Arif is two things: Rp 3.300.000 of machine
-- service and Rp 2.500 the bank took for carrying it. Until now the ledger
-- could hold both as lines, but the lines could not say which was which — so
-- the catalogue's "last price" for a service could be the fee, and *how much
-- did the banks take this month* was a question nobody could ask. The
-- analysis of 14 Oct (`docs/analysis/2026-10-14-buku-besar-dan-bukti.md`,
-- §6.2, §10.5, §11.2) and the owner's answers (D433, D435) settle the shape:
--
--   * **`transaction_lines.kind`** — `item · fee · tax · shipping · discount
--     · other`, default `item`. The letters a/b the owner wanted (D436) are
--     the line numbers; the kind is what the letter is *for*.
--   * **The amount stays positive; the kind carries the sign.** A `discount`
--     line is subtracted when the lines are summed against the amount, the
--     same rule as `transactions.amount_idr` + `direction`: no signed numbers,
--     so no sum has to remember a convention (0013). An e-commerce order is
--     `item` at the listed price, `discount` for the voucher, `fee` for the
--     courier — Σ = what was paid (D435 point 5). The listed price is what
--     the catalogue learns, never the price after the voucher.
--   * **Tax is a typed amount, never a percentage** (D435 point 1): the
--     screens offer a *nominal pajak* field that becomes a `tax` line; the
--     database has no rate anywhere.
--   * **A bill in another currency, paid in rupiah** (D435 point 1): the
--     transaction keeps `billed_currency` + `billed_amount` beside
--     `amount_idr`. The effective rate is `amount_idr ÷ billed_amount`,
--     computed where it is shown, never typed (D414's one-currency-per-
--     document rule, applied to the ledger).
--   * **Only `item` lines feed prices.** `item_purchases` and
--     `v_purchase_facts` skip every other kind, so a fee never becomes a
--     last-paid price.
--   * **A purchase's fee needs no quantity.** `post_transaction`'s D86 rule —
--     qty and unit price on every line of a purchase — now applies to `item`
--     lines only; a fee or a tax line is an amount.
--   * **A kind nobody sent is guessed from the description**, in one place
--     (`line_kind_guess`): a description that *starts with* *admin fee* /
--     *biaya admin* → `fee`, with *PPN* / *pajak* / *tax* (not a tax
--     consultant) → `tax`, one mentioning *ongkir* → `shipping`. Anchored,
--     because *ELECTRICITY (+ADMIN FEE 4.000)* is electricity — the first
--     draft read it as a fee.
--     Never `discount` — that changes the sign, and a guess must not. The
--     existing lines are backfilled by the same function, once, below.
--
-- `post_transaction` and `edit_transaction` are restated whole (`create or
-- replace` takes a complete body); their old signatures are dropped so
-- PostgREST sees one function under each name (`00_no_overloads`). New
-- arguments are appended after the last one (0105's rule).
--
-- Not here: editing the lines of an existing row (`set_transaction_lines`,
-- L12), `item_id` on lines from the picker (L5), the category (L9).

-- ── 1. the kind ─────────────────────────────────────────────────────────────

create type ops_acct.line_kind_t as enum ('item','fee','tax','shipping','discount','other');
comment on type ops_acct.line_kind_t is
  'What a ledger line is: item (goods or a service, at its listed price), fee (bank/admin/platform), '
  'tax (a typed amount, never a rate), shipping, discount (subtracted when the lines are summed), other.';

alter table ops_acct.transaction_lines
  add column if not exists kind ops_acct.line_kind_t not null default 'item';
comment on column ops_acct.transaction_lines.kind is
  'item · fee · tax · shipping · discount · other (0271). The amount stays positive; a discount is '
  'subtracted when the lines are summed against amount_idr. Only item lines feed price references.';

create index if not exists trx_lines_kind_idx on ops_acct.transaction_lines (kind) where kind <> 'item';

-- ── 2. the bill in another currency ─────────────────────────────────────────

alter table ops_acct.transactions
  add column if not exists billed_currency text,
  add column if not exists billed_amount   numeric;
alter table ops_acct.transactions drop constraint if exists trx_billed_together;
alter table ops_acct.transactions add constraint trx_billed_together check (
  (billed_currency is null) = (billed_amount is null)
  and (billed_amount is null or billed_amount > 0)
  and (billed_currency is null or (billed_currency ~ '^[A-Z]{3}$' and billed_currency <> 'IDR')));
comment on column ops_acct.transactions.billed_currency is
  'The currency the bill was written in when it was not rupiah (USD for a subscription), with '
  'billed_amount. amount_idr is what was paid; the rate is amount_idr / billed_amount, computed, '
  'never stored (D435).';
comment on column ops_acct.transactions.billed_amount is
  'The bill''s own amount in billed_currency. Both or neither (0271).';

-- ── 3. the guess, in one place ──────────────────────────────────────────────

create or replace function ops_acct.line_kind_guess(p_description text)
returns ops_acct.line_kind_t
language sql immutable as $$
  select case
    -- Anchored at the start: *ELECTRICITY (+ADMIN FEE 4.000)* is electricity.
    when p_description ~* '^\s*((transfer|trf|bank|platform) ?)?(admin|adm)\.? ?fee\M|^\s*biaya ?(admin|adm|transfer|trf|bank)\M|^\s*(transfer|trf|bank|platform) ?fee\M|^\s*admin ?bank\M'
      then 'fee'::ops_acct.line_kind_t
    -- *Tax consultant* is a service, not a tax.
    when p_description ~* '^\s*(ppn|pph ?2[1-6]?|pajak|tax|setoran pajak)\M' and p_description !~* '\mkonsultan|\mconsult'
      then 'tax'::ops_acct.line_kind_t
    when p_description ~* '\mongkir\M|\mongkos ?kirim\M|\mshipping\M|\mdelivery ?fee\M|\mbiaya ?kirim\M'
      then 'shipping'::ops_acct.line_kind_t
    else 'item'::ops_acct.line_kind_t end
$$;
comment on function ops_acct.line_kind_guess(text) is
  'The kind a line''s description suggests when the caller sent none: fee, tax, shipping — never '
  'discount, which would change the sign. Used by post_transaction and by the 0271 backfill.';
revoke execute on function ops_acct.line_kind_guess(text) from public;
grant  execute on function ops_acct.line_kind_guess(text) to authenticated;

-- The kind as sent, or guessed; null for a word this system does not know.
create or replace function ops_acct.line_kind_of(p_kind text, p_description text)
returns ops_acct.line_kind_t
language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(p_kind, '')), '') is null then
    return ops_acct.line_kind_guess(coalesce(p_description, ''));
  end if;
  begin
    return lower(btrim(p_kind))::ops_acct.line_kind_t;
  exception when invalid_text_representation then
    return null;
  end;
end $$;
revoke execute on function ops_acct.line_kind_of(text, text) from public;
grant  execute on function ops_acct.line_kind_of(text, text) to authenticated;

-- ── 4. the backfill: what the descriptions already say ──────────────────────
-- Fee, tax and shipping only — the guess never says discount. Everything the
-- guess cannot read stays `item` for the re-detailing queue (L12).
update ops_acct.transaction_lines
   set kind = ops_acct.line_kind_guess(description)
 where kind = 'item' and ops_acct.line_kind_guess(description) <> 'item';

-- ── 5. post_transaction ─────────────────────────────────────────────────────

drop function if exists ops_acct.post_transaction(
  text, ops_acct.direction_t, numeric, text, text, jsonb, date, text, text, jsonb, text, text, text);

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
  'p_billed_currency + p_billed_amount keep a bill written in another currency. Arguments are '
  'appended after p_key so positional callers keep their meaning.';

-- ── 6. edit_transaction: the bill in another currency ───────────────────────

drop function if exists ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text, text);

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
  p_direction text default null,
  p_billed_currency text default null,  -- 0271: '' clears both; a code sets both with p_billed_amount
  p_billed_amount numeric default null)
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

  if v_amount = t.amount_idr and v_desc = t.description
     and v_vendor is not distinct from t.vendor_id
     and v_project is not distinct from t.project_id
     and v_type = t.type_code
     and acc_to.id = acc_from.id
     and v_dir = t.direction
     and v_billed_ccy is not distinct from t.billed_currency
     and v_billed_amt is not distinct from t.billed_amount then
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

  update ops_acct.transactions
     set amount_idr = v_amount, description = v_desc,
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
                       'direction', v_dir, 'billed_currency', v_billed_ccy, 'billed_amount', v_billed_amt),
    v_detail, v_before, v_after);
  return ops_core.idem_remember('accounting','edit:' || p_trx_no, p_key, res);
end $$;

revoke execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text, text, numeric) from public;
grant execute on function ops_acct.edit_transaction(
  text, numeric, text, text, text, text, text, text, text, text, text, numeric) to authenticated;

comment on function ops_acct.edit_transaction(text, numeric, text, text, text, text, text, text, text, text, text, numeric) is
  'Correcting a ledger row in place. Amount and description since 0101; vendor, project and type '
  'since 0105, by code, where null keeps and '''' clears; the account since 0204; IN/OUT since 0269; '
  'the bill in another currency since 0271 (p_billed_currency '''' clears both, a code sets both '
  'with p_billed_amount). New arguments are appended after the last so positional callers keep '
  'their meaning. (0271)';

-- ── 7. the detail view: each line's kind, and the bill ──────────────────────
-- Same columns in the same order plus two at the end — the only change
-- `create or replace view` allows (0268 explains why `v.*` is kept as it was).
create or replace view ops_acct.v_transaction_detail as
  select v.*,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents,
         t.billed_currency,
         t.billed_amount
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'trx_id', l.trx_id,
               'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
               'description', l.description, 'qty', l.qty, 'uom', l.uom,
               'unit_price', l.unit_price, 'amount', l.amount)
             order by l.line_no) as lines
        from ops_acct.transaction_lines l where l.trx_id = v.id
    ) li on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'pr_line_no', a.pr_line_no, 'po_no', a.po_no,
               'amount', a.amount, 'method', a.method,
               'allocated_by', a.allocated_by_name, 'allocated_at', a.allocated_at,
               'line_description', a.line_description, 'line_status', a.line_status)
             order by a.allocated_at) as allocations
        from ops_acct.v_allocation a
       where a.trx_id = v.id and a.superseded_by is null
    ) ac on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'attachment_id', at.id, 'filename', at.filename, 'url', at.url,
               'kind', k.kind, 'linked_at', k.linked_at)
             order by k.linked_at) as documents
        from ops_core.attachment_links k
        join ops_core.attachments at on at.id = k.attachment_id
       where k.entity = 'transaction' and k.entity_no = v.trx_no
         and k.unlinked_at is null
    ) dc on true;

alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction_detail to authenticated;
comment on view ops_acct.v_transaction_detail is
  'One ledger row with its lines (each with its kind since 0271), allocations, documents, and the '
  'bill in another currency when there was one.';

-- ── 8. only item lines feed prices ──────────────────────────────────────────

create or replace function ops_procure.item_purchases(p_code text, p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare i ops_procure.items; rows jsonb;
begin
  if not (ops_core.has_permission('procurement.read') or ops_core.has_permission('inventory.read')) then
    return ops_core.refused('procurement','item', p_code,'purchases',
      'not_permitted','Reading purchase history needs procurement or inventory access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'purchases','No such item.');
  end if;

  select coalesce(jsonb_agg(r order by r.trx_date desc, r.trx_no desc), '[]'::jsonb) into rows
    from (
      select t.trx_no, t.trx_date, t.status::text as status, a.code as account_code,
             coalesce(vm.name, v.name) as vendor_name,
             tl.description, tl.qty, tl.uom, tl.unit_price, tl.amount,
             src.code as item_code, src.name as item_name
        from ops_acct.transaction_lines tl
        join ops_acct.transactions t on t.id = tl.trx_id and t.status <> 'VOID'
        join ops_acct.accounts a on a.id = t.account_id
        join ops_procure.items src on src.id = tl.item_id
        left join ops_procure.vendors v on v.id = t.vendor_id
        left join ops_procure.vendors vm on vm.id = v.merged_into
       where (src.id = i.id or src.merged_into = i.id)
         and tl.kind = 'item'                      -- 0271: a fee is not a price
       order by t.trx_date desc, t.trx_no desc
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) r;

  return jsonb_build_object('outcome','ok','status',200,'data', rows);
end $$;

-- 0175 made it volatile on purpose (it answers rows through a definer); kept.
alter function ops_procure.item_purchases(text, integer) volatile;

create or replace view ops_procure.v_purchase_facts as
  select coalesce(i.merged_into, i.id)             as item_id,
         coalesce(im.name, i.name)                 as item_name,
         coalesce(im.category_code, i.category_code) as category_code,
         coalesce(v.merged_into, v.id) as vendor_id,
         coalesce(vm.name, v.name)     as vendor_name,
         l.unit_price,
         l.uom,
         coalesce(d.submitted_at, d.created_at) as at,
         'pr'::text as source
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    join ops_procure.items   i on i.id = l.item_id
    left join ops_procure.items im on im.id = i.merged_into
    join ops_procure.vendors v on v.id = l.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into
   where l.removed_at is null
  union all
  select coalesce(i.merged_into, i.id),
         coalesce(im.name, i.name),
         coalesce(im.category_code, i.category_code),
         coalesce(v.merged_into, v.id),
         coalesce(vm.name, v.name),
         tl.unit_price, tl.uom,
         t.posted_at,
         'ledger'
    from ops_acct.transaction_lines tl
    join ops_acct.transactions t on t.id = tl.trx_id and t.status <> 'VOID'
    join ops_procure.items   i on i.id = tl.item_id
    left join ops_procure.items im on im.id = i.merged_into
    join ops_procure.vendors v on v.id = t.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into
   where tl.kind = 'item';                          -- 0271

-- `create or replace view` drops the view's options (0104 did the same).
alter view ops_procure.v_purchase_facts set (security_invoker = on);
grant select on ops_procure.v_purchase_facts to authenticated;

analyze ops_acct.transaction_lines;
analyze ops_acct.transactions;
