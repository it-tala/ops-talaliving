"use client";

import { useState } from "react";
import { ClipboardCheck, Scale, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { NumberInput } from "@/components/ui/number-input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { LocationManager } from "./LocationManager";

/** Opname: what the rack actually held.
 *
 *  The form asks for the **counted** quantity, never the difference, because
 *  that is what a person standing at the rack knows — and because a form that
 *  asks for the difference invites somebody to type the number that makes the
 *  screen agree with itself (D171).
 *
 *  The difference is what gets stored, with a reason that is required. Two
 *  things follow from that and both are deliberate: counting and finding
 *  exactly what the system said writes **nothing**, and every adjustment ever
 *  made stays readable underneath, because a stock figure nobody can take
 *  apart is one nobody can defend.
 */
export default function StockCountPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [items, reloadItems] = useLoad(() => inventory.listStock(), []);
  const [moves, reloadMoves] = useLoad(() => inventory.listStockMoves(), []);
  const [locations, reloadLocations] = useLoad(() => inventory.listStockLocations(), []);
  const [draft, setDraft] = useState({ item_code: "", location: "", counted: 0, reason: "" });
  const [busy, setBusy] = useState(false);
  const mayAdjust = can("inventory.adjust");
  const mayManageLocations = can("inventory.update");

  const chosen = items.status === "ready"
    ? items.data.find((i) => i.item_code === draft.item_code)
    : undefined;
  /* What the system believes about **that rack** right now — shown beside the
     box the counter types into, so the difference is visible before it is
     saved.
     
     A location is required, and "all locations" is deliberately not offered: a
     person counts one rack, and writing the difference of a three-location
     total against whichever location happened to be first would put a
     correction where nobody counted. */
  const systemQty = chosen && draft.location
    ? chosen.by_location.find((l) => l.location === draft.location)?.qty ?? 0
    : 0;
  const difference = Math.round((draft.counted - systemQty) * 1000) / 1000;

  async function save() {
    setBusy(true);
    const res = await inventory.adjustStock({
      item_code: draft.item_code,
      location: draft.location,
      counted_qty: draft.counted,
      reason: draft.reason,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message);
      return;
    }
    if ("noop" in res.data) {
      toast("info", "Cocok", "Hitungan fisik sama dengan catatan sistem — tidak ada yang perlu dicatat.");
    } else {
      toast("success", "Penyesuaian tercatat", `Selisih ${res.data.difference > 0 ? "+" : ""}${formatNumber(res.data.difference)}`);
    }
    setDraft({ ...draft, counted: 0, reason: "" });
    reloadItems();
    reloadMoves();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="Inventory"
        title="Opname & penyesuaian"
        description="Masukkan jumlah hasil hitung fisik. Selisihnya yang dicatat, bukan angka barunya — dan setiap selisih wajib punya alasan."
        actions={<SourceBadge state={moves} />}
      />

      {mayManageLocations && <LocationManager onChanged={reloadLocations} />}

      {mayAdjust && (
        <Card className="mb-4">
          <CardHeader
            title="Catat hasil hitung"
            subtitle="Sistem menampilkan apa yang tercatat sekarang; Anda mengisi apa yang benar-benar ada di rak."
            icon={ClipboardCheck}
          />
          <Loaded state={items} skeletonRows={2}>
            {(all) => (
              <div className="px-5 py-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_170px_150px]">
                  <select
                    value={draft.item_code}
                    onChange={(e) => setDraft({ ...draft, item_code: e.target.value, counted: 0 })}
                    aria-label="Barang"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">Pilih barang…</option>
                    {all.map((i) => (
                      <option key={i.item_code} value={i.item_code}>
                        {i.item_name} · {i.item_code}
                      </option>
                    ))}
                  </select>
                  <Loaded state={locations} skeletonRows={1}>
                    {(locs) => (
                      <select
                        value={draft.location}
                        onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                        aria-label="Lokasi"
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">Pilih lokasi…</option>
                        {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    )}
                  </Loaded>
                  <NumberInput value={draft.counted} onChange={(v) => setDraft({ ...draft, counted: v })} />
                </div>

                {chosen && !draft.location && (
                  <p className="mt-2 text-[12px] text-amber-700">
                    Pilih lokasinya dulu. {chosen.item_name} tercatat di{" "}
                    {chosen.by_location.length === 0
                      ? "belum ada lokasi mana pun"
                      : chosen.by_location.map((l) => `${l.location_name} ${formatNumber(l.qty)}`).join(" · ")}
                    {" "}— opname adalah hitungan satu rak, bukan satu total.
                  </p>
                )}
                {chosen && draft.location && (
                  <p className="mt-2 text-[12px] text-slate-600">
                    Tercatat di sistem: <span className="font-semibold tabular-nums">{formatNumber(systemQty)} {chosen.uom}</span>
                    {" · "}
                    Hitungan Anda: <span className="font-semibold tabular-nums">{formatNumber(draft.counted)} {chosen.uom}</span>
                    {" · "}
                    <span className={cn(
                      "font-semibold tabular-nums",
                      difference === 0 ? "text-slate-500" : difference < 0 ? "text-rose-700" : "text-emerald-700",
                    )}>
                      selisih {difference > 0 ? "+" : ""}{formatNumber(difference)}
                    </span>
                    {difference === 0 && " — tidak ada yang dicatat kalau cocok."}
                  </p>
                )}

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={draft.reason}
                    onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                    placeholder="Alasan — kenapa berbeda, atau apa dugaannya"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button
                    size="sm" icon={Scale}
                    disabled={busy || !draft.item_code || !draft.location || !draft.reason.trim()}
                    onClick={save}
                  >
                    {busy ? "Menyimpan…" : "Catat selisih"}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Sistem tidak pernah menebak kenapa stok berbeda. Yang tercatat adalah selisihnya
                  dan kalimat Anda — itu yang dibaca orang lain bulan depan saat angkanya ditanya.
                </p>
              </div>
            )}
          </Loaded>
        </Card>
      )}

      <Loaded state={moves} onRetry={reloadMoves}>
        {(all) => {
          const adjustments = all.filter((m) => m.kind === "adjust");
          const short = adjustments.filter((m) => m.qty < 0);
          return (
            <Card>
              <CardHeader
                title={`${adjustments.length} penyesuaian tercatat`}
                subtitle="Semuanya tetap ada. Penyesuaian yang dihapus adalah penyesuaian yang tidak pernah bisa dijelaskan."
                icon={Scale}
              />
              {short.length > 0 && (
                <p className="flex items-start gap-2 border-b border-slate-100 bg-amber-50/60 px-5 py-2.5 text-[12px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {short.length} kali hitungan fisik lebih sedikit dari catatan. Kalau satu barang
                  berulang kali kurang, itu bukan kesalahan hitung — itu pola.
                </p>
              )}
              <Paged rows={adjustments} pageSize={12} unit="penyesuaian">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                        <span className="w-[74px] shrink-0 font-mono text-[10px] text-slate-400">
                          {m.moved_at.slice(0, 10)}
                        </span>
                        <span className="min-w-[170px] text-[13px] font-medium text-slate-800">
                          {m.item_name}
                          <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{m.item_code}</span>
                        </span>
                        <Badge tone={m.qty < 0 ? "red" : "green"}>
                          {m.qty > 0 ? "+" : ""}{formatNumber(m.qty)} {m.uom}
                        </Badge>
                        <span className="text-[11px] text-slate-500">{m.location_name}</span>
                        <span className="min-w-[200px] flex-1 text-[12px] text-slate-600">{m.reason}</span>
                        <span className="text-[11px] text-slate-400">{m.by_name}</span>
                      </li>
                    ))}
                    {adjustments.length === 0 && (
                      <li className="px-5 py-8 text-[13px] text-slate-500">
                        Belum ada opname. Bukan berarti stoknya cocok — berarti belum pernah dihitung.
                      </li>
                    )}
                  </ul>
                )}
              </Paged>
            </Card>
          );
        }}
      </Loaded>
    </div>
  );
}
