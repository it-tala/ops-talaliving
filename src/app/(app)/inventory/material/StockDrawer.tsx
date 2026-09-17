"use client";

import { useState } from "react";
import { ArrowRightLeft, Boxes, PackageMinus, Undo2, Hammer, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import { MOVE_LABEL, type StockItemDetail } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";

/** One item: what is on the rack, where it came from, and what needs it.
 *
 *  The history is the point. A quantity with no history is a number somebody
 *  has to believe; a quantity with twenty rows behind it — this came in on that
 *  receipt, that went out to this SPK, this was an opname that found eighteen
 *  missing — is a number somebody can argue with, which is the only kind worth
 *  having (D170).
 */
export function StockDrawer({
  itemCode, mayMove, onClose, onChanged,
}: {
  itemCode: string;
  mayMove: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [detail, reload] = useLoad(() => inventory.getStockItem(itemCode), [itemCode]);
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ kind: "issue" | "return" | "transfer"; qty: number; location: string; to: string; ref: string; reason: string }>({
    kind: "issue", qty: 1, location: "", to: "", ref: "", reason: "",
  });

  async function run(d: StockItemDetail) {
    const location = form.location || d.by_location[0]?.location || "GUDANG";
    setBusy(true);

    /* Issuing is its own road because it is the only one that can drive the
       rack negative, and that has to be said out loud rather than swallowed by
       a shared success toast. */
    if (form.kind === "issue") {
      const res = await inventory.issueStock({
        item_code: d.item_code, location, qty: form.qty,
        wo_no: form.ref || null, reason: form.reason || null,
      });
      setBusy(false);
      if (res.error) {
        toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
        return;
      }
      if (res.data.went_negative) {
        /* Recorded either way — the rack is the truth, not the record — but
           somebody has to count it again. */
        toast(
          "warning", "Tercatat, tapi stok jadi minus",
          `Sistem sekarang mencatat ${formatNumber(res.data.on_hand_after)} ${d.uom}. Berarti ada yang belum tercatat sebelumnya — perlu opname.`,
        );
      } else {
        toast("success", "Tercatat", `Keluar ${formatNumber(form.qty)} ${d.uom}`);
      }
      after();
      return;
    }

    const res = form.kind === "return"
      ? await inventory.returnStock({ item_code: d.item_code, location, qty: form.qty, wo_no: form.ref || null, reason: form.reason || null })
      : await inventory.transferStock({ item_code: d.item_code, from: location, to: form.to, qty: form.qty, reason: form.reason || null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Tercatat", `${MOVE_LABEL[form.kind]} ${formatNumber(form.qty)} ${d.uom}`);
    after();
  }

  function after() {
    setForm((f) => ({ ...f, qty: 1, ref: "", reason: "" }));
    reload();
    onChanged();
  }

  return (
    <Loaded state={detail} onRetry={reload}>
      {(d) => (
        <Drawer
          open
          onClose={onClose}
          width="max-w-2xl"
          title={d.item_name}
          subtitle={<span className="font-mono text-[11px]">{d.item_code} · {d.category_name} · per {d.uom}</span>}
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              {([
                ["Di rak", `${formatNumber(d.on_hand)} ${d.uom}`, d.below_min ? `minimum ${formatNumber(d.min_qty ?? 0)}` : d.min_qty == null ? "minimum belum ditetapkan" : "di atas minimum"],
                ["Harga rata-rata", d.avg_cost == null ? "—" : formatIDR(d.avg_cost), d.avg_cost == null ? "belum ada harga masuk" : "dari barang masuk yang berharga"],
                ["Nilai", d.value == null ? "—" : formatIDR(d.value), d.unpriced_qty > 0 ? `belum termasuk ${formatNumber(d.unpriced_qty)} ${d.uom} tanpa harga` : "seluruh stok terhitung"],
                ["Pergerakan", String(d.moves_count), d.last_move_at ? `terakhir ${d.last_move_at.slice(0, 10)}` : "belum pernah"],
              ] as [string, string, string][]).map(([k, v, note]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-slate-800">{v}</dd>
                  <p className="text-[11px] text-slate-500">{note}</p>
                </div>
              ))}
            </dl>

            {d.by_location.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {d.by_location.map((l) => (
                  <span key={l.location} className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-600">
                    {l.location_name} <span className="font-semibold tabular-nums text-slate-800">{formatNumber(l.qty)}</span>
                  </span>
                ))}
              </div>
            )}

            {mayMove && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ["issue", "Keluarkan", PackageMinus],
                    ["return", "Kembalikan", Undo2],
                    ["transfer", "Pindah lokasi", ArrowRightLeft],
                  ] as const).map(([kind, label, Icon]) => (
                    <Button
                      key={kind} size="sm" icon={Icon}
                      variant={form.kind === kind ? "primary" : "outline"}
                      onClick={() => setForm({ ...form, kind })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <Loaded state={locations} skeletonRows={1}>
                  {(locs) => (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_1fr]">
                      <NumberInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} />
                      <select
                        value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                        aria-label="Dari lokasi"
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{d.by_location[0]?.location_name ?? "Gudang utama"}</option>
                        {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                      {form.kind === "transfer" ? (
                        <select
                          value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}
                          aria-label="Ke lokasi"
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          <option value="">Ke lokasi…</option>
                          {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                        </select>
                      ) : (
                        <input
                          value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })}
                          placeholder="Nomor SPK (opsional)"
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                      )}
                    </div>
                  )}
                </Loaded>

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Untuk apa — dibaca di riwayat bulan depan"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button
                    size="sm" disabled={busy || form.qty <= 0 || (form.kind === "transfer" && !form.to)}
                    onClick={() => run(d)}
                  >
                    {busy ? "Menyimpan…" : "Catat"}
                  </Button>
                </div>
              </div>
            )}

            {(d.used_in.length > 0 || d.on_order.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                    <Hammer className="h-3.5 w-3.5 text-slate-400" /> Dipakai di produk
                  </p>
                  {d.used_in.length === 0 ? (
                    <p className="mt-1 text-[12px] text-slate-500">Belum ada BOM yang memakainya.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                      {d.used_in.map((u) => (
                        <li key={u.product_code}>
                          {u.product_name} · {formatNumber(u.qty_per_unit)} {d.uom}/unit
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                    <Truck className="h-3.5 w-3.5 text-slate-400" /> Sudah disetujui, belum datang
                  </p>
                  {d.on_order.length === 0 ? (
                    <p className="mt-1 text-[12px] text-slate-500">Tidak ada yang sedang dipesan.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                      {d.on_order.map((o) => (
                        <li key={o.pr_line_no}>
                          <span className="font-mono text-[11px]">{o.pr_line_no}</span> · {formatNumber(o.qty)} {d.uom}
                          {o.need_by ? ` · butuh ${o.need_by}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <Boxes className="h-3.5 w-3.5 text-slate-400" /> Riwayat pergerakan
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {d.moves.length === 0 && (
                  <li className="px-4 py-6 text-[12px] text-slate-500">
                    Barang ini ada di katalog tapi belum pernah masuk atau keluar. Bukan berarti habis —
                    berarti belum pernah tercatat.
                  </li>
                )}
                {d.moves.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                    <span className="w-[74px] shrink-0 font-mono text-[10px] text-slate-400">
                      {m.moved_at.slice(5, 10)}
                    </span>
                    <Badge tone={m.kind === "adjust" ? "amber" : m.qty > 0 ? "green" : "slate"}>
                      {MOVE_LABEL[m.kind]}
                    </Badge>
                    <span className={cn(
                      "w-[80px] text-right font-semibold tabular-nums",
                      m.qty > 0 ? "text-emerald-700" : "text-slate-800",
                    )}>
                      {m.qty > 0 ? "+" : ""}{formatNumber(m.qty)}
                    </span>
                    <span className="text-[11px] text-slate-500">{m.location_name}</span>
                    {m.ref_no && (
                      <span className={cn("font-mono text-[10px]", m.ref_missing ? "text-amber-700" : "text-slate-400")}>
                        {m.ref_no}
                        {/* A reference nothing follows is a reference nothing
                            checks — which is how nine seeded issues pointed at
                            work orders that had never existed (F86). */}
                        {m.ref_missing && <span className="ml-1">· SPK ini tidak ada</span>}
                      </span>
                    )}
                    <span className="min-w-[160px] flex-1 text-[11px] text-slate-500">
                      {m.reason ?? (m.unit_cost != null ? `${formatIDR(m.unit_cost)} / ${m.uom}` : "—")}
                    </span>
                    <span className="text-[11px] text-slate-400">{m.by_name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}
