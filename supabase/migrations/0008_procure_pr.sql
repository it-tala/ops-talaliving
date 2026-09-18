-- 0008_procure_pr.sql — the request chain: documents, lines, approvals, notes,
-- and the variance that is a row rather than a note.
--
-- The shape here follows one redefinition, and everything else falls out of it:
-- **the ITEM is what everyone tracks** (D48). A document is a submission batch —
-- these lines arrived together, on a day, from a person — and carries no
-- purpose of its own, because a request can hold items for three jobs from
-- three suppliers and a single "purpose" on the container would be a lie about
-- at least two of them.
--
-- A line then stays on the board until it is settled or no longer needed, so
-- "it comes back at the next leadership meeting" needs no machinery at all. The
-- old system moved unpaid lines into a fresh document to make them reappear;
-- that existed because the surface was a spreadsheet with one tab per
-- submission, and there is nothing here to carry forward.

create table ops_procure.pr_documents (
  id            uuid primary key default gen_random_uuid(),
  -- `pr-26-09-11_03`, minted by ops_core.next_doc_number(). What every other
  -- service quotes (ADR-004, ADR-005).
  doc_no        text not null unique,
  doc_type      ops_procure.pr_doc_type_t not null default 'PR',
  status        ops_procure.pr_doc_status_t not null default 'DRAFT',
  requested_by  uuid not null references ops_core.users(id),
  -- Nullable: the job is usually known, and a request that cannot name one is
  -- still a request (A6). Which job each item is for belongs to the item.
  project_id    uuid references ops_procure.projects(id),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  -- The document's own status is a lifecycle, not a roll-up of its lines: the
  -- lines have their own ladder, computed (A3). SUBMITTED means it left
  -- somebody's drafts, and that is a fact with a timestamp.
  constraint submitted_has_time check (
    (status = 'DRAFT') = (submitted_at is null) or status = 'CANCELLED'),
  -- The composite target that lets a line carry its document's number without
  -- being able to carry the wrong one. See `pr_lines.line_no_full`.
  unique (id, doc_no)
);

create index pr_documents_requester_idx on ops_procure.pr_documents (requested_by, created_at desc);

create table ops_procure.pr_lines (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null references ops_procure.pr_documents(id) on delete restrict,
  -- The document's number, copied. Not denormalisation for speed: it is what
  -- makes `line_no_full` below a **generated** column rather than a string a
  -- seam has to remember to build correctly. The composite foreign key means
  -- this copy cannot name a document it does not belong to, and `doc_no` is
  -- minted once and never edited, so it cannot go stale either.
  doc_no        text not null,
  line_no       int  not null check (line_no > 0),
  -- `pr-26-09-10_01-L03` — what URLs use, what other systems quote, and what a
  -- person reads out on the phone. Generated, so it is impossible for the code
  -- on the row to disagree with the row.
  line_no_full  text generated always as (doc_no || '-L' || lpad(line_no::text, 2, '0')) stored,

  item_id       uuid references ops_procure.items(id),
  description   text not null,
  -- All three nullable: a request is often a price before it is a quantity —
  -- "the deposit on the Ubud order" has no qty and no unit price, and refusing
  -- it would push that request off-system (A6, D30).
  qty           numeric check (qty is null or qty > 0),
  uom           text references ops_procure.uom(code),
  unit_price    numeric check (unit_price is null or unit_price >= 0),
  -- What was ASKED. Never zeroed to cancel a line (A5) — removal is the
  -- `removed_at` stamp below, and the amount stays readable so the trail still
  -- says what was once wanted.
  item_total    numeric not null check (item_total >= 0),

  vendor_id     uuid references ops_procure.vendors(id),
  po_line_id    uuid,          -- set by 0011; no FK yet, and the seam validates
  category      ops_procure.pr_category_t,
  -- What this item is FOR, in the requester's words. The single most useful
  -- field on the line for whoever has to approve it: "2 pail lem putih" is a
  -- cost; "2 pail lem putih — laminating meja HOTEL UBUD" is a decision.
  purpose       text,
  need_by       date,
  -- The work order whose bill of material produced this line (D151). With the
  -- SPK number here, projected and actual material cost are two sums over the
  -- same rows rather than two numbers nobody can reconcile. By code, across the
  -- seam (ADR-004).
  source_wo_no  text,

  -- Removal is soft and audited (D29), and the seam refuses it once money has
  -- reached the line.
  removed_at    timestamptz,
  removed_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now(),

  foreign key (doc_id, doc_no) references ops_procure.pr_documents(id, doc_no),
  unique (doc_id, line_no),
  constraint removed_has_who check ((removed_at is null) = (removed_by is null))
);

