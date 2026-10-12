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
import { TimberMonthRecap } from "./TimberMonthRecap";
import { useTr, type Message } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

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

const TABS: { id: Tab; label: Message; icon: typeof Scale }[] = [
  { id: "beli", label: { en: "Purchases & kubikasi", id: "Pembelian & kubikasi" }, icon: Scale },
  { id: "rak", label: { en: "Board stock", id: "Stok papan" }, icon: Layers },
  { id: "pakai", label: { en: "Usage", id: "Pemakaian" }, icon: History },
];

export default function TimberPage() {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("beli");
  const [bump, setBump] = useState(0);
  const [adding, setAdding] = useState(false);
  const [purchases, reload] = useLoad(() => inventory.listLogPurchases(), []);
  const [vendorList] = useLoad(() => procurement.listVendors(), []);
  const [vendors, reloadVendors] = useLoad(() => inventory.timberByVendor(), []);
  const [open, setOpen] = useState<string | null>(null);
  /* Pembelian log bertambah terus; daftarnya dipaginasi (D157). */
  const { shown: loads, pager, showAll } = usePaged(
    purchases.status === "ready" ? purchases.data : [],
    15,
    tr("loads", "kiriman"),
  );

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Inventory", "Persediaan")}
        title={tr("Timber", "Kayu")}
        description={tr("One module for three things: kubikasi against price, what is on the board rack, and where the boards went. Logs and boards are no longer separate — they are the same wood, before and after the saw.", "Satu modul untuk tiga hal: kubikasi lawan harga, isi rak papan, dan ke mana papannya pergi. Log dan papan tidak lagi dipisah — mereka kayu yang sama, sebelum dan sesudah gergaji.")}
        actions={
          <Button size="sm" variant={adding ? "primary" : "outline"} icon={FileSearch} onClick={() => setAdding(!adding)}>
            {adding ? tr("Close", "Tutup") : tr("Enter from a nota", "Masukkan dari nota")}
          </Button>
        }
      />

      {adding && (
        <div className="mb-4">
          <NotaImport
            vendors={vendorList.status === "ready"
              ? vendorList.data.map((v) => ({ id: v.id, name: v.name }))
              : []}
            loads={purchases.status === "ready"
              ? purchases.data.map((p) => ({
                  purchase_no: p.purchase_no,
                  label: `${p.received_on} · ${p.species} · ${p.vendor_name} (${p.purchase_no})`,
                }))
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
            {tr(t.label.en, t.label.id)}
          </Button>
        ))}
      </div>

      {tab === "rak" && <BoardStock onUsed={() => setBump((n) => n + 1)} />}
      {tab === "pakai" && <BoardUsage reloadKey={bump} />}

      {tab === "beli" && (
      <>

      <TimberMonthRecap reloadKey={bump} />

      <Loaded state={vendors} onRetry={reloadVendors}>
        {(rows) => {
          /* The comparison only means anything **within one species**, and only
             where two vendors sell it. Anything else is mahoni against jati. */
          const species = [...new Set(rows.map((r) => r.species))];
          const contested = species
            .map((sp) => rows.filter((r) => r.species === sp && r.landed_cost_per_sawn_m3 != null && r.cost_per_log_m3 != null))
            .filter((g) => g.length > 1)[0] ?? [];
          /* **Landed**, not invoiced: the truck from further away and the
             sawmill's bill are part of what a cubic metre of board cost. */
          const cheapest = contested.length > 0
            ? contested.reduce((a, b) => ((a.landed_cost_per_sawn_m3 ?? 0) < (b.landed_cost_per_sawn_m3 ?? 0) ? a : b))
            : null;
          const cheapestLog = contested.length > 0
            ? contested.reduce((a, b) => ((a.cost_per_log_m3 ?? 0) < (b.cost_per_log_m3 ?? 0) ? a : b))
            : null;
          const best = contested;

          return (
            <Card className="mb-4">
              <CardHeader
                title={tr("Per vendor", "Per vendor")}
                subtitle={tr("What decides is the last two columns — the cost landed on the rack (wood + transport + sawing + other) per m³ and per m² of board, not the price on the nota.", "Yang menentukan adalah dua kolom terakhir — biaya sampai di rak (kayu + angkut + potong + lain-lain) per m³ dan per m² papan, bukan harga di nota.")}
                icon={Scale}
                action={<SourceBadge state={vendors} />}
              />
              <div className="overflow-x-auto">
                <ExcelTable showAll={showAll} className="w-full min-w-[880px] border-collapse whitespace-nowrap text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left">{tr("Vendor · species", "Vendor · jenis")}</th>
                      <th className="px-3 py-2 text-right">{tr("Log m³", "Log m³")}</th>
                      <th className="px-3 py-2 text-right">{tr("Boards", "Papan")}</th>
                      <th className="px-3 py-2 text-right">{tr("Yield", "Rendemen")}</th>
                      <th className="px-3 py-2 text-right">{tr("Wood value", "Nilai kayu")}</th>
                      <th className="px-3 py-2 text-right">{tr("Transport · sawing · other", "Angkut · potong · lain")}</th>
                      <th className="px-3 py-2 text-right">{tr("Rp / m³ board", "Rp / m³ papan")}</th>
                      <th className="px-4 py-2 text-right">{tr("Rp / m² board", "Rp / m² papan")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => (
                      <tr key={`${v.vendor_id}|${v.species}`} className="border-b border-slate-100 align-top">
                        <td className="whitespace-normal px-4 py-2">
                          <span className="block font-medium text-slate-800">
                            {v.vendor_name} <span className="font-normal text-slate-500">· {v.species}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            {tr(`${v.purchases} loads`, `${v.purchases} kiriman`)}
                            {v.unsawn_m3 > 0 && tr(` · ${formatNumber(v.unsawn_m3)} m³ not yet sawn`, ` · ${formatNumber(v.unsawn_m3)} m³ belum digergaji`)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{v.log_m3 > 0 ? formatNumber(v.log_m3) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {formatNumber(v.sawn_m3)} m³
                          <span className="block text-[11px] text-slate-400">{formatNumber(v.sawn_m2)} m²</span>
                        </td>
                        <td className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          v.yield_percent == null ? "text-slate-300"
                            : v.yield_percent < 50 ? "text-amber-700 font-medium" : "text-slate-700",
                        )}>
                          {v.yield_percent == null ? "—" : `${v.yield_percent}%`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {formatIDR(v.total_cost)}
                          {v.cost_per_log_m3 != null && (
                            <span className="block text-[10px] text-slate-400">{formatIDR(v.cost_per_log_m3)} / m³ log</span>
                          )}
                          {cheapestLog?.vendor_id === v.vendor_id && cheapestLog.species === v.species && best.length > 1 && (
                            <span className="block text-[10px] text-slate-400">{tr("cheapest on paper", "termurah di kertas")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {v.extra_cost > 0 ? formatIDR(v.extra_cost) : "—"}
                          {([["angkut", tr("transport", "angkut"), v.cost_angkut], ["potong", tr("sawing", "potong"), v.cost_potong], ["lain", tr("other", "lain"), v.cost_bongkar + v.cost_lain]] as const)
                            .filter(([, , n]) => n > 0)
                            .map(([id, label, n]) => (
                              <span key={id} className="block text-[10px] text-slate-400">{label} {formatIDR(n)}</span>
                            ))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="font-semibold tabular-nums text-slate-900">
                            {v.landed_cost_per_sawn_m3 == null ? "—" : formatIDR(v.landed_cost_per_sawn_m3)}
                          </span>
                          {v.extra_cost > 0 && v.cost_per_sawn_m3 != null && (
                            <span className="block text-[10px] text-slate-400">{tr("wood only", "kayu saja")} {formatIDR(v.cost_per_sawn_m3)}</span>
                          )}
                          {cheapest?.vendor_id === v.vendor_id && cheapest.species === v.species && best.length > 1 && (
                            <span className="block text-[10px] font-medium text-emerald-700">{tr("actually cheapest", "termurah sebenarnya")}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {v.landed_cost_per_sawn_m2 == null ? "—" : formatIDR(v.landed_cost_per_sawn_m2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ExcelTable>
              </div>
              {cheapest && cheapestLog && cheapest.vendor_id !== cheapestLog.vendor_id && (
                <p className="flex items-start gap-2 border-t border-slate-100 bg-amber-50/70 px-4 py-2.5 text-[12px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{cheapestLog.vendor_name}</strong> {tr("is cheaper per m³ of log, but", "lebih murah per m³ log, tapi")}{" "}
                    <strong>{cheapest.vendor_name}</strong> {tr("is cheaper per m³ of board for", "lebih murah per m³ papan untuk")}{" "}
                    {cheapest.species} — {tr("a difference of", "selisih")}{" "}
                    {formatIDR(Math.abs((cheapest.landed_cost_per_sawn_m3 ?? 0) - (cheapestLog.landed_cost_per_sawn_m3 ?? 0)))}{" "}
                    {tr(
                      "per m³ of wood that can actually be used, after transport and sawing. The yield and the costs differ, not the price on the nota.",
                      "per m³ kayu yang benar-benar bisa dipakai, setelah angkut dan potong. Rendemen dan ongkosnya yang berbeda, bukan harga di nota.",
                    )}
                  </span>
                </p>
              )}
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                {tr(
                  "Loads not yet sawn do not count toward the price per m³ of board — their share of the bill is set aside until the wood actually comes off the saw. Per m² is computed from board area (width × length) across all thicknesses; compare vendors sawn to similar thicknesses.",
                  "Kiriman yang belum digergaji tidak ikut menentukan harga per m³ papan — bagian tagihannya disisihkan sampai kayunya benar-benar keluar dari gergaji. Per m² dihitung dari luas papan (lebar × panjang) semua ketebalan; bandingkan antar vendor yang digergaji ke tebal yang mirip.",
                )}
              </p>
            </Card>
          );
        }}
      </Loaded>

      <Loaded state={purchases} onRetry={reload}>
        {(all) => (
          <Card>
            <CardHeader
              title={tr(`${all.length} log loads`, `${all.length} kiriman log`)}
              subtitle={tr("Click a load to see each log, the boards it gave, and the measurement difference with the seller.", "Klik satu kiriman untuk melihat tiap batang, papan yang keluar, dan selisih ukuran dengan penjual.")}
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
                          {p.purchase_no} · {p.received_on} · {tr(`${p.logs.length} logs`, `${p.logs.length} batang`)}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
                        {formatNumber(p.log_m3)} m³ log
                      </span>
                      <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-700">
                        {p.sawn_m3 > 0 ? tr(`${formatNumber(p.sawn_m3)} m³ board`, `${formatNumber(p.sawn_m3)} m³ papan`) : tr("not yet sawn", "belum digergaji")}
                      </span>
                      {p.yield_percent != null && (
                        <Badge tone={p.yield_percent < 50 ? "amber" : "green"}>
                          {tr("yield", "rendemen")} {p.yield_percent}%
                        </Badge>
                      )}
                      <span className="w-36 text-right text-[12px] tabular-nums text-slate-800">
                        {p.landed_cost_per_sawn_m3 == null ? formatIDR(p.landed_cost) : formatIDR(p.landed_cost_per_sawn_m3)}
                        <span className="block text-[10px] text-slate-400">
                          {p.landed_cost_per_sawn_m3 == null
                            ? (p.extra_cost > 0 ? tr("wood + costs", "kayu + biaya") : tr("invoice value", "nilai tagihan"))
                            : p.extra_cost > 0 ? tr("per m³ board, + costs", "per m³ papan, + biaya") : tr("per m³ board", "per m³ papan")}
                        </span>
                      </span>
                    </div>
                    {p.warnings.length > 0 && (
                      <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {p.warnings[0]}
                        {p.warnings.length > 1 && <span className="text-slate-400"> {tr(`+${p.warnings.length - 1} more`, `+${p.warnings.length - 1} lagi`)}</span>}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {pager}
            <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
              {tr("Log kubikasi is computed with", "Kubikasi log dihitung dengan")} {LOG_MEASURE_LABEL.round.toLowerCase()}{" "}
              {tr(
                "unless the load records another method — two methods are used in the market and their results differ by about 21%.",
                "kecuali kiriman itu mencatat cara lain — dua cara dipakai di pasar dan hasilnya berbeda sekitar 21%.",
              )}
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
