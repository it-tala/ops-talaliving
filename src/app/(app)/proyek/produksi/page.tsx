"use client";

import { useState } from "react";
import { AlertTriangle, Scale, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { isRouteLive } from "@/lib/live";
import { accounting, procurement, production } from "@/demo/api";

/** Projected against actual, for one project.
 *
 *  This is the question the owner asked for: *at the end of a job, did it cost
 *  more or less than we thought*. It is answerable now only because three
 *  separate things line up (D151):
 *
 *  - the **order lines** say what was sold and how many,
 *  - the **bill of material** says what one unit needs in materials, and
 *  - a **purchase request raised from a BOM carries its SPK number**, so what
 *    was actually bought for a run can be summed over the same rows as the
 *    projection.
 *
 *  Composed at the screen from three services, because none of them may reach
 *  into another (ADR-004).
 *
 *  **Two honesties matter more than the arithmetic.** The comparison is
 *  *materials against materials* — labour is in neither side, because nobody
 *  has told us what an hour costs (Q38), and putting only overtime in would
 *  make every project look cheap. And the third column, everything booked to
 *  the project in the ledger, is deliberately kept apart from the first two:
 *  it includes services, subcontracting and delivery, so it is a wider number
 *  and the screen says so rather than subtracting two things that do not
 *  match.
 */
export default function ProjectCostPage() {
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const [code, setCode] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Biaya produksi: proyeksi vs aktual"
        description="Proyeksi dihitung dari BOM × jumlah yang dipesan. Aktual dibaca dari PR yang dibuat dari BOM itu, dan dari belanja yang dibukukan ke proyek."
      />

      <Loaded state={projects}>
        {(all) => {
          const current = code ?? all.find((p) => p.is_active)?.code ?? all[0]?.code ?? null;
          return (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {all.map((p) => (
                  <Button
                    key={p.code}
                    size="sm"
                    variant={p.code === current ? "primary" : "outline"}
                    onClick={() => setCode(p.code)}
                  >
                    {p.name}
                    {!p.is_active && <span className="ml-1 text-[10px] opacity-70">selesai</span>}
                  </Button>
                ))}
              </div>
              {current && <ProjectCost code={current} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function ProjectCost({ code }: { code: string }) {
  const [lines] = useLoad(() => procurement.listProjectLines(code), [code]);
  const [products] = useLoad(() => production.listProducts({ include_inactive: true }), []);
  const [orders] = useLoad(() => production.listWorkOrders({ include_done: true }), []);
  const [prLines] = useLoad(() => procurement.listAllLines(), []);
  const [trx] = useLoad(() => accounting.listTransactions({ project_code: code, limit: 200 }), [code]);

  return (
    <Loaded state={lines}>
      {(ordered) => (
        <Loaded state={products}>
          {(prods) => (
            <Loaded state={orders}>
              {(wos) => (
                <Loaded state={prLines}>
                  {(allPr) => (
                    <Loaded state={trx}>
                      {(txs) => {
                        const mine = wos.filter((w) => w.project_code === code);
                        const woNos = new Set(mine.map((w) => w.wo_no));

                        /* Projected: what the order should need in materials.
                           Only lines naming a product with a priced BOM can be
                           projected — the rest are counted and named. */
                        let projected = 0;
                        let unprojectable = 0;
                        const rows = ordered.map((l) => {
                          const prod = l.product_code
                            ? prods.find((p) => p.product_code === l.product_code)
                            : null;
                          const per = prod?.material_cost ?? null;
                          const total = per == null ? null : per * l.qty;
                          if (total == null) unprojectable += 1; else projected += total;
                          return {
                            line: l,
                            per,
                            total,
                            incomplete: prod ? prod.unpriced > 0 : false,
                            noBom: !!prod && prod.components.length === 0,
                          };
                        });

                        /* Actual, narrow: request lines raised from this
                           project's own work orders. Same rows as the
                           projection, one step further along (D151). */
                        const fromBom = allPr.filter(
                          (l) => l.source_wo_no && woNos.has(l.source_wo_no) && !l.removed_at,
                        );
                        const asked = fromBom.reduce((a, l) => a + l.item_total, 0);
                        /* Only lines somebody actually said yes to. `coverage.approved`
                           falls back to what was asked when no approval exists, which is
                           right for procurement's own screens and wrong here: a draft
                           would read as approved money. */
                        const approved = fromBom
                          .filter((l) => l.approval?.approved)
                          .reduce((a, l) => a + l.coverage.approved, 0);
                        const paidFromBom = fromBom.reduce((a, l) => a + l.coverage.covered, 0);

                        /* Actual, wide: everything the ledger has against this
                           project, materials and services alike. */
                        const spent = txs
                          .filter((t) => t.direction === "OUT")
                          .reduce((a, t) => a + t.amount_idr, 0);

                        const delta = projected > 0 ? paidFromBom - projected : null;

                        return (
                          <>
                            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                                {([
                                  ["Proyeksi bahan", projected > 0 ? formatIDR(projected) : "—",
                                    unprojectable > 0 ? `${unprojectable} baris belum bisa diproyeksikan` : "dari BOM × jumlah dipesan"],
                                  ["Diminta lewat PR", fromBom.length > 0 ? formatIDR(asked) : "—",
                                    `${fromBom.length} baris dari BOM`],
                                  ["Disetujui", fromBom.length > 0 ? formatIDR(approved) : "—",
                                    approved === 0 && fromBom.length > 0 ? "belum ada yang disetujui" : "yang benar-benar di-yes-kan"],
                                  ["Terbayar", fromBom.length > 0 ? formatIDR(paidFromBom) : "—", "uang yang benar-benar keluar"],
                                ] as [string, string, string][]).map(([k, v, note]) => (
                                  <div key={k} className="px-4 py-3.5">
                                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                                    <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-800">{v}</dd>
                                    <p className="text-[11px] text-slate-500">{note}</p>
                                  </div>
                                ))}
                              </dl>
                              {delta != null && paidFromBom > 0 && (
                                <p className={cn(
                                  "flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-[13px]",
                                  delta > 0 ? "bg-amber-50/70 text-amber-900" : "bg-emerald-50/70 text-emerald-900",
                                )}>
                                  <Scale className="h-4 w-4 shrink-0" />
                                  {delta > 0
                                    ? `Bahan yang sudah dibayar ${formatIDR(delta)} di ATAS proyeksi BOM.`
                                    : `Bahan yang sudah dibayar ${formatIDR(-delta)} di BAWAH proyeksi BOM.`}
                                  <span className="text-[11px] opacity-80">
                                    Perbandingan ini bahan lawan bahan. Ongkos kerja tidak ada di kedua sisi (Q38).
                                  </span>
                                </p>
                              )}
                              {fromBom.length === 0 ? (
                                <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
                                  Belum ada PR yang dibuat dari BOM proyek ini, jadi belum ada yang
                                  bisa dibandingkan. Buat PR dari BOM di layar papan produksi.
                                </p>
                              ) : paidFromBom === 0 && (
                                <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
                                  Sudah ada permintaan dari BOM, belum ada yang terbayar — jadi
                                  perbandingan aktual belum bisa ditarik. Yang bisa dibaca sekarang:
                                  apakah yang <strong>diminta</strong> sudah di atas proyeksi.
                                  {asked > projected && projected > 0 && (
                                    <span className="text-amber-800">
                                      {" "}Sudah {formatIDR(asked - projected)} di atasnya.
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>

                            <Card className="mb-4">
                              <CardHeader
                                title="Per item yang dipesan"
                                subtitle="Proyeksi bahan per baris pesanan — BOM satu unit dikali jumlah yang dipesan."
                                icon={ShoppingCart}
                                action={<SourceBadge state={lines} />}
                              />
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] border-collapse text-[13px]">
                                  <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                                      <th className="px-4 py-2 text-left">Item</th>
                                      <th className="px-4 py-2 text-right">Dipesan</th>
                                      <th className="px-4 py-2 text-right">Bahan / unit</th>
                                      <th className="px-4 py-2 text-right">Proyeksi</th>
                                      <th className="px-4 py-2 text-left">Catatan</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map(({ line, per, total, incomplete, noBom }) => (
                                      <tr key={line.id} className="border-b border-slate-100">
                                        <td className="px-4 py-2">
                                          <span className="block text-slate-800">{line.description}</span>
                                          <span className="block font-mono text-[10px] text-slate-400">
                                            {line.product_code ?? "tanpa kode produk"}
                                          </span>
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                          {formatNumber(line.qty)} {line.uom}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                                          {per == null ? "—" : formatIDR(per)}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                                          {total == null ? "—" : formatIDR(total)}
                                        </td>
                                        <td className="px-4 py-2 text-[12px] text-amber-800">
                                          {!line.product_code ? <span className="text-slate-400">bukan barang produksi</span>
                                            : noBom ? "produk ini belum punya BOM"
                                              : incomplete ? "ada komponen tanpa harga"
                                                : <span className="text-slate-400">—</span>}
                                        </td>
                                      </tr>
                                    ))}
                                    {rows.length === 0 && (
                                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                        Pesanan ini belum punya baris item.
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </Card>

                            <Card className="mb-4">
                              <CardHeader
                                title="Per Job Order"
                                subtitle="Proyeksi BOM untuk jumlah yang dibuat, dan apa yang diminta lewat PR terhadapnya."
                                icon={Scale}
                              />
                              <ul className="divide-y divide-slate-100">
                                {mine.map((w) => {
                                  const prod = w.product_code ? prods.find((p) => p.product_code === w.product_code) : null;
                                  const proj = prod?.material_cost != null ? prod.material_cost * w.qty : null;
                                  const own = fromBom.filter((l) => l.source_wo_no === w.wo_no);
                                  const ownAsked = own.reduce((a, l) => a + l.item_total, 0);
                                  const ownPaid = own.reduce((a, l) => a + l.coverage.covered, 0);
                                  return (
                                    <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                                      <span className="min-w-[180px] flex-1">
                                        <span className="block text-[13px] text-slate-800">{w.item_name}</span>
                                        <span className="block font-mono text-[10px] text-slate-400">
                                          {w.wo_no} · {formatNumber(w.qty)} {w.uom}
                                        </span>
                                      </span>
                                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-600">
                                        {proj == null ? "—" : formatIDR(proj)}
                                        <span className="block text-[10px] text-slate-400">proyeksi</span>
                                      </span>
                                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-700">
                                        {own.length === 0 ? "—" : formatIDR(ownAsked)}
                                        <span className="block text-[10px] text-slate-400">diminta</span>
                                      </span>
                                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-800">
                                        {own.length === 0 ? "—" : formatIDR(ownPaid)}
                                        <span className="block text-[10px] text-slate-400">terbayar</span>
                                      </span>
                                      {proj != null && ownAsked > 0 && (
                                        <Badge tone={ownAsked > proj ? "amber" : "green"}>
                                          {ownAsked > proj ? "di atas" : "di bawah"} proyeksi
                                        </Badge>
                                      )}
                                    </li>
                                  );
                                })}
                                {mine.length === 0 && (
                                  <li className="px-5 py-6 text-[13px] text-slate-500">
                                    Belum ada Job Order untuk proyek ini.
                                  </li>
                                )}
                              </ul>
                            </Card>

                            <Card>
                              <CardHeader
                                title="Semua belanja yang dibukukan ke proyek ini"
                                subtitle="Dari ledger — bahan, jasa, subkontrak, pengiriman. Lebih luas dari proyeksi bahan, jadi jangan dikurangkan langsung."
                                icon={AlertTriangle}
                              />
                              <div className="px-5 py-3">
                                <p className="text-2xl font-bold tabular-nums text-slate-800">{formatIDR(spent)}</p>
                                <p className="text-[12px] text-slate-500">
                                  {txs.filter((t) => t.direction === "OUT").length} transaksi keluar.
                                  {paidFromBom > 0 && ` Dari jumlah ini, ${formatIDR(paidFromBom)} bisa ditelusuri ke BOM lewat PR.`}
                                </p>
                                <p className="mt-2 text-[11px] text-slate-500">
                                  Angka ini termasuk yang tidak ada di BOM — jasa pasang, ongkos
                                  kirim, subkontrak. Perbandingan proyeksi vs aktual di atas sengaja
                                  hanya memakai bahan, supaya dua sisi yang dibandingkan sama
                                  isinya. Upah tetap belum dialokasikan ke proyek sama sekali (Q38).
                                </p>
                                {/* Only offered where the page it opens is live — in live
                                    mode it is not yet, and a button into a "not live"
                                    screen is a dead end (F155). */}
                                {isRouteLive("/accounting/liquidation") && (
                                  <Link href="/accounting/liquidation">
                                    <Button size="sm" variant="outline" className="mt-2">Lihat rinciannya di likuidasi</Button>
                                  </Link>
                                )}
                              </div>
                            </Card>
                          </>
                        );
                      }}
                    </Loaded>
                  )}
                </Loaded>
              )}
            </Loaded>
          )}
        </Loaded>
      )}
    </Loaded>
  );
}
