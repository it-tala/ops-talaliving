"use client";

import { useState } from "react";
import { AlertTriangle, Scale, TreePine, Layers, History, FileSearch } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory, procurement } from "@/demo/api";
import { LOG_MEASURE_LABEL } from "@/services/inventory/contracts";
import { LogPurchaseDrawer } from "./LogPurchaseDrawer";
import { BoardStock } from "./BoardStock";
import { BoardUsage } from "./BoardUsage";
import { NotaImport } from "./NotaImport";

/** Timber: what came in as logs, what came out as boards, and what the wood
 *  actually costs.
 *
 *  The one thing this screen exists to say: **the price on the invoice is not
 *  the price of the wood** (D153). A log is bought by the cubic metre of round
 *  timber; what can go into a table is the sawn volume, which is always less.
 *  Two vendors quoting the same rupiah per log metre are not the same price if
 *  one saws out at 61% and the other at 45% — and nothing on either invoice
 *  shows that.
 *
 *  So the vendor table is sorted by **rupiah per cubic metre of board**, and
 *  the invoice price sits beside it as the number that misleads.
 */
type Tab = "beli" | "rak" | "pakai";

const TABS: { id: Tab; label: string; icon: typeof Scale }[] = [
  { id: "beli", label: "Pembelian & kubikasi", icon: Scale },
  { id: "rak", label: "Stok papan", icon: Layers },
  { id: "pakai", label: "Pemakaian", icon: History },
];

