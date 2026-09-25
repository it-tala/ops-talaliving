/** Production contracts — cut to `docs/plan/02-database.md`, schema `prod`.
 *
 *  A seventh service (D148). It exists because of a question the owner asked
 *  about a piece of paper: the *surat lembur produksi* is one sheet with many
 *  names on it, and against each name is **what they worked on, how far it
 *  got, and how many**. That is not a payroll fact. It is a production fact
 *  that a payroll document happens to carry — and the moment somebody writes
 *  it down twice, the two copies start to disagree.
 *
 *  So production owns the work: what is being made, for whom, by when, and
 *  which stage it has reached. The overtime sheet references it, the same way
 *  a payment references a request line — by public number, validated at the
 *  seam, never by reaching into another service's tables (ADR-004).
 */

/** The stages a piece goes through, in order.
 *
 *  Seeded rather than typed by somebody, so that "which stage is it in" has
 *  the same answer on every screen and in every report. Changing the list is a
 *  seed edit, not a schema change, which is exactly why it is data.
 *
 *  **Four, down from seven** (D253). The owner's answer to Q35 was
 *  *sederhanakan, karena ada item yang dilempar ke vendor dan kita tinggal
 *  finishing dan packing* — and the second half of that sentence is what
 *  decided the shape of the first. Seven stages could only describe a
 *  subcontracted piece as *four stages mysteriously skipped*; four stages, with
 *  the making of the piece as **one** of them, describe it as what it is: a
 *  different route through the same workshop, one stage shorter.
 *
 *  The collapsed detail is not thrown away — see `LEGACY_STAGES`.
 */
export interface ProcessStage {
  code: string;
  name: string;
  /** 1-based. A piece cannot be finished before it is built, and the order is
   *  what makes that checkable. */
  seq: number;
  /** What the workshop actually does inside it, for the screen. Not stages:
   *  nobody reports against these, they are here so *Pembuatan* is not a word
   *  somebody has to interpret. */
  covers: string;
}

/** The owner's own four, named by him when Q47 asked whether ours were right
 *  (D275): *sanding/amplas — finishing — machinery / instalasi lampu, kabel dan
 *  sebagainya — packing*.
 *
 *  Two of ours are not in his list and that is the substance of the answer,
 *  not an omission to paper over.
 *
 *  **Pembuatan is gone**, and Q48 says why: the business buys *barang mentah*
 *  from a vendor. The rough piece arrives already cut and assembled, so the
 *  first thing that happens to it in this building is sanding. Ours started
 *  with a stage the workshop does not do.
 *
 *  **QC is gone too**, and unlike Pembuatan nothing in his answers explains
 *  it — so the board keeps his four and the question of whether checking is a
 *  step of its own is asked again as Q51 rather than decided here. Old `QC`
 *  entries are not orphaned meanwhile: they roll into Packing, which is the
 *  step they always immediately preceded.
 */
export const PROCESS_STAGES: ProcessStage[] = [
  { code: "AMPLAS", name: "Sanding / amplas", seq: 1, covers: "menghaluskan barang mentah dari vendor" },
  { code: "FINISHING", name: "Finishing", seq: 2, covers: "cat · coating · politur" },
  { code: "MACHINERY", name: "Machinery / instalasi", seq: 3, covers: "lampu, kabel, rel, mekanisme" },
  { code: "PACKING", name: "Packing", seq: 4, covers: "bungkus, siap kirim" },
];

/** Every stage code that counts towards each of the four, old and new.
 *
 *  Progress already recorded **keeps its own stage code** — that was the
 *  condition attached to Q35 from the day it was asked, and it is the ordinary
 *  rule here anyway: nothing that happened is rewritten (A5). So the old codes
 *  stay in the data and are rolled up on read.
 *
 *  Two things about the roll-up, and the second one is the trap.
 *
 *  **It is a minimum, not a sum.** Four chairs cut, four planed and four
 *  assembled is four chairs made, not twelve. A piece has finished *Pembuatan*
 *  when it has finished every step inside it, so the count is the smallest of
 *  the steps that were actually recorded.
 *
 *  **A stage is a source of itself.** `FINISHING` is the name of one of the
 *  four *and* the name of one of the seven that collapsed into it, so an entry
 *  reading `FINISHING` cannot be told apart from a new one — and adding "the
 *  direct entries" to "the rolled-up ones" counted the same pieces twice, as
 *  amplas 4 + finishing 3 = 7 of an order for 4 (F74). Listing every source,
 *  the stage's own code included, removes the distinction rather than trying
 *  to guess it.
 */
export const STAGE_SOURCES: Record<string, { code: string; name: string }[]> = {
  /* Amplas is a stage of its own now (D275), so it is no longer a source of
     Finishing — and every historical entry that reads `AMPLAS` lands here,
     which is where its work always actually was. */
  AMPLAS: [{ code: "AMPLAS", name: "Amplas" }],
  FINISHING: [{ code: "FINISHING", name: "Finishing" }],
  MACHINERY: [{ code: "MACHINERY", name: "Machinery / instalasi" }],
  /* `QC` is not one of the owner's four, and its old entries must not vanish
     — a stage disappearing from the list is not the same as the work never
     having happened (A5). They roll into Packing, the step they always came
     immediately before, and `LEGACY_STAGES` keeps the word itself readable. */
  PACKING: [
    { code: "QC", name: "QC" },
    { code: "PACKING", name: "Packing" },
  ],
};

/** Stage codes that were once part of the route and are no longer.
 *
 *  Not a roll-up target: `POTONG`, `SERUT` and `RAKIT` are work the business
 *  now buys in as *barang mentah*, and folding them into Sanding would claim
 *  that six pieces were sanded because six were cut. They keep their names so
 *  a work order from August still reads correctly, and they sit **outside**
 *  the four rather than inside one of them (D275). */
export const RETIRED_STAGES: { code: string; name: string }[] = [
  { code: "POTONG", name: "Potong" },
  { code: "SERUT", name: "Serut / bentuk" },
  { code: "RAKIT", name: "Rakit" },
  { code: "PEMBUATAN", name: "Pembuatan" },
];

