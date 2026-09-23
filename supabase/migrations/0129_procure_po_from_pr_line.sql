-- 0129 — an order knows which request line it buys, and money paid on either
--        side reads on both (B7, B8).
--
-- ── what the walk found ──────────────────────────────────────────────────
--
-- F149: `po_lines` had no column for the request line it fulfils. So *a PO is
-- built from an approved line* was a habit, the goods arriving against an
-- order never moved the request line past APPROVED, and money had to be
-- pointed at one side or the other: paid on the line, the order read UNPAID;
-- and there was no button to pay the order at all.
--
-- ── the link (B7) ─────────────────────────────────────────────────────────
--
-- `po_lines.pr_line_id`, optional — a standing contract or a repair quoted on
-- the spot has no request behind it, and refusing those would push them off
-- the system (D30). When it is named, `create_po` insists on three things:
-- the line has goods approval, it is not already on another live order, and
-- it is counted in the same unit. The last is what lets an arrival on the
-- order move the request line: ten sheets received are ten sheets of *that*
-- line, with no conversion anybody has to trust. An amendment carries the
-- link to the new line; a superseded line keeps it, so receipts recorded
-- against the old line still count.
--
-- A request line with **no quantity** cannot be linked. It is money — a
-- deposit, a lump-sum quote — and the fixtures already show how that funds an
-- order: its payment names the order (`alc_03`), and it reaches PAID and stops.
-- Linking it would let arrivals move a line that was never goods (A1).
--
-- `pr_lines.po_line_id` exists from the first ladder with the opposite
-- meaning — *this request line funds that order line* — and no seam has ever
-- written it. It is left alone rather than repurposed: a column whose meaning
-- changes under the same name is how two readers end up disagreeing.
--
-- One live order per request line is checked in the seam and not by an index,
-- because *live* includes the order's status (a cancelled order releases its
-- lines) and an index cannot see another table.
--
-- ── the money (B8) ────────────────────────────────────────────────────────
--
-- `payment_allocations` has always allowed a row to name both a request line
-- and an order (`allocation_has_target` asks for at least one); only
-- `allocate_payment` insisted on exactly one. Every reader counts one side:
-- `v_line_funding` sums by `pr_line_no`, `v_po_status` by `po_no`, and nothing
-- adds the two. So a row that names both is counted **once on each side**,
-- which is what it is — one payment for one purchase, seen from the request
-- and from the order.
--
-- * Paying a linked request line (`post_from_line` → `allocate_payment`)
--   stamps the order on the allocation. The caller still names one target;
--   the order is found from the link, never taken from the screen.
-- * Linking a line that was already paid restamps its allocations: the old
--   row is superseded by one naming both, never edited (A5).
-- * `ops_acct.post_to_po` pays an issued order from its own screen. The money
--   is split across the order's linked lines in proportion to their value,
--   each share naming its line and the order; whatever belongs to unlinked
--   lines names the order alone. The split is stored, not derived: *which
--   line did this transfer pay* is a fact about the payment, decided once,
--   and a derivation would re-decide it every time a line was amended.

alter table ops_procure.po_lines
  add column pr_line_id uuid references ops_procure.pr_lines(id);
create index po_lines_pr_line_idx on ops_procure.po_lines (pr_line_id) where pr_line_id is not null;
comment on column ops_procure.po_lines.pr_line_id is
  'The approved request line this order line buys, when there is one. Checked in create_po: '
  'approved, not on another live order, same unit. Kept on superseded lines. (0129, B7)';

-- The live order a request line is on, if any.
create or replace function ops_procure.order_of_line(p_line_no text)
returns text language sql stable
set search_path = ops_procure, pg_temp as $$
  select p.po_no
    from ops_procure.po_lines o
    join ops_procure.pr_lines l on l.id = o.pr_line_id
    join ops_procure.purchase_orders p on p.id = o.po_id
   where l.line_no_full = p_line_no
     and o.superseded_by is null
     and p.status <> 'CANCELLED'
   order by p.created_at desc
   limit 1;
$$;
grant execute on function ops_procure.order_of_line(text) to authenticated;

