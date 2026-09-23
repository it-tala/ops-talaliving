/** Implements `/api/v1/production` against the database — the product
 *  catalogue and its bill of materials only (0060, 0109).
 *
 *  Work orders, progress, vendor legs, the drafting queue and the name
 *  resolver are **not written here yet**. A screen that calls one of them gets
 *  the swap's 501 with the function's name, and `check-live-routes.mjs` keeps
 *  those screens dark — so exporting this module opens `/produksi/bom` and
 *  nothing else.
 *
 *  ## Reads: one set of queries, however many products
 *
 *  A `ProductView` carries its lines, its revisions, the diff of the open
 *  draft and its drawings. The catalogue page wants every product at once, so
 *  `views()` reads each table **once** and assembles in memory: five round
 *  trips for thirty products, not a hundred and fifty. The arithmetic is the
 *  database's (`v_product_bom`, `v_product_summary`); this file only arranges
 *  what it answered.
 *
 *  ## Writes: every one is a seam
 *
 *  `save_bom_line`, `release_bom` and the rest decide — one draft, copy on
 *  open, no cycles, freeze on release. This file passes the arguments and
 *  re-reads the product, so a screen always redraws from what was stored.
 */
import type {
  BomDiff, BomDiffLine, BomDiffShape, BomKind, BomLineView, BomRevisionView,
  ProductDrawing, ProductDrawingEntry, ProductView, RateSource,
} from "@/services/production/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "production" as const;

const db = () => supabaseBrowser().schema("ops_prod");
const core = () => supabaseBrowser().schema("ops_core");

/* ── rows as the views answer them ─────────────────────────────────────── */

interface ProductSummaryRow {
  id: string;
  product_code: string;
  name: string;
  category: string;
  uom: string;
  description: string | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  dimension_note: string | null;
  lead_time_days: number | null;
  stages: string[] | null;
  labour_cost: number | null;
  labour_note: string | null;
  active: boolean;
  note: string | null;
  current_rev: number | null;
  draft_rev: number | null;
  viewing_rev: number | null;
  unpriced: number;
  material_cost: number | null;
  bom_labour_cost: number | null;
  priced_subtotal: number | null;
  miscalc_percent: number | string;
  miscalc_amount: number | null;
  production_cost: number | null;
}

interface BomRevisionRow {
  id: string;
  product_id: string;
  rev: number;
  released_at: string | null;
  released_by: string | null;
  note: string | null;
  miscalc_percent: number | string;
  created_at: string;
  created_by: string | null;
}

interface BomLineRow {
  id: string;
  product_id: string;
  rev: number;
  kind: BomKind;
  ref_code: string;
  ref_name: string | null;
  qty: number | string;
  uom: string;
  waste_percent: number | string;
  qty_with_waste: number | string;
  unit_price: number | string | null;
  price_source: string | null;
  subtotal: number | string | null;
  note: string | null;
  label: string | null;
  unit_rate: number | string | null;
  rate_source: string | null;
  catalogue_price: number | string | null;
}

/* PostgREST hands `numeric` back as a string where it cannot be a JS number
   losslessly. Every figure here is money in rupiah or a quantity to four
   places, so a number is right. */
const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** The database says `last_paid`; the contract, older, says `last`. */
function source(s: string | null): RateSource | null {
  if (s == null) return null;
  return (s === "last_paid" ? "last" : s) as RateSource;
}

function toLine(r: BomLineRow): BomLineView {
  return {
    id: r.id,
    product_id: r.product_id,
    rev: r.rev,
    kind: r.kind,
    ref_code: r.ref_code,
    label: r.label,
    qty: Number(r.qty),
    uom: r.uom,
    waste_percent: Number(r.waste_percent),
    unit_rate: num(r.unit_rate),
    rate_source: source(r.rate_source),
    note: r.note,
    ref_name: r.ref_name,
    qty_with_waste: Number(r.qty_with_waste),
    unit_price: num(r.unit_price),
    price_source: source(r.price_source) ?? "none",
    subtotal: num(r.subtotal),
    catalogue_price: num(r.catalogue_price),
  };
}

function dimensionText(p: ProductSummaryRow): string | null {
  const axes = [p.length_mm, p.width_mm, p.height_mm].filter((n) => n != null);
  if (axes.length === 0) return p.dimension_note;
  const size = `${axes.join(" × ")} mm`;
  return p.dimension_note ? `${size} · ${p.dimension_note}` : size;
}

/** A Drive upload records the file id, not a link (`attach_file`); the share
 *  page is derived from it, which is what `DocumentPreview` knows how to show. */
function driveUrl(storagePath: string | null, url: string | null): string | null {
  if (url) return url;
  return storagePath ? `https://drive.google.com/file/d/${storagePath}/view` : null;
}

