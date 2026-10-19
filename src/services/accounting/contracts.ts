/** Accounting contracts — cut to `docs/plan/02-database.md`, schema `acct`. */

import type { LineKind } from "./lines";

/* ------------------------------------------------------------------ */
/* Vocabulary — copied verbatim. Do not tidy the spelling.             */
/* ------------------------------------------------------------------ */

/** An account's code — what everybody in the building calls it ("BCA 271").
 *  Read from `ops_acct.accounts`, maintained on Master Data › Accounts
 *  (`0105`); it used to be a hard-coded list here. */
export type AccountCode = string;

/** Accounting holds three and they pay vendors; leadership holds two and they
 *  never pay a vendor directly — money only enters them via a statement. */
export type AccountCustody = "accounting" | "leadership";

/** A transaction type's code, spelled as the data spells it — `RECCURING`
 *  keeps its doubled C. Read from `ops_acct.transaction_types`, maintained on
 *  Master Data › Transaction types (`0105`). The hard-coded list of thirteen
 *  that used to live here missed five of production's eighteen. */
export type TransactionTypeCode = string;

export type Direction = "IN" | "OUT";

/** What a row was for, as leadership reads it (`ops_acct.category_t`,
 *  `0274`; D433, D435). Ten, named in English, `ejo` and `saripan` reported
 *  apart. Labels and notes in `./categories`. */
export type Category =
  | "transfer" | "income" | "vendor" | "payroll" | "fixed"
  | "overhead" | "bank" | "tax" | "ejo" | "saripan";

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
  /** The category every row of this type gets unless the row says otherwise
   *  (`0274`). A type nobody classified is `overhead`. */
  category: Category;
  /** What the type is for, in a sentence — shown beside the picker. */
  description?: string | null;
  /** Retired types stay on their rows and leave the pickers (`0105`). */
  is_active?: boolean;
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
  /** item · fee · tax · shipping · discount · other (`0271`). The amount
   *  stays positive; a discount is subtracted when the lines are summed.
   *  Only item lines feed price references. */
  kind: LineKind;
  item_id: string | null;
  /** The catalogue entry the line bought, named — from `v_transaction_detail`
   *  (`0272`); absent on the demo's stored rows and on a line without one. */
  item_code?: string | null;
  item_name?: string | null;
  /** The document this line was read from — one of the row's own
   *  attachments, or null (`0279`, L11). Set by `set_line_evidence`, and by
   *  booking from the inbox. Absent on the demo's older fixtures. */
  attachment_id?: string | null;
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
  /** Which file this row is — the stored link or path of its attachment.
   *  Rows of one photo share it even though each has its own attachment
   *  row; two photos sent in one chat message do not. It is what the
   *  screen groups a document by, and the same identity `book_evidence_group`
   *  (0161) and `link_evidence` (0162) check before booking rows as one. */
  file_key: string;
  reported_by: string;
  /** Who `reported_by` is, spelled out — the chat sender's own name, not a
   *  uuid the screen would otherwise have to look up itself. Null only for
   *  the rare row nobody could resolve a name for. */
  reported_by_name: string | null;
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
    /** The sender's name as the capture worker gave it, when it matched
     *  nobody active and the row was filed under the fallback account
     *  instead (0237, D390). Absent when `reported_by` is the sender. */
    reported_as?: string | null;
    /** What john-lau forwards since 2026-10-15 (its J1; kajian §6.10):
     *  the reading's account code and transaction type (offered on the
     *  form, the person confirms, A13), the project as read, the invoice
     *  number (kept in the row's remark), the message caption (`0281`
     *  reads the `pr-…-Lxx` it names), capture's duplicate verdict, and the
     *  far side's own kind code. Every line of the reading rides in
     *  `lines`; the readings set aside as impossible (a statement balance,
     *  the cancelling leg of a transfer) in `dropped_lines`, each with its
     *  reason. All optional: rows filed before that date have none. */
    account?: string | null;
    transaction_type?: string | null;
    project?: string | null;
    invoice_no?: string | null;
    caption?: string | null;
    duplicate_suspect?: boolean | null;
    doc_kind?: string | null;
    lines?: Record<string, unknown>[];
    dropped_lines?: { reason?: string; note?: string | null; amount_idr?: number | null; money_direction?: string | null }[];
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

