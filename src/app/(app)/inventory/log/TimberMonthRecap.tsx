"use client";

import { Calendar } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { inventory } from "@/demo/api";
import { useLang, useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** How much timber cost, month by month — for reporting to leadership rather
 *  than for choosing a vendor (`0157`).
 *
 *  **Deliberately no rupiah-per-cubic-metre column.** `TimberPage`'s "Per
 *  vendor" table already owns that number, and it only means anything within
 *  one species (D153) — a month almost always mixes jati, mahoni and
 *  whatever else came in, so a blended rate here would look precise and
 *  compare nothing real. This table answers a different question: how much
 *  did the yard spend, and on how much wood, this month against last.
 *
 *  `reloadKey` is `TimberPage`'s `bump` — the same counter `BoardUsage`
 *  depends on — so a fresh nota or a manual entry updates this table without
 *  a page reload; a plain `useLoad(..., [])` would go stale the moment a load
 *  was filed and stay stale until somebody navigated away and back. */
export function TimberMonthRecap({ reloadKey }: { reloadKey: number }) {
  const tr = useTr();
  const lang = useLang();
  const [months] = useLoad(() => inventory.timberByMonth(), [reloadKey]);

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Monthly recap", "Rekap bulanan")}
        subtitle={tr("Totals per month — for reporting, not for comparing vendors. The price per m³/m² is in the per-vendor table below.", "Total per bulan — untuk laporan, bukan untuk membandingkan vendor. Harga per m³/m² ada di tabel per vendor di bawah.")}
        icon={Calendar}
        action={<SourceBadge state={months} />}
      />
      <Loaded state={months} skeletonRows={3}>
        {(rows) => (
          <div className="overflow-x-auto">
            <ExcelTable className="w-full min-w-[720px] border-collapse whitespace-nowrap text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 text-left">{tr("Month", "Bulan")}</th>
                  <th className="px-3 py-2 text-right">{tr("Loads", "Kiriman")}</th>
                  <th className="px-3 py-2 text-right">{tr("Vendors · species", "Vendor · spesies")}</th>
                  <th className="px-3 py-2 text-right">{tr("Log m³", "Log m³")}</th>
                  <th className="px-3 py-2 text-right">{tr("Boards", "Papan")}</th>
                  <th className="px-3 py-2 text-right">{tr("Wood value", "Nilai kayu")}</th>
                  <th className="px-3 py-2 text-right">{tr("Other costs", "Biaya lain")}</th>
                  <th className="px-4 py-2 text-right">{tr("Total (landed)", "Total (landed)")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.month} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {new Date(m.month).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { month: "long", year: "numeric" })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{m.loads}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {m.vendors} · {m.species_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {m.log_m3 > 0 ? formatNumber(m.log_m3) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatNumber(m.sawn_m3)} m³
                      <span className="block text-[11px] text-slate-400">{formatNumber(m.sawn_m2)} m²</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatIDR(m.wood_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {m.extra_cost > 0 ? formatIDR(m.extra_cost) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatIDR(m.landed_cost)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[13px] text-slate-500">
                      {tr("No timber loads to recap yet.", "Belum ada kiriman kayu untuk direkap.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </ExcelTable>
          </div>
        )}
      </Loaded>
    </Card>
  );
}
