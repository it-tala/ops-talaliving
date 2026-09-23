"use client";

import { use, useEffect } from "react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { quotation } from "@/demo/api";
import { useBrand } from "@/lib/brand";

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
                DRAFT — belum dikirim, harga masih bisa berubah
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
                  {q.valid_until && <> · berlaku s/d {q.valid_until}</>}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Kepada / To</p>
                <p className="font-semibold">{q.client_name ?? "—"}</p>
                {q.client_contact && <p>{q.client_contact}</p>}
                {q.client_address && <p className="whitespace-pre-line text-slate-600">{q.client_address}</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Proyek / Project</p>
                <p className="font-semibold">{q.project_name}</p>
                {q.location && <p className="text-slate-600">{q.location}</p>}
                {q.max_lead_time_days != null && (
                  <p className="mt-1 text-slate-600">Estimasi produksi: {q.max_lead_time_days} hari kerja</p>
                )}
              </div>
            </div>

            <table className="mt-6 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 text-left">
                  <th className="w-8 py-2 font-semibold">No</th>
                  <th className="py-2 font-semibold">Uraian / Description</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Produksi</th>
                  <th className="py-2 text-right font-semibold">Harga satuan</th>
                  <th className="py-2 text-right font-semibold">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-200 align-top">
                    <td className="py-2 tabular-nums">{l.line_no}</td>
                    <td className="py-2 pr-3">
                      {l.description}
                      {l.product_code && <span className="block font-mono text-[11px] text-slate-500">{l.product_code}</span>}
                      {l.note && <span className="block text-[12px] text-slate-600">{l.note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatNumber(l.qty)} {l.uom}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.lead_time_days == null ? "—" : `${l.lead_time_days} hr`}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.unit_price == null ? "—" : formatIDR(l.unit_price)}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {l.unit_price == null ? "—" : formatIDR(l.unit_price * l.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-2 text-right" colSpan={5}>Subtotal</td>
                  <td className="pt-2 text-right tabular-nums">{q.subtotal == null ? "—" : formatIDR(q.subtotal)}</td>
                </tr>
                {q.vat && (
                  <tr>
                    <td className="text-right" colSpan={5}>PPN {formatNumber(q.vat_pct)}%</td>
                    <td className="text-right tabular-nums">{q.vat_amount == null ? "—" : formatIDR(q.vat_amount)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-2 text-right font-semibold" colSpan={5}>Total</td>
                  <td className="py-2 text-right font-bold tabular-nums">{q.grand_total == null ? "—" : formatIDR(q.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
            {!q.vat && <p className="mt-1 text-right text-[11px] text-slate-500">Harga belum termasuk PPN.</p>}

            {(q.terms || q.note) && (
              <div className="mt-5 space-y-3 text-[13px]">
                {q.terms && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Syarat &amp; ketentuan</p>
                    <p className="mt-1 whitespace-pre-line">{q.terms}</p>
                  </div>
                )}
                {q.note && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Catatan</p>
                    <p className="mt-1 whitespace-pre-line">{q.note}</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-10 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-slate-500">Hormat kami,</p>
                <div className="mt-12 border-t border-slate-400 pt-1">{brand.tagline}</div>
              </div>
              <div>
                <p className="text-slate-500">Disetujui,</p>
                <div className="mt-12 border-t border-slate-400 pt-1">{q.client_name ?? ""}</div>
              </div>
            </div>

            <p className="no-print mt-8 text-center text-[12px] text-slate-400">
              Cetak tidak mulai otomatis? Pakai menu cetak browser, lalu pilih &ldquo;Save as PDF&rdquo;.
            </p>
          </>
        )}
      </Loaded>
    </div>
  );
}
