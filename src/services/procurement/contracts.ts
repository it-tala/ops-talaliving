/** Procurement contracts — cut to `docs/plan/02-database.md`, schema `procure`.
 *
 *  Vocabulary here is copied verbatim from `00-context.md` §B. These strings
 *  are data, not prose: do not translate them, do not tidy the spelling.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** 18 units, exactly as the running system spells them. */
export const UNITS = [
  "pcs", "buah", "kg", "gr", "meter", "m2", "m3", "cm", "sak",
  "box", "roll", "set", "pack", "ltr", "lembar", "batang", "unit", "lusin",
] as const;
export type UomCode = (typeof UNITS)[number];

export type UomDimension = "count" | "mass" | "length" | "area" | "volume";
export type ItemKind = "goods" | "service";

export const PR_CATEGORIES = [
  "RAW MATERIAL", "MACHINING", "FINISHING", "SANDING", "PACKING", "OTHER",
] as const;
export type PrCategory = (typeof PR_CATEGORIES)[number];

export const FUND_CATEGORIES = [
  "PAYROLL", "RECURRING", "INVOICE", "TOPUP", "OFFICE", "WAREHOUSE", "OTHER",
] as const;

export type PrDocType = "PR" | "FUND";
export type PrDocStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "CLOSED" | "CANCELLED";

/** The one ladder (D28, D126). Seven values, resolved in the order given by
 *  `derive.lineStatus`.
 *
 *  `HELD` and `REJECTED` went first: an unchecked line stays in the queue
 *  exactly as HELD did, and an unwanted line is REMOVED.
 *
 *  `WAITING FOR PAYMENT` went next, and for a better reason than tidiness.
 *  It meant *approved, and the cash for it is in the paying account* — which
 *  was never true. Cash is fungible: money moved in for last week's approvals
 *  is spent on whatever gets paid first, so an older approval can find its
 *  funding gone and have to ask for it again. A status that says the money is
 *  waiting for this line is a promise the system cannot keep, so there is one
 *  value for both: **APPROVED — approved, not paid yet** (D126). */
export const LINE_STATUSES = [
  "DRAFT",
  "WAITING FOR APPROVAL",
  "APPROVED",
  "PAID",
  "PARTIAL",
  "COMPLETED",
  "REMOVED",
] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** No IT step (D20). */
export type ApprovalStep = "GOODS" | "FUNDS";
export type Channel = "web" | "chat" | "sheet" | "script" | "api";

export type RoundStatus = "OPEN" | "APPROVED" | "TRANSFERRED" | "CLOSED";

/** Seven conditions. Only GOOD, and the received part of PARTIALLY DAMAGED,
 *  count toward completion. The rest leave the line open (A18). */
export const RECEIPT_CONDITIONS = [
  "GOOD",
  "DAMAGED",
  "PARTIALLY DAMAGED",
  "MISSING PARTS",
  "WRONG ITEM",
  "RETURN TO SENDER",
  "WAITING FOR CONFIRMATION",
] as const;
export type ReceiptCondition = (typeof RECEIPT_CONDITIONS)[number];

export const COUNTING_CONDITIONS: ReceiptCondition[] = ["GOOD", "PARTIALLY DAMAGED"];
export const PROBLEM_CONDITIONS: ReceiptCondition[] = [
  "WRONG ITEM",
  "RETURN TO SENDER",
  "DAMAGED",
  "MISSING PARTS",
];

export type PoStatus = "DRAFT" | "ISSUED" | "CLOSED" | "CANCELLED";
export type PoPaymentState = "UNPAID" | "PARTIAL" | "SETTLED";
export type PoDeliveryState = "PENDING" | "PARTIAL" | "COMPLETE";
export type PoPaymentKind = "DP" | "PROGRESS" | "FINAL";
export type ScheduleBasis = "percent" | "amount";
export type DueRule = "on_issue" | "on_delivery" | "date";

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export interface Vendor {
  id: string;
  code: string;
  name: string;
  /** Spellings absorbed by a merge. They keep the extractor able to recognise
   *  what people actually write. */
  aka: string[];
  /** Set when this row was merged into another. The row is KEPT: every
   *  transaction that referenced it still does, so history does not move when
   *  a name is later corrected (D4). Readers follow the pointer. */
  merged_into?: string | null;
  /** false means RECORDED BUT NOT YET CURATED — visible in lists, absent from
   *  dropdowns. A name a human types is always accepted (owner, 2026-08-05). */
  is_curated: boolean;
  /** The company line. `pic_phone` is the person you actually call. */
  phone: string | null;
  address: string | null;
  /** Who to contact, by name. A vendor is a person before it is a company —
   *  "call Toko Amplas" is not an instruction anyone can follow. */
  pic_name: string | null;
  pic_phone: string | null;
  bank_account: string | null;
  /** Some vendors invoice from one account and collect on another. Paying into
   *  the wrong one is a week of chasing, so both are on record. */
  bank_account_secondary: string | null;
  npwp: string | null;
  /** What they say they supply. DECLARED, and therefore able to go stale — see
   *  `bought_categories` on the view for what we have actually bought. Useful
   *  precisely where history is silent: a vendor we have not ordered from yet. */
  supplied_categories: string[];
}