create unique index pr_lines_public_idx on ops_procure.pr_lines (line_no_full);
create index pr_lines_vendor_idx  on ops_procure.pr_lines (vendor_id);
create index pr_lines_item_idx    on ops_procure.pr_lines (item_id);
create index pr_lines_open_idx    on ops_procure.pr_lines (doc_id) where removed_at is null;

-- ── approving ─────────────────────────────────────────────────────────────
-- A checkbox, not a vocabulary (D28), and **append-only**: ticking, un-ticking
-- and re-ticking all leave rows behind, so "approved 14:02, un-approved 14:09"
-- stays legible. The current decision is the latest row, which is why this table
-- has no update policy and no unique constraint on the line.
create table ops_procure.pr_approvals (
  id                uuid primary key default gen_random_uuid(),
  line_id           uuid not null references ops_procure.pr_lines(id) on delete restrict,
  step              ops_procure.approval_step_t not null default 'GOODS',
  approved          boolean not null,
  approved_qty      numeric check (approved_qty is null or approved_qty >= 0),
  -- May be reduced below what was requested, never raised (A8). The seam
  -- enforces the ceiling; the column allows it so a correction upward of an
  -- earlier mistake is possible through the trail rather than impossible.
  approved_amount   numeric check (approved_amount is null or approved_amount >= 0),

  -- **Who answered, and through which door** (F16, D19). Two columns rather
  -- than one, and this is the part the old system got wrong in the way that
  -- mattered most: a leadership meeting runs on whoever's laptop is open, and if
  -- procurement ticks the box while the CEO says yes across the table, the
  -- record says procurement approved it. That is false in the one place the
  -- system is supposed to be trustworthy.
  --
  -- So the email is the authority and the uuid is a convenience. `recorded_by`
  -- is nullable because a chat answer's identity comes from Google's own
  -- authentication, and the person it names need not have an account here.
  recorded_by       uuid references ops_core.users(id),
  recorded_by_email ops_core.citext not null,
  recorded_at       timestamptz not null default now(),
  channel           ops_procure.channel_t not null default 'web'
);

create index pr_approvals_line_idx on ops_procure.pr_approvals (line_id, step, recorded_at desc);

-- ── leadership's own words ────────────────────────────────────────────────
-- Kept apart from the decision, because they are two different acts.
-- `instructions` is something the requester is expected to DO — "negotiate
-- first", "buy the smaller pack". `remark` is for the record — why the amount
-- was cut, what to watch next month.
--
-- Not columns on the approval row: a note can be left on a line nobody has
-- decided yet, which is exactly when "get another quote" is worth saying.
create table ops_procure.line_notes (
  id                uuid primary key default gen_random_uuid(),
  line_id           uuid not null references ops_procure.pr_lines(id) on delete restrict,
  instructions      text,
  remark            text,
  recorded_by       uuid references ops_core.users(id),
  recorded_by_email ops_core.citext not null,
  recorded_at       timestamptz not null default now(),
  constraint note_says_something check (
    coalesce(instructions, remark) is not null)
);

create index line_notes_line_idx on ops_procure.line_notes (line_id, recorded_at desc);