-- Money already on a request line, restated as also reaching its order.
-- Internal: called by `create_po` as its owner, never from a screen.
create or replace function ops_procure.restamp_line_money(p_line_no text, p_po_no text)
returns int language plpgsql security definer
set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare a ops_acct.payment_allocations; new_id uuid; n int := 0;
begin
  for a in
    select al.* from ops_acct.payment_allocations al
      join ops_acct.transactions t on t.id = al.trx_id
     where al.pr_line_no = p_line_no and al.po_no is null
       and al.superseded_by is null and t.status <> 'VOID'
  loop
    insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
    values (a.trx_id, a.pr_line_no, p_po_no, a.amount, a.method, coalesce(auth.uid(), a.allocated_by))
    returning id into new_id;
    update ops_acct.payment_allocations set superseded_by = new_id where id = a.id;
    n := n + 1;
  end loop;
  if n > 0 then
    perform ops_core.emit('accounting','accounting.allocation.restamped', p_line_no,
      jsonb_build_object('pr_line_no', p_line_no, 'po_no', p_po_no, 'rows', n));
  end if;
  return n;
end $$;
revoke execute on function ops_procure.restamp_line_money(text, text) from public;

-- Arrivals against an order count for the request line it buys (B7).
create or replace view ops_procure.v_line_receiving as
select coalesce(r.line_id, o.pr_line_id) as line_id,
       sum(r.qty_received) filter (where ops_procure.receipt_counts(r.condition, r.status)) as received_qty,
       sum(r.qty_received) filter (where r.status = 'REPORTED') as reported_qty,
       bool_or(ops_procure.receipt_is_problem(r.condition)) as has_problem
  from ops_procure.receipts r
  left join ops_procure.po_lines o on o.id = r.po_line_id
 where coalesce(r.line_id, o.pr_line_id) is not null
 group by 1;
alter view ops_procure.v_line_receiving set (security_invoker = on);

