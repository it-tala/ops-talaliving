/** Implements the delivery module against the database — crates, surat jalan,
 *  installation, snags and the BAST (`ops_dlv`, 0131–0132).
 *
 *  Reads: the per-line figures are `v_fulfilment_line`'s, the per-row names and
 *  counts are the views'; stage, totals and warnings are `buildFulfilment`,
 *  the same function the demo calls. Writes: every one is a seam, and this
 *  re-reads the row so a screen redraws from what was stored.
 *
 *  Envelopes are stamped `production`, like the demo's: delivery is a module,
 *  not a `ServiceName` (see `src/demo/api/index.ts`).
 */
import type {
  BoxLine, BoxView, DeliveryView, FulfilmentLine, FulfilmentView, Handover,
  InstallationView, SnagSeverity, SnagView,
} from "@/services/delivery/contracts";
import { BOX_STATUS_LABEL } from "@/services/delivery/contracts";
import {
  boxWarnings, buildFulfilment, deliveryWarnings, fulfilmentOrder,
} from "@/services/delivery/fulfilment";
import { officeDay } from "@/lib/office";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "production" as const;

const db = () => supabaseBrowser().schema("ops_dlv");
const procure = () => supabaseBrowser().schema("ops_procure");

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));
type Row = Record<string, unknown>;

/* ── the board ─────────────────────────────────────────────────────────── */

function toLine(r: Row): FulfilmentLine {
  return {
    project_line_id: r.project_line_id as string,
    line_no: n(r.line_no),
    product_code: (r.product_code as string | null) ?? null,
    description: r.description as string,
    uom: r.uom as string,
    ordered: n(r.ordered),
    made: nn(r.made),
    delivered: n(r.delivered),
    arrived: n(r.arrived),
    installed: n(r.installed),
    ready_to_ship: nn(r.ready_to_ship),
    on_site: n(r.on_site),
    at_vendor: nn(r.at_vendor),
    at_vendor_where: (r.at_vendor_where as string[] | null) ?? [],
    is_service: !!r.is_service,
  };
}

const toHandover = (r: Row): Handover => ({
  id: r.id as string, handover_no: r.handover_no as string, project_code: r.project_code as string,
  handed_on: r.handed_on as string, client_rep: r.client_rep as string, our_rep: r.our_rep as string,
  bast_attachment_id: r.bast_attachment_id as string,
  open_snags_at_handover: n(r.open_snags_at_handover), open_snag_nos: (r.open_snag_nos as string[]) ?? [],
  note: (r.note as string | null) ?? null, created_by: (r.created_by as string) ?? "", created_at: r.created_at as string,
});

async function fulfilments(codes: string[] | null): Promise<Result<FulfilmentView[]>> {
  let pq = procure().from("v_project").select("code, name, client_display, location, target_date, is_active");
  if (codes) pq = pq.in("code", codes);
  const projects = await pq;
  if (projects.error) return fail(SERVICE, projects.error);
  let list = (projects.data ?? []) as Row[];
  if (!codes) {
    /* The board: projects with a client that are running, or were handed
       over — the record of a finished job is what people come back to. An
       inactive one with no BAST is finished with nothing to show. */
    const signed = await db().from("handovers").select("project_code");
    if (signed.error) return fail(SERVICE, signed.error);
    const done = new Set((signed.data ?? []).map((h) => h.project_code as string));
    list = list.filter((p) => p.client_display && (p.is_active || done.has(p.code as string)));
  }
  const want = list.map((p) => p.code as string);
  if (want.length === 0) return ok(SERVICE, []);

  const [lines, handovers, snags, deliveries] = await Promise.all([
    db().from("v_fulfilment_line").select("*").in("project_code", want).order("line_no"),
    db().from("handovers").select("*").in("project_code", want),
    db().from("snags").select("project_code, status, severity").in("project_code", want).eq("status", "OPEN"),
    db().from("deliveries").select("project_code, status").in("project_code", want).neq("status", "CANCELLED"),
  ]);
  for (const r of [lines, handovers, snags, deliveries]) if (r.error) return fail(SERVICE, r.error);

  const today = officeDay();
  const views = list.map((p) => {
    const code = p.code as string;
    const mine = (deliveries.data ?? []).filter((d) => d.project_code === code);
    const open = (snags.data ?? []).filter((s) => s.project_code === code);
    const h = (handovers.data ?? []).find((x) => x.project_code === code);
    return buildFulfilment(
      {
        code, name: p.name as string, client_name: (p.client_display as string | null) ?? null,
        location: (p.location as string | null) ?? null, target_date: (p.target_date as string | null) ?? null,
      },
      ((lines.data ?? []) as Row[]).filter((l) => l.project_code === code).map(toLine),
      {
        handover: h ? toHandover(h as Row) : null,
        open_snags: open.length,
        major_snags: open.filter((s) => s.severity === "major").length,
        deliveries: mine.length,
        in_transit: mine.filter((d) => d.status === "IN_TRANSIT").length,
        today,
      },
    );
  });
  return ok(SERVICE, views);
}

