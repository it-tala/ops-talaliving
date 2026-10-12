"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, FileUp, ImageIcon, MinusCircle, Package, Pencil, RotateCcw, Box } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { design, documents, production } from "@/demo/api";
import {
  DESIGN_BOXES, boxProgress, itemCode,
  type DesignBox, type DesignBoxKey, type DesignBoxVersion, type DesignItemView,
} from "@/services/design/contracts";
import type { ProductDrawingEntry } from "@/services/production/contracts";
import { BomColumn, DrawingViewer, useProductBom } from "@/app/(app)/produksi/bom/ProductDrawer";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { BoxBar } from "./item-boxes";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** The file boxes, in the order the drafter fills them. */
const FILE_BOXES = DESIGN_BOXES.filter((d) => d.kind != null);

/** A product's drawing kinds, for the boxes whose files the BOM reads too. */
const PRODUCT_KIND: Partial<Record<DesignBoxKey, "Gambar Kerja" | "Gambar Jadi">> = { pdf: "Gambar Kerja", foto: "Gambar Jadi" };

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" });
}

function nextLabel(n: number): string {
  return n <= 26 ? String.fromCharCode(64 + n) : `Z${n - 25}`;
}

/** One design item as one record, laid out like a product on Production → BOM
 *  (D421): its files on the left — working drawing, DWG / 3D, render, photo,
 *  each with its versions — and the specification under them; its BOM on the
 *  right, the same BOM the product drawer edits. A design item and the
 *  product it becomes are one thing to the drafter, so they are one screen.
 *
 *  The working drawing and the photo are filed on the product as well as the
 *  item, so the AI reads the drawing the drafter just uploaded and the BOM
 *  page shows the same revisions. */