/** An approved request line still owed money, ranked for one inbox document
 *  (`inbox_line_candidates`, 0281, L6): the line the message names first
 *  (`caption_match`), then the reading's vendor (`vendor_match`), then an
 *  amount within tolerance of what is owed (`amount_match`), newest decision
 *  first. A read; the person chooses. */
export interface InboxLineCandidate {
  line_no: string;
  description: string;
  doc_no: string;
  vendor_id: string | null;
  vendor_name: string | null;
  project_code: string | null;
  project_name: string | null;
  approved_amount: number;
  covered: number;
  remaining: number;
  approved_by: string | null;
  approved_at: string | null;
  approval_channel: "web" | "chat" | "sheet" | "script" | "api" | null;
  caption_match: boolean;
  vendor_match: boolean;
  amount_match: boolean;
}

export interface InboxLineCandidates {
  candidates: InboxLineCandidate[];
  /** The `pr-…-Lxx` the message named, normalised, or null. */
  caption_line: string | null;
  vendor_read: string | null;
  amount_read: number | null;
}

/* ------------------------------------------------------------------ */
/* Ledger drafts (0286, D445)                                          */
/* ------------------------------------------------------------------ */

/** How sure the grouping is: *yakin* · *periksa* · *ragu* · a document with
 *  no partner yet. Always shown with its label and its reasons, never by
 *  colour alone. */
export type DraftLevel = "hi" | "mid" | "lo" | "loose";

/** How a draft is booked when somebody ticks it — the roads Verification
 *  offered, proposed by the grouping instead of picked by hand. */
export type DraftRoad = "transaction" | "transfer" | "pay_line" | "link";

/** What a document in a draft is to the transaction. */
export type DraftDocRole = "payment" | "nota" | "photo" | "other";

/** One reason the grouping gives, in both languages, with its tone: what
 *  agrees (`ok`), what a person should look at (`check`), what is missing or
 *  contradicts (`bad`). */
export interface DraftReason {
  tone: "ok" | "check" | "bad";
  en: string;
  id: string;
}

/** One file in a draft — every inbox row of one photo (0161). */
export interface DraftDocument {
  key: string;
  ref_ids: string[];
  file_key: string;
  attachment_id: string;
  role: DraftDocRole;
  /** Σ what the rows read, or null when nothing was read. */
  amount: number | null;
  vendor_name: string | null;
  document_date: string | null;
  account: string | null;
  confidence: number | null;
  note: string | null;
  reported_by: string;
  reported_by_name: string | null;
  reported_at: string;
  rows: EvidenceInboxRow[];
}

/** A line the draft proposes. `doc` is the index of the document in
 *  `LedgerDraft.docs` it was read from; after booking the line points at
 *  that document (0279). */
export interface DraftLine {
  kind: LineKind;
  description: string;
  qty: number | null;
  uom: string | null;
  unit_price: number | null;
  amount: number;
  doc: number;
}

/** One transaction, as the grouping proposes it from the documents still
 *  PENDING in the inbox. Computed on every read (`buildDrafts`), never
 *  stored: only a decision about it is (`draft_decisions`). */
export interface LedgerDraft {
  /** The head document's first inbox ref — what the booked row's
   *  `source_ref` will be. */
  key: string;
  /** A short name for people: `DRF-` and four characters of the key. */
  label: string;
  level: DraftLevel;
  /** 0–100, or null for a loose document. */
  score: number | null;
  reasons: DraftReason[];
  /** The head first: the payment proof when there is one, because its
   *  amount is what left the bank. */
  docs: DraftDocument[];
  road: DraftRoad;
  direction: Direction;
  amount: number | null;
  account_code: string | null;
  /** The other leg's account, on the transfer road. */
  to_account_code: string | null;
  fee: number | null;
  trx_date: string;
  vendor_name: string | null;
  description: string;
  type_code: string | null;
  lines: DraftLine[];
  /** The row this draft's documents prove, on the link road. */
  link_trx_no: string | null;
  /** The approved request line the message names, on the pay_line road. */
  pay_line_no: string | null;
  /** A nota bigger than the transfer: booked at the transfer, with a remark
   *  (Q3, D445). */
  partial_of: number | null;
}

