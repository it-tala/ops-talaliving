/** Production views — computed on read (A3).
 *
 *  Everything a supervisor wants to know about a work order is a sum over the
 *  progress entries: how far each stage got, which stage it is really in, and
 *  whether the date it was promised for is still reachable. None of it is
 *  stored, because a stored "current stage" is a field somebody forgets to
 *  move, and the piece then sits in a column it left three days ago.
 */
import { officeDay } from "@/lib/office";
import type { DemoState } from "./state";
import {
  PROCESS_STAGES, STAGE_SOURCES, STAGE_NAME, RETIRED_STAGES, ROUTE, goodsOnSite,
  VENDOR_PROCESS_NAME,
  type WorkOrder, type WorkOrderView, type StageProgress,
  type Product, type ProductView, type BomLineView, type ProductDrawing, type ProductDrawingEntry,
  type BomRevision, type BomRevisionView, type BomDiff, type BomDiffLine,
  type BomExplosion, type BomExplodedLine,
  type BomComponent, type BomDiffShape, type RateSource,
  type DesignTask, type DesignTaskView, type DesignKind,
  type WorkAttribution, type MaterialPlan, type MaterialLine,
  type VendorLeg, type VendorLegView, type VendorRecord,
} from "@/services/production/contracts";
import { attributionOf } from "@/services/production/contracts";
import { stockItems } from "./inventory-derive";

/** Today, as an office day. The board is about deadlines, so "what day is it"
 *  has to be the workshop's day rather than UTC's (F17, F39). One definition
 *  for the whole system, in `src/lib/office.ts` (F63). */
export function officeToday(now: Date = new Date()): string {
  return officeDay(now);
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** May this order be moved onto a newer BOM revision?
 *
 *  **One predicate, read by the API and by the screen** — the lesson F75 taught
 *  four hours earlier, applied before it could bite again. Re-pinning is
 *  refused once anything has been built, because at that point the old list is
 *  what was **actually** consumed, and measuring real spend against a list
 *  nobody used is worse than measuring it against an outdated one.
 */
export function bomRepinnable(state: DemoState, wo: WorkOrder): boolean {
  if (wo.status !== "OPEN" || !wo.product_code) return false;
  const product = state.products.find((p) => p.product_code === wo.product_code);
  if (!product) return false;
  const current = currentBomRev(state, product);
  if (current === null || current === wo.bom_rev) return false;
  return !state.production_progress.some((p) => p.wo_id === wo.id && p.qty > 0);
}

/** One vendor leg, with the two things a foreman actually asks: how long has
 *  it been there, and did it all come back (W6, D280).
 *
 *  `overdue_days` is **null where no date was promised**, not zero. A leg with
 *  no promise cannot be late — only absent — and a zero would put it in the
 *  same column as one that came back on time (D134).
 */
export function vendorLegView(state: DemoState, l: VendorLeg, today: string): VendorLegView {
  const wo = state.work_orders.find((w) => w.id === l.wo_id);
  const outstanding = l.qty - (l.returned_qty ?? 0);
  return {
    ...l,
    process_name: VENDOR_PROCESS_NAME(l.process),
    vendor_name: state.vendors.find((v) => v.id === l.vendor_id)?.name ?? l.vendor_id,
    wo_no: wo?.wo_no ?? l.wo_id,
    product_name: state.products.find((p) => p.product_code === wo?.product_code)?.name
      ?? wo?.product_code ?? "—",
    outstanding: l.returned_on ? 0 : outstanding,
    days_out: daysBetween(l.sent_on, l.returned_on ?? today),
    overdue_days: l.returned_on === null && l.expected_back !== null && l.expected_back < today
      ? Math.abs(daysBetween(today, l.expected_back))
      : null,
    /* Closed, and fewer came back than went. The two that stayed are a
       question for the vendor, and a tick-box would have lost it. */
    short_by: l.returned_on !== null && (l.returned_qty ?? 0) < l.qty
      ? l.qty - (l.returned_qty ?? 0)
      : null,
  };
}

/** Every leg still open, worst first — the *where is my stuff* list. */
export function openVendorLegs(state: DemoState, today: string): VendorLegView[] {
  return state.vendor_legs
    .filter((l) => l.returned_on === null)
    .map((l) => vendorLegView(state, l, today))
    .sort((a, b) => (b.overdue_days ?? -1) - (a.overdue_days ?? -1) || b.days_out - a.days_out);
}

/** What each vendor's record actually looks like (W6, D282).
 *
 *  Three refusals to overstate, all of them the same rule wearing different
 *  clothes:
 *
 *  - **on time is measured only over legs that carried a promise.** A trip
 *    with no agreed date cannot be early or late, so it is out of the
 *    denominator rather than counted as a success (D134);
 *  - **nothing is rated below a floor.** One late leg is a bad week; four of
 *    five is a supplier decision, and printing a percentage over one trip
 *    invites the second reading of the first fact (D261);
 *  - **the basis is printed**, so the figure can be argued with rather than
 *    only believed.
 */
export function vendorRecords(state: DemoState, today: string, minLegs = 3): VendorRecord[] {
  const byVendor = new Map<string, VendorLeg[]>();
  for (const l of state.vendor_legs) {
    byVendor.set(l.vendor_id, [...(byVendor.get(l.vendor_id) ?? []), l]);
  }

  return [...byVendor.entries()].map(([vendor_id, legs]) => {
    const closed = legs.filter((l) => l.returned_on !== null);
    const open = legs.filter((l) => l.returned_on === null);
    const promised = closed.filter((l) => l.expected_back !== null);
    const on_time = promised.filter((l) => l.returned_on! <= l.expected_back!).length;
    const rated = promised.length >= minLegs;

    return {
      vendor_id,
      vendor_name: state.vendors.find((v) => v.id === vendor_id)?.name ?? vendor_id,
      processes: [...new Set(legs.map((l) => VENDOR_PROCESS_NAME(l.process)))],
      legs: legs.length,
      closed: closed.length,
      open: open.length,
      promised: promised.length,
      on_time,
      on_time_percent: rated ? Math.round((on_time / promised.length) * 100) : null,
      avg_days_out: closed.length === 0
        ? null
        : Math.round(closed.reduce((t, l) => t + daysBetween(l.sent_on, l.returned_on!), 0) / closed.length),
      short_units: closed.reduce((t, l) => t + Math.max(l.qty - (l.returned_qty ?? 0), 0), 0),
      out_now: open.reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0),
      overdue_now: open.filter((l) => l.expected_back !== null && l.expected_back < today).length,
      rated,
      basis: rated
        ? `${on_time} dari ${promised.length} pengiriman yang ada janji tanggalnya kembali tepat waktu`
        : promised.length === 0
          ? `${legs.length} pengiriman, tidak ada yang punya janji tanggal — tepat waktu tidak bisa diukur tanpa tanggal yang disepakati`
          : `baru ${promised.length} pengiriman berjanji tanggal, di bawah ambang ${minLegs} — satu keterlambatan itu minggu yang buruk, bukan rekam jejak`,
    };
  }).sort((a, b) => b.overdue_now - a.overdue_now || b.out_now - a.out_now);
}

