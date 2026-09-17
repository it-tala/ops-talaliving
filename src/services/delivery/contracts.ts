/** Delivery contracts — cut to `docs/plan/02-database.md`, schema `dlv`.
 *
 *  A tenth service, and it exists because the last leg of a job is neither
 *  buying it nor making it (D209). Procurement owns what the client ordered;
 *  production owns what came off the floor. What happens after that — a truck,
 *  a site, a crew, a snag list and a signature — is its own concern with its
 *  own vocabulary, and it is the concern the business currently has no record
 *  of at all.
 *
 *  The question these three screens exist to answer is one the order board
 *  cannot: **how much of what the client bought has actually reached them.**
 *  Made is not delivered, delivered is not installed, and installed is not
 *  handed over. Four different numbers, and today they are one guess.
 */

/* ── Delivery ─────────────────────────────────────────────────────────── */

export type DeliveryStatus =
  /** Written, nothing has left the yard. */
  | "DRAFT"
  /** On the truck. */
  | "IN_TRANSIT"
  /** Arrived, and somebody at the site signed for it. */
  | "ARRIVED"
  | "CANCELLED";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  DRAFT: "Draft",
  IN_TRANSIT: "Di jalan",
  ARRIVED: "Sampai",
  CANCELLED: "Dibatalkan",
};

/** One consignment leaving for one site. */
export interface Delivery {
  id: string;
  delivery_no: string;
  /** Public project code, at the seam (ADR-004). */
  project_code: string;
  dispatched_on: string;
  vehicle: string | null;
  driver: string | null;
  status: DeliveryStatus;
  /** Filled when it arrives. **Both of these are required to mark it
   *  arrived** — the same rule receiving already follows (D101): the signature
   *  says we acknowledged it, and three weeks later the argument about what
   *  turned up is settled by whichever one exists. */
  received_by: string | null;
  received_at: string | null;
  surat_jalan_attachment_id: string | null;
  photo_attachment_id: string | null;
  note: string | null;
  cancelled_reason: string | null;
  created_by: string;
  created_at: string;
}

export interface DeliveryLine {
  id: string;
  delivery_id: string;
  /** Which line of the client's order this is part of. */
  project_line_id: string;
  /** What the note said, in the words used on the day. */
  description: string;
  qty: number;
  uom: string;
  note: string | null;
}

/* ── Koli: what is in the box, and where it goes ──────────────────────── */

/** One packed box, with a code somebody can scan on site (D262).
 *
 *  The owner's second sentence on Q29: *nantinya kita akan sering pakai QR
 *  untuk penanda instalasi item per box nya*. It was filed as Phase 2 beside
 *  the vendor-PO QR, and that was wrong — **only the vendor one needs a public
 *  route**. The person scanning a box is our own installer, who has a login, so
 *  none of this waits on anything (F82).
 *
 *  A box is not a delivery line. A delivery line says *six chairs went*; a box
 *  says *these two chairs, in this box, go to the first-floor dining room* —
 *  which is the question somebody standing in a hallway full of cardboard is
 *  actually asking.
 */
export type BoxStatus =
  /** Packed and labelled, still in the workshop. */
  | "PACKED"
  /** On a delivery that has left. */
  | "IN_TRANSIT"
  /** Somebody on site scanned it and said it is here. */
  | "ON_SITE"
  /** Its contents are installed. */
  | "INSTALLED"
  /** Scanned and found damaged or short, with what is wrong. */
  | "PROBLEM";

export const BOX_STATUS_LABEL: Record<BoxStatus, string> = {
  PACKED: "Dikemas",
  IN_TRANSIT: "Di jalan",
  ON_SITE: "Sampai di site",
  INSTALLED: "Terpasang",
  PROBLEM: "Bermasalah",
};

