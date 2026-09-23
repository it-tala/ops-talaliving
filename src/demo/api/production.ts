/** Implements `/api/v1/production` from `03-api.md`. */
import { refused, ok, invalid, notFound, noop, isOk, type Result } from "@/services/_shared/envelope";
import {
  PROCESS_STAGES, RETIRED_STAGES, VENDOR_PROCESSES, VENDOR_PROCESS_NAME, DESIGN_KIND_LABEL, ROUTE, STAGE_NAME, goodsOnSite,
  type WorkOrder, type WorkOrderView, type ProgressEntry, type ProductView,
  type DesignKind, type DesignTaskView, type RouteCode, type BomExplosion,
  type VendorLegView, type VendorRecord,
  type WorkAttribution, type BomKind,
} from "@/services/production/contracts";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import {
  workOrderView, workOrderViews, productView, productViews,
  currentBomRev, draftBomRev, bomAt, bomDiff, bomRevisions, lineRate, bomRepinnable, explodeBom, bomWouldCycle,
  designQueue, designTaskView, designGaps, officeToday,
  unresolvedNames, workAttribution, openVendorLegs, vendorLegViews, vendorRecords, type UnresolvedName,
} from "../production-derive";
import {
  latency, actingUser, requireModule, requireAuthority, conflict, replayed, remember,
} from "./_kit";
import { settingNumber } from "../settings";

const SERVICE = "production" as const;

export async function listStages() {
  await latency();
  return ok(SERVICE, PROCESS_STAGES);
}

export async function listWorkOrders(
  opts: { include_done?: boolean } = {},
): Promise<Result<WorkOrderView[]>> {
  await latency();
  const rows = workOrderViews(getState());
  return ok(SERVICE, opts.include_done ? rows : rows.filter((w) => w.status === "OPEN"));
}

export async function getWorkOrder(woNo: string): Promise<Result<WorkOrderView>> {
  await latency();
  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === woNo);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${woNo}.`);
  return ok(SERVICE, workOrderView(state, wo));
}

/** Putting something on the floor.
 *
 *  The due date is required, and that is the point of the record: a workshop
 *  always knows what it is building, and loses track of which of the eleven
 *  things in front of it is the one that is late.
 */
export async function createWorkOrder(
  input: {
    /** The catalogue product, where there is one. It is what lets the
     *  customer's order line and the floor be compared (D150). */
    product_code?: string | null;
    item_name: string;
    description?: string | null;
    qty: number;
    uom: string;
    project_code?: string | null;
    due_date: string;
    /** Which stages this order goes through (D254). Defaults to in-house,
     *  which is what most orders are; a subcontracted one is chosen, never
     *  inferred. */
    route?: RouteCode;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<WorkOrderView>> {
  await latency();
  const cached = replayed<WorkOrderView>(SERVICE, "createWorkOrder", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  if (!input.item_name.trim()) {
    return invalid(SERVICE, "item_required", "What is being made?", { field: "item_name" });
  }
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "An order for nothing is not an order.", { field: "qty" });
  }
  if (!input.due_date) {
    return invalid(
      SERVICE, "due_date_required",
      "A work order with no date cannot be late, which means nobody can tell when it is.",
      { field: "due_date" },
    );
  }

  const user = actingUser();
  const productCode = input.product_code?.trim().toUpperCase() || null;
  if (productCode && !getState().products.some((p) => p.product_code === productCode)) {
    return invalid(
      SERVICE, "product_not_found",
      `Tidak ada produk ${productCode} di katalog. Kosongkan kalau ini barang sekali buat.`,
      { field: "product_code" },
    );
  }
  let woNo = "";
  apply((draft) => {
    woNo = nextDocNumber(draft, "spk");
    draft.work_orders.push({
      id: newId("wo"), wo_no: woNo,
      product_code: productCode,
      item_name: input.item_name.trim(),
      description: input.description?.trim() || null,
      qty: input.qty,
      uom: input.uom.trim() || "unit",
      project_code: input.project_code?.trim() || null,
      due_date: input.due_date,
      /* The BOM this order is written against, pinned **now** (D256). Null
         where the product has no released revision — and null means exactly
         that, never "whatever the current one turns out to be". */
      bom_rev: productCode
        ? currentBomRev(draft, draft.products.find((p) => p.product_code === productCode)!)
        : null,
      route: input.route ?? "IN_HOUSE",

      status: "OPEN",
      created_at: new Date().toISOString(), created_by: user.id,
      cancelled_reason: null,
      note: input.note?.trim() || null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "work_order", entity_no: woNo,
      action: "create", outcome: "ok", reason: null,
      detail: { item: input.item_name.trim(), qty: input.qty, due: input.due_date, route: input.route ?? "IN_HOUSE", by: user.email },
    });
  });
  const view = await getWorkOrder(woNo);
  if (view.data) remember(SERVICE, "createWorkOrder", idempotencyKey, view.data);
  return view;
}

/** Sending a subcontracted order out, and taking it back (D254).
 *
 *  Two acts, two dates, no status field. *Di vendor* is `sent && !returned`,
 *  derived on read like every other state here — a stored flag is one somebody
 *  forgets to move while the lorry is still on the road.
 *
 *  `expected_back` is the **vendor's promise**, the same shape as a purchase
 *  order's expected delivery (D234) and marked as a promise wherever it is
 *  printed. What it buys is the thing a subcontracted order otherwise has no
 *  way to say: *this is late, and it is not the workshop that is late*.
 */
export async function sendToVendor(
  input: {
    wo_no: string;
    vendor_id: string;
    process: string;
    qty: number;
    expected_back?: string | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<WorkOrderView>> {
  await latency();
  const cached = replayed<WorkOrderView>(SERVICE, "sendToVendor", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === input.wo_no);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${input.wo_no}.`);
  if (wo.status !== "OPEN") {
    return conflict(SERVICE, "wo_not_open", `${wo.wo_no} is ${wo.status}.`);
  }
  if (!VENDOR_PROCESSES.some((p) => p.code === input.process)) {
    return invalid(
      SERVICE, "unknown_process",
      `Tidak ada proses vendor bernama ${input.process}. Yang ada: ${VENDOR_PROCESSES.map((p) => p.name).join(", ")}.`,
      { field: "process" },
    );
  }
  /* Validated at the seam, by public id, never by reaching into another
     service's tables (ADR-004). */
  const vendor = state.vendors.find((v) => v.id === input.vendor_id);
  if (!vendor) {
    return invalid(SERVICE, "vendor_not_found", `No vendor ${input.vendor_id}.`, { field: "vendor_id" });
  }
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Berapa banyak yang dikirim?", { field: "qty" });
  }

  /* Already out, plus this trip, cannot exceed the order. Sending fourteen
     chairs from an order for twelve is not a slow vendor, it is a number
     somebody has to explain before the lorry leaves (W6, D280). */
  const out = state.vendor_legs
    .filter((l) => l.wo_id === wo.id && l.returned_on === null)
    .reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0);
  if (out + input.qty > wo.qty) {
    return invalid(
      SERVICE, "over_order",
      `${wo.wo_no} untuk ${wo.qty} ${wo.uom}, dan ${out} sudah di vendor — ${input.qty} lagi jadi ${out + input.qty}.`,
      { field: "qty", ordered: wo.qty, already_out: out },
    );
  }

  const user = actingUser();
  let legNo = "";
  apply((draft) => {
    legNo = nextDocNumber(draft, "vnl");
    draft.vendor_legs.push({
      id: newId("vlg"), leg_no: legNo, wo_id: wo.id,
      process: input.process, vendor_id: input.vendor_id, qty: input.qty,
      sent_on: officeToday(),
      expected_back: input.expected_back || null,
      returned_on: null, returned_qty: null,
      note: input.note?.trim() || null,
      created_by: user.id, created_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "vendor_leg", entity_no: legNo,
      action: "send", outcome: "ok", reason: input.note?.trim() || null,
      detail: {
        wo_no: wo.wo_no, vendor: vendor.name, process: input.process,
        qty: input.qty, expected_back: input.expected_back ?? null, by: user.email,
      },
    });
  });
  const view = await getWorkOrder(input.wo_no);
  if (isOk(view)) remember(SERVICE, "sendToVendor", idempotencyKey, view.data);
  return view;
}