const ALL_SOURCES = [...Object.values(STAGE_SOURCES).flat(), ...RETIRED_STAGES];

export const STAGE_NAME = (code: string) =>
  PROCESS_STAGES.find((s) => s.code === code)?.name
  ?? ALL_SOURCES.find((s) => s.code === code)?.name
  ?? code;

/** How a piece gets made.
 *
 *  A route is a **list of stages**, not a flag, because the thing that differs
 *  between them is exactly which stages apply. A subcontracted order does not
 *  have *Pembuatan at 0%* — it does not have Pembuatan. Rendering a stage that
 *  is not on the route as an empty bar would say *nobody has started building
 *  this*, which is false about goods a vendor has already built (D254).
 */
export type RouteCode = "IN_HOUSE" | "SUBCON";

export interface ProductionRoute {
  code: RouteCode;
  name: string;
  /** Said in the workshop's own terms, for the picker. */
  description: string;
  stages: string[];
}

export const ROUTES: ProductionRoute[] = [
  {
    code: "IN_HOUSE",
    name: "Dikerjakan sendiri",
    description: "Barang mentah dihaluskan, difinishing, dipasangi kelengkapannya, lalu dibungkus di bengkel sendiri.",
    stages: ["AMPLAS", "FINISHING", "MACHINERY", "PACKING"],
  },
  {
    code: "SUBCON",
    /* Its stages no longer differ from IN_HOUSE's, and that is the honest
       reading of the owner's answers rather than an oversight: once *barang
       mentah* is bought in for everything (Q48), what separates a subcontracted
       order is **who held the piece and when**, not which steps it goes
       through. The vendor leg on the work order is what carries that, and W6
       is the record that will carry it properly. */
    name: "Dilempar ke vendor",
    description: "Ada proses yang dikerjakan vendor. Yang membedakan bukan tahapannya, melainkan siapa yang memegang barangnya dan kapan.",
    stages: ["AMPLAS", "FINISHING", "MACHINERY", "PACKING"],
  },
];

export const ROUTE = (code: RouteCode) =>
  ROUTES.find((r) => r.code === code) ?? ROUTES[0];

/** Are the goods physically in the workshop?
 *
 *  **One predicate, read by both the API and the screen.** The first version
 *  had the rule twice — the API refused on *sent and not back* and on *never
 *  sent*, and the drawer hid its reporting form on `at_vendor`, which is only
 *  the first of those. So an order the vendor had not even been given yet
 *  offered a form that the API would refuse on submit (F75). Offering
 *  something that will be refused is a trap, not a choice, and two conditions
 *  written separately will always drift into being two different conditions.
 *
 *  An in-house order is always on site: there is nowhere else for it to be.
 */
export function goodsOnSite(
  wo: { route: RouteCode; at_vendor_qty: number; qty: number },
): boolean {
  /* **One predicate, read by the API and the screen** — the rule written twice
     was F75, and it is written once here. What changed with W6 is that it is
     no longer all-or-nothing: six of twelve chairs at the upholsterer leaves
     six in the building, and work reported on those six is legitimate. So the
     question is not *has anything been sent* but *is anything still here*. */
  if (wo.route !== "SUBCON") return true;
  return wo.qty - wo.at_vendor_qty > 0;
}

export type WorkOrderStatus = "OPEN" | "DONE" | "CANCELLED";

/** One thing to make, in a quantity, by a date.
 *
 *  `due_date` is the whole point of the record. A workshop always knows what
 *  it is building; what it loses track of is which of the eleven things on the
 *  floor is the one that is late.
 */
export interface WorkOrder {
  id: string;
  wo_no: string;
  /** The catalogue product this order is for, where there is one — which is
   *  what lets a customer's order line and the floor be compared (D150). Null
   *  for a one-off nobody has catalogued. */
  product_code: string | null;
  /** What is being made, in the workshop's own words. Kept even when a product
   *  is named: a work order says what it said on the day it was written. */
  item_name: string;
  description: string | null;
  qty: number;
  uom: string;
  /** Whose order this is for. A public code, validated at the seam (ADR-004). */
  project_code: string | null;
  /** The customer's order line this Job Order was made from, where it was
   *  made from one (0130). What lets the order screen say *12 dipesan · 12 di
   *  Job Order · 4 selesai* without matching by product code. */
  project_line_id?: string | null;
  /** Deadline. Not a plan — a promise somebody made to a customer. */
  due_date: string;
  /** Which stages this order actually goes through (D254). */
  route: RouteCode;
  /** The BOM revision this order was written against, pinned when it was
   *  created (D256). **Null is not "the current one"** — it means the order
   *  predates versioning, or its product has no released BOM, and the screen
   *  says so rather than showing today's list as though it were the one used.
   *  A figure may be missing; it may not be quietly wrong. */
  bom_rev: number | null;
  /** The vendor legs live in `vendor_legs`, not here (W6, D280).
   *
   *  There used to be four columns on this row — one vendor, one sent date,
   *  one promised date, one returned date — and they could describe exactly one
   *  trip. The business has **several vendors each doing one process**: barang
   *  mentah, jok, amplas, packing, and a piece can visit more than one of them.
   *  Four columns cannot hold two legs, let alone say which vendor had it for
   *  which process.
   *
   *  The view still carries `subcon_*` fields so the board and the drawer read
   *  the same way they always did — but they are **derived from the legs**,
   *  not stored beside them, because one fact written twice is one fact that
   *  drifts (F73, F75). */
  status: WorkOrderStatus;
  created_at: string;
  created_by: string;
  cancelled_reason: string | null;
  note: string | null;
}

/** What a vendor does to a piece (W6, D280).
 *
 *  **Not the same vocabulary as the four stages**, and that is the point. The
 *  owner's list is *barang mentah, jok, amplas, packing* — two of those are
 *  stages of ours, one (`JOK`) is not a stage at all, and `BARANG_MENTAH` is
 *  the rough making that happens **before** our first stage. Forcing them onto
 *  `PROCESS_STAGES` would have bent one of the two lists out of shape; they
 *  are related and they are not the same thing.
 */
