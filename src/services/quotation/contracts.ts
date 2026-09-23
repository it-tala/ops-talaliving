/** The quotation: a released BOM turned into a price for the client (0133).
 *
 *  The owner's sentence is the whole design: *ada data item, ongkos produksi
 *  jadi tinggal tambahkan biaya marketing, overhead, tentukan margin lalu dapat
 *  harga jual*. So a line carries a product and a quantity, reads what one unit
 *  costs to make from the **released** BOM, and turns it into a selling price
 *  with three percentages:
 *
 *      harga jual = ongkos × (1 + marketing% + overhead%) ÷ (1 − margin%)
 *
 *  Margin is **of the selling price** (owner, 2026-09-23): 20% margin means a
 *  fifth of what the client pays is left after cost, marketing and overhead.
 *  The same formula is `ops_procure.quote_price` in the database; both sides
 *  round to whole rupiah the same way, so the demo and the live screen agree to
 *  the rupiah.
 *
 *  A draft prices live from the catalogue; **sending freezes** every figure on
 *  every line, so a BOM released next week cannot move a number the client is
 *  already holding. To change a sent quotation you revise it — a new revision,
 *  the old one superseded. Accepted, its lines become the order at the quoted
 *  price, and the project moves to DEAL.
 *
 *  Cost and margin are for the people who can edit a project (`project.update`);
 *  a reader sees prices only. That is a screen rule, not a secret — see 0133.
 */

export type QuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";

export const QUOTATION_STATUSES: { code: QuotationStatus; label: string; tone: "slate" | "brand" | "green" | "red" | "amber" }[] = [
  { code: "DRAFT", label: "Draft", tone: "slate" },
  { code: "SENT", label: "Terkirim", tone: "brand" },
  { code: "ACCEPTED", label: "Disetujui", tone: "green" },
  { code: "REJECTED", label: "Ditolak", tone: "red" },
  { code: "SUPERSEDED", label: "Diganti revisi", tone: "amber" },
];

export const QUOTATION_STATUS_LABEL = (s: QuotationStatus): string =>
  QUOTATION_STATUSES.find((x) => x.code === s)?.label ?? s;

/** Where a line's unit cost came from: the released BOM, or typed by hand
 *  for something the catalogue does not cost yet. */
export type QuoteCostSource = "bom" | "manual";

export interface Quotation {
  id: string;
  /** qt-26-09-23_01, minted by the database. */
  quote_no: string;
  project_id: string;
  rev: number;
  /** The revision this one replaced. */
  supersedes_id: string | null;
  status: QuotationStatus;
  valid_until: string | null;
  /** The defaults every line inherits unless it overrides them. */
  marketing_pct: number;
  overhead_pct: number;
  margin_pct: number;
  /** PPN is optional per quotation (owner, 2026-09-23). */
  vat: boolean;
  vat_pct: number;
  terms: string | null;
  note: string | null;
  sent_at: string | null;
  decided_at: string | null;
  /** Why the client said no. Required on a rejection. */
  decision_reason: string | null;
  created_at: string;
}

/** A quotation as the screens read it — `v_quotation`. */
export interface QuotationView extends Quotation {
  project_code: string;
  project_name: string;
  client_name: string | null;
  client_contact: string | null;
  client_address: string | null;
  location: string | null;
  line_count: number;
  /** Lines with no cost to price from and no set price. Blocks sending. */
  lines_without_cost: number;
  /** Σ unit price × qty. Null while any line has no price. */
  subtotal: number | null;
  vat_amount: number | null;
  grand_total: number | null;
  /** Σ unit cost × qty; null for someone who may not see cost. */
  cost_total: number | null;
  /** The longest production estimate on any line — the one the client waits for. */
  max_lead_time_days: number | null;
  /** Sent, and past its validity date. */
  expired: boolean;
  /** The revision still in play: a draft, or sent and not revised. */
  is_current: boolean;
}

/** A line as the screens read it — `v_quotation_line`. While the quotation is
 *  a draft every figure is live; after it is sent they are the frozen ones. */
export interface QuotationLineView {
  id: string;
  quotation_id: string;
  quote_no: string;
  status: QuotationStatus;
  line_no: number;
  product_code: string | null;
  description: string;
  qty: number;
  uom: string;
  /** Days to make it: the line's own, else the product's. */
  lead_time_days: number | null;
  product_exists: boolean;
  note: string | null;
  cost_is_manual: boolean;
  cost_missing: boolean;
  /** Whether this reader sees cost and percentages at all. */
  cost_visible: boolean;
  unit_cost: number | null;
  cost_source: QuoteCostSource | null;
  /** The BOM revision the cost is from. */
  bom_rev: number | null;
  /** Effective percentages: the line's own, else the quotation's. */
  marketing_pct: number | null;
  overhead_pct: number | null;
  margin_pct: number | null;
  pct_overridden: boolean;
  /** What the formula gives, before any set price. */
  computed_unit_price: number | null;
  /** A price set by hand, which wins over the formula. */
  unit_price_override: number | null;
  /** What the client pays per unit. */
  unit_price: number | null;
  /* What the line itself says — for the editor to send back unchanged. */
  line_lead_time_days: number | null;
  manual_unit_cost: number | null;
  line_marketing_pct: number | null;
  line_overhead_pct: number | null;
  line_margin_pct: number | null;
}

/** One revision in a project's quotation history. */
export interface QuotationRevision {
  quote_no: string;
  rev: number;
  status: QuotationStatus;
  sent_at: string | null;
  grand_total: number | null;
}

export interface QuotationDetail {
  quotation: QuotationView;
  lines: QuotationLineView[];
  /** Every revision for the project, newest first — this one included. */
  revisions: QuotationRevision[];
}

export interface QuotationInput {
  /** Empty to create one for `project_code`. */
  quote_no?: string | null;
  project_code?: string | null;
  valid_until?: string | null;
  marketing_pct: number;
  overhead_pct: number;
  margin_pct: number;
  vat: boolean;
  vat_pct?: number;
  terms?: string | null;
  note?: string | null;
}

export interface QuotationLineInput {
  /** Empty to add a line. */
  id?: string | null;
  product_code?: string | null;
  description?: string | null;
  qty: number;
  uom: string;
  lead_time_days?: number | null;
  /** For an item the catalogue does not cost: typed by hand. */
  manual_unit_cost?: number | null;
  /** Null to inherit the quotation's. */
  marketing_pct?: number | null;
  overhead_pct?: number | null;
  margin_pct?: number | null;
  unit_price_override?: number | null;
  note?: string | null;
}

/** A line as stored — `ops_procure.quotation_lines`. The `frozen_*` figures
 *  are written by sending and never again. */
export interface QuotationLine {
  id: string;
  quotation_id: string;
  line_no: number;
  product_code: string | null;
  description: string;
  qty: number;
  uom: string;
  lead_time_days: number | null;
  manual_unit_cost: number | null;
  marketing_pct: number | null;
  overhead_pct: number | null;
  margin_pct: number | null;
  unit_price_override: number | null;
  note: string | null;
  frozen_unit_cost: number | null;
  frozen_cost_source: QuoteCostSource | null;
  frozen_bom_rev: number | null;
  frozen_marketing_pct: number | null;
  frozen_overhead_pct: number | null;
  frozen_margin_pct: number | null;
  frozen_unit_price: number | null;
}
