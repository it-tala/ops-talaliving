-- 0019_acct_review.sql — the exception road, and the bank's own record.
--
-- Two tables that look unrelated and are the same idea: **evidence arriving
-- before the row it belongs to.**
--
-- `evidence_inbox` is the exception road (ADR-010, D94). Everything with a
-- known parent is attached from the record — somebody opens the PR line or the
-- ledger row and files it there. This is for the rest: a photo sent to chat at
-- nine at night with no context. Five roads out, **none of which delete**, and
-- the count is watched, because if it grows people are routing around the
-- normal road and the reason is worth finding.
--
-- `bank_statements` is the opposite case and the reason M31 exists. For the two
-- leadership accounts a statement is not a check on rows somebody typed — it is
-- **the only way their rows exist at all** (D180). Nobody enters those
-- transactions; the statement is the source.

create table ops_acct.evidence_inbox (
  id             uuid primary key default gen_random_uuid(),
  ref_id         text not null unique,
  origin         ops_acct.inbox_origin_t not null,
  status         ops_acct.inbox_status_t not null default 'PENDING',
  attachment_id  uuid not null references ops_core.attachments(id),
  reported_by    uuid references ops_core.users(id),
  reported_at    timestamptz not null default now(),

  -- The AI's reading. **A proposal, never a posting.** Every field is nullable
  -- because "could not read it" is a real answer and a more useful one than a
  -- guess — low confidence leaves the field empty and asks, rather than filling
  -- it in hopefully.
  extracted      jsonb not null default '{}'::jsonb,

  -- Which way the money went, when the document itself says. Almost everything
  -- here is money going OUT — somebody bought first. A transfer proof from
  -- leadership is the other direction, and the two are resolved by different
  -- people for different reasons (D81).
  money_direction ops_acct.direction_t,

  produced_trx_no     text,
  produced_pr_line_no text,
  resolved_by    uuid references ops_core.users(id),
  resolved_at    timestamptz,
  resolve_note   text,

  constraint resolved_together check ((resolved_at is null) = (resolved_by is null)),
  -- A row that left PENDING did so because somebody acted. An unresolved row
  -- with a status is a row nobody can ask about.
  constraint decided_is_signed check (
    (status = 'PENDING') = (resolved_at is null))
);

create index inbox_pending_idx on ops_acct.evidence_inbox (reported_at desc)
  where status = 'PENDING';
create index inbox_recent_idx  on ops_acct.evidence_inbox (reported_at desc);

-- ── the bank's own record ─────────────────────────────────────────────────
create table ops_acct.bank_statements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references ops_acct.accounts(id),
  period_start  date not null,
  period_end    date not null,
  opening_balance numeric not null,
  closing_balance numeric not null,
  currency      text not null default 'IDR',
  filename      text not null,
  status        ops_acct.statement_status_t not null default 'PENDING',
  attachment_id uuid references ops_core.attachments(id),
  note          text,
  uploaded_by   uuid not null references ops_core.users(id),
  uploaded_at   timestamptz not null default now(),
  constraint period_forward check (period_end >= period_start)
);

create index statements_account_idx on ops_acct.bank_statements (account_id, period_start desc);

create table ops_acct.statement_lines (
  id            uuid primary key default gen_random_uuid(),
  statement_id  uuid not null references ops_acct.bank_statements(id) on delete restrict,
  line_no       int not null check (line_no > 0),
  value_date    date not null,
  direction     ops_acct.direction_t not null,
  -- In the statement's own currency. For an IDR statement this and
  -- `amount_idr` are the same number.
  amount        numeric not null check (amount > 0),
  -- **Null until somebody says at what rate.** A dollar line booked at a
  -- guessed rate is a wrong number in the ledger and a right-looking one on the
  -- screen (D181), so the column cannot be filled by inference.
  amount_idr    numeric,
  fx_rate       numeric check (fx_rate is null or fx_rate > 0),
  raw_description text not null,
  -- The running balance the bank printed, carried verbatim. Ours is computed;
  -- keeping theirs beside it is the only real check this system has.
  balance_after numeric,

  status        text not null default 'unmatched'
                check (status in ('unmatched','matched','booked','ignored')),
  -- The ledger row this line is, whether it was found or created. By public
  -- code, like every other cross-reference.
  trx_no        text,
  note          text,
  decided_by    uuid references ops_core.users(id),
  decided_at    timestamptz,

  unique (statement_id, line_no),
  constraint decided_together check ((decided_at is null) = (decided_by is null)),
  -- Deliberately left out means somebody said why. A line dropped with no
  -- reason is indistinguishable from one nobody got to.
  constraint ignored_has_reason check (
    status <> 'ignored' or coalesce(btrim(note), '') <> ''),
  -- Matched or booked means it names the row. Without this, "booked" is a
  -- claim with nothing behind it.
  constraint booked_names_row check (
    status not in ('matched','booked') or trx_no is not null),
  -- A rate only means something against a foreign amount, and a converted
  -- figure without the rate that produced it cannot be checked.
  constraint rate_with_conversion check (
    (fx_rate is null) or (amount_idr is not null))
);

create index statement_lines_stmt_idx on ops_acct.statement_lines (statement_id, line_no);
create index statement_lines_open_idx on ops_acct.statement_lines (statement_id)
  where status = 'unmatched';

alter table ops_acct.evidence_inbox  enable row level security;
alter table ops_acct.bank_statements enable row level security;
alter table ops_acct.statement_lines enable row level security;

create policy inbox_read on ops_acct.evidence_inbox
  for select to authenticated using (ops_core.has_permission('accounting.read'));
create policy statements_read on ops_acct.bank_statements
  for select to authenticated using (ops_core.has_permission('accounting.read'));
create policy statement_lines_read on ops_acct.statement_lines
  for select to authenticated using (ops_core.has_permission('accounting.read'));

-- Anybody who can file a document can put one in the inbox: that is the whole
-- point of the exception road — it must be easier than not recording it.
create policy inbox_new on ops_acct.evidence_inbox
  for insert to authenticated with check (ops_core.has_permission('accounting.create'));
-- **Resolving is its own authority.** Deciding that a document belongs to a
-- ledger row, or to nothing, is a judgement about money (D94).
create policy inbox_resolve on ops_acct.evidence_inbox
  for update to authenticated
  using (ops_core.has_authority('resolve_inbox'))
  with check (ops_core.has_authority('resolve_inbox'));

create policy statements_write on ops_acct.bank_statements
  for insert to authenticated with check (ops_core.has_permission('accounting.create'));
create policy statements_edit on ops_acct.bank_statements
  for update to authenticated
  using (ops_core.has_permission('accounting.update'))
  with check (ops_core.has_permission('accounting.update'));
create policy statement_lines_write on ops_acct.statement_lines
  for insert to authenticated with check (ops_core.has_permission('accounting.create'));
create policy statement_lines_decide on ops_acct.statement_lines
  for update to authenticated
  using (ops_core.has_authority('post_ledger'))
  with check (ops_core.has_authority('post_ledger'));

grant select on ops_acct.evidence_inbox, ops_acct.bank_statements, ops_acct.statement_lines
  to authenticated;
grant insert on ops_acct.evidence_inbox, ops_acct.bank_statements, ops_acct.statement_lines
  to authenticated;
grant update (status, produced_trx_no, produced_pr_line_no,
              resolved_by, resolved_at, resolve_note)
  on ops_acct.evidence_inbox to authenticated;
grant update (status, note) on ops_acct.bank_statements to authenticated;
grant update (status, trx_no, note, amount_idr, fx_rate, decided_by, decided_at)
  on ops_acct.statement_lines to authenticated;