/** What a person was shown when deciding, kept with the decision. */
export interface DraftShown {
  level: DraftLevel;
  score: number | null;
  reasons: string[];
  proposed: { amount: number | null; account: string | null; road: DraftRoad };
}

/** A document already decided in the last few days, with the row it went
 *  to: what a late document is matched against (review §5). */
export interface DraftAnchor {
  row: EvidenceInboxRow;
  trx_no: string;
}

/** Two files a person said are not one transaction (`draft_apart`). */
export interface DraftApart {
  file_a: string;
  file_b: string;
}

export interface DraftConfirmInput {
  key: string;
  /** The documents, head first, each as its inbox refs. */
  docs: string[][];
  road: DraftRoad;
  account_id: string | null;
  to_account_id?: string | null;
  amount: number;
  trx_date: string;
  direction: Direction;
  type_code: TransactionTypeCode;
  description: string;
  vendor_id?: string | null;
  project_id?: string | null;
  lines?: DraftLine[];
  remark?: string | null;
  fee?: number | null;
  line_no?: string | null;
  link_trx_no?: string | null;
  shown: DraftShown;
}

export interface DraftConfirmed {
  trx_no: string;
  road: DraftRoad;
  documents: number;
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
  /** A deactivated account keeps its balance and history and leaves the
   *  pickers (`0105`). */
  is_active?: boolean;
  /** The date the opening balance is as of. */
  opened_on?: string;
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
  /** The account's balance just before this row and just after it — opening
   *  plus every earlier non-void row on the same account, by `trx_date` then
   *  `trx_no`. Computed, never stored, so a row posted late or corrected moves
   *  every balance after it (D429). Null on a VOID row. */
  balance_before: number | null;
  balance_after: number | null;
  /** `coalesce(category_override, the type's category)` (`0274`): what the
   *  summaries count the row as, except its fee lines (bank) and tax lines
   *  (tax). `category_override` is shown so the drawer can say the row was
   *  categorised by hand. */
  category: Category;
  category_override: Category | null;
  /** The project's public code, and the purchase orders the row's live
   *  allocations name — both on `v_transaction` since 0033/0139. */
  project_code: string | null;
  po_nos: string[];
  /** The project by name (`0280`, L7), for the ledger table's column and the
   *  drawer's facts. Null when the row names no project. */
  project_name: string | null;
  /** Set on every row `post_transfer` wrote in one act (`0282`, L15): the
   *  OUT, the IN and the fee of one movement between our own accounts. Null
   *  on rows posted any other way, old transfers included. */
  transfer_id: string | null;
}

/** One of the other rows of the same transfer, as the drawer lists them. A
 *  leg on an account the reader may not see is simply absent (D391). */
export interface TransferLeg {
  trx_no: string;
  account_code: string;
  direction: Direction;
  amount_idr: number;
  type_code: string;
  status: TrxStatus;
}

/** What `post_transfer` answers (`0282`, L15): the rows it wrote. */
export interface TransferPosted {
  transfer_id: string;
  from_account: string;
  to_account: string;
  amount: number;
  fee: number;
  trx_date: string;
  /** Each leg's own amount (0285): a leg on a non-rupiah account is in that
   *  currency, from `billed_amount`; a rupiah leg is `amount`. */
  out_amount?: number;
  in_amount?: number;
  out_trx_no: string;
  in_trx_no: string;
  fee_trx_no: string | null;
}

/** One allocation, with enough of the line to read it without a second call. */
export interface AllocationView extends PaymentAllocation {
  line_description: string | null;
  line_status: string | null;
  /** The line's current GOODS decision (`0280`, L7; `v_line_approval`, D28):
   *  who said yes, when, through which door, and for how much. All null when
   *  the allocation names a PO, the line was never decided, or the reader
   *  may not read procurement's approval trail. */
  approved: boolean | null;
  approved_amount: number | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_channel: "web" | "chat" | "sheet" | "script" | "api" | null;
}

/** Everything a ledger row is made of, in one call: what it bought, what it
 *  funded, and what proves it. */