-- CREATE_PO
create or replace function ops_procure.create_po(p_vendor_code text, p_lines jsonb, p_dp_percent numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_expected_delivery date DEFAULT NULL::date, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $$
declare
  v ops_procure.vendors; v_po_no text; v_po_id uuid; n int; priceless text;
  replayed jsonb; res jsonb; x record; v_dup text;
begin
  replayed := ops_core.idem_replay('procurement','create_po', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','purchase_order', null,'create',
      'not_permitted','Raising an order needs procurement access.');
  end if;

  select * into v from ops_procure.vendors where code = p_vendor_code;
  if not found then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'vendor_required','An order is placed with somebody. Choose the vendor first.',
      jsonb_build_object('field','vendor_code'));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'lines_required','An order with no lines is not an order.',
      jsonb_build_object('field','lines'));
  end if;

  -- A contract value nobody agreed is not a contract. Refused rather than
  -- warned, because this figure is what the vendor will invoice against.
  select l ->> 'description' into priceless
    from jsonb_array_elements(p_lines) l
   where coalesce(nullif(l ->> 'unit_price','')::numeric, 0) <= 0
   limit 1;
  if priceless is not null then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'price_required',
      format('"%s" has no unit price. A contract value nobody agreed is not a contract.', priceless),
      jsonb_build_object('field','lines'));
  end if;

  if p_dp_percent is not null and (p_dp_percent < 0 or p_dp_percent > 100) then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'dp_out_of_range','A deposit is between 0 and 100 per cent.',
      jsonb_build_object('field','dp_percent'));
  end if;

  -- ── the request line each order line buys (B7) ─────────────────────────
  -- Optional, because not every order starts from a request (a standing
  -- contract, a repair the vendor quoted on the spot). When one is named it
  -- has to be a line somebody said yes to, it cannot already be on another
  -- live order, and it has to be counted in the same unit — otherwise the
  -- arrivals this order records would move the request line by the wrong
  -- number.
  select l ->> 'pr_line_no' into v_dup
    from jsonb_array_elements(p_lines) l
   where nullif(l ->> 'pr_line_no','') is not null
   group by 1 having count(*) > 1 limit 1;
  if v_dup is not null then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'line_named_twice', format('%s is named on two lines of this order.', v_dup),
      jsonb_build_object('field','lines'));
  end if;

  for x in
    select l ->> 'pr_line_no' as want, l ->> 'uom' as uom, pl.id, pl.removed_at, pl.uom as pr_uom,
           pl.qty as pr_qty, ap.approved,
           (select p2.po_no from ops_procure.po_lines o
              join ops_procure.purchase_orders p2 on p2.id = o.po_id
             where o.pr_line_id = pl.id and o.superseded_by is null
               and p2.status <> 'CANCELLED' limit 1) as on_po
      from jsonb_array_elements(p_lines) l
      left join ops_procure.pr_lines pl on pl.line_no_full = l ->> 'pr_line_no'
      left join ops_procure.v_line_approval ap on ap.line_id = pl.id and ap.step = 'GOODS'
     where nullif(l ->> 'pr_line_no','') is not null
  loop
    if x.id is null then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'pr_line_not_found', format('Request line %s does not exist.', x.want),
        jsonb_build_object('field','lines'));
    end if;
    if x.removed_at is not null then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_removed', format('Request line %s has been removed.', x.want));
    end if;
    if x.approved is not true then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_not_approved',
        format('Request line %s has no goods approval. Approving the goods comes before ordering them.', x.want),
        jsonb_build_object('pr_line_no', x.want));
    end if;
    if x.on_po is not null then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_already_ordered',
        format('Request line %s is already ordered on %s.', x.want, x.on_po),
        jsonb_build_object('pr_line_no', x.want, 'po_no', x.on_po));
    end if;
    -- A line with no quantity is a sum of money — a deposit, a lump-sum quote
    -- — and it funds an order through its payment, not by being one of its
    -- lines. Linking it would let arrivals on the order move a line that was
    -- never goods, which is the collapse A1 forbids.
    if x.pr_qty is null then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'lump_sum_line',
        format('Request line %s has no quantity, so it is money rather than goods. It is paid, not ordered.', x.want),
        jsonb_build_object('field','lines','pr_line_no', x.want));
    end if;
    if x.pr_uom is not null and x.uom is distinct from x.pr_uom then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'uom_differs',
        format('Request line %s is counted in %s and this order line in %s. Order it in the same unit, or arrivals will move the request by the wrong number.',
               x.want, x.pr_uom, coalesce(x.uom,'nothing')),
        jsonb_build_object('field','lines','pr_line_no', x.want));
    end if;
  end loop;

  v_po_no := ops_core.next_doc_number('po');

  insert into ops_procure.purchase_orders
    (po_no, vendor_id, status, created_by, note, expected_delivery)
  values (v_po_no, v.id, 'DRAFT', auth.uid(), nullif(btrim(p_note), ''), p_expected_delivery)
  returning id into v_po_id;

  insert into ops_procure.po_lines
    (po_id, line_no, item_id, description, qty, uom, unit_price, line_total, pr_line_id)
  select v_po_id, ord,
         nullif(l ->> 'item_id','')::uuid,
         btrim(l ->> 'description'),
         (l ->> 'qty')::numeric,
         l ->> 'uom',
         (l ->> 'unit_price')::numeric,
         round((l ->> 'qty')::numeric * (l ->> 'unit_price')::numeric),
         (select pl.id from ops_procure.pr_lines pl where pl.line_no_full = nullif(l ->> 'pr_line_no',''))
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  get diagnostics n = row_count;

  -- Money that already reached a request line now reached this order too: it
  -- is the same purchase. The allocation is superseded by one that names both,
  -- never edited, so what it said before the order existed stays readable
  -- (A5). Without this a line paid before it was ordered leaves the order
  -- reading UNPAID for money that has already left the bank (B8).
  perform ops_procure.restamp_line_money(pl.line_no_full, v_po_no)
     from ops_procure.po_lines o join ops_procure.pr_lines pl on pl.id = o.pr_line_id
    where o.po_id = v_po_id;

  -- Two terms or none. A deposit with no matching balance term would leave the
  -- rest of the order owed against nothing, and `v_po_terms` would report the
  -- order as fully payable once 30% had been paid.
  if p_dp_percent is not null and p_dp_percent > 0 then
    insert into ops_procure.po_schedule (po_id, term_no, kind, basis, basis_value, due_rule) values
      (v_po_id, v_po_no || '-M01','DP',   'percent', p_dp_percent,       'on_issue'),
      (v_po_id, v_po_no || '-M02','FINAL','percent', 100 - p_dp_percent, 'on_delivery');
  end if;

  perform ops_core.emit('procurement','procurement.po.created', v_po_no,
    jsonb_build_object('po_no', v_po_no, 'vendor', p_vendor_code, 'lines', n));

  res := ops_core.ok('procurement','purchase_order', v_po_no,'create',
    jsonb_build_object('po_no', v_po_no, 'status','DRAFT','lines', n));
  return ops_core.idem_remember('procurement','create_po', p_key, res);
