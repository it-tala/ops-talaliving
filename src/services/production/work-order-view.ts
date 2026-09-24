/** A Job Order as a board reads it — the arithmetic, once.
 *
 *  The demo derives it from its fixtures and `src/lib/api/production.ts`
 *  derives it from database rows; both call this, so the two cannot disagree
 *  about what *sampai mana* means (F75's rule, one level out). Everything it
 *  needs is passed in: the entries, the legs, and what the catalogue says about
 *  the product **now**. Nothing here knows where those came from.
 */
import {
  PROCESS_STAGES, STAGE_SOURCES, RETIRED_STAGES, ROUTE, goodsOnSite, VENDOR_PROCESS_NAME,
  type ProgressEntry, type StageProgress, type VendorLegView, type WorkOrder, type WorkOrderView,
} from "./contracts";

export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export interface WorkOrderContext {
  /** Every progress entry for this order. */
  entries: ProgressEntry[];
  /** Every vendor leg for this order, already named. */
  legs: VendorLegView[];
  /** The product's own stage list, where somebody set one (D278). */
  product_stages: string[] | null;
  /** Whether `product_code` names a product the catalogue has. */
  product_exists: boolean;
  /** The product's newest released BOM revision now. */
  product_current_rev: number | null;
  today: string;
}

/** May this order be moved onto a newer BOM revision? Refused once anything
 *  has been built — the old list is what was actually consumed. */
export function repinnable(wo: WorkOrder, ctx: Pick<WorkOrderContext, "entries" | "product_exists" | "product_current_rev">): boolean {
  if (wo.status !== "OPEN" || !wo.product_code || !ctx.product_exists) return false;
  const current = ctx.product_current_rev;
  if (current === null || current === wo.bom_rev) return false;
  return !ctx.entries.some((p) => p.qty > 0);
}

