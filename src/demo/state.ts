import type {
  Session, User, ModuleGrant, Authority, ActivityEvent, ActivityDaily, AppSetting,
} from "@/services/identity/contracts";
import type { AssistantTurn } from "@/services/assistant/contracts";
import type {
  Vendor, Uom, UomConversion, ItemCategory, Item, Project, ProjectLine,
  PrDocument, PrLine, PrApproval, PaymentRound, PaymentRoundLine,
  Receipt, LineSettlement, PurchaseOrder, PoLine, PoScheduleTerm, LineVariance,
  LineNote, ApprovalRequest, ApprovalBatch, RoundTransfer,
} from "@/services/procurement/contracts";
import type {
  Account, TransactionType, Transaction, TransactionLine,
  PaymentAllocation, EvidenceInboxRow,
  CashComponent, CashOverride, CashSettlement, BankStatement, StatementLine,
} from "@/services/accounting/contracts";
import type { Attachment, AttachmentLink } from "@/services/documents/contracts";
import type {
  Market, Property, PropertyAgent, SalesRep, Referral, ScrapeRow,
} from "@/services/marketing/contracts";
import type {
  LogPurchase, LogPiece, SawnBoard, BoardMove,
  StockLocation, StockMove, StockSetting,
} from "@/services/inventory/contracts";
import type {
  Employee, AttendanceScan, DayMark, OvertimeSheet, OvertimeLine, PayrollRun,
  PayrollAdjustment, PayRuleSet, EmployeeDocument, LeaveRequest,
  AllowanceWithholding, ContributionRate, Enrolment, Task,
} from "@/services/hr/contracts";
import type {
  WorkOrder, ProgressEntry, Product, BomComponent, BomRevision,
  DesignTask, DesignRevision, DesignQuestion,
} from "@/services/production/contracts";
import type {
  Delivery, DeliveryLine, PackingBox, BoxLine, Installation, InstallationLine, Snag, Handover,
} from "@/services/delivery/contracts";

export interface DemoUser extends User {
  modules: ModuleGrant[];
  authorities: Authority[];
}

/** One audit row per mutation, always. Business rows and their audit row are
 *  written together or not at all (`03-api.md`). */
export interface AuditRow {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  service: string;
  entity: string;
  entity_no: string;
  action: string;
  outcome: "ok" | "refused" | "duplicate" | "noop";
  reason: string | null;
  /** What actually changed, field by field, for the rows where that matters.
   *  A ledger entry says who and when either way; anomaly and fraud questions
   *  need *what* — the amount before and after, the account it moved to, the
   *  document that arrived with it (D84). */
  detail?: Record<string, unknown> | null;
}

/** The third-party seam (ADR-008). Written on every domain event; in Phase 1
 *  nothing subscribes, which is the point — the seam exists before it is
 *  needed, so a Chat bot never needs a second write path. */
export interface OutboxRow {
  id: string;
  service: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  delivered_at: string | null;
}

export interface DemoState {
  /** Which demo user is acting. Phase 2 reads this from Supabase Auth. */
  session_user_id: string;

  users: DemoUser[];

  vendors: Vendor[];
  uom: Uom[];
  uom_conversions: UomConversion[];
  item_categories: ItemCategory[];
  items: Item[];
  projects: Project[];
  /** What the customer actually ordered, line by line (D150). */
  project_lines: ProjectLine[];

  pr_documents: PrDocument[];
  pr_lines: PrLine[];
  pr_approvals: PrApproval[];
  payment_rounds: PaymentRound[];
  payment_round_lines: PaymentRoundLine[];
  receipts: Receipt[];
  line_settlements: LineSettlement[];
  line_notes: LineNote[];
  approval_requests: ApprovalRequest[];
  round_transfers: RoundTransfer[];
  approval_batches: ApprovalBatch[];
  line_variances: LineVariance[];

  purchase_orders: PurchaseOrder[];
  po_lines: PoLine[];
  po_schedule: PoScheduleTerm[];

  accounts: Account[];
  transaction_types: TransactionType[];
  transactions: Transaction[];
  transaction_lines: TransactionLine[];
  payment_allocations: PaymentAllocation[];
  evidence_inbox: EvidenceInboxRow[];
  /** Rekening koran, and its lines. For the two leadership accounts this is
   *  how their ledger rows come to exist at all (D180). */
  bank_statements: BankStatement[];
  statement_lines: StatementLine[];

  /** The payment calendar: what repeats, what changed in one month, and which
   *  ledger row somebody says settled it. */
  cash_components: CashComponent[];
  cash_overrides: CashOverride[];
  cash_settlements: CashSettlement[];

  attachments: Attachment[];
  attachment_links: AttachmentLink[];