end $$;

-- AMEND
create or replace function ops_procure.amend_po_line(p_po_no text, p_line_no integer, p_reason text, p_qty numeric DEFAULT NULL::numeric, p_unit_price numeric DEFAULT NULL::numeric, p_description text DEFAULT NULL::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $$
declare
  po ops_procure.purchase_orders; old ops_procure.po_lines; new_id uuid;
  v_qty numeric; v_price numeric; v_reason text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'amend',
      'not_permitted','Amending an order needs procurement access.');
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'reason_required',
      'An amendment changes a document the vendor is holding. Say what changed and why.',
      jsonb_build_object('field','reason'));
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend','No such order.');
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'amend',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;

  select * into old from ops_procure.po_lines
   where po_id = po.id and line_no = p_line_no and superseded_by is null;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend',
      format('Line %s is not on this order.', p_line_no));
  end if;

  -- Resolved against the line as it stands, so *unchanged* is a value rather
  -- than a special case, and the validation below sees what will be written.
  v_qty   := coalesce(p_qty, old.qty);
  v_price := coalesce(p_unit_price, old.unit_price);

  if v_qty <= 0 or v_price < 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'bad_values','A quantity is more than nothing and a price is not negative.');
  end if;
  -- Nothing to record is not an amendment, and writing one would bump the
  -- revision and tell a vendor their paper is out of date when it is not.
  if v_qty = old.qty and v_price = old.unit_price
     and coalesce(nullif(btrim(p_description), ''), old.description) = old.description then
    return ops_core.noop('procurement','purchase_order', p_po_no,'amend',
      'nothing changed on that line',
      jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no));
  end if;

  new_id := gen_random_uuid();
  update ops_procure.po_lines set superseded_by = new_id where id = old.id;

  insert into ops_procure.po_lines
    (id, po_id, line_no, item_id, description, qty, uom, unit_price, line_total, pr_line_id)
  values (new_id, po.id, old.line_no, old.item_id,
          coalesce(nullif(btrim(p_description), ''), old.description),
          v_qty, old.uom, v_price, round(v_qty * v_price), old.pr_line_id);

  if po.status = 'ISSUED' then
    update ops_procure.purchase_orders set revision = revision + 1 where id = po.id;
  end if;

  perform ops_core.emit('procurement','procurement.po.amended', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no, 'reason', v_reason,
                       'from', jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price),
                       'to',   jsonb_build_object('qty', v_qty, 'unit_price', v_price)));

  res := ops_core.ok('procurement','purchase_order', p_po_no,'amend',
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no,
                       'po_line_id', new_id, 'reason', v_reason),
    jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price, 'line_total', old.line_total),
    jsonb_build_object('qty', v_qty, 'unit_price', v_price, 'line_total', round(v_qty * v_price)));
  return ops_core.idem_remember('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key, res);
end $$;

-- ALLOC
create or replace function ops_acct.allocate_payment(p_trx_no text, p_amount numeric, p_pr_line_no text DEFAULT NULL::text, p_po_no text DEFAULT NULL::text, p_method ops_acct.alloc_method_t DEFAULT 'transfer'::ops_acct.alloc_method_t, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_acct', 'ops_core', 'ops_procure', 'pg_temp'
AS $$
declare
  t ops_acct.transactions; l ops_procure.pr_lines; already numeric;
  v_target text; replayed jsonb; res jsonb; v_po_no text;
begin
  v_target := coalesce(p_pr_line_no, p_po_no);
  replayed := ops_core.idem_replay('accounting','allocate:' || coalesce(v_target, '?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','allocation', v_target,'allocate',
      'authority_required','Applying money to a decision belongs to Accounting.');
  end if;

  if (p_pr_line_no is null) = (p_po_no is null) then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'target_required',
      'An allocation points at a request line or at an order, and at exactly one.',
      jsonb_build_object('field','pr_line_no'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'amount_positive','Allocation amount must be greater than zero.',
      jsonb_build_object('field','amount'));
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','allocation', v_target,'allocate',
      format('Transaction %s not found.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','allocation', v_target,'allocate',
      'transaction_void', format('%s is VOID and cannot fund anything.', p_trx_no));
  end if;

  if p_pr_line_no is not null then
    select * into l from ops_procure.pr_lines where line_no_full = p_pr_line_no;
    if not found then
      return ops_core.invalid('accounting','allocation', v_target,'allocate',
        'pr_line_not_found',
        format('Line %s does not exist in procurement.', p_pr_line_no),
        jsonb_build_object('field','pr_line_no'));
    end if;
    if l.removed_at is not null then
      return ops_core.conflict('accounting','allocation', v_target,'allocate',
        'line_removed', format('Line %s has been removed.', p_pr_line_no));
    end if;
  elsif not exists (select 1 from ops_procure.purchase_orders where po_no = p_po_no) then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'po_not_found', format('Order %s does not exist in procurement.', p_po_no),
      jsonb_build_object('field','po_no'));
  end if;

  select coalesce(allocated_total, 0) into already
    from ops_acct.v_allocated where trx_id = t.id;

  if coalesce(already, 0) + p_amount > t.amount_idr then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'over_allocated',
      format('This transaction only moved %s; %s is already allocated. A transaction never funds more than it moved.',
             t.amount_idr, coalesce(already, 0)),
      jsonb_build_object('field','amount','moved', t.amount_idr,
                         'already', coalesce(already, 0), 'attempted', p_amount));
  end if;

  -- A request line that is on an order is paid on that order as well (B8).
  -- The caller still names exactly one target; the order is found here, from
  -- the link, so a screen cannot claim a line belongs to an order it does not.
  v_po_no := p_po_no;
  if p_pr_line_no is not null then
    v_po_no := ops_procure.order_of_line(p_pr_line_no);
  end if;

  insert into ops_acct.payment_allocations
    (trx_id, pr_line_no, po_no, amount, method, allocated_by)
  values (t.id, p_pr_line_no, v_po_no, p_amount, p_method, auth.uid());

  perform ops_core.emit('accounting','accounting.allocation.recorded', v_target,
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', v_po_no, 'amount', p_amount));

  res := ops_core.ok('accounting','allocation', v_target,'allocate',
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', v_po_no, 'amount', p_amount,
                       'unallocated', t.amount_idr - coalesce(already, 0) - p_amount));
  return ops_core.idem_remember('accounting','allocate:' || coalesce(v_target, '?'), p_key, res);
end $$;

-- DETAIL
create or replace view ops_procure.v_po_detail as
SELECT po.po_no,
    po.vendor_id,
    v.name AS vendor_name,
    v.pic_name AS vendor_pic,
    COALESCE(v.pic_phone, v.phone) AS vendor_phone,
    po.status,
    po.expected_delivery,
        CASE
            WHEN (po.expected_delivery IS NULL) THEN NULL::integer
            WHEN (po.status = ANY (ARRAY['CLOSED'::ops_procure.po_status_t, 'CANCELLED'::ops_procure.po_status_t])) THEN NULL::integer
            WHEN s.fully_delivered THEN NULL::integer
            WHEN (ops_core.office_day() > po.expected_delivery) THEN (ops_core.office_day() - po.expected_delivery)
            ELSE NULL::integer
        END AS days_late,
    po.revision,
    po.sent_revision,
    po.approval_asked_at,
    asked.full_name AS approval_asked_by_name,
    po.approved_at,
    appr.full_name AS approved_by_name,
    po.approval_note,
    po.note,
    po.created_at,
    po.issued_at,
    iss.full_name AS issued_by_name,
    s.contract_value,
    s.paid_to_date,
    s.outstanding,
    s.value_received,
    s.exposure,
    s.credit,
    s.payment_state,
    s.delivery_state,
    s.dp_percent,
    j.billable_now,
    COALESCE(ln.lines, '[]'::jsonb) AS lines,
    COALESCE(tm.terms, '[]'::jsonb) AS terms,
    COALESCE(tm.payable_now, (0)::numeric) AS payable_now,
    COALESCE(am.amendments, '[]'::jsonb) AS amendments,
    COALESCE(pm.payments, '[]'::jsonb) AS payments,
    COALESCE(dc.documents, '[]'::jsonb) AS documents,
    ( SELECT COALESCE(jsonb_agg(blockers.b), '[]'::jsonb) AS "coalesce"
           FROM ( SELECT 'It is already closed.'::text AS b
                  WHERE (po.status = 'CLOSED'::ops_procure.po_status_t)
                UNION ALL
                 SELECT 'It was never issued — cancel it rather than close it.'::text
                  WHERE (po.status = 'DRAFT'::ops_procure.po_status_t)
                UNION ALL
                 SELECT format('%s of the contract has not been paid.'::text, s.outstanding) AS format
                  WHERE (s.outstanding > (0)::numeric)
                UNION ALL
                 SELECT 'Not everything ordered has arrived.'::text
                  WHERE (NOT s.fully_delivered)) blockers) AS close_blockers,
    jsonb_build_object('po_id', s.po_id, 'contract_value', s.contract_value, 'paid_to_date', s.paid_to_date, 'outstanding', s.outstanding, 'value_received', s.value_received, 'exposure', s.exposure, 'payment_state', s.payment_state, 'delivery_state', s.delivery_state) AS status_view,
    po.self_confirmed,
    (po.approval_sent_to)::text AS approval_sent_to
   FROM (((((((((((ops_procure.purchase_orders po
     JOIN ops_procure.vendors v ON ((v.id = po.vendor_id)))
     JOIN ops_procure.v_po_status s ON ((s.po_id = po.id)))
     JOIN ops_procure.v_po_journey j ON ((j.po_id = po.id)))
     LEFT JOIN ops_core.users asked ON ((asked.id = po.approval_asked_by)))
     LEFT JOIN ops_core.users appr ON ((appr.id = po.approved_by)))
     LEFT JOIN ops_core.users iss ON ((iss.id = po.issued_by)))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('po_line_id', d.po_line_id, 'line_no', d.line_no, 'description', d.description, 'qty', d.qty, 'uom', d.uom, 'unit_price', d.unit_price, 'line_total', d.line_total, 'received', d.received, 'reported', d.reported, 'over', d.over, 'condition', d.condition, 'receipts', COALESCE(rc.receipts, '[]'::jsonb), 'pr_line_no', ( SELECT p.line_no_full
                   FROM (ops_procure.po_lines x
                     JOIN ops_procure.pr_lines p ON ((p.id = x.pr_line_id)))
                  WHERE (x.id = d.po_line_id))) ORDER BY d.line_no) AS lines
           FROM (ops_procure.v_po_line_delivery d
             LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('receipt_no', r.receipt_no, 'qty', r.qty_received, 'condition', r.condition, 'at', r.received_at, 'by', COALESCE(rb.full_name, '—'::text), 'qc_by', COALESCE(qb.full_name, '—'::text), 'note', r.note, 'status', r.status, 'photo_attachment_id', ( SELECT k.attachment_id
                           FROM ops_core.attachment_links k
                          WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'goods_photo'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                          ORDER BY k.linked_at
                         LIMIT 1), 'delivery_note_attachment_id', ( SELECT k.attachment_id
                           FROM ops_core.attachment_links k
                          WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'delivery_note'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                          ORDER BY k.linked_at
                         LIMIT 1)) ORDER BY r.received_at) AS receipts
                   FROM ((ops_procure.receipts r
                     LEFT JOIN ops_core.users rb ON ((rb.id = r.received_by)))
                     LEFT JOIN ops_core.users qb ON ((qb.id = r.qc_by)))
                  WHERE (r.po_line_id = d.po_line_id)) rc ON (true))
          WHERE (d.po_id = po.id)) ln ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('term_no', t.term_no, 'kind', t.kind, 'basis', t.basis, 'basis_value', t.basis_value, 'due_rule', t.due_rule, 'due_date', t.due_date, 'amount', t.amount, 'covered', t.covered, 'state', t.state, 'blocked_by', t.blocked_by, 'trigger', t.trigger) ORDER BY t.term_no) AS terms,
            sum(GREATEST((t.amount - t.covered), (0)::numeric)) FILTER (WHERE (t.state = ANY (ARRAY['PAYABLE'::ops_procure.po_term_state_t, 'PARTIAL'::ops_procure.po_term_state_t]))) AS payable_now
           FROM ops_procure.v_po_terms t
          WHERE (t.po_id = po.id)) tm ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('line_no', old.line_no, 'from', ((((old.qty || ' '::text) || old.uom) || ' × '::text) || old.unit_price), 'to',
                CASE
                    WHEN (new_l.id IS NULL) THEN 'removed'::text
                    ELSE ((((new_l.qty || ' '::text) || new_l.uom) || ' × '::text) || new_l.unit_price)
                END, 'at', '') ORDER BY old.line_no DESC) AS amendments
           FROM (ops_procure.po_lines old
             LEFT JOIN ops_procure.po_lines new_l ON ((new_l.id = old.superseded_by)))
          WHERE ((old.po_id = po.id) AND (old.superseded_by IS NOT NULL))) am ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('trx_no', t.trx_no, 'trx_date', t.trx_date, 'amount', al.amount, 'description', t.description) ORDER BY t.trx_date) AS payments
           FROM (ops_acct.payment_allocations al
             JOIN ops_acct.transactions t ON ((t.id = al.trx_id)))
          WHERE ((al.po_no = po.po_no) AND (al.superseded_by IS NULL) AND (t.status <> 'VOID'::ops_acct.trx_status_t))) pm ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('attachment_id', a.id, 'filename', a.filename, 'url', a.url, 'kind', k.kind, 'linked_at', k.linked_at) ORDER BY k.linked_at) AS documents
           FROM (ops_core.attachment_links k
             JOIN ops_core.attachments a ON ((a.id = k.attachment_id)))
          WHERE ((k.entity = 'purchase_order'::ops_core.link_entity_t) AND (k.entity_no = po.po_no) AND (k.unlinked_at IS NULL))) dc ON (true));