function diffOf(
  productCode: string, lines: BomLineView[], fromRev: number | null, toRev: number,
  miscalcFrom: number, miscalcTo: number,
): BomDiff {
  const before = lines.filter((l) => l.rev === fromRev);
  const after = lines.filter((l) => l.rev === toRev);
  const codes = [...new Set([...before, ...after].map((l) => l.ref_code))].sort();
  const shape = (l: BomLineView | undefined): BomDiffShape | null =>
    l ? { qty: l.qty, uom: l.uom, waste_percent: l.waste_percent, unit_price: l.unit_price } : null;
  const out: BomDiffLine[] = [];
  for (const code of codes) {
    const a = before.find((l) => l.ref_code === code);
    const b = after.find((l) => l.ref_code === code);
    const sa = shape(a);
    const sb = shape(b);
    if (sa && sb) {
      if (sa.qty === sb.qty && sa.uom === sb.uom && sa.waste_percent === sb.waste_percent
        && Math.round((sa.unit_price ?? -1) * 100) === Math.round((sb.unit_price ?? -1) * 100)) continue;
      out.push({ ref_code: code, ref_name: b!.ref_name, change: "changed", before: sa, after: sb });
    } else if (sb) {
      out.push({ ref_code: code, ref_name: b!.ref_name, change: "added", before: null, after: sb });
    } else {
      out.push({ ref_code: code, ref_name: a!.ref_name, change: "removed", before: sa, after: null });
    }
  }
  const miscalc = fromRev !== null
    ? (miscalcFrom !== miscalcTo ? { before: miscalcFrom, after: miscalcTo } : null)
    : (miscalcTo !== 0 ? { before: 0, after: miscalcTo } : null);
  return {
    product_code: productCode, from_rev: fromRev, to_rev: toRev,
    lines: out, miscalc, identical: out.length === 0 && miscalc === null,
  };
}

