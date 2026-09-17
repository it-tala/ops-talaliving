/** Accounting contracts — cut to `docs/plan/02-database.md`, schema `acct`. */

/* ------------------------------------------------------------------ */
/* Vocabulary — copied verbatim. Do not tidy the spelling.             */
/* ------------------------------------------------------------------ */

/** The five accounts, spelled exactly as production spells them. */
export const ACCOUNT_CODES = [
  "PETTY CASH",
  "BNI 325",
  "BCA 271",
  "JAGO",
  "BCA 064",
  "BCA USD 081",
] as const;
export type AccountCode = (typeof ACCOUNT_CODES)[number];

/** Accounting holds three and they pay vendors; leadership holds two and they
 *  never pay a vendor directly — money only enters them via a statement. */
export type AccountCustody = "accounting" | "leadership";

/** Thirteen types. `RECCURING` keeps its doubled C: it is the value in the
 *  data, and correcting the spelling here would simply fail to match. */
export const TRANSACTION_TYPE_CODES = [
  "RECCURING - UTILITIES",
  "CREDIT CARD",
  "PREPAID VENDOR",
  "SUPPLIERS",
  "BANK CHARGES",
  "ONLINE",
  "CHINA",
  "RECCURING - PAYROLL",
  "CASHFLOW",
  "OTHERS",
  "PRODUCTION",
  "OFFICE",
  "WAREHOUSE",
] as const;
export type TransactionTypeCode = (typeof TRANSACTION_TYPE_CODES)[number];

export type Direction = "IN" | "OUT";

/** VOID keeps the row and zeroes the amount with a reason (A5). */
export type TrxStatus = "POSTED" | "COMPLETED" | "UNTRACKED" | "VOID";

export type AllocMethod = "transfer" | "cash" | "other";

/** The exception road only (ADR-010). Everything with a known parent is
 *  attached from the record and never reaches this. */
export type InboxOrigin = "chat" | "web";
export type InboxStatus =
  | "PENDING"
  | "CONFIRMED"
  | "ATTACHED"
  | "REJECTED"
  | "CANCELLED"
  | "NOTED";

export type StatementStatus = "PENDING" | "BOOKED" | "ABANDONED";

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export interface Account {
  id: string;
  code: AccountCode;
  name: string;
  custody: AccountCustody;
  is_paying: boolean;
  currency: string;
  opening_balance: number;
  opened_on: string;
  is_active: boolean;
}

export interface TransactionType {
  code: TransactionTypeCode;
  /** Vetoes auto-complete: goods that were bought can still be delivered. */
  is_purchase: boolean;
  /** Ships inert (D26). Fuel and utilities are marked complete by hand for
   *  now; turning the rule on later is a data change, not a code change. */
  auto_complete: boolean;
  creates_catalog_item: boolean;
}

export interface Transaction {
  id: string;
  trx_no: string;
  trx_date: string;
  account_id: string;
  direction: Direction;
  /** Always positive. Direction lives in its own column. Whole rupiah. */
  amount_idr: number;
  type_code: TransactionTypeCode;
  vendor_id: string | null;
  project_id: string | null;
  description: string;
  remark: string | null;
  status: TrxStatus;
  /** The idempotency claim. A repeat with the same ref is a no-op (A4). */
  source_ref: string;
  posted_by: string;
  posted_at: string;
  void_reason: string | null;
}

export interface TransactionLine {
  id: string;
  trx_id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  qty: number | null;
  uom: string | null;
  unit_price: number | null;
  amount: number;
}

/** Owned by accounting; references the PR line by its public id, validated at
 *  the seam (ADR-004). Corrections supersede, never delete (A2). */
export interface PaymentAllocation {
  id: string;
  trx_id: string;
  pr_line_no: string | null;
  po_no: string | null;
  amount: number;
  method: AllocMethod;
  superseded_by: string | null;
  allocated_by: string;
  allocated_at: string;
}