export function vendorLegViews(state: DemoState, today: string): VendorLegView[] {
  return state.vendor_legs
    .map((l) => vendorLegView(state, l, today))
    .sort((a, b) => b.sent_on.localeCompare(a.sent_on));
}

export function workOrderView(
  state: DemoState,
  wo: WorkOrder,
  today = officeToday(),
): WorkOrderView {
  const entries = state.production_progress.filter((p) => p.wo_id === wo.id);
  const productOf = wo.product_code
    ? state.products.find((p) => p.product_code === wo.product_code)
    : undefined;
  const route = ROUTE(wo.route);
  /* Which stages this product goes through, or the route's own list where
     nobody has said (D278). Null is not "all of them" — it is a gap, and
     `stages_unset` below is what the screen says about it. */
  const productStages = state.products.find((pr) => pr.product_code === wo.product_code)?.stages ?? null;
  const stageSet = productStages ?? route.stages;
  const total = (code: string) =>
    entries.filter((p) => p.stage === code).reduce((a, p) => a + p.qty, 0);

  /* Only the stages this order actually goes through. A subcontracted order
     has no `PEMBUATAN` row at all — not a row reading 0%, which would say
     *nobody has started building this* about goods a vendor has already built
     (D254). */
  const stages: StageProgress[] = PROCESS_STAGES
    /* Route **and** product. The route says what this order's path allows; the
       product says which of those it actually goes through (D278) — a dining
       table has no lamps in it, and drawing it a Machinery column it will
       never fill is what made every later stage look like it jumped a step
       (F92). A product that has not been told falls back to the route, and the
       board says so rather than inventing a list. */
    .filter((s) => route.stages.includes(s.code) && stageSet.includes(s.code))
    .map((s) => {
      /* **A minimum over every source that carried a figure, never a sum.**
         Four chairs cut, four planed and four assembled is four chairs made,
         not twelve; four sanded and three finished is three finished, not
         seven. A piece has passed the stage when it has passed every step
         inside it, so the count is the smallest of the steps actually
         recorded. A step nobody recorded is a step this order never used, and
         it does not drag the whole stage to zero.

         The stage's own code is one of the sources (F74): `FINISHING` names
         one of the four *and* one of the seven, so "direct" and "rolled up"
         cannot be told apart — and must not be added together. */
      const parts = (STAGE_SOURCES[s.code] ?? [{ code: s.code, name: s.name }])
        .map((x) => ({ code: x.code, name: x.name, done: total(x.code) }))
        .filter((p) => p.done !== 0);
      const done = parts.length > 0 ? Math.min(...parts.map((p) => p.done)) : 0;
      return {
        stage: s.code,
        name: s.name,
        seq: s.seq,
        covers: s.covers,
        done,
        /* **Nobody has reported anything against this stage**, which is not the
           same fact as *nothing has passed it* — and the difference started
           mattering the day the four stages became the owner's four (D275).
           A dining table has no lamps in it, so *Machinery / instalasi* sits
           empty on almost every order, and reading that empty as a zero made
           every later stage look like it had jumped a step. An unknown cannot
           be overtaken (F60, F74's rule one level out). */
        recorded: parts.length > 0,
        percent: wo.qty > 0 ? Math.round((done / wo.qty) * 100) : 0,
        /* Only interesting where more than one source spoke. */
        parts: parts.length > 1 ? parts : [],
      };
    });

  const started = stages.filter((s) => s.done > 0);
  const current = started.length > 0 ? started[started.length - 1] : null;
  const last = stages[stages.length - 1];
  const completed = last.done;

  /* Progress across the whole order, counted as stages finished rather than
     as the furthest stage reached: eleven doors cut and one packed is not
     "packing", it is a tenth of the way through. */
  const totalSteps = stages.length * wo.qty;
  const doneSteps = stages.reduce((a, s) => a + Math.min(Math.max(s.done, 0), wo.qty), 0);
  const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const days_left = daysBetween(today, wo.due_date);
  const warnings: string[] = [];

  /* Where the goods physically are. `at_vendor` is derived from the two dates
     rather than stored, for the reason every status here is derived: a flag is
     a field somebody forgets to move while the lorry is still on the road. */
  /* From the **legs**, which is where the fact now lives (W6, D280). The four
     `subcon_*` columns could describe one trip; this order may have several,
     to different vendors, for different processes. */
  const legs = state.vendor_legs.filter((l) => l.wo_id === wo.id);
  const openLegs = legs.filter((l) => l.returned_on === null);
  const at_vendor_qty = openLegs.reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0);
  const at_vendor = openLegs.length > 0;
  const firstSent = legs.map((l) => l.sent_on).sort()[0] ?? null;
  const lastBack = legs.every((l) => l.returned_on)
    ? legs.map((l) => l.returned_on!).sort().pop() ?? null
    : null;
  const days_at_vendor = firstSent === null
    ? null
    : daysBetween(firstSent, lastBack ?? today);
  /* Overdue against a promise, never against silence: a leg with no promised
     date cannot be late, only absent (D134). */
  const overdueLegs = openLegs.filter((l) => l.expected_back !== null && l.expected_back < today);
  const subcon_overdue = overdueLegs.length > 0;

  /* Work recorded against steps the business no longer has.
   *
   *  `POTONG`, `SERUT` and `RAKIT` are bought in as *barang mentah* now
   *  (D275), so they belong to none of the four and are deliberately not
   *  rolled into Sanding — six pieces cut is not six pieces sanded. But the
   *  work happened, and a process change must never make past work disappear
   *  (A5). It is carried separately, named, and shown apart from the four
   *  rather than inside one of them. */
  const retired = RETIRED_STAGES
    .map((r) => ({ code: r.code, name: r.name, done: total(r.code) }))
    .filter((r) => r.done !== 0);

  /* Steps **inside** one stage that disagree.
   *
   *  The minimum resolves the count, and resolving it silently would be the
   *  worse half of the fix: eleven doors reported finished when four were
   *  sanded is not a rounding difference, it is seven doors somebody has to
   *  explain. The stage counts four; the sentence says why it is not eleven
   *  (F74). */
  for (const s of stages) {
    for (let i = 1; i < s.parts.length; i += 1) {
      const before = s.parts[i - 1];
      const after = s.parts[i];
      /* A later step **lagging** the one before it is not a fault, it is work
         in progress: six cut and two assembled is four waiting on the bench.
         A later step **ahead** of the one before it cannot have happened. */
      if (after.done <= before.done) continue;
      warnings.push(
        `${s.name}: ${after.name} tercatat ${after.done} padahal ${before.name} baru ${before.done} — ${
          after.done - before.done
        } ${wo.uom} melewati satu langkah. Yang dihitung selesai ${s.done}, angka yang lebih kecil, sampai ada yang membetulkan salah satunya.`,
      );
    }
  }

  /* A stage ahead of the one before it. Physically impossible, so it is either
     a mis-keyed number or work that skipped a step — both worth a sentence,
     neither worth blocking the report that revealed it (A6). */
  for (let i = 1; i < stages.length; i += 1) {
    /* Skip a comparison whose earlier stage nobody has written anything
       against: *this order does not go through it* and *it is behind* are
       different states, and only the second is worth a sentence (D275). */
    if (!stages[i - 1].recorded) continue;
    if (stages[i].done > stages[i - 1].done) {
      warnings.push(
        `${stages[i].name} (${stages[i].done}) melebihi ${stages[i - 1].name} (${stages[i - 1].done}) — salah ketik, atau ada tahap yang dilewati.`,
      );
    }
  }
  for (const s of stages) {
    if (s.done > wo.qty) {
      warnings.push(`${s.name} tercatat ${s.done} dari ${wo.qty} yang dipesan.`);
    }
  }
  if (wo.status === "OPEN" && completed >= wo.qty) {
    warnings.push("Semua unit sudah melewati tahap terakhir — pesanan ini bisa ditutup.");
  }
  if (wo.status === "OPEN" && days_left < 0 && completed < wo.qty) {
    warnings.push(`Lewat tenggat ${Math.abs(days_left)} hari, sisa ${wo.qty - completed} ${wo.uom}.`);
  } else if (wo.status === "OPEN" && days_left >= 0 && days_left <= 3 && percent < 70 && !at_vendor) {
    /* Not while the goods are at the vendor. `percent` counts **our** stages,
       and none of them can have happened yet — so *baru 0% selesai* would read
       as the workshop being behind on work it is not allowed to start. The
       vendor-overdue sentence above says the true thing instead. */
    warnings.push(`Tinggal ${days_left} hari dan baru ${percent}% selesai.`);
  }
  if (wo.status === "OPEN" && started.length === 0 && !at_vendor) {
    warnings.push(
      wo.route === "SUBCON" && legs.length === 0
        ? "Belum dikirim ke vendor, dan belum ada tahap yang dikerjakan."
        : "Belum ada satu tahap pun yang dikerjakan.",
    );
  }
  for (const l of overdueLegs) {
    warnings.push(
      `${VENDOR_PROCESS_NAME(l.process)} di ${state.vendors.find((v) => v.id === l.vendor_id)?.name ?? l.vendor_id}: dijanjikan kembali ${l.expected_back}, sudah lewat ${
        Math.abs(daysBetween(today, l.expected_back!))
      } hari. ${l.qty - (l.returned_qty ?? 0)} ${wo.uom} masih di sana.`,
    );
  }
  if (wo.route === "SUBCON" && legs.length === 0 && days_left <= 3) {
    warnings.push("Tenggatnya dekat dan barangnya belum berangkat ke vendor.");
  }

  return {
    ...wo,
    stages,
    retired,
    /* Named, never filled in: a product whose stages nobody has set runs on
       the route's list, and the board says which it is doing (D278, D150). */
    stages_unset: productStages === null,
    route_name: route.name,
    at_vendor,
    goods_on_site: goodsOnSite({ route: wo.route, qty: wo.qty, at_vendor_qty }),
    /* What the product's BOM is on **now**, against what this order was
       written against. Different is not wrong — this order is deliberately
       measured against the list it was written from (D256) — but it is worth
       seeing, because *the projection looks off* usually means the BOM moved. */
    product_current_rev: productOf ? currentBomRev(state, productOf) : null,
    bom_drifted: productOf !== undefined && wo.bom_rev !== null
      && currentBomRev(state, productOf) !== wo.bom_rev,
    bom_repinnable: bomRepinnable(state, wo),
    days_at_vendor,
    subcon_overdue,
    legs: legs.map((l) => vendorLegView(state, l, today)),
    at_vendor_qty,
    current_stage: current?.stage ?? null,
    current_stage_name: at_vendor
      ? "Di vendor"
      : current?.name ?? (wo.route === "SUBCON" ? "Belum dikirim" : "Belum mulai"),
    completed,
    percent,
    days_left,
    late: wo.status === "OPEN" && days_left < 0 && completed < wo.qty,
    warnings,
  };
}