export interface Uom {
  code: UomCode;
  name: string;
  dimension: UomDimension;
}

export interface UomConversion {
  id: string;
  from_uom: UomCode;
  to_uom: UomCode;
  factor: number;
  /** null unless the conversion loses material — the wood chain lands here. */
  yield_ratio: number | null;
  note: string | null;
}

export interface ItemCategory {
  code: string;
  parent_code: string | null;
  name: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  aka: string[];
  merged_into?: string | null;
  category_code: string;
  base_uom: UomCode;
  kind: ItemKind;
  is_curated: boolean;
  /** Curated. Never written automatically. */
  standard_price: number | null;
  /** A hint, not a price list. Only ever moves forward in time. */
  last_price: number | null;
  last_vendor_id: string | null;
  last_purchased_at: string | null;
}

/** A project is the customer's order, and it is the dimension every other
 *  service hangs things on: procurement buys **for** it, production makes
 *  **for** it, the ledger spends **on** it (D149).
 *
 *  It lives here because it already did and because its **code** is what
 *  crosses every seam — `project_code` on a work order, `project_id` on a
 *  transaction. Who owns the table matters less than the code being stable,
 *  which is why the code is fixed once and never edited.
 */
export interface Project {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  /** Whose order it is. Blank for internal work — `STANDARD` is stock. */
  client_name: string | null;
  location: string | null;
  /** The person who answers for it inside the company. */
  pic: string | null;
  started_on: string | null;
  /** What was promised to the client. Not a production date — a work order
   *  carries its own, and they are allowed to differ. */
  target_date: string | null;
  /** The agreed order value, whole rupiah. **Not an invoice and not a
   *  quotation**: it is what the project is worth, for reading spend against.
   *  Null where nothing has been agreed yet (Q37). */
  contract_value: number | null;
  note: string | null;
}

/** One line of the customer's order: what they bought, and how many.
 *
 *  This is what makes a project an **order** rather than a label to tag
 *  spending with (D150). Everything downstream reads it: the workshop knows
 *  what to make, the board knows how much of it is done, and the difference
 *  between the two is the thing nobody could see before.
 *
 *  The product is carried as its **code**, at the seam — `production` owns the
 *  catalogue and this service never joins to it (ADR-004). A line whose code
 *  names nothing is shown as such rather than refused: an order can be typed
 *  the day it is signed, before anybody has drawn the thing (A6).
 */
