"use client";

import { useEffect } from "react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { procurement } from "@/demo/api";
import { useBrand } from "@/lib/brand";

/** The order as the supplier sees it.
 *
 *  A page laid out for A4 and printed to PDF by the browser, rather than a
 *  PDF library: the file a vendor receives is the same document the office
 *  reads, produced from the same data, with no second renderer to drift from
 *  the first (D133). Print → Save as PDF → WhatsApp, which is what actually
 *  happens today with a scan of a printout.
 *
 *  It deliberately shows only what a supplier should see: what is ordered, at
 *  what price, when it is expected, and the payment terms. Not our exposure,
 *  not what we have paid, not who approved it internally.
 */
export default function PoPrintPage({ params }: { params: { po: string } }) {
  const brand = useBrand();
  const poNo = decodeURIComponent(params.po);
  const [detail] = useLoad(() => procurement.getPoDetail(poNo), [poNo]);

  useEffect(() => {
    if (detail.status === "ready") {
      /* A beat for fonts, then the browser's own print dialog — the same one
         people already know how to "Save as PDF" from. */
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [detail.status]);

  return (
    <div className="mx-auto max-w-[820px] bg-white p-10 text-slate-900 print:p-0">
      <style>{`@media print { @page { size: A4; margin: 16mm; } .no-print { display: none !important; } }`}</style>

      <Loaded state={detail} onRetry={() => {}}>
        {(d) => (
          <>
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <p className="text-lg font-bold tracking-tight">{brand.tagline}</p>
                <p className="text-[12px] text-slate-500">{brand.name}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tracking-tight">PURCHASE ORDER</p>
                <p className="font-mono text-[13px]">
                  {d.po_no}{d.revision > 0 && <span className="font-bold"> · REV {d.revision}</span>}
                </p>
                <p className="text-[12px] text-slate-500">
                  {d.issued_at ? d.issued_at.slice(0, 10) : "draft — not yet issued"}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Kepada / To</p>
                <p className="font-semibold">{d.vendor_name}</p>
                {d.vendor_pic && <p>{d.vendor_pic}</p>}
                {d.vendor_phone && <p className="text-slate-600">{d.vendor_phone}</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Pengiriman diharapkan / Expected delivery</p>
                <p className="font-semibold">{d.expected_delivery ?? "belum ditentukan"}</p>
                {d.note && <p className="mt-2 text-slate-600">{d.note}</p>}
              </div>
            </div>

            <table className="mt-6 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 text-left">
                  <th className="py-2 font-semibold">Uraian / Description</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Harga satuan</th>
                  <th className="py-2 text-right font-semibold">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.po_line_id} className="border-b border-slate-200 align-top">
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(l.qty)} {l.uom}</td>
                    <td className="py-2 text-right tabular-nums">{formatIDR(l.unit_price)}</td>
                    <td className="py-2 text-right tabular-nums">{formatIDR(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2 text-right font-semibold" colSpan={3}>Total</td>
                  <td className="py-2 text-right font-bold tabular-nums">
                    {formatIDR(d.status_view.contract_value)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {d.terms.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Termin pembayaran</p>
                <ul className="mt-1 space-y-0.5 text-[13px]">
                  {d.terms.map((t) => (
                    <li key={t.term_no}>
                      {t.kind} — {t.basis === "percent" ? `${t.basis_value}%` : "nilai tetap"} ·{" "}
                      <span className="tabular-nums">{formatIDR(t.amount)}</span>{" "}
                      <span className="text-slate-600">
                        ({t.due_rule === "on_issue" ? "saat PO diterbitkan"
                          : t.due_rule === "on_delivery" ? "saat barang diterima"
                            : `jatuh tempo ${t.due_date}`})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-10 grid grid-cols-2 gap-6 text-[13px]">
              <div>
                <p className="text-slate-500">Hormat kami,</p>
                <div className="mt-12 border-t border-slate-400 pt-1">
                  {d.issued_at ? `${brand.tagline}` : "—"}
                </div>
              </div>
              <div>
                <p className="text-slate-500">Diterima dan disetujui,</p>
                <div className="mt-12 border-t border-slate-400 pt-1">{d.vendor_name}</div>
              </div>
            </div>

            <p className="no-print mt-8 text-center text-[12px] text-slate-400">
              Printing does not start automatically? Use your browser&apos;s print, and choose
              &ldquo;Save as PDF&rdquo;.
            </p>
          </>
        )}
      </Loaded>
    </div>
  );
}