export function workOrderViews(state: DemoState, today = officeToday()): WorkOrderView[] {
  return state.work_orders
    .map((w) => workOrderView(state, w, today))
    /* Late first, then by how soon it is due: the board's job is to put the
       thing somebody has to deal with at the top. */
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
      if (a.late !== b.late) return a.late ? -1 : 1;
      return a.due_date.localeCompare(b.due_date);
    });
}


/** A product with its bill of materials priced.
 *
 *  Two things this deliberately does not do.
 *
 *  It does not **store** a material cost. Prices move, a BOM gets a line added,
 *  and a stored figure is one that silently stops matching the components under
 *  it — the same reason payroll is computed on read (A3).
 *
 *  It does not **hide** what it cannot price. A component whose code names
 *  nothing in the catalogue, or an item nobody has ever bought, leaves the
 *  subtotal null and is counted in `unpriced`. A cost that quietly treats the
 *  missing ones as zero is worse than no cost at all: it reads as complete
 *  (D149).
 */
/** A product's drawing of a given kind, if somebody has filed one.
 *
 *  On the same road as every other document (ADR-010): uploaded once, linked
 *  to the product by code, carrying the name of whoever filed it and when —
 *  which is what makes "is this the current drawing" answerable at all. */
function drawingOf(state: DemoState, productCode: string, kind: string): ProductDrawing | null {
  /* Newest wins. A revised drawing is a new file filed against the same
     product; the older one is not deleted, because a piece built last month
     was built from it (A5). */
  const link = [...state.attachment_links]
    .filter((l) => l.entity === "product" && l.entity_no === productCode && l.kind === kind)
    .sort((a, b) => b.linked_at.localeCompare(a.linked_at))[0];
  if (!link) return null;
  const att = state.attachments.find((a) => a.id === link.attachment_id);
  if (!att) return null;
  return {
    attachment_id: att.id, filename: att.filename, url: att.url,
    linked_by: link.linked_by, linked_at: link.linked_at,
  };
}

function drawingsOf(state: DemoState, productCode: string): ProductDrawingEntry[] {
  return [...state.attachment_links]
    .filter((l) => l.entity === "product" && l.entity_no === productCode
      && (l.kind === "Gambar Kerja" || l.kind === "Gambar Jadi"))
    .sort((a, b) => b.linked_at.localeCompare(a.linked_at))
    .flatMap((l) => {
      const att = state.attachments.find((a) => a.id === l.attachment_id);
      return att ? [{
        kind: l.kind as ProductDrawingEntry["kind"],
        attachment_id: att.id, filename: att.filename, url: att.url, mime: att.mime,
        linked_by: l.linked_by, linked_at: l.linked_at,
      }] : [];
    });
}

/** `2200 × 1000 × 750 mm`, spelled the same way everywhere. */
function dimensionText(p: Product): string | null {
  const axes = [p.length_mm, p.width_mm, p.height_mm].filter((n) => n != null);
  if (axes.length === 0) return p.dimension_note;
  const size = `${axes.join(" × ")} mm`;
  return p.dimension_note ? `${size} · ${p.dimension_note}` : size;
}

