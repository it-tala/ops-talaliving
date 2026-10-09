"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileUp, Package, Pencil, RotateCcw, MinusCircle } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { formatIDR } from "@/lib/format";
import { design, documents } from "@/demo/api";
import {
  DESIGN_BOXES, type DesignBox, type DesignBoxKey, type DesignBoxVersion,
} from "@/services/design/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** The six boxes of one design item (0248, Studio Desain S1).
 *
 *  A box is filled by doing the work — uploading, writing the specification,
 *  making the BOM — and never by saying so. Uploading again is the next
 *  version; the latest is the one that counts (D399). Nothing is required
 *  (D401): an empty box only shows as empty. *Not needed* is one tap, so an
 *  item without a render can still be complete. */
export function ItemBoxes({
  itemNo, canEdit, canMakeProduct, onChanged,
}: { itemNo: string; canEdit: boolean; canMakeProduct: boolean; onChanged?: () => void }) {
  const [boxes, reloadBoxes] = useLoad(() => design.listDesignBoxes({ item_no: itemNo }), [itemNo]);
  const [versions, reloadVersions] = useLoad(() => design.listDesignBoxVersions(itemNo), [itemNo]);
  const refresh = () => { reloadBoxes(); reloadVersions(); onChanged?.(); };
  const history = versions.status === "ready" ? versions.data : [];

  /* The PDF has a version filed after the latest DWG: the source is behind
     the drawing the workshop reads. A flag, never a refusal. */
  const lastLive = (k: DesignBoxKey) => history.filter((v) => v.box === k && !v.removed).at(-1);
  const pdf = lastLive("pdf");
  const dwg = lastLive("dwg");
  const dwgBehind = pdf && dwg && pdf.at > dwg.at ? { pdf: pdf.label, dwg: dwg.label } : null;

  return (
    <Loaded state={boxes} onRetry={refresh}>
      {(rows) => (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {DESIGN_BOXES.map((def) => {
            const b = rows.find((x) => x.box === def.key);
            if (!b) return null;
            return (
              <BoxCard key={def.key} b={b} history={history.filter((v) => v.box === def.key)}
                dwgBehind={def.key === "dwg" ? dwgBehind : null}
                canEdit={canEdit} canMakeProduct={canMakeProduct} onChanged={refresh} />
            );
          })}
        </div>
      )}
    </Loaded>
  );
}

/** The six boxes as six small squares, for a row in a list. */
export function BoxChips({ boxes }: { boxes: DesignBox[] }) {
  const tr = useTr();
  return (
    <span className="inline-flex gap-[3px]">
      {DESIGN_BOXES.map((def) => {
        const b = boxes.find((x) => x.box === def.key);
        const st = b?.state ?? "kosong";
        return (
          <span key={def.key}
            title={`${def.label}: ${st === "terisi" ? tr("filled", "terisi") : st === "tidak_perlu" ? tr("not needed", "tidak perlu") : tr("empty", "kosong")}`}
            className={cn(
              "inline-grid h-5 min-w-[22px] place-items-center rounded px-0.5 text-[9.5px] font-bold",
              st === "terisi" && "bg-brand-700 text-white",
              st === "tidak_perlu" && "border border-dashed border-slate-300 text-slate-400",
              st === "kosong" && "border border-slate-200 bg-slate-50 text-slate-400",
            )}>
            {def.short}
          </span>
        );
      })}
    </span>
  );
}

/** Filled over all, as a bar and a count. */
export function BoxBar({ filled, total, className }: { filled: number; total: number; className?: string }) {
  const tr = useTr();
  return (
    <span className={cn("inline-grid min-w-[110px] gap-0.5", className)}>
      <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100" role="img"
        aria-label={tr(`${filled} of ${total} boxes filled`, `${filled} dari ${total} kotak terisi`)}>
        <span className="block h-full rounded-full bg-brand-700" style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
      </span>
      <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-500">
        {tr(`${filled} / ${total} filled`, `${filled} / ${total} terisi`)}
      </span>
    </span>
  );
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" });
}

