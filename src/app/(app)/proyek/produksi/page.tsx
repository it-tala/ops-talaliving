"use client";

import { useState } from "react";
import { AlertTriangle, Factory, Hammer, Layers, Scale, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, procurement, production } from "@/demo/api";
import { useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";
import type { ProductionStage, ProjectProductionLine } from "@/services/procurement/contracts";
import { QC_STAGE_LABEL } from "@/services/qc/contracts";

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
  const tr = useTr();
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const [code, setCode] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Projects", "Proyek")}
        title={tr("Production per project", "Produksi per proyek")}
        description={tr("Every order line, where it is made — the workshop or a partner factory — and how far it is. Below it, the material cost against the projection.", "Setiap baris order, di mana dikerjakan — workshop atau pabrik mitra — dan sudah sampai mana. Di bawahnya, biaya material dibanding proyeksi.")}
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
                    {!p.is_active && <span className="ml-1 text-[10px] opacity-70">{tr("done", "selesai")}</span>}
                  </Button>
                ))}
              </div>
              {current && <ProductionBoard code={current} />}
              {current && <ProjectCost code={current} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function ProjectCost({ code }: { code: string }) {
  const tr = useTr();
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
                                  [tr("Projected materials", "Proyeksi bahan"), projected > 0 ? formatIDR(projected) : "—",
                                    unprojectable > 0 ? tr(`${unprojectable} lines cannot be projected yet`, `${unprojectable} baris belum bisa diproyeksikan`) : tr("from BOM × quantity ordered", "dari BOM × jumlah dipesan")],
                                  [tr("Requested via PR", "Diminta lewat PR"), fromBom.length > 0 ? formatIDR(asked) : "—",
                                    tr(`${fromBom.length} lines from BOM`, `${fromBom.length} baris dari BOM`)],
                                  [tr("Approved", "Disetujui"), fromBom.length > 0 ? formatIDR(approved) : "—",
                                    approved === 0 && fromBom.length > 0 ? tr("nothing approved yet", "belum ada yang disetujui") : tr("what was actually said yes to", "yang benar-benar di-yes-kan")],
                                  [tr("Paid", "Terbayar"), fromBom.length > 0 ? formatIDR(paidFromBom) : "—", tr("money that actually went out", "uang yang benar-benar keluar")],
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
                                    ? tr(`Materials paid so far are ${formatIDR(delta)} ABOVE the BOM projection.`, `Bahan yang sudah dibayar ${formatIDR(delta)} di ATAS proyeksi BOM.`)
                                    : tr(`Materials paid so far are ${formatIDR(-delta)} BELOW the BOM projection.`, `Bahan yang sudah dibayar ${formatIDR(-delta)} di BAWAH proyeksi BOM.`)}
                                  <span className="text-[11px] opacity-80">
                                    {tr("This compares materials with materials. Labour is on neither side.", "Perbandingan ini bahan lawan bahan. Ongkos kerja tidak ada di kedua sisi.")}
                                  </span>
                                </p>
                              )}
                              {fromBom.length === 0 ? (
                                <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
                                  {tr(
                                    "No PR has been raised from this project's BOM yet, so there is nothing to compare. Raise a PR from the BOM on the production board screen.",
                                    "Belum ada PR yang dibuat dari BOM proyek ini, jadi belum ada yang bisa dibandingkan. Buat PR dari BOM di layar papan produksi.",
                                  )}
                                </p>
                              ) : paidFromBom === 0 && (
                                <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
                                  {tr(
                                    "There are requests from the BOM, but nothing paid yet — so no actual comparison can be drawn. What can be read now: whether what was",
                                    "Sudah ada permintaan dari BOM, belum ada yang terbayar — jadi perbandingan aktual belum bisa ditarik. Yang bisa dibaca sekarang: apakah yang",
                                  )}{" "}<strong>{tr("requested", "diminta")}</strong>{" "}{tr("is already above the projection.", "sudah di atas proyeksi.")}
                                  {asked > projected && projected > 0 && (
                                    <span className="text-amber-800">
                                      {" "}{tr(`Already ${formatIDR(asked - projected)} above it.`, `Sudah ${formatIDR(asked - projected)} di atasnya.`)}
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>

                            <Card className="mb-4">
                              <CardHeader
                                title={tr("Per ordered item", "Per item yang dipesan")}
                                subtitle={tr("Projected materials per order line — one unit's BOM times the quantity ordered.", "Proyeksi bahan per baris pesanan — BOM satu unit dikali jumlah yang dipesan.")}
                                icon={ShoppingCart}
                                action={<SourceBadge state={lines} />}
                              />
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] border-collapse text-[13px]">
                                  <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                                      <th className="px-4 py-2 text-left">{tr("Item", "Item")}</th>
                                      <th className="px-4 py-2 text-right">{tr("Ordered", "Dipesan")}</th>
                                      <th className="px-4 py-2 text-right">{tr("Materials / unit", "Bahan / unit")}</th>
                                      <th className="px-4 py-2 text-right">{tr("Projected", "Proyeksi")}</th>
                                      <th className="px-4 py-2 text-left">{tr("Notes", "Catatan")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map(({ line, per, total, incomplete, noBom }) => (
                                      <tr key={line.id} className="border-b border-slate-100">
                                        <td className="px-4 py-2">
                                          <span className="block text-slate-800">{line.description}</span>
                                          <span className="block font-mono text-[10px] text-slate-400">
                                            {line.product_code ?? tr("no product code", "tanpa kode produk")}
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
                                          {!line.product_code ? <span className="text-slate-400">{tr("not a produced item", "bukan barang produksi")}</span>
                                            : noBom ? tr("this product has no BOM yet", "produk ini belum punya BOM")
                                              : incomplete ? tr("some components have no price", "ada komponen tanpa harga")
                                                : <span className="text-slate-400">—</span>}
                                        </td>
                                      </tr>
                                    ))}
                                    {rows.length === 0 && (
                                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                        {tr("This order has no item lines yet.", "Pesanan ini belum punya baris item.")}
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </Card>

                            <Card className="mb-4">
                              <CardHeader
                                title={tr("Per Job Order", "Per Job Order")}
                                subtitle={tr("BOM projection for the quantity made, and what was requested via PR against it.", "Proyeksi BOM untuk jumlah yang dibuat, dan apa yang diminta lewat PR terhadapnya.")}
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
                                        <span className="block text-[10px] text-slate-400">{tr("projected", "proyeksi")}</span>
                                      </span>
                                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-700">
                                        {own.length === 0 ? "—" : formatIDR(ownAsked)}
                                        <span className="block text-[10px] text-slate-400">{tr("requested", "diminta")}</span>
                                      </span>
                                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-800">
                                        {own.length === 0 ? "—" : formatIDR(ownPaid)}
                                        <span className="block text-[10px] text-slate-400">{tr("paid", "terbayar")}</span>
                                      </span>
                                      {proj != null && ownAsked > 0 && (
                                        <Badge tone={ownAsked > proj ? "amber" : "green"}>
                                          {ownAsked > proj ? tr("above projection", "di atas proyeksi") : tr("below projection", "di bawah proyeksi")}
                                        </Badge>
                                      )}
                                    </li>
                                  );
                                })}
                                {mine.length === 0 && (
                                  <li className="px-5 py-6 text-[13px] text-slate-500">
                                    {tr("No Job Orders for this project yet.", "Belum ada Job Order untuk proyek ini.")}
                                  </li>
                                )}
                              </ul>
                            </Card>

                            <Card>
                              <CardHeader
                                title={tr("All spending booked to this project", "Semua belanja yang dibukukan ke proyek ini")}
                                subtitle={tr("From the ledger — materials, services, subcontracting, delivery. Wider than the materials projection, so do not subtract one from the other.", "Dari ledger — bahan, jasa, subkontrak, pengiriman. Lebih luas dari proyeksi bahan, jadi jangan dikurangkan langsung.")}
                                icon={AlertTriangle}
                              />
                              <div className="px-5 py-3">
                                <p className="text-2xl font-bold tabular-nums text-slate-800">{formatIDR(spent)}</p>
                                <p className="text-[12px] text-slate-500">
                                  {tr(`${txs.filter((t) => t.direction === "OUT").length} outgoing transactions.`, `${txs.filter((t) => t.direction === "OUT").length} transaksi keluar.`)}
                                  {paidFromBom > 0 && tr(` Of this, ${formatIDR(paidFromBom)} can be traced to the BOM via PR.`, ` Dari jumlah ini, ${formatIDR(paidFromBom)} bisa ditelusuri ke BOM lewat PR.`)}
                                </p>
                                <p className="mt-2 text-[11px] text-slate-500">
                                  {tr(
                                    "This figure includes what is not in the BOM — installation, shipping, subcontracting. The projected vs actual comparison above deliberately uses materials only, so both sides hold the same things. Fixed wages are not allocated to projects at all yet.",
                                    "Angka ini termasuk yang tidak ada di BOM — jasa pasang, ongkos kirim, subkontrak. Perbandingan proyeksi vs aktual di atas sengaja hanya memakai bahan, supaya dua sisi yang dibandingkan sama isinya. Upah tetap belum dialokasikan ke proyek sama sekali.",
                                  )}
                                </p>
                                <Link href="/accounting/liquidation">
                                  <Button size="sm" variant="outline" className="mt-2">{tr("See the details in liquidation", "Lihat rinciannya di likuidasi")}</Button>
                                </Link>
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

/* ── the board per project (0257, O3, kajian §5.1) ──────────────────────── */

const STAGE: Record<ProductionStage, { en: string; id: string; tone: "slate" | "amber" | "brand" | "green" | "violet" }> = {
  NO_JOB_ORDER:     { en: "no Job Order yet",    id: "belum ada Job Order",   tone: "amber" },
  IN_WORK:          { en: "in the workshop",     id: "di workshop",           tone: "brand" },
  MADE:             { en: "made / passed QC",    id: "selesai / lolos QC",    tone: "green" },
  NO_FACTORY_ORDER: { en: "no factory order yet", id: "belum ada order pabrik", tone: "amber" },
  ORDER_DRAFT:      { en: "order not issued",    id: "order belum terbit",    tone: "slate" },
  AT_FACTORY:       { en: "at the factory",      id: "di pabrik",             tone: "violet" },
  SHIPPED:          { en: "shipped",             id: "dikirim",               tone: "brand" },
  ARRIVED:          { en: "arrived",             id: "sampai",                tone: "green" },
};

/** Where each line is made and how far it is. A workshop line reads its Job
 *  Orders; a factory line reads its factory order, and what the factory has
 *  finished is QC's passed count at the latest report (0263, O7) — until QC
 *  has counted, the board says so rather than a count nobody gave. */
function ProductionBoard({ code }: { code: string }) {
  const tr = useTr();
  const { can } = useSession();
  const [state, reload] = useLoad(() => procurement.listProjectProduction({ project_code: code }), [code]);
  const openPo = can("procurement.read");

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Production progress", "Progres produksi")}
        subtitle={tr("Workshop lines through Job Orders, factory lines through their factory order. The route is set on the order card.",
          "Baris workshop lewat Job Order, baris pabrik lewat order pabriknya. Jalurnya diatur di kartu order.")}
        icon={Layers}
        action={(
          <div className="flex items-center gap-2">
            <SourceBadge state={state} />
            <Link href={`/proyek/order/${encodeURIComponent(code)}`} className="text-[12px] text-brand-700 hover:underline">
              {tr("Order card", "Kartu order")}
            </Link>
          </div>
        )}
      />
      <Loaded state={state} onRetry={reload} skeletonRows={3}>
        {(rows) => rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-slate-500">
            {tr("No order lines yet. They come from an accepted quotation, or are typed on the order card.",
              "Belum ada baris order. Baris datang dari quotation yang diterima, atau diketik di kartu order.")}
          </p>
        ) : (
          <>
            <StageSummary rows={rows} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left">{tr("Order line", "Baris order")}</th>
                    <th className="px-3 py-2 text-right">{tr("Qty", "Jumlah")}</th>
                    <th className="px-3 py-2 text-left">{tr("Made by", "Dikerjakan")}</th>
                    <th className="px-3 py-2 text-right">{tr("Made", "Jadi")}</th>
                    <th className="px-3 py-2 text-right">{tr("Shipped / arrived", "Dikirim / sampai")}</th>
                    <th className="px-3 py-2 text-left">{tr("Where it is", "Posisi")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => <BoardRow key={r.project_line_id} r={r} openPo={openPo} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loaded>
    </Card>
  );
}

function StageSummary({ rows }: { rows: ProjectProductionLine[] }) {
  const tr = useTr();
  const workshop = rows.filter((r) => r.route === "WORKSHOP").length;
  const factory = rows.length - workshop;
  const counts = (Object.keys(STAGE) as ProductionStage[])
    .map((k) => [k, rows.filter((r) => r.stage === k).length] as const)
    .filter(([, n]) => n > 0);
  const late = rows.filter((r) => r.factory_days_late != null).length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 text-[12px] text-slate-600">
      <span className="inline-flex items-center gap-1"><Hammer className="h-3.5 w-3.5 text-slate-400" />{tr(`${workshop} workshop`, `${workshop} workshop`)}</span>
      <span className="inline-flex items-center gap-1"><Factory className="h-3.5 w-3.5 text-slate-400" />{tr(`${factory} factory`, `${factory} pabrik`)}</span>
      <span className="text-slate-300">·</span>
      {counts.map(([k, n]) => <Badge key={k} tone={STAGE[k].tone}>{tr(STAGE[k].en, STAGE[k].id)} · {n}</Badge>)}
      {late > 0 && <Badge tone="red">{tr(`${late} past the factory's date`, `${late} lewat janji pabrik`)}</Badge>}
    </div>
  );
}

function BoardRow({ r, openPo }: { r: ProjectProductionLine; openPo: boolean }) {
  const tr = useTr();
  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <td className="px-3 py-2">
        <span className="text-slate-800">{r.line_no}. {r.description}</span>
        <span className="block text-[11px] text-slate-400">
          {[r.product_code, r.design_item_no, r.delivery_date && tr(`ships ${r.delivery_date}`, `kirim ${r.delivery_date}`)].filter(Boolean).join(" · ")}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(r.qty)} {r.uom}</td>
      <td className="px-3 py-2">
        {r.route === "WORKSHOP" ? (
          <span className="text-slate-700">
            <Hammer className="mr-1 inline h-3.5 w-3.5 text-slate-400" />{tr("Workshop", "Workshop")}
            {r.job_order_count > 0 && (
              <Link href={`/produksi/jadwal?project=${encodeURIComponent(r.project_code)}`} className="block text-[11px] text-brand-700 hover:underline">
                {tr(`${r.job_order_count} Job Order`, `${r.job_order_count} Job Order`)}{r.job_order_open ? tr(` · ${r.job_order_open} open`, ` · ${r.job_order_open} berjalan`) : ""}
              </Link>
            )}
          </span>
        ) : (
          <span className="text-slate-700">
            <Factory className="mr-1 inline h-3.5 w-3.5 text-violet-500" />{r.factory_vendor_name ?? tr("Partner factory", "Pabrik mitra")}
            {r.factory_po_no && (
              openPo
                ? <Link href={`/procurement/po/${encodeURIComponent(r.factory_po_no)}`} className="block font-mono text-[11px] text-brand-700 hover:underline">{r.factory_po_no}</Link>
                : <span className="block font-mono text-[11px] text-slate-500">{r.factory_po_no}</span>
            )}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
        {r.made != null ? formatNumber(r.made)
          : r.route === "FACTORY" ? <span className="text-[11px] text-slate-400" title={tr("Counted by QC at the factory", "Dihitung QC di pabrik")}>{tr("not counted", "belum dihitung")}</span>
            : <span className="text-slate-300">—</span>}
        {/* A factory line's count is QC's latest report (0263, O7). */}
        {r.route === "FACTORY" && r.qc_stage && (
          <span className="block text-[11px] text-slate-500">{tr("QC", "QC")} · {QC_STAGE_LABEL[r.qc_stage]}{r.qc_reported_on && ` · ${r.qc_reported_on}`}</span>
        )}
        {r.route === "FACTORY" && (r.qc_open_findings ?? 0) > 0 && (
          <span className="block text-[11px] text-amber-700">{tr(`${r.qc_open_findings} open finding(s)`, `${r.qc_open_findings} temuan terbuka`)}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
        {formatNumber(r.delivered)} / {formatNumber(r.arrived)}
      </td>
      <td className="px-3 py-2">
        <Badge tone={STAGE[r.stage].tone}>{tr(STAGE[r.stage].en, STAGE[r.stage].id)}</Badge>
        {r.route === "FACTORY" && r.factory_expected_delivery && r.stage === "AT_FACTORY" && (
          <span className={cn("block text-[11px]", r.factory_days_late != null ? "text-rose-700" : "text-slate-500")}>
            {r.factory_days_late != null
              ? tr(`promised ${r.factory_expected_delivery} · ${r.factory_days_late} day(s) late`, `dijanjikan ${r.factory_expected_delivery} · terlambat ${r.factory_days_late} hari`)
              : tr(`promised ${r.factory_expected_delivery}`, `dijanjikan ${r.factory_expected_delivery}`)}
          </span>
        )}
      </td>
    </tr>
  );
}