/** The revisions of one product's BOM, newest first, each saying what it is.
 *
 *  `is_current` is the newest **released** one — the revision a new work order
 *  would pin to. Derived here rather than stored as a flag, for the reason
 *  every flag in this system is derived: a flag is a field somebody forgets to
 *  move when the next revision is released. */
export function bomRevisions(state: DemoState, product: Product): BomRevisionView[] {
  const rows = state.bom_revisions
    .filter((r) => r.product_id === product.id)
    .sort((a, b) => b.rev - a.rev);
  const current = rows.find((r) => r.released_at !== null)?.rev ?? null;
  const name = (id: string | null) =>
    id ? state.users.find((u) => u.id === id)?.full_name ?? id : null;
  return rows.map((r) => ({
    ...r,
    released_by_name: name(r.released_by),
    is_current: r.released_at !== null && r.rev === current,
    is_draft: r.released_at === null,
    component_count: state.bom_components.filter(
      (b) => b.product_id === product.id && b.rev === r.rev,
    ).length,
    used_by: state.work_orders.filter(
      (w) => w.product_code === product.product_code && w.bom_rev === r.rev,
    ).length,
  }));
}

/** The revision a new work order pins to: the newest **released** one. Null
 *  where nothing has been released, and null is not "the draft" — pinning to a
 *  working copy would give the order a list that can still change under it. */
export function currentBomRev(state: DemoState, product: Product): number | null {
  return state.bom_revisions
    .filter((r) => r.product_id === product.id && r.released_at !== null)
    .reduce<number | null>((a, r) => (a === null || r.rev > a ? r.rev : a), null);
}

export function draftBomRev(state: DemoState, product: Product): number | null {
  return state.bom_revisions
    .find((r) => r.product_id === product.id && r.released_at === null)?.rev ?? null;
}

/** The components of one revision. Empty for a revision that does not exist —
 *  which is different from a revision with no components, and the caller is
 *  the one that knows which it is looking at. */
export function bomAt(state: DemoState, product: Product, rev: number | null): BomComponent[] {
  if (rev === null) return [];
  return state.bom_components.filter((b) => b.product_id === product.id && b.rev === rev);
}

/** The rate a line is costed at, and where it came from (0106).
 *
 *  A line's own rate wins — typed by the estimator while drafting, or frozen
 *  on release. Without one, a material follows the catalogue (standard price,
 *  else last paid), a sub-assembly its own released production cost, and a
 *  labour line has none, because labour cannot be saved without one. */
export function lineRate(
  state: DemoState,
  b: BomComponent,
  seen: string[] = [],
): { rate: number | null; source: RateSource | "none" } {
  if (b.unit_rate != null) return { rate: b.unit_rate, source: b.rate_source ?? "manual" };
  if (b.kind === "material") {
    /* Read at the seam, by public code — never joined (ADR-004). */
    const item = state.items.find((i) => i.code === b.ref_code);
    if (item?.standard_price != null) return { rate: item.standard_price, source: "standard" };
    if (item?.last_price != null) return { rate: item.last_price, source: "last" };
    return { rate: null, source: "none" };
  }
  if (b.kind === "product") {
    const sub = state.products.find((p) => p.product_code === b.ref_code);
    const cost = sub ? subAssemblyCost(state, sub, seen) : null;
    return cost == null ? { rate: null, source: "none" } : { rate: cost, source: "sub_assembly" };
  }
  return { rate: null, source: "none" };
}

function refName(state: DemoState, b: BomComponent): string | null {
  if (b.kind === "labour") return b.label ?? null;
  if (b.kind === "material") return state.items.find((i) => i.code === b.ref_code)?.name ?? null;
  return state.products.find((p) => p.product_code === b.ref_code)?.name ?? null;
}

export function miscalcOf(state: DemoState, product: Product, rev: number | null): number {
  if (rev === null) return 0;
  return state.bom_revisions.find((r) => r.product_id === product.id && r.rev === rev)?.miscalc_percent ?? 0;
}

/** What one unit comes to at one revision (0106): materials, labour,
 *  miskalkulasi on the subtotal, and the production cost — null while any
 *  line has no rate. */
export function bomCost(
  state: DemoState,
  product: Product,
  rev: number | null,
  seen: string[] = [],
): {
  lines: number; unpriced: number; labour_lines: number;
  material: number; labour: number; subtotal: number;
  miscalc_percent: number; miscalc_amount: number; production_cost: number | null;
} {
  const rows = bomAt(state, product, rev);
  let material = 0, labour = 0, unpriced = 0, labour_lines = 0;
  for (const b of rows) {
    if (b.kind === "labour") labour_lines += 1;
    const { rate } = lineRate(state, b, [...seen, product.product_code]);
    if (rate == null) { unpriced += 1; continue; }
    const sub = Math.round(b.qty * (1 + b.waste_percent / 100) * rate);
    if (b.kind === "labour") labour += sub; else material += sub;
  }
  const subtotal = material + labour;
  const miscalc_percent = miscalcOf(state, product, rev);
  const miscalc_amount = Math.round(subtotal * miscalc_percent / 100);
  return {
    lines: rows.length, unpriced, labour_lines, material, labour, subtotal,
    miscalc_percent, miscalc_amount,
    production_cost: unpriced > 0 || rows.length === 0 ? null : subtotal + miscalc_amount,
  };
}

/** What changed between two revisions, line by line, computed from the two
 *  lists themselves — a diff derived from the things cannot disagree with
 *  them, and an edit log can (A3). A rate that moved is a change: *harga kayu
 *  naik* is a reason to release. */
export function bomDiff(
  state: DemoState,
  product: Product,
  fromRev: number | null,
  toRev: number,
): BomDiff {
  const before = bomAt(state, product, fromRev);
  const after = bomAt(state, product, toRev);
  const codes = [...new Set([...before, ...after].map((b) => b.ref_code))].sort();
  const shape = (b: BomComponent | undefined): BomDiffShape | null =>
    b ? { qty: b.qty, uom: b.uom, waste_percent: b.waste_percent, unit_price: lineRate(state, b).rate } : null;

  const lines: BomDiffLine[] = [];
  for (const code of codes) {
    const a = before.find((b) => b.ref_code === code);
    const b = after.find((x) => x.ref_code === code);
    const sa = shape(a);
    const sb = shape(b);
    if (sa && sb) {
      if (sa.qty === sb.qty && sa.uom === sb.uom && sa.waste_percent === sb.waste_percent
        && sa.unit_price === sb.unit_price) continue;
      lines.push({ ref_code: code, ref_name: refName(state, b!), change: "changed", before: sa, after: sb });
    } else if (sb) {
      lines.push({ ref_code: code, ref_name: refName(state, b!), change: "added", before: null, after: sb });
    } else {
      lines.push({ ref_code: code, ref_name: refName(state, a!), change: "removed", before: sa, after: null });
    }
  }
  const mBefore = miscalcOf(state, product, fromRev);
  const mAfter = miscalcOf(state, product, toRev);
  const miscalc = fromRev !== null && mBefore !== mAfter ? { before: mBefore, after: mAfter }
    : fromRev === null && mAfter !== 0 ? { before: 0, after: mAfter } : null;
  return {
    product_code: product.product_code,
    from_rev: fromRev,
    to_rev: toRev,
    lines,
    miscalc,
    identical: lines.length === 0 && miscalc === null,
  };
}