export const VENDOR_PROCESSES = [
  { code: "BARANG_MENTAH", name: "Barang mentah", note: "Dibuat kasar oleh vendor, masuk bengkel untuk diamplas." },
  { code: "JOK", name: "Jok", note: "Bukan salah satu dari empat tahap — pekerjaan sendiri." },
  { code: "AMPLAS", name: "Amplas", note: "Tahap yang sama dengan di bengkel, dikerjakan di luar." },
  { code: "FINISHING", name: "Finishing", note: null },
  { code: "PACKING", name: "Packing", note: null },
] as const;

export type VendorProcessCode = (typeof VENDOR_PROCESSES)[number]["code"];

export const VENDOR_PROCESS_NAME = (code: string) =>
  VENDOR_PROCESSES.find((p) => p.code === code)?.name ?? code;

/** One trip to one vendor for one process (W6, D280).
 *
 *  A **row per leg**, because a piece can go to the upholsterer and then to
 *  the sander, and *where is my chair* is answerable only if each trip has its
 *  own dates. `qty` is how many went; `returned_qty` is how many came back, and
 *  it is **nullable and separate** rather than a flag, because six going out
 *  and four coming back is the ordinary case and the two that stayed are the
 *  question somebody has to ask the vendor.
 *
 *  Nothing here posts progress. A vendor returning six sanded pieces does not
 *  record that six were sanded — a person does, the same way the BOM proposes
 *  and the storeman disposes (D266). The leg says where the goods were; the
 *  progress entry says what was done to them, and the two are written by
 *  different people on different days.
 */
