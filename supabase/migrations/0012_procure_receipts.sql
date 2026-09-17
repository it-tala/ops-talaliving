-- 0012_procure_receipts.sql — what arrived, who took it, and who checked it.
--
-- Two acts, kept apart (D131). Goods from outside arrive when they arrive —
-- often at night, when the people with the app open are asleep. Whoever is there
-- can say *it came*, with a photograph. The signed tanda terima follows in the
-- morning, from procurement, who are accountable for it.
--
-- **Only a CONFIRMED receipt counts as value received.** That is the whole point
-- of the split: an arrival nobody has acknowledged in writing is a fact worth
-- recording and not yet a thing we owe for. A reported quantity is shown on
-- every screen that shows the line, and counted by none of them.
--
-- And two people, or the same one named twice (D101): a delivery accepted and
-- checked by nobody in particular is the one nobody can ask about later.

create table ops_procure.receipts (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   text not null unique,

  -- Exactly one of these two. Goods arrive against a request line or against a
  -- purchase order line, and a receipt that claimed both would be counted twice
  -- — once on the line's ladder and once on the order's delivery axis.
  line_id      uuid references ops_procure.pr_lines(id) on delete restrict,
  po_line_id   uuid references ops_procure.po_lines(id) on delete restrict,

  qty_received numeric not null check (qty_received > 0),
  condition    ops_procure.receipt_condition_t not null default 'GOOD',

  received_by  uuid not null references ops_core.users(id),
  received_at  timestamptz not null default now(),
  -- Null while the receipt is only REPORTED: at 11pm the person unloading the
  -- van is not the person who checks it against the order.
  qc_by        uuid references ops_core.users(id),
  note         text,

  status       ops_procure.receipt_status_t not null default 'REPORTED',
  confirmed_by uuid references ops_core.users(id),
  confirmed_at timestamptz,

  constraint one_parent check (
    (line_id is not null and po_line_id is null) or
    (line_id is null and po_line_id is not null)),
  constraint confirmed_together check ((confirmed_at is null) = (confirmed_by is null)),
  -- The constraint that makes the split real. A row cannot say CONFIRMED without
  -- naming who confirmed it — which means "value received" can never be a number
  -- with nobody's name behind it.
  constraint confirmed_is_signed check (
    (status = 'CONFIRMED') = (confirmed_at is not null))
);

create index receipts_line_idx    on ops_procure.receipts (line_id)    where line_id is not null;
create index receipts_po_line_idx on ops_procure.receipts (po_line_id) where po_line_id is not null;
-- The morning list: arrived, nobody has signed for it yet.
create index receipts_reported_idx on ops_procure.receipts (received_at desc)
  where status = 'REPORTED';

alter table ops_procure.receipts enable row level security;

create policy receipts_read on ops_procure.receipts
  for select to authenticated using (ops_core.has_permission('procurement.read'));

-- Reporting an arrival is deliberately the low bar: `inventory.create` or
-- `procurement.create`, because the person at the gate at 11pm is often
-- warehouse rather than procurement, and a system that refuses them is a system
-- where the delivery goes unrecorded until somebody remembers it.
create policy receipts_report on ops_procure.receipts
  for insert to authenticated
  with check (ops_core.has_permission('procurement.create')
              or ops_core.has_permission('inventory.create'));

-- Confirming is the accountable act, and it is `procurement.update` — the people
-- who hold the order and can check what arrived against what was asked for.
create policy receipts_confirm on ops_procure.receipts
  for update to authenticated
  using (ops_core.has_permission('procurement.update'))
  with check (ops_core.has_permission('procurement.update'));

grant select on ops_procure.receipts to authenticated;
grant insert on ops_procure.receipts to authenticated;
-- Only the confirmation half is updatable. What arrived, how much of it, and in
-- what condition are statements made at the gate; correcting one is a new
-- receipt, so that both readings stay on the record (A2, A5).
grant update (status, qc_by, confirmed_by, confirmed_at, note) on ops_procure.receipts
  to authenticated;