alter view ops_procure.v_po_detail set (security_invoker = on);

-- The tracker builds the same nested line as the drawer, and
-- `14_procure_po_board` asserts the two are identical — so the link goes in
-- both, or neither.
create or replace view ops_procure.v_po_line_journey as
SELECT d.po_id,
    jsonb_agg(jsonb_build_object('po_line_id', d.po_line_id, 'line_no', d.line_no, 'description', d.description, 'qty', d.qty, 'uom', d.uom, 'unit_price', d.unit_price, 'line_total', d.line_total, 'received', d.received, 'reported', d.reported, 'over', d.over, 'condition', d.condition, 'receipts', COALESCE(rc.receipts, '[]'::jsonb), 'pr_line_no', ( SELECT p.line_no_full
                   FROM (ops_procure.po_lines x
                     JOIN ops_procure.pr_lines p ON ((p.id = x.pr_line_id)))
                  WHERE (x.id = d.po_line_id))) ORDER BY d.line_no) AS lines
   FROM (ops_procure.v_po_line_delivery d
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('receipt_no', r.receipt_no, 'qty', r.qty_received, 'condition', r.condition, 'at', r.received_at, 'by', COALESCE(rb.full_name, '—'::text), 'qc_by', COALESCE(qb.full_name, '—'::text), 'note', r.note, 'status', r.status, 'photo_attachment_id', ( SELECT k.attachment_id
                   FROM ops_core.attachment_links k
                  WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'goods_photo'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                  ORDER BY k.linked_at
                 LIMIT 1), 'delivery_note_attachment_id', ( SELECT k.attachment_id
                   FROM ops_core.attachment_links k
                  WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'delivery_note'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                  ORDER BY k.linked_at
                 LIMIT 1)) ORDER BY r.received_at) AS receipts
           FROM ((ops_procure.receipts r
             LEFT JOIN ops_core.users rb ON ((rb.id = r.received_by)))
             LEFT JOIN ops_core.users qb ON ((qb.id = r.qc_by)))
          WHERE (r.po_line_id = d.po_line_id)) rc ON (true))
  GROUP BY d.po_id;