export interface ProjectLine {
  id: string;
  project_id: string;
  line_no: number;
  /** `prod.products.product_code`. Null for something not in the catalogue —
   *  the description then carries it. */
  product_code: string | null;
  /** What the client's order says, in their words. */
  description: string;
  qty: number;
  uom: string;
  /** What it was sold for, per unit. Null where the order is priced as a lump
   *  sum and only `Project.contract_value` is known (Q37). */
  unit_price: number | null;
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* PR chain                                                            */
/* ------------------------------------------------------------------ */

/** A submission batch, not a subject.
 *
 *  A document records that these lines arrived together on a given day from a
 *  given person. It carries no purpose of its own, because a request can hold
 *  items for three different jobs from three different suppliers, and a single
 *  "purpose" on the container would have to be a lie about at least two of
 *  them (owner, 2026-09-11). What each item is for belongs to the item.
 */
export interface PrDocument {
  id: string;
  doc_no: string;
  doc_type: PrDocType;
  status: PrDocStatus;
  requested_by: string;
  project_id: string | null;
  created_at: string;
  submitted_at: string | null;
}

export interface PrLine {
  id: string;
  doc_id: string;
  line_no: number;
  /** `pr-26-09-10_01-L03` — generated, and what URLs and other systems use. */
  line_no_full: string;
  item_id: string | null;
  description: string;
  qty: number | null;
  uom: UomCode | null;
  unit_price: number | null;
  /** What was ASKED. Never zeroed to cancel a line (A5). */
  item_total: number;
  vendor_id: string | null;
  po_line_id: string | null;
  category: PrCategory | null;
  /** What this item is FOR, in the requester's words. The single most useful
   *  field on the line for whoever has to approve it: "2 pail lem putih" is a
   *  cost, "2 pail lem putih — laminating meja HOTEL UBUD" is a decision. */
  purpose: string | null;
  need_by: string | null;
  /** The work order whose bill of material produced this line (D151).
   *
   *  This is what closes the loop the owner asked for: a BOM says what a piece
   *  *should* cost in materials, and a PR raised from it is what somebody
   *  actually went out and bought. With the SPK number on the line, projected
   *  and actual are two sums over the same set of rows rather than two numbers
   *  nobody can reconcile. Null for everything raised the ordinary way. */
  source_wo_no: string | null;
  /** Removal is soft and audited (D29). Refused once money has reached it. */
  removed_at: string | null;
  removed_by: string | null;
}

/** A checkbox, not a vocabulary (D28). Append-only: every toggle is a row, so
 *  "approved 14:02, un-approved 14:09" stays legible. */
export interface PrApproval {
  id: string;
  line_id: string;
  step: ApprovalStep;
  approved: boolean;
  approved_qty: number | null;
  /** May be reduced below what was requested, never raised (A8). */
  approved_amount: number | null;
  recorded_by: string;
  recorded_by_email: string;
  recorded_at: string;
  channel: Channel;
}

/** Leadership's own words on a line, kept apart from the decision.
 *
 *  Two fields, because they are two different acts. `instructions` is
 *  something the requester is expected to DO — "negotiate first", "buy the
 *  smaller pack", "use the Denpasar supplier this time". `remark` is a note
 *  for the record — why the amount was cut, what to watch next month.
 *
 *  They are not columns on the approval row on purpose: a note can be left on
 *  a line nobody has decided yet, which is exactly when "get another quote"
 *  is worth saying. Append-only, like every other statement here.
 */
export interface LineNote {
  id: string;
  line_id: string;
  instructions: string | null;
  remark: string | null;
  recorded_by: string;
  recorded_by_email: string;
  recorded_at: string;
}

/** An approval asked for through a channel that knows who answers.
 *
 *  The problem this exists for: a leadership meeting runs on whoever's laptop
 *  is open. If procurement ticks the box while the CEO says yes across the
 *  table, the record says procurement approved it — which is false, and it is
 *  false in the one place the whole system is supposed to be trustworthy.
 *
 *  So the yes leaves the room: the line is sent to the approver in Google
 *  Chat, they answer there, and the identity on the record comes from the
 *  chat platform's own authentication rather than from whoever is logged in
 *  here (D69). The metadata then reads what actually happened —
 *  `chat · evin@talaliving.com · 14:00`.
 *
 *  `token` identifies the REQUEST, never the person. In Phase 2 the answer
 *  arrives as a signed webhook from Google and the identity comes from that
 *  signature; a token that carried an identity would be a password anybody
 *  who saw the card could reuse.
 */
export interface ApprovalRequest {
  id: string;
  line_id: string;
  /** The send this line went out in. Approval is asked for in batches because
   *  that is how a meeting works — a list, a total, and one answer session
   *  (D70). */
  batch_id: string;
  token: string;
  /** Whose yes this is. The request is addressed, not broadcast. */
  sent_to: string;
  sent_to_email: string;
  /** Whoever pressed send — usually not the approver. Kept because "who
   *  chased this" is a different question from "who decided it". */
  sent_by: string;
  sent_by_email: string;
  sent_at: string;
  channel: Channel;
  /** What the room said about this item when it was sent.
   *
   *  Not leadership's instruction — that is a `LineNote`, and it can only be
   *  written by whoever holds the authority (D64). This is the meeting's own
   *  words travelling with the question, so the approver reading it on a phone
   *  has the context the room had. It prefills their instruction field; if
   *  they send it back unchanged it becomes theirs, deliberately and visibly
   *  (D127). */
  meeting_note: string | null;
  answered_at: string | null;
  outcome: "approved" | "declined" | null;
}

/** One card as the approver sees it in chat: the line, and enough of it to
 *  decide without opening anything. */
export interface ApprovalRequestView extends ApprovalRequest {
  line_no_full: string;
  description: string;
  purpose: string | null;
  qty: number | null;
  uom: UomCode | null;
  unit_price: number | null;
  item_total: number;
  vendor_name: string | null;
  requested_by_name: string;
  project_code: string | null;
  /** True once the line has been decided by any route — the card is stale and
   *  the screen says so rather than offering a button that will 409. */
  line_decided: boolean;
  /** What the approver settled on, once they have. */
  approved_amount: number | null;
  /** Approved minus what has already reached this line. The number that has
   *  to leave the bank if this is said yes to — not the same as the amount
   *  approved, because part of it may already have been paid. */
  to_pay: number;
}

/** One transfer into the paying account against one round.
 *
 *  A round is funded in parts more often than not — leadership sends half on
 *  Monday and the rest when a client pays — so the record is a list, not a
 *  single amount. Each instalment carries its own proof, because each is its
 *  own claim about the bank (D80, D82).
 */
export interface RoundTransfer {
  id: string;
  round_id: string;
  amount: number;
  trx_no: string;
  proof_attachment_id: string;
  recorded_by: string;
  recorded_by_email: string;
  recorded_at: string;
}

/** One send: the list, and the three totals a person needs to answer it.
 *
 *  A card per line would ask the approver to add up fifteen numbers in their
 *  head to know what they have just committed the company to. The batch says
 *  it: this much asked, this much approved so far, this much has to be paid
 *  (D70).
 */
export interface ApprovalBatch {
  id: string;
  batch_no: string;
  token: string;
  sent_to: string;
  sent_to_email: string;
  sent_by: string;
  sent_by_email: string;
  sent_at: string;
  channel: Channel;
}

export interface ApprovalBatchView extends ApprovalBatch {
  items: ApprovalRequestView[];
  /** Every item as asked. */
  requested_total: number;
  /** Only the ones said yes to. */
  approved_total: number;
  /** Approved, minus whatever already reached those lines. */
  to_pay_total: number;
  answered: number;
  pending: number;
}

export interface PaymentRound {
  id: string;
  round_no: string;
  status: RoundStatus;
  opened_at: string;
  approved_by: string | null;
  approved_at: string | null;
  /* What was transferred does not live here: a round is funded in as many
   * instalments as it takes, so the record is the list of them (D82). */
  closed_by: string | null;
  closed_at: string | null;
}

export interface PaymentRoundLine {
  id: string;
  round_id: string;
  line_id: string;
  /** Frozen when the round is approved — the record of a decision. */
  requested_amount: number;
}

/** Reported, or confirmed.
 *
 *  Goods from outside arrive when they arrive — often at night, when the
 *  people with the app open are asleep. Whoever is there can say *it came*,
 *  with a photograph; the signed tanda terima follows in the morning, from
 *  procurement, who are accountable for it (D131).
 *
 *  Only a `CONFIRMED` receipt counts as value received. That is the whole
 *  point of the split: an arrival nobody has acknowledged in writing is a fact
 *  worth recording and not yet a thing we owe for.
 */
export type ReceiptStatus = "REPORTED" | "CONFIRMED";

export interface Receipt {
  id: string;
  receipt_no: string;
  /** Exactly one of these two is set. */
  line_id: string | null;
  po_line_id: string | null;
  qty_received: number;
  condition: ReceiptCondition;
  received_by: string;
  received_at: string;
  qc_by: string | null;
  note: string | null;
  status: ReceiptStatus;
  /** Who completed it, and when. Null while it is only reported. */
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface LineSettlement {
  id: string;
  line_id: string;
  shortfall: number;
  /** Mandatory. A named human decision, never a silent tolerance (A12). */
  reason: string;
  decided_by: string;
  decided_at: string;
}

/* ------------------------------------------------------------------ */
/* PO                                                                  */
/* ------------------------------------------------------------------ */

export interface PurchaseOrder {
  id: string;
  po_no: string;
  vendor_id: string;
  status: PoStatus;
  created_at: string;
  issued_at: string | null;
  issued_by: string | null;
  note: string | null;
  /** When the vendor said it would arrive. The date we agreed, not a rule
   *  that derives one — and the only thing that makes a delivery *late*
   *  rather than merely absent (D134). */
  expected_delivery: string | null;
  /** Leadership's yes on the order itself.
   *
   *  An order is a promise to a supplier in the company's name, so it is
   *  confirmed before it is sent, not after (D132). `asked_at` is when the
   *  question went out; the decision is the pair below it. */
  approval_asked_at: string | null;
  approval_asked_by: string | null;
  /** Who the question went to, and the token that lets them answer it from
   *  chat **as themselves** (D267). Same rule as a request batch (D69): the
   *  decision is recorded against the account that answered, never against
   *  whoever's laptop the meeting is running on. */
  approval_sent_to: string | null;
  approval_token: string | null;
  approved_at: string | null;
  approved_by: string | null;
  /** What leadership said when they confirmed it, if anything. */
  approval_note: string | null;
  /** True where the person who created the order **already held**
   *  `approve_goods`, so it was confirmed in the same act (D267).
   *
   *  Recorded rather than inferred. *Approved by Evin* and *created and
   *  approved by Evin in one act* are different facts about how a decision was
   *  taken, and the second one is the one an auditor asks about — deriving it
   *  later from `created_by === approved_by` would be a guess about history. */
  self_confirmed: boolean;
  /** Bumped every time an issued order is amended. The vendor holds a piece of
   *  paper; this is what lets two of them be told apart (D135). */
  revision: number;
  /** The revision the vendor has actually been sent. Behind `revision` means
   *  the paper in their hand is out of date. */
  sent_revision: number;
}

export interface PoLine {
  id: string;
  po_id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  qty: number;
  uom: UomCode;
  unit_price: number;
  line_total: number;
  superseded_by: string | null;
}

export interface PoScheduleTerm {
  id: string;
  po_id: string;
  term_no: string;
  kind: PoPaymentKind;
  basis: ScheduleBasis;
  basis_value: number;
  due_rule: DueRule;
  due_date: string | null;
}

/* ------------------------------------------------------------------ */
/* Derived views — computed on read, never stored (A3)                 */
/* ------------------------------------------------------------------ */

export interface LineCoverage {
  line_id: string;
  approved: number;
  covered: number;
  remaining: number;
  settled: boolean;
}

export interface PoStatusView {
  po_id: string;
  contract_value: number;
  paid_to_date: number;
  outstanding: number;
  value_received: number;
  /** paid − received. Positive means we are carrying the vendor's risk. */
  exposure: number;
  payment_state: PoPaymentState;
  delivery_state: PoDeliveryState;
}

/** One PO line, as the vendor journey reads it: what was ordered, what has
 *  arrived, and in what condition. */
export interface PoLineJourney {
  po_line_id: string;
  /** Its number on the order — what an amendment addresses, and what a vendor
   *  says on the phone. */
  line_no: number;
  description: string;
  qty: number;
  uom: UomCode;
  unit_price: number;
  line_total: number;
  received: number;
  /** Arrived and reported, with no signed tanda terima yet. Never part of
   *  `received`, and worth looking at every morning (D131). */
  reported: number;
  /** received − ordered when the vendor sent more than was asked for. Kept
   *  visible rather than trimmed: two extra sheets are a credit, not a
   *  rounding error (D98). */
  over: number;
  condition: "GOOD" | "OVER" | "NOT ARRIVED" | "PARTIAL" | "PROBLEM";
  receipts: {
    receipt_no: string;
    qty: number;
    condition: ReceiptCondition;
    at: string;
    /** Who took delivery, and who checked it — two people, or the same one
     *  named twice. A delivery accepted and checked by nobody in particular is
     *  the one nobody can ask about later (D101). */
    by: string;
    qc_by: string;
    note: string | null;
    /** Both halves of the evidence, tracked separately: the photo of what
     *  arrived, and the signed tanda terima.
     *
     *  These are **ids, not booleans** (D268). They were booleans, and a chip
     *  reading *photo of the goods* that nobody could open was a label about
     *  evidence rather than a way to the evidence (B2) — which is the same
     *  failure B3 found on the verification queue. Presence is derived from
     *  the id at the point it is rendered, so the chip and the link can never
     *  disagree about whether there is a file. */
    photo_attachment_id: string | null;
    delivery_note_attachment_id: string | null;
    status: ReceiptStatus;
  }[];
}

/** One order, with both axes: what was paid and what arrived, never merged. */
export interface PoJourney {
  po_no: string;
  status: PoStatus;
  issued_at: string | null;
  note: string | null;
  dp_percent: number | null;
  contract_value: number;
  paid: number;
  value_received: number;
  /** What could honestly be invoiced today: the deposit share once the order
   *  is issued, plus the delivered share of everything else, minus what has
   *  already been paid. Never negative — an overpayment is a different
   *  conversation, and this number's only job is "what is safe to ask for
   *  next" (D99). */
  billable_now: number;
  /** Priced over-delivery: what the vendor sent beyond the order. A credit
   *  with them, never billable and never ours to spend (D98). */
  credit: number;
  payment_state: PoPaymentState;
  delivery_state: PoDeliveryState;
  lines: PoLineJourney[];
}

/** Everything one vendor has going with us, in one block.
 *
 *  The question this answers is the one nobody could answer from the sheet:
 *  *where are we with this supplier* — how much is contracted, how much has
 *  been paid, what has actually arrived, and what they could invoice next. A
 *  vendor with three open orders and one transfer covering all three cannot be
 *  read order by order (D97).
 */
export interface VendorJourney {
  vendor_id: string;
  vendor_name: string;
  orders: number;
  contract_value: number;
  paid: number;
  outstanding: number;
  value_received: number;
  billable_now: number;
  credit: number;
  /** One sentence a person can act on, rather than four numbers to compare. */
  headline: string;
  pos: PoJourney[];
}

export interface RoundSummary {
  round_id: string;
  round_no: string;
  status: RoundStatus;
  requested_total: number;
  /** Every instalment that has landed, and what they add up to. A funded
   *  round still pays nobody (A10). */
  transfers: RoundTransfer[];
  transferred_total: number;
  /** Requested, less what has actually been transferred in. Zero once the
   *  round is fully funded; positive while instalments are still owed. */
  transfer_shortfall: number;
  paying_balance: number;
  to_transfer: number;
  remaining_after_payment: number;
  line_count: number;
}

/** What the approval queue and the PR list hand a screen: the line, plus
 *  everything derived from it, in one object so nothing is recomputed twice. */
/** The four states a leadership meeting sorts by — and the reason the middle
 *  two are kept apart rather than merged into "in progress".
 *
 *  `paid_unapproved` is the one that matters: money left before anyone said
 *  yes. Folding it in with the others is precisely how that used to stay
 *  invisible (A1, and the recap's own meeting board).
 */
export type MeetingState =
  | "settled"          // approved and paid
  | "approved_unpaid"  // said yes, money has not moved
  | "paid_unapproved"  // money moved, nobody said yes
  | "neither";         // still just a request

export const MEETING_STATE_LABEL: Record<MeetingState, string> = {
  /* "Approved and paid", not "Settled": the quadrant answers two questions and
     neither of them is whether the line is finished. A line can be approved
     and paid and still be Rp 580.000 short. */
  settled: "Approved and paid",
  approved_unpaid: "Approved, not paid",
  paid_unapproved: "Paid, not approved",
  neither: "Waiting for approval",
};

/** Why the money that moved is not the money that was approved.
 *
 *  A closed list rather than free text, for one reason: a single Rp 200,000
 *  difference is noise, and no application can tell you whether it was a typo
 *  or carelessness. Twelve of them tagged `price_changed` against the same
 *  vendor is a supplier who quotes badly; six tagged `input_error` from the
 *  same person is a training problem. The app cannot judge one event — it can
 *  count the kinds, and that is what makes the question answerable.
 */
export const VARIANCE_REASONS = [
  "price_changed",
  "quantity_changed",
  "rounding",
  "input_error",
  "partial_payment",
  "overpaid",
  "other",
] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

export const VARIANCE_REASON_LABEL: Record<VarianceReason, string> = {
  price_changed: "Vendor price differed from the quote",
  quantity_changed: "A different quantity was taken",
  rounding: "Transfer was rounded",
  input_error: "An amount was entered wrongly",
  partial_payment: "Paid in parts — more to come",
  overpaid: "Overpaid — the vendor owes us",
  other: "Something else",
};

/** Append-only. An explanation is a statement somebody made on a date, and
 *  correcting it means making a new one, not editing the old. */
export interface LineVariance {
  id: string;
  line_id: string;
  reason: VarianceReason;
  note: string | null;
  /** The gap at the moment it was explained — kept, so a later payment does
   *  not silently rewrite what was being explained. */
  amount_at_time: number;
  recorded_by: string;
  recorded_by_email: string;
  recorded_at: string;
}

export type VarianceKind = "none" | "under" | "over";

export interface VarianceView {
  requested: number;
  approved: number;
  paid: number;
  /** paid − approved. Negative means less money moved than was authorised. */
  delta: number;
  kind: VarianceKind;
  /** Below the rounding tolerance this is not a variance, it is arithmetic. */
  material: boolean;
  explanation: LineVariance | null;
}

/** One purchase fact, from wherever it can be found. The single derivation
 *  behind both directions of the question: what do we buy from this vendor,
 *  and who do we buy this item from. */
export interface PurchaseFact {
  item_id: string;
  item_name: string;
  category_code: string;
  vendor_id: string;
  vendor_name: string;
  unit_price: number | null;
  uom: string | null;
  date: string;
  source: "pr" | "ledger";
}

export interface CategoryCount {
  code: string;
  name: string;
  count: number;
}

export interface VendorItemSummary {
  item_id: string;
  item_name: string;
  last_price: number | null;
  uom: string | null;
  last_date: string;
  times: number;
}

/** A vendor with what we have actually bought from it. */
export interface VendorView extends Vendor {
  /** `supplied_categories` resolved to their display names. */
  supplied_category_names: string[];
  transaction_count: number;
  total_spend: number;
  last_purchase: string | null;
  open_pr_lines: number;
  absorbed: Vendor[];
  /** Derived from purchase history, so it cannot go stale. */
  bought_categories: CategoryCount[];
  items_bought: VendorItemSummary[];
}

/** Who we buy an item from, newest first. This is the answer to "we need
 *  thinner — where do we get it?", and it is derived rather than maintained. */
export interface ItemSource {
  vendor_id: string;
  vendor_name: string;
  is_curated: boolean;
  pic_name: string | null;
  pic_phone: string | null;
  last_price: number | null;
  uom: string | null;
  last_date: string;
  times: number;
}

export interface ItemView extends Item {
  category_name: string;
  last_vendor_name: string | null;
  sourced_from: ItemSource[];
  /** What a form would prefill: the curated price if there is one, otherwise
   *  the last price paid. A hint, never a price list. */
  suggested_price: number | null;
  purchase_count: number;
}

export interface PrLineView extends PrLine {
  status: LineStatus;
  meeting_state: MeetingState;
  requested_by_name: string;
  project_code: string | null;
  submitted_at: string | null;
  evidence_count: number;
  has_payment_proof: boolean;
  /** Does anything stand behind this request — a shop link, an invoice, a
   *  bill, an order? Nobody should be asked to approve a number with nothing
   *  behind it (D125). */
  has_support: boolean;
  variance: VarianceView;
  /** The latest word from leadership, if there is one. */
  note: LineNote | null;
  /** Sent to the approver and not answered yet. */
  pending_request: ApprovalRequest | null;
  /** The ledger rows that funded this line, by public id. */
  trx_nos: string[];
  /** The payment round this line sits in, and what state that round is in.
   *
   *  This is the **only** thing separating `APPROVED` from `WAITING FOR
   *  PAYMENT`: both mean approved and unpaid, and the second one adds that the
   *  cash for it has been approved or already moved into the paying account. A
   *  screen showing both statuses has to show this too, or it prints two
   *  different words for what reads as one meaning (D123). */
  round_no: string | null;
  round_status: PaymentRound["status"] | null;
  coverage: LineCoverage;
  approval: PrApproval | null;
  doc_no: string;
  vendor_name: string | null;
  item_name: string | null;
  received_qty: number;
  has_problem_receipt: boolean;
}

/* ------------------------------------------------------------------ */
/* PO — the order as an obligation                                     */
/* ------------------------------------------------------------------ */

/** Where one payment term stands.
 *
 *  A term is not a bill. It is a **trigger plus a share**: 30% on issue, the
 *  rest on delivery. So its state has two halves — has the trigger fired, and
 *  has the money that reached this order already covered the terms before it.
 *
 *  Coverage runs in order, oldest term first, because that is how the money
 *  was meant to be applied and because nothing in a bank transfer says which
 *  term it was for. A term whose trigger has fired but whose predecessors are
 *  unpaid is `BLOCKED` and says which one is holding it — the guard the old
 *  system never had, and the reason somebody once paid a final instalment on
 *  an order whose deposit had never gone out (D128).
 */
export type PoTermState =
  | "PAID"        // covered in full
  | "PARTIAL"     // some of it covered
  | "PAYABLE"     // the trigger has fired, everything before it is covered
  | "BLOCKED"     // the trigger has fired, an earlier term has not been paid
  | "NOT DUE";    // the trigger has not fired

export interface PoTermView {
  term_no: string;
  kind: PoPaymentKind;
  basis: ScheduleBasis;
  basis_value: number;
  due_rule: DueRule;
  due_date: string | null;
  /** What the term is worth against the current contract value. */
  amount: number;
  /** How much of the money that reached this order lands on this term. */
  covered: number;
  state: PoTermState;
  /** The term holding this one up, when `BLOCKED`. */
  blocked_by: string | null;
  /** Why the trigger has or has not fired, in words. */
  trigger: string;
  /** The date this term is expected to fall due — the owner's answer to Q26
   *  (D234): **jatuh tempo adalah tanggal ekspektasi pengiriman**. An
   *  `on_delivery` term that nothing has arrived against still has a date
   *  somebody can plan cash around, and that date is the delivery the vendor
   *  promised. Null where no promise exists: a term with no expected delivery
   *  date is undated, not due today. */
  expected_on: string | null;
  /** Where `expected_on` came from. `fired` is the day the thing actually
   *  happened — the order went out, the goods landed. `expected` is the
   *  vendor's promise and can still move, so a screen must mark it. `stated`
   *  is a term written with a fixed date in the contract, which is neither a
   *  promise nor an event and is already printed in `trigger`. A screen must
   *  be able to tell the three apart; rendering them alike would put a guess
   *  and a fact in one column in one font. */
  expected_basis: "fired" | "expected" | "stated" | null;
}

export interface PoDocument {
  attachment_id: string;
  filename: string;
  url: string | null;
  kind: string;
  linked_at: string;
}

/** Everything about one order, in one call — a drawer that needs three is a
 *  drawer that renders in three stages. */
/** A purchase order waiting for leadership's yes, as the chat card sees it
 *  (D267). The shape mirrors an approval batch deliberately: it is the same
 *  question arriving by the same road, and a second shape for it would be a
 *  second thing to keep right. */
export interface PoApprovalView {
  po_no: string;
  vendor_name: string;
  vendor_pic: string | null;
  contract_value: number;
  line_count: number;
  expected_delivery: string | null;
  project_codes: string[];
  asked_at: string;
  asked_by_email: string;
  sent_to_email: string;
  token: string;
  answered: boolean;
}

export interface PoDetail {
  po_no: string;
  vendor_id: string;
  vendor_name: string;
  /** Who to send the order to, and on what number. */
  vendor_pic: string | null;
  vendor_phone: string | null;
  status: PoStatus;
  expected_delivery: string | null;
  /** Days late, once everything was supposed to be here and is not. */
  days_late: number | null;
  revision: number;
  sent_revision: number;
  approval_asked_at: string | null;
  approval_asked_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  /** Which of the two roads this confirmation came down (D267): written and
   *  confirmed in one act by somebody who already held the authority, or asked
   *  for and answered from the approver's own account. */
  self_confirmed: boolean;
  /** Who the question went to, where it went out at all. */
  approval_sent_to: string | null;
  approval_note: string | null;
  note: string | null;
  created_at: string;
  issued_at: string | null;
  issued_by_name: string | null;
  lines: PoLineJourney[];
  terms: PoTermView[];
  /** The share of the contract that may be asked for right now: the terms that
   *  are `PAYABLE`, less what has already been paid against them. */
  payable_now: number;
  /** Superseded lines, newest first — what this order used to say (D129). */
  amendments: {
    line_no: number;
    from: string;
    to: string;
    at: string;
  }[];
  payments: { trx_no: string; trx_date: string; amount: number; description: string }[];
  documents: PoDocument[];
  status_view: PoStatusView;
  /** Why this order cannot be closed yet, empty when it can. */
  close_blockers: string[];
}
