"use client";

import { useState } from "react";
import Link from "next/link";
import { Coins, ListTree, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Drawer } from "@/components/ui/drawer";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import {
  BOM_RATE_GROUPS, BOM_RATE_GROUP_LABELS,
  type BomRateGroup, type BomRateView,
} from "@/services/production/contracts";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { RateForm } from "./RateForm";
import { FinishingCandidates } from "./FinishingCandidates";

/** The estimator's price list a BOM is costed from (0182, D324).
 *
 *  *Selain items yang didapat dari transaksi perlu menyusun price rate sebagai
 *  bahan BOM* — the owner. The item database says what procurement paid; this
 *  says what a BOM is estimated at, and holds what is never bought as an item:
 *  finishing per m², a carpenter's day, packing per unit.
 *
 *  A BOM line that follows a rate moves with it while it is a draft, and keeps
 *  the figure it was released with once released — the same rule a catalogue
 *  price follows. `Used in` says how many products' current BOMs a change here
 *  would move.
 *
 *  Below the list, each finishing system in the business's recipes is offered
 *  as a candidate `finishing` rate (0193, D338) — added only when somebody
 *  presses the button.
 */
export default function BomRatesPage() {
  const tr = useTr();
  const { can } = useSession();
  const mayEdit = can("production.update");
  const [showRetired, setShowRetired] = useState(false);
  const [rates, reload] = useLoad(() => production.listBomRates({ include_inactive: showRetired }), [showRetired]);
  const [group, setGroup] = useState<BomRateGroup | "all">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<BomRateView | "new" | null>(null);
  /* Bumped whenever the list changes, so the finishing candidates re-read
     which of them are already on it. */
  const [version, setVersion] = useState(0);
  const changed = () => { reload(); setVersion((v) => v + 1); };

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Production", "Produksi")}
        title={tr("BOM rates", "Daftar rate BOM")}
        description={tr(
          "What a BOM is costed at: timber per m³, panels, finishing per m², labour per day, packing. Apart from the items database, which holds what procurement paid. A draft BOM follows these rates; a released one keeps its own.",
          "Harga yang dipakai menghitung BOM: kayu per m³, panel, finishing per m², tenaga kerja per hari, packing. Terpisah dari database items, yang berisi harga beli procurement. Draft BOM mengikuti rate ini; BOM yang sudah dirilis memakai rate-nya sendiri.",
        )}
        actions={
          <div className="flex gap-2">
            <Link href="/produksi/bom">
              <Button variant="outline" icon={ListTree}>{tr("Products & BOM", "Produk & BOM")}</Button>
            </Link>
            {mayEdit && <Button icon={Plus} onClick={() => setEditing("new")}>{tr("New rate", "Rate baru")}</Button>}
          </div>
        }
      />

      <Loaded state={rates} onRetry={reload}>
        {(all) => {
          const rows = all
            .filter((r) => group === "all" || r.rate_group === group)
            .filter((r) => `${r.code} ${r.name} ${r.item_code ?? ""} ${r.item_name ?? ""} ${r.note ?? ""}`
              .toLowerCase().includes(q.trim().toLowerCase()));
          return (
            <Card>
              <CardHeader
                title={tr("Rate list", "Daftar rate")}
                subtitle={tr(
                  `${all.length} rates. Click one to change it.`,
                  `${all.length} rate. Klik untuk mengubah.`,
                )}
                icon={Coins}
                action={<SourceBadge state={rates} />}
              />
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
                {(["all", ...BOM_RATE_GROUPS] as const).map((g) => {
                  const n = g === "all" ? all.length : all.filter((r) => r.rate_group === g).length;
                  return (
                    <button
                      key={g} onClick={() => setGroup(g)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-[12px] font-medium",
                        group === g ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {g === "all" ? tr("All", "Semua") : tr(BOM_RATE_GROUP_LABELS[g].en, BOM_RATE_GROUP_LABELS[g].id)}
                      <span className="ml-1 tabular-nums opacity-70">{n}</span>
                    </button>
                  );
                })}
                <label className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600">
                  <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
                  {tr("Show retired", "Tampilkan nonaktif")}
                </label>
              </div>
              <div className="border-b border-slate-100 px-4 py-2">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder={tr("Search name, code or item…", "Cari nama, kode atau item…")}
                    className="h-8 w-full text-sm focus:outline-none"
                  />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left">{tr("Rate", "Rate")}</th>
                      <th className="px-4 py-2 text-left">{tr("Group", "Kelompok")}</th>
                      <th className="px-4 py-2 text-right">{tr("Rp per unit", "Rp per satuan")}</th>
                      <th className="px-4 py-2 text-left">{tr("Item", "Item")}</th>
                      <th className="px-4 py-2 text-right">{tr("Used in", "Dipakai di")}</th>
                      <th className="px-4 py-2 text-left">{tr("Updated", "Diubah")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        onClick={mayEdit ? () => setEditing(r) : undefined}
                        className={cn("border-b border-slate-100", mayEdit && "cursor-pointer hover:bg-slate-50", !r.active && "opacity-60")}
                      >
                        <td className="px-4 py-2">
                          <span className="block font-medium text-slate-800">
                            {r.name}
                            {!r.active && <Badge tone="slate" className="ml-2">{tr("retired", "nonaktif")}</Badge>}
                          </span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {r.code}{r.note && <span className="font-sans"> · {r.note}</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {tr(BOM_RATE_GROUP_LABELS[r.rate_group].en, BOM_RATE_GROUP_LABELS[r.rate_group].id)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          <span className="tabular-nums text-slate-800">{formatIDR(r.rate)}</span>
                          <span className="block text-[11px] text-slate-400">per {r.uom}</span>
                        </td>
                        <td className="px-4 py-2 text-[12px] text-slate-600">
                          {r.item_code ? (
                            <>
                              <span className="block truncate">{r.item_name ?? r.item_code}</span>
                              <span className="block font-mono text-[10px] text-slate-400">{r.item_code}</span>
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                          {r.used_by > 0 ? tr(`${r.used_by} products`, `${r.used_by} produk`) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-[12px] text-slate-500">
                          {r.updated_at.slice(0, 10)}
                          {r.updated_by_name && <span className="block text-[11px] text-slate-400">{r.updated_by_name}</span>}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {all.length === 0
                          ? tr(
                            "No rates yet. Add the ones your BOMs are costed at — timber per grade, finishing, labour, packing.",
                            "Belum ada rate. Tambahkan yang dipakai menghitung BOM — kayu per grade, finishing, tenaga kerja, packing.",
                          )
                          : tr("Nothing matches.", "Tidak ada yang cocok.")}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        }}
      </Loaded>

      {(group === "all" || group === "finishing") && (
        <FinishingCandidates
          rates={rates.status === "ready" ? rates.data : []}
          mayEdit={mayEdit} version={version} onChanged={changed}
        />
      )}

      {editing && (
        <Drawer
          open onClose={() => setEditing(null)} width="max-w-lg"
          title={editing === "new" ? tr("New rate", "Rate baru") : editing.name}
          subtitle={editing === "new"
            ? tr("Its code is given on save and never changes — BOM lines name it.", "Kodenya diberikan saat disimpan dan tidak berubah — baris BOM menyebutnya.")
            : `${editing.code} · ${tr(BOM_RATE_GROUP_LABELS[editing.rate_group].en, BOM_RATE_GROUP_LABELS[editing.rate_group].id)}`}
        >
          <RateForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => { setEditing(null); changed(); }}
            onCancel={() => setEditing(null)}
          />
        </Drawer>
      )}
    </div>
  );
}