/** The goods are back from one vendor, for one process.
 *
 *  `returned_qty` is a **number, not a tick**: twenty chair frames going out
 *  and eighteen coming back is the ordinary case, and the two that stayed are
 *  a question somebody has to put to the vendor rather than a rounding
 *  difference. More coming back than went is refused — that is somebody else's
 *  goods (W6, D280).
 */
export async function receiveFromVendor(
  input: { leg_no: string; returned_qty: number; returned_on?: string; note?: string | null },
): Promise<Result<WorkOrderView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const leg = state.vendor_legs.find((l) => l.leg_no === input.leg_no);
  if (!leg) return notFound(SERVICE, "leg_not_found", `Tidak ada pengiriman vendor ${input.leg_no}.`);
  const wo = state.work_orders.find((w) => w.id === leg.wo_id);
  if (!wo) return notFound(SERVICE, "wo_not_found", "Pesanan kerjanya tidak ada.");
  if (leg.returned_on) {
    return noop(SERVICE, workOrderView(state, wo));
  }

  const returned = input.returned_on || officeToday();
  if (returned < leg.sent_on) {
    return invalid(
      SERVICE, "returned_before_sent",
      `Tanggal kembali ${returned} lebih awal dari tanggal kirim ${leg.sent_on}.`,
      { field: "returned_on" },
    );
  }
  if (input.returned_qty < 0) {
    return invalid(SERVICE, "qty_negative", "Jumlah kembali tidak bisa negatif.", { field: "returned_qty" });
  }
  if (input.returned_qty > leg.qty) {
    return invalid(
      SERVICE, "over_sent",
      `Yang dikirim ${leg.qty} ${wo.uom}, yang dicatat kembali ${input.returned_qty}. Kalau vendor mengembalikan lebih, itu barang pesanan lain — catat terpisah.`,
      { field: "returned_qty", sent: leg.qty },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.vendor_legs.find((l) => l.id === leg.id)!;
    row.returned_on = returned;
    row.returned_qty = input.returned_qty;
    if (input.note?.trim()) row.note = input.note.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "vendor_leg", entity_no: row.leg_no,
      action: "receive", outcome: "ok", reason: input.note?.trim() || null,
      detail: {
        wo_no: wo.wo_no, sent: row.qty, returned: input.returned_qty,
        short_by: row.qty - input.returned_qty,
        promised: row.expected_back,
        late_days: row.expected_back && returned > row.expected_back
          ? Math.round((Date.parse(`${returned}T00:00:00+08:00`) - Date.parse(`${row.expected_back}T00:00:00+08:00`)) / 86_400_000)
          : 0,
        by: user.email,
      },
    });
  });
  return getWorkOrder(wo.wo_no);
}

/** How each vendor has actually behaved (W6, D282). */
export async function listVendorRecords(): Promise<Result<VendorRecord[]>> {
  await latency();
  return ok(SERVICE, vendorRecords(getState(), officeToday(),
    settingNumber(getState(), "vendor.min_legs_to_rate", 3)));
}

/** Everything still out at a vendor, worst first. */
export async function listVendorLegs(
  opts: { open_only?: boolean } = {},
): Promise<Result<VendorLegView[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, opts.open_only
    ? openVendorLegs(state, officeToday())
    : vendorLegViews(state, officeToday()));
}

/** Reporting work done.
 *
 *  Append-only: a correction is a **negative entry with a reason**, never an
 *  edit, because "how many were finished on Thursday" is a question somebody
 *  asks after the argument has already started (A5).
 *
 *  What this refuses and what it merely warns about is deliberate. More than
 *  the order's quantity is refused — it cannot be true. A stage running ahead
 *  of the one before it is **warned** about on the board and accepted here: it
 *  usually means a mis-keyed number or work that skipped a step, and refusing
 *  the report would only mean the work goes unrecorded (A6).
 */