/** Every product, or the ones named, as the screens read them. */
async function views(
  opts: { codes?: string[]; include_inactive?: boolean } = {},
): Promise<Result<ProductView[]>> {
  let sq = db().from("v_product_summary").select("*");
  if (opts.codes) sq = sq.in("product_code", opts.codes);
  if (!opts.include_inactive && !opts.codes) sq = sq.eq("active", true);
  const { data: sData, error: sErr } = await sq.order("product_code");
  if (sErr) return fail(SERVICE, sErr);
  const products = (sData ?? []) as ProductSummaryRow[];
  if (products.length === 0) return ok(SERVICE, []);
  const ids = products.map((p) => p.id);
  const codes = products.map((p) => p.product_code);

  const [revs, lines, orders, links] = await Promise.all([
    db().from("bom_revisions").select("*").in("product_id", ids).order("rev", { ascending: false }),
    db().from("v_product_bom").select("*").in("product_id", ids).order("kind").order("ref_code"),
    db().from("work_orders").select("product_code, bom_rev").in("product_code", codes),
    core().from("v_attachment_link").select("*").eq("entity", "product").in("entity_no", codes),
  ]);
  if (revs.error) return fail(SERVICE, revs.error);
  if (lines.error) return fail(SERVICE, lines.error);
  if (orders.error) return fail(SERVICE, orders.error);
  if (links.error) return fail(SERVICE, links.error);

  const revRows = (revs.data ?? []) as BomRevisionRow[];
  const lineRows = ((lines.data ?? []) as BomLineRow[]).map(toLine);
  const woRows = (orders.data ?? []) as { product_code: string; bom_rev: number | null }[];
  const linkRows = (links.data ?? []) as {
    attachment_id: string; entity_no: string; kind: string; linked_by: string; linked_at: string;
  }[];

  /* Drawings: the files behind the links, and the names behind the user ids
     on the revisions — one read each, not one per product. */
  const attIds = [...new Set(linkRows.map((l) => l.attachment_id))];
  const userIds = [...new Set(revRows.map((r) => r.released_by).filter((x): x is string => !!x))];
  const [atts, users] = await Promise.all([
    attIds.length
      ? core().from("v_attachment").select("id, filename, mime, url, storage_path").in("id", attIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? core().from("users").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (atts.error) return fail(SERVICE, atts.error);
  const attById = new Map(((atts.data ?? []) as {
    id: string; filename: string; mime: string; url: string | null; storage_path: string | null;
  }[]).map((a) => [a.id, a]));
  /* A name the reader may not see is left as null rather than failing the page. */
  const nameOf = new Map(((users.data ?? []) as { id: string; full_name: string }[])
    .map((u) => [u.id, u.full_name]));

  const out = products.map((p): ProductView => {
    const myRevs = revRows.filter((r) => r.product_id === p.id);
    const myLines = lineRows.filter((l) => l.product_id === p.id);
    const components = myLines.filter((l) => l.rev === p.viewing_rev);
    const miscalcAt = (rev: number | null) =>
      Number(myRevs.find((r) => r.rev === rev)?.miscalc_percent ?? 0);

    const revisions: BomRevisionView[] = myRevs.map((r) => ({
      id: r.id, product_id: r.product_id, rev: r.rev,
      released_at: r.released_at, released_by: r.released_by, note: r.note,
      miscalc_percent: Number(r.miscalc_percent),
      created_at: r.created_at, created_by: r.created_by ?? "",
      released_by_name: r.released_by ? nameOf.get(r.released_by) ?? null : null,
      is_current: r.released_at !== null && r.rev === p.current_rev,
      is_draft: r.released_at === null,
      component_count: myLines.filter((l) => l.rev === r.rev).length,
      used_by: woRows.filter((w) => w.product_code === p.product_code && w.bom_rev === r.rev).length,
    }));

    const drawings: ProductDrawingEntry[] = linkRows
      .filter((l) => l.entity_no === p.product_code
        && (l.kind === "Gambar Kerja" || l.kind === "Gambar Jadi"))
      .sort((a, b) => b.linked_at.localeCompare(a.linked_at))
      .flatMap((l) => {
        const a = attById.get(l.attachment_id);
        return a ? [{
          kind: l.kind as ProductDrawingEntry["kind"],
          attachment_id: a.id, filename: a.filename, mime: a.mime,
          url: driveUrl(a.storage_path, a.url),
          linked_by: l.linked_by, linked_at: l.linked_at,
        }] : [];
      });
    const newest = (kind: ProductDrawingEntry["kind"]): ProductDrawing | null => {
      const d = drawings.find((x) => x.kind === kind);
      if (!d) return null;
      const { kind: _kind, ...rest } = d;
      return rest;
    };
    const gambar_kerja = newest("Gambar Kerja");
    const gambar_jadi = newest("Gambar Jadi");

    const hasSize = p.length_mm != null || p.width_mm != null || p.height_mm != null;
    const missing: string[] = [];
    if (!hasSize) missing.push("ukuran");
    if (!gambar_kerja) missing.push("gambar kerja");
    if (!gambar_jadi) missing.push("gambar jadi");
    if (components.length === 0) missing.push("BOM");

    const broken_refs = components.filter((c) => c.ref_name === null).length;
    const unpriced = components.filter((c) => c.unit_price == null).length;
    const labourLines = components.filter((c) => c.kind === "labour");
    const warnings: string[] = [];
    if (components.length === 0) {
      warnings.push("Belum ada bill of material — biaya produksinya belum bisa dihitung.");
    }
    if (broken_refs > 0) warnings.push(`${broken_refs} komponen menunjuk kode yang tidak ada di katalog.`);
    if (unpriced > broken_refs) {
      warnings.push(`${unpriced - broken_refs} komponen belum punya rate — biaya produksi belum lengkap.`);
    }
    if (components.length > 0 && labourLines.length === 0) {
      warnings.push("Belum ada baris tenaga kerja — biaya produksi baru berisi bahan.");
    }

    const sumOf = (ls: BomLineView[]) => ls.reduce((a, l) => a + (l.subtotal ?? 0), 0);
    const materialLines = components.filter((c) => c.kind !== "labour");
    const subtotal = sumOf(components);
    const miscalc_percent = Number(p.miscalc_percent ?? 0);

    return {
      id: p.id, product_code: p.product_code, name: p.name, category: p.category, uom: p.uom,
      description: p.description, length_mm: p.length_mm, width_mm: p.width_mm,
      height_mm: p.height_mm, dimension_note: p.dimension_note, lead_time_days: p.lead_time_days,
      stages: p.stages, labour_note: p.labour_note, active: p.active, note: p.note,
      components,
      viewing_rev: p.viewing_rev,
      current_rev: p.current_rev,
      draft_rev: p.draft_rev,
      revisions,
      draft_diff: p.draft_rev == null ? null
        : diffOf(p.product_code, myLines, p.current_rev, p.draft_rev,
          miscalcAt(p.current_rev), miscalcAt(p.draft_rev)),
      dimension: dimensionText(p),
      gambar_kerja,
      gambar_jadi,
      drawings,
      missing,
      material_cost: materialLines.some((c) => c.subtotal != null) ? sumOf(materialLines) : null,
      labour_cost: labourLines.length === 0 ? null : sumOf(labourLines),
      subtotal,
      miscalc_percent,
      miscalc_amount: num(p.miscalc_amount) ?? Math.round(subtotal * miscalc_percent / 100),
      production_cost: num(p.production_cost),
      total_cost: num(p.production_cost),
      unpriced,
      broken_refs,
      warnings,
    };
  });
  return ok(SERVICE, out);
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export async function listProducts(
  opts: { include_inactive?: boolean } = {},
): Promise<Result<ProductView[]>> {
  return views({ include_inactive: opts.include_inactive });
}

export async function getProduct(productCode: string): Promise<Result<ProductView>> {
  const res = await views({ codes: [productCode] });
  if (res.error) return res;
  const p = res.data[0];
  if (!p) return notFound(SERVICE, "product_not_found", `No product ${productCode}.`);
  return ok(SERVICE, p);
}

export async function listBomRevisions(productCode: string): Promise<Result<BomRevisionView[]>> {
  const res = await getProduct(productCode);
  if (res.error) return res;
  return ok(SERVICE, res.data.revisions);
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/** Every write answers with the product as it now stands. A read that fails
 *  after a write that succeeded answers the read's error — the write stays
 *  done, and retrying it is how a duplicate gets made. */
async function thenProduct(
  productCode: string, data: unknown, error: Parameters<typeof fromSeam>[2],
): Promise<Result<ProductView>> {
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getProduct(productCode.trim().toUpperCase());
}

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
    stages?: string[] | null;
    active?: boolean;
    note?: string | null;
  },
  _idempotencyKey?: string,
): Promise<Result<ProductView>> {
  const { data, error } = await db().rpc("save_product", {
    p_product_code: input.product_code,
    p_name: input.name,
    p_category: input.category,
    p_uom: input.uom,
    p_description: input.description ?? null,
    p_length_mm: input.length_mm ?? null,
    p_width_mm: input.width_mm ?? null,
    p_height_mm: input.height_mm ?? null,
    p_dimension_note: input.dimension_note ?? null,
    p_lead_time_days: input.lead_time_days ?? null,
    p_active: input.active ?? null,
    p_note: input.note ?? null,
  });
  return thenProduct(input.product_code, data, error);
}

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
  const { data, error } = await db().rpc("save_bom_line", {
    p_product_code: input.product_code,
    p_component_id: input.component_id ?? null,
    p_kind: input.kind,
    p_ref_code: input.ref_code ?? null,
    p_label: input.label ?? null,
    p_qty: input.qty,
    p_uom: input.uom,
    p_unit_rate: input.unit_rate ?? null,
    p_waste_percent: input.waste_percent ?? 0,
    p_note: input.note ?? null,
  });
  return thenProduct(input.product_code, data, error);
}

export async function removeBomComponent(
  input: { product_code: string; component_id: string },
): Promise<Result<ProductView>> {
  const { data, error } = await db().rpc("remove_bom_line", {
    p_product_code: input.product_code,
    p_component_id: input.component_id,
  });
  return thenProduct(input.product_code, data, error);
}

export async function setBomMiscalc(
  input: { product_code: string; miscalc_percent: number },
): Promise<Result<ProductView>> {
  const { data, error } = await db().rpc("set_bom_miscalc", {
    p_product_code: input.product_code,
    p_percent: input.miscalc_percent,
  });
  return thenProduct(input.product_code, data, error);
}

export async function releaseBom(
  input: { product_code: string; note: string },
  _idempotencyKey?: string,
): Promise<Result<ProductView>> {
  const { data, error } = await db().rpc("release_bom", {
    p_product_code: input.product_code,
    p_note: input.note,
  });
  return thenProduct(input.product_code, data, error);
}

export async function discardBomDraft(
  input: { product_code: string },
): Promise<Result<ProductView>> {
  const { data, error } = await db().rpc("discard_bom_draft", {
    p_product_code: input.product_code,
  });
  return thenProduct(input.product_code, data, error);
}

export async function createBomItem(
  input: {
    name: string;
    category_code?: string;
    base_uom: string;
    kind?: "goods" | "service";
    standard_price?: number | null;
  },
): Promise<Result<{ code: string; name: string; existing: boolean }>> {
  const { data, error } = await db().rpc("create_bom_item", {
    p_name: input.name,
    p_category_code: input.category_code ?? "uncurated",
    p_base_uom: input.base_uom,
    p_kind: input.kind ?? "goods",
    p_standard_price: input.standard_price ?? null,
  });
  const res = fromSeam<{ code: string; name?: string; existing: boolean }>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code: res.data.code, name: res.data.name ?? input.name.trim(), existing: res.data.existing });
}

/** Filing a drawing against a product — through the documents seam, which is
 *  where every link to a record is made and refused (0024). A revision is a
 *  new file on the same product, never an edit (A5). */
export async function attachProductDrawing(
  input: { product_code: string; attachment_id: string; kind: "Gambar Kerja" | "Gambar Jadi" },
): Promise<Result<ProductView>> {
  const { data, error } = await core().rpc("attach_link", {
    p_attachment_id: input.attachment_id,
    p_entity: "product",
    p_entity_no: input.product_code,
    p_kind: input.kind,
    p_note: null,
    p_key: null,
  });
  return thenProduct(input.product_code, data, error);
}
