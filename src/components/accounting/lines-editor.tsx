"use client";

import { Plus, Scissors, XCircle, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { UomOptions } from "@/components/ui/uom-options";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import { ItemPicker } from "./item-picker";
import { LineKindSelect } from "./line-kind";
import {
  draftAmount, draftsTotal, isPricedKind, nextKey, splitFee, withTax, type LineDraft,
} from "@/services/accounting/lines";
import type { UomCode } from "@/services/procurement/contracts";

/** The detail of one ledger row, being rewritten (L12, D434).
 *
 *  Used by the re-detailing queue and by the drawer's *Edit rincian*. The
 *  amount is fixed — it is the bank's figure — so the editor's one job is to
 *  make the lines explain it: kinds, items, quantities, prices, and the sum
 *  against the amount always in view. Two helpers do the common splits in
 *  one click: the nota's tax as a figure (D435), and the transfer fee the
 *  bank folded into the amount (…2.500) as its own `fee` line.
 *
 *  An e-commerce order (D435 point 5) gets at most three lines — the listed
 *  price, the voucher as `discount`, the courier as `fee` — never one line
 *  per item, so the catalogue learns the price on the shelf and not the
 *  price after a one-day voucher.
 */
export function LinesEditor({
  lines, onChange, amount, idPrefix = "le", allowCreate = false, ecommerce = false, documents = [],
}: {
  lines: LineDraft[];
  onChange: (next: LineDraft[]) => void;
  /** The transaction's amount, which the lines must add up to. */
  amount: number;
  idPrefix?: string;
  allowCreate?: boolean;
  ecommerce?: boolean;
  /** The row's own documents (L11): when given, each line can say which
   *  one it was read from. The pointer is saved by `set_line_evidence`
   *  after the lines themselves. */
  documents?: { id: string; filename: string; kind?: string | null }[];
}) {
  const tr = useTr();
  const total = draftsTotal(lines);
  const agree = total === amount;
  const taxLine = lines.find((l) => l.kind === "tax");
  const taxAmount = taxLine ? draftAmount(taxLine) : 0;
  const canSplit = splitFee(lines, amount) !== null;
  const set = (key: number, next: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...next } : l)));

  return (
    <div className="space-y-2">
      {ecommerce && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-900">
          {tr("An online order: the listed price as one item line, the voucher as a discount, the courier as a fee — not one line per item (D435).",
            "Pesanan online: harga tercantum sebagai satu baris barang, voucher sebagai diskon, ongkir sebagai biaya — bukan satu baris per barang (D435).")}
        </p>
      )}

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="grid grid-cols-12 items-end gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2">
            <div className="col-span-5 sm:col-span-2">
              <label htmlFor={`${idPrefix}-kind-${l.key}`} className="block text-[11px] text-slate-500">{tr("Kind", "Jenis")}</label>
              <LineKindSelect id={`${idPrefix}-kind-${l.key}`} value={l.kind}
                onChange={(k) => set(l.key, { kind: k, amount: isPricedKind(k) ? l.amount : draftAmount(l) })} />
            </div>
            <div className={cn("col-span-7", isPricedKind(l.kind) ? "sm:col-span-4" : "sm:col-span-7")}>
              <label htmlFor={`${idPrefix}-desc-${l.key}`} className="block text-[11px] text-slate-500">{tr("Description", "Keterangan")}</label>
              <input id={`${idPrefix}-desc-${l.key}`} value={l.description}
                onChange={(e) => set(l.key, { description: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
            </div>
            {isPricedKind(l.kind) ? (
              <>
                <div className="col-span-3 sm:col-span-2">
                  <label htmlFor={`${idPrefix}-qty-${l.key}`} className="block text-[11px] text-slate-500">{tr("Qty", "Jml")}</label>
                  <NumberInput id={`${idPrefix}-qty-${l.key}`} value={l.qty} min={0} onChange={(v) => set(l.key, { qty: v })} />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <label htmlFor={`${idPrefix}-uom-${l.key}`} className="block text-[11px] text-slate-500">{tr("Unit", "Sat.")}</label>
                  <select id={`${idPrefix}-uom-${l.key}`} value={l.uom}
                    onChange={(e) => set(l.key, { uom: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-1 text-sm focus:border-brand-400 focus:outline-none">
                    <UomOptions current={l.uom as UomCode} />
                  </select>
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor={`${idPrefix}-price-${l.key}`} className="block text-[11px] text-slate-500">
                    {ecommerce ? tr("Listed price", "Harga tercantum") : tr("Unit price", "Harga satuan")}
                  </label>
                  <MoneyInput id={`${idPrefix}-price-${l.key}`} value={l.unit_price} onChange={(v) => set(l.key, { unit_price: v })} />
                </div>
                <div className="col-span-12 sm:col-span-11 sm:col-start-2">
                  <ItemPicker id={`${idPrefix}-item-${l.key}`} value={l.item_id} hint={l.description} uom={l.uom as UomCode} allowCreate={allowCreate}
                    onChange={(item) => set(l.key, { item_id: item?.id ?? null, ...(item ? { uom: item.base_uom } : {}) })} />
                </div>
              </>
            ) : (
              <div className="col-span-11 sm:col-span-3">
                <label htmlFor={`${idPrefix}-amt-${l.key}`} className="block text-[11px] text-slate-500">{tr("Amount", "Jumlah")}</label>
                <MoneyInput id={`${idPrefix}-amt-${l.key}`} value={l.amount} onChange={(v) => set(l.key, { amount: v })} />
              </div>
            )}
            {documents.length > 0 && (
              <div className="col-span-12">
                <label htmlFor={`${idPrefix}-doc-${l.key}`} className="block text-[11px] text-slate-500">{tr("Read from", "Dibaca dari")}</label>
                <select id={`${idPrefix}-doc-${l.key}`} value={l.attachment_id ?? ""}
                  onChange={(e) => set(l.key, { attachment_id: e.target.value || null })}
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 focus:border-brand-400 focus:outline-none">
                  <option value="">{tr("— no document named —", "— tanpa dokumen —")}</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>{d.filename}{d.kind ? ` · ${d.kind}` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-12 flex items-center justify-between sm:col-span-12">
              <span className={cn("text-[12px] tabular-nums", l.kind === "discount" ? "text-emerald-700" : "text-slate-600")}>
                <span className="mr-1 font-mono text-[10px] text-slate-400">{String.fromCharCode(97 + i)}</span>
                {l.kind === "discount" ? "− " : ""}{formatIDR(draftAmount(l))}
              </span>
              {lines.length > 1 && (
                <button type="button" aria-label={tr(`Remove row ${i + 1}`, `Hapus baris ${i + 1}`)}
                  onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon={Plus}
          onClick={() => onChange([...lines, { key: nextKey(lines), kind: "item", description: "", qty: 1, uom: "pcs", unit_price: 0, amount: 0, item_id: null }])}>
          {tr("Another line", "Tambah baris")}
        </Button>
        {/* The …2.500 the bank folded in, as its own line (D434). */}
        <Button variant="outline" size="sm" icon={Scissors} disabled={!canSplit}
          title={canSplit ? undefined : tr("Nothing to split: the amount does not end in a transfer fee, or a fee line already exists", "Tidak ada yang dipisah: jumlahnya tidak berakhiran biaya transfer, atau baris fee sudah ada")}
          onClick={() => { const next = splitFee(lines, amount); if (next) onChange(next); }}>
          {tr("Split the admin fee", "Pisahkan biaya admin")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={`${idPrefix}-tax`} className="text-[12px] text-slate-500">{tr("Tax on the nota", "Pajak di nota")}</label>
          <div className="w-36">
            <MoneyInput id={`${idPrefix}-tax`} size="sm" value={taxAmount} onChange={(v) => onChange(withTax(lines, v, amount))} />
          </div>
        </div>
      </div>

      {/* The sum against the amount, always visible: the whole point of the screen. */}
      <div className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm",
        agree ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-900")}>
        <span>{tr(`${lines.length} line(s) totalling`, `${lines.length} baris berjumlah`)} <strong>{formatIDR(total)}</strong></span>
        {agree
          ? <span className="inline-flex items-center gap-1 text-[12px]"><Check className="h-3.5 w-3.5" /> {tr(`matches ${formatIDR(amount)}`, `cocok dengan ${formatIDR(amount)}`)}</span>
          : <span className="inline-flex items-center gap-1 text-[12px]"><AlertTriangle className="h-3.5 w-3.5" /> {tr(`off by ${formatIDR(total - amount)} from ${formatIDR(amount)}`, `selisih ${formatIDR(total - amount)} dari ${formatIDR(amount)}`)}</span>}
      </div>
    </div>
  );
}

/** The stored lines as drafts, for the editor. A row with no lines starts
 *  with one item line for the whole amount. */
export function draftsFrom(
  lines: { kind: LineDraft["kind"]; description: string; qty: number | null; uom: string | null; unit_price: number | null; amount: number; item_id: string | null; attachment_id?: string | null }[],
  amount: number, description: string,
): LineDraft[] {
  if (lines.length === 0) {
    return [{ key: 1, kind: "item", description, qty: 1, uom: "pcs", unit_price: amount, amount, item_id: null }];
  }
  return lines.map((l, i) => ({
    key: i + 1, kind: l.kind, description: l.description,
    qty: l.qty ?? 1, uom: l.uom ?? "pcs",
    unit_price: l.unit_price ?? (l.qty ? l.amount / l.qty : l.amount),
    amount: l.amount, item_id: l.item_id, attachment_id: l.attachment_id ?? null,
  }));
}