export async function recordProgress(
  input: {
    wo_no: string;
    stage: string;
    qty: number;
    work_date: string;
    worked_by?: string | null;
    /** Optional, and deliberately so (D264): a subcontractor is a legitimate
     *  answer to *who did it*, so the link may be absent. What it may not be is
     *  a guess — the form offers a picker, the picker fills the name, and a
     *  name typed by hand is left unlinked for somebody to resolve. */
    worked_by_employee_id?: string | null;
    note?: string | null;
    source?: "manual" | "overtime_sheet";
    source_ref?: string | null;
  },
): Promise<Result<WorkOrderView>> {
  await latency();
  /* Who may report work.
   *
   *  Normally the workshop: `production.update`. But an entry that comes from
   *  a **signed overtime sheet** is not an act of whoever happens to be at the
   *  keyboard — it is the consequence of the signature, and the authority for
   *  it is that signature (D147). So leadership's `approve_overtime` is
   *  accepted for exactly that source, and nothing else. Without this the
   *  Direktur signs a sheet and the posting it causes is refused, which would
   *  leave the two halves of the same act disagreeing. */
  const denied = input.source === "overtime_sheet"
    ? requireAuthority(SERVICE, "approve_overtime")
    : requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === input.wo_no);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${input.wo_no}.`);
  if (!PROCESS_STAGES.some((s) => s.code === input.stage)) {
    /* Retired stages get their own sentence. `POTONG` is not a typo — it is a
       step this business had until it started buying rough pieces in (D275),
       and somebody typing it is describing work that used to happen here. The
       message says that rather than "no such stage", because the two send a
       person to different places. */
    const retired = RETIRED_STAGES.find((r) => r.code === input.stage);
    return invalid(
      SERVICE, "unknown_stage",
      retired
        ? `${retired.name} bukan lagi tahap di sini — barang mentah sekarang dibeli jadi, jadi yang dicatat di bengkel mulai dari ${STAGE_NAME(PROCESS_STAGES[0].code)}. Catatan lama dengan tahap ini tetap tersimpan.`
        : `No stage called ${input.stage}.`,
      { field: "stage", retired: !!retired },
    );
  }
  /* A stage this order's route does not contain (D254).
   *
   *  **Currently unreachable, and kept anyway.** Since D275 both routes carry
   *  the same four stages — what separates a subcontracted order is who held
   *  the piece, not which steps it passes — so nothing can be in the catalogue
   *  and off a route at the same time. The guard stays because a guard deleted
   *  for being unreachable is a guard nobody reinstates when the routes
   *  diverge again, and W6 is likely to diverge them. */
  const route = ROUTE(wo.route);
  /* The product's own stages, where it has them (D278). Refused rather than
     warned about for the same reason the route check is: reporting *Machinery*
     against a dining table is not a mis-keyed number, it is work on a step
     that does not exist for this thing. */
  const productStages = state.products.find((pr) => pr.product_code === wo.product_code)?.stages;
  if (productStages && !productStages.includes(input.stage)) {
    return invalid(
      SERVICE, "stage_not_on_product",
      `${STAGE_NAME(input.stage)} bukan tahap yang dilalui ${wo.product_code}. Tahapnya: ${productStages.map(STAGE_NAME).join(" → ")}.`,
      { field: "stage", product_code: wo.product_code, stages: productStages },
    );
  }
  if (!route.stages.includes(input.stage)) {
    return invalid(
      SERVICE, "stage_not_on_route",
      `${wo.wo_no} berjalan lewat rute "${route.name}" — tahap ${STAGE_NAME(input.stage)} tidak ada di rute itu. Tahapnya: ${route.stages.map(STAGE_NAME).join(" → ")}.`,
      { field: "stage", route: wo.route, stages: route.stages },
    );
  }
  /* Work reported on goods that are physically at the vendor.
   *
   *  Refused, not warned, and this is the line where warn-don't-block stops:
   *  every other refusal here is about a number that cannot be true, and this
   *  one is about a **place**. Nobody sanded eight window frames that are in
   *  somebody else's workshop. The fix is one click and the refusal names it,
   *  so nothing goes unrecorded — the work simply gets recorded after the fact
   *  it depends on (D255). */
  /* Since W6 this is a **quantity**, not a flag: six of twelve chairs at the
     upholsterer leaves six on the bench, and work reported on those six is
     legitimate. The refusal now fires only when there is nothing here at all
     (D280), and it names the legs so the fix is findable. */
  const openLegs = state.vendor_legs.filter((l) => l.wo_id === wo.id && l.returned_on === null);
  const atVendorQty = openLegs.reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0);
  if (!goodsOnSite({ route: wo.route, qty: wo.qty, at_vendor_qty: atVendorQty })) {
    return openLegs.length > 0
      ? conflict(
        SERVICE, "still_at_vendor",
        `Semua ${wo.qty} ${wo.uom} ${wo.wo_no} masih di vendor — ${openLegs.map((l) => `${l.qty} untuk ${VENDOR_PROCESS_NAME(l.process)} sejak ${l.sent_on}`).join(", ")}. Catat dulu yang kembali, baru laporkan pekerjaannya.`,
      )
      : conflict(
        SERVICE, "not_sent_yet",
        `${wo.wo_no} dibuat vendor dan belum pernah dikirim ke sana. Barangnya belum ada.`,
      );
  }
  if (!input.qty) {
    return invalid(SERVICE, "qty_required", "Nothing to report.", { field: "qty" });
  }
  if (input.worked_by_employee_id
    && !state.employees.some((emp) => emp.id === input.worked_by_employee_id)) {
    return invalid(
      SERVICE, "employee_not_found",
      "Karyawan yang dipilih tidak ada di data kepegawaian.",
      { field: "worked_by_employee_id" },
    );
  }
  if (input.qty < 0 && !input.note?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "A correction says why. A negative number with no sentence behind it is worse than the wrong one.",
      { field: "note" },
    );
  }
  if (wo.status !== "OPEN") {
    return conflict(SERVICE, "wo_not_open", `${wo.wo_no} is ${wo.status}.`);
  }

  /* A sheet posted twice adds nothing. The claim is the sheet number plus the
     stage and the order — the same shape as `source_ref` on a ledger row. */
  const claim = input.source_ref
    ? `${input.source_ref}|${wo.id}|${input.stage}`
    : null;
  if (claim && state.production_progress.some(
    (p) => p.source_ref && `${p.source_ref}|${p.wo_id}|${p.stage}` === claim,
  )) {
    const view = workOrderView(state, wo);
    return ok(SERVICE, view);
  }

  const done = state.production_progress
    .filter((p) => p.wo_id === wo.id && p.stage === input.stage)
    .reduce((a, p) => a + p.qty, 0);
  if (done + input.qty > wo.qty) {
    return invalid(
      SERVICE, "over_order",
      `${wo.wo_no} is for ${wo.qty} ${wo.uom}; ${done} already reported at this stage, so ${input.qty} more would be ${done + input.qty}.`,
      { field: "qty", ordered: wo.qty, already: done },
    );
  }
  if (done + input.qty < 0) {
    return invalid(
      SERVICE, "below_zero",
      `That correction would take ${input.stage} below zero.`,
      { field: "qty", already: done },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row: ProgressEntry = {
      id: newId("prg"), wo_id: wo.id, stage: input.stage, qty: input.qty,
      work_date: input.work_date,
      worked_by: input.worked_by?.trim() || null,
      worked_by_employee_id: input.worked_by_employee_id || null,
      worked_by_not_a_person: false,
      source: input.source ?? "manual",
      source_ref: input.source_ref ?? null,
      note: input.note?.trim() || null,
      recorded_by: user.id, recorded_at: new Date().toISOString(),
    };
    draft.production_progress.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "work_order", entity_no: wo.wo_no,
      action: "progress", outcome: "ok", reason: input.note?.trim() ?? null,
      detail: { stage: input.stage, qty: input.qty, source: row.source, ref: row.source_ref, by: user.email },
    });
  });
  return getWorkOrder(wo.wo_no);
}

/** Closing an order. Allowed before everything is finished, because a customer
 *  who took eleven of twelve doors is a real thing — but then it asks why. */
export async function closeWorkOrder(
  input: { wo_no: string; reason?: string | null },
): Promise<Result<WorkOrderView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === input.wo_no);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${input.wo_no}.`);
  if (wo.status !== "OPEN") {
    return conflict(SERVICE, "already_closed", `${wo.wo_no} is already ${wo.status}.`);
  }
  const view = workOrderView(state, wo);
  if (view.completed < wo.qty && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      `Only ${view.completed} of ${wo.qty} ${wo.uom} finished. Closing it anyway needs a sentence saying why.`,
      { field: "reason", completed: view.completed, ordered: wo.qty },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.work_orders.find((w) => w.wo_no === input.wo_no);
    if (!row) return;
    row.status = "DONE";
    if (input.reason?.trim()) row.note = input.reason.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "work_order", entity_no: wo.wo_no,
      action: "close", outcome: "ok", reason: input.reason?.trim() ?? null,
      detail: { completed: view.completed, ordered: wo.qty, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "production.work_order.closed",
      payload: { wo_no: wo.wo_no, completed: view.completed, ordered: wo.qty },
    });
  });
  return getWorkOrder(wo.wo_no);
}

/** Every entry behind a work order, newest first — the audit a supervisor
 *  actually reads. */