alter view ops_procure.v_po_line_journey set (security_invoker = on);

/* Paying an order from its own screen (B8).
 *
 * The same shape as `post_from_line`: one act writes the ledger row and says
 * what it paid for, the authority is checked here as well as in
 * `post_transaction` so the refusal names the order, and no proof means no
 * payment (D85). What is new is only the split — see the header.
 *
 * Refused above what is still outstanding: money beyond the contract is not a
 * payment on this order, it is a question for the vendor, and posting it here
 * would make the order read overpaid rather than asking it.
 */
create or replace function ops_acct.post_to_po(
  p_po_no         text,
  p_amount        numeric,
  p_account_code  text,
  p_type_code     text,
  p_attachment_id uuid,
  p_trx_date      date default null,
  p_document_kind text default 'Payment Proof',
  p_key           text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  po record; posted jsonb; v_trx_no text; v_trx_id uuid; v_src text;
  x record; share numeric; spent numeric := 0; shares jsonb := '[]'::jsonb;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_to_po:' || coalesce(p_po_no,'?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_po_no,'post_to_po',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  select p.id, p.po_no, p.status, v.code as vendor_code, s.contract_value, s.outstanding
    into po
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no;
  if not found then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'po_not_found', format('Order %s does not exist.', p_po_no), jsonb_build_object('field','po_no'));
  end if;
  if po.status = 'DRAFT' then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'not_issued', format('%s has not been issued — nothing is owed on an order the vendor has not received.', p_po_no));
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'amount_positive','A payment is more than nothing.', jsonb_build_object('field','amount'));
  end if;
  if p_amount > po.outstanding + ops_core.money_tolerance() then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'over_contract',
      format('Only %s is still outstanding on %s. Money beyond the contract is a question for the vendor, not a payment on this order.',
             po.outstanding, p_po_no),
      jsonb_build_object('field','amount','outstanding', po.outstanding));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  v_src := format('po:%s:%s:%s', p_po_no, coalesce(p_trx_date, ops_core.office_day()), p_amount);

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => format('Pembayaran %s', p_po_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => po.vendor_code,
    p_project_code => null,
    p_lines        => jsonb_build_array(jsonb_build_object(
                        'description', format('Pembayaran %s', p_po_no),
                        'qty', 1, 'uom', 'unit', 'unit_price', p_amount, 'amount', p_amount)),
    p_source_ref   => v_src,
    p_key          => null);
  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';
  select id into v_trx_id from ops_acct.transactions where trx_no = v_trx_no;

  -- The split: each linked line takes its share of the contract, rounded to
  -- the rupiah; whatever is left — unlinked lines and rounding — names the
  -- order alone, so the shares always add up to what left the bank.
  if po.contract_value > 0 then
    for x in
      select l.line_no_full, o.line_total
        from ops_procure.po_lines o
        join ops_procure.pr_lines l on l.id = o.pr_line_id
       where o.po_id = po.id and o.superseded_by is null
       order by o.line_no
    loop
      share := least(round(p_amount * x.line_total / po.contract_value), p_amount - spent);
      if share > 0 then
        insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
        values (v_trx_id, x.line_no_full, p_po_no, share, 'transfer', auth.uid());
        spent := spent + share;
        shares := shares || jsonb_build_object('pr_line_no', x.line_no_full, 'amount', share);
      end if;
    end loop;
  end if;
  if p_amount - spent > 0 then
    insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
    values (v_trx_id, null, p_po_no, p_amount - spent, 'transfer', auth.uid());
  end if;

  perform ops_core.emit('accounting','accounting.allocation.recorded', p_po_no,
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount, 'lines', shares));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_to_po',
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount,
                       'account', p_account_code, 'type', p_type_code, 'lines', shares));
  return ops_core.idem_remember('accounting','post_to_po:' || p_po_no, p_key, res);
end $$;

-- A new function is executable by PUBLIC, which `anon` inherits (0125).
revoke execute on function ops_acct.post_to_po(text, numeric, text, text, uuid, date, text, text) from public;
grant execute on function ops_acct.post_to_po(text, numeric, text, text, uuid, date, text, text) to authenticated;

comment on function ops_acct.post_to_po is
  'Pays an issued order from its own screen: one ledger row, split across the order''s linked '
  'request lines by value, the rest on the order alone. post_ledger, proof required, never above '
  'what is outstanding. (0129, B8)';