export default function TimberPage() {
  const [tab, setTab] = useState<Tab>("beli");
  const [bump, setBump] = useState(0);
  const [adding, setAdding] = useState(false);
  const [purchases, reload] = useLoad(() => inventory.listLogPurchases(), []);
  const [vendorList] = useLoad(() => procurement.listVendors(), []);
  const [vendors, reloadVendors] = useLoad(() => inventory.timberByVendor(), []);
  const [open, setOpen] = useState<string | null>(null);
  /* Pembelian log bertambah terus; daftarnya dipaginasi (D157). */
  const { shown: loads, pager } = usePaged(
    purchases.status === "ready" ? purchases.data : [],
    15,
  );

  return (
    <div>
      <PageHeader
        breadcrumb="Inventory"
        title="Kayu"
        description="Satu modul untuk tiga hal: kubikasi lawan harga, isi rak papan, dan ke mana papannya pergi. Log dan papan tidak lagi dipisah — mereka kayu yang sama, sebelum dan sesudah gergaji."
        actions={
          <Button size="sm" variant={adding ? "primary" : "outline"} icon={FileSearch} onClick={() => setAdding(!adding)}>
            {adding ? "Tutup" : "Kiriman dari nota"}
          </Button>
        }
      />

      {adding && (
        <div className="mb-4">
          <NotaImport
            vendors={vendorList.status === "ready"
              ? vendorList.data.map((v) => ({ id: v.id, name: v.name }))
              : []}
            onCreated={() => { setAdding(false); reload(); reloadVendors(); setBump((n) => n + 1); }}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Button
            key={t.id} size="sm" icon={t.icon}
            variant={tab === t.id ? "primary" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "rak" && <BoardStock onUsed={() => setBump((n) => n + 1)} />}
      {tab === "pakai" && <BoardUsage reloadKey={bump} />}

      {tab === "beli" && (
      <>

      <Loaded state={vendors} onRetry={reloadVendors}>
        {(rows) => {
          /* The comparison only means anything **within one species**, and only
             where two vendors sell it. Anything else is mahoni against jati. */
          const species = [...new Set(rows.map((r) => r.species))];
          const contested = species
            .map((sp) => rows.filter((r) => r.species === sp && r.cost_per_sawn_m3 != null))
            .filter((g) => g.length > 1)[0] ?? [];
          const cheapest = contested.length > 0
            ? contested.reduce((a, b) => ((a.cost_per_sawn_m3 ?? 0) < (b.cost_per_sawn_m3 ?? 0) ? a : b))
            : null;
          const cheapestLog = contested.length > 0
            ? contested.reduce((a, b) => ((a.cost_per_log_m3 ?? 0) < (b.cost_per_log_m3 ?? 0) ? a : b))
            : null;
          const best = contested;

          return (
            <Card className="mb-4">
              <CardHeader
                title="Per vendor"
                subtitle="Yang menentukan adalah kolom terakhir — harga per m³ papan, bukan harga per m³ log."
                icon={Scale}
                action={<SourceBadge state={vendors} />}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left">Vendor · jenis</th>
                      <th className="px-4 py-2 text-right">Log m³</th>
                      <th className="px-4 py-2 text-right">Papan m³</th>
                      <th className="px-4 py-2 text-right">Rendemen</th>
                      <th className="px-4 py-2 text-right">Total biaya</th>
                      <th className="px-4 py-2 text-right">Rp / m³ log</th>
                      <th className="px-4 py-2 text-right">Rp / m³ papan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => (
                      <tr key={`${v.vendor_id}|${v.species}`} className="border-b border-slate-100">
                        <td className="px-4 py-2">
                          <span className="block font-medium text-slate-800">
                            {v.vendor_name} <span className="font-normal text-slate-500">· {v.species}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            {v.purchases} kiriman
                            {v.unsawn_m3 > 0 && ` · ${formatNumber(v.unsawn_m3)} m³ belum digergaji`}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(v.log_m3)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(v.sawn_m3)}</td>
                        <td className={cn(
                          "px-4 py-2 text-right tabular-nums",
                          v.yield_percent == null ? "text-slate-300"
                            : v.yield_percent < 50 ? "text-amber-700 font-medium" : "text-slate-700",
                        )}>
                          {v.yield_percent == null ? "—" : `${v.yield_percent}%`}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatIDR(v.total_cost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                          {v.cost_per_log_m3 == null ? "—" : formatIDR(v.cost_per_log_m3)}
                          {cheapestLog?.vendor_id === v.vendor_id && cheapestLog.species === v.species && best.length > 1 && (
                            <span className="block text-[10px] text-slate-400">termurah di kertas</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="font-semibold tabular-nums text-slate-900">
                            {v.cost_per_sawn_m3 == null ? "—" : formatIDR(v.cost_per_sawn_m3)}
                          </span>
                          {cheapest?.vendor_id === v.vendor_id && cheapest.species === v.species && best.length > 1 && (
                            <span className="block text-[10px] font-medium text-emerald-700">termurah sebenarnya</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cheapest && cheapestLog && cheapest.vendor_id !== cheapestLog.vendor_id && (
                <p className="flex items-start gap-2 border-t border-slate-100 bg-amber-50/70 px-4 py-2.5 text-[12px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{cheapestLog.vendor_name}</strong> lebih murah per m³ log, tapi{" "}
                    <strong>{cheapest.vendor_name}</strong> lebih murah per m³ papan untuk{" "}
                    {cheapest.species} — selisih{" "}
                    {formatIDR(Math.abs((cheapest.cost_per_sawn_m3 ?? 0) - (cheapestLog.cost_per_sawn_m3 ?? 0)))} per m³
                    kayu yang benar-benar bisa dipakai. Rendemennya yang berbeda, bukan harganya.
                  </span>
                </p>
              )}
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                Kiriman yang belum digergaji tidak ikut menentukan harga per m³ papan — bagian
                tagihannya disisihkan sampai kayunya benar-benar keluar dari gergaji.
              </p>
            </Card>
          );
        }}
      </Loaded>

      <Loaded state={purchases} onRetry={reload}>
        {(all) => (
          <Card>
            <CardHeader
              title={`${all.length} kiriman log`}
              subtitle="Klik satu kiriman untuk melihat tiap batang, papan yang keluar, dan selisih ukuran dengan penjual."
              icon={TreePine}
              action={<SourceBadge state={purchases} />}
            />
            <ul className="divide-y divide-slate-100">
              {loads.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setOpen(p.purchase_no)}
                    className="w-full px-5 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-[200px] flex-1">
                        <span className="block text-[13px] font-medium text-slate-800">
                          {p.species} · {p.vendor_name}
                        </span>
                        <span className="block font-mono text-[10px] text-slate-400">
                          {p.purchase_no} · {p.received_on} · {p.logs.length} batang
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
                        {formatNumber(p.log_m3)} m³ log
                      </span>
                      <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
                        {p.sawn_m3 > 0 ? `${formatNumber(p.sawn_m3)} m³ papan` : "belum digergaji"}
                      </span>
                      {p.yield_percent != null && (
                        <Badge tone={p.yield_percent < 50 ? "amber" : "green"}>
                          rendemen {p.yield_percent}%
                        </Badge>
                      )}
                      <span className="w-32 text-right text-[12px] tabular-nums text-slate-800">
                        {p.cost_per_sawn_m3 == null ? formatIDR(p.total_cost) : formatIDR(p.cost_per_sawn_m3)}
                        <span className="block text-[10px] text-slate-400">
                          {p.cost_per_sawn_m3 == null ? "nilai tagihan" : "per m³ papan"}
                        </span>
                      </span>
                    </div>
                    {p.warnings.length > 0 && (
                      <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {p.warnings[0]}
                        {p.warnings.length > 1 && <span className="text-slate-400"> +{p.warnings.length - 1} lagi</span>}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {pager}
            <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
              Kubikasi log dihitung dengan {LOG_MEASURE_LABEL.round.toLowerCase()} kecuali kiriman
              itu mencatat cara lain — dua cara dipakai di pasar dan hasilnya berbeda sekitar 21%.
            </p>
          </Card>
        )}
      </Loaded>

      </>
      )}

      {open && (
        <LogPurchaseDrawer
          purchaseNo={open}
          onClose={() => setOpen(null)}
          onChanged={() => { reload(); reloadVendors(); }}
        />
      )}
    </div>
  );
}