export interface TransactionDetail extends TransactionView {
  lines: TransactionLine[];
  allocations: AllocationView[];
  /** The other legs of this row's transfer (`0282`); empty when the row is
   *  not part of one, or the other legs are on accounts the reader may not
   *  see. */
  transfer_legs: TransferLeg[];
  /** The bill's own currency and amount when it was not written in rupiah
   *  (a USD subscription paid from a rupiah account), beside `amount_idr`,
   *  which is what was paid. Both or neither; the rate is computed where it
   *  is shown, never stored (`0271`, D435). On the detail only: `v_transaction`
   *  does not carry them (the ledger table never shows them, D437), and
   *  `check-view-contracts` holds every field of a view's contract to the
   *  view's columns. */
  billed_currency: string | null;
  billed_amount: number | null;
  /** When and by whom the detail was last confirmed or rewritten through
   *  `set_transaction_lines` (`0273`, D434). Null = never reviewed. */
  lines_reviewed_at: string | null;
  lines_reviewed_by_name: string | null;
}

/** One ledger line with its row's number — `v_transaction_line` (`0273`),
 *  the ledger table's own read for the a/b rows under their parent (D437). */
export interface TransactionLineView extends TransactionLine {
  trx_no: string;
}

/** A row still to re-detail (`v_redetail_queue`, `0273`, D434): money out
 *  with a document, dated 2026, not yet stamped, and looking lumped. The
 *  three flags say why it is here; `is_ecommerce` says it gets at most three
 *  lines — listed price, discount, fee — never items (D435 point 5). */
