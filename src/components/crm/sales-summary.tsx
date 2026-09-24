"use client";

import { formatIDR, formatNumber } from "@/lib/format";
import { salesSummary } from "@/services/crm/sales";
import type { QuotationView } from "@/services/quotation/contracts";

/** Where the quotations stand, in money: what is out with clients, what was
 *  won, what was lost and why. Totals include PPN where a quotation has it —
 *  it is what the client was asked to pay. */
export function SalesSummaryStrip({ rows }: { rows: QuotationView[] }) {
  const s = salesSummary(rows);
  const tiles: [string, string, string?][] = [
    ["Menunggu jawaban", formatIDR(s.open_value), `${s.open_count} quotation terkirim`],
    ["Disetujui", formatIDR(s.accepted_value), `${s.accepted_count} quotation`],
    ["Ditolak", formatIDR(s.rejected_value), `${s.rejected_count} quotation`],
    ["Rasio menang", s.win_rate == null ? "—" : `${formatNumber(Math.round(s.win_rate * 100))}%`,
      s.win_rate == null ? "belum ada yang diputuskan" : "disetujui ÷ sudah diputuskan"],
  ];
  return (
    <div className="mb-4 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
            {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
          </div>
        ))}
      </div>
      {s.reasons.length > 0 && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12px] text-slate-600">
          <span className="text-slate-400">Alasan ditolak: </span>
          {s.reasons.slice(0, 5).map((r, i) => (
            <span key={r.reason}>{i > 0 && " · "}{r.reason}{r.count > 1 && <strong className="text-slate-800"> ×{r.count}</strong>}</span>
          ))}
        </p>
      )}
    </div>
  );
}
