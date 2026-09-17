-- 0011_procure_po.sql — the order as an obligation.
--
-- A purchase order is a promise to a supplier **in the company's name**, and
-- everything in this file follows from taking that literally:
--
--   * it is confirmed before it is sent, not after (D132);
--   * once issued it only moves by **supersession**, because the vendor is
--     holding a piece of paper and two pieces of paper have to be tellable
--     apart (D135);
--   * what was paid and what arrived are computed apart and **stay apart** —
--     an order can be fully paid and empty, or full and unpaid, and one
--     progress bar says neither (A1).
--
-- That last one is why `po_status_t` lost its `PARTIAL`: delivery is an axis,
-- not a lifecycle stage, and it is derived in `v_po_status` (0014).

create table ops_procure.purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  po_no             text not null unique,     -- `po-26-09-11_01`
  vendor_id         uuid not null references ops_procure.vendors(id),
  status            ops_procure.po_status_t not null default 'DRAFT',
  created_at        timestamptz not null default now(),
  created_by        uuid not null references ops_core.users(id),
  issued_at         timestamptz,
  issued_by         uuid references ops_core.users(id),
  note              text,

  -- When the vendor said it would arrive. The date we agreed, not a rule that
  -- derives one — and the only thing that makes a delivery *late* rather than
  -- merely absent (D134).
  expected_delivery date,

  -- Leadership's yes on the order itself. `asked_at` is when the question went
  -- out; the decision is the pair below it.
  approval_asked_at timestamptz,
  approval_asked_by uuid references ops_core.users(id),
  approved_at       timestamptz,
  approved_by       uuid references ops_core.users(id),
  approval_note     text,

  -- Bumped every time an issued order is amended. The vendor holds a piece of
  -- paper; this is what lets two of them be told apart (D135).
  revision          int not null default 1 check (revision >= 1),
  -- The revision the vendor has actually been sent. Behind `revision` means the
  -- paper in their hand is out of date, and that is a thing somebody has to
  -- act on rather than a number to look at.
  sent_revision     int not null default 0 check (sent_revision >= 0),

  constraint issued_together   check ((issued_at is null) = (issued_by is null)),
  constraint approved_together check ((approved_at is null) = (approved_by is null)),
  -- An order is confirmed before it is sent (D132). Not a warning: this is the
  -- one place in procurement where warn-don't-block does not apply, because the
  -- thing at stake is a commitment to somebody outside the company (A6).
  constraint issued_was_approved check (issued_at is null or approved_at is not null),
  constraint sent_not_ahead check (sent_revision <= revision)
);

create index po_vendor_idx on ops_procure.purchase_orders (vendor_id, created_at desc);
-- Late orders, cheaply: issued, not closed, and past the date we agreed.
create index po_expected_idx on ops_procure.purchase_orders (expected_delivery)
  where status = 'ISSUED';

create table ops_procure.po_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references ops_procure.purchase_orders(id) on delete restrict,
  line_no       int not null check (line_no > 0),
  item_id       uuid references ops_procure.items(id),
  description   text not null,
  qty           numeric not null check (qty > 0),
  uom           text not null references ops_procure.uom(code),
  unit_price    numeric not null check (unit_price >= 0),
  -- Stored, not generated: an order line is what was agreed, and if a rounding
  -- convention ever changes, every historical order must still say what the
  -- vendor was told. The seam computes it; the column remembers it.
  line_total    numeric not null check (line_total >= 0),
  -- An amendment after issue is a **new row** pointing back at the old one
  -- (D129, D135). The old row stays readable, which is what makes "who changed
  -- the quantity after we agreed it" answerable at all.
  --
  -- **Deferrable**, and that is not a loosening. A supersession has to retire
  -- the old row and create the new one in one step, or the two of them are both
  -- live for an instant and both claim the vendor's line number — which the
  -- partial unique index below correctly refuses. Deferring the reference lets
  -- `amend_po_line()` stamp the old row with the new row's id *before* that row
  -- exists, and the check still runs before the transaction commits: a dangling
  -- pointer is impossible, it is merely allowed to be momentary.
  superseded_by uuid references ops_procure.po_lines(id) deferrable initially deferred,
  created_at    timestamptz not null default now(),
  constraint supersede_not_self check (superseded_by is null or superseded_by <> id)
);