export async function listProgress(woNo: string): Promise<Result<ProgressEntry[]>> {
  await latency();
  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === woNo);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${woNo}.`);
  const rows = state.production_progress
    .filter((p) => p.wo_id === wo.id)
    .sort((a, b) => b.work_date.localeCompare(a.work_date) || b.recorded_at.localeCompare(a.recorded_at));
  return ok(SERVICE, rows);
}

/* ------------------------------------------------------------------ */
/* Master data: products and their bills of material                   */
/* ------------------------------------------------------------------ */

export async function listProducts(
  opts: { include_inactive?: boolean } = {},
): Promise<Result<ProductView[]>> {
  await latency();
  const rows = productViews(getState());
  return ok(SERVICE, opts.include_inactive ? rows : rows.filter((p) => p.active));
}

export async function getProduct(productCode: string): Promise<Result<ProductView>> {
  await latency();
  const state = getState();
  const p = state.products.find((x) => x.product_code === productCode);
  if (!p) return notFound(SERVICE, "product_not_found", `No product ${productCode}.`);
  return ok(SERVICE, productView(state, p));
}

/** Adding a product, or correcting one.
 *
 *  The code is set once and never edited: it is on the drawing, on the work
 *  order and in every bill of material that references it, and a code that
 *  moves is a reference that silently breaks (D149).
 */
export async function saveProduct(
  input: {
    product_code: string;
    name: string;
    category: string;
    uom: string;
    description?: string | null;
    length_mm?: number | null;
    width_mm?: number | null;
    height_mm?: number | null;
    dimension_note?: string | null;
    lead_time_days?: number | null;
    /** Which of the four this product goes through (D278). Omitted leaves it
     *  as it was; null is a deliberate *nobody has said*. */
    stages?: string[] | null;
    active?: boolean;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<ProductView>> {
  await latency();
  const cached = replayed<ProductView>(SERVICE, "saveProduct", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const code = input.product_code.trim().toUpperCase();
  if (!code) {
    return invalid(SERVICE, "code_required", "Kode produk dipakai di gambar dan di SPK.", { field: "product_code" });
  }
  if (!input.name.trim()) {
    return invalid(SERVICE, "name_required", "Namanya apa?", { field: "name" });
  }

  const user = actingUser();
  const existing = getState().products.find((p) => p.product_code === code);
  apply((draft) => {
    if (existing) {
      const row = draft.products.find((p) => p.product_code === code);
      if (!row) return;
      Object.assign(row, {
        name: input.name.trim(),
        category: input.category.trim() || row.category,
        uom: input.uom.trim() || row.uom,
        description: input.description?.trim() ?? row.description,
        length_mm: input.length_mm ?? row.length_mm,
        width_mm: input.width_mm ?? row.width_mm,
        height_mm: input.height_mm ?? row.height_mm,
        dimension_note: input.dimension_note?.trim() ?? row.dimension_note,
        lead_time_days: input.lead_time_days ?? row.lead_time_days,
        stages: input.stages ?? row.stages,
        active: input.active ?? row.active,
        note: input.note?.trim() ?? row.note,
      });
      writeAudit(draft, {
        service: SERVICE, entity: "product", entity_no: code,
        action: "update", outcome: "ok", reason: null,
        detail: { name: row.name, by: user.email },
      });
    } else {
      draft.products.push({
        id: newId("prd"), product_code: code,
        name: input.name.trim(),
        category: input.category.trim() || "Lain-lain",
        uom: input.uom.trim() || "unit",
        description: input.description?.trim() || null,
        length_mm: input.length_mm ?? null,
        width_mm: input.width_mm ?? null,
        height_mm: input.height_mm ?? null,
        dimension_note: input.dimension_note?.trim() || null,
        lead_time_days: input.lead_time_days ?? null,
        /* Null, not the four: nobody has said which stages this product goes
           through, and that is a thing to be named rather than assumed (D278,
           D150's rule). */
        stages: input.stages ?? null,
        labour_cost: null, labour_note: null,
        active: input.active ?? true,
        note: input.note?.trim() || null,
      });
      writeAudit(draft, {
        service: SERVICE, entity: "product", entity_no: code,
        action: "create", outcome: "ok", reason: null,
        detail: { name: input.name.trim(), by: user.email },
      });
    }
  });
  const view = await getProduct(code);
  if (view.data) remember(SERVICE, "saveProduct", idempotencyKey, view.data);
  return view;
}

/** The draft to write into, opened if there is none (0109's `open_draft`):
 *  a copy of the newest released revision, manual rates kept and catalogue
 *  rates let go, so the draft follows today's prices again. Returns the rev. */
function openDraft(productId: string, by: string, byEmail: string): number {
  const state = getState();
  const product = state.products.find((p) => p.id === productId)!;
  const existing = draftBomRev(state, product);
  if (existing !== null) return existing;
  const from = currentBomRev(state, product);
  const rev = state.bom_revisions
    .filter((r) => r.product_id === productId)
    .reduce((a, r) => Math.max(a, r.rev), 0) + 1;
  const fromRow = state.bom_revisions.find((r) => r.product_id === productId && r.rev === from);
  apply((draft) => {
    draft.bom_revisions.push({
      id: newId("bmr"), product_id: productId, rev,
      released_at: null, released_by: null, note: null,
      miscalc_percent: fromRow?.miscalc_percent ?? 0,
      created_at: new Date().toISOString(), created_by: by,
    });
    for (const b of draft.bom_components.filter((x) => x.product_id === productId && x.rev === from)) {
      const keep = b.rate_source === "manual" || b.kind === "labour";
      draft.bom_components.push({
        ...b, id: newId("bom"), rev,
        unit_rate: keep ? b.unit_rate ?? null : null,
        rate_source: keep && b.unit_rate != null ? "manual" : null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: "open_draft", outcome: "ok", reason: null,
      detail: { rev, copied_from: from, by: byEmail },
    });
  });
  return rev;
}

/** The code a labour line is filed under — derived from its label, so *one
 *  line per component per revision* still holds (0109). */
function labourCode(label: string): string {
  return "LABOUR:" + label.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase().slice(0, 40);
}

/** Putting a line on a bill of material, or changing one.
 *
 *  A line is a material from the item database, another product (a
 *  sub-assembly), or **labour** — a name, a quantity and a rate, costed like
 *  the rest (0109). A material's reference is a public code and is not
 *  validated against the catalogue: a workshop knows it needs a steel frame
 *  before procurement has a code for one, and the screen shows unresolved
 *  codes plainly instead (A6, D149).
 *
 *  `unit_rate` left empty follows the catalogue; typed, it is the estimator's
 *  number. Editing a line of a released revision edits its copy in the draft
 *  — the released line itself is never touched (A5).
 */
export async function saveBomComponent(
  input: {
    product_code: string;
    component_id?: string | null;
    kind: BomKind;
    ref_code?: string;
    label?: string | null;
    qty: number;
    uom: string;
    unit_rate?: number | null;
    waste_percent?: number;
    note?: string | null;
  },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);

  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Kebutuhan per unit harus lebih dari nol.", { field: "qty" });
  }
  if (input.unit_rate != null && input.unit_rate < 0) {
    return invalid(SERVICE, "negative_rate", "Rate tidak bisa negatif.", { field: "unit_rate" });
  }
  const label = input.label?.trim() || null;
  let ref: string;
  if (input.kind === "labour") {
    if (!label) {
      return invalid(SERVICE, "label_required", "Tenaga kerja apa? Mis. \"Tukang finishing\".", { field: "label" });
    }
    if (input.unit_rate == null) {
      return invalid(SERVICE, "rate_required", "Tenaga kerja butuh rate — upah per hari, per jam, atau per unit.", { field: "unit_rate" });
    }
    ref = labourCode(label);
  } else {
    ref = (input.ref_code ?? "").trim().toUpperCase();
    if (!ref) return invalid(SERVICE, "ref_required", "Komponennya apa?", { field: "ref_code" });
  }
  if (input.kind === "product") {
    /* Not just *itself* — anywhere in the loop (D257). */
    const loop = bomWouldCycle(state, product, ref);
    if (loop) {
      return invalid(
        SERVICE, "bom_cycle",
        loop.length === 2
          ? "Sebuah produk tidak bisa menjadi komponen dirinya sendiri."
          : `Ini membuat lingkaran: ${loop.join(" → ")}. Sebuah rakitan yang memuat dirinya sendiri tidak punya biaya yang terhingga.`,
        { field: "ref_code", cycle: loop },
      );
    }
  }

  let existing = input.component_id
    ? state.bom_components.find((b) => b.id === input.component_id && b.product_id === product.id)
    : undefined;
  if (input.component_id && !existing) {
    return notFound(SERVICE, "component_not_found", "Baris itu tidak ada.");
  }

  const user = actingUser();
  const rev = openDraft(product.id, user.id, user.email);
  /* Edited from a released revision: the edit lands on that line's copy. */
  if (existing && existing.rev !== rev) {
    const fromRef = existing.ref_code;
    existing = getState().bom_components.find(
      (b) => b.product_id === product.id && b.rev === rev && b.ref_code === fromRef,
    );
  }

  const dup = bomAt(getState(), product, rev).find((b) => b.ref_code === ref && b.id !== existing?.id);
  if (dup) {
    return conflict(
      SERVICE, "already_on_bom",
      `${label ?? ref} sudah ada di BOM ini — ubah jumlahnya, jangan tambah baris kedua.`,
    );
  }

  const rate = input.unit_rate ?? null;
  apply((draft) => {
    const row = existing ? draft.bom_components.find((b) => b.id === existing!.id) : null;
    if (row) {
      Object.assign(row, {
        kind: input.kind, ref_code: ref, label, qty: input.qty,
        uom: input.uom.trim() || row.uom,
        waste_percent: input.waste_percent ?? 0,
        unit_rate: rate, rate_source: rate == null ? null : "manual",
        note: input.note?.trim() || null,
      });
    } else {
      draft.bom_components.push({
        id: newId("bom"), product_id: product.id, rev,
        kind: input.kind, ref_code: ref, label, qty: input.qty,
        uom: input.uom.trim() || "pcs",
        waste_percent: input.waste_percent ?? 0,
        unit_rate: rate, rate_source: rate == null ? null : "manual",
        note: input.note?.trim() || null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: row ? "update_line" : "add_line", outcome: "ok",
      reason: input.note?.trim() ?? null,
      detail: { rev, ref, qty: input.qty, unit_rate: rate, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/** Taking a line off. A line of a released revision is taken off its copy in
 *  the draft, so *hapus* does what it says without touching the release. */
export async function removeBomComponent(
  input: { product_code: string; component_id: string },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  let row = state.bom_components.find((b) => b.id === input.component_id && b.product_id === product.id);
  if (!row) return notFound(SERVICE, "component_not_found", "Baris itu tidak ada.");

  const user = actingUser();
  const rev = openDraft(product.id, user.id, user.email);
  if (row.rev !== rev) {
    const fromRef = row.ref_code;
    row = getState().bom_components.find((b) => b.product_id === product.id && b.rev === rev && b.ref_code === fromRef);
    if (!row) return noop(SERVICE, productView(getState(), product));
  }
  const gone = row;
  apply((draft) => {
    draft.bom_components = draft.bom_components.filter((b) => b.id !== gone.id);
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: "remove_line", outcome: "ok", reason: null,
      detail: { ref: gone.ref_code, qty: gone.qty, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/** The revision's persentase miskalkulasi (0109) — one margin on the whole
 *  subtotal, owner's choice. Lands on the draft, opening it if needed. */
export async function setBomMiscalc(
  input: { product_code: string; miscalc_percent: number },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;
  const product = getState().products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  if (!(input.miscalc_percent >= 0 && input.miscalc_percent <= 100)) {
    return invalid(SERVICE, "percent_out_of_range", "Miskalkulasi antara 0 dan 100%.", { field: "miscalc_percent" });
  }
  const user = actingUser();
  const rev = openDraft(product.id, user.id, user.email);
  apply((draft) => {
    const r = draft.bom_revisions.find((x) => x.product_id === product.id && x.rev === rev);
    if (!r) return;
    const before = r.miscalc_percent ?? 0;
    r.miscalc_percent = input.miscalc_percent;
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: "set_miscalc", outcome: "ok", reason: null,
      detail: { rev, before, after: input.miscalc_percent, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/** Throwing the draft away. Nothing to keep: a draft was never a fact. */
export async function discardBomDraft(
  input: { product_code: string },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;
  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  const rev = draftBomRev(state, product);
  if (rev === null) return noop(SERVICE, productView(state, product));
  const user = actingUser();
  apply((draft) => {
    draft.bom_components = draft.bom_components.filter((b) => !(b.product_id === product.id && b.rev === rev));
    draft.bom_revisions = draft.bom_revisions.filter((r) => !(r.product_id === product.id && r.rev === rev));
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: "discard_draft", outcome: "ok", reason: null, detail: { rev, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/** A component the item database does not have yet, typed from the BOM.
 *
 *  It goes **into the items database** — *terhubung ke database items* —
 *  uncurated, for procurement to file and price later. The same name already
 *  there is handed back rather than twinned (0109's `create_bom_item`). */
export async function createBomItem(
  input: {
    name: string;
    category_code?: string;
    base_uom: string;
    kind?: "goods" | "service";
    standard_price?: number | null;
  },
): Promise<Result<{ code: string; name: string; existing: boolean }>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;
  const name = input.name.trim();
  if (!name) return invalid(SERVICE, "name_required", "Nama itemnya apa?", { field: "name" });
  const state = getState();
  const category = input.category_code ?? "uncurated";
  if (!state.item_categories.some((c) => c.code === category)) {
    return invalid(SERVICE, "no_such_category", `Tidak ada kategori ${category}.`, { field: "category_code" });
  }
  if (input.standard_price != null && input.standard_price < 0) {
    return invalid(SERVICE, "negative_price", "Harga tidak bisa negatif.", { field: "standard_price" });
  }
  const twin = state.items.find((i) => i.name.toLowerCase() === name.toLowerCase() && !i.merged_into);
  if (twin) return noop(SERVICE, { code: twin.code, name: twin.name, existing: true });

  const code = `ITM-${String(state.items.length + 1).padStart(4, "0")}`;
  const user = actingUser();
  apply((draft) => {
    draft.items.push({
      id: newId("itm"), code, name, aka: [], category_code: category,
      base_uom: input.base_uom as never, kind: input.kind ?? "goods",
      is_curated: false,
      standard_price: input.standard_price ?? null, last_price: null,
      last_vendor_id: null, last_purchased_at: null, merged_into: null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "item", entity_no: code,
      action: "create_from_bom", outcome: "ok", reason: null, detail: { name, by: user.email },
    });
  });
  return ok(SERVICE, { code, name, existing: false });
}

/** Freezing a draft revision (D256).
 *
 *  After this the lines cannot be touched, and that is the whole point: a work
 *  order pinned to rev 2 must read in June exactly as it read in March. The
 *  next edit opens rev 3 as a copy.
 *
 *  Two refusals, both about a revision that would be noise in a history
 *  somebody later has to read: an **empty** one, and an **identical** one.
 */
export async function releaseBom(
  input: { product_code: string; note: string },
  idempotencyKey?: string,
): Promise<Result<ProductView>> {
  await latency();
  const cached = replayed<ProductView>(SERVICE, "releaseBom", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);

  const rev = draftBomRev(state, product);
  if (rev === null) {
    return conflict(
      SERVICE, "no_draft",
      `BOM ${product.product_code} tidak punya draft yang terbuka. Ubah satu komponen dan drafnya terbuka sendiri.`,
    );
  }
  if (!input.note.trim()) {
    return invalid(
      SERVICE, "note_required",
      "Kenapa versi ini ada? *Rev 3* tanpa satu kalimat pun adalah angka yang nanti harus ditebak orang dari selisihnya.",
      { field: "note" },
    );
  }
  if (bomAt(state, product, rev).length === 0) {
    return invalid(
      SERVICE, "empty_revision",
      "BOM tanpa komponen tidak bisa dirilis — permintaan pembelian yang dibangun darinya akan kosong.",
      { field: "components" },
    );
  }
  /* A released cost with a hole in it is the number somebody quotes from. */
  const unpricedLines = productView(state, product, rev).components.filter((c) => c.unit_price == null);
  if (unpricedLines.length > 0) {
    return invalid(
      SERVICE, "unpriced_lines",
      `Belum ada rate untuk: ${unpricedLines.map((c) => `${c.ref_name ?? c.ref_code} (${c.ref_code})`).join(", ")}. Isi rate-nya dulu — biaya yang dirilis tidak boleh bolong.`,
      { field: "unit_rate", lines: unpricedLines.map((c) => c.ref_code) },
    );
  }
  const diff = bomDiff(state, product, currentBomRev(state, product), rev);
  if (diff.identical) {
    return invalid(
      SERVICE, "nothing_changed",
      `Rev ${rev} sama persis dengan rev ${diff.from_rev}. Nomor versi untuk perubahan yang tidak ada hanya menambah baris yang harus dibaca orang nanti.`,
      { field: "components" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.bom_revisions.find((r) => r.product_id === product.id && r.rev === rev);
    if (!row) return;
    /* Freeze: every line keeps the rate it is costed at today, and says where
       that rate came from (0109). */
    for (const b of draft.bom_components.filter((x) => x.product_id === product.id && x.rev === rev)) {
      if (b.unit_rate != null) continue;
      const { rate, source } = lineRate(state, b);
      if (rate != null && source !== "none") { b.unit_rate = rate; b.rate_source = source; }
    }
    row.released_at = new Date().toISOString();
    row.released_by = user.id;
    row.note = input.note.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "bom", entity_no: product.product_code,
      action: "release_revision", outcome: "ok", reason: input.note.trim(),
      detail: { rev, changes: diff.lines.length, from_rev: diff.from_rev, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "production.bom.released",
      payload: { product_code: product.product_code, rev, changes: diff.lines.length },
    });
  });
  const view = await getProduct(product.product_code);
  if (view.data) remember(SERVICE, "releaseBom", idempotencyKey, view.data);
  return view;
}

/** What changed between two revisions. `to` defaults to the draft, `from` to
 *  the released revision before it — which is the comparison somebody about to
 *  release is actually asking for. */
export async function getBomDiff(
  input: { product_code: string; from?: number | null; to?: number },
): Promise<Result<ReturnType<typeof bomDiff>>> {
  await latency();
  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  const to = input.to ?? draftBomRev(state, product) ?? currentBomRev(state, product);
  if (to === null) {
    return notFound(SERVICE, "no_revision", `BOM ${product.product_code} belum punya versi apa pun.`);
  }
  const from = input.from !== undefined
    ? input.from
    : state.bom_revisions
      .filter((r) => r.product_id === product.id && r.released_at !== null && r.rev < to)
      .reduce<number | null>((a, r) => (a === null || r.rev > a ? r.rev : a), null);
  return ok(SERVICE, bomDiff(state, product, from, to));
}

export async function listBomRevisions(
  productCode: string,
): Promise<Result<ReturnType<typeof bomRevisions>>> {
  await latency();
  const state = getState();
  const product = state.products.find((p) => p.product_code === productCode);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${productCode}.`);
  return ok(SERVICE, bomRevisions(state, product));
}