export function deriveWorkOrderView(wo: WorkOrder, ctx: WorkOrderContext): WorkOrderView {
  const { entries, today } = ctx;
  const route = ROUTE(wo.route);
  /* Which stages this product goes through, or the route's own list where
     nobody has said (D278). Null is not "all of them" — it is a gap, and
     `stages_unset` below is what the screen says about it. */
  const productStages = ctx.product_stages;
  const stageSet = productStages ?? route.stages;
  const total = (code: string) =>
    entries.filter((p) => p.stage === code).reduce((a, p) => a + p.qty, 0);

  /* Only the stages this order actually goes through (D254). Route **and**
     product: the route says what this order's path allows; the product says
     which of those it actually goes through (D278, F92). */
  const stages: StageProgress[] = PROCESS_STAGES
    .filter((s) => route.stages.includes(s.code) && stageSet.includes(s.code))
    .map((s) => {
      /* **A minimum over every source that carried a figure, never a sum.**
         The stage's own code is one of the sources (F74), so "direct" and
         "rolled up" cannot be told apart — and must not be added together. */
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
        /* Nobody has reported anything against this stage — not the same fact
           as *nothing has passed it* (D275, F92). */
        recorded: parts.length > 0,
        percent: wo.qty > 0 ? Math.round((done / wo.qty) * 100) : 0,
        parts: parts.length > 1 ? parts : [],
      };
    });

  const started = stages.filter((s) => s.done > 0);
  const current = started.length > 0 ? started[started.length - 1] : null;
  const last = stages[stages.length - 1];
  const completed = last?.done ?? 0;

  /* Stages finished across the quantity, not the furthest stage reached. */
  const totalSteps = stages.length * wo.qty;
  const doneSteps = stages.reduce((a, s) => a + Math.min(Math.max(s.done, 0), wo.qty), 0);
  const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const days_left = daysBetween(today, wo.due_date);
  const warnings: string[] = [];

  /* Where the goods physically are, from the legs (W6, D280). */
  const legs = ctx.legs;
  const openLegs = legs.filter((l) => l.returned_on === null);
  const at_vendor_qty = openLegs.reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0);
  const at_vendor = openLegs.length > 0;
  const firstSent = legs.map((l) => l.sent_on).sort()[0] ?? null;
  const lastBack = legs.every((l) => l.returned_on)
    ? legs.map((l) => l.returned_on!).sort().pop() ?? null
    : null;
  const days_at_vendor = firstSent === null ? null : daysBetween(firstSent, lastBack ?? today);
  /* Overdue against a promise, never against silence (D134). */
  const overdueLegs = openLegs.filter((l) => l.expected_back !== null && l.expected_back < today);
  const subcon_overdue = overdueLegs.length > 0;

  /* Work recorded against steps the business no longer has — shown apart,
     never folded into one of the four (D275, A5). */
  const retired = RETIRED_STAGES
    .map((r) => ({ code: r.code, name: r.name, done: total(r.code) }))
    .filter((r) => r.done !== 0);

  /* Steps inside one stage that disagree: the minimum resolves the count, the
     sentence says why it is not the larger one (F74). */
  for (const s of stages) {
    for (let i = 1; i < s.parts.length; i += 1) {
      const before = s.parts[i - 1];
      const after = s.parts[i];
      if (after.done <= before.done) continue;
      warnings.push(
        `${s.name}: ${after.name} tercatat ${after.done} padahal ${before.name} baru ${before.done} — ${
          after.done - before.done
        } ${wo.uom} melewati satu langkah. Yang dihitung selesai ${s.done}, angka yang lebih kecil, sampai ada yang membetulkan salah satunya.`,
      );
    }
  }

  /* A stage ahead of the one before it: worth a sentence, not a refusal (A6). */
  for (let i = 1; i < stages.length; i += 1) {
    if (!stages[i - 1].recorded) continue;
    if (stages[i].done > stages[i - 1].done) {
      warnings.push(
        `${stages[i].name} (${stages[i].done}) melebihi ${stages[i - 1].name} (${stages[i - 1].done}) — salah ketik, atau ada tahap yang dilewati.`,
      );
    }
  }
  for (const s of stages) {
    if (s.done > wo.qty) warnings.push(`${s.name} tercatat ${s.done} dari ${wo.qty} yang dipesan.`);
  }
  if (wo.status === "OPEN" && completed >= wo.qty) {
    warnings.push("Semua unit sudah melewati tahap terakhir — Job Order ini bisa ditutup.");
  }
  if (wo.status === "OPEN" && days_left < 0 && completed < wo.qty) {
    warnings.push(`Lewat tenggat ${Math.abs(days_left)} hari, sisa ${wo.qty - completed} ${wo.uom}.`);
  } else if (wo.status === "OPEN" && days_left >= 0 && days_left <= 3 && percent < 70 && !at_vendor) {
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
      `${VENDOR_PROCESS_NAME(l.process)} di ${l.vendor_name}: dijanjikan kembali ${l.expected_back}, sudah lewat ${
        Math.abs(daysBetween(today, l.expected_back!))
      } hari. ${l.qty - (l.returned_qty ?? 0)} ${wo.uom} masih di sana.`,
    );
  }
  if (wo.status === "OPEN" && wo.route === "SUBCON" && legs.length === 0 && days_left <= 3) {
    warnings.push("Tenggatnya dekat dan barangnya belum berangkat ke vendor.");
  }

  return {
    ...wo,
    stages,
    retired,
    stages_unset: productStages === null,
    route_name: route.name,
    at_vendor,
    goods_on_site: goodsOnSite({ route: wo.route, qty: wo.qty, at_vendor_qty }),
    /* What the product's BOM is on **now**, against what this order was
       written against (D256). Different is not wrong, but it is worth seeing. */
    product_current_rev: ctx.product_exists ? ctx.product_current_rev : null,
    bom_drifted: ctx.product_exists && wo.bom_rev !== null && ctx.product_current_rev !== wo.bom_rev,
    bom_repinnable: repinnable(wo, ctx),
    days_at_vendor,
    subcon_overdue,
    legs,
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

/** Late first, then by how soon it is due: the board's job is to put the
 *  thing somebody has to deal with at the top. */
export function boardOrder(a: WorkOrderView, b: WorkOrderView): number {
  if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
  if (a.late !== b.late) return a.late ? -1 : 1;
  return a.due_date.localeCompare(b.due_date);
}
