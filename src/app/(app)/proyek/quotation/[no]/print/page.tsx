"use client";

import { Fragment, use, useEffect } from "react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatMoney, formatNumber } from "@/lib/format";
import { quotation } from "@/demo/api";
import { groupLines, isHeading } from "@/components/sales/quote-design";
import { useBrand } from "@/lib/brand";
import { useTr, type Tr } from "@/lib/i18n";

/** The quotation goes to a client, so it reads the same whoever prints it:
 *  Indonesian first, English beside it — the shape its labels had before
 *  D318. Only the on-screen hint follows the viewer's language. */
const both: Tr = (en, id) => (en === id ? en : `${id} / ${en}`);

/** The quotation as the client sees it — A4, printed to PDF by the browser,
 *  the same way the purchase order is (D133).
 *
 *  Only what a client should read: what is offered, how many, how long it
 *  takes to make, at what price, and on what terms. Never the cost, the
 *  percentages or the margin — those are ours, and this page does not ask for
 *  them even when the person printing may see them.
 */
export default function QuotationPrintPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = use(params);
  const tr = useTr();
  const quoteNo = decodeURIComponent(no);
  const brand = useBrand();
  const [detail] = useLoad(() => quotation.getQuotation(quoteNo), [quoteNo]);

  useEffect(() => {
    if (detail.status === "ready") {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [detail.status]);

  return (
    <div className="mx-auto max-w-[820px] bg-white p-10 text-slate-900 print:p-0">
      <style>{`@media print { @page { size: A4; margin: 16mm; } .no-print { display: none !important; } }`}</style>

      <Loaded state={detail} onRetry={() => {}}>
        {({ quotation: q, lines }) => (
          <>
            {q.status === "DRAFT" && (
              <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-center text-[12px] font-semibold text-amber-800">
                {both("DRAFT — not sent yet, prices may still change", "DRAFT — belum dikirim, harga masih bisa berubah")}
              </p>
            )}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <p className="text-lg font-bold tracking-tight">{brand.tagline}</p>
                <p className="text-[12px] text-slate-500">{brand.name}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tracking-tight">QUOTATION</p>
                <p className="font-mono text-[13px]">
                  {q.quote_no}{q.rev > 1 && <span className="font-bold"> · REV {q.rev}</span>}
                </p>
                <p className="text-[12px] text-slate-500">
                  {(q.sent_at ?? q.created_at).slice(0, 10)}
                  {q.valid_until && <> · {both("valid until", "berlaku s/d")} {q.valid_until}</>}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">{both("To", "Kepada")}</p>
                <p className="font-semibold">{q.client_name ?? "—"}</p>
                {q.client_contact && <p>{q.client_contact}</p>}
                {q.client_address && <p className="whitespace-pre-line text-slate-600">{q.client_address}</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">{both("Project", "Proyek")}</p>
                <p className="font-semibold">{q.project_name}</p>
                {q.location && <p className="text-slate-600">{q.location}</p>}
                {q.max_lead_time_days != null && (
                  <p className="mt-1 text-slate-600">{both(`Production estimate: ${q.max_lead_time_days} working days`, `Estimasi produksi: ${q.max_lead_time_days} hari kerja`)}</p>
                )}
              </div>
            </div>

            <table className="mt-6 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 text-left">
                  <th className="w-8 py-2 font-semibold">{both("No", "No")}</th>
                  <th className="py-2 font-semibold">{both("Description", "Uraian")}</th>
                  <th className="py-2 text-right font-semibold">{both("Qty", "Qty")}</th>
                  <th className="py-2 text-right font-semibold">{both("Production", "Produksi")}</th>
                  <th className="py-2 text-right font-semibold">{both("Unit price", "Harga satuan")}</th>
                  <th className="py-2 text-right font-semibold">{both("Amount", "Jumlah")}</th>
                </tr>
              </thead>
              <tbody>
                {/* By collection and room, the order the client's design is in
                    (P5); a subtotal under each room. */}
                {groupLines(lines).map((l, i, all) => isHeading(l) ? (
                  <tr key={`h-${l.key}`} className="border-b border-slate-300">
                    <td colSpan={6} className="pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-700">
                      {l.heading || both("Other items", "Item lain")}
                    </td>
                  </tr>
                ) : (
                  <Fragment key={l.id}>
                  <tr className="border-b border-slate-200 align-top">
                    <td className="py-2 tabular-nums">{l.line_no}</td>
                    <td className="py-2 pr-3">
                      {l.description}
                      {(l.design_item_no || l.product_code) && (
                        <span className="block font-mono text-[11px] text-slate-500">
                          {[l.design_item_no, l.product_code].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {l.note && <span className="block text-[12px] text-slate-600">{l.note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatNumber(l.qty)} {l.uom}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.lead_time_days == null ? "—" : both(`${l.lead_time_days} d`, `${l.lead_time_days} hr`)}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.unit_price == null ? "—" : formatMoney(l.unit_price, q.currency)}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.unit_price == null ? "—" : formatMoney(l.unit_price * l.qty, q.currency)}
                    </td>
                  </tr>
                  {l.design_item_no && (i === all.length - 1 || isHeading(all[i + 1])) && (
                    <tr className="border-b border-slate-300">
                      <td colSpan={5} className="py-1.5 text-right text-[12px] text-slate-600">
                        {both(`Subtotal ${l.room_name ?? ""}`, `Subtotal ${l.room_name ?? ""}`)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right text-[12px] font-medium tabular-nums">
                        {roomTotal(all, i, q.currency)}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-2 text-right" colSpan={5}>{both("Subtotal", "Subtotal")}</td>
                  <td className="pt-2 text-right tabular-nums">{q.subtotal == null ? "—" : formatMoney(q.subtotal, q.currency)}</td>
                </tr>
                {q.vat && (
                  <tr>
                    <td className="text-right" colSpan={5}>{both("VAT (PPN)", "PPN")} {formatNumber(q.vat_pct)}%</td>
                    <td className="text-right tabular-nums">{q.vat_amount == null ? "—" : formatMoney(q.vat_amount, q.currency)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-2 text-right font-semibold" colSpan={5}>{both("Total", "Total")}</td>
                  <td className="py-2 text-right font-bold tabular-nums">{q.grand_total == null ? "—" : formatMoney(q.grand_total, q.currency)}</td>
                </tr>
              </tfoot>
            </table>
            {!q.vat && <p className="mt-1 text-right text-[11px] text-slate-500">{both("Prices exclude VAT (PPN).", "Harga belum termasuk PPN.")}</p>}

            {(q.terms || q.note) && (
              <div className="mt-5 space-y-3 text-[13px]">
                {q.terms && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{both("Terms & conditions", "Syarat & ketentuan")}</p>
                    <p className="mt-1 whitespace-pre-line">{q.terms}</p>
                  </div>
                )}
                {q.note && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{both("Notes", "Catatan")}</p>
                    <p className="mt-1 whitespace-pre-line">{q.note}</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-10 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-slate-500">{both("Sincerely,", "Hormat kami,")}</p>
                <div className="mt-12 border-t border-slate-400 pt-1">{brand.tagline}</div>
              </div>
              <div>
                <p className="text-slate-500">{both("Approved,", "Disetujui,")}</p>
                <div className="mt-12 border-t border-slate-400 pt-1">{q.client_name ?? ""}</div>
              </div>
            </div>

            <p className="no-print mt-8 text-center text-[12px] text-slate-400">
              {tr("Printing didn't start automatically? Use the browser's print menu, then choose “Save as PDF”.", "Cetak tidak mulai otomatis? Pakai menu cetak browser, lalu pilih “Save as PDF”.")}
            </p>
          </>
        )}
      </Loaded>
    </div>
  );
}

/** The room's lines above row `i`, back to its heading — or a dash when one
 *  of them has no price yet. */
function roomTotal(all: ReturnType<typeof groupLines>, i: number, currency: "IDR" | "USD"): string {
  let sum = 0;
  for (let j = i; j >= 0; j--) {
    const x = all[j];
    if (isHeading(x)) break;
    if (x.unit_price == null) return "—";
    sum += x.unit_price * x.qty;
  }
  return formatMoney(sum, currency);
}