/** Moving an open work order onto a newer BOM revision.
 *
 *  A decision, not a refresh, so it carries a reason and an audit row: the
 *  order's projection is what its actual spend is measured against, and moving
 *  it changes whether the job reads as over or under. Refused once anything has
 *  been built — at that point the old list is what was **actually** consumed,
 *  and re-pinning would measure real spend against a list nobody used.
 */
export async function repinBom(
  input: { wo_no: string; reason: string },
): Promise<Result<WorkOrderView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === input.wo_no);
  if (!wo) return notFound(SERVICE, "wo_not_found", `No work order ${input.wo_no}.`);
  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Memindahkan pesanan ke BOM versi lain mengubah angka pembandingnya. Tulis kenapa.",
      { field: "reason" },
    );
  }
  const product = wo.product_code
    ? state.products.find((p) => p.product_code === wo.product_code)
    : undefined;
  if (!product) {
    return conflict(
      SERVICE, "no_product",
      `${wo.wo_no} tidak menunjuk produk di katalog, jadi tidak ada BOM untuk disematkan.`,
    );
  }
  const current = currentBomRev(state, product);
  if (current === null) {
    return conflict(SERVICE, "no_released_revision", `${product.product_code} belum punya BOM yang dirilis.`);
  }
  if (current === wo.bom_rev) {
    return noop(SERVICE, workOrderView(state, wo));
  }
  if (!bomRepinnable(state, wo)) {
    /* By here the earlier checks have ruled out *no product*, *no released
       revision* and *already on it*, so the predicate can only be refusing for
       one of two reasons — and they deserve different sentences. */
    return wo.status !== "OPEN"
      ? conflict(
        SERVICE, "wo_not_open",
        `${wo.wo_no} sudah ${wo.status}. Angka pembandingnya adalah bagian dari catatan pesanan yang selesai.`,
      )
      : conflict(
        SERVICE, "already_started",
        `${wo.wo_no} sudah ada pekerjaan yang dilaporkan. Bahan yang dipakai adalah bahan rev ${wo.bom_rev ?? "—"}; memindahkannya ke rev ${current} berarti membandingkan belanja yang nyata dengan daftar yang tidak pernah dipakai.`,
      );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.work_orders.find((w) => w.wo_no === input.wo_no);
    if (!row) return;
    const before = row.bom_rev;
    row.bom_rev = current;
    writeAudit(draft, {
      service: SERVICE, entity: "work_order", entity_no: row.wo_no,
      action: "repin_bom", outcome: "ok", reason: input.reason.trim(),
      detail: { before, after: current, by: user.email },
    });
  });
  return getWorkOrder(input.wo_no);
}