export interface RedetailQueueRow {
  id: string;
  trx_no: string;
  trx_date: string;
  account_code: string;
  type_code: string;
  vendor_name: string | null;
  description: string;
  amount_idr: number;
  evidence_count: number;
  line_count: number;
  single_line: boolean;
  fee_tail: boolean;
  is_purchase: boolean;
  is_ecommerce: boolean;
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
export interface FundingRow {
  trx_no: string;
  trx_date: string;
  account_id: string;
  account_code: AccountCode;
  amount: number;
  description: string;
  /** Where it came from — the mirror row on the leadership account. */
  from_account_code: AccountCode | null;
  /** Balance on the receiving account the moment before it landed. Null on
   *  a row dated before `ledger_balance_from` (D429), where no balance is
   *  shown anywhere. */
  balance_before: number | null;
  /** Next transfer into the same account, or `null` while this is the current
   *  one — an open window is stated as open, never as finished. */
  next_funding_no: string | null;
  window_end: string | null;
  /** Everything that left the account inside the window, VOID excluded. */
  spent_total: number;
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
  /** The transfer's own proof, when one is attached. */
  proof_filename: string | null;
}

/** A funding as the list shows it: `v_funding` (`0274`) plus the one line
 *  under its life, written by `fundingHeadline` in whichever language the
 *  reader has on. */
export interface FundingView extends FundingRow {
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
  rows: FundingSpendRow[];
  by_type: FundingSpendGroup[];
  by_vendor: FundingSpendGroup[];
  by_project: FundingSpendGroup[];
}

/* ------------------------------------------------------------------ */
/* Ringkasan — month × category, per project, vendors, transfers (L9)  */
/* ------------------------------------------------------------------ */

/** `v_category_month` (`0274`): one row per month, direction and category.
 *  `trx_count` counts transactions; a row with a fee line counts once under its
 *  category and once under bank. */
export interface CategoryMonthRow {
  month: string;
  direction: Direction;
  category: Category;
  trx_count: number;
  amount: number;
}

/** `v_project_spend`: money out on a project, by month and category, with
 *  the contract value beside it when the project has one. */
export interface ProjectSpendRow {
  project_id: string;
  project_code: string;
  project_name: string;
  contract_value: number | null;
  month: string;
  category: Category;
  trx_count: number;
  amount: number;
  last_date: string;
}

/** `v_vendor_spend`: money out per vendor, by month and category. */
export interface VendorSpendRow {
  vendor_id: string;
  vendor_name: string | null;
  month: string;
  category: Category;
  trx_count: number;
  amount: number;
  last_date: string;
}

/** `v_transfer_month`: what left and what landed on each account as a
 *  transfer, per month. Nothing ties the two legs (F29): the difference
 *  across all accounts is money on the way, or a leg never booked. */
export interface TransferMonthRow {
  month: string;
  account_id: string;
  account_code: AccountCode;
  custody: AccountCustody;
  transfer_out: number | null;
  transfer_in: number | null;
  trx_count_out: number;
  trx_count_in: number;
}

/** *Masih aman berapa bulan* (L10, §6.9): cash on the accounting accounts
 *  against the average of the last three finished months of running cost.
 *  See `services/accounting/runway.ts` for what counts. */
export interface Runway {
  as_of: string;
  /** The three finished months the averages are taken over, oldest first. */
  months_used: string[];
  /** Average monthly running cost: payroll · fixed · overhead · bank · tax. */
  burn: number;
  burn_by: { category: Category; amount: number }[];
  /** Average monthly income (category `income`) over the same months. */
  income_avg: number;
  /** Balance of the accounting-custody accounts today. */
  cash: number;
  cash_accounts: { code: AccountCode; balance: number }[];
  /** cash ÷ burn, one decimal; null when there is no burn to divide by. */
  months_without_income: number | null;
  /** cash ÷ (burn − income); null when income covers the burn. */
  months_with_income: number | null;
}

/** One year of the four, read together for `/accounting/ringkasan`. */
export interface CategorySummary {
  year: string;
  months: CategoryMonthRow[];
  projects: ProjectSpendRow[];
  vendors: VendorSpendRow[];
  transfers: TransferMonthRow[];
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
export type CashAmountKind = "fixed" | "estimate";

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
  /** `fixed` must be met — less is PARTIAL. `estimate` is settled by whatever
   *  the matched payment came to, and the difference is shown (`0114`).
   *  Optional so fixtures written before it read as fixed. */
  amount_kind?: CashAmountKind;
  /** What created the line when nobody typed it — `asset:AST-0004` for an
   *  asset's rent (`0116`). */
  source_ref?: string | null;
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
  /** Fixed or a guess (`0114`). A paid estimate is PAID whatever it came to. */
  amount_kind?: CashAmountKind;
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
  /** Set on a line that is a subscription, not a calendar component (`0208`).
   *  Such a row has no ledger match — it is settled by the payment recorded
   *  on the subscription — and the grid sends a click on it to the register
   *  instead of the component editor. */
  subscription?: SubscriptionTag;
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
  /** `planned − actual`, floored at zero. What is still to go out. A paid
   *  estimate owes nothing, whatever it came to. */
  outstanding: number;
  amount_kind: CashAmountKind;
  /** `actual − planned` on a paid estimate: what the bill really came to
   *  against the guess. Null on a fixed line and on an estimate not yet paid. */
  variance: number | null;
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

/** What "Create payment schedule" on a rented asset made (`0116`). */
export interface AssetRentSchedule {
  asset_no: string;
  component_ids: string[];
  lines: number;
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


/* ------------------------------------------------------------------ */
/* Subscriptions (`0208`)                                              */
/* ------------------------------------------------------------------ */

/** How often it is billed. Yearly and every-two-years are what make the
 *  register more than a monthly list: one large charge in one month of the
 *  calendar, not a twelfth of it every month. */
export type SubscriptionCycle = "monthly" | "yearly" | "biennial";
/** `fixed` is a quoted price; `payg` is billed on use, so the figure is an
 *  expectation and whatever is charged settles it. */
export type SubscriptionPriceKind = "fixed" | "payg";
export type SubscriptionCurrency = "USD" | "IDR";
export type SubscriptionStatus = "active" | "paused" | "cancelled";

export interface Subscription {
  id: string;
  sub_no: string;
  name: string;
  provider: string | null;
  /** Who the service is registered to — where access is lost when a person
   *  leaves. */
  login_email: string | null;
  cycle: SubscriptionCycle;
  amount_kind: SubscriptionPriceKind;
  currency: SubscriptionCurrency;
  /** Per billing, in `currency`. */
  amount: number;
  /** A billing date. Monthly repeats its day; yearly its day and month; every
   *  two years its day and month in every second year. */
  start_on: string;
  ends_on: string | null;
  /** How it is paid: an account from master data. A label — the register
   *  never posts to the ledger. */
  account_id: string | null;
  status: SubscriptionStatus;
  note: string | null;
  created_by: string;
  created_at: string;
}

/** What was actually charged for one billing period. The rate is derived —
 *  rupiah ÷ dollars — so it is the rate the card really went at. */
export interface SubscriptionPayment {
  id: string;
  subscription_id: string;
  /** `YYYY-MM` of the date it fell due. */
  period: string;
  paid_on: string;
  amount_idr: number;
  amount_usd: number | null;
  fx_rate: number | null;
  /** The ledger row that settled it, when it was linked rather than typed
   *  (`0209`). Its amount and day are then the row's own, and the row is not
   *  also a payment nobody planned. */
  trx_no: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** What a calendar row says about the subscription behind it. */
export interface SubscriptionTag {
  subscription_id: string;
  sub_no: string;
  cycle: SubscriptionCycle;
  currency: SubscriptionCurrency;
  amount: number;
  amount_kind: SubscriptionPriceKind;
  usd_idr: number;
}

/** One subscription as the register draws it. */
export interface SubscriptionView extends Subscription {
  account_code: AccountCode | null;
  /** One billing, in rupiah at the plan rate (a rupiah subscription: itself). */
  planned_idr: number;
  /** What it costs in a year at the plan rate — the figure that makes a
   *  yearly and a monthly one comparable. */
  per_year_idr: number;
  /** The next billing that has not been paid yet, and what it is expected to
   *  be. Null when it is cancelled or has ended. */
  next_due: string | null;
  next_period: string | null;
  /** That billing's payment, if it has been recorded. */
  paid: SubscriptionPayment | null;
  /** Every payment on record, newest first. */
  payments: SubscriptionPayment[];
}

export interface SubscriptionRegister {
  /** The rate the plan converts dollars at. */
  usd_idr: number;
  subscriptions: SubscriptionView[];
  /** Σ of `per_year_idr` over the active ones, and a twelfth of it. */
  yearly_total: number;
  monthly_average: number;
}

export interface SubscriptionInput {
  name: string;
  cycle: SubscriptionCycle;
  amount_kind: SubscriptionPriceKind;
  currency: SubscriptionCurrency;
  amount: number;
  start_on: string;
  ends_on?: string | null;
  account_id?: string | null;
  provider?: string | null;
  login_email?: string | null;
  note?: string | null;
}

export interface SubscriptionPaymentInput {
  /** `YYYY-MM` */
  period: string;
  paid_on: string;
  amount_idr: number;
  amount_usd?: number | null;
  note?: string | null;
}


/* ------------------------------------------------------------------ */
/* Cashflow — leadership's weekly projection (`0239`, D392)            */
/* ------------------------------------------------------------------ */

/** What a cashflow line is, for grouping. The owner asked for two sections —
 *  cash in and cash out — and a list of forty lines with no grouping is not
 *  readable on a phone, so every line carries one of these. */
export type CashflowCategory =
  | "client"        // a client's termin, DP, pelunasan
  | "capital"       // owner's money, a loan drawn
  | "other_in"
  | "payroll"
  | "bills"         // the payment calendar's recurring bills
  | "subscription"  // the subscription register
  | "vendor"        // materials and vendors
  | "tax"
  | "loan"          // instalments, credit cards
  | "other_out";

export const CASHFLOW_IN_CATEGORIES: CashflowCategory[] = ["client", "capital", "other_in"];
export const CASHFLOW_OUT_CATEGORIES: CashflowCategory[] = [
  "payroll", "bills", "subscription", "vendor", "tax", "loan", "other_out",
];

/** One line of the cashflow, as stored.
 *
 *  Two kinds share the table, told apart by `source_ref`:
 *
 *  - **Mirrors a monthly bill** (`component:<uuid>` or `sub:<uuid>`): the
 *    schedule, the dates and the actual payments come from the payment
 *    calendar and the subscription register — the cashflow never keeps a
 *    second copy of a bill (D228). What it adds is the flexibility the owner
 *    asked for: `amount` replaces the calendar's figure *for the projection
 *    only*, `growth_pct` grows it month by month, `hidden` leaves it out. A
 *    bill with no row here is still in the cashflow, at the calendar's figure.
 *  - **The cashflow's own** (`source_ref` null): a client's termin, a tax
 *    payment, a loan instalment — things the calendar does not hold. Its
 *    schedule is its own and its actuals are the realisations recorded on it
 *    plus the ledger rows its category finds. */
export interface CashflowLine {
  id: string;
  source_ref: string | null;
  name: string;
  direction: Direction;
  category: CashflowCategory;
  /** Own lines only; a mirrored bill follows the calendar's dates. */
  frequency: CashFrequency | null;
  /** Per occurrence. On a mirrored bill, null follows the calendar. */
  amount: number | null;
  due_day: number | null;
  due_weekday: number | null;
  due_date: string | null;
  /** `YYYY-MM`, inclusive. */
  starts_on: string | null;
  ends_on: string | null;
  /** Percent per month, compounding from `growth_from` (`YYYY-MM`): 5 means
   *  each month is 5% more than the one before. Negative shrinks it. */
  growth_pct: number;
  growth_from: string | null;
  /** How the ledger finds what actually happened for an own line. */
  type_code: TransactionTypeCode | null;
  vendor_id: string | null;
  project_id: string | null;
  hidden: boolean;
  note: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
}

/** One week of one line, changed: `amount` is that week's total for the line,
 *  null is *not this week*. A week a line does not normally fall in can be
 *  given an amount too — a one-time extra is a fact about that week. */
export interface CashflowWeekOverride {
  id: string;
  line_id: string;
  /** The first day of the week, `YYYY-MM-DD`. */
  week_start: string;
  amount: number | null;
  reason: string;
  recorded_by: string;
  recorded_at: string;
}

/** Money that actually came in (or went out) against an own line, typed by
 *  leadership — because a client's transfer into the leadership account is
 *  not always in the ledger. With `trx_no` it *is* a ledger row, and that row
 *  is then never counted twice. */
export interface CashflowReceipt {
  id: string;
  line_id: string;
  on_date: string;
  amount: number;
  trx_no: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** A starting balance leadership typed for a month, because the ledger does
 *  not hold every account's every movement. It wins over the ledger's figure
 *  for that month and is shown beside it. */
export interface CashflowOpening {
  /** `YYYY-MM` */
  month: string;
  amount: number;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface CashflowSettings {
  /** The cash the company should never go under — the line between *aman*
   *  and *menipis*. */
  min_balance: number;
  /** Ledger categories that move money between the company's own accounts.
   *  They are neither cash in nor cash out for the company as a whole. */
  transfer_types: TransactionTypeCode[];
}

export type CashflowCellState =
  | "PAID" | "PARTIAL" | "OVERDUE" | "DUE" | "PLANNED" | "SKIPPED" | "NONE";

/** Weeks are cut inside the month — 1–7, 8–14, 15–21, 22 to the end — so a
 *  month is always four weeks and its closing balance is exactly the next
 *  month's opening (D392). */
export interface CashflowWeek {
  /** `YYYY-MM-DD` */
  start: string;
  end: string;
  month: string;
  /** 1–4 within its month. */
  n: number;
  is_past: boolean;
  is_current: boolean;
  in_planned: number;
  in_actual: number;
  out_planned: number;
  out_actual: number;
  /** Actuals no line claimed — part of `in_actual` / `out_actual`. */
  in_unplanned: number;
  out_unplanned: number;
  /** Unpaid bills from earlier weeks, carried into the current week so the
   *  balance does not pretend they went away. Zero everywhere else. */
  carried_out: number;
  /** What the balance walk used for this week: actual for a week that has
   *  ended, actual so far plus what is still to come for this week, the plan
   *  for a week ahead. */
  in_used: number;
  out_used: number;
  opening: number;
  closing: number;
  /** The plan alone, walked from the same opening — the figure to hold the
   *  actual against. */
  planned_closing: number;
}

export interface CashflowMonth {
  month: string;
  is_past: boolean;
  is_current: boolean;
  opening: number;
  in_planned: number;
  in_actual: number;
  out_planned: number;
  out_actual: number;
  in_used: number;
  out_used: number;
  closing: number;
  planned_closing: number;
  /** The lowest week-end balance in the month. */
  low_point: number;
}

export interface CashflowCell {
  week_start: string;
  planned: number;
  actual: number;
  state: CashflowCellState;
  /** Dates in the week this line falls due — the bill's *tanggal tagihan*. */
  dates: string[];
  overridden: boolean;
  reason: string | null;
  trx_nos: string[];
}

export type CashflowSource = "calendar" | "subscription" | "own";

export interface CashflowRow {
  /** The stored row, or for a bill nobody has adjusted, a line built from
   *  the calendar with `id` empty. */
  line: CashflowLine;
  /** `component:<uuid>` / `sub:<uuid>` / the line id. Stable across the two
   *  kinds — a screen keys on it. */
  key: string;
  source: CashflowSource;
  /** The calendar's own figure per occurrence, before the cashflow's change. */
  base_amount: number | null;
  /** How it repeats, for the label: `monthly` day, `weekly` weekday, `once`. */
  frequency: CashFrequency | null;
  due_day: number | null;
  due_weekday: number | null;
  due_date: string | null;
  account_code: AccountCode | null;
  vendor_name: string | null;
  project_code: string | null;
  cells: CashflowCell[];
  planned_total: number;
  actual_total: number;
  /** The next date it falls due from today, for the *tanggal tagihan* column. */
  next_due: string | null;
}

export interface CashflowOpeningView {
  month: string;
  /** What the ledger says every account held at the start of the month. */
  ledger: number;
  accounts: { code: AccountCode; custody: AccountCustody; currency: string; balance: number }[];
  typed: CashflowOpening | null;
  /** The figure the walk starts from: the typed one when there is one. */
  used: number;
}

export type CashflowVerdictState = "safe" | "thin" | "short";

export interface CashflowVerdict {
  state: CashflowVerdictState;
  /** The first week the balance goes under zero, from the current week on. */
  runs_out_week: string | null;
  short_by: number;
  /** The first week it goes under `min_balance`. */
  thin_week: string | null;
  lowest: number;
  lowest_week: string | null;
  /** Whole weeks from the current one until it runs out; null if it never does. */
  runway_weeks: number | null;
  /** Expected cash in that should have arrived and did not — not carried
   *  forward, because money not received is not assumed to arrive. */
  missed_in: number;
  carried_out: number;
}

/** The current month so far — is spending under or over what was planned. */
export interface CashflowBudget {
  month: string;
  /** Weeks of the month up to and including the current one. */
  in_planned: number;
  in_actual: number;
  out_planned: number;
  out_actual: number;
}

export interface Cashflow {
  generated_for: string;
  from_month: string;
  opening: CashflowOpeningView;
  settings: CashflowSettings;
  months: CashflowMonth[];
  weeks: CashflowWeek[];
  in_rows: CashflowRow[];
  out_rows: CashflowRow[];
  /** Monthly bills leadership left out of the cashflow, so they can be put
   *  back. Never silently gone. */
  hidden: { key: string; line_id: string; name: string; source: CashflowSource }[];
  /** Realisations recorded on own lines, newest first. */
  receipts: CashflowReceipt[];
  /** Per week, aligned with `weeks`: actuals no line claimed. */
  unplanned_in: { amount: number; trx_nos: string[] }[];
  unplanned_out: { amount: number; trx_nos: string[]; top_types: { type_code: string; amount: number }[] }[];
  verdict: CashflowVerdict;
  budget: CashflowBudget;
  /** Supplier balances with no date — no week can hold them (F30). */
  undated_obligations: number;
}

export interface CashflowLineInput {
  name: string;
  direction: Direction;
  category: CashflowCategory;
  frequency: CashFrequency;
  amount: number;
  due_day?: number | null;
  due_weekday?: number | null;
  due_date?: string | null;
  starts_on: string;
  ends_on?: string | null;
  growth_pct?: number;
  growth_from?: string | null;
  type_code?: TransactionTypeCode | null;
  vendor_id?: string | null;
  project_id?: string | null;
  note?: string | null;
}

/** The cashflow's change to a monthly bill. Nothing here touches the calendar:
 *  accounting's reminder keeps the bill as it is. */
export interface CashflowBillInput {
  source_ref: string;
  name: string;
  category: CashflowCategory;
  amount: number | null;
  growth_pct: number;
  growth_from: string | null;
  hidden: boolean;
  note?: string | null;
}