/* ── What one document is holding up ──────────────────────────────────────
 *
 *  Verification is not one document, one row. Three shapes are ordinary here
 *  and all three break the assumption (owner):
 *
 *  1. **One document, several transactions.** A nota covering a delivery that
 *     was paid in two goes. Already possible — `attachment_links` is
 *     many-to-many from the start — but never *shown*, which is the same as
 *     not existing to the person deciding.
 *
 *  2. **One transfer proof, several purchases.** One screenshot of a transfer
 *     settling four request lines at once. The arithmetic that matters is the
 *     gap: the transfer says Rp 5.000.000 and the rows under it add to
 *     Rp 4.200.000, and the Rp 800.000 has to be somewhere.
 *
 *  3. **One purchase paid twice — part cash, part transfer.** Two ledger rows
 *     on two different accounts, both allocating to the same request line.
 *     The ledger is right to hold two rows; what was missing is a screen that
 *     shows them as one payment (D206).
 *
 *  None of these needed a model change. All three needed to be visible before
 *  somebody books the same nota a second time.
 */

/** One ledger row a document stands as evidence for. */
export interface CoverageTransaction {
  trx_no: string;
  trx_date: string;
  account_code: string;
  account_name: string;
  direction: Direction;
  amount_idr: number;
  status: TrxStatus;
  description: string;
  /** How many other documents also stand behind this row. More than one is
   *  normal — a nota and its transfer proof. */
  other_documents: number;
}

/** One payment against one request line, from one transaction. Several of
 *  these on one line **is** the split payment. */
export interface CoveragePayment {
  trx_no: string;
  account_code: string;
  method: AllocMethod;
  amount: number;
  /** True when this transaction is one of the ones the document covers — the
   *  other half of a split may have been paid against a document filed
   *  elsewhere, and saying so is the point. */
  from_this_document: boolean;
}

/** One request line the document reaches, through the transactions on it. */
export interface CoverageLine {
  line_no_full: string;
  description: string;
  approved: number;
  covered: number;
  remaining: number;
  settled: boolean;
  payments: CoveragePayment[];
}

export interface DocumentCoverage {
  attachment_id: string;
  /** What the document itself says it is worth, when anybody has read it.
   *  Null is a real answer and the screen says so rather than assuming zero. */
  document_amount: number | null;
  transactions: CoverageTransaction[];
  lines: CoverageLine[];
  /** The ledger rows this document stands behind, added up. */
  covered_total: number;
  /** `document_amount − covered_total`. **Null when the document's own value
   *  was never read** — a gap computed against an unknown is not a gap, it is
   *  the whole amount dressed as one. */
  gap: number | null;
  /** More than one ledger row leans on this one piece of paper. Not a problem;
   *  a thing to know before booking it again. */
  shared: boolean;
}

/** The same three questions asked from the other end — of a ledger row you
 *  are about to attach a document to.
 *
 *  This is where the check actually bites. A document sitting in the queue is
 *  attached to nothing yet, so its own coverage is empty and tells nobody
 *  anything. What decides whether *link* is the right road is the state of the
 *  **row being linked to**: what paper it already has, what it already pays,
 *  and whether it is already fully proven (D207).
 */
export interface TransactionCoverage {
  trx_no: string;
  amount_idr: number;
  status: TrxStatus;
  account_code: string;
  description: string;
  /** Paper already standing behind this row. Two is ordinary — a nota and a
   *  transfer proof — and a third is worth a second look. */
  documents: { attachment_id: string; filename: string; kind: string }[];
  /** Every request line and order this row was allocated to, with the method.
   *  One transfer across four purchases is this list with four entries. */
  allocations: { target: string; kind: "line" | "po"; amount: number; method: AllocMethod }[];
  /** Allocated out of `amount_idr`; the remainder is money on this row that is
   *  not yet pointed at anything. */
  allocated_total: number;
  unallocated: number;
  lines: CoverageLine[];
}

