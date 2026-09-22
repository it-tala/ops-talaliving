-- 0066_prod_purchase_request.sql — the button D238 confirmed and nothing has
-- built: *buat permintaan pembelian* from a work order's bill of material.
--
-- ## What the button is actually for (D151)
--
-- Not convenience. The owner asked for it so that *proyeksi vs aktual* has an
-- answer at the end of a job: the BOM says what a run **should** need, the
-- request raised from it is what somebody actually **went out to buy**, and
-- both are sums over the same rows. Without the link the two numbers exist and
-- cannot be reconciled — plywood requested in August is not obviously this
-- table's plywood, and matching them by item code afterwards is guesswork the
-- moment two orders run at once.
--
-- The link is one column procurement already carries: `pr_lines.source_wo_no`.
-- This migration is what finally writes to it.
--
-- ## Two rules the seam exists to keep
--
--   **A draft, never submitted.** A bill of material is a *requirement*, not a
--   decision to spend money. The list still has to be read, priced and asked
--   for by a person (D151). `create_pr` leaves it in `DRAFT` and this seam does
--   not call `submit_pr`.
--
--   **There is one road to a purchase request, and it is `create_pr`.** This
--   function assembles the lines and hands them over; it does not insert into
--   `pr_documents` itself. So the authority is procurement's, unchanged — a
--   foreman who is to raise his own requests is **granted `procurement.create`**,
--   which is a grant somebody can see, rather than served by a second door in
--   another schema that nobody would think to audit.
--
-- ## Why the comparison stays narrow
--
-- Materials against materials, with labour in neither (D151). The ledger's
-- project total includes installation, delivery and subcontract, so subtracting
-- it from a materials projection produces a number that looks like an overrun
-- and is a category error. `v_project_cost` shows it, separately, saying what
-- it is.

-- ── what one order needs ──────────────────────────────────────────────────
-- The order's own requirement list: its product, its quantity, and the
-- revision it was **pinned** to — never today's. That pin is the whole of D256
-- and reading it at `start_rev` here would quietly cost a June order against
-- a list somebody is editing in September.
create or replace function ops_prod.wo_requirements(p_wo_no text)
returns setof ops_prod.bom_exploded_line
language sql stable set search_path = ops_prod, pg_temp as $$
  select e.*
    from ops_prod.work_orders w
    cross join lateral ops_prod.explode_bom(w.product_code, w.qty, w.bom_rev) e
   where w.wo_no = p_wo_no
     and w.product_code is not null
     and w.bom_rev is not null
$$;