export interface PackingBox {
  id: string;
  /** `kol-26-09-13_01`. The QR points at `/box/<box_no>`; this code is also
   *  printed in mono beside it, so a label outlives the hostname (F83). */
  box_no: string;
  project_code: string;
  /** The consignment it rides on. Null while it is packed and waiting. */
  delivery_id: string | null;
  /** Where it goes **inside the building** — *Lantai 2, kamar tidur utama*.
   *  The whole point of labelling per box rather than per delivery: a lorry
   *  arrives with forty boxes and the crew needs to know which floor each one
   *  is for without opening it. */
  destination: string;
  /** Packed by whom, when. */
  packed_by: string;
  packed_at: string;
  status: BoxStatus;
  /** Set when somebody scans it on site. */
  scanned_by: string | null;
  scanned_at: string | null;
  /** What is wrong, when the status is `PROBLEM`. Required to set it — a box
   *  flagged with no sentence is one nobody can act on. */
  problem_note: string | null;
  note: string | null;
}

export interface BoxLine {
  id: string;
  box_id: string;
  /** The client's order line this belongs to, where there is one. */
  project_line_id: string | null;
  description: string;
  qty: number;
  uom: string;
}

export interface BoxView extends PackingBox {
  lines: BoxLine[];
  status_label: string;
  delivery_no: string | null;
  project_name: string | null;
  packed_by_name: string;
  scanned_by_name: string | null;
  /** Total pieces inside, for the label. */
  piece_count: number;
  /** `3 dari 12` — which box of the consignment this is, for the label and for
   *  the crew counting them off the lorry. */
  position: string | null;
  /** Where the box record and the consignment record disagree. A box scanned
   *  on site whose delivery was never marked dispatched is not an error to
   *  refuse — the box is standing there — it is a gap in the paperwork, and
   *  saying so is the whole job. */
  warnings: string[];
}

/* ── Installation ─────────────────────────────────────────────────────── */

export type InstallationStatus = "SCHEDULED" | "DONE" | "CANCELLED";

export const INSTALLATION_STATUS_LABEL: Record<InstallationStatus, string> = {
  SCHEDULED: "Dijadwalkan",
  DONE: "Selesai",
  CANCELLED: "Dibatalkan",
};

/** One visit to a site by a crew. A job usually takes several. */
export interface Installation {
  id: string;
  install_no: string;
  project_code: string;
  visit_date: string;
  /** Who went. Free text, because a subcontracted crew is a normal answer and
   *  this service does not own people. */
  crew: string | null;
  status: InstallationStatus;
  note: string | null;
  cancelled_reason: string | null;
  created_by: string;
  created_at: string;
}

export interface InstallationLine {
  id: string;
  installation_id: string;
  project_line_id: string;
  qty: number;
  note: string | null;
}

/** Something found wrong on site.
 *
 *  Kept apart from the installation that found it, because a snag outlives the
 *  visit: it is raised on one day, fixed on another, and the gap between those
 *  two dates is the thing a client remembers.
 */
export type SnagSeverity = "minor" | "major";
export type SnagStatus = "OPEN" | "FIXED";

export const SNAG_SEVERITY_LABEL: Record<SnagSeverity, string> = {
  minor: "Ringan",
  major: "Berat",
};

export interface Snag {
  id: string;
  snag_no: string;
  project_code: string;
  /** Which item, when it is about one. Null for something about the site. */
  project_line_id: string | null;
  raised_on: string;
  raised_by: string;
  description: string;
  severity: SnagSeverity;
  status: SnagStatus;
  photo_attachment_id: string | null;
  fixed_on: string | null;
  fixed_by: string | null;
  fix_note: string | null;
}

/* ── Handover ─────────────────────────────────────────────────────────── */

/** The BAST: the client says they have it.
 *
 *  One per project, and the only record in this system that says a job is
 *  finished. **It refuses without the signed document** (D211) — every other
 *  refusal here is about money, and this one is about a claim: a handover with
 *  nothing behind it asserts that the client accepted the work, and the client
 *  is the one person who cannot correct our record of that.
 */