export interface EvidenceInboxRow {
  id: string;
  ref_id: string;
  origin: InboxOrigin;
  status: InboxStatus;
  attachment_id: string;
  reported_by: string;
  reported_at: string;
  /** The AI's reading. A proposal, never a posting.
   *  Every field is nullable because "could not read it" is a real answer and
   *  a more useful one than a guess — low confidence leaves the field empty
   *  and asks, rather than filling it in hopefully. */
  extracted: {
    vendor_name?: string | null;
    document_date?: string | null;
    amount_idr?: number | null;
    doc_type?: string | null;
    confidence?: number | null;
    note?: string | null;
  };
  produced_trx_id: string | null;
  produced_pr_line_no: string | null;
  similar_trx_nos: string[];
  /** Which way the money went, when that is known from the document itself.
   *  Almost everything here is money going OUT — somebody bought first. A
   *  transfer proof from leadership is the other direction, and it is worth
   *  telling apart because the two are resolved by different people for
   *  different reasons (D81). */
  money_direction?: Direction | null;
}

/** Money already booked into a paying account, with whatever proof is on it.
 *
 *  The payment-round screen reads this instead of asking somebody to retype an
 *  amount the ledger already holds. `proof_attachment_id` is what a round
 *  needs before it can call itself funded (D80). */
export interface IncomingMoney {
  trx_no: string;
  trx_date: string;
  account_code: string;
  amount_idr: number;
  description: string;
  proof_attachment_id: string | null;
  proof_filename: string | null;
}

/** One uploaded rekening koran (D180).
 *
 *  For BCA 064 and BCA USD 081 this is not a check on rows somebody typed: the
 *  two accounts are held by leadership and not shared openly, so the statement
 *  is **how their rows come to exist at all**. Importing one therefore creates
 *  ledger entries rather than merely ticking existing ones off — and the file
 *  itself is the evidence behind every row it creates (D85).
 */