-- ── the button ────────────────────────────────────────────────────────────
--
-- `security definer` for the reason every other seam is (D84): the emit and the
-- idempotency record are not the caller's to write. It is **not** how the
-- authority is decided — `has_permission` reads `auth.uid()`, which a definer
-- context does not change, and the check is made here before anything is read
-- as well as again inside `create_pr`.
create or replace function ops_prod.request_materials(
  p_wo_no text, p_need_by date default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  v_wo        ops_prod.work_orders;
  v_replayed  jsonb;
  v_lines     jsonb;
  v_loops     text[];
  v_unbroken  int;
  v_prior     int;
  v_answer    jsonb;
  v_res       jsonb;
begin
  v_replayed := ops_core.idem_replay('production','request_materials', p_key);
  if v_replayed is not null then return v_replayed; end if;

  -- Asked before a single row is read, so a refusal never travels with
  -- somebody else's prices behind it.
  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('production','work_order', p_wo_no,'request_materials',
      'not_permitted',
      'Raising a request needs procurement access — the workshop names what it '
      'needs, procurement asks for the money.');
  end if;

  select * into v_wo from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','work_order', p_wo_no,'request_materials',
      format('No work order %s.', p_wo_no));
  end if;

  if v_wo.status = 'CANCELLED' then
    return ops_core.invalid('production','work_order', p_wo_no,'request_materials',
      'order_cancelled','This order was cancelled; nothing needs buying for it.',
      jsonb_build_object('reason', v_wo.cancelled_reason));
  end if;

  -- An order typed in by hand — a one-off with a name and no catalogue entry —
  -- is an ordinary thing (`product_code` is nullable on purpose). It simply has
  -- no list to raise, and saying so is better than an empty request.
  if v_wo.product_code is null or v_wo.bom_rev is null then
    return ops_core.invalid('production','work_order', p_wo_no,'request_materials',
      'no_bom','This order is not pinned to a bill of material, so there is no '
               'list to raise. Pin a released revision first.',
      jsonb_build_object('product_code', v_wo.product_code, 'bom_rev', v_wo.bom_rev));
  end if;

  -- **A looped tree is refused rather than requested from.** The walk itself
  -- terminates and the quantities it did reach are right, but a BOM that holds
  -- itself is a data error somebody has to fix, and a purchase request raised
  -- from it is the silent kind of wrong — it looks exactly like a correct one
  -- (D257).
  select array_agg(distinct e.ref_code) into v_loops
    from ops_prod.wo_requirements(p_wo_no) e where e.cycle;
  if v_loops is not null then
    return ops_core.invalid('production','work_order', p_wo_no,'request_materials',
      'bom_has_a_cycle',
      format('The bill of material holds itself at %s. Fix the loop before '
             'raising a request from it.', array_to_string(v_loops, ', ')),
      jsonb_build_object('codes', to_jsonb(v_loops)));
  end if;

  -- A sub-assembly nobody has released a BOM for goes on the list **as
  -- itself**, because it has to be obtained somehow and dropping it is how a
  -- run arrives short (D257). It is marked in the line so the person pricing
  -- the request can see it is not an ordinary material.
  select
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'item_id',      i.id,
      'description',  coalesce(e.ref_name, e.ref_code)
                      || case when e.unexploded then ' — sub-assembly, no released BOM' else '' end,
      'qty',          e.qty,
      'uom',          e.uom,
      'unit_price',   e.unit_price,
      -- Deliberately no `category`. The BOM does not hold one and a default
      -- would be a guess written into a document somebody signs (D150).
      'purpose',      format('SPK %s — %s', v_wo.wo_no, v_wo.item_name),
      -- Only what the caller said. The order's due date is when the piece is
      -- promised, not when its plywood has to be here, and nothing in this
      -- system knows the difference in days.
      'need_by',      p_need_by,
      'source_wo_no', v_wo.wo_no)) order by e.depth, e.ref_code),
    count(*) filter (where e.unexploded)
  into v_lines, v_unbroken
  from ops_prod.wo_requirements(p_wo_no) e
  left join ops_procure.items i on i.code = e.ref_code and e.kind = 'material';

  if v_lines is null then
    return ops_core.invalid('production','work_order', p_wo_no,'request_materials',
      'nothing_to_buy',
      format('Revision %s of %s has no components.', v_wo.bom_rev, v_wo.product_code));
  end if;

  -- Asking twice is **warned about, not refused** (A6). A run that grew, or a
  -- first request half cancelled, are both ordinary; what is not ordinary is
  -- the accidental double, and the way to see it is the count here beside
  -- `asked` against `projected_cost` in `v_wo_materials`.
  select count(distinct l.doc_no) into v_prior
    from ops_procure.pr_lines l
   where l.source_wo_no = v_wo.wo_no and l.removed_at is null;

  v_answer := ops_procure.create_pr(v_lines, v_wo.project_code, 'PR', p_key);
  if not ops_core.said_ok(v_answer) then return v_answer; end if;

  perform ops_core.emit('production','production.materials.requested', v_wo.wo_no,
    jsonb_build_object('wo_no', v_wo.wo_no,
                       'doc_no', v_answer -> 'data' ->> 'doc_no',
                       'lines', (v_answer -> 'data' ->> 'lines')::int));

  v_res := ops_core.ok('production','work_order', v_wo.wo_no,'request_materials',
    jsonb_build_object(
      'wo_no',           v_wo.wo_no,
      'doc_no',          v_answer -> 'data' ->> 'doc_no',
      'status',          'DRAFT',
      'lines',           (v_answer -> 'data' ->> 'lines')::int,
      -- Both counts travel with the answer, because a caller who only reads
      -- `doc_no` should still have been told.
      'unexploded',      v_unbroken,
      'prior_requests',  v_prior));
  return ops_core.idem_remember('production','request_materials', p_key, v_res);
end $$;