-- Live lines only. A superseded line keeps its `line_no` — that is the number
-- the vendor's copy carries, and the amendment addresses it — so the constraint
-- has to allow the repeat while forbidding two *live* lines from claiming it.
create unique index po_lines_live_no_idx on ops_procure.po_lines (po_id, line_no)
  where superseded_by is null;
create index po_lines_po_idx on ops_procure.po_lines (po_id);

-- A term is **a trigger plus a share**, not a bill: 30% on issue, the rest on
-- delivery. Coverage runs oldest term first, because that is how the terms were
-- meant to run and because nothing in a bank transfer says which term it was
-- for. What falls out of that is the guard in `v_po_terms`: a term whose trigger
-- has fired while an earlier one is unpaid is BLOCKED, and the view names the
-- term holding it up (D128).
create table ops_procure.po_schedule (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references ops_procure.purchase_orders(id) on delete restrict,
  -- `po-26-09-11_01-M01`. The number carries the order, which is what the view
  -- sorts on — a term sequence that depended on insertion order would reshuffle
  -- a payment schedule when somebody added a missing term.
  term_no     text not null unique,
  kind        ops_procure.po_payment_kind_t not null,
  basis       ops_procure.schedule_basis_t not null,
  basis_value numeric not null check (basis_value >= 0),
  due_rule    ops_procure.due_rule_t not null,
  due_date    date,
  -- `date` is the only rule that needs one, and it needs one: a term due on a
  -- date nobody set can never fire, which reads on screen as "not due" for ever.
  constraint date_rule_has_date check ((due_rule = 'date') = (due_date is not null)),
  -- A percentage above 100 is a typo every time, and the one that produces an
  -- order billed at eleven times its value.
  constraint percent_in_range check (
    basis <> 'percent' or (basis_value > 0 and basis_value <= 100))
);

create index po_schedule_po_idx on ops_procure.po_schedule (po_id, term_no);

alter table ops_procure.purchase_orders enable row level security;
alter table ops_procure.po_lines        enable row level security;
alter table ops_procure.po_schedule     enable row level security;

create policy po_read on ops_procure.purchase_orders
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy po_lines_read on ops_procure.po_lines
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy po_sched_read on ops_procure.po_schedule
  for select to authenticated using (ops_core.has_permission('procurement.read'));

create policy po_new on ops_procure.purchase_orders
  for insert to authenticated with check (ops_core.has_permission('procurement.create'));
-- Editing a DRAFT order, setting an expected date, marking it resent: ordinary
-- procurement work. **Approving it is not**, and the policy cannot tell the two
-- apart from here — a column-level grant can, so `approved_at` and `approved_by`
-- are withheld from the update grant below and written only by the seam, which
-- checks `approve_goods`.
create policy po_edit on ops_procure.purchase_orders
  for update to authenticated
  using (ops_core.has_permission('procurement.update'))
  with check (ops_core.has_permission('procurement.update'));

create policy po_lines_new on ops_procure.po_lines
  for insert to authenticated with check (ops_core.has_permission('procurement.create'));
create policy po_lines_amend on ops_procure.po_lines
  for update to authenticated
  using (ops_core.has_permission('procurement.update'))
  with check (ops_core.has_permission('procurement.update'));
create policy po_sched_new on ops_procure.po_schedule
  for insert to authenticated with check (ops_core.has_permission('procurement.create'));

grant select on ops_procure.purchase_orders, ops_procure.po_lines, ops_procure.po_schedule
  to authenticated;
grant insert on ops_procure.purchase_orders, ops_procure.po_lines, ops_procure.po_schedule
  to authenticated;

-- Column-scoped on purpose. Everything a person may change about an issued
-- order is here, and the four columns that are **not** — `approved_at`,
-- `approved_by`, `approval_note`, `po_no` — are the order's confirmation and its
-- identity. Those move only through `ops_procure.approve_po()` and
-- `ops_procure.issue_po()`, which check the authority and write the trail.
grant update (status, note, expected_delivery, revision, sent_revision,
              approval_asked_at, approval_asked_by, issued_at, issued_by)
  on ops_procure.purchase_orders to authenticated;
grant update (superseded_by) on ops_procure.po_lines to authenticated;