/** One product, at one revision.
 *
 *  `rev` defaults to **the draft if one is open, otherwise the current
 *  released one** — which is what somebody editing the catalogue wants to see.
 *  A work order asks for its own pinned revision instead, by number. */
export function productView(state: DemoState, product: Product, rev?: number | null): ProductView {
  const current = currentBomRev(state, product);
  const draft = draftBomRev(state, product);
  const viewing = rev !== undefined ? rev : (draft ?? current);
  const rows = bomAt(state, product, viewing);

  const components: BomLineView[] = rows.map((b) => {
    const qty_with_waste = Math.round(b.qty * (1 + b.waste_percent / 100) * 10_000) / 10_000;
    const { rate, source } = lineRate(state, b, [product.product_code]);
    const item = b.kind === "material" ? state.items.find((i) => i.code === b.ref_code) : undefined;
    return {
      ...b,
      label: b.label ?? null,
      unit_rate: b.unit_rate ?? null,
      rate_source: b.rate_source ?? null,
      ref_name: refName(state, b),
      qty_with_waste,
      unit_price: rate,
      price_source: source,
      subtotal: rate == null ? null : Math.round(rate * qty_with_waste),
      catalogue_price: item?.standard_price ?? item?.last_price ?? null,
    };
  });

  const cost = bomCost(state, product, viewing);
  const unpriced = cost.unpriced;
  const materialCost = components.some((c) => c.kind !== "labour" && c.subtotal != null)
    ? cost.material : null;
  const broken_refs = components.filter((c) => c.ref_name === null).length;

  const warnings: string[] = [];
  if (components.length === 0) {
    warnings.push("Belum ada bill of material — biaya produksinya belum bisa dihitung.");
  }
  if (broken_refs > 0) {
    warnings.push(`${broken_refs} komponen menunjuk kode yang tidak ada di katalog.`);
  }
  if (unpriced > broken_refs) {
    warnings.push(`${unpriced - broken_refs} komponen belum punya rate — biaya produksi belum lengkap.`);
  }
  if (components.length > 0 && cost.labour_lines === 0) {
    warnings.push("Belum ada baris tenaga kerja — biaya produksi baru berisi bahan.");
  }

  const gambar_kerja = drawingOf(state, product.product_code, "Gambar Kerja");
  const gambar_jadi = drawingOf(state, product.product_code, "Gambar Jadi");
  const hasSize = product.length_mm != null || product.width_mm != null || product.height_mm != null;

  /* What master data is missing, named rather than implied. Every one of these
     is something somebody will otherwise have to ask about — and asking is the
     expensive part, not the filling in (D150). */
  const missing: string[] = [];
  if (!hasSize) missing.push("ukuran");
  if (!gambar_kerja) missing.push("gambar kerja");
  if (!gambar_jadi) missing.push("gambar jadi");
  if (components.length === 0) missing.push("BOM");

  return {
    ...product,
    components,
    viewing_rev: viewing,
    current_rev: current,
    draft_rev: draft,
    revisions: bomRevisions(state, product),
    draft_diff: draft === null ? null : bomDiff(state, product, current, draft),
    dimension: dimensionText(product),
    gambar_kerja,
    gambar_jadi,
    drawings: drawingsOf(state, product.product_code),
    missing,
    material_cost: materialCost,
    labour_cost: cost.labour_lines === 0 ? null : cost.labour,
    subtotal: cost.subtotal,
    miscalc_percent: cost.miscalc_percent,
    miscalc_amount: cost.miscalc_amount,
    production_cost: cost.production_cost,
    total_cost: cost.production_cost,
    unpriced,
    broken_refs,
    warnings,
  };
}

/** What one unit of a sub-assembly costs to make, at its **released**
 *  revision — materials, labour and its own miskalkulasi, walking into any
 *  sub-assembly inside it (D257, 0106).
 *
 *  `seen` carries the chain of product codes being walked; a product that
 *  reappears in its own chain is a cycle and has no finite cost. Null also
 *  where anything inside cannot be priced — half a number is not a number.
 */
function subAssemblyCost(
  state: DemoState,
  product: Product,
  seen: string[] = [],
): number | null {
  if (seen.includes(product.product_code)) return null;
  return bomCost(state, product, currentBomRev(state, product), seen).production_cost;
}

/** Would adding `refCode` as a component of `product` make a loop?
 *
 *  `saveBomComponent` already refused a product naming **itself**. That was
 *  enough while the BOM was read one level deep; it is not enough now that the
 *  walk is recursive, because *A contains B, B contains A* is a loop nobody
 *  typed in one place and which no single edit looks wrong (D257).
 *
 *  Refused at the point of writing, and still detected on read: the write guard
 *  is what keeps it from happening here, and the read guard is what keeps the
 *  walk terminating on data that arrived some other way.
 */
export function bomWouldCycle(state: DemoState, product: Product, refCode: string): string[] | null {
  if (refCode === product.product_code) return [product.product_code, refCode];
  const target = state.products.find((p) => p.product_code === refCode);
  if (!target) return null;

  /* Walk down from the candidate child. If the parent turns up anywhere
     beneath it, adding the child closes a loop. */
  const seek = (p: Product, chain: string[]): string[] | null => {
    if (chain.includes(p.product_code)) return null;
    const here = [...chain, p.product_code];
    for (const b of bomAt(state, p, currentBomRev(state, p))) {
      if (b.kind !== "product") continue;
      if (b.ref_code === product.product_code) return [product.product_code, ...here, b.ref_code];
      const sub = state.products.find((x) => x.product_code === b.ref_code);
      if (!sub) continue;
      const found = seek(sub, here);
      if (found) return found;
    }
    return null;
  };
  return seek(target, []);
}

/** Every purchasable material a run needs, with the sub-assemblies walked
 *  through (D257).
 *
 *  Three things it does that a flat read cannot. Waste **compounds**: ten per
 *  cent more drawer boxes is ten per cent more of the plywood inside each one.
 *  The same material reached by two routes is **one line**, because a purchase
 *  request wants one row per thing to buy — with both routes named, because
 *  *why do I need forty screws* is the next question. And a sub-assembly with
 *  no released BOM stays in the list **as itself**, listed under `unexploded`:
 *  something that has to be obtained somehow is not nothing, and dropping it
 *  would be the silent kind of wrong.
 */
