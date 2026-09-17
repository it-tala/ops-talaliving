"use client";

import { History } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR, formatNumber } from "@/lib/format";
import { inventory } from "@/demo/api";
import { BOARD_MOVE_LABEL, type BoardMoveKind } from "@/services/inventory/contracts";

const TONE: Record<BoardMoveKind, "green" | "brand" | "slate" | "amber" | "red"> = {
  sawn: "green", issue: "brand", return: "slate", adjust: "amber", scrap: "red",
};

/** One timeline, sawing included.
 *
 *  *Where did the jati 3 × 20 × 300 go* is not answerable from two lists, so
 *  what came off the saw and what left the rack are the same stream here —
 *  even though only one of them is stored (D203). The sawn rows are derived
 *  from the sawing reports, which is why they cannot drift from the rendemen.
 */
export function BoardUsage({ reloadKey }: { reloadKey: number }) {
  const [moves, reload] = useLoad(() => inventory.listBoardMoves({}), [reloadKey]);

  return (
    <Loaded state={moves} onRetry={reload}>
      {(rows) => {
        const issued = rows.filter((m) => m.kind === "issue");
        const m3Out = -issued.reduce((a, m) => a + m.m3, 0);
        const estimated = issued.filter((m) => m.value_basis === "dearest").length;
        const blind = issued.filter((m) => m.value == null).length;

        return (
          <Card>
            <CardHeader
              title={`${rows.length} pergerakan`}
              subtitle={`${formatNumber(m3Out)} m³ papan sudah dipakai${
                estimated > 0 ? ` · ${estimated} pengeluaran dinilai pakai harga termahal` : ""}${
                blind > 0 ? ` · ${blind} pengeluaran tanpa asal kiriman, jadi nilainya kosong` : ""}`}
              icon={History}
              action={<SourceBadge state={moves} />}
            />
            <div className="overflow-x-auto">
              <Paged rows={rows} pageSize={25} unit="pergerakan">
                {(page) => (
                  <table className="w-full min-w-[900px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 text-left">Tanggal</th>
                        <th className="px-4 py-2 text-left">Kejadian</th>
                        <th className="px-4 py-2 text-left">Jenis · ukuran</th>
                        <th className="px-4 py-2 text-right">Lembar</th>
                        <th className="px-4 py-2 text-right">m³</th>
                        <th className="px-4 py-2 text-left">Tujuan / asal</th>
                        <th className="px-4 py-2 text-right">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.map((m) => (
                        <tr key={m.id} className="border-b border-slate-100">
                          <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{m.at.slice(0, 10)}</td>
                          <td className="px-4 py-2"><Badge tone={TONE[m.kind]}>{BOARD_MOVE_LABEL[m.kind]}</Badge></td>
                          <td className="px-4 py-2 text-slate-800">
                            {m.species} <span className="text-slate-500">· {m.size}</span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                            {m.qty > 0 ? `+${m.qty}` : m.qty}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatNumber(Math.abs(m.m3))}</td>
                          <td className="px-4 py-2 text-[12px] text-slate-600">
                            {m.ref_no && <span className="block font-mono text-[11px] text-slate-700">{m.ref_no}</span>}
                            {m.purchase_no
                              ? <span className="block font-mono text-[10px] text-slate-400">dari {m.purchase_no}</span>
                              : m.kind !== "sawn" && (
                                <span className="block text-[10px] text-amber-700">
                                  kiriman asal tidak diketahui
                                  {m.value_basis === "dearest" && " — dinilai pakai harga termahal"}
                                </span>
                              )}
                            {m.reason && <span className="block text-[11px] text-slate-500">{m.reason}</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {m.value == null
                              ? <span className="text-slate-300">—</span>
                              : (
                                <span className={m.value_basis === "dearest" ? "text-amber-700" : undefined}>
                                  {m.value_basis === "dearest" && "± "}{formatIDR(Math.abs(m.value))}
                                </span>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Paged>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
              Baris <em>hasil gergajian</em> tidak dicatat di sini — ia dihitung dari laporan
              gergajiannya, supaya isi rak dan rendemen tidak pernah bisa berbeda. Pengeluaran yang
              tidak menyebut kiriman asalnya tetap pasti jumlahnya; nilainya diambil dari harga
              termahal jenis kayu itu dan ditandai <span className="text-amber-700">±</span> —
              kalau jenis itu belum pernah punya harga sama sekali, nilainya dibiarkan kosong.
            </p>
          </Card>
        );
      }}
    </Loaded>
  );
}