export interface BankStatement {
  id: string;
  statement_no: string;
  account_id: string;
  period_start: string;
  period_end: string;
  /** What the bank says the account held at each end. The two, against the sum
   *  of the lines, are what says whether the file is complete (D182). */
  opening_balance: number;
  closing_balance: number;
  /** `IDR`, `USD` — the account's own currency, carried on the statement
   *  because a dollar statement is not a rupiah one with a different number. */
  currency: string;
  filename: string;
  status: StatementStatus;
  attachment_id: string | null;
  note: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

/** Where one line of the statement has got to. */
export type StatementLineStatus =
  /** Nothing in the ledger looks like it, and nobody has decided. */
  | "unmatched"
  /** Tied to a ledger row that already existed. Nothing is created. */
  | "matched"
  /** A ledger row was created from it — the ordinary case for the leadership
   *  accounts (D180). */
  | "booked"
  /** Deliberately left out, with a reason. Never deleted. */
  | "ignored";

export interface StatementLine {
  id: string;
  statement_id: string;
  line_no: number;
  value_date: string;
  direction: Direction;
  /** The amount in the statement's own currency. For an IDR statement this and
   *  `amount_idr` are the same number. */
  amount: number;
  /** Rupiah, once somebody has said at what rate. **Null until then** — a
   *  dollar line booked at a guessed rate is a wrong number in the ledger and
   *  a right-looking one on the screen (D181). */
  amount_idr: number | null;
  /** Rupiah per unit of the statement's currency, typed by a person. Null for
   *  an IDR statement, where there is nothing to convert. */
  fx_rate: number | null;
  raw_description: string;
  /** The running balance the bank printed, carried verbatim for checking. */
  balance_after: number | null;
  status: StatementLineStatus;
  /** The ledger row this line is, whether it was found or created. */
  trx_no: string | null;
  /** Required on `ignored`. */
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

/** A ledger row that looks like this line — same account, same direction, same
 *  amount, near the same day. **A suggestion, never applied by itself** (D180). */
export interface StatementMatch {
  trx_no: string;
  trx_date: string;
  description: string;
  amount_idr: number;
  /** How far apart the dates are, in days. Zero is the usual case; a couple of
   *  days is a bank posting late, which is normal and worth showing. */
  days_apart: number;
}

export interface StatementLineView extends StatementLine {
  suggestions: StatementMatch[];
}

export interface BankStatementView extends BankStatement {
  account_code: string;
  account_name: string;
  uploaded_by_name: string;
  lines: StatementLineView[];
  /** Σ in − Σ out, in the statement's currency. */
  movement: number;
  /** `opening + movement`, against what the bank printed as closing. They
   *  disagree when the file is partial — which is worth refusing to hide
   *  (D182). */
  computed_closing: number;
  balance_ok: boolean;
  unmatched: number;
  booked: number;
  matched: number;
  ignored: number;
  /** Lines in a foreign currency with no rate typed yet: they cannot reach the
   *  ledger, and the screen says which (D181). */
  awaiting_rate: number;
}

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

export interface AccountBalance {
  account_id: string;
  code: AccountCode;
  name: string;
  custody: AccountCustody;
  currency: string;
  is_paying: boolean;
  opening_balance: number;
  total_in: number;
  total_out: number;
  /** opening + in − out, excluding VOID. The database owns this number (D9);
   *  no screen recomputes it, and a screen that cannot load it shows an em
   *  dash rather than a substitute. */
  balance: number;
}

export interface TransactionView extends Transaction {
  account_code: AccountCode;
  vendor_name: string | null;
  allocated_total: number;
  /** amount − allocated. A transaction never funds more than it moved (A9). */
  unallocated: number;
  evidence_count: number;
  has_payment_proof: boolean;
  has_receipt_doc: boolean;
  pr_line_nos: string[];
  /** Whether money leaving on this row is supposed to point at a request at
   *  all. Payroll, utilities and bank charges never do; a supplier payment
   *  always should. Without the distinction the ledger flags two thirds of a
   *  normal month as a problem, and people learn to ignore the flag (D83). */
  expects_allocation: boolean;
}

/** One allocation, with enough of the line to read it without a second call. */
export interface AllocationView extends PaymentAllocation {
  line_description: string | null;
  line_status: string | null;
}

/** Everything a ledger row is made of, in one call: what it bought, what it
 *  funded, and what proves it. */
export interface TransactionDetail extends TransactionView {
  lines: TransactionLine[];
  allocations: AllocationView[];
}

/** One payment to a vendor, and what it settled.
 *
 *  `applies_to` is a list because one transfer really does close three orders,
 *  and recording it as three payments would say the bank moved money three
 *  times. The bank saw one payment; the vendor closed three orders; both are
 *  true and both are kept (D97).
 */
export interface VendorPayment {
  trx_no: string;
  trx_date: string;
  amount: number;
  description: string;
  status: TrxStatus;
  applies_to: { po_no: string; amount: number }[];
  proof_attachment_id: string | null;
  proof_filename: string | null;
}

export interface InboxHealth {
  week_start: string;
  arrived: number;
  unresolved: number;
  by_origin: Record<InboxOrigin, number>;
}

/* ------------------------------------------------------------------ */
/* Liquidation — one funding transfer, and where it went               */
/* ------------------------------------------------------------------ */

/** No money arrives here from a client. The only inflow into an operating
 *  account is leadership moving operating funds in, and the question that
 *  follows every one of them is the same: *saya sudah transfer sekian, kok
 *  sudah habis?* (D106).
 *
 *  So the unit is the transfer, not the month. The window runs from one
 *  transfer to the next into the same account, and nothing here guesses which
 *  rupiah came from which transfer: it compares what was spent in that window
 *  against what was sent. When spending passes the transfer, the excess came
 *  out of the balance that was already there, and the screen says so in those
 *  words rather than inventing a lineage.
 */
export interface FundingView {
  trx_no: string;
  trx_date: string;
  account_id: string;
  account_code: AccountCode;
  amount: number;
  description: string;
  /** Where it came from — the mirror row on the leadership account. */
  from_account_code: AccountCode | null;
  /** Balance on the receiving account the moment before it landed. */
  balance_before: number;
  /** Next transfer into the same account, or `null` while this is the current
   *  one — an open window is stated as open, never as finished. */
  next_funding_no: string | null;
  window_end: string | null;
  /** Everything that left the account inside the window, VOID excluded. */
  spent: number;
  /** The day cumulative spending first reached the transfer, and how many days
   *  that took. `null` while the transfer still has room in it. */
  consumed_on: string | null;
  days_lasted: number | null;
  /** Whichever applies: what is left of the transfer, or what was spent beyond
   *  it out of the balance that was already there. */
  remaining: number;
  beyond: number;
  /** Of what was spent, how much was tied to an approved line or a purchase
   *  order. `undecided` counts only rows that were *expected* to be — payroll
   *  and the electricity bill are money leaving for reasons nobody raises a
   *  request for, and counting them here would drown the rows that matter
   *  (D83). */
  decided: number;
  undecided: number;
  is_open: boolean;
  headline: string;
}

export interface FundingSpendGroup {
  key: string;
  label: string;
  amount: number;
  /** 0–1 of everything spent in the window. */
  share: number;
  count: number;
}

export interface FundingSpendRow {
  trx_no: string;
  trx_date: string;
  description: string;
  type_code: TransactionTypeCode;
  vendor_name: string | null;
  project_name: string | null;
  amount: number;
  /** What was left of the transfer after this row. Goes negative once
   *  spending passes what was sent, which is the point. */
  left_of_transfer: number;
  /** Tied to an approved request line or to a purchase order. A PO payment is
   *  as authorised as a PR payment — both went through a decision. */
  decided: boolean;
  /** Whether this kind of spending is expected to carry one at all (D83). */
  expects_link: boolean;
  /** Money that left with nothing approved behind it, **above the limit the
   *  owner set** (D231). Below the limit the row is still undecided and still
   *  listed — the limit changes what is worth chasing, not what is true. */
  over_no_approval_limit: boolean;
  status: TrxStatus;
}

export interface FundingDetail extends FundingView {
  proof_filename: string | null;
  rows: FundingSpendRow[];
  by_type: FundingSpendGroup[];
  by_vendor: FundingSpendGroup[];
  by_project: FundingSpendGroup[];
}

/* ------------------------------------------------------------------ */
/* Payment calendar — twelve months, planned against actual            */
/* ------------------------------------------------------------------ */

/** How often a line happens. Three shapes, because the business has three.
 *
 *  `monthly` is the electricity bill: same day every month. `weekly` is
 *  payroll: four runs in most months and five in some, which is a real
 *  difference in what a month costs and used to be hidden inside one figure.
 *  `once` is a bill that is certain but not repeating — settling a vendor in
 *  October, paying a credit card off rather than carrying it (D113).
 */
export type CashFrequency = "weekly" | "monthly" | "once";

/** One thing on the calendar: payroll, the electricity bill, a vendor
 *  settlement — or, on the way in, the operating transfer leadership plans.
 *
 *  It carries **when it is due**, which is what makes this a reminder as well
 *  as a budget (owner: *kita punya daftar tagihan berulang bulanan beserta
 *  tanggal pembayarannya*). `amount` is **per occurrence**, not per month: a
 *  weekly line costs more in a five-payday month, and pretending otherwise is
 *  how a month gets underestimated by a whole run (D113).
 *
 *  `type_code` (with `vendor_id` when it narrows it further) is how the plan
 *  finds what actually happened. Claims are resolved most-specific-first, and
 *  one ledger row is only ever claimed once (D110).
 */
export interface CashComponent {
  id: string;
  name: string;
  direction: Direction;
  /** Per occurrence. A weekly line of 30 juta is 120 or 150 in a month. */
  amount: number;
  frequency: CashFrequency;
  /** `monthly`: 1–31, clamped to the length of each month, so 31 in February
   *  is the 28th rather than a date that does not exist. */
  due_day: number;
  /** `weekly`: 0 Sunday … 6 Saturday. */
  due_weekday: number | null;
  /** `once`: the actual date, `YYYY-MM-DD`. It exists in that month and no
   *  other. */
  due_date: string | null;
  type_code: TransactionTypeCode | null;
  vendor_id: string | null;
  account_id: string | null;
  /** The statutory schemes this line pays — **a list**, because one BPJS
   *  Ketenagakerjaan invoice covers JHT, JP, JKK and JKM at once (D259).
   *  Modelling it as one scheme made the other three read *no cash line tied to
   *  this scheme* while their money was plainly going out on the line next to
   *  them.
   *
   *  It is what lets accounting hold **the roll of names against the money**:
   *  the expected figure comes from HR's enrolment register, the paid figure
   *  from this line's own actuals, and the two screens cannot disagree about
   *  what was paid because there is one calculation seen twice (D228). A
   *  public code, resolved at the seam — accounting does not reach into HR's
   *  tables (ADR-004). */
  scheme_codes: string[];
  /** `YYYY-MM`, inclusive. `ends_on` null means it keeps going. */
  starts_on: string;
  ends_on: string | null;
  note: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
}

/** One month of one component, changed. `amount: null` means *not this month*
 *  — a bill that skips a month is a fact, not a deletion.
 *
 *  For a weekly line the amount is **the month's total**, and the difference
 *  lands on the last run of the month: December's payroll carries the THR,
 *  and the THR is paid with one run rather than spread across four (D114). */
export interface CashOverride {
  id: string;
  component_id: string;
  /** `YYYY-MM` */
  month: string;
  amount: number | null;
  due_day: number | null;
  reason: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** A person saying *this ledger row is that bill*. Matching by category is a
 *  guess the screen is honest about; this is somebody deciding. */
export interface CashSettlement {
  id: string;
  component_id: string;
  month: string;
  trx_no: string;
  recorded_by: string;
  recorded_at: string;
}

export type CashCellState =
  | "PAID"        // something actually happened against it
  | "PARTIAL"     // less than planned, so far
  | "OVERDUE"     // due date has passed, nothing recorded
  | "DUE"         // due within the week
  | "PLANNED"     // still ahead
  | "SKIPPED";    // an override said not this month

/** One dated movement: this line, on this day. A monthly line has one a
 *  month, a weekly line four or five, a one-off exactly one ever. */
export interface CashEvent {
  component_id: string;
  name: string;
  direction: Direction;
  frequency: CashFrequency;
  month: string;
  date: string;
  planned: number;
  actual: number;
  matched_by: "linked" | "category" | null;
  trx_nos: string[];
  state: CashCellState;
  vendor_name: string | null;
  account_code: AccountCode | null;
  /** Set on the run that carries a month override — December's THR lands on
   *  one payday, not spread across four (D114). */
  carries_override: boolean;
  reason: string | null;
}

export interface CashCell {
  month: string;
  due_date: string;
  planned: number;
  actual: number;
  /** How the actual was arrived at — somebody's link, or a category match the
   *  screen is not certain about. */
  matched_by: "linked" | "category" | null;
  trx_nos: string[];
  state: CashCellState;
  overridden: boolean;
  reason: string | null;
  /** Every dated movement behind this cell. One for a monthly line, four or
   *  five for a weekly one, none in a month a one-off does not fall in. */
  events: CashEvent[];
}

export interface CashRow {
  component: CashComponent;
  vendor_name: string | null;
  account_code: AccountCode | null;
  cells: CashCell[];
  planned_total: number;
  actual_total: number;
}

/** Everything that actually left in a month with no component claiming its
 *  category. The plan has to reconcile to the ledger or it is fiction, and
 *  this row is where the difference lives until somebody plans for it. */
export interface CashUnplanned {
  month: string;
  amount: number;
  trx_nos: string[];
  top_types: { type_code: string; amount: number }[];
}

export interface CashMonth {
  /** `YYYY-MM` */
  month: string;
  label: string;
  is_past: boolean;
  is_current: boolean;
  planned_in: number;
  planned_out: number;
  actual_in: number;
  actual_out: number;
  unplanned_out: number;
  /** Cash across the paying accounts at the end of this month, on the plan.
   *  Past months use what actually happened; future months use the plan. */
  closing: number;
}

export interface CashPlan {
  generated_for: string;
  opening_cash: number;
  months: CashMonth[];
  rows: CashRow[];
  unplanned: CashUnplanned[];
  /** The first month the plan runs out of money, if it does. */
  short_month: string | null;
  short_by: number;
  /** Obligations the system knows about that carry no date, so no month can
   *  hold them (F30). Stated, never spread evenly to make the chart tidy. */
  undated_obligations: number;
  verdict: string;
}

/** One month opened up: every movement in date order, with the balance
 *  running down beside it.
 *
 *  The figure the month view cannot show is the **trough** — a month can end
 *  at Rp 50 juta and still be unable to pay on the 15th, because the monthly
 *  view silently assumes money in arrives before money out (D115).
 */
export interface CashDayRow extends CashEvent {
  /** Cash after this movement. Only movements still ahead move it: what
   *  already happened is inside the opening figure. */
  balance: number;
  /** Already happened, in the month we are standing in. */
  is_past: boolean;
}

export interface CashMonthDetail {
  month: string;
  label: string;
  opening: number;
  closing: number;
  rows: CashDayRow[];
  /** The lowest the balance gets, and the day it happens. */
  low_point: number;
  low_date: string | null;
  /** The **first** day the balance goes under, which is not the same day and
   *  is the more useful one: it is the first payment that cannot be made, and
   *  everything after it is a consequence of that one. */
  first_negative_date: string | null;
  /** Real obligations that carry no date, so no day here can hold them
   *  (F30). Shown inside the expansion, never spread evenly to make the
   *  running balance look tidy. */
  undated_obligations: number;
}

/** One bill about to fall due — the reminder half of the calendar. Built from
 *  the same events as the month expansion, so the two cannot drift (D116). */
export type CashDue = CashEvent & { days_away: number };


/* ── The month's bills, as a worklist ────────────────────────────────────
 *
 *  The cash calendar is twelve months wide and it belongs to leadership: it
 *  answers *when does the money run out*. Accounting opening it has to walk
 *  the whole grid to find the only question they have — **what do I have to
 *  pay this month, and what have I already paid** (owner, D227).
 *
 *  Same components, same events, same arithmetic as the calendar. Nothing new
 *  is computed: a second figure for the same obligation is a figure that will
 *  disagree with the first one within a month. What changes is the shape — one
 *  month, in date order, with what is done separated from what is not.
 */
export interface MonthlyBill {
  component_id: string;
  name: string;
  date: string;
  direction: Direction;
  planned: number;
  actual: number;
  /** `planned − actual`, floored at zero. What is still to go out. */
  outstanding: number;
  state: CashCellState;
  /** Negative once the date has passed. */
  days_away: number;
  vendor_name: string | null;
  account_code: AccountCode | null;
  trx_nos: string[];
  /** How the payment was recognised — a link somebody made, or a category
   *  match the system inferred. Worth showing: an inferred match is a guess
   *  that happens to be right most of the time. */
  matched_by: "linked" | "category" | null;
  reason: string | null;
  /** What this **line** amounts to across the whole month, and how many rows
   *  it has here. The comparison below is against these, not against this one
   *  row: a weekly payday is one fifth of a payroll, and measuring it against
   *  last month's whole payroll reports −80% five times a month for nothing
   *  (F68). One rule decides both months — a month that has ended is worth
   *  what it cost, a month still running is worth what it is expected to
   *  cost — so the two sides of every percentage are the same kind of
   *  number. */
  month_total: number;
  occurrences: number;
  /** The same figure for the previous month, and by how much this one differs.
   *  **Null when there was no such line last month** — a first occurrence is
   *  not a hundred-per-cent increase (D228). */
  last_month: number | null;
  delta: number | null;
  delta_percent: number | null;
  /** Set when the difference is large enough to be worth a look. Never blocks,
   *  and the threshold is a setting rather than a number in the code. */
  unusual: boolean;
}

export interface MonthlyBills {
  month: string;
  label: string;
  bills: MonthlyBill[];
  /** Out only — what leaves. The `IN` lines are shown but excluded from the
   *  totals, because *what must I pay* is not answered by money arriving. */
  total_planned: number;
  total_paid: number;
  total_outstanding: number;
  overdue_count: number;
  overdue_amount: number;
  due_this_week: number;
  unusual_count: number;
  /** The same month a year of components ago, for the header comparison. */
  last_month_total: number | null;
}
