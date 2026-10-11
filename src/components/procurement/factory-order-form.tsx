"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Factory, Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useLoad } from "@/components/ui/loaded";
import { design, procurement } from "@/demo/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { moneyIn } from "@/services/quotation/pricing";
import type { FactoryQuoteLine } from "@/services/design/contracts";
import type { PoCurrency, ProjectLineView } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** A factory order from a project's FACTORY lines (0257, O3, kajian §5.4).
 *
 *  One factory per order. Each line takes that factory's price for its design
 *  item — the chosen offer when it is this factory's, else its newest — and
 *  the line's quantity, both of which can be changed here. What comes out is
 *  an ordinary DRAFT purchase order: leadership confirms it and procurement
 *  issues it, and the first one issued puts the project in production. */

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";
/* No `w-full`: `cn` does not merge classes, and a width beside it loses. */
const cellCls = "h-8 rounded-lg border border-slate-200 bg-white px-2 text-right text-[13px] tabular-nums focus:border-brand-400 focus:outline-none";

interface Draft { on: boolean; qty: string; price: string; typed: boolean }

/** This factory's price for a design item, as `factory_price_of` reads it. */
function offerFor(rows: FactoryQuoteLine[], itemNo: string | null, vendorCode: string) {
  if (!itemNo || !vendorCode) return null;
  const live = rows.filter((r) => r.item_no === itemNo && r.vendor_code === vendorCode && !r.voided_at);
  return live.find((r) => r.is_chosen) ?? live.find((r) => r.is_latest) ?? null;
}