-- ── projection against actual, per order ──────────────────────────────────
--
-- The two halves of D151 in one row. `projected_*` is the walk; `asked`,
-- `approved` and `paid` are the request lines that carry this order's number.
--
-- **Nulls where a reader is not allowed to look, never zeroes.** `pr_lines` is
-- `procurement.read` and a workshop user does not hold it, so the sums come
-- back empty and `requests = 0` would read as *nobody has asked yet* — which is
-- the plausible-null failure this project keeps finding (F104, F112). The
-- figures are withheld explicitly instead, and `procurement_visible` says so.
create or replace view ops_prod.v_wo_materials as
select
  w.wo_no,
  w.product_code,
  w.project_code,
  w.qty,
  w.bom_rev,
  w.status,
  x.lines                            as projected_lines,
  x.unpriced                         as projected_unpriced,
  x.unexploded                       as projected_unexploded,
  coalesce(x.has_cycle, false)       as projected_has_cycle,
  -- Null while anything in the list is unpriced — `explode_summary`'s rule, and
  -- the same one `v_product_cost` follows. A projection that omits two lines is
  -- the number somebody compares against.
  x.material_cost                    as projected_cost,
  ops_core.has_permission('procurement.read') as procurement_visible,
  case when ops_core.has_permission('procurement.read') then coalesce(r.requests, 0)      end as requests,
  case when ops_core.has_permission('procurement.read') then coalesce(r.request_lines, 0) end as request_lines,
  case when ops_core.has_permission('procurement.read') then coalesce(r.asked, 0)         end as asked,
  case when ops_core.has_permission('procurement.read') then coalesce(r.approved, 0)      end as approved,
  case when ops_core.has_permission('procurement.read') then coalesce(r.paid, 0)          end as paid,
  -- `pr_lines.item_total` is `not null`, so a line raised from an unpriced
  -- component lands as nought and `asked` quietly under-reports until somebody
  -- prices it. The count is how you know by how much.
  case when ops_core.has_permission('procurement.read') then coalesce(r.asked_unpriced, 0) end as asked_unpriced
from ops_prod.work_orders w
left join lateral ops_prod.explode_summary(w.product_code, w.qty, w.bom_rev) x on true
left join lateral (
  select count(distinct l.doc_no)::int            as requests,
         count(*)::int                            as request_lines,
         sum(l.item_total)                        as asked,
         -- **Not** `v_line_coverage.approved`, which is the amount still to be
         -- covered and falls back to what was *asked* when nobody has approved
         -- anything. Reading it here made a draft request report itself fully
         -- approved — the right-looking number from the wrong column (F113).
         sum(case when ap.approved
                  then coalesce(ap.approved_amount, l.item_total) else 0 end) as approved,
         sum(coalesce(cov.covered, 0))            as paid,
         count(*) filter (where l.item_total = 0)::int as asked_unpriced
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    left join ops_procure.v_line_coverage cov on cov.line_id = l.id
    left join ops_procure.v_line_approval ap
      on ap.line_id = l.id and ap.step = 'GOODS'
   where l.source_wo_no = w.wo_no
     and l.removed_at is null
     and d.status <> 'CANCELLED'
) r on true;

-- ── projection against actual, per project ────────────────────────────────
--
-- The same three sums rolled up over a project's orders, plus the ledger's
-- whole project spend **beside** them and never subtracted from them. That
-- separation is the decision: the ledger figure contains installation,
-- delivery and subcontract, and the projection contains none of those, so the
-- difference between them is not an overrun — it is two different questions
-- (D151).
create or replace view ops_prod.v_project_cost as
select
  p.code                                as project_code,
  p.name                                as project_name,
  count(m.wo_no)::int                   as work_orders,
  count(*) filter (where m.projected_cost is null)::int as orders_without_a_projection,
  -- Null the moment one order's projection is, for the same reason a line is:
  -- a project total that silently omits an order is the number somebody quotes.
  case when count(*) filter (where m.projected_cost is null) > 0 then null
       else sum(m.projected_cost)::bigint end          as projected_cost,
  max(m.procurement_visible::int)::boolean             as procurement_visible,
  sum(m.asked)::bigint                                 as asked,
  sum(m.approved)::bigint                              as approved,
  sum(m.paid)::bigint                                  as paid,
  -- Everything the ledger has ever paid out against this project, of every
  -- kind. `accounting.read` and nobody else — withheld, not zeroed.
  ops_core.has_permission('accounting.read')           as ledger_visible,
  case when ops_core.has_permission('accounting.read') then coalesce((
    select sum(t.amount_idr)
      from ops_acct.transactions t
     where t.project_id = p.id
       and t.direction = 'OUT'
       and t.status <> 'VOID'), 0)::bigint end         as ledger_spend
from ops_procure.projects p
join ops_prod.work_orders w      on w.project_code = p.code
join ops_prod.v_wo_materials m   on m.wo_no = w.wo_no
where w.status <> 'CANCELLED'
group by p.id, p.code, p.name;

alter view ops_prod.v_wo_materials set (security_invoker = on);
alter view ops_prod.v_project_cost set (security_invoker = on);

grant select on ops_prod.v_wo_materials, ops_prod.v_project_cost to authenticated;
grant execute on function ops_prod.wo_requirements(text),
                          ops_prod.request_materials(text, date, text)
  to authenticated;