export function explodeBom(
  state: DemoState,
  product: Product,
  qty: number,
  rev?: number | null,
): BomExplosion {
  const startRev = rev !== undefined ? rev : (draftBomRev(state, product) ?? currentBomRev(state, product));
  const merged = new Map<string, BomExplodedLine>();
  const subs = new Map<string, { product_code: string; name: string | null; qty: number; rev: number | null }>();
  const unexploded = new Set<string>();
  let cycle: string[] | null = null;

  const priceOf = (code: string): { price: number | null; source: BomExplodedLine["price_source"] } => {
    const item = state.items.find((i) => i.code === code);
    if (item?.standard_price != null) return { price: item.standard_price, source: "standard" };
    if (item?.last_price != null) return { price: item.last_price, source: "last" };
    return { price: null, source: "none" };
  };

  const addLine = (
    code: string, name: string | null, uom: string, amount: number,
    path: string[], depth: number,
  ) => {
    const { price, source } = priceOf(code);
    const existing = merged.get(code);
    if (existing) {
      existing.qty = round4(existing.qty + amount);
      existing.subtotal = existing.unit_price == null ? null : Math.round(existing.unit_price * existing.qty);
      existing.depth = Math.max(existing.depth, depth);
      if (!existing.via.some((v) => v.join(">") === path.join(">"))) existing.via.push(path);
      return;
    }
    merged.set(code, {
      ref_code: code, ref_name: name, qty: round4(amount), uom,
      unit_price: price, price_source: source,
      subtotal: price == null ? null : Math.round(price * amount),
      via: [path], depth,
    });
  };

  const walk = (p: Product, atRev: number | null, multiplier: number, chain: string[]) => {
    if (chain.includes(p.product_code)) {
      cycle = [...chain, p.product_code];
      return;
    }
    const here = [...chain, p.product_code];
    for (const b of bomAt(state, p, atRev)) {
      const amount = multiplier * b.qty * (1 + b.waste_percent / 100);
      const path = here.slice(1);
      if (b.kind === "product") {
        const sub = state.products.find((x) => x.product_code === b.ref_code);
        const subRev = sub ? currentBomRev(state, sub) : null;
        const prior = subs.get(b.ref_code);
        subs.set(b.ref_code, {
          product_code: b.ref_code,
          name: sub?.name ?? null,
          qty: round4((prior?.qty ?? 0) + amount),
          rev: subRev,
        });
        /* No released BOM — or no product at all behind the code. It cannot be
           broken down, so it stays a line of its own and is named as
           unexploded rather than silently dropped from the list. */
        if (!sub || subRev === null || bomAt(state, sub, subRev).length === 0) {
          unexploded.add(b.ref_code);
          addLine(b.ref_code, sub?.name ?? null, b.uom, amount, path, here.length - 1);
          continue;
        }
        walk(sub, subRev, amount, here);
        continue;
      }
      /* Labour is costed, not bought: it has no place on a list of things to
         purchase (0106). */
      if (b.kind === "labour") continue;
      const item = state.items.find((i) => i.code === b.ref_code);
      addLine(b.ref_code, item?.name ?? null, b.uom, amount, path, here.length - 1);
    }
  };

  walk(product, startRev, qty, []);

  const lines = [...merged.values()].sort((a, b) => a.depth - b.depth || a.ref_code.localeCompare(b.ref_code));
  const priced = lines.filter((l) => l.subtotal != null);
  return {
    product_code: product.product_code,
    qty,
    rev: startRev,
    lines,
    total: priced.length > 0 ? priced.reduce((a, l) => a + (l.subtotal ?? 0), 0) : null,
    unpriced: lines.length - priced.length,
    sub_assemblies: [...subs.values()].sort((a, b) => a.product_code.localeCompare(b.product_code)),
    unexploded: [...unexploded].sort(),
    cycle,
    /* Labour lines of the revision being run (0106). Null where there are
       none: a run of twelve costs twelve times an unknown, which is still
       unknown (D239). */
    ...(() => {
      const c = bomCost(state, product, startRev);
      const perUnit = c.labour_lines === 0 ? null : c.labour;
      return {
        labour_cost: perUnit,
        labour_total: perUnit == null ? null : Math.round(perUnit * qty),
        labour_note: null,
      };
    })(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function productViews(state: DemoState): ProductView[] {
  return state.products
    .map((p) => productView(state, p))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ── Desain ───────────────────────────────────────────────────────────────── */

/** One drafting task, with everything that decides whether it matters today.
 *
 *  The two computed facts are the whole module (D179):
 *
 *  - **`ahead_of_release`** — a newer revision exists that nobody released, so
 *    the workshop is still cutting from the older one. Nothing about the task
 *    *looks* wrong: it has a drawing, it has a recent upload, somebody has
 *    clearly been working on it. That is exactly why it needs saying.
 *  - **`needed_by`** — the soonest date anything waiting on this drawing is
 *    due, taken from the open work orders and the projects that ordered the
 *    product. A drafter cannot prioritise from a list of products; they can
 *    from a list of dates.
 */
export function designTaskView(state: DemoState, task: DesignTask, today: string): DesignTaskView {
  const product = state.products.find((p) => p.product_code === task.product_code);

  const revisions = state.design_revisions
    .filter((r) => r.task_id === task.id)
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .map((r) => ({
      ...r,
      uploaded_by_name: state.users.find((u) => u.id === r.uploaded_by)?.full_name ?? "—",
      released_by_name: r.released_by
        ? state.users.find((u) => u.id === r.released_by)?.full_name ?? null
        : null,
    }));

  const questions = state.design_questions
    .filter((q) => q.task_id === task.id)
    .sort((a, b) => b.asked_at.localeCompare(a.asked_at))
    .map((q) => ({
      ...q,
      asked_by_name: state.users.find((u) => u.id === q.asked_by)?.full_name ?? "—",
      answered_by_name: q.answered_by
        ? state.users.find((u) => u.id === q.answered_by)?.full_name ?? null
        : null,
      waiting_days: q.answer ? null : daysApart(q.asked_at.slice(0, 10), today),
    }));

  const released = [...revisions].reverse().find((r) => r.released_at);
  const latest = revisions[revisions.length - 1];

  /* Who is waiting. Work orders name the product directly; a project line names
     it too, and both are by code across the seam (ADR-004). */
  const workOrders = state.work_orders
    .filter((w) => w.product_code === task.product_code && w.status !== "CANCELLED")
    .map((w) => ({ wo_no: w.wo_no, due_date: w.due_date, status: w.status }));

  const orderedBy = state.project_lines
    .filter((l) => l.product_code === task.product_code)
    .map((l) => state.projects.find((p) => p.id === l.project_id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.is_active)
    .map((p) => p.code);

  /* Only jobs that are still live. A finished project's target date is not a
     deadline — counting one made a released drawing read *lewat 74 hari*
     because an office fit-out handed over in June still had a line for the
     same wardrobe (F51). A date that is not a deadline is worse than no date:
     it moves a real one down the queue. */
  const dates = [
    ...workOrders.filter((w) => w.status !== "DONE").map((w) => w.due_date),
    ...state.project_lines
      .filter((l) => l.product_code === task.product_code)
      .map((l) => state.projects.find((p) => p.id === l.project_id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.is_active)
      .map((p) => p.target_date)
      .filter((d): d is string => !!d),
    ...(task.due_date ? [task.due_date] : []),
  ].sort();
  const needed_by = dates[0] ?? null;

  return {
    ...task,
    product_name: product?.name ?? task.product_code,
    category: product?.category ?? "—",
    dimension: product && product.length_mm && product.width_mm && product.height_mm
      ? `${product.length_mm} × ${product.width_mm} × ${product.height_mm} mm`
      : null,
    revisions,
    questions,
    released_rev: released?.rev ?? null,
    latest_rev: latest?.rev ?? null,
    ahead_of_release: !!released && !!latest && latest.rev !== released.rev,
    blocked: questions.some((q) => !q.answer),
    ordered_by: [...new Set(orderedBy)],
    work_orders: workOrders,
    needed_by,
    days_left: needed_by ? daysApart(today, needed_by) : null,
  };
}

function daysApart(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The queue, in the order a drafter should work it.
 *
 *  Blocked first — a question waiting nine days is somebody else's problem that
 *  only the drafter can see. Then by the date something is actually needed,
 *  then the unstarted ones. Released-and-current tasks sink to the bottom,
 *  which is where finished work belongs.
 */
export function designQueue(state: DemoState, today: string): DesignTaskView[] {
  return state.design_tasks
    .map((t) => designTaskView(state, t, today))
    .sort((a, b) => {
      const rank = (t: DesignTaskView) =>
        t.blocked ? 0
          : t.ahead_of_release ? 1
            : t.status === "BELUM" ? 2
              : t.status === "DIGAMBAR" ? 3 : 4;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const ad = a.days_left ?? 9999;
      const bd = b.days_left ?? 9999;
      if (ad !== bd) return ad - bd;
      return a.product_name.localeCompare(b.product_name);
    });
}

/** Products that are ordered or on the floor and have **no task at all** for a
 *  drawing kind. The queue's blind spot, and the reason it is computed rather
 *  than typed: adding a product to an order makes its missing drawings appear
 *  the same day, without anybody remembering to raise a task (D179). */
export function designGaps(state: DemoState): { product_code: string; product_name: string; kind: DesignKind; why: string }[] {
  const out: { product_code: string; product_name: string; kind: DesignKind; why: string }[] = [];
  const wanted = new Map<string, string>();

  for (const w of state.work_orders) {
    if (!w.product_code || w.status === "CANCELLED" || w.status === "DONE") continue;
    wanted.set(w.product_code, `sedang dikerjakan · ${w.wo_no}`);
  }
  for (const l of state.project_lines) {
    if (!l.product_code || wanted.has(l.product_code)) continue;
    const project = state.projects.find((p) => p.id === l.project_id);
    if (project?.is_active) wanted.set(l.product_code, `dipesan · ${project.code}`);
  }

  for (const [code, why] of wanted) {
    const product = state.products.find((p) => p.product_code === code);
    for (const kind of ["gambar_kerja", "gambar_jadi"] as DesignKind[]) {
      if (state.design_tasks.some((t) => t.product_code === code && t.kind === kind)) continue;
      out.push({ product_code: code, product_name: product?.name ?? code, kind, why });
    }
  }
  return out;
}

/* ── Who did the work ──────────────────────────────────────────────────
 *
 *  Production records a **name**, because a subcontractor is a legitimate
 *  answer to *who did it*. W5's fix is a link **beside** that name, never
 *  instead of it (D264) — and the rule that makes it safe is that the system
 *  may suggest a match and may never make one. A name matched by software is
 *  how the wrong review lands on the wrong person.
 */

/** Case- and spacing-insensitive, for **suggesting** a match. Never for making
 *  one: the comparison decides what to offer a human, and the human decides. */
function normalName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface UnresolvedName {
  name: string;
  entries: number;
  /** Pieces reported under this name — how much is riding on the answer. */
  qty: number;
  first_seen: string;
  last_seen: string;
  /** Where it appears, so the person resolving it has context. */
  work_orders: string[];
  /** Exactly one active employee whose name matches. Null when none does — and
   *  null **also** when more than one does, which is the case that matters:
   *  there is a *Andi* in the workshop and an *Andi Prasetyo* in the office,
   *  and offering either one is worse than offering neither. */
  suggestion: { employee_id: string; employee_no: string; full_name: string } | null;
  /** Set when the name matched several people. The screen says so instead of
   *  quietly showing no suggestion, because *we could not tell which* and *we
   *  found nobody* are different answers and lead to different actions. */
  ambiguous: { employee_no: string; full_name: string }[] | null;
}

/** What share of the period's reported work can be read as a person's.
 *
 *  Coverage is a property of **the record, not of the person** — and that is
 *  the whole reason it exists. Nobody can tell whether an unresolved entry
 *  belongs to a given person, so a per-person count over a patchy record is a
 *  fiction: it reads *this person made nothing* when the truth is *nobody wrote
 *  down who made it*. Same family as F81, one level further out.
 *
 *  A name confirmed as a team or a vendor is **resolved**, not missing: it
 *  counts towards coverage, because somebody looked at it and answered.
 */
export function workAttribution(state: DemoState, from: string, to: string): {
  entries: number;
  employee: number;
  not_a_person: number;
  unknown: number;
  /** 0–1 over entries that carry a name at all. */
  coverage: number;
  unnamed: number;
} {
  const rows = state.production_progress.filter((p) => p.work_date >= from && p.work_date <= to);
  const named = rows.filter((p) => p.worked_by != null && p.worked_by.trim() !== "");
  const by = (k: WorkAttribution) => named.filter((p) => attributionOf(p) === k).length;
  const employee = by("employee");
  const not_a_person = by("not_a_person");
  const unknown = by("unknown");
  return {
    entries: rows.length,
    employee, not_a_person, unknown,
    coverage: named.length === 0 ? 0 : (employee + not_a_person) / named.length,
    unnamed: rows.length - named.length,
  };
}

/** The queue for the screen that resolves names, grouped by the name itself.
 *
 *  Grouped rather than listed per entry because the question is asked **once
 *  per name**: *Pranowo* is the same Pranowo on all six entries, and asking six
 *  times is how a screen gets abandoned halfway with the record half-resolved.
 */
export function unresolvedNames(state: DemoState, from: string, to: string): UnresolvedName[] {
  const rows = state.production_progress.filter(
    (p) => p.work_date >= from && p.work_date <= to
      && p.worked_by != null && p.worked_by.trim() !== ""
      && attributionOf(p) === "unknown",
  );

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalName(r.worked_by!);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const active = state.employees.filter((e) => e.active);
  return [...groups.values()].map((list) => {
    const name = list[0].worked_by!.trim();
    /* Exact match is not enough, and the case that proves it is the one this
       whole function exists for. *Andi* exactly equals B-036 Andi in the
       workshop — and K-011 Andi Prasetyo sits in the office, unmatched by an
       equality test. Exact matching would therefore offer **one confident
       suggestion for the most ambiguous name in the register**, which is worse
       than offering none: a confident wrong answer gets clicked.

       So a candidate is somebody whose full name *is* the name, or whose name
       begins with it as a whole word — *Andi Prasetyo* is a candidate for
       *Andi*, and *Sumi* is not one for *Sumiati*. More than one candidate and
       there is no suggestion at all, exact match or not. */
    const key = normalName(name);
    const matches = active.filter((e) => {
      const full = normalName(e.full_name);
      return full === key || full.startsWith(`${key} `);
    });
    const dates = list.map((r) => r.work_date).sort();
    const woNos = [...new Set(list.map((r) =>
      state.work_orders.find((w) => w.id === r.wo_id)?.wo_no ?? r.wo_id))];
    return {
      name,
      entries: list.length,
      qty: list.reduce((a, r) => a + r.qty, 0),
      first_seen: dates[0],
      last_seen: dates[dates.length - 1],
      work_orders: woNos,
      suggestion: matches.length === 1
        ? { employee_id: matches[0].id, employee_no: matches[0].employee_no, full_name: matches[0].full_name }
        : null,
      ambiguous: matches.length > 1
        ? matches.map((e) => ({ employee_no: e.employee_no, full_name: e.full_name }))
        : null,
    };
  }).sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
}

export interface PersonWork {
  entries: number;
  qty: number;
  /** Stage code → pieces, so *what they actually did* is readable. */
  by_stage: { stage: string; name: string; qty: number }[];
  work_orders: { wo_no: string; product_name: string; qty: number }[];
  first: string;
  last: string;
}

/** What one person made in a window, over their **linked** entries only.
 *
 *  Returns null where they have none — which is *not attributed*, never zero
 *  (D264). The screen must say which, and `workAttribution` above is what tells
 *  it whether the silence means anything.
 */
export function personWork(
  state: DemoState, employeeId: string, from: string, to: string,
): PersonWork | null {
  const rows = state.production_progress.filter(
    (p) => p.worked_by_employee_id === employeeId && p.work_date >= from && p.work_date <= to,
  );
  if (rows.length === 0) return null;

  const stages = new Map<string, number>();
  for (const r of rows) stages.set(r.stage, (stages.get(r.stage) ?? 0) + r.qty);
  const orders = new Map<string, number>();
  for (const r of rows) orders.set(r.wo_id, (orders.get(r.wo_id) ?? 0) + r.qty);
  const dates = rows.map((r) => r.work_date).sort();

  return {
    entries: rows.length,
    qty: rows.reduce((a, r) => a + r.qty, 0),
    by_stage: [...stages.entries()].map(([stage, qty]) => ({
      stage,
      /* `STAGE_NAME`, not a lookup in the four: an August entry still carries
         its old seven-stage code and *AMPLAS* is what that person did. */
      name: STAGE_NAME(stage),
      qty,
    })).sort((a, b) => b.qty - a.qty),
    work_orders: [...orders.entries()].map(([woId, qty]) => {
      const wo = state.work_orders.find((w) => w.id === woId);
      return {
        wo_no: wo?.wo_no ?? woId,
        product_name: state.products.find((pr) => pr.product_code === wo?.product_code)?.name
          ?? wo?.product_code ?? "—",
        qty,
      };
    }).sort((a, b) => b.qty - a.qty),
    first: dates[0],
    last: dates[dates.length - 1],
  };
}

/* ── What a run should take, against what left the rack ────────────────
 *
 *  Nothing here deducts stock. The BOM proposes, a person disposes: the
 *  storeman records what actually went out, against the SPK, because he is the
 *  one who carried it (D266). Stock that moves because somebody typed a
 *  progress entry is stock nobody counted, and the rack then disagrees with
 *  the screen in a way only a stock-take can find.
 */
export function materialPlan(state: DemoState, wo: WorkOrder): MaterialPlan {
  const view = workOrderView(state, wo);
  const product = state.products.find((p) => p.product_code === wo.product_code);

  /* The order's **own** pinned revision, not whatever the catalogue says now
     (D256). An order written against rev 1 is measured against rev 1. */
  const explosion = product
    ? explodeBom(state, product, wo.qty, wo.bom_rev ?? currentBomRev(state, product))
    : null;

  let no_plan_reason: string | null = null;
  if (!product) no_plan_reason = "Produk pesanan ini tidak ada di katalog.";
  else if (!explosion || explosion.lines.length === 0) {
    no_plan_reason = "Produk ini belum punya bill of material, jadi tidak ada daftar bahan yang bisa dibandingkan.";
  } else if (explosion.cycle) {
    no_plan_reason = `BOM produk ini berputar (${explosion.cycle.join(" → ")}), jadi kebutuhannya belum bisa dihitung.`;
  }

  const expected = new Map<string, { qty: number; uom: string }>();
  if (!no_plan_reason && explosion) {
    for (const l of explosion.lines) expected.set(l.ref_code, { qty: l.qty, uom: l.uom });
  }

  /* Issues minus returns against this SPK. A return is not a smaller issue —
     it is its own row — but for *how much is out there* the two net off. */
  const moved = new Map<string, number>();
  for (const m of state.stock_moves) {
    if (m.ref_no !== wo.wo_no) continue;
    if (m.kind !== "issue" && m.kind !== "return") continue;
    /* `qty` is signed: an issue is negative off the rack, so the amount that
       went *out* is its negation. */
    moved.set(m.item_code, (moved.get(m.item_code) ?? 0) - m.qty);
  }

  const onHand = new Map(stockItems(state).map((r) => [r.item_code, r.on_hand]));
  const codes = [...new Set([...expected.keys(), ...moved.keys()])];

  const lines: MaterialLine[] = codes.map((code) => {
    const exp = expected.get(code);
    const issued = Math.round((moved.get(code) ?? 0) * 1000) / 1000;
    const item = state.items.find((i) => i.code === code);
    return {
      item_code: code,
      item_name: item?.name ?? code,
      uom: exp?.uom ?? item?.base_uom ?? "",
      expected: exp ? Math.round(exp.qty * 1000) / 1000 : null,
      issued,
      remaining: exp ? Math.round((exp.qty - issued) * 1000) / 1000 : null,
      on_hand: onHand.get(code) ?? 0,
      off_bom: !exp,
    };
  }).sort((a, b) =>
    Number(a.off_bom) - Number(b.off_bom)
    || (b.remaining ?? -Infinity) - (a.remaining ?? -Infinity)
    || a.item_name.localeCompare(b.item_name));

  return {
    wo_no: wo.wo_no,
    rev: no_plan_reason ? null : (wo.bom_rev ?? (product ? currentBomRev(state, product) : null)),
    no_plan_reason,
    lines,
    /* Only once the run is finished. Half a run has taken half its material,
       and calling that a 50% underrun teaches people to ignore the figure. */
    variance_readable: view.completed >= wo.qty || wo.status === "DONE",
    completed: view.completed,
    ordered: wo.qty,
  };
}
