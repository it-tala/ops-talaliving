-- 0010_procure_rounds.sql — a payment round: the batch of approved lines that
-- leadership funds, and the instalments that fund it.
--
-- One rule shapes this whole file, and it is the one `john-lau` got wrong most
-- expensively: **TRANSFERRED is not PAID** (D6, A10). Money arriving in the
-- paying account is money arriving in the paying account. It does not pay a
-- vendor, it does not settle a line, and it is not even reserved for the lines
-- in this round — cash is fungible, so money moved in for last week's approvals
-- is spent on whatever gets paid first (D126).
--
-- So the round's status ladder says what happened to the ROUND, and what
-- happened to a LINE is computed from the allocations against it, in
-- `v_pr_line_status`. Two different questions; the old system had one column
-- for both and it was wrong for one of them at all times.

create table ops_procure.payment_rounds (
  id          uuid primary key default gen_random_uuid(),
  round_no    text not null unique,        -- `fund-26-09-11_01`
  status      ops_procure.round_status_t not null default 'OPEN',
  opened_at   timestamptz not null default now(),
  opened_by   uuid not null references ops_core.users(id),
  approved_by uuid references ops_core.users(id),
  approved_at timestamptz,
  closed_by   uuid references ops_core.users(id),
  closed_at   timestamptz,
  /* What was transferred does not live here: a round is funded in as many
     instalments as it takes, so the record is the list of them (D82). A column
     would have to be a running total maintained by whoever remembered to. */
  constraint approved_together check ((approved_at is null) = (approved_by is null)),
  constraint closed_together   check ((closed_at is null) = (closed_by is null))
);

create table ops_procure.payment_round_lines (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references ops_procure.payment_rounds(id) on delete restrict,
  line_id          uuid not null references ops_procure.pr_lines(id) on delete restrict,
  -- Frozen when the round is approved: the record of a decision. While the round
  -- is OPEN this is recomputed from what is still owed, which is why the view
  -- and not this column is what an open round reports.
  requested_amount numeric not null default 0 check (requested_amount >= 0),
  added_at         timestamptz not null default now(),
  -- A line belongs to one round at a time. Two rounds each expecting to fund the
  -- same line is how a line gets paid twice, and it is the kind of double
  -- payment nobody finds until the vendor mentions it.
  unique (round_id, line_id)
);

create unique index round_lines_one_round_idx on ops_procure.payment_round_lines (line_id);
create index round_lines_round_idx on ops_procure.payment_round_lines (round_id);

-- One transfer into the paying account against one round.
--
-- A round is funded in parts more often than not — leadership sends half on
-- Monday and the rest when a client pays — so the record is a list, not a single
-- amount. Each instalment carries **its own proof**, because each is its own
-- claim about the bank (D80, D82). A funded round with no proof is somebody's
-- word for it.
create table ops_procure.round_transfers (
  id                  uuid primary key default gen_random_uuid(),
  round_id            uuid not null references ops_procure.payment_rounds(id) on delete restrict,
  amount              numeric not null check (amount > 0),
  -- The ledger row the money arrived on, by public code (ADR-004). Validated at
  -- the seam against `ops_acct.transactions`, never joined across the service.
  trx_no              text not null,
  -- Not nullable. The whole point of the table.
  proof_attachment_id uuid not null references ops_core.attachments(id),
  recorded_by         uuid not null references ops_core.users(id),
  recorded_by_email   ops_core.citext not null,
  recorded_at         timestamptz not null default now(),
  -- The same ledger row cannot fund the same round twice. A repeat is a mistake
  -- or a double-tap, and either way it inflates the round's funding by an amount
  -- the bank never sent.
  unique (round_id, trx_no)
);

create index round_transfers_round_idx on ops_procure.round_transfers (round_id, recorded_at);

-- A human decision that a line is finished even though the money that reached it
-- is short of what was approved.
--
-- The reason is **mandatory**, and that is the design: a silent tolerance is how
-- a thousand small shortfalls become a number nobody can explain (A12). A named
-- person said this one was close enough, on a date, for a reason somebody can
-- read back to them.
create table ops_procure.line_settlements (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references ops_procure.pr_lines(id) on delete restrict,
  shortfall  numeric not null,
  reason     text not null check (length(btrim(reason)) > 0),
  decided_by uuid not null references ops_core.users(id),
  decided_at timestamptz not null default now(),
  -- Settled once. A second settlement on a line is either a duplicate or a
  -- second opinion, and neither should overwrite the first quietly.
  unique (line_id)
);

alter table ops_procure.payment_rounds      enable row level security;
alter table ops_procure.payment_round_lines enable row level security;
alter table ops_procure.round_transfers     enable row level security;
alter table ops_procure.line_settlements    enable row level security;

create policy rounds_read on ops_procure.payment_rounds
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy round_lines_read on ops_procure.payment_round_lines
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy transfers_read on ops_procure.round_transfers
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy settlements_read on ops_procure.line_settlements
  for select to authenticated using (ops_core.has_permission('procurement.read'));

-- Opening a round and putting lines in it is procurement's ordinary work:
-- somebody gathers what is owed and asks. Approving it, funding it and closing
-- it is `approve_funds`, and it is the same authority for all three because they
-- are the same decision seen at three moments — money leaving the company.
create policy rounds_new on ops_procure.payment_rounds
  for insert to authenticated with check (ops_core.has_permission('procurement.update'));
create policy rounds_decide on ops_procure.payment_rounds
  for update to authenticated
  using (ops_core.has_authority('approve_funds'))
  with check (ops_core.has_authority('approve_funds'));

create policy round_lines_write on ops_procure.payment_round_lines
  for insert to authenticated with check (ops_core.has_permission('procurement.update'));
create policy round_lines_freeze on ops_procure.payment_round_lines
  for update to authenticated
  using (ops_core.has_authority('approve_funds'))
  with check (ops_core.has_authority('approve_funds'));

create policy transfers_new on ops_procure.round_transfers
  for insert to authenticated with check (ops_core.has_authority('approve_funds'));

-- Settling short is a money decision, and the one on this page most worth
-- guarding: it is the act of writing off a difference. `approve_funds`.
create policy settlements_new on ops_procure.line_settlements
  for insert to authenticated with check (ops_core.has_authority('approve_funds'));

grant select on ops_procure.payment_rounds, ops_procure.payment_round_lines,
                ops_procure.round_transfers, ops_procure.line_settlements to authenticated;
grant insert on ops_procure.payment_rounds, ops_procure.payment_round_lines,
                ops_procure.round_transfers, ops_procure.line_settlements to authenticated;
grant update on ops_procure.payment_rounds, ops_procure.payment_round_lines to authenticated;