/** What one production run of this product needs, in materials.
 *
 *  The bridge between the master data and the thing somebody actually does
 *  with it: *twelve doors — what do I have to buy?* Quantities carry the waste
 *  already, because the number to buy and the number in the drawing are
 *  different numbers (D149).
 */
export async function materialsFor(
  input: {
    product_code: string;
    qty: number;
    /** Which BOM revision to project from. A work order passes **its own
     *  pinned one** (D256); the catalogue screen passes nothing and gets the
     *  draft or the current released version, which is what somebody editing
     *  it wants to see. */
    rev?: number | null;
  },
): Promise<Result<BomExplosion>> {
  await latency();
  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Berapa unit?", { field: "qty" });
  }
  /* The walk, not the flat list (D257): a purchase request needs the plywood a
     drawer box is made of, not a line reading "2 drawer boxes". */
  return ok(SERVICE, explodeBom(state, product, input.qty, input.rev));
}

/** The workshop's own time on one unit, **typed by a person** (D239).
 *
 *  Its own endpoint rather than a field on `saveProduct`, because it is a
 *  different kind of act: the rest of a product record describes the thing,
 *  and this is a costing somebody worked out and is answerable for. The note is
 *  required with the figure for the same reason a deduction needs a sentence —
 *  a labour cost with no working behind it is one the next person can neither
 *  check nor update.
 *
 *  Nothing here derives it. Not from the pay rules, not from recorded hours,
 *  not from a rate times a guess. The owner said *perumusan manual*, and labour
 *  is where an invented figure does the most damage: it flows straight into a
 *  quoted price.
 */