export function FactoryOrderForm({
  projectCode, lines, onDone, onCancel,
}: {
  projectCode: string; lines: ProjectLineView[]; onDone: (poNo: string) => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `fo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [vendors] = useLoad(() => procurement.listVendors({}), []);
  const [offers] = useLoad(() => design.listFactoryQuoteLines({ project_code: projectCode }), [projectCode]);
  const [vendor, setVendor] = useState("");
  const [currency, setCurrency] = useState<PoCurrency>("IDR");
  const [fx, setFx] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const open = lines.filter((l) => l.route === "FACTORY" && !l.factory_po_no);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    () => Object.fromEntries(open.map((l) => [l.id, { on: true, qty: String(l.qty), price: "", typed: false }])));
  const [busy, setBusy] = useState(false);

  const offerRows = useMemo(() => (offers.status === "ready" ? offers.data ?? [] : []), [offers]);
  /* Factories that quoted this project first, then the other factories; a
     supplier can be picked and becomes a factory by being given an order. */
  const vendorList = useMemo(() => {
    const vs = vendors.status === "ready" ? vendors.data : [];
    const quoted = new Set(offerRows.filter((o) => !o.voided_at).map((o) => o.vendor_code));
    return vs.filter((v) => (v.kind ?? "supplier") === "factory" || (v.kind ?? "supplier") === "supplier")
      .sort((a, b) => Number(quoted.has(b.code)) - Number(quoted.has(a.code))
        || Number((b.kind ?? "") === "factory") - Number((a.kind ?? "") === "factory") || a.name.localeCompare(b.name));
  }, [vendors, offerRows]);
  const rate = Number(fx) > 0 ? Number(fx) : null;

  function pickVendor(code: string) {
    setVendor(code);
    /* The order is in the currency the factory quoted this project in. */
    const quoted = offerRows.find((o) => o.vendor_code === code && !o.voided_at);
    if (quoted) setCurrency(quoted.currency);
    setDrafts((d) => Object.fromEntries(Object.entries(d).map(([id, x]) => [id, { ...x, price: "", typed: false }])));
  }

  /* What a line will be ordered at: the typed price, else the factory's,
     converted at the order's kurs when the offer was in the other currency. */
  function priceOf(l: ProjectLineView, d: Draft) {
    if (d.typed && d.price.trim()) return { value: Number(d.price), from: null as FactoryQuoteLine | null };
    const o = offerFor(offerRows, l.design_item_no, vendor);
    return { value: o ? moneyIn(o.unit_price, o.currency, currency, rate) : null, from: o };
  }

  const chosen = open.filter((l) => drafts[l.id]?.on);
  const rows = chosen.map((l) => {
    const d = drafts[l.id];
    return { l, qty: Number(d.qty), ...priceOf(l, d) };
  });
  const missing = rows.filter((r) => !(r.value != null && r.value > 0));
  const badQty = rows.some((r) => !(r.qty > 0));
  const total = rows.reduce((t, r) => t + (r.value ?? 0) * (r.qty || 0), 0);
  const ready = !!vendor && rows.length > 0 && missing.length === 0 && !badQty && (fx.trim() === "" || rate != null);
  const earlier = vendor
    ? [...new Set(lines.filter((l) => l.factory_vendor_code === vendor && l.factory_po_no).map((l) => l.factory_po_no!))]
    : [];

  async function save() {
    setBusy(true);
    const res = await procurement.createFactoryOrder({
      project_code: projectCode, vendor_code: vendor, currency,
      fx_rate: currency === "USD" ? rate : null,
      expected_delivery: due || null, note: note.trim() || null,
      lines: rows.map((r) => ({
        line_no: r.l.line_no,
        qty: r.qty,
        /* Sent only when typed: otherwise the database takes the factory's
           price itself, so the screen and the order cannot disagree. */
        unit_price: drafts[r.l.id].typed && drafts[r.l.id].price.trim() ? Number(drafts[r.l.id].price) : null,
      })),
    }, key.current);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Factory order not created", "Order pabrik tidak dibuat"), res.error.message); return; }
    toast("success", tr(`Factory order ${res.data.po_no} created`, `Order pabrik ${res.data.po_no} dibuat`),
      [
        res.data.self_confirmed
          ? tr("Confirmed as you wrote it; issue it when the factory has the paper.", "Langsung dikonfirmasi; terbitkan saat pabrik sudah menerima dokumennya.")
          : tr("Ask leadership to confirm it, then issue it.", "Minta pimpinan mengonfirmasi, lalu terbitkan."),
        res.data.needs_rate ? tr("Type the kurs before issuing.", "Isi kurs sebelum diterbitkan.") : "",
      ].filter(Boolean).join(" "));
    onDone(res.data.po_no);
  }

  if (open.length === 0) {
    return (
      <div className="space-y-3 text-[13px] text-slate-600">
        <p>{tr("Every factory line of this project is already on a factory order. Move a line to the factory route first.",
          "Semua baris jalur pabrik proyek ini sudah ada di order pabrik. Pindahkan baris ke jalur pabrik dulu.")}</p>
        <div className="flex justify-end"><Button variant="ghost" onClick={onCancel}>{tr("Close", "Tutup")}</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("Factory", "Pabrik")}
          <select value={vendor} onChange={(e) => pickVendor(e.target.value)} className={cn(inputCls, "mt-1")}>
            <option value="">{tr("— pick a factory —", "— pilih pabrik —")}</option>
            {vendorList.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}{(v.kind ?? "supplier") === "supplier" ? " (supplier)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-slate-500">{tr("Currency", "Mata uang")}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="flex w-fit overflow-hidden rounded-lg border border-slate-200">
              {(["IDR", "USD"] as const).map((c) => (
                <button key={c} type="button" onClick={() => setCurrency(c)}
                  className={cn("h-8 px-3", currency === c ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>
                  {c}
                </button>
              ))}
            </div>
            {currency === "USD" && (
              <input value={fx} onChange={(e) => setFx(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
                aria-label={tr("Kurs (Rp per 1 USD)", "Kurs (Rp per 1 USD)")} placeholder={tr("kurs, Rp per 1 USD", "kurs, Rp per 1 USD")}
                className="h-8 w-40 rounded-lg border border-slate-200 bg-white px-2 text-[13px] tabular-nums focus:border-brand-400 focus:outline-none" />
            )}
          </div>
        </div>
        <label className="block text-xs text-slate-500">{tr("Factory promises delivery on", "Janji kirim pabrik")}
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500">{tr("Note", "Catatan")}
          <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")}
            placeholder={tr("e.g. first container", "mis. kontainer pertama")} />
        </label>
      </div>

      {earlier.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tr(`This factory already has ${earlier.join(", ")} for this project. This makes a second order; amend the first one instead if the lines belong there.`,
            `Pabrik ini sudah punya ${earlier.join(", ")} untuk proyek ini. Ini membuat order kedua; ubah order pertama kalau barisnya seharusnya di sana.`)}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-8 px-2 py-1.5" />
              <th className="px-2 py-1.5 text-left">{tr("Order line", "Baris order")}</th>
              <th className="px-2 py-1.5 text-right">{tr("Qty", "Jumlah")}</th>
              <th className="px-2 py-1.5 text-right">{tr(`Unit price (${currency})`, `Harga satuan (${currency})`)}</th>
            </tr>
          </thead>
          <tbody>
            {open.map((l) => {
              const d = drafts[l.id];
              const p = priceOf(l, d);
              const offer = offerFor(offerRows, l.design_item_no, vendor);
              return (
                <tr key={l.id} className={cn("border-b border-slate-100 last:border-0 align-top", !d.on && "opacity-50")}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={d.on} aria-label={tr(`Order line ${l.line_no}`, `Pesan baris ${l.line_no}`)}
                      onChange={(e) => setDrafts({ ...drafts, [l.id]: { ...d, on: e.target.checked } })} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-slate-800">{l.line_no}. {l.description}</span>
                    <span className="block text-[11px] text-slate-400">
                      {[l.design_item_no, l.product_code].filter(Boolean).join(" · ") || tr("not from the design", "bukan dari desain")}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input value={d.qty} inputMode="decimal" disabled={!d.on} aria-label={tr(`Quantity, line ${l.line_no}`, `Jumlah, baris ${l.line_no}`)}
                      onChange={(e) => setDrafts({ ...drafts, [l.id]: { ...d, qty: e.target.value.replace(/[^\d.]/g, "") } })}
                      className={cn(cellCls, "w-20")} />
                    <span className="block text-[11px] text-slate-400">{l.uom}{Number(d.qty) !== l.qty && ` · ${tr("ordered", "dipesan klien")} ${formatNumber(l.qty)}`}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input value={d.typed ? d.price : p.value != null ? String(p.value) : ""} inputMode="decimal" disabled={!d.on}
                      aria-label={tr(`Unit price, line ${l.line_no}`, `Harga satuan, baris ${l.line_no}`)}
                      placeholder={offer && p.value == null ? tr("needs the kurs", "perlu kurs") : tr("type the price", "ketik harga")}
                      onChange={(e) => setDrafts({ ...drafts, [l.id]: { ...d, price: e.target.value.replace(/[^\d.]/g, ""), typed: true } })}
                      className={cn(cellCls, "w-32")} />
                    <span className="block text-[11px] text-slate-400">
                      {offer
                        ? <>{tr("factory price", "harga pabrik")} {formatMoney(offer.unit_price, offer.currency)} · {offer.fq_no}{d.typed && " · " + tr("typed over", "diketik ulang")}</>
                        : vendor ? tr("no price from this factory", "pabrik ini belum memberi harga") : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-slate-500">
          <Factory className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
          {tr(`${rows.length} line(s)`, `${rows.length} baris`)} · {formatMoney(Math.round(total * 100) / 100, currency)}
          {currency === "USD" && rate != null && <> · ≈ {formatMoney(Math.round(total * rate), "IDR")}</>}
          {missing.length > 0 && vendor && <span className="text-amber-700"> · {tr(`${missing.length} without a price`, `${missing.length} tanpa harga`)}</span>}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !ready}>{tr("Create factory order", "Buat order pabrik")}</Button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        {tr("A draft purchase order. Leadership confirms it, procurement issues it — the first issued factory order puts the project in production. Payments to the factory stay on the order as before.",
          "Berupa draft PO. Pimpinan mengonfirmasi, procurement menerbitkan — order pabrik pertama yang terbit memasukkan proyek ke produksi. Pembayaran ke pabrik tetap lewat order seperti biasa.")}
        {" "}<Link href="/procurement/harga-pabrik" className="text-brand-700 hover:underline">{tr("Factory prices", "Harga pabrik")}</Link>
      </p>
    </div>
  );
}