export interface VendorLeg {
  id: string;
  leg_no: string;
  wo_id: string;
  process: string;
  /** A public vendor id, validated at the seam like every cross-service
   *  reference (ADR-004). */
  vendor_id: string;
  qty: number;
  sent_on: string;
  /** The vendor's promise, marked as a promise wherever it is printed — the
   *  same shape as a PO's expected delivery (D234). Null where none was
   *  given, which is a different thing from *not yet due*. */
  expected_back: string | null;
  returned_on: string | null;
  /** How many came back. Null while the leg is open; **less than `qty` is a
   *  legitimate, closed answer** — the rest did not come back, and saying so
   *  is the whole reason this is a number and not a tick. */
  returned_qty: number | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface VendorLegView extends VendorLeg {
  process_name: string;
  vendor_name: string;
  wo_no: string;
  product_name: string;
  /** Still out: `qty − (returned_qty ?? 0)`, and zero once it is closed. */
  outstanding: number;
  /** Days it has been away, or days it took. */
  days_out: number;
  /** Past the vendor's promise and not back. Null where no promise was given
   *  — *late* is only meaningful against a date somebody agreed (D134). */
  overdue_days: number | null;
  /** Fewer came back than went. The sentence a foreman needs, not a flag. */
  short_by: number | null;
}

/** How a vendor has actually behaved, over the legs we have (W6, D282).
 *
 *  The question this answers is the one the leg list cannot: *should we keep
 *  using them.* A single late trip is a bad week; four late trips out of five
 *  is a supplier decision, and the difference between those two readings is
 *  the number of legs behind them.
 *
 *  So every rate here comes with its **basis**, and below a floor there is no
 *  rate at all — `rated` is false and the screen says *belum cukup untuk
 *  dinilai* rather than printing "0% tepat waktu" over one trip (D261's rule,
 *  in a new place). A vendor judged on one leg is a vendor judged on a rumour.
 */
export interface VendorRecord {
  vendor_id: string;
  vendor_name: string;
  /** Which processes they do for us, by name. */
  processes: string[];
  legs: number;
  /** Closed legs are the only ones that can be judged on time. */
  closed: number;
  open: number;
  /** Closed legs that had a promised date at all — the only ones where *on
   *  time* means anything (D134). */
  promised: number;
  on_time: number;
  /** Null below the floor, or where nothing was ever promised. */
  on_time_percent: number | null;
  /** Average days a trip actually took, over closed legs. */
  avg_days_out: number | null;
  /** Units that went out and never came back, across closed legs. */
  short_units: number;
  /** Units sitting there right now. */
  out_now: number;
  /** Open legs already past their promise. */
  overdue_now: number;
  /** False where there is not enough to say anything. */
  rated: boolean;
  /** What the figures are over, in words, so they can be argued with. */
  basis: string;
}

/** Work done, one entry per report.
 *
 *  Append-only, like every other record of something that happened (A5). A
 *  wrong entry is corrected by a negative one with a reason, never by editing
 *  the number — because "how much was done on Tuesday" is a question somebody
 *  will ask after the argument starts.
 */
export interface ProgressEntry {
  id: string;
  wo_id: string;
  stage: string;
  /** May be negative: a correction is an entry, not an edit. */
  qty: number;
  /** The office day the work happened, not the day it was typed. */
  work_date: string;
  /** Who did it, **as it was written down**. Kept verbatim and for ever: it is
   *  what the mandor actually wrote, and a record that rewrites itself when
   *  somebody is later linked answers the wrong question in an argument. */
  worked_by: string | null;
  /** The link, added **beside** the name and never instead of it (D264).
   *
   *  Null does not mean *not an employee*. It means nobody has said yet, and
   *  that is a different fact from `worked_by_not_a_person` — which is a person
   *  having looked at the name and confirmed it is a team or a vendor's crew.
   *  The system never matches a name to an employee on its own; it may only
   *  suggest, and a human confirms (D264).
   *
   *  **Invariant:** never set together with `worked_by_not_a_person`. The API
   *  refuses the contradiction, and everything downstream reads the derived
   *  `attribution` rather than these two fields, so the pair cannot drift
   *  apart in a caller's hands (F75's rule). */
  worked_by_employee_id: string | null;
  /** Confirmed by a person: this name is **not one of our employees** — *Tim
   *  potong*, a subcontractor, a vendor's crew. Resolved, not missing. */
  worked_by_not_a_person: boolean;
  /** Where this came from. `overtime_sheet` entries are posted when a lembur
   *  sheet is approved, carrying the sheet number so the two can be told apart
   *  and so a re-post is a no-op (D147). */
  source: "manual" | "overtime_sheet";
  source_ref: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** How a name on a piece of work resolves to a person — **derived from the
 *  pair above, never stored**, so nothing downstream can read one half of the
 *  invariant and miss the other (D264).
 *
 *  Three states and they are genuinely three. `unknown` is not a worse
 *  `not_a_person`: it is the state of every entry written before anybody was
 *  asked, and the only one that is somebody's to resolve. */
export type WorkAttribution = "employee" | "not_a_person" | "unknown";

export function attributionOf(
  row: { worked_by_employee_id: string | null; worked_by_not_a_person: boolean },
): WorkAttribution {
  if (row.worked_by_employee_id) return "employee";
  return row.worked_by_not_a_person ? "not_a_person" : "unknown";
}

export const ATTRIBUTION_LABEL: Record<WorkAttribution, string> = {
  employee: "Tertaut ke karyawan",
  not_a_person: "Bukan satu orang",
  unknown: "Belum ditautkan",
};

export interface StageProgress {
  stage: string;
  name: string;
  seq: number;
  covers: string;
  /** Cumulative, from the entries. Where old seven-stage entries rolled up
   *  into this one it is the **smallest** of them, never their sum (F74). */
  done: number;
  /** Whether anybody has reported anything against this stage at all.
   *
   *  `done: 0` answers two different questions and they need telling apart
   *  (D275): *nothing has passed this stage yet* and *this order does not go
   *  through this stage*. A plain table never visits Machinery / instalasi,
   *  and reading its empty column as a zero made Packing look like it had
   *  jumped a step on almost every order in the seed. */
  recorded: boolean;
  /** Of the order's quantity. */
  percent: number;
  /** Every source that carried a figure, with its own total, so the minimum
   *  above can be checked instead of believed. Only worth printing when there
   *  is more than one — a stage with a single source **is** that source. */
  parts: { code: string; name: string; done: number }[];
}

/** A work order as something to point at — the four fields a picker shows.
 *
 *  `/procurement/pr/new` asks *which job is this purchase for* and needed
 *  nothing else from production, yet it called `listWorkOrders`, whose view
 *  carries stages, vendor legs and BOM drift. That call is not written against
 *  the database yet, so the one road to a PR stayed dark in the live system
 *  for the sake of an optional dropdown (F149, B6). A reference is what the
 *  question needs, and it is answerable from `ops_prod.work_orders` alone. */
export interface WorkOrderRef {
  wo_no: string;
  item_name: string;
  project_code: string | null;
  due_date: string;
}

export interface WorkOrderView extends WorkOrder {
  /** **Only the stages on this order's route.** A stage the route does not
   *  contain is absent, not zero (D254). */
  stages: StageProgress[];
  /** True where the **product** has no stage list, so this order is running on
   *  its route's stages instead (D278). Not an error — a product nobody has
   *  set up yet is the ordinary state of a catalogue — but it is the
   *  difference between *this product does not go through Machinery* and
   *  *nobody has said whether it does*, and the board must not blur them. */
  stages_unset: boolean;
  /** Work reported against steps this business no longer has — the cutting and
   *  assembly it now buys in as *barang mentah* (D275). Deliberately **not**
   *  folded into one of the four: six pieces cut is not six pieces sanded. It
   *  is shown apart, because a process change must not make past work
   *  disappear (A5). Empty on every order written since the change. */
  retired: { code: string; name: string; done: number }[];
  route_name: string;
  /** Sent to the vendor and not back yet. Derived, never stored. */
  at_vendor: boolean;
  /** Whether any stage may be reported at all — the goods are in the building.
   *  The same predicate the API refuses on, so the screen cannot offer what
   *  the API will reject (F75). */
  goods_on_site: boolean;
  /** The product's newest released revision **now**, against this order's
   *  pinned one. When they differ the BOM has moved on since this order was
   *  written, which is a thing to see: the projection this order is measured
   *  against is the old list, deliberately. */
  product_current_rev: number | null;
  bom_drifted: boolean;
  /** Whether moving this order onto the newer revision is allowed at all — the
   *  same predicate the API refuses on, so the screen cannot offer a button
   *  that will be rejected (F75). False once anything has been built: the old
   *  list is what was actually consumed. */
  bom_repinnable: boolean;
  /** Days since it left. Null when it has not been sent. */
  days_at_vendor: number | null;
  /** Every trip this order has made to a vendor (W6, D280). */
  legs: VendorLegView[];
  /** How many units are at a vendor **right now**, across every open leg.
   *  The reason `goodsOnSite` stopped being all-or-nothing: six of twelve at
   *  the upholsterer leaves six on the bench, and work on those six is real. */
  at_vendor_qty: number;
  /** Past the date the vendor promised, and still not back. The workshop is
   *  not late here; the vendor is, and the board must not say otherwise. */
  subcon_overdue: boolean;
  /** The furthest stage with anything finished — "sampai mana". */
  current_stage: string | null;
  current_stage_name: string;
  /** Finished all the way through the last stage. */
  completed: number;
  percent: number;
  /** Negative when the due date has passed. */
  days_left: number;
  late: boolean;
  /** Says plainly what is wrong, in words, for anybody reading the board. */
  warnings: string[];
}


/* ------------------------------------------------------------------ */
/* Master data: what we make, and what each one is made of             */
/* ------------------------------------------------------------------ */

/** Something the business **sells and makes**.
 *
 *  Deliberately not the same table as `procure.items` (D149). Those are things
 *  we *buy* — plywood, HPL, screws, a litre of coating — and they are half
 *  uncurated by design, because a purchase can name something nobody has
 *  catalogued yet. A product is the opposite: it is quoted to a client, put on
 *  a work order, and made, so it exists before anybody references it and is
 *  always curated.
 *
 *  The two meet in the bill of materials, which is a product pointing at
 *  purchased items by their code, at the seam (ADR-004).
 */
export interface Product {
  id: string;
  /** Stable, human, on the drawing and the work order. */
  product_code: string;
  name: string;
  /** Meja, Kursi, Lemari, Pintu — a word, not a hierarchy. */
  category: string;
  uom: string;
  description: string | null;
  /** Size in **millimetres**, one number per axis (D150).
   *
   *  Structured rather than free text, because "ukuran" is a thing the system
   *  has to be able to check for — a product without it cannot be quoted,
   *  cut or checked — and a sentence cannot be checked. Anything that does not
   *  fit three axes (a diameter, a thickness, a radius) goes in
   *  `dimension_note`, which is where the free text went rather than being
   *  lost. */
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  dimension_note: string | null;
  /** Working days from start to finished, for promising a date. A hint, never
   *  a schedule: the work order carries the date that was actually promised. */
  lead_time_days: number | null;
  /** Which of the four stages this product actually goes through (Q52, D278).
   *
   *  *Anggap per produk melewati setiap prosesnya* — so the stages belong to
   *  the product, and a product goes through **all** of its own. A dining
   *  table has no lamps or cables in it, and drawing it a *Machinery /
   *  instalasi* column it will never fill made every later stage look like it
   *  had jumped a step until `recorded` was added to paper over it (F92).
   *  Naming the stages per product removes the column instead of explaining
   *  it away.
   *
   *  **Null is not "all four".** It means nobody has said yet, and the board
   *  falls back to the route's stages and marks the product as one somebody
   *  should look at — the same rule the BOM and the size already follow
   *  (D150): what is missing is named, never filled in by software. */
  stages: string[] | null;
  /** What the workshop's own time on one unit costs, **typed by a person**
   *  (D239). Null until somebody types it, and null stays null: the owner was
   *  explicit that this comes from *perumusan manual*, and labour is where an
   *  invented number does the most damage because it flows straight into a
   *  quoted price. Nothing in this system derives it — not from the pay rules,
   *  not from recorded hours, not from a rate × a guess. */
  labour_cost: number | null;
  /** How the figure above was arrived at. Required alongside it: a labour cost
   *  with no working behind it is a number the next person cannot check or
   *  update. */
  labour_note: string | null;
  active: boolean;
  note: string | null;
}

/** One line of a bill of materials: what goes into one unit of the product.
 *
 *  A component is either a **purchased material** (a `procure.items` code) or
 *  **another product** — a drawer box that goes into a wardrobe. Both are
 *  carried as a public code and resolved at the screen, never joined across
 *  services (ADR-004).
 */
/** One dated version of a product's bill of material (D256).
 *
 *  The owner reversed the default on Q36: a BOM **is** versioned. The default
 *  had been current-state with every change audited, which preserves the
 *  history and loses the **pinning** — a wardrobe built in June reads today as
 *  though it had always used today's components, and the projection against
 *  what was actually bought becomes a comparison with the wrong list.
 *
 *  Two states and no more. A **draft** is being edited; a **released** one is
 *  frozen for ever. There is at most one draft per product, because a second
 *  one would raise the question of which the next work order pins to, and
 *  there is no answer to that question worth having.
 */
export interface BomRevision {
  id: string;
  product_id: string;
  /** 1, 2, 3 — per product, and printed everywhere as `rev 2`. */
  rev: number;
  /** Null while it is a draft. Set once, never cleared: releasing is what
   *  makes the revision a fact rather than a working copy (A5). */
  released_at: string | null;
  released_by: string | null;
  /** Why this version exists. Required to release — *rev 3* with no sentence
   *  is a number somebody will have to reverse-engineer from a diff. */
  note: string | null;
  /** Persentase miskalkulasi — one margin for error on the whole revision's
   *  subtotal (owner, 2026-09-23: *total saja*). 10 means 10%. Part of the
   *  revision, so frozen with it on release. Optional only because a demo
   *  state saved before it existed has none; read it as 0. */
  miscalc_percent?: number;
  created_at: string;
  created_by: string;
}

export interface BomRevisionView extends BomRevision {
  released_by_name: string | null;
  /** The revision a new work order would pin to: the newest released one. */
  is_current: boolean;
  is_draft: boolean;
  component_count: number;
  /** Work orders pinned to this revision. A released revision with orders
   *  behind it is the reason none of this can be edited. */
  used_by: number;
}

/** What changed between two revisions, line by line.
 *
 *  Computed from the two component lists rather than from an edit log: a diff
 *  derived from the things themselves cannot disagree with them, and an edit
 *  log can (A3). */
export interface BomDiffLine {
  ref_code: string;
  ref_name: string | null;
  change: "added" | "removed" | "changed";
  before: BomDiffShape | null;
  after: BomDiffShape | null;
}

/** What a line was, for the diff: quantity and the rate it is costed at. A
 *  rate change is a change — *harga kayu naik* is a reason to release. */
export interface BomDiffShape {
  qty: number;
  uom: string;
  waste_percent: number;
  unit_price: number | null;
}

export interface BomDiff {
  product_code: string;
  from_rev: number | null;
  to_rev: number;
  lines: BomDiffLine[];
  /** The miskalkulasi on each side, when it differs; null when it does not. */
  miscalc: { before: number; after: number } | null;
  /** True when the two lists are identical — which is why releasing an
   *  unchanged draft is refused: a revision number for nothing is noise in a
   *  history somebody will later have to read. */
  identical: boolean;
}

export interface BomComponent {
  id: string;
  product_id: string;
  /** The revision this line belongs to. A line is never moved between
   *  revisions: opening a new draft **copies** the released one, so the
   *  released lines stay exactly as they were released (A5). */
  rev: number;
  /** A purchased material, another product (a sub-assembly), or **labour** —
   *  the workshop's own time, costed like any other line: 1,5 hari × the day
   *  rate (0109). */
  kind: BomKind;
  /** `procure.items.code`, another `products.product_code`, or for labour a
   *  code derived from the label (`LABOUR:TUKANG-FINISHING`). */
  ref_code: string;
  /** What a labour line is called — *Tukang finishing*. Null for the others,
   *  whose names come from the catalogue. */
  label?: string | null;
  /** The line's own rate. While drafting: typed by the estimator (`manual`),
   *  or null to follow the catalogue. Once released: the rate the line was
   *  costed at, frozen, with `rate_source` saying where it came from. */
  unit_rate?: number | null;
  rate_source?: RateSource | null;
  /** Per ONE unit of the parent. */
  qty: number;
  uom: string;
  /** Susut — the share that becomes offcuts and dust. 10 means 10%, so a
   *  board of 2 m² at 10% needs 2,2 m² bought. Kept apart from `qty` because
   *  the quantity in the drawing and the quantity to buy are different
   *  numbers, and conflating them is how a workshop runs out (D149). */
  waste_percent: number;
  note: string | null;
}

export type BomKind = "material" | "product" | "labour";

/** Where a line's rate came from. `last` is the last price paid, `standard`
 *  the curated one, `sub_assembly` the sub-assembly's own released production
 *  cost, `manual` the estimator's. */
export type RateSource = "manual" | "standard" | "last" | "sub_assembly";

export interface BomLineView extends BomComponent {
  /** Resolved at the seam by whoever reads it; `null` when the code no longer
   *  names anything, which is a thing to see rather than to hide. */
  ref_name: string | null;
  /** `qty` plus waste — what actually has to be bought for one unit. */
  qty_with_waste: number;
  /** From the material's curated standard price, falling back to what it last
   *  cost. Null when neither exists. */
  unit_price: number | null;
  price_source: RateSource | "none";
  subtotal: number | null;
  /** What the catalogue says today, beside whatever rate the line carries —
   *  a manual rate far from the last price paid is a question worth seeing. */
  catalogue_price: number | null;
}

/** One purchasable material, after the sub-assemblies have been walked through.
 *
 *  The BOM itself stays **one level** — that is what somebody authored, and it
 *  is what the catalogue screen shows. This is the other question: *what do I
 *  actually have to buy for this run*, which is a walk rather than a sum
 *  (D257). A wardrobe needs two drawer boxes; a purchase request needs the
 *  plywood and the runners that a drawer box is made of.
 */
export interface BomExplodedLine {
  ref_code: string;
  ref_name: string | null;
  /** For the whole run, with waste applied **at every level it passed
   *  through**. Ten per cent more drawer boxes means ten per cent more of the
   *  plywood inside each one. */
  qty: number;
  uom: string;
  unit_price: number | null;
  price_source: "standard" | "last" | "none";
  subtotal: number | null;
  /** Every chain of parents this material arrived by, product code by product
   *  code. The same screw reached through two different sub-assemblies is one
   *  line with two paths — merged, because a purchase request wants one row per
   *  thing to buy, and named, because *why do I need 40 screws* is the next
   *  question. */
  via: string[][];
  /** 0 when the material sits directly on the product's own BOM. */
  depth: number;
}

/** What a run should consume, against what actually left the rack (D266).
 *
 *  The two halves are deliberately produced by different people. The BOM says
 *  what the run *ought* to take; the storeman says what *did* go out, because
 *  he is the one who carried it. Nothing here is deducted automatically, and
 *  that is the decision rather than an omission: stock that moves because a
 *  progress entry was typed is stock nobody counted, and the rack then
 *  disagrees with the screen in a way only a stock-take can find.
 *
 *  The gap between the two is the number this business has never been able to
 *  see: *did this run use more plywood than it should have.*
 */
export interface MaterialLine {
  item_code: string;
  item_name: string;
  uom: string;
  /** From the pinned BOM revision × the whole order, waste included at every
   *  level. Null for something issued that the BOM does not mention — which is
   *  not an error, it is the case worth looking at. */
  expected: number | null;
  /** Issues minus returns against this SPK. */
  issued: number;
  /** `expected − issued`, and null while `expected` is. Negative means more
   *  went out than the list called for. */
  remaining: number | null;
  /** What is on the rack now, across every location. */
  on_hand: number;
  /** True where this item was issued against the order and the BOM never
   *  named it. The screen says so rather than folding it into a variance. */
  off_bom: boolean;
  /** What the rack cannot cover of what is still to be issued:
   *  `max(remaining − on_hand, 0)`. Zero where nothing remains. */
  short: number;
}

/** Whether the order can start drawing its material — computed on read,
 *  never stored (A3, 0171). The rack is **shared**: two orders can both read
 *  `ready` against the same plywood, because nothing reserves stock for one
 *  order yet (owner's decision, D312). */
export type MaterialStatus =
  /** No BOM to compare with, so no answer — not "ready". */
  | "no_plan"
  /** Something still to be issued is not on the rack in full. */
  | "waiting"
  /** Everything still to be issued is on the rack. *Material ready.* */
  | "ready"
  /** Every BOM line has been issued to the floor. */
  | "issued";

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  no_plan: "Belum ada BOM",
  waiting: "Menunggu bahan",
  ready: "Material ready",
  issued: "Bahan sudah keluar",
};

/** The rule, once, for both layers. */
export function materialStatus(noPlanReason: string | null, lines: MaterialLine[]): MaterialStatus {
  if (noPlanReason) return "no_plan";
  const planned = lines.filter((l) => l.expected != null);
  if (planned.length === 0) return "no_plan";
  if (planned.every((l) => (l.remaining ?? 0) <= 0)) return "issued";
  return planned.some((l) => l.short > 0) ? "waiting" : "ready";
}

/** `max(remaining − on_hand, 0)` — see `MaterialLine.short`. */
export function materialShort(remaining: number | null, onHand: number): number {
  if (remaining == null || remaining <= 0) return 0;
  return Math.max(Math.round((remaining - Math.max(onHand, 0)) * 1000) / 1000, 0);
}

/* ------------------------------------------------------------------ */
/* The trail (0171): one number in, the purchase→production story out. */
/* ------------------------------------------------------------------ */

export type TrailStage =
  | "catalogued" | "bom"
  | "job_order" | "purchase_request" | "purchase_order" | "receipt" | "stock_in"
  | "issue" | "return" | "stock_move" | "progress" | "finished" | "delivery" | "handover";

export const TRAIL_STAGE_LABEL: Record<TrailStage, string> = {
  catalogued: "Masuk katalog",
  bom: "Dipakai di BOM",
  stock_move: "Gerak stok lain",
  job_order: "Job Order dibuat",
  purchase_request: "Purchase Request",
  purchase_order: "Purchase Order",
  receipt: "Receiving report",
  stock_in: "Stok masuk",
  issue: "Bahan keluar ke JO",
  return: "Bahan kembali",
  progress: "Progres produksi",
  finished: "Barang jadi",
  delivery: "Surat jalan",
  handover: "BAST",
};

export interface TrailEvent {
  at: string;
  stage: TrailStage;
  /** This event's own number (PR line, PO/line, RR, move, surat jalan). */
  no: string;
  /** The document it belongs to, where that differs. */
  doc_no?: string | null;
  /** The Job Order it is for — the thread (null = not tied to one). */
  wo_no: string | null;
  /** The item or product code — *what*. */
  item_code: string | null;
  text: string | null;
  qty: number | null;
  uom: string | null;
  /** Procurement readers only. */
  amount?: number | null;
  paid?: number | null;
  status: string | null;
}

export interface JobTrail {
  no: string;
  resolved_as: "project" | "job_order" | "purchase_request" | "purchase_order" | "receipt" | "delivery" | "item";
  /** Set when the number was an item code: the trail is that item's own life
   *  — catalogue, BOMs, purchases, receipts, stock, the JOs it served (D313). */
  item?: { code: string; name: string; name_local: string | null; category_code: string; uom: string; created_at: string } | null;
  project: { code: string; name: string; status: string | null; client_name: string | null; target_date: string | null } | null;
  job_orders: {
    wo_no: string; product_code: string | null; item_name: string; qty: number; uom: string;
    status: WorkOrderStatus; completed: number; due_date: string; bom_rev: number | null;
  }[];
  events: TrailEvent[];
  /** Stages withheld from this reader — *you may not see it*, not *it did
   *  not happen* (F104). */
  hidden: TrailStage[];
  /** Purchase lines in the story that name no JO; null when purchases are
   *  hidden. */
  unlinked_purchase_lines: number | null;
}

export interface MaterialPlan {
  wo_no: string;
  /** The revision the expectation was computed from. Null where the order
   *  predates versioning or the product has no BOM — and then every
   *  `expected` is null too, never zero (F60). */
  rev: number | null;
  /** Why there is no expectation, where there is none. */
  no_plan_reason: string | null;
  lines: MaterialLine[];
  /** *Material ready* and its neighbours — `materialStatus()` over `lines`. */
  material_status: MaterialStatus;
  /** Set once the order is finished. A variance read mid-run is not a
   *  variance — it is a run that has not finished drawing its material yet,
   *  and calling it an overrun teaches people to ignore the figure. */
  variance_readable: boolean;
  /** Pieces completed against ordered, so the reader can see how far in the
   *  order is without leaving the panel. */
  completed: number;
  ordered: number;
}

export interface BomExplosion {
  product_code: string;
  qty: number;
  /** The revision walked. A work order passes its own pinned one (D256). */
  rev: number | null;
  lines: BomExplodedLine[];
  total: number | null;
  unpriced: number;
  /** The sub-assemblies the walk went through, with how many of each the run
   *  needs — the things the workshop has to **make** rather than buy. */
  sub_assemblies: { product_code: string; name: string | null; qty: number; rev: number | null }[];
  /** Sub-assemblies with no released BOM. They stay in `lines` as themselves,
   *  because a thing that has to be obtained somehow is not nothing — and the
   *  screen says they could not be broken down rather than implying they were.
   *  Missing, never quietly wrong. */
  unexploded: string[];
  /** A product that contains itself, however indirectly. Null normally; the
   *  chain when it happens, so somebody can see where the loop closes rather
   *  than being told the BOM is "invalid" (D257). */
  cycle: string[] | null;
  /** Typed, never derived (D239). `labour_total` is `labour_cost × qty`, and
   *  null the moment the per-unit figure is null: a run of twelve costs twelve
   *  times an unknown, which is still unknown. */
  labour_cost: number | null;
  labour_total: number | null;
  labour_note: string | null;
}

/** A drawing, as the product screen needs it. */
export interface ProductDrawing {
  attachment_id: string;
  filename: string;
  /** Set for a link; null for an uploaded file, which Phase 2 serves through a
   *  signed URL. */
  url: string | null;
  linked_by: string;
  linked_at: string;
  /** Optional because the demo's fixtures predate it. */
  mime?: string;
}

/** Every drawing ever filed against a product, newest first. A revised
 *  gambar kerja is a new file, not an edit — the older one stays, because a
 *  piece built last month was built from it (A5). */
export interface ProductDrawingEntry extends ProductDrawing {
  kind: "Gambar Kerja" | "Gambar Jadi";
}

export interface ProductView extends Product {
  /** The components **of the revision being viewed** — the draft where one is
   *  open, otherwise the newest released one. */
  components: BomLineView[];
  /** Which revision `components` came from, and what else exists. */
  viewing_rev: number | null;
  current_rev: number | null;
  draft_rev: number | null;
  revisions: BomRevisionView[];
  /** What the open draft changes against the newest released revision — **derived
   *  here, from the same component list this view already carries**, so it
   *  cannot describe a state the screen is not showing. Fetching it separately
   *  made it one edit stale, which is a diff that is confidently wrong (F77).
   *  Null when no draft is open. */
  draft_diff: BomDiff | null;
  /** `2200 × 1000 × 750 mm`, built from the three numbers so every screen
   *  spells it the same way. Null when nothing has been recorded. */
  dimension: string | null;
  /** What the workshop builds from, and what the client was shown (D150). */
  gambar_kerja: ProductDrawing | null;
  gambar_jadi: ProductDrawing | null;
  /** The whole history of both, newest first — the revisions a designer
   *  flips through while writing the BOM. */
  drawings: ProductDrawingEntry[];
  /** Master data is only useful when it is complete, so the gaps are counted
   *  rather than left to be discovered: ukuran, gambar kerja, gambar jadi,
   *  BOM. */
  missing: string[];
  /** Material cost for one unit, from the components that have a price.
   *  Sub-assemblies are costed by **walking into them** (D257), so a wardrobe
   *  is priced from the plywood its drawer boxes are made of. */
  material_cost: number | null;
  /** Labour **lines** summed (0109); null where the revision has no labour
   *  line at all — *nobody has put the workshop's time on this* is not *it
   *  takes none*. `Product.labour_cost`, the old typed lump sum, is no longer
   *  read for a cost. */
  labour_cost: number | null;
  /** Materials + labour, of the lines that have a rate. */
  subtotal: number;
  /** The revision's miskalkulasi, and what it adds to the subtotal. */
  miscalc_percent: number;
  miscalc_amount: number;
  /** **Biaya produksi per unit** — subtotal + miskalkulasi. Not a selling
   *  price. Null while any line has no rate: a cost with a hole in it is the
   *  number somebody quotes from. */
  production_cost: number | null;
  /** Kept for the screens that read it; the same number as `production_cost`. */
  total_cost: number | null;
  /** How many components could not be priced — the figure above is only worth
   *  what this number says it is. */
  unpriced: number;
  /** Components whose code no longer resolves. */
  broken_refs: number;
  warnings: string[];
}

/* ── Desain: the drafters' queue ───────────────────────────────────────────
 *
 *  The drawings themselves already exist as documents on a product (D150). What
 *  the drafting team has never had is the **queue** (D167): which items are
 *  ordered or already on the floor with no drawing behind them, whose turn each
 *  one is, which revision the workshop is actually cutting from, and what is
 *  stuck waiting for an answer nobody has given.
 *
 *  Three things this deliberately is not:
 *
 *  - **Not a file browser.** The files are on the product, on the same evidence
 *    road as everything else. This is the work, not the folder.
 *  - **Not a CAD integration.** A revision is a file somebody uploads with a
 *    number on it; what makes it useful is that the system knows which one was
 *    released and which one came after.
 *  - **Not an approval chain.** A drawing is released by the drafter who made
 *    it. What needs somebody else is a *question*, and that is its own row.
 */
export type DesignKind = "gambar_kerja" | "gambar_jadi";

export const DESIGN_KIND_LABEL: Record<DesignKind, string> = {
  gambar_kerja: "Gambar kerja",
  gambar_jadi: "Gambar jadi",
};

/** Where a drawing has got to. Deliberately four, because a fifth would be a
 *  state nobody could tell apart from its neighbour at a glance. */
export type DesignStatus =
  /** Nobody has started. */
  | "BELUM"
  /** Somebody is drawing it. */
  | "DIGAMBAR"
  /** Drawn, and waiting on an answer before it can be released. */
  | "TANYA"
  /** Released — the workshop may cut from it. */
  | "RILIS";

export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  BELUM: "Belum digambar",
  DIGAMBAR: "Sedang digambar",
  TANYA: "Menunggu jawaban",
  RILIS: "Sudah rilis",
};