export async function setLabourCost(
  input: { product_code: string; labour_cost: number | null; note?: string | null },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);

  if (input.labour_cost != null && input.labour_cost < 0) {
    return invalid(SERVICE, "negative_cost", "Biaya tenaga kerja tidak bisa negatif.", { field: "labour_cost" });
  }
  if (input.labour_cost != null && !input.note?.trim()) {
    return invalid(
      SERVICE, "note_required",
      "Tulis dari mana angkanya. Biaya tenaga kerja tanpa perhitungan di belakangnya adalah angka yang tidak bisa diperiksa maupun diperbarui orang berikutnya — dan angka inilah yang masuk ke harga penawaran.",
      { field: "note" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.products.find((p) => p.product_code === input.product_code);
    if (!row) return;
    const before = row.labour_cost;
    row.labour_cost = input.labour_cost == null ? null : Math.round(input.labour_cost);
    row.labour_note = input.labour_cost == null ? null : (input.note?.trim() ?? null);
    writeAudit(draft, {
      service: SERVICE, entity: "product", entity_no: row.product_code,
      action: "set_labour_cost", outcome: "ok", reason: row.labour_note,
      detail: { before, after: row.labour_cost, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/** Filing a drawing against a product.
 *
 *  **Gambar kerja** is what the workshop builds from; **gambar jadi** is what
 *  the client was shown and what QC checks against. They answer different
 *  questions, so they are two kinds rather than one "drawing" field, and a
 *  product missing either says so on the catalogue screen (D150).
 *
 *  A revision is a **new file filed against the same product**, not an edit:
 *  the newest is what the screen shows, and the older one stays, because a
 *  piece built last month was built from it (A5).
 */
export async function attachProductDrawing(
  input: { product_code: string; attachment_id: string; kind: "Gambar Kerja" | "Gambar Jadi" },
): Promise<Result<ProductView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const product = state.products.find((p) => p.product_code === input.product_code);
  if (!product) return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  if (!state.attachments.some((a) => a.id === input.attachment_id)) {
    return notFound(SERVICE, "attachment_not_found", "That file is not on the system.");
  }

  const user = actingUser();
  apply((draft) => {
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.attachment_id,
      entity: "product", entity_no: product.product_code, kind: input.kind,
      linked_by: user.id, linked_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "product", entity_no: product.product_code,
      action: "attach_drawing", outcome: "ok", reason: null,
      detail: { kind: input.kind, attachment_id: input.attachment_id, by: user.email },
    });
  });
  return getProduct(product.product_code);
}

/* ── Desain ───────────────────────────────────────────────────────────────
 *
 *  The drafters' queue (D179). Everything here is about the same four verbs a
 *  drafting day actually has: take one on, upload a revision, release it, and
 *  ask the question you cannot answer yourself.
 */
export async function listDesignTasks(): Promise<Result<DesignTaskView[]>> {
  await latency();
  return ok(SERVICE, designQueue(getState(), officeToday()));
}

/** Products that are ordered or on the floor with no drafting task at all.
 *  Computed, not tracked: putting a product on an order makes its missing
 *  drawings appear the same day (D179). */
export async function listDesignGaps(): Promise<Result<ReturnType<typeof designGaps>>> {
  await latency();
  return ok(SERVICE, designGaps(getState()));
}

export async function getDesignTask(taskNo: string): Promise<Result<DesignTaskView>> {
  await latency();
  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === taskNo);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${taskNo}.`);
  return ok(SERVICE, designTaskView(state, task, officeToday()));
}

export async function createDesignTask(
  input: { product_code: string; kind: DesignKind; assignee?: string | null; due_date?: string | null; note?: string | null },
  idempotencyKey?: string,
): Promise<Result<DesignTaskView>> {
  await latency();
  const cached = replayed<DesignTaskView>(SERVICE, "createDesignTask", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  if (!state.products.some((p) => p.product_code === input.product_code)) {
    return notFound(SERVICE, "product_not_found", `No product ${input.product_code}.`);
  }
  const clash = state.design_tasks.find(
    (t) => t.product_code === input.product_code && t.kind === input.kind,
  );
  if (clash) {
    return conflict(
      SERVICE, "task_exists",
      `${clash.task_no} sudah menangani ${DESIGN_KIND_LABEL[input.kind].toLowerCase()} untuk ${input.product_code}. Revisi baru masuk ke situ, bukan ke tugas kedua.`,
    );
  }

  const user = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "dsn");
    draft.design_tasks.push({
      id: newId("dsg"), task_no: no,
      product_code: input.product_code, kind: input.kind,
      status: "BELUM",
      assignee: input.assignee?.trim() || null,
      assignee_employee_id: null,
      assignee_not_a_person: false,
      due_date: input.due_date || null,
      note: input.note?.trim() || null,
      created_by: user.id, created_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: no,
      action: "create", outcome: "ok", reason: null,
      detail: { product: input.product_code, kind: input.kind, by: user.email },
    });
  });
  return getDesignTask(no);
}

/** Who is drawing it, and by when. */
export async function assignDesignTask(
  input: { task_no: string; assignee: string | null; due_date?: string | null },
): Promise<Result<DesignTaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === input.task_no);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${input.task_no}.`);

  const user = actingUser();
  apply((draft) => {
    const row = draft.design_tasks.find((t) => t.task_no === input.task_no);
    if (!row) return;
    const before = { assignee: row.assignee, due_date: row.due_date, status: row.status };
    row.assignee = input.assignee?.trim() || null;
    if (input.due_date !== undefined) row.due_date = input.due_date || null;
    /* Taking one on moves it out of the untouched pile — the status is a
       consequence of the act, not a second thing to remember. */
    if (row.assignee && row.status === "BELUM") row.status = "DIGAMBAR";
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: row.task_no,
      action: "assign", outcome: "ok", reason: null,
      detail: { before, after: { assignee: row.assignee, due_date: row.due_date, status: row.status }, by: user.email },
    });
  });
  return getDesignTask(input.task_no);
}

/** A revision is an upload, not an edit. Releasing it is a **separate act**,
 *  because a drawing the workshop may cut from and a drawing somebody saved on
 *  Friday evening are different things (D179). */
export async function addDesignRevision(
  input: { task_no: string; rev: string; attachment_id?: string | null; filename?: string | null; note?: string | null; release?: boolean },
): Promise<Result<DesignTaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === input.task_no);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${input.task_no}.`);
  if (!input.rev.trim()) {
    return invalid(SERVICE, "rev_required", "Revisi harus punya nomor — A, B, C. Itu yang disebut orang bengkel.", { field: "rev" });
  }
  if (state.design_revisions.some((r) => r.task_id === task.id && r.rev.toUpperCase() === input.rev.trim().toUpperCase())) {
    return conflict(SERVICE, "rev_exists", `Revisi ${input.rev.trim().toUpperCase()} sudah ada di ${task.task_no}.`);
  }
  /* Releasing over an open question is the one thing this refuses: it is how a
     drawing nobody agreed to reaches the saw. */
  const open = state.design_questions.filter((q) => q.task_id === task.id && !q.answer);
  if (input.release && open.length > 0) {
    return refused(
      SERVICE, "question_open",
      `Masih ada ${open.length} pertanyaan yang belum dijawab: "${open[0].question}". Rilis berarti bengkel boleh memotong dari gambar ini.`,
      { questions: open.length },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.design_tasks.find((t) => t.task_no === input.task_no);
    if (!row) return;
    draft.design_revisions.push({
      id: newId("drv"), task_id: row.id,
      rev: input.rev.trim().toUpperCase(),
      attachment_id: input.attachment_id ?? null,
      filename: input.filename?.trim() || null,
      note: input.note?.trim() || null,
      released_at: input.release ? new Date().toISOString() : null,
      released_by: input.release ? user.id : null,
      uploaded_by: user.id, uploaded_at: new Date().toISOString(),
    });
    if (input.release) row.status = "RILIS";
    else if (row.status === "BELUM") row.status = "DIGAMBAR";
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: row.task_no,
      action: input.release ? "release_revision" : "add_revision",
      outcome: "ok", reason: input.note?.trim() || null,
      detail: { rev: input.rev.trim().toUpperCase(), by: user.email },
    });
    if (input.release) {
      writeOutbox(draft, {
        service: SERVICE, event_type: "production.design.released",
        payload: { task_no: row.task_no, product_code: row.product_code, rev: input.rev.trim().toUpperCase() },
      });
    }
  });
  return getDesignTask(input.task_no);
}

/** Releasing a revision that was uploaded earlier. */
export async function releaseDesignRevision(
  input: { task_no: string; rev: string },
): Promise<Result<DesignTaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === input.task_no);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${input.task_no}.`);
  const rev = state.design_revisions.find(
    (r) => r.task_id === task.id && r.rev.toUpperCase() === input.rev.toUpperCase(),
  );
  if (!rev) return notFound(SERVICE, "rev_not_found", `No revision ${input.rev} on ${input.task_no}.`);
  if (rev.released_at) {
    return conflict(SERVICE, "already_released", `Revisi ${rev.rev} sudah dirilis — tidak ada yang berubah.`);
  }
  const open = state.design_questions.filter((q) => q.task_id === task.id && !q.answer);
  if (open.length > 0) {
    return refused(
      SERVICE, "question_open",
      `Masih ada ${open.length} pertanyaan yang belum dijawab: "${open[0].question}".`,
      { questions: open.length },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.design_revisions.find((r) => r.id === rev.id);
    const t = draft.design_tasks.find((x) => x.id === task.id);
    if (!row || !t) return;
    row.released_at = new Date().toISOString();
    row.released_by = user.id;
    t.status = "RILIS";
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: t.task_no,
      action: "release_revision", outcome: "ok", reason: null,
      detail: { rev: row.rev, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "production.design.released",
      payload: { task_no: t.task_no, product_code: t.product_code, rev: row.rev },
    });
  });
  return getDesignTask(input.task_no);
}

/** The question a drafter cannot answer alone. It blocks the task on purpose:
 *  a drawing released over an unanswered question is a drawing the workshop
 *  will build wrong (D179). */