function BoxCard({
  b, history, dwgBehind, canEdit, canMakeProduct, onChanged,
}: {
  b: DesignBox; history: DesignBoxVersion[]; dwgBehind: { pdf: string; dwg: string } | null;
  canEdit: boolean; canMakeProduct: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const def = DESIGN_BOXES.find((d) => d.key === b.box)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<null | "upload" | "spec" | "skip" | "product">(null);
  const [spec, setSpec] = useState("");
  const [code, setCode] = useState(b.item_no);
  const [busy, setBusy] = useState(false);
  const isFile = def.kind != null;
  const nextLabel = (() => {
    const n = history.length + 1;
    return n <= 26 ? String.fromCharCode(64 + n) : `Z${n - 25}`;
  })();

  function cancel() { setMode(null); setFile(null); setNote(""); }

  async function upload() {
    if (!file || !def.kind) return;
    setBusy(true);
    const up = await documents.upload({ file, kind: def.kind, entity: "design_item", entity_no: b.item_no, origin: "tala" });
    if (up.error) { setBusy(false); toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); return; }
    const link = await documents.link({ attachment_id: up.data.id, entity: "design_item", entity_no: b.item_no, kind: def.kind, note: note.trim() || null });
    setBusy(false);
    if (link.error) { toast("warning", tr(`${file.name} is in Drive but not on the item`, `${file.name} ada di Drive tetapi belum tertaut ke item`), link.error.message); return; }
    toast("success", tr(`${def.label}: version ${nextLabel} saved`, `${def.label}: versi ${nextLabel} tersimpan`),
      tr("This is the version that counts now.", "Ini versi yang berlaku sekarang."));
    cancel();
    onChanged();
  }

  async function saveSpec() {
    setBusy(true);
    const r = await design.saveDesignSpec({ item_no: b.item_no, body: spec, note: note.trim() || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    if (r.meta.outcome === "noop") toast("info", tr("No change", "Tidak ada perubahan"), tr("Same as the last version.", "Sama dengan versi terakhir."));
    else toast("success", tr("Specification saved", "Spesifikasi tersimpan"));
    cancel();
    onChanged();
  }

  async function skip(on: boolean) {
    setBusy(true);
    const r = await design.setDesignBoxSkip({ item_no: b.item_no, box: b.box, skip: on, note: on ? note.trim() || null : null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", on ? tr(`${def.label}: not needed`, `${def.label}: tidak perlu`) : tr(`${def.label}: needed again`, `${def.label}: perlu lagi`));
    cancel();
    onChanged();
  }

  async function makeProduct() {
    setBusy(true);
    const r = await design.productFromDesignItem({ item_no: b.item_no, product_code: code.trim() || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not created", "Tidak dibuat"), r.error.message); return; }
    toast("success", r.data.existing
      ? tr(`Linked to product ${r.data.product_code}`, `Ditautkan ke produk ${r.data.product_code}`)
      : tr(`Product ${r.data.product_code} made`, `Produk ${r.data.product_code} dibuat`),
    tr("Fill its BOM in Production → BOM.", "Isi BOM-nya di Produksi → BOM."));
    cancel();
    onChanged();
  }

  const badge = b.state === "terisi"
    ? <Badge tone="green">{b.box === "bom" ? `rev ${b.latest_label}` : b.box === "spec" ? tr(`version ${b.latest_label}`, `versi ${b.latest_label}`) : tr(`version ${b.latest_label}`, `versi ${b.latest_label}`)}</Badge>
    : b.state === "tidak_perlu" ? <Badge tone="slate">{tr("not needed", "tidak perlu")}</Badge>
      : <Badge tone="slate">{tr("empty", "kosong")}</Badge>;

  return (
    <section className={cn(
      "flex min-w-0 flex-col gap-2 rounded-xl border bg-white p-3",
      b.state === "terisi" ? "border-brand-300" : b.state === "tidak_perlu" ? "border-dashed border-slate-300 bg-slate-50/70" : "border-slate-200",
    )}>
      <header className="flex items-center gap-2">
        <h4 className="text-[13px] font-semibold text-slate-800">{def.label}</h4>
        <span className="ml-auto">{badge}</span>
      </header>

      {/* What is in the box now */}
      {b.state === "tidak_perlu" ? (
        <p className="text-[12px] text-slate-500">
          {b.skip_note || tr("Not needed for this item.", "Tidak perlu untuk item ini.")}
          {b.skip_by && <span className="text-slate-400"> · {b.skip_by}, {when(b.skip_at)}</span>}
        </p>
      ) : b.box === "bom" ? (
        <BomBody b={b} />
      ) : b.box === "spec" ? (
        mode === "spec" ? null : b.spec_body
          ? <p className="whitespace-pre-line text-[13px] text-slate-700">{b.spec_body}</p>
          : <p className="text-[12px] text-slate-400">{tr("Not written yet.", "Belum diisi.")}</p>
      ) : b.latest_filename ? (
        <div className="min-w-0">
          {b.latest_link ? (
            <a href={b.latest_link} target="_blank" rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate text-[13px] text-brand-700 hover:underline">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{b.latest_filename}</span>
            </a>
          ) : (
            <span className="block truncate text-[13px] text-slate-700">{b.latest_filename}</span>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-slate-400">{tr("No file yet.", "Belum ada file.")}</p>
      )}
      {dwgBehind && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {tr(`DWG is version ${dwgBehind.dwg}; the PDF is already version ${dwgBehind.pdf}.`,
            `DWG masih versi ${dwgBehind.dwg}; PDF sudah versi ${dwgBehind.pdf}.`)}
        </p>
      )}

      {/* Forms */}
      {mode === "upload" && file && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2">
          <p className="truncate text-[12px] text-slate-600">{file.name} → {tr(`version ${nextLabel}`, `versi ${nextLabel}`)}</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
            placeholder={tr("Note (optional): what changed", "Catatan (boleh kosong): apa yang berubah")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={FileUp} onClick={upload} disabled={busy}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      )}
      {mode === "spec" && (
        <div className="space-y-2">
          <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={4} autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
            placeholder={tr("Material, finishing, hardware, fabric…", "Material, finishing, hardware, kain…")} />
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
            placeholder={tr("Note (optional)", "Catatan (boleh kosong)")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={saveSpec} disabled={busy || !spec.trim()}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      )}
      {mode === "skip" && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} autoFocus
            placeholder={tr("Why (optional): e.g. the client's own design", "Kenapa (boleh kosong): mis. desain dari klien")} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={() => skip(true)} disabled={busy}>{tr("Mark not needed", "Tandai tidak perlu")}</Button>
          </div>
        </div>
      )}
      {mode === "product" && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2">
          <label className="block text-[11px] text-slate-500">{tr("Product code", "Kode produk")}
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={cn(inputCls, "mt-1 font-mono")} />
          </label>
          <p className="text-[11px] text-slate-500">
            {tr("Kept out of the active catalogue until an order line names it. Its BOM prices the quotation.",
              "Tidak tampil di katalog aktif sampai dipesan. BOM-nya dipakai untuk harga quotation.")}
          </p>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={Package} onClick={makeProduct} disabled={busy || !code.trim()}>{tr("Make product", "Buat produk")}</Button>
          </div>
        </div>
      )}

      {/* Actions */}
      {canEdit && mode === null && (
        <div className="flex flex-wrap gap-1.5">
          {isFile && b.state !== "tidak_perlu" && (
            <>
              <input ref={fileRef} type="file" accept={def.accept} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f) { setFile(f); setMode("upload"); } }} />
              <Button size="sm" variant="outline" icon={FileUp} onClick={() => fileRef.current?.click()}>
                {history.length ? tr(`Upload version ${nextLabel}`, `Unggah versi ${nextLabel}`) : tr("Upload", "Unggah")}
              </Button>
            </>
          )}
          {b.box === "spec" && b.state !== "tidak_perlu" && (
            <Button size="sm" variant="outline" icon={Pencil} onClick={() => { setSpec(b.spec_body ?? ""); setMode("spec"); }}>
              {b.spec_body ? tr("Edit", "Ubah") : tr("Write", "Isi")}
            </Button>
          )}
          {b.box === "bom" && b.state !== "tidak_perlu" && !b.product_code && canMakeProduct && (
            <Button size="sm" variant="outline" icon={Package} onClick={() => setMode("product")}>{tr("Make product & BOM", "Buat produk & BOM")}</Button>
          )}
          {b.state === "kosong" && (
            <Button size="sm" variant="ghost" icon={MinusCircle} onClick={() => setMode("skip")}>{tr("Not needed", "Tidak perlu")}</Button>
          )}
          {b.state === "tidak_perlu" && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => skip(false)} disabled={busy}>{tr("Needed again", "Perlu lagi")}</Button>
          )}
        </div>
      )}
      {b.box === "bom" && !b.product_code && !canMakeProduct && b.state === "kosong" && (
        <p className="text-[11px] text-slate-400">{tr("A product and its BOM are made by production.", "Produk dan BOM dibuat oleh produksi.")}</p>
      )}

      {/* History, newest first */}
      {history.length > 0 && (
        <ul className="mt-auto space-y-0.5 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          {[...history].reverse().map((v) => (
            <li key={`${v.box}-${v.ordinal}`} className={cn(v.removed && "line-through opacity-60")}>
              <span className="tabular-nums">{when(v.at)}</span>{" "}
              <b className="font-semibold text-slate-700">{b.box === "spec" ? tr(`version ${v.label}`, `versi ${v.label}`) : tr(`version ${v.label}`, `versi ${v.label}`)}</b>
              {v.by_name && <> · {v.by_name}</>}
              {v.note && <span className="text-slate-600"> · “{v.note}”</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BomBody({ b }: { b: DesignBox }) {
  const tr = useTr();
  if (!b.product_code) {
    return <p className="text-[12px] text-slate-400">{tr("No product yet, so no BOM.", "Belum ada produk, jadi belum ada BOM.")}</p>;
  }
  return (
    <div className="space-y-1 text-[13px]">
      <p className="text-slate-700">
        {tr("Product", "Produk")} <span className="font-mono text-[12px]">{b.product_code}</span>
        {b.bom_rev != null ? <> · BOM rev {b.bom_rev}</> : b.bom_draft_rev != null ? <> · {tr(`BOM draft rev ${b.bom_draft_rev}`, `draft BOM rev ${b.bom_draft_rev}`)}</> : <> · {tr("no BOM yet", "belum ada BOM")}</>}
      </p>
      {b.bom_cost != null && (
        <p className="text-[12px] text-slate-600">
          {tr("Production cost", "Biaya produksi")} <b className="tabular-nums">{formatIDR(b.bom_cost)}</b> / {tr("unit", "unit")}
        </p>
      )}
      <Link href={`/produksi/bom?open=${encodeURIComponent(b.product_code)}`} className="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:underline">
        <ExternalLink className="h-3 w-3" /> {tr("Open the BOM", "Buka BOM")}
      </Link>
    </div>
  );
}
