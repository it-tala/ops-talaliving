"use client";

import { useState } from "react";
import { PackageCheck, PackagePlus, Search, History } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatNumber, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import type { ProductStockRow } from "@/services/inventory/contracts";
import { PRODUCT_MOVE_LABEL } from "@/services/inventory/contracts";
import { useSession } from "@/store/session";
import { ProductMoveForm } from "./ProductMoveForm";
import { batchKey, batchLabel } from "./batch";

/** Finished goods (`0170`) — what the workshop made, on a rack until it ships.
 *
 *  One row per product **per customer order line**, because *six chairs in
 *  the gudang* is two different facts when four of them belong to Villa Sanur
 *  and two were made over the order. The screen answers:
 *
 *  - **What is standing here** — produced, minus what the delivery notes took
 *    (read off the surat jalan, never typed twice — D53), plus or minus the
 *    opname, scrap, sales and returns.
 *  - **What is over** — *kelebihan produksi*: made beyond the order, and the
 *    part of the rack nobody is owed any more (surplus), free to sell or reuse.
 *  - **Where it came from** — every batch names its Job Order(s), and through
 *    the JO its project: the same number that bought the material.
 */
export default function FinishedGoodsPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => inventory.listProductStock(), []);
  const [q, setQ] = useState("");
  const [surplusOnly, setSurplusOnly] = useState(false);
  const [recording, setRecording] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const mayWrite = can("inventory.create");

  return (
    <div>
      <PageHeader
        breadcrumb="Inventory"
        title="Barang jadi"
        description="Produk hasil produksi yang masih di gudang — per pesanan klien, termasuk kelebihan produksi. Pengiriman diambil dari surat jalan, tidak dicatat dua kali."
        actions={
          <div className="flex items-center gap-2">
            {mayWrite && !recording && (
              <Button size="sm" icon={PackagePlus} onClick={() => setRecording(true)}>Catat gerak barang jadi</Button>
            )}
            <SourceBadge state={rows} />
          </div>
        }
      />

      {recording && (
        <ProductMoveForm
          rows={rows.status === "ready" ? rows.data : []}
          mayAdjust={can("inventory.adjust")}
          onCancel={() => setRecording(false)}
          onDone={() => { setRecording(false); reload(); }}
        />
      )}

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const shown = all
            .filter((r) => !surplusOnly || r.surplus > 0)
            .filter((r) => !q || `${r.product_code} ${r.product_name ?? ""} ${r.project_code ?? ""} ${r.wo_nos.join(" ")}`
              .toLowerCase().includes(q.toLowerCase()));
          const onHand = all.reduce((s, r) => s + r.on_hand, 0);
          const owed = all.reduce((s, r) => s + Math.min(r.still_owed, Math.max(r.on_hand, 0)), 0);
          const overrun = all.reduce((s, r) => s + r.overrun, 0);
          const surplus = all.reduce((s, r) => s + r.surplus, 0);
          const negative = all.filter((r) => r.on_hand < 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    ["Di gudang", formatNumber(onHand), `${all.length} batch produk`],
                    ["Menunggu dikirim", formatNumber(owed), "milik pesanan klien"],
                    ["Kelebihan produksi", formatNumber(overrun), "dibuat melebihi pesanan"],
                    ["Surplus bebas", formatNumber(surplus), "tidak ada yang menunggu — bisa dijual / dipakai"],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn("mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        k === "Surplus bebas" && surplus > 0 ? "text-violet-700" : "text-slate-800")}>{v}</dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
                {negative.length > 0 && (
                  <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-amber-800">
                    <strong>Perlu dihitung ulang:</strong>{" "}
                    {negative.map((r) => `${r.product_code}${r.project_code ? ` (${r.project_code})` : ""}`).join(" · ")}{" "}
                    — surat jalan mengirim lebih banyak dari hasil produksi yang dicatat.
                  </p>
                )}
              </div>

              <Card>
                <CardHeader
                  title={`${shown.length} dari ${all.length} batch`}
                  subtitle="Klik satu baris untuk riwayatnya: hasil produksi per Job Order, surat jalan, opname."
                  icon={PackageCheck}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2">
                        <Search className="h-3.5 w-3.5 text-slate-400" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produk, proyek, JO…"
                          aria-label="Cari barang jadi" className="h-7 w-40 text-sm focus:outline-none" />
                      </label>
                      <Button size="sm" variant={surplusOnly ? "primary" : "outline"} onClick={() => setSurplusOnly((v) => !v)}>
                        Surplus saja
                      </Button>
                    </div>
                  }
                />
                <Paged rows={shown} pageSize={20} unit="batch">
                  {(page) => (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2 text-left">Produk</th>
                            <th className="px-4 py-2 text-left">Pesanan</th>
                            <th className="px-4 py-2 text-right">Dipesan</th>
                            <th className="px-4 py-2 text-right">Diproduksi</th>
                            <th className="px-4 py-2 text-right">Dikirim</th>
                            <th className="px-4 py-2 text-right">Di gudang</th>
                            <th className="px-4 py-2 text-left">Lokasi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {page.map((r) => {
                            const k = batchKey(r);
                            return (
                              <BatchRow key={k} row={r} open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
                            );
                          })}
                          {shown.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                              {all.length === 0
                                ? "Belum ada barang jadi tercatat. Catat hasil produksi dari Job Order-nya untuk mulai."
                                : "Tidak ada yang cocok."}
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Paged>
                <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
                  Hasil produksi selalu menyebut Job Order-nya, dan pesanan kliennya diambil dari JO itu — bukan
                  diketik. Surat jalan mengurangi stok dari lokasi rumah produk (default GUDANG). Selisih opname
                  disimpan sebagai selisih, dengan alasannya.
                </p>
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function BatchRow({ row: r, open, onToggle }: { row: ProductStockRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", open && "bg-slate-50")}>
        <td className="px-4 py-2">
          <div className="font-medium text-slate-800">{r.product_name ?? r.product_code}</div>
          <div className="text-[11px] text-slate-500">{r.product_code}{r.wo_nos.length > 0 && ` · ${r.wo_nos.join(", ")}`}</div>
        </td>
        <td className="px-4 py-2">
          <div className="text-slate-700">{batchLabel(r)}</div>
          {r.line_description && <div className="text-[11px] text-slate-500">{r.line_description}</div>}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">{r.ordered == null ? "—" : formatNumber(r.ordered)}</td>
        <td className="px-4 py-2 text-right tabular-nums">
          {formatNumber(r.produced)}
          {r.overrun > 0 && <div><Badge tone="amber">+{formatNumber(r.overrun)} lebih</Badge></div>}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.shipped)}</td>
        <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", r.on_hand < 0 ? "text-rose-700" : "text-slate-800")}>
          {formatNumber(r.on_hand)} <span className="font-normal text-slate-400">{r.uom}</span>
          {r.surplus > 0 && <div><Badge tone="violet">{formatNumber(r.surplus)} surplus</Badge></div>}
          {r.allocated !== 0 && (
            <div className="text-[11px] font-normal text-slate-500">
              {r.allocated > 0 ? `+${formatNumber(r.allocated)} dari pesanan lain` : `${formatNumber(r.allocated)} ke pesanan lain`}
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-[12px] text-slate-600">
          {Object.entries(r.by_location).map(([loc, qty]) => `${loc} ${formatNumber(qty)}`).join(" · ") || "—"}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-200 bg-slate-50/60">
          <td colSpan={7} className="px-4 py-3"><BatchHistory row={r} /></td>
        </tr>
      )}
    </>
  );
}

function BatchHistory({ row }: { row: ProductStockRow }) {
  const [ledger] = useLoad(() => inventory.productLedger(row.product_code), [row.product_code]);
  return (
    <Loaded state={ledger} skeletonRows={2}>
      {(all) => {
        const mine = all.filter((m) => (m.project_line_id ?? null) === row.project_line_id);
        return (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
              <History className="h-3.5 w-3.5" /> Riwayat batch ini
            </p>
            <table className="w-full text-[12px]">
              <tbody>
                {mine.map((m) => (
                  <tr key={`${m.move_no}-${m.location}-${m.qty}`} className="border-t border-slate-100">
                    <td className="py-1 pr-3 text-slate-500">{formatDateTime(new Date(m.moved_at))}</td>
                    <td className="py-1 pr-3">{PRODUCT_MOVE_LABEL[m.kind]}</td>
                    <td className="py-1 pr-3 font-mono text-[11px] text-slate-500">{m.wo_no ?? m.ref_no ?? m.move_no}</td>
                    <td className="py-1 pr-3">{m.location}</td>
                    <td className={cn("py-1 pr-3 text-right tabular-nums", m.qty < 0 ? "text-rose-700" : "text-emerald-700")}>
                      {m.qty > 0 ? "+" : ""}{formatNumber(m.qty)}
                    </td>
                    <td className="py-1 text-slate-500">{m.reason ?? ""}</td>
                  </tr>
                ))}
                {mine.length === 0 && (
                  <tr><td className="py-2 text-slate-500">Belum ada gerak.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      }}
    </Loaded>
  );
}
