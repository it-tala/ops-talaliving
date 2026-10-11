import type { DemoState } from "../state";
import {
  USERS, ACCOUNTS, TRANSACTION_TYPES, UOM, UOM_CONVERSIONS,
  ITEM_CATEGORIES, ITEMS, PROJECTS, PROJECT_LINES, VENDORS,
} from "./reference";
import {
  PR_DOCUMENTS, PR_LINES, PR_APPROVALS, PAYMENT_ROUNDS, PAYMENT_ROUND_LINES,
  RECEIPTS, PURCHASE_ORDERS, PO_LINES, PO_SCHEDULE, ROUND_TRANSFERS,
  LINE_VARIANCES, LINE_SETTLEMENTS, LINE_NOTES, APPROVAL_REQUESTS, APPROVAL_BATCHES,
} from "./pr";
import {
  TRANSACTIONS, TRANSACTION_LINES, PAYMENT_ALLOCATIONS, EVIDENCE_INBOX,
} from "./ledger";
import { ATTACHMENTS, ATTACHMENT_LINKS } from "./documents";
import { RECEIVING_ATTACHMENTS, RECEIVING_INBOX } from "./receiving";
import { CASH_COMPONENTS, CASH_OVERRIDES, CASH_SETTLEMENTS } from "./cash";
import { SUBSCRIPTIONS, SUBSCRIPTION_PAYMENTS, SUBSCRIPTION_FX } from "./subscriptions";
import { CASHFLOW_LINES, CASHFLOW_OVERRIDES, CASHFLOW_RECEIPTS, CASHFLOW_OPENINGS, CASHFLOW_SETTINGS } from "./cashflow";
import {
  EMPLOYEES, ATTENDANCE_SCANS, DAY_MARKS, OVERTIME_SHEETS, OVERTIME_LINES,
  PAYROLL_RUNS, PAYROLL_ADJUSTMENTS, ALLOWANCE_WITHHOLDINGS,
} from "./hr";
import { WORK_ORDERS, PRODUCTION_PROGRESS, VENDOR_LEGS, WORK_SLOTS, DAILY_TARGETS } from "./production";
import { PRODUCTS, BOM_COMPONENTS, BOM_REVISIONS, BOM_RATES, BOM_NORMS, FINISHING_RECIPES } from "./products";
import { APP_SETTINGS } from "./settings";
import { LOG_PURCHASES, LOG_PIECES, LOG_COSTS, SAWN_BOARDS, BOARD_MOVES } from "./timber";
import {
  DELIVERIES, DELIVERY_LINES, INSTALLATIONS, INSTALLATION_LINES, SNAGS, HANDOVERS,
} from "./delivery";
import { PACKING_BOXES, BOX_LINES } from "./boxes";
import { STOCK_LOCATIONS, STOCK_SETTINGS, STOCK_MOVES } from "./stock";
import { ASSETS, ASSET_CATEGORIES, ASSET_SERVICES } from "./assets";
import { PAY_RULE_SETS } from "./payrules";
import { CONTRIBUTION_RATES, ENROLMENTS } from "./contributions";
import { GOALS, TASKS, TASK_ROUTINES } from "./tasks";
import { WORK_LOG } from "./worklog";
import { BACKLOG } from "./backlog";
import { EMPLOYEE_IDENTITIES } from "./identity";
import { EMPLOYEE_DOCUMENTS, LEAVE_REQUESTS } from "./hrfiles";
import { CLAUSE_CHECKLIST, CONTRACT_CLAUSES, EMPLOYMENT_CONTRACTS } from "./contracts";
import { DESIGN_TASKS, DESIGN_REVISIONS, DESIGN_QUESTIONS } from "./design";
import { BANK_STATEMENTS, STATEMENT_LINES } from "./statements";
import { MARKETS, PROPERTIES, PROPERTY_AGENTS, SALES_REPS, REFERRALS, SCRAPE_ROWS } from "./marketing";
import { AUDIT_SEED, ACTIVITY_EVENTS, ACTIVITY_DAILY } from "./activity";

export * from "./reference";

/** A fresh sandbox. `Reset demo data` rebuilds from here, so this function
 *  must never return shared references — every caller gets its own copy. */
/** A fingerprint of the shape and the reference data.
 *
 *  The sandbox is kept in `localStorage`, and a saved snapshot from before a
 *  change quietly wins over the fixtures — which is how a newly added account
 *  can be in the code and absent from the screen (F24). Anything that changes
 *  the tables, the accounts or the people invalidates what is stored, so the
 *  demo starts from the fixtures again rather than from a shape that no longer
 *  exists.
 */