-- ── the variance ──────────────────────────────────────────────────────────
-- Money that moved is not money that was authorised, and the gap is a row with
-- a reason on it rather than a note somebody may or may not have written (F13,
-- D98).
--
-- The reason is a closed list, and that is the whole design. No application can
-- judge whether one Rp 200.000 gap was a typo or carelessness — but twelve
-- tagged `price_changed` against the same vendor is a supplier who quotes
-- badly, and six tagged `input_error` from the same person is a training
-- problem. The app cannot judge one event; it can count the kinds.
create table ops_procure.line_variances (
  id                uuid primary key default gen_random_uuid(),
  line_id           uuid not null references ops_procure.pr_lines(id) on delete restrict,
  reason            ops_procure.variance_reason_t not null,
  note              text,
  -- The gap at the moment it was explained, frozen. A later payment must not
  -- silently rewrite what was being explained.
  amount_at_time    numeric not null,
  recorded_by       uuid references ops_core.users(id),
  recorded_by_email ops_core.citext not null,
  recorded_at       timestamptz not null default now()
);

create index line_variances_line_idx on ops_procure.line_variances (line_id, recorded_at desc);

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_procure.pr_documents   enable row level security;
alter table ops_procure.pr_lines       enable row level security;
alter table ops_procure.pr_approvals   enable row level security;
alter table ops_procure.line_notes     enable row level security;
alter table ops_procure.line_variances enable row level security;

create policy pr_docs_read  on ops_procure.pr_documents
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy pr_lines_read on ops_procure.pr_lines
  for select to authenticated using (ops_core.has_permission('procurement.read'));
-- The approval trail is readable by anybody who can read the module. "Who said
-- yes to this" is the question the whole record exists to answer, and hiding it
-- behind a second permission makes every trail unreadable to the people who
-- need it most.
create policy pr_appr_read  on ops_procure.pr_approvals
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy notes_read    on ops_procure.line_notes
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy var_read      on ops_procure.line_variances
  for select to authenticated using (ops_core.has_permission('procurement.read'));

create policy pr_docs_new   on ops_procure.pr_documents
  for insert to authenticated with check (ops_core.has_permission('procurement.create'));
create policy pr_docs_edit  on ops_procure.pr_documents
  for update to authenticated
  using (ops_core.has_permission('procurement.update'))
  with check (ops_core.has_permission('procurement.update'));
create policy pr_lines_new  on ops_procure.pr_lines
  for insert to authenticated with check (ops_core.has_permission('procurement.create'));
create policy pr_lines_edit on ops_procure.pr_lines
  for update to authenticated
  using (ops_core.has_permission('procurement.update'))
  with check (ops_core.has_permission('procurement.update'));

-- **`approve_goods` or nothing, and never a module level** (D19, D24). This is
-- the policy the whole access model was built to make possible: a person with
-- `procurement.admin` — who can create, edit and remove every line on the board
-- — still cannot write a row here. Approving goods belongs to the CEO.
--
-- The FUNDS step is `approve_funds` for the same reason. The check is written
-- as one expression rather than two policies so that a step nobody has thought
-- about is refused by default rather than allowed by omission.
create policy pr_appr_new on ops_procure.pr_approvals
  for insert to authenticated
  with check (
    case step
      when 'GOODS' then ops_core.has_authority('approve_goods')
      when 'FUNDS' then ops_core.has_authority('approve_funds')
      else false
    end);

-- A note is leadership's word, so writing one needs an authority too (D64).
-- Either one: a funds approver saying "pay this in two parts" is leaving an
-- instruction, and it is worth having on the line.
create policy notes_new on ops_procure.line_notes
  for insert to authenticated
  with check (ops_core.has_authority('approve_goods') or ops_core.has_authority('approve_funds'));

-- Explaining a variance is ordinary procurement work, not a decision: whoever
-- made the payment is usually the one who knows why it differed, and requiring
-- an authority would mean the explanations never get written.
create policy var_new on ops_procure.line_variances
  for insert to authenticated
  with check (ops_core.has_permission('procurement.update'));

grant select on ops_procure.pr_documents, ops_procure.pr_lines, ops_procure.pr_approvals,
                ops_procure.line_notes, ops_procure.line_variances to authenticated;
grant insert on ops_procure.pr_documents, ops_procure.pr_lines, ops_procure.pr_approvals,
                ops_procure.line_notes, ops_procure.line_variances to authenticated;
-- Update on the two tables that have a lifecycle, and on nothing else: an
-- approval, a note and a variance are statements somebody made on a date, and
-- correcting one means making another (A2, A5).
grant update on ops_procure.pr_documents, ops_procure.pr_lines to authenticated;