export function ItemStudioDrawer({
  itemNo, canEdit, canMakeProduct, onClose, onChanged, header, showProject = true,
}: {
  itemNo: string; canEdit: boolean; canMakeProduct: boolean;
  /** Whoever may open the project page gets a link to it. */
  showProject?: boolean;
  onClose: () => void; onChanged: () => void;
  /** Extra controls under the title (the task line on Production → Design). */
  header?: (i: DesignItemView, complete: boolean) => React.ReactNode;
}) {
  const tr = useTr();
  const [item, reloadItem] = useLoad(() => design.getDesignItem(itemNo), [itemNo]);
  const [boxes, reloadBoxes] = useLoad(() => design.listDesignBoxes({ item_no: itemNo }), [itemNo]);
  const [versions, reloadVersions] = useLoad(() => design.listDesignBoxVersions(itemNo), [itemNo]);
  const refresh = () => { reloadItem(); reloadBoxes(); reloadVersions(); onChanged(); };
  const i = item.status === "ready" ? item.data : null;
  const rows = boxes.status === "ready" ? boxes.data : [];
  const history = versions.status === "ready" ? versions.data : [];
  const prog = boxProgress(rows);
  const productCode = rows.find((b) => b.box === "bom")?.product_code ?? null;
  const dropped = i?.status === "DROPPED";
  const size = i && (i.length_mm || i.width_mm || i.height_mm)
    ? `${[i.length_mm, i.width_mm, i.height_mm].map((v) => v ?? "—").join(" × ")} mm` : null;

  return (
    <Drawer open onClose={onClose} width="lg:max-w-[max(80vw,1400px)]"
      title={i ? <span><span className="font-mono text-[13px] text-slate-500">{itemCode(i)}</span> · {i.name}</span> : itemNo}
      subtitle={i ? [`${tr("Collection", "Koleksi")} ${i.collection_code} · ${i.collection_name}`, size, `${i.qty} pcs`].filter(Boolean).join(" · ") : undefined}>
      <Loaded state={boxes} onRetry={refresh}>
        {() => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 px-3 py-2">
              {prog.total > 0 && <BoxBar filled={prog.filled} total={prog.total} />}
              {dropped && <Badge tone="red">{tr("dropped", "dikeluarkan")}</Badge>}
              {i && header?.(i, prog.total > 0 && prog.filled === prog.total)}
              {i && showProject && (
                <Link href={`/proyek/order/${encodeURIComponent(i.project_code)}`}
                  className="ml-auto inline-flex items-center gap-1 text-[12px] text-brand-700 hover:underline">
                  <ExternalLink className="h-3 w-3" /> {i.project_code} {i.project_name}
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
                {/* What the BOM is read off, large: the render above, the
                    working drawing below (D423). */}
                <FileBox boxKey="render" height={360} itemNo={itemNo} rows={rows} history={history} productCode={productCode}
                  canEdit={canEdit && !dropped} onChanged={refresh} />
                <FileBox boxKey="pdf" height={600} itemNo={itemNo} rows={rows} history={history} productCode={productCode}
                  canEdit={canEdit && !dropped} onChanged={refresh} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FileBox boxKey="dwg" height={180} compact itemNo={itemNo} rows={rows} history={history} productCode={productCode}
                    canEdit={canEdit && !dropped} onChanged={refresh} />
                  <FileBox boxKey="foto" height={180} compact itemNo={itemNo} rows={rows} history={history} productCode={productCode}
                    canEdit={canEdit && !dropped} onChanged={refresh} />
                </div>
                <SpecPanel b={rows.find((b) => b.box === "spec")} history={history.filter((v) => v.box === "spec")}
                  canEdit={canEdit && !dropped} onChanged={refresh} />
              </div>
              <div className="min-w-0">
                {productCode
                  ? <ItemBom productCode={productCode} onChanged={refresh} />
                  : <NoProduct b={rows.find((b) => b.box === "bom")} history={history}
                      canEdit={canEdit && !dropped} canMakeProduct={canMakeProduct} onChanged={refresh} />}
              </div>
            </div>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

/* ── the files ───────────────────────────────────────────────────────────── */

/** One kind of file on the item — render, working drawing, DWG / 3D or
 *  photo: its latest version shown (and turnable), every version one click
 *  away, upload and *not needed* in its header. */
function FileBox({
  boxKey, height, compact, itemNo, rows, history, productCode, canEdit, onChanged,
}: {
  boxKey: DesignBoxKey; height: number; compact?: boolean;
  itemNo: string; rows: DesignBox[]; history: DesignBoxVersion[]; productCode: string | null;
  canEdit: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const def = FILE_BOXES.find((d) => d.key === boxKey)!;
  const b = rows.find((x) => x.box === boxKey);
  const list = history.filter((v) => v.box === boxKey && !v.removed).reverse();
  const [pick, setPick] = useState<string | null>(null);
  const shown = list.find((v) => v.attachment_id === pick) ?? list[0] ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<null | "upload" | "skip">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const next = nextLabel(history.filter((v) => v.box === boxKey).length + 1);
  const Icon = boxKey === "pdf" ? FileText : boxKey === "dwg" ? Box : ImageIcon;

  /* The PDF has a version filed after the latest DWG: the source is behind
     the drawing the workshop reads. A flag, never a refusal. */
  const lastLive = (k: DesignBoxKey) => history.filter((v) => v.box === k && !v.removed).at(-1);
  const pdf = lastLive("pdf");
  const dwg = lastLive("dwg");
  const dwgBehind = boxKey === "dwg" && pdf && dwg && pdf.at > dwg.at ? { pdf: pdf.label, dwg: dwg.label } : null;

  function cancel() { setMode(null); setFile(null); setNote(""); }

  async function upload() {
    if (!file || !def.kind) return;
    setBusy(true);
    const up = await documents.upload({ file, kind: def.kind, entity: "design_item", entity_no: itemNo, origin: "tala" });
    if (up.error) { setBusy(false); toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); return; }
    const link = await documents.link({ attachment_id: up.data.id, entity: "design_item", entity_no: itemNo, kind: def.kind, note: note.trim() || null });
    if (link.error) { setBusy(false); toast("warning", tr(`${file.name} is in Drive but not on the item`, `${file.name} ada di Drive tetapi belum tertaut ke item`), link.error.message); return; }
    /* The BOM reads the same drawing: file it on the product too. */
    const pk = PRODUCT_KIND[boxKey];
    if (productCode && pk) {
      const pl = await production.attachProductDrawing({ product_code: productCode, attachment_id: up.data.id, kind: pk });
      if (pl.error) toast("warning", tr("Saved on the item, not on the product", "Tersimpan di item, belum di produk"), pl.error.message);
    }
    setBusy(false);
    toast("success", tr(`${def.label}: version ${next} saved`, `${def.label}: versi ${next} tersimpan`),
      tr("This is the version that counts now.", "Ini versi yang berlaku sekarang."));
    setPick(up.data.id);
    cancel();
    onChanged();
  }

  async function skip(on: boolean) {
    setBusy(true);
    const r = await design.setDesignBoxSkip({ item_no: itemNo, box: boxKey, skip: on, note: on ? note.trim() || null : null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", on ? tr(`${def.label}: not needed`, `${def.label}: tidak perlu`) : tr(`${def.label}: needed again`, `${def.label}: perlu lagi`));
    cancel();
    onChanged();
  }

  const entry: ProductDrawingEntry | null = shown?.attachment_id ? {
    kind: "Gambar Kerja", attachment_id: shown.attachment_id, filename: shown.filename ?? "",
    mime: "", url: shown.web_view_link, linked_by: shown.by_name ?? "", linked_at: shown.at,
  } : null;

  return (
    <section className={cn("rounded-xl border px-3 py-3", b?.state === "tidak_perlu" ? "border-dashed border-slate-300 bg-slate-50/60" : "border-slate-200")}>
      <header className="flex flex-wrap items-center gap-1.5">
        <Icon className="h-4 w-4 text-slate-400" />
        <h4 className="text-[13px] font-semibold text-slate-800">{def.label}</h4>
        {b?.state === "terisi" && shown && <Badge tone="green">{tr(`version ${shown.label}`, `versi ${shown.label}`)}</Badge>}
        {b?.state === "tidak_perlu" && <Badge tone="slate">{tr("not needed", "tidak perlu")}</Badge>}
        {canEdit && mode === null && b && (
          <div className="ml-auto flex flex-wrap gap-1">
            {b.state !== "tidak_perlu" && (
              <>
                <input ref={fileRef} type="file" accept={def.accept} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f) { setFile(f); setMode("upload"); } }} />
                <Button size="sm" variant="outline" icon={FileUp} onClick={() => fileRef.current?.click()}>
                  {list.length ? (compact ? tr(`Version ${next}`, `Versi ${next}`) : tr(`Upload version ${next}`, `Unggah versi ${next}`)) : tr("Upload", "Unggah")}
                </Button>
              </>
            )}
            {b.state === "kosong" && (
              <Button size="sm" variant="ghost" icon={MinusCircle} onClick={() => setMode("skip")} aria-label={tr("Not needed", "Tidak perlu")}>
                {!compact && tr("Not needed", "Tidak perlu")}
              </Button>
            )}
            {b.state === "tidak_perlu" && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => skip(false)} disabled={busy}>{tr("Needed again", "Perlu lagi")}</Button>
            )}
          </div>
        )}
      </header>

      {mode === "upload" && file && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
          <p className="truncate text-[12px] text-slate-600">{file.name} → {tr(`version ${next}`, `versi ${next}`)}</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
            placeholder={tr("Note (optional): what changed", "Catatan (boleh kosong): apa yang berubah")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={FileUp} onClick={upload} disabled={busy}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      )}
      {mode === "skip" && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} autoFocus
            placeholder={tr("Why (optional): e.g. the client's own design", "Kenapa (boleh kosong): mis. desain dari klien")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={() => skip(true)} disabled={busy}>{tr("Mark not needed", "Tandai tidak perlu")}</Button>
          </div>
        </div>
      )}
      {dwgBehind && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {tr(`DWG is version ${dwgBehind.dwg}; the PDF is already version ${dwgBehind.pdf}.`,
            `DWG masih versi ${dwgBehind.dwg}; PDF sudah versi ${dwgBehind.pdf}.`)}
        </p>
      )}

      <div className="mt-2">
        {b?.state === "tidak_perlu" ? (
          <p className="text-[12px] text-slate-500">
            {b.skip_note || tr("Not needed for this item.", "Tidak perlu untuk item ini.")}
            {b.skip_by && <span className="text-slate-400"> · {b.skip_by}, {when(b.skip_at)}</span>}
          </p>
        ) : entry ? (
          <>
            {/* A DWG or a 3D model has no preview: the viewer offers it as a link. */}
            <DrawingViewer key={entry.attachment_id} d={entry} height={height} />
            <p className="mt-1.5 truncate text-[11px] text-slate-500">
              {entry.filename} · {when(shown!.at)}{shown!.by_name ? ` · ${shown!.by_name}` : ""}
              {shown!.note && <> · “{shown!.note}”</>}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 text-center text-[12px] text-amber-800"
            style={{ height: Math.min(height, compact ? 90 : 160) }}>
            {tr(`No ${def.label.toLowerCase()} yet.`, `Belum ada ${def.label.toLowerCase()}.`)}
            {boxKey === "pdf" && tr(" The BOM is built from this drawing — upload it first if you have one.", " BOM disusun dari gambar ini — unggah dulu kalau ada.")}
          </div>
        )}
      </div>

      {/* Every version, newest first: a piece built last month was built from one of them. */}
      {list.length > 1 && (
        <ol className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
          {list.map((v, n) => (
            <li key={`${v.box}-${v.ordinal}`}>
              <button onClick={() => setPick(v.attachment_id)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                  shown?.ordinal === v.ordinal ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50")}>
                <span className="w-16 shrink-0 font-mono text-[10px] text-slate-400">{tr(`version ${v.label}`, `versi ${v.label}`)}</span>
                <span className="min-w-0 flex-1 truncate">{v.filename}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{when(v.at)}</span>
                {n === 0 && <Badge tone="green">{tr("latest", "terbaru")}</Badge>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── the specification ───────────────────────────────────────────────────── */

function SpecPanel({
  b, history, canEdit, onChanged,
}: { b: DesignBox | undefined; history: DesignBoxVersion[]; canEdit: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<null | "skip">(null);
  const [spec, setSpec] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  async function save() {
    setBusy(true);
    const r = await design.saveDesignSpec({ item_no: b!.item_no, body: spec, note: note.trim() || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    if (r.meta.outcome === "noop") toast("info", tr("No change", "Tidak ada perubahan"), tr("Same as the last version.", "Sama dengan versi terakhir."));
    else toast("success", tr("Specification saved", "Spesifikasi tersimpan"));
    setEditing(false); setNote("");
    onChanged();
  }
  async function skip(on: boolean) {
    setBusy(true);
    const r = await design.setDesignBoxSkip({ item_no: b!.item_no, box: "spec", skip: on, note: on ? note.trim() || null : null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    setMode(null); setNote("");
    onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <div className="flex items-center gap-2">
        <h4 className="text-[13px] font-semibold text-slate-800">{tr("Specification", "Spesifikasi")}</h4>
        {b.state === "terisi" && <Badge tone="green">{tr(`version ${b.latest_label}`, `versi ${b.latest_label}`)}</Badge>}
        {b.state === "tidak_perlu" && <Badge tone="slate">{tr("not needed", "tidak perlu")}</Badge>}
        {canEdit && !editing && mode === null && (
          <div className="ml-auto flex gap-1">
            {b.state !== "tidak_perlu" && (
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setSpec(b.spec_body ?? ""); setEditing(true); }}>
                {b.spec_body ? tr("Edit", "Ubah") : tr("Write", "Isi")}
              </Button>
            )}
            {b.state === "kosong" && <Button size="sm" variant="ghost" icon={MinusCircle} onClick={() => setMode("skip")}>{tr("Not needed", "Tidak perlu")}</Button>}
            {b.state === "tidak_perlu" && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => skip(false)} disabled={busy}>{tr("Needed again", "Perlu lagi")}</Button>}
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={4} autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
            placeholder={tr("Material, finishing, hardware, fabric…", "Material, finishing, hardware, kain…")} />
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={tr("Note (optional)", "Catatan (boleh kosong)")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={save} disabled={busy || !spec.trim()}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      ) : mode === "skip" ? (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} autoFocus
            placeholder={tr("Why (optional)", "Kenapa (boleh kosong)")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={() => skip(true)} disabled={busy}>{tr("Mark not needed", "Tandai tidak perlu")}</Button>
          </div>
        </div>
      ) : b.state === "tidak_perlu" ? (
        <p className="mt-1 text-[12px] text-slate-500">{b.skip_note || tr("Not needed for this item.", "Tidak perlu untuk item ini.")}</p>
      ) : b.spec_body ? (
        <p className="mt-1 whitespace-pre-line text-[13px] text-slate-700">{b.spec_body}</p>
      ) : (
        <p className="mt-1 text-[12px] text-slate-400">{tr("Not written yet.", "Belum diisi.")}</p>
      )}
      {history.length > 1 && !editing && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          {tr(`${history.length} versions · last ${when(history.at(-1)!.at)}`, `${history.length} versi · terakhir ${when(history.at(-1)!.at)}`)}
          {history.at(-1)!.by_name && ` · ${history.at(-1)!.by_name}`}
        </p>
      )}
    </div>
  );
}

/* ── the BOM ─────────────────────────────────────────────────────────────── */

function ItemBom({ productCode, onChanged }: { productCode: string; onChanged: () => void }) {
  const tr = useTr();
  const ctx = useProductBom(productCode, onChanged);
  return (
    <Loaded state={ctx.product} onRetry={ctx.reload}>
      {(p) => (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-[12px] text-slate-500">
            <Package className="h-3.5 w-3.5" />
            {tr("Product", "Produk")} <span className="font-mono text-slate-700">{p.product_code}</span>
            {p.dimension && <span>· {p.dimension}</span>}
            <Link href={`/produksi/bom?open=${encodeURIComponent(p.product_code)}`} className="ml-auto inline-flex items-center gap-1 text-brand-700 hover:underline">
              <ExternalLink className="h-3 w-3" /> {tr("Products & BOM", "Produk & BOM")}
            </Link>
          </p>
          <BomColumn ctx={ctx} p={p} />
        </div>
      )}
    </Loaded>
  );
}

/** No product yet: the BOM starts by making one, from the item's own name,
 *  size and drawings. */
function NoProduct({
  b, history, canEdit, canMakeProduct, onChanged,
}: {
  b: DesignBox | undefined; history: DesignBoxVersion[];
  canEdit: boolean; canMakeProduct: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [code, setCode] = useState(b?.item_no ?? "");
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  async function skip(on: boolean) {
    setBusy(true);
    const r = await design.setDesignBoxSkip({ item_no: b!.item_no, box: "bom", skip: on, note: null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    onChanged();
  }

  async function make() {
    setBusy(true);
    const r = await design.productFromDesignItem({ item_no: b!.item_no, product_code: code.trim() || null });
    if (r.error) { setBusy(false); toast("warning", tr("Not created", "Tidak dibuat"), r.error.message); return; }
    /* The drawings the item already has go to the product, newest last, so
       the BOM and the AI read them at once. */
    for (const [box, kind] of Object.entries(PRODUCT_KIND) as [DesignBoxKey, "Gambar Kerja" | "Gambar Jadi"][]) {
      for (const v of history.filter((x) => x.box === box && !x.removed && x.attachment_id)) {
        await production.attachProductDrawing({ product_code: r.data.product_code, attachment_id: v.attachment_id!, kind });
      }
    }
    setBusy(false);
    toast("success", r.data.existing
      ? tr(`Linked to product ${r.data.product_code}`, `Ditautkan ke produk ${r.data.product_code}`)
      : tr(`Product ${r.data.product_code} made`, `Produk ${r.data.product_code} dibuat`),
    tr("Its BOM is on the right.", "BOM-nya ada di sebelah kanan."));
    onChanged();
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6">
      <h4 className="flex items-center gap-2 text-[14px] font-semibold text-slate-800">
        <Package className="h-4 w-4 text-slate-400" /> {tr("Bill of material", "Bill of material")}
      </h4>
      {b.state === "tidak_perlu" ? (
        <p className="mt-1 text-[13px] text-slate-500">{b.skip_note || tr("No BOM needed for this item.", "Item ini tidak perlu BOM.")}</p>
      ) : (
        <p className="mt-1 text-[13px] text-slate-600">
          {tr("The BOM belongs to a product. Make the product from this item — its name, size and drawings come with it — and the BOM opens here.",
            "BOM melekat pada produk. Buat produk dari item ini — nama, ukuran, dan gambarnya ikut — lalu BOM terbuka di sini.")}
        </p>
      )}
      {canEdit && (
        <div className="mt-2">
          {b.state === "tidak_perlu"
            ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => skip(false)} disabled={busy}>{tr("Needed again", "Perlu lagi")}</Button>
            : b.state === "kosong" && (
              <Button size="sm" variant="ghost" icon={MinusCircle} onClick={() => skip(true)} disabled={busy}>
                {tr("No BOM needed (e.g. made by a partner factory)", "Tidak perlu BOM (mis. dibuat pabrik mitra)")}
              </Button>
            )}
        </div>
      )}
      {b.state !== "tidak_perlu" && canEdit && canMakeProduct && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-slate-500">{tr("Product code", "Kode produk")}
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={cn(inputCls, "mt-1 w-56 font-mono")} />
          </label>
          <Button size="sm" icon={Package} onClick={make} disabled={busy || !code.trim()}>{tr("Make product & BOM", "Buat produk & BOM")}</Button>
        </div>
      )}
      {b.state !== "tidak_perlu" && !canMakeProduct && (
        <p className="mt-2 text-[12px] text-slate-400">{tr("A product and its BOM are made by production.", "Produk dan BOM dibuat oleh produksi.")}</p>
      )}
      {b.state !== "tidak_perlu" && canMakeProduct && (
        <p className="mt-2 text-[11px] text-slate-500">
          {tr("Kept out of the active catalogue until an order line names it. Its BOM prices the quotation.",
            "Tidak tampil di katalog aktif sampai dipesan. BOM-nya dipakai untuk harga quotation.")}
        </p>
      )}
    </div>
  );
}