export interface DesignTask {
  id: string;
  task_no: string;
  /** `prod.products.product_code`. A task belongs to a product, not to an
   *  order: the same table is drawn once and used by every order after. */
  product_code: string;
  kind: DesignKind;
  status: DesignStatus;
  /** Who is drawing it, as it was written down. Null is honest — an unassigned
   *  task is the queue's most useful row. */
  assignee: string | null;
  /** The link beside the name, on the same terms as `ProgressEntry` (D264): a
   *  freelance drafter is a legitimate answer, so the link is optional and
   *  never replaces what was typed. */
  assignee_employee_id: string | null;
  /** Confirmed: this name is not one of our employees. */
  assignee_not_a_person: boolean;
  /** When it is needed by. Set by hand, or left null and taken from the job. */
  due_date: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

/** One upload. Append-only: revision B does not replace revision A, it follows
 *  it — which is the only way to answer "what was the workshop cutting from in
 *  August" (A5, D179). */
export interface DesignRevision {
  id: string;
  task_id: string;
  /** `A`, `B`, `C`. The drafter's own numbering, carried verbatim. */
  rev: string;
  attachment_id: string | null;
  filename: string | null;
  note: string | null;
  /** Set when this revision is the one the workshop may build from. A revision
   *  uploaded and not released is a draft, and the floor must not see it. */
  released_at: string | null;
  released_by: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

/** Something the drafter cannot answer alone — a dimension the client has not
 *  confirmed, a joint the workshop has to agree to. It blocks the task, by
 *  design: a drawing released over an unanswered question is a drawing the
 *  workshop will build wrong. */
export interface DesignQuestion {
  id: string;
  task_id: string;
  /** Who is being asked: `klien`, `pimpinan`, `produksi`. Free text, because
   *  the real answer is a person and the list would go stale. */
  asked_of: string;
  question: string;
  answer: string | null;
  asked_by: string;
  asked_at: string;
  answered_by: string | null;
  answered_at: string | null;
}

export interface DesignRevisionView extends DesignRevision {
  uploaded_by_name: string;
  released_by_name: string | null;
}

export interface DesignQuestionView extends DesignQuestion {
  asked_by_name: string;
  answered_by_name: string | null;
  /** Days it has been waiting. The number that turns a polite question into a
   *  visible blockage. */
  waiting_days: number | null;
}

export interface DesignTaskView extends DesignTask {
  product_name: string;
  category: string;
  /** Millimetres, or null — a drawing for a product with no size is the
   *  drafter's first question, not their last (D150). */
  dimension: string | null;
  revisions: DesignRevisionView[];
  questions: DesignQuestionView[];
  /** The revision the workshop may cut from, and the newest one that exists. */
  released_rev: string | null;
  latest_rev: string | null;
  /** **The dangerous case**: a newer revision exists and has not been released,
   *  so the floor is still building from the older one (D179). */
  ahead_of_release: boolean;
  /** Open questions block, whatever the status says. */
  blocked: boolean;
  /** Which orders and work orders are waiting on this drawing, by public code
   *  (ADR-004). */
  ordered_by: string[];
  work_orders: { wo_no: string; due_date: string; status: WorkOrderStatus }[];
  /** The soonest date anything needing this drawing is due. Null when nothing
   *  is waiting — which is a fine reason not to draw it yet. */
  needed_by: string | null;
  /** Days until `needed_by`, negative when it is already late. */
  days_left: number | null;
}