export interface Handover {
  id: string;
  handover_no: string;
  project_code: string;
  handed_on: string;
  /** Who signed, on each side. Names, because that is what is on the paper. */
  client_rep: string;
  our_rep: string;
  bast_attachment_id: string;
  /** Snags still open on the day it was signed, and what they were.
   *
   *  Handing over with open snags is allowed and ordinary — the client wants
   *  their house back. What is not allowed is handing over as though there
   *  were none, so the count and the list are frozen onto the record (D212). */
  open_snags_at_handover: number;
  open_snag_nos: string[];
  note: string | null;
  created_by: string;
  created_at: string;
}

/* ── What any of this adds up to ──────────────────────────────────────── */

/** One line of the client's order, from what they bought to what they have.
 *
 *  Four numbers, and the gaps between them are the whole point. `made` is
 *  **null, not zero**, for a line nothing can be matched to — a service line
 *  has nothing to build, and a catalogue-less line cannot be matched to a work
 *  order without guessing (D210).
 */
export interface FulfilmentLine {
  project_line_id: string;
  line_no: number;
  product_code: string | null;
  description: string;
  uom: string;
  ordered: number;
  /** Finished all the way through the last stage, on work orders for this
   *  project and this product. Null when nothing can be matched. */
  made: number | null;
  /** Left the yard — on a truck or already there. This is the figure
   *  `ready_to_ship` subtracts, because a table on the road cannot be loaded
   *  onto a second truck. */
  delivered: number;
  /** Signed for at the site. **Not the same number**, and conflating them is
   *  how a crew gets sent to fit something still on the road (F62). */
  arrived: number;
  installed: number;
  /** Made and not yet gone. Null where `made` is. */
  ready_to_ship: number | null;
  /** At the site and not yet fitted — from `arrived`, never from `delivered`. */
  on_site: number;
  /** A line with nothing to build — a service, a fee. Shown as such rather
   *  than as a permanently unfinished item. */
  is_service: boolean;
}

export type FulfilmentStage =
  | "in_production"
  | "ready_to_ship"
  | "in_transit"
  | "on_site"
  | "installed"
  | "handed_over";

export const FULFILMENT_STAGE_LABEL: Record<FulfilmentStage, string> = {
  in_production: "Masih diproduksi",
  ready_to_ship: "Siap kirim",
  in_transit: "Di jalan",
  on_site: "Sudah di lokasi",
  installed: "Terpasang",
  handed_over: "Sudah serah terima",
};

export interface FulfilmentView {
  project_code: string;
  project_name: string;
  client_name: string | null;
  location: string | null;
  target_date: string | null;
  lines: FulfilmentLine[];
  /** Sums across the lines that have something to build. */
  ordered_qty: number;
  made_qty: number | null;
  delivered_qty: number;
  installed_qty: number;
  /** Of what was ordered, how much is fitted. Null while nothing is
   *  matchable — a percentage of an unknown is not a percentage. */
  installed_percent: number | null;
  open_snags: number;
  major_snags: number;
  deliveries: number;
  in_transit: number;
  handover: Handover | null;
  stage: FulfilmentStage;
  /** Negative once the promised date has passed and it is not handed over. */
  days_to_target: number | null;
  warnings: string[];
}

export interface DeliveryView extends Delivery {
  project_name: string;
  client_name: string | null;
  location: string | null;
  lines: (DeliveryLine & { line_no: number })[];
  total_qty: number;
  /** Said plainly: no surat jalan, nobody named as receiver, sitting in
   *  transit for a week. */
  warnings: string[];
}

export interface InstallationView extends Installation {
  project_name: string;
  location: string | null;
  lines: (InstallationLine & { description: string; uom: string; line_no: number })[];
  total_qty: number;
  snags_found: number;
}

export interface SnagView extends Snag {
  project_name: string;
  line_description: string | null;
  /** Days open, or days it took to close. */
  age_days: number;
}