  /** HR. Payroll lines are derived on read from attendance and approved
   *  overtime, never stored — a stored figure is one that can disagree with
   *  the days behind it (A3). */
  employees: Employee[];
  /** One row per tap on the reader. The day is derived (D141). */
  attendance_scans: AttendanceScan[];
  /** What HRD says about a day that no reader can know (D142). */
  day_marks: DayMark[];
  /** Overtime is a sheet with lines on it — one night, many names for
   *  production, one session for staff (D146). */
  overtime_sheets: OvertimeSheet[];
  overtime_lines: OvertimeLine[];
  payroll_runs: PayrollRun[];
  /** Berkas 201: somebody's own file, and what is missing from it (D177). */
  employee_documents: EmployeeDocument[];
  /** Asked for, then decided. Approving one writes the timesheet mark (D178). */
  leave_requests: LeaveRequest[];

  /** The rule book, dated. Never edited: a change writes the next version, so
   *  a payslip from March stays recomputable under March's rule (D173). */
  pay_rule_sets: PayRuleSet[];
  /** Added or taken off a payslip by a person, with a reason (D155). */
  payroll_adjustments: PayrollAdjustment[];
  /** One person, one day, no tunjangan — HRD's decision, kept apart from what
   *  the day itself was (D250). */
  allowance_withholdings: AllowanceWithholding[];
  /** The public percentages, dated — a contribution recomputed for March uses
   *  March's rate (D259). */
  contribution_rates: ContributionRate[];
  /** Who is in which scheme, from when. HRD's to enter, accounting's to audit
   *  (owner, D259). Append-only: ending an enrolment sets `ended_on`. */
  enrolments: Enrolment[];
  /** What one person is expected to do, by a date — the record a KPI over
   *  deliverables has to be built on (D260). */
  tasks: Task[];

  /* --- production ------------------------------------------------- */
  /** What is being made, in what quantity, by when (D148). */
  work_orders: WorkOrder[];
  /** Work done, append-only — a correction is a negative entry (A5). */
  production_progress: ProgressEntry[];
  /** What we sell and make, and what each one is made of (D149). */
  products: Product[];
  bom_components: BomComponent[];
  /** One dated version of a BOM. A draft is edited; a released one is frozen,
   *  and the work orders written against it keep pointing at it (D256). */
  bom_revisions: BomRevision[];
  /** The drafters' queue: what has to be drawn, which revision the floor may
   *  cut from, and what is stuck on an answer (D179). */
  design_tasks: DesignTask[];
  design_revisions: DesignRevision[];
  design_questions: DesignQuestion[];

  /* --- inventory: stock -------------------------------------------- */
  /** Where stock lives, and how low is too low. Settings, not quantities —
   *  the quantity is the sum of the moves (D170). */
  stock_locations: StockLocation[];
  stock_settings: StockSetting[];
  /* The inventory of numbers somebody might think are theirs to change, with
     what each one does to figures that already exist (D214). */
  app_settings: AppSetting[];
  /* John Lau's conversations. Kept because *what did it tell me on Tuesday*
     is asked after somebody acted on the answer (D217). */
  assistant_turns: AssistantTurn[];
  /** Append-only. A mistake is another move with a reason (A5, D171). */
  stock_moves: StockMove[];

  /* --- inventory: timber ------------------------------------------- */
  /** Logs are bought by the load and used as boards — two quantities with a
   *  saw between them (D153). */
  log_purchases: LogPurchase[];
  log_pieces: LogPiece[];
  /* The last leg: what left the yard, what was fitted, what was found wrong,
     and the one record that says a job is finished (D209). */
  deliveries: Delivery[];
  /** One packed box, labelled with a code the crew scans on site (D262). */
  packing_boxes: PackingBox[];
  box_lines: BoxLine[];
  delivery_lines: DeliveryLine[];
  installations: Installation[];
  installation_lines: InstallationLine[];
  snags: Snag[];
  handovers: Handover[];

  sawn_boards: SawnBoard[];
  /* What happened to the boards after the saw — issues, returns, scrap,
     opname. The `sawn` side is derived from `sawn_boards` rather than copied
     here, so no fact is stored twice (D203). */
  board_moves: BoardMove[];

  /* --- marketing: the Package programme ---------------------------- */
  /** Scraped, enriched, scored — then three agents each, approached in order
   *  until one agrees (D183). */
  /** Country → region → city → the local label, so a figure can roll up once
   *  the scrape leaves one coast (D187). */
  markets: Market[];
  properties: Property[];
  property_agents: PropertyAgent[];
  /** The agent who agreed, and what they have introduced since (D185). */
  sales_reps: SalesRep[];
  referrals: Referral[];
  /** What the scrape found, before it is a property. */
  scrape_rows: ScrapeRow[];

  audit_log: AuditRow[];
  /** What people *did*, as opposed to what changed: kept 30 days in detail,
   *  rolled up daily, and those recaps kept six months (D188, Q22). */
  activity_events: ActivityEvent[];
  activity_daily: ActivityDaily[];
  outbox: OutboxRow[];

  /** The `core.doc_numbers` table: prefix + office day -> sequence.
   *  The database mints every identifier (ADR-005), and here the store is the
   *  database. One counter, no collision loop. */
  doc_numbers: Record<string, number>;

  /** `(service:endpoint:key)` -> the first response. A replay returns it
   *  unchanged, marked `duplicate`. */
  idempotency: Record<string, unknown>;
}

export type SessionView = Session;