/** The board: projects with a client that are running or were handed over. */
export async function listFulfilment(): Promise<Result<FulfilmentView[]>> {
  const res = await fulfilments(null);
  if (res.error) return res;
  return ok(SERVICE, res.data.sort(fulfilmentOrder));
}

export async function getFulfilment(projectCode: string): Promise<Result<FulfilmentView>> {
  const res = await fulfilments([projectCode]);
  if (res.error) return res;
  if (!res.data[0]) return notFound(SERVICE, "project_not_found", `Tidak ada proyek ${projectCode}.`);
  return ok(SERVICE, res.data[0]);
}

/* ── consignments ──────────────────────────────────────────────────────── */

async function deliveryViews(filter: { project_code?: string; delivery_no?: string }): Promise<Result<DeliveryView[]>> {
  let q = db().from("v_delivery").select("*");
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  if (filter.delivery_no) q = q.eq("delivery_no", filter.delivery_no);
  const { data, error } = await q.order("dispatched_on", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return ok(SERVICE, []);
  const lines = await db().from("v_delivery_line").select("*").in("delivery_id", rows.map((r) => r.id as string));
  if (lines.error) return fail(SERVICE, lines.error);
  const today = officeDay();
  return ok(SERVICE, rows.map((r) => {
    const mine = ((lines.data ?? []) as Row[]).filter((l) => l.delivery_id === r.id)
      .map((l) => ({
        id: l.id as string, delivery_id: l.delivery_id as string, project_line_id: l.project_line_id as string,
        description: l.description as string, qty: n(l.qty), uom: l.uom as string,
        note: (l.note as string | null) ?? null, line_no: n(l.line_no),
      }))
      .sort((a, b) => a.line_no - b.line_no);
    const d = {
      id: r.id as string, delivery_no: r.delivery_no as string, project_code: r.project_code as string,
      dispatched_on: r.dispatched_on as string, vehicle: (r.vehicle as string | null) ?? null,
      driver: (r.driver as string | null) ?? null, status: r.status as DeliveryView["status"],
      received_by: (r.received_by as string | null) ?? null, received_at: (r.received_at as string | null) ?? null,
      surat_jalan_attachment_id: (r.surat_jalan_attachment_id as string | null) ?? null,
      photo_attachment_id: (r.photo_attachment_id as string | null) ?? null,
      note: (r.note as string | null) ?? null, cancelled_reason: (r.cancelled_reason as string | null) ?? null,
      created_by: (r.created_by as string) ?? "", created_at: r.created_at as string,
    };
    return {
      ...d,
      project_name: (r.project_name as string | null) ?? d.project_code,
      client_name: (r.client_name as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      lines: mine,
      total_qty: n(r.total_qty),
      warnings: deliveryWarnings(d, mine.length, today),
    };
  }));
}

export async function listDeliveries(filter: { project_code?: string } = {}): Promise<Result<DeliveryView[]>> {
  return deliveryViews(filter);
}

export async function getDelivery(deliveryNo: string): Promise<Result<DeliveryView>> {
  const res = await deliveryViews({ delivery_no: deliveryNo });
  if (res.error) return res;
  if (!res.data[0]) return notFound(SERVICE, "delivery_not_found", `Tidak ada pengiriman ${deliveryNo}.`);
  return ok(SERVICE, res.data[0]);
}

export async function createDelivery(
  input: {
    project_code: string; dispatched_on: string; vehicle?: string | null; driver?: string | null;
    lines: { project_line_id: string; qty: number; note?: string | null }[];
    note?: string | null; box_nos?: string[];
  },
  idempotencyKey?: string,
): Promise<Result<DeliveryView>> {
  const { data, error } = await db().rpc("create_delivery", {
    p_project_code: input.project_code, p_dispatched_on: input.dispatched_on || null, p_lines: input.lines,
    p_vehicle: input.vehicle ?? null, p_driver: input.driver ?? null, p_note: input.note ?? null,
    p_box_nos: input.box_nos?.length ? input.box_nos : null, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ delivery_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getDelivery(res.data.delivery_no);
}

export async function markArrived(
  input: { delivery_no: string; received_by: string; surat_jalan_attachment_id: string; photo_attachment_id?: string | null },
): Promise<Result<DeliveryView>> {
  const { data, error } = await db().rpc("mark_arrived", {
    p_delivery_no: input.delivery_no, p_received_by: input.received_by,
    p_surat_jalan_attachment_id: input.surat_jalan_attachment_id || null,
    p_photo_attachment_id: input.photo_attachment_id || null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getDelivery(input.delivery_no);
}

/* ── installation and snags ────────────────────────────────────────────── */

async function installationViews(filter: { project_code?: string; install_no?: string }): Promise<Result<InstallationView[]>> {
  let q = db().from("v_installation").select("*");
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  if (filter.install_no) q = q.eq("install_no", filter.install_no);
  const { data, error } = await q.order("visit_date", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return ok(SERVICE, []);
  const lines = await db().from("v_installation_line").select("*").in("installation_id", rows.map((r) => r.id as string));
  if (lines.error) return fail(SERVICE, lines.error);
  return ok(SERVICE, rows.map((r) => ({
    id: r.id as string, install_no: r.install_no as string, project_code: r.project_code as string,
    visit_date: r.visit_date as string, crew: (r.crew as string | null) ?? null,
    status: r.status as InstallationView["status"], note: (r.note as string | null) ?? null,
    cancelled_reason: (r.cancelled_reason as string | null) ?? null,
    created_by: (r.created_by as string) ?? "", created_at: r.created_at as string,
    project_name: (r.project_name as string | null) ?? (r.project_code as string),
    location: (r.location as string | null) ?? null,
    lines: ((lines.data ?? []) as Row[]).filter((l) => l.installation_id === r.id).map((l) => ({
      id: l.id as string, installation_id: l.installation_id as string, project_line_id: l.project_line_id as string,
      qty: n(l.qty), note: (l.note as string | null) ?? null,
      description: l.description as string, uom: l.uom as string, line_no: n(l.line_no),
    })).sort((a, b) => a.line_no - b.line_no),
    total_qty: n(r.total_qty),
    snags_found: n(r.snags_found),
  })));
}

export async function listInstallations(filter: { project_code?: string } = {}): Promise<Result<InstallationView[]>> {
  return installationViews(filter);
}

export async function recordInstallation(
  input: {
    project_code: string; visit_date: string; crew?: string | null;
    lines: { project_line_id: string; qty: number; note?: string | null }[]; note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<InstallationView>> {
  const { data, error } = await db().rpc("record_installation", {
    p_project_code: input.project_code, p_visit_date: input.visit_date || null, p_lines: input.lines,
    p_crew: input.crew ?? null, p_note: input.note ?? null, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ install_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  const v = await installationViews({ install_no: res.data.install_no });
  if (v.error) return v;
  return ok(SERVICE, v.data[0]);
}

function toSnag(r: Row): SnagView {
  return {
    id: r.id as string, snag_no: r.snag_no as string, project_code: r.project_code as string,
    project_line_id: (r.project_line_id as string | null) ?? null, raised_on: r.raised_on as string,
    raised_by: r.raised_by as string, description: r.description as string,
    severity: r.severity as SnagSeverity, status: r.status as SnagView["status"],
    photo_attachment_id: (r.photo_attachment_id as string | null) ?? null,
    fixed_on: (r.fixed_on as string | null) ?? null, fixed_by: (r.fixed_by as string | null) ?? null,
    fix_note: (r.fix_note as string | null) ?? null,
    project_name: (r.project_name as string | null) ?? (r.project_code as string),
    line_description: (r.line_description as string | null) ?? null,
    age_days: n(r.age_days),
  };
}

export async function listSnags(
  filter: { project_code?: string; open_only?: boolean } = {},
): Promise<Result<SnagView[]>> {
  let q = db().from("v_snag").select("*");
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  if (filter.open_only) q = q.eq("status", "OPEN");
  const { data, error } = await q;
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toSnag).sort((a, b) => {
    if ((a.status === "OPEN") !== (b.status === "OPEN")) return a.status === "OPEN" ? -1 : 1;
    return b.raised_on.localeCompare(a.raised_on);
  }));
}

async function getSnag(snagNo: string): Promise<Result<SnagView>> {
  const { data, error } = await db().from("v_snag").select("*").eq("snag_no", snagNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "snag_not_found", `Tidak ada catatan ${snagNo}.`);
  return ok(SERVICE, toSnag(data as Row));
}

export async function raiseSnag(
  input: {
    project_code: string; project_line_id?: string | null; raised_by: string;
    description: string; severity: SnagSeverity; photo_attachment_id?: string | null;
  },
): Promise<Result<SnagView>> {
  const { data, error } = await db().rpc("raise_snag", {
    p_project_code: input.project_code, p_description: input.description, p_raised_by: input.raised_by,
    p_severity: input.severity, p_project_line_id: input.project_line_id || null,
    p_photo_attachment_id: input.photo_attachment_id || null,
  });
  const res = fromSeam<{ snag_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getSnag(res.data.snag_no);
}

export async function closeSnag(
  input: { snag_no: string; fixed_by: string; fix_note: string },
): Promise<Result<SnagView>> {
  const { data, error } = await db().rpc("close_snag", {
    p_snag_no: input.snag_no, p_fix_note: input.fix_note, p_fixed_by: input.fixed_by || null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getSnag(input.snag_no);
}

/* ── the BAST ──────────────────────────────────────────────────────────── */

export async function recordHandover(
  input: {
    project_code: string; handed_on: string; client_rep: string; our_rep: string;
    bast_attachment_id: string; note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<FulfilmentView>> {
  const { data, error } = await db().rpc("record_handover", {
    p_project_code: input.project_code, p_handed_on: input.handed_on || null,
    p_client_rep: input.client_rep, p_our_rep: input.our_rep,
    p_bast_attachment_id: input.bast_attachment_id || null, p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getFulfilment(input.project_code);
}

/* ── crates ────────────────────────────────────────────────────────────── */

async function boxViews(filter: { project_code?: string; delivery_no?: string; status?: string; box_no?: string }): Promise<Result<BoxView[]>> {
  let q = db().from("v_box").select("*");
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  if (filter.delivery_no) q = q.eq("delivery_no", filter.delivery_no);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.box_no) q = q.eq("box_no", filter.box_no);
  const { data, error } = await q.order("box_no", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return ok(SERVICE, []);
  const lines = await db().from("box_lines").select("*").in("box_id", rows.map((r) => r.id as string));
  if (lines.error) return fail(SERVICE, lines.error);
  return ok(SERVICE, rows.map((r) => {
    const mine: BoxLine[] = ((lines.data ?? []) as Row[]).filter((l) => l.box_id === r.id).map((l) => ({
      id: l.id as string, box_id: l.box_id as string, project_line_id: (l.project_line_id as string | null) ?? null,
      description: l.description as string, qty: n(l.qty), uom: l.uom as string,
    }));
    const b = {
      id: r.id as string, box_no: r.box_no as string, project_code: r.project_code as string,
      delivery_id: (r.delivery_id as string | null) ?? null, destination: r.destination as string,
      packed_by: (r.packed_by as string) ?? "", packed_at: r.packed_at as string,
      status: r.status as BoxView["status"], scanned_by: (r.scanned_by as string | null) ?? null,
      scanned_at: (r.scanned_at as string | null) ?? null, problem_note: (r.problem_note as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    };
    return {
      ...b,
      lines: mine,
      status_label: BOX_STATUS_LABEL[b.status],
      delivery_no: (r.delivery_no as string | null) ?? null,
      project_name: (r.project_name as string | null) ?? null,
      packed_by_name: (r.packed_by_name as string) ?? "",
      scanned_by_name: (r.scanned_by_name as string | null) ?? null,
      piece_count: n(r.piece_count),
      position: (r.position as string | null) ?? null,
      warnings: boxWarnings(b, mine.length,
        r.delivery_status ? { status: r.delivery_status as DeliveryView["status"] } : null),
    };
  }));
}

export async function listBoxes(
  filter: { project_code?: string; delivery_no?: string; status?: string } = {},
): Promise<Result<BoxView[]>> {
  return boxViews(filter);
}

/** What the QR resolves to. Not found is the ordinary answer: a label from
 *  another job, or a code typed by hand with a digit wrong. */
export async function getBox(boxNo: string): Promise<Result<BoxView>> {
  const res = await boxViews({ box_no: boxNo.trim() });
  if (res.error) return res;
  if (!res.data[0]) return notFound(SERVICE, "box_not_found", `Tidak ada peti dengan kode ${boxNo}.`);
  return ok(SERVICE, res.data[0]);
}

async function thenBox(data: unknown, error: Parameters<typeof fromSeam>[2]): Promise<Result<BoxView>> {
  const res = fromSeam<{ box_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getBox(res.data.box_no);
}

export async function packBox(
  input: {
    project_code: string; destination: string;
    lines: { project_line_id?: string | null; description: string; qty: number; uom: string }[];
    delivery_no?: string | null; note?: string | null; idempotency_key?: string;
  },
): Promise<Result<BoxView>> {
  const { data, error } = await db().rpc("pack_box", {
    p_project_code: input.project_code, p_destination: input.destination, p_lines: input.lines,
    p_delivery_no: input.delivery_no ?? null, p_note: input.note ?? null, p_key: input.idempotency_key ?? null,
  });
  return thenBox(data, error);
}

export async function loadBoxes(input: { delivery_no: string; box_nos: string[] }): Promise<Result<BoxView[]>> {
  const { data, error } = await db().rpc("load_boxes", { p_delivery_no: input.delivery_no, p_box_nos: input.box_nos });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return listBoxes({ delivery_no: input.delivery_no });
}

export async function scanBox(input: { box_no: string; idempotency_key?: string }): Promise<Result<BoxView>> {
  const { data, error } = await db().rpc("scan_box", { p_box_no: input.box_no, p_key: input.idempotency_key ?? null });
  return thenBox(data, error);
}

export async function markBoxInstalled(input: { box_no: string; idempotency_key?: string }): Promise<Result<BoxView>> {
  const { data, error } = await db().rpc("mark_box_installed", { p_box_no: input.box_no, p_key: input.idempotency_key ?? null });
  return thenBox(data, error);
}

export async function flagBoxProblem(
  input: { box_no: string; problem_note: string; idempotency_key?: string },
): Promise<Result<BoxView>> {
  const { data, error } = await db().rpc("flag_box_problem", {
    p_box_no: input.box_no, p_problem_note: input.problem_note, p_key: input.idempotency_key ?? null,
  });
  return thenBox(data, error);
}