/** Bumped by hand whenever the fixtures change in a way a saved sandbox would
 *  hide. Counting rows cannot do this job: a visitor who records one delivery
 *  changes every count, and their own work is exactly what the snapshot is
 *  for. A version somebody types when they edit the fixtures separates "the
 *  demo data moved" from "somebody used the demo". */
export const FIXTURE_VERSION = "2026-09-29.wib";

export function stateSignature(state: DemoState): string {
  return [
    FIXTURE_VERSION,
    Object.keys(state).sort().join(","),
    state.accounts.map((a) => a.code).join(","),
    state.users.map((u) => u.email).join(","),
    state.transaction_types.map((t) => t.code).join(","),
  ].join("|");
}

export function initialState(): DemoState {
  return structuredClone({
    session_user_id: "usr_putri",

    users: USERS,
    vendors: VENDORS,
    uom: UOM,
    uom_conversions: UOM_CONVERSIONS,
    item_categories: ITEM_CATEGORIES,
    items: ITEMS,
    projects: PROJECTS.map((p) => ({
      ...p,
      client_id: p.client_name ? `cl_${p.code}` : null,
      /* The fixtures' running projects are in production, the closed ones
         done — the same reading 0111 gives the real ones. */
      status: p.status ?? (p.is_active ? "IN_PRODUCTION" : "DONE"),
    })),
    project_lines: PROJECT_LINES,
    clients: PROJECTS.filter((p) => p.client_name).map((p, i) => ({
      id: `cl_${p.code}`, code: `CL-${String(i + 1).padStart(4, "0")}`, name: p.client_name!,
      contact_name: null, phone: null, email: null, address: p.location, npwp: null, note: null,
      archived_at: null,
    })),
    project_status_log: [{
      project_id: "prj_26004", from_status: "QUOTATION_SENT", to_status: "LOST",
      reason: "Klien memilih vendor lokal, sekitar 15% lebih murah", reason_code: "PRICE",
      changed_by: "rina@talaliving.com", changed_at: "2026-09-24T03:00:00Z",
    }],
    quotations: [],
    quotation_lines: [],
    /* One design meeting on 26003 (P3): who went, what was decided, and the
       coffee table the client wants lower — a revision request on the item. */
    client_activities: [{
      id: "act_26003_m1", client_id: "cl_26003", project_id: "prj_26003", quotation_id: null,
      kind: "meeting", happened_on: "2026-10-01", summary: "Review render tipe 2BR dan 3BR di lokasi",
      follow_up_on: "2026-10-08", next_action: "Kirim render revisi coffee table",
      follow_up_done_at: null, follow_up_done_by: null, follow_up_result: null,
      created_by: "usr_rina", created_at: "2026-10-01T08:00:00Z",
    }],
    meeting_attendees: [
      { id: "ma_1", activity_id: "act_26003_m1", seq: 1, side: "tala", user_id: "usr_rina", name: null, role: null },
      { id: "ma_2", activity_id: "act_26003_m1", seq: 2, side: "tala", user_id: "usr_made", name: null, role: "Workshop" },
      { id: "ma_3", activity_id: "act_26003_m1", seq: 3, side: "client", user_id: null, name: "Bp. Agus", role: "Owner" },
    ],
    meeting_points: [
      { id: "mp_1", activity_id: "act_26003_m1", project_id: "prj_26003", happened_on: "2026-10-01", seq: 1, kind: "decision",
        body: "Meja makan 6 kursi tipe 3BR disetujui", design_item_id: "di_4", owner_id: null, due_on: null,
        closed_at: null, closed_by: null, closed_note: null, created_by: "usr_rina", created_at: "2026-10-01T08:00:00Z" },
      { id: "mp_2", activity_id: "act_26003_m1", project_id: "prj_26003", happened_on: "2026-10-01", seq: 2, kind: "revision",
        body: "Coffee table lebih rendah, 380 mm", design_item_id: "di_2", owner_id: "usr_made", due_on: "2026-10-05",
        closed_at: null, closed_by: null, closed_note: null, created_by: "usr_rina", created_at: "2026-10-01T08:00:01Z" },
      { id: "mp_3", activity_id: "act_26003_m1", project_id: "prj_26003", happened_on: "2026-10-01", seq: 3, kind: "action",
        body: "Kirim sampel finishing walnut", design_item_id: null, owner_id: "usr_rina", due_on: "2026-10-10",
        closed_at: null, closed_by: null, closed_note: null, created_by: "usr_rina", created_at: "2026-10-01T08:00:02Z" },
    ],
    /* One project's design to open (P4): 26003 RESIDENCE KUTA, two
       collections, the tree the drafters work in (D379). */
    design_collections: [
      { id: "dc_26003_A", project_id: "prj_26003", code: "A", name: "TYPE 2BR", note: "24 unit", created_at: "2026-09-26T02:00:00Z" },
      { id: "dc_26003_B", project_id: "prj_26003", code: "B", name: "TYPE 3BR", note: "12 unit", created_at: "2026-09-26T02:00:00Z" },
    ],
    design_rooms: [
      { id: "dr_A_LR", collection_id: "dc_26003_A", code: "LR", name: "Living room", sort: 1 },
      { id: "dr_A_MB", collection_id: "dc_26003_A", code: "MB", name: "Master bedroom", sort: 2 },
      { id: "dr_B_DN", collection_id: "dc_26003_B", code: "DN", name: "Dining", sort: 1 },
    ],
    design_items: [
      { id: "di_1", item_no: "26003-A-LR-01", room_id: "dr_A_LR", seq: 1, name: "Sofa 3 seater", qty: 24, length_mm: 2100, width_mm: 900, height_mm: 780, origin: "tala", product_code: null, note: null, dropped_at: null, drop_reason: null, created_at: "2026-09-26T02:00:00Z", updated_at: "2026-09-26T02:00:00Z", factory_line_id: "fql_1" },
      { id: "di_2", item_no: "26003-A-LR-02", room_id: "dr_A_LR", seq: 2, name: "Coffee table", qty: 24, length_mm: 1100, width_mm: 600, height_mm: 420, origin: "adapted", product_code: null, note: "Klien minta lebih rendah, 380 mm", dropped_at: null, drop_reason: null, created_at: "2026-09-26T02:00:00Z", updated_at: "2026-09-26T02:00:00Z", factory_line_id: "fql_2" },
      { id: "di_3", item_no: "26003-A-MB-01", room_id: "dr_A_MB", seq: 1, name: "Bed 160 + headboard", qty: 24, length_mm: 1700, width_mm: 2150, height_mm: 1100, origin: "client", product_code: null, note: null, dropped_at: null, drop_reason: null, created_at: "2026-09-26T02:00:00Z", updated_at: "2026-09-26T02:00:00Z" },
      { id: "di_4", item_no: "26003-B-DN-01", room_id: "dr_B_DN", seq: 1, name: "Dining table 6 seats", qty: 12, length_mm: 1800, width_mm: 900, height_mm: 750, origin: "tala", product_code: "PRD-MJ-220", note: null, dropped_at: null, drop_reason: null, created_at: "2026-09-26T02:00:00Z", updated_at: "2026-09-26T02:00:00Z" },
    ],
    design_approvals: [
      { id: "da_1", item_id: "di_4", decision: "approved", decided_on: "2026-10-01", channel: "meeting", client_person: "Bp. Agus", attachment_id: null, evidence_attachment_id: null, note: "Disetujui di meeting lokasi", recorded_by: "usr_rina", recorded_at: "2026-10-01T06:00:00Z" },
    ],
    /* Studio Desain (0248): the six boxes have something to show — the sofa
       drawn twice, the coffee table with no render needed, the dining table
       complete but for its photo, the bed untouched. Files are in
       ATTACHMENT_LINKS (att_d…). */
    design_item_specs: [
      { id: "dsp_1", item_id: "di_1", version: 1, body: "Rangka mahoni oven · busa D32 12 cm · kain linen Oatmeal (14 m) · kaki natural doff", note: null, written_by: "usr_made", written_at: "2026-10-07T03:10:00Z" },
      { id: "dsp_2", item_id: "di_2", version: 1, body: "Top travertine 20 mm honed · rangka hollow 40×40 powder coat hitam doff", note: null, written_by: "usr_made", written_at: "2026-10-08T02:00:00Z" },
      { id: "dsp_3", item_id: "di_4", version: 1, body: "Top solid suar 40 mm · kaki besi 60×60 hitam doff · finishing natural", note: null, written_by: "usr_made", written_at: "2026-09-29T04:00:00Z" },
      { id: "dsp_4", item_id: "di_4", version: 2, body: "Top solid suar 40 mm · kaki besi 60×60 hitam doff · finishing walnut", note: "Finishing diganti walnut di meeting 1 Okt", written_by: "usr_made", written_at: "2026-10-02T04:00:00Z" },
    ],
    design_box_skips: [
      { id: "dbs_1", item_id: "di_2", box: "render", skipped: true, note: "Desain dari referensi klien", set_by: "usr_made", set_at: "2026-10-08T02:05:00Z" },
    ],
    design_link_notes: { lnk_d2: "Sandaran turun ke 78 cm, permintaan Pak Agus" },
    design_products: {},
    /* Two factories asked for the living room (0256, O2): Jepara in rupiah,
       chosen for both items; Vietnam in dollars for the sofa, not chosen. */
    factory_quotes: [
      { id: "fq_1", fq_no: "fq-26-10-06_01", project_id: "prj_26003", vendor_id: "vnd_60", currency: "IDR",
        quoted_on: "2026-10-06", valid_until: "2026-11-06", note: "Harga franco gudang Jepara, belum packing ekspor",
        attachment_id: null, created_by: "usr_andi", created_at: "2026-10-06T04:00:00Z",
        voided_at: null, voided_by: null, void_reason: null },
      { id: "fq_2", fq_no: "fq-26-10-08_01", project_id: "prj_26003", vendor_id: "vnd_61", currency: "USD",
        quoted_on: "2026-10-08", valid_until: "2026-10-31", note: "FOB Ho Chi Minh",
        attachment_id: null, created_by: "usr_andi", created_at: "2026-10-08T03:00:00Z",
        voided_at: null, voided_by: null, void_reason: null },
    ],
    factory_quote_lines: [
      { id: "fql_1", quote_id: "fq_1", design_item_id: "di_1", unit_price: 6850000, lead_time_days: 45, moq: null, note: null },
      { id: "fql_2", quote_id: "fq_1", design_item_id: "di_2", unit_price: 2400000, lead_time_days: 30, moq: null, note: null },
      { id: "fql_3", quote_id: "fq_2", design_item_id: "di_1", unit_price: 395, lead_time_days: 60, moq: 20, note: "Kain dari pabrik" },
    ],

    pr_documents: PR_DOCUMENTS,
    pr_lines: PR_LINES,
    pr_approvals: PR_APPROVALS,
    payment_rounds: PAYMENT_ROUNDS,
    payment_round_lines: PAYMENT_ROUND_LINES,
    receipts: RECEIPTS,
    receiving_inbox: RECEIVING_INBOX,
    line_settlements: LINE_SETTLEMENTS,
    line_notes: LINE_NOTES,
    approval_requests: APPROVAL_REQUESTS,
    approval_batches: APPROVAL_BATCHES,
    round_transfers: ROUND_TRANSFERS,
    line_variances: LINE_VARIANCES,

    purchase_orders: PURCHASE_ORDERS,
    po_lines: PO_LINES,
    po_schedule: PO_SCHEDULE,

    accounts: ACCOUNTS,
    transaction_types: TRANSACTION_TYPES,
    transactions: TRANSACTIONS,
    transaction_lines: TRANSACTION_LINES,
    payment_allocations: PAYMENT_ALLOCATIONS,
    evidence_inbox: EVIDENCE_INBOX,

    cash_components: CASH_COMPONENTS,
    cash_overrides: CASH_OVERRIDES,
    cash_settlements: CASH_SETTLEMENTS,
    subscriptions: SUBSCRIPTIONS,
    subscription_payments: SUBSCRIPTION_PAYMENTS,
    subscription_fx: SUBSCRIPTION_FX,
    cashflow_lines: CASHFLOW_LINES,
    cashflow_overrides: CASHFLOW_OVERRIDES,
    cashflow_receipts: CASHFLOW_RECEIPTS,
    cashflow_openings: CASHFLOW_OPENINGS,
    cashflow_settings: CASHFLOW_SETTINGS,

    employees: EMPLOYEES,
    attendance_scans: ATTENDANCE_SCANS,
    /* The sandbox has a warehouse point so a phone can be judged against it;
       the real database seeds none (0188) — somebody stands there and sets it.
       Near the Denpasar office the demo already reckons time from. */
    work_sites: [{
      id: "site_gudang", code: "GUDANG", name: "Gudang", lat: -8.6705, lng: 115.2126,
      radius_m: 150, active: true, updated_at: "2026-09-29T00:00:00.000Z",
    }],
    scan_locations: [],
    day_marks: DAY_MARKS,
    overtime_sheets: OVERTIME_SHEETS,
    overtime_lines: OVERTIME_LINES,
    payroll_runs: PAYROLL_RUNS,
    payroll_adjustments: PAYROLL_ADJUSTMENTS,
    allowance_withholdings: ALLOWANCE_WITHHOLDINGS,
    contribution_rates: CONTRIBUTION_RATES,
    enrolments: ENROLMENTS,
    tasks: TASKS,
    task_routines: TASK_ROUTINES,
    goals: GOALS,
    work_log: WORK_LOG,
    backlog: BACKLOG,
    employee_identities: EMPLOYEE_IDENTITIES,
    /* Five of the six office personas are also on the roster (W7), and Karjo
       from the workshop floor (D331). Wulan (HRD) and
       the shared IT account are not — the ordinary case of an account that is
       nobody's employee record. */
    employee_accounts: [
      { employee_no: "K-001", user_id: "usr_evin" },
      { employee_no: "K-004", user_id: "usr_putri" },
      { employee_no: "K-007", user_id: "usr_anggun" },
      { employee_no: "K-011", user_id: "usr_andi" },
      { employee_no: "K-014", user_id: "usr_made" },
      /* Karjo, a daily worker with no module: the employee-only account whose
         whole app is `/saya` (D331). */
      { employee_no: "B-009", user_id: "usr_karjo" },
    ],
    pay_rule_sets: PAY_RULE_SETS,
    employee_documents: EMPLOYEE_DOCUMENTS,
    employment_contracts: EMPLOYMENT_CONTRACTS,
    contract_clauses: CONTRACT_CLAUSES,
    clause_checklist: CLAUSE_CHECKLIST,
    leave_requests: LEAVE_REQUESTS,
    design_tasks: DESIGN_TASKS,
    design_revisions: DESIGN_REVISIONS,
    design_questions: DESIGN_QUESTIONS,
    bank_statements: BANK_STATEMENTS,
    statement_lines: STATEMENT_LINES,

    markets: MARKETS,
    properties: PROPERTIES,
    property_agents: PROPERTY_AGENTS,
    sales_reps: SALES_REPS,
    referrals: REFERRALS,
    scrape_rows: SCRAPE_ROWS,

    work_orders: WORK_ORDERS,
    production_progress: PRODUCTION_PROGRESS,
    work_slots: WORK_SLOTS,
    daily_targets: DAILY_TARGETS,
    vendor_legs: VENDOR_LEGS,
    products: PRODUCTS,
    bom_components: BOM_COMPONENTS,
    bom_revisions: BOM_REVISIONS,
    bom_rates: BOM_RATES,
    bom_norms: BOM_NORMS,
    finishing_recipes: FINISHING_RECIPES,

    stock_locations: STOCK_LOCATIONS,
    stock_settings: STOCK_SETTINGS,
    asset_categories: ASSET_CATEGORIES,
    assets: ASSETS,
    asset_services: ASSET_SERVICES,
    app_settings: APP_SETTINGS,
    assistant_turns: [],
    stock_moves: STOCK_MOVES,
    product_moves: [],
    product_settings: [],

    log_purchases: LOG_PURCHASES,
    log_pieces: LOG_PIECES,
    log_costs: LOG_COSTS,
    deliveries: DELIVERIES,
    delivery_lines: DELIVERY_LINES,
    packing_boxes: PACKING_BOXES,
    box_lines: BOX_LINES,
    installations: INSTALLATIONS,
    installation_lines: INSTALLATION_LINES,
    snags: SNAGS,
    handovers: HANDOVERS,
    sawn_boards: SAWN_BOARDS,
    board_moves: BOARD_MOVES,

    attachments: [...ATTACHMENTS, ...RECEIVING_ATTACHMENTS],
    attachment_links: ATTACHMENT_LINKS,

    audit_log: AUDIT_SEED,
    activity_events: ACTIVITY_EVENTS,
    activity_daily: ACTIVITY_DAILY,
    outbox: [],

    /* Seeded past the fixtures so a newly minted number never collides with
     * one already in the data. */
    doc_numbers: {
      "pr:2026-09-10": 2,
      "ask:2026-09-10": 1,
      "trx:2026-09-09": 2,
      "pay:2026-09-09": 1,
      "po:2026-09-09": 1,
    },
    idempotency: {},
  } satisfies DemoState);
}
