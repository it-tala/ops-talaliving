"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { design, documents, quotation } from "@/demo/api";
import { itemCode, type DesignItemView } from "@/services/design/contracts";
import type { AttachmentView } from "@/services/documents/contracts";
import type { QuotationLineView } from "@/services/quotation/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** The drawings a price can rest on (0225): ours, or the client's own. */
const PRICED_DRAWING_KINDS = ["Render", "Layout / Floor Plan", "Gambar Kerja", "Client Drawing"];

/** A project's design items that can still be offered: not dropped. */
export function useOfferableItems(projectCode: string | null | undefined) {
  const [items, setItems] = useState<DesignItemView[]>([]);
  useEffect(() => {
    let live = true;
    if (!projectCode) { setItems([]); return; }
    void design.getProjectDesign(projectCode).then((r) => {
      if (live) setItems((r.data?.items ?? []).filter((i) => i.status !== "DROPPED"));
    });
    return () => { live = false; };
  }, [projectCode]);
  return items;
}

/** Pick design items to offer; one line each, named and sized from the item
 *  (0225). Items already on the quotation are shown, not offered twice. */
export function QuoteFromDesign({
  quoteNo, items, onLines, onDone, onCancel,
}: {
  quoteNo: string; items: DesignItemView[]; onLines: QuotationLineView[];
  onDone: () => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const already = new Set(onLines.map((l) => l.design_item_no).filter(Boolean) as string[]);
  const groups = useMemo(() => {
    const m = new Map<string, DesignItemView[]>();
    for (const i of items) {
      const k = i.collection_code;
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, xs]) => xs);
  }, [items]);
  const toggle = (no: string) => {
    const n = new Set(picked);
    if (n.has(no)) n.delete(no); else n.add(no);
    setPicked(n);
  };

  async function add() {
    setBusy(true);
    const r = await quotation.addQuotationLinesFromDesign(quoteNo, [...picked]);
    setBusy(false);
    if (r.error) { toast("warning", tr("Not added", "Tidak ditambahkan"), r.error.message); return; }
    toast("success", tr(`${r.data.added} items offered`, `${r.data.added} item ditawarkan`),
      tr("Fill in the cost of each — or fix its price.", "Isi ongkos tiap item — atau tetapkan harganya."));
    onDone();
  }

  return (
    <div className="space-y-2 border-b border-slate-100 bg-violet-50/40 px-4 py-3">
      <p className="text-[12px] text-slate-600">
        {tr("Each item becomes a line, named and sized from the design, priced on its latest drawing until the quotation is sent — then that drawing is frozen with the price.",
          "Setiap item menjadi satu baris, nama dan ukurannya dari desain, dihargai dari gambar terbarunya sampai quotation dikirim — lalu gambar itu dikunci bersama harganya.")}
      </p>
      {groups.length === 0 ? (
        <p className="text-[12px] text-slate-500">{tr("This project has no design items yet — add them on its Design tab.", "Proyek ini belum punya item desain — tambahkan di tab Desain.")}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((xs) => (
            <div key={xs[0].collection_code} className="rounded-lg border border-slate-200 bg-white p-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {xs[0].collection_code} · {xs[0].collection_name}
              </p>
              {xs.map((i) => (
                <label key={i.item_no} className={cn("flex items-center gap-2 py-0.5 text-[13px]", already.has(i.item_no) && "text-slate-400")}>
                  <input type="checkbox" disabled={already.has(i.item_no)} checked={picked.has(i.item_no)} onChange={() => toggle(i.item_no)} />
                  <span className="font-mono text-[11px] text-slate-400">{itemCode(i)}</span>
                  <span>{i.name}</span>
                  <span className="text-[11px] text-slate-400">× {i.qty}</span>
                  {already.has(i.item_no) && <span className="text-[11px]">{tr("on this quotation", "sudah di quotation ini")}</span>}
                  {!already.has(i.item_no) && i.design_files === 0 && i.client_files === 0 && (
                    <span className="text-[11px] text-amber-700">{tr("no drawing yet", "belum ada gambar")}</span>
                  )}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Layers} onClick={add} disabled={busy || picked.size === 0}>
          {tr(`Offer ${picked.size} items`, `Tawarkan ${picked.size} item`)}
        </Button>
      </div>
    </div>
  );
}

/** Under a line's name: the design item it offers and the drawing its price
 *  rests on, and a warning when the item has been drawn again since. */
export function LineDesignNote({ l }: { l: QuotationLineView }) {
  const tr = useTr();
  if (!l.design_item_no) return null;
  return (
    <span className="mt-0.5 block text-[11px]">
      <span className="font-mono text-violet-700">{l.design_item_no}</span>
      <span className="text-slate-500">
        {" · "}{l.design_file_name
          ? tr(`drawing ${l.design_file_name}`, `gambar ${l.design_file_name}`)
          : <span className="text-amber-700">{tr("no drawing yet", "belum ada gambar")}</span>}
        {l.status === "DRAFT" && l.design_file_name && !l.line_design_file_id && tr(" (latest)", " (terbaru)")}
      </span>
      {l.design_changed && (
        <span className="mt-0.5 flex items-center gap-1 text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          {l.status === "DRAFT"
            ? tr("a newer drawing exists — this line is pinned to an older one", "ada gambar yang lebih baru — baris ini dikunci ke gambar lama")
            : tr("drawn again since this offer — the price is for the drawing above", "sudah digambar ulang setelah penawaran ini — harganya untuk gambar di atas")}
        </span>
      )}
    </span>
  );
}

/** In a draft line's editor: which design item it offers, and which of its
 *  drawings the price rests on. */
export function LineDesignPicker({
  items, itemNo, fileId, onChange,
}: {
  items: DesignItemView[]; itemNo: string; fileId: string;
  onChange: (itemNo: string, fileId: string) => void;
}) {
  const tr = useTr();
  const [files, setFiles] = useState<AttachmentView[]>([]);
  useEffect(() => {
    let live = true;
    if (!itemNo) { setFiles([]); return; }
    void documents.byEntity("design_item", itemNo).then((r) => {
      if (!live) return;
      setFiles((r.data ?? []).filter((f) => f.links.some((l) => l.entity === "design_item" && l.entity_no === itemNo
        && PRICED_DRAWING_KINDS.includes(l.kind))));
    });
    return () => { live = false; };
  }, [itemNo]);
  const cls = "h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-[12px]";
  if (items.length === 0 && !itemNo) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <select value={itemNo} onChange={(e) => onChange(e.target.value, "")} aria-label={tr("Design item", "Item desain")}
        className={cn(cls, "max-w-[220px]")}>
        <option value="">{tr("— no design item —", "— bukan item desain —")}</option>
        {items.map((i) => <option key={i.item_no} value={i.item_no}>{itemCode(i)} · {i.name}</option>)}
      </select>
      {itemNo && (
        <select value={fileId} onChange={(e) => onChange(itemNo, e.target.value)} aria-label={tr("Drawing", "Gambar")}
          className={cn(cls, "max-w-[200px]")}>
          <option value="">{tr("latest drawing", "gambar terbaru")}</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
        </select>
      )}
      {itemNo && (
        <button type="button" onClick={() => onChange("", "")} aria-label={tr("No design item", "Bukan item desain")}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

/** Lines in the drafters' order: by collection (D419; within it, the order
 *  the items were added), then whatever is not a design item. Returns the rows with a heading before each new group. */
export function groupLines<T extends QuotationLineView>(rows: T[]): ({ heading: string; key: string } | T)[] {
  if (!rows.some((r) => r.design_item_no)) return rows;
  const sorted = [...rows].sort((a, b) => {
    const ka = a.design_item_no ? `0|${a.collection_code}` : "1";
    const kb = b.design_item_no ? `0|${b.collection_code}` : "1";
    return ka.localeCompare(kb) || a.line_no - b.line_no;
  });
  const out: ({ heading: string; key: string } | T)[] = [];
  let last = "";
  for (const r of sorted) {
    const key = r.design_item_no ? `${r.collection_code}` : "__other";
    if (key !== last) {
      out.push({
        key,
        heading: r.design_item_no ? `${r.collection_code} · ${r.collection_name}` : "",
      });
      last = key;
    }
    out.push(r);
  }
  return out;
}

export const isHeading = (x: unknown): x is { heading: string; key: string } =>
  typeof x === "object" && x !== null && "heading" in x;