export async function askDesignQuestion(
  input: { task_no: string; asked_of: string; question: string },
): Promise<Result<DesignTaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === input.task_no);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${input.task_no}.`);
  if (!input.question.trim()) {
    return invalid(SERVICE, "question_required", "Tulis pertanyaannya.", { field: "question" });
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.design_tasks.find((t) => t.task_no === input.task_no);
    if (!row) return;
    draft.design_questions.push({
      id: newId("dqs"), task_id: row.id,
      asked_of: input.asked_of.trim() || "pimpinan",
      question: input.question.trim(),
      answer: null,
      asked_by: user.id, asked_at: new Date().toISOString(),
      answered_by: null, answered_at: null,
    });
    row.status = "TANYA";
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: row.task_no,
      action: "ask", outcome: "ok", reason: input.question.trim(),
      detail: { asked_of: input.asked_of, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "production.design.question",
      payload: { task_no: row.task_no, asked_of: input.asked_of, question: input.question.trim() },
    });
  });
  return getDesignTask(input.task_no);
}

export async function answerDesignQuestion(
  input: { task_no: string; question_id: string; answer: string },
): Promise<Result<DesignTaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const task = state.design_tasks.find((t) => t.task_no === input.task_no);
  if (!task) return notFound(SERVICE, "task_not_found", `No design task ${input.task_no}.`);
  const q = state.design_questions.find((x) => x.id === input.question_id);
  if (!q) return notFound(SERVICE, "question_not_found", "Pertanyaan itu tidak ada.");
  if (q.answer) return conflict(SERVICE, "already_answered", "Pertanyaan itu sudah dijawab — jawabannya tidak ditimpa.");
  if (!input.answer.trim()) {
    return invalid(SERVICE, "answer_required", "Tulis jawabannya — itu yang dipakai menggambar.", { field: "answer" });
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.design_questions.find((x) => x.id === input.question_id);
    const t = draft.design_tasks.find((x) => x.id === task.id);
    if (!row || !t) return;
    row.answer = input.answer.trim();
    row.answered_by = user.id;
    row.answered_at = new Date().toISOString();
    /* Back to drawing once nothing is outstanding — the status follows the
       facts rather than waiting for somebody to update it. */
    const stillOpen = draft.design_questions.some((x) => x.task_id === t.id && !x.answer);
    if (!stillOpen && t.status === "TANYA") t.status = "DIGAMBAR";
    writeAudit(draft, {
      service: SERVICE, entity: "design_task", entity_no: t.task_no,
      action: "answer", outcome: "ok", reason: input.answer.trim(),
      detail: { question_id: row.id, by: user.email },
    });
  });
  return getDesignTask(input.task_no);
}

/* ── Resolving who did the work ────────────────────────────────────────
 *
 *  The link is added beside the name, never instead of it, and **a person
 *  makes it** — the system may offer a suggestion and may never apply one
 *  (D264). Everything here is written around that: the endpoint takes a name
 *  and an answer, applies it to every unresolved entry carrying that name, and
 *  leaves `worked_by` exactly as the mandor wrote it.
 */

export async function listUnresolvedNames(
  range: { from: string; to: string },
): Promise<Result<{ names: UnresolvedName[]; attribution: ReturnType<typeof workAttribution> }>> {
  await latency();
  const state = getState();
  return ok(SERVICE, {
    names: unresolvedNames(state, range.from, range.to),
    attribution: workAttribution(state, range.from, range.to),
  });
}

/** One answer for one name, applied to every unresolved entry carrying it.
 *
 *  Asked once per name rather than once per entry, because *Pranowo* is the
 *  same Pranowo on all six and a screen that asks six times is one somebody
 *  abandons halfway, leaving the record half-resolved — which is worse than
 *  leaving it alone, because a partial record looks like a complete one.
 *
 *  Already-resolved entries are **not** touched. A link somebody made on
 *  purpose is not overwritten by a later bulk answer.
 */
export async function resolveWorkName(
  input: {
    name: string;
    /** Exactly one of these. */
    employee_id?: string | null;
    not_a_person?: boolean;
    from?: string;
    to?: string;
    idempotency_key?: string;
  },
): Promise<Result<{ name: string; updated: number; attribution: WorkAttribution }>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;
  const dup = replayed<{ name: string; updated: number; attribution: WorkAttribution }>(
    SERVICE, "resolveWorkName", input.idempotency_key);
  if (dup) return dup;

  const state = getState();
  const name = input.name?.trim();
  if (!name) {
    return invalid(SERVICE, "name_required", "Nama mana yang mau ditautkan?", { field: "name" });
  }

  /* The invariant behind `attributionOf`, enforced where it can be: a name
     cannot be both a person and not a person. Refused rather than silently
     preferring one, because either choice would be the software deciding. */
  if (input.employee_id && input.not_a_person) {
    return invalid(
      SERVICE, "one_answer_only",
      "Satu nama tidak bisa sekaligus seorang karyawan dan bukan satu orang. Pilih salah satu.",
      { field: "employee_id" },
    );
  }
  if (!input.employee_id && !input.not_a_person) {
    return invalid(
      SERVICE, "answer_required",
      "Pilih karyawannya, atau tandai bahwa nama ini bukan satu orang — tim atau subkon.",
      { field: "employee_id" },
    );
  }

  const employee = input.employee_id
    ? state.employees.find((e) => e.id === input.employee_id)
    : undefined;
  if (input.employee_id && !employee) {
    return notFound(SERVICE, "employee_not_found", "Karyawan itu tidak ada di data kepegawaian.");
  }
  if (employee && !employee.active) {
    /* Not a refusal: somebody who has left did the work, and that is history,
       not an error. It is only worth saying out loud. */
    return conflict(
      SERVICE, "employee_inactive",
      `${employee.full_name} sudah tidak aktif. Kalau memang dia yang mengerjakannya, catat lewat data kepegawaian dulu supaya riwayatnya utuh.`,
      { employee_no: employee.employee_no },
    );
  }

  const key = name.toLowerCase().replace(/\s+/g, " ");
  const targets = state.production_progress.filter((p) =>
    p.worked_by != null
    && p.worked_by.trim().toLowerCase().replace(/\s+/g, " ") === key
    && p.worked_by_employee_id === null
    && !p.worked_by_not_a_person
    && (!input.from || p.work_date >= input.from)
    && (!input.to || p.work_date <= input.to));

  if (targets.length === 0) {
    return noop(SERVICE, {
      name,
      updated: 0,
      attribution: (input.not_a_person ? "not_a_person" : "employee") as WorkAttribution,
    });
  }

  const user = actingUser();
  apply((draft) => {
    for (const t of targets) {
      const row = draft.production_progress.find((p) => p.id === t.id)!;
      row.worked_by_employee_id = employee?.id ?? null;
      row.worked_by_not_a_person = !!input.not_a_person;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "progress_name", entity_no: name,
      action: "resolve", outcome: "ok", reason: null,
      detail: {
        entries: targets.length,
        employee_no: employee?.employee_no ?? null,
        not_a_person: !!input.not_a_person,
        by: user.email,
      },
    });
  });

  const result = ok(SERVICE, {
    name,
    updated: targets.length,
    attribution: (input.not_a_person ? "not_a_person" : "employee") as WorkAttribution,
  });
  remember(SERVICE, "resolveWorkName", input.idempotency_key, result.data);
  return result;
}

/** Undoing one. A link made in error is a link somebody has to be able to take
 *  back — and it returns the entries to `unknown`, not to *not a person*,
 *  because *we were wrong* is not the same answer as *it is a team*. */
export async function unresolveWorkName(
  input: { name: string; from?: string; to?: string },
): Promise<Result<{ name: string; updated: number }>> {
  await latency();
  const denied = requireModule(SERVICE, "production");
  if (denied) return denied;

  const state = getState();
  const name = input.name?.trim();
  if (!name) {
    return invalid(SERVICE, "name_required", "Nama mana?", { field: "name" });
  }
  const key = name.toLowerCase().replace(/\s+/g, " ");
  const targets = state.production_progress.filter((p) =>
    p.worked_by != null
    && p.worked_by.trim().toLowerCase().replace(/\s+/g, " ") === key
    && (p.worked_by_employee_id !== null || p.worked_by_not_a_person)
    && (!input.from || p.work_date >= input.from)
    && (!input.to || p.work_date <= input.to));
  if (targets.length === 0) return noop(SERVICE, { name, updated: 0 });

  const user = actingUser();
  apply((draft) => {
    for (const t of targets) {
      const row = draft.production_progress.find((p) => p.id === t.id)!;
      row.worked_by_employee_id = null;
      row.worked_by_not_a_person = false;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "progress_name", entity_no: name,
      action: "unresolve", outcome: "ok", reason: null,
      detail: { entries: targets.length, by: user.email },
    });
  });
  return ok(SERVICE, { name, updated: targets.length });
}
