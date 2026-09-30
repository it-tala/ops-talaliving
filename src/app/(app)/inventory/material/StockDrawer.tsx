"use client";

import { useState } from "react";
import { ArrowRightLeft, PackageMinus, Undo2, Hammer, Truck, Receipt } from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { inventory } from "@/demo/api";
import { MOVE_LABEL, type StockItemDetail, type StockItemView } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { EvidenceStrip } from "@/components/ui/evidence-strip";
import { ITEM_PHOTO_MAX, ITEM_PHOTO_MIN } from "@/services/documents/contracts";
import { useTr } from "@/lib/i18n";
import { ItemDetails } from "./ItemDetails";
import { MoveHistory } from "./MoveHistory";

/** One item: what is on the rack, where it came from, and what needs it.
 *
 *  The history is the point. A quantity with no history is a number somebody
 *  has to believe; a quantity with twenty rows behind it — this came in on that
 *  receipt, that went out to this SPK, this was an opname that found eighteen
 *  missing — is a number somebody can argue with, which is the only kind worth
 *  having (D170).
 */
export function StockDrawer({
  itemCode, mayMove, mayAdjust = false, catalogue = [], onClose, onChanged,
}: {
  itemCode: string;
  mayMove: boolean;
  /** Correct or delete entries (`0198`, `inventory.adjust`). */
  mayAdjust?: boolean;
  /** The catalogue, for moving an entry to the item it should have named. */
  catalogue?: StockItemView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [detail, reload] = useLoad(() => inventory.getStockItem(itemCode), [itemCode]);
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [purchases] = useLoad(() => inventory.stockItemPurchases(itemCode), [itemCode]);
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
        toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
        return;
      }
      if (res.data.went_negative) {
        /* Recorded either way — the rack is the truth, not the record — but
           somebody has to count it again. */
        toast(
          "warning", tr("Recorded, but stock went negative", "Tercatat, tapi stok jadi minus"),
          tr(
            `The system now records ${formatNumber(res.data.on_hand_after)} ${d.uom}. Something was not recorded earlier — an opname is needed.`,
            `Sistem sekarang mencatat ${formatNumber(res.data.on_hand_after)} ${d.uom}. Berarti ada yang belum tercatat sebelumnya — perlu opname.`,
          ),
        );
      } else {
        toast("success", tr("Recorded", "Tercatat"), tr(`Issued ${formatNumber(form.qty)} ${d.uom}`, `Keluar ${formatNumber(form.qty)} ${d.uom}`));
      }
      after();
      return;
    }

    const res = form.kind === "return"
      ? await inventory.returnStock({ item_code: d.item_code, location, qty: form.qty, wo_no: form.ref || null, reason: form.reason || null })
      : await inventory.transferStock({ item_code: d.item_code, from: location, to: form.to, qty: form.qty, reason: form.reason || null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Recorded", "Tercatat"), `${MOVE_LABEL[form.kind]} ${formatNumber(form.qty)} ${d.uom}`);
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
          subtitle={
            <span className="text-[11px]">
              {d.item_name_local && <span className="mr-1 text-slate-700">{d.item_name_local} ·</span>}
              <span className="font-mono">{d.item_code} · {d.category_name} · {tr("per", "per")} {d.uom}</span>
            </span>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              {([
                [tr("On the rack", "Di rak"), `${formatNumber(d.on_hand)} ${d.uom}`, d.below_min ? `minimum ${formatNumber(d.min_qty ?? 0)}` : d.min_qty == null ? tr("minimum not set", "minimum belum ditetapkan") : tr("above minimum", "di atas minimum")],
                [tr("Average price", "Harga rata-rata"), d.avg_cost == null ? "—" : formatIDR(d.avg_cost), d.avg_cost == null ? tr("no priced receipts yet", "belum ada harga masuk") : tr("from priced goods received", "dari barang masuk yang berharga")],
                [tr("Value", "Nilai"), d.value == null ? "—" : formatIDR(d.value), d.unpriced_qty > 0 ? tr(`excludes ${formatNumber(d.unpriced_qty)} ${d.uom} without a price`, `belum termasuk ${formatNumber(d.unpriced_qty)} ${d.uom} tanpa harga`) : tr("all stock counted", "seluruh stok terhitung")],
                [tr("Movements", "Pergerakan"), String(d.moves_count), d.last_move_at ? tr(`last ${d.last_move_at.slice(0, 10)}`, `terakhir ${d.last_move_at.slice(0, 10)}`) : tr("never", "belum pernah")],
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

            {/* The item's own details — name, floor name, category, unit —
                editable from here (0198, D348). */}
            <ItemDetails d={d} mayEdit={mayMove} onSaved={() => { reload(); onChanged(); }} />

            <EvidenceStrip
              entity="item"
              entityNo={d.item_code}
              canEdit={mayMove}
              defaultKind="Foto"
              slots={[{ kind: "Foto", label: tr(`Item photos (${ITEM_PHOTO_MIN}–${ITEM_PHOTO_MAX})`, `Foto barang (${ITEM_PHOTO_MIN}–${ITEM_PHOTO_MAX})`) }]}
              onChanged={() => { reload(); onChanged(); }}
              note={d.photo_count === 0
                ? tr("This item has no photo yet — it was registered before photos were required. Add at least one.", "Barang ini belum punya foto — didaftarkan sebelum foto diwajibkan. Tambahkan minimal satu.")
                : tr(`${d.photo_count} of ${ITEM_PHOTO_MAX} photos. The last photo cannot be deleted — add its replacement first.`, `${d.photo_count} dari ${ITEM_PHOTO_MAX} foto. Foto terakhir tidak bisa dihapus — tambah penggantinya dulu.`)}
            />

            {mayMove && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ["issue", tr("Issue", "Keluarkan"), PackageMinus],
                    ["return", tr("Return", "Kembalikan"), Undo2],
                    ["transfer", tr("Move location", "Pindah lokasi"), ArrowRightLeft],
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
                        aria-label={tr("From location", "Dari lokasi")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{d.by_location[0]?.location_name ?? tr("Main warehouse", "Gudang utama")}</option>
                        {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                      {form.kind === "transfer" ? (
                        <select
                          value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}
                          aria-label={tr("To location", "Ke lokasi")}
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          <option value="">{tr("To location…", "Ke lokasi…")}</option>
                          {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                        </select>
                      ) : (
                        <input
                          value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })}
                          placeholder={tr("Job Order number (optional)", "Nomor Job Order (opsional)")}
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                      )}
                    </div>
                  )}
                </Loaded>

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder={tr("What for — read in the history next month", "Untuk apa — dibaca di riwayat bulan depan")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button
                    size="sm" disabled={busy || form.qty <= 0 || (form.kind === "transfer" && !form.to)}
                    onClick={() => run(d)}
                  >
                    {busy ? tr("Saving…", "Menyimpan…") : tr("Record", "Catat")}
                  </Button>
                </div>
              </div>
            )}

            {(d.used_in.length > 0 || d.on_order.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                    <Hammer className="h-3.5 w-3.5 text-slate-400" /> {tr("Used in products", "Dipakai di produk")}
                  </p>
                  {d.used_in.length === 0 ? (
                    <p className="mt-1 text-[12px] text-slate-500">{tr("No BOM uses it yet.", "Belum ada BOM yang memakainya.")}</p>
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
                    <Truck className="h-3.5 w-3.5 text-slate-400" /> {tr("Approved, not yet arrived", "Sudah disetujui, belum datang")}
                  </p>
                  {d.on_order.length === 0 ? (
                    <p className="mt-1 text-[12px] text-slate-500">{tr("Nothing is on order.", "Tidak ada yang sedang dipesan.")}</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                      {d.on_order.map((o) => (
                        <li key={o.pr_line_no}>
                          <span className="font-mono text-[11px]">{o.pr_line_no}</span> · {formatNumber(o.qty)} {d.uom}
                          {o.need_by ? tr(` · needed ${o.need_by}`, ` · butuh ${o.need_by}`) : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Which ledger lines bought it — read through the line's own
                item link, never guessed from a description (0104, 0168). */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <Receipt className="h-3.5 w-3.5 text-slate-400" /> {tr("Purchase transactions", "Transaksi pembelian")}
                {/* The whole life — catalogue, BOM, PR, PO, receiving, stock,
                    Job Order — is the trail opened by this item's code (D313). */}
                <Link href={`/produksi/jejak?no=${encodeURIComponent(d.item_code)}`}
                  className="ml-auto text-[11px] font-normal text-brand-700 hover:underline">
                  {tr("Full item history →", "Riwayat lengkap barang →")}
                </Link>
              </p>
              <Loaded state={purchases} skeletonRows={2}>
                {(rows) => rows.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 px-4 py-3 text-[12px] text-slate-500">
                    {tr(
                      "No ledger line names this item yet. A purchase recorded without choosing the item will not appear here — that does not mean it was never bought.",
                      "Belum ada baris buku besar yang menyebut barang ini. Pembelian yang dicatat tanpa memilih barangnya tidak akan muncul di sini — bukan berarti belum pernah dibeli.",
                    )}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {rows.slice(0, 10).map((p, i) => (
                      <li key={`${p.trx_no}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[12px]">
                        <span className="font-mono text-[11px] text-slate-500">{p.trx_no}</span>
                        <span className="text-slate-400">{p.trx_date}</span>
                        <span className="min-w-[120px] flex-1 text-slate-700">{p.vendor_name ?? "—"}</span>
                        <span className="tabular-nums text-slate-600">
                          {p.qty != null ? `${formatNumber(p.qty)} ${p.uom ?? ""}` : ""}
                          {p.unit_price != null ? ` × ${formatIDR(p.unit_price)}` : ""}
                        </span>
                        <span className="w-28 text-right font-semibold tabular-nums text-slate-800">{formatIDR(p.amount)}</span>
                        {p.item_code !== d.item_code && (
                          <span className="w-full text-[11px] text-slate-400">{tr(`recorded as ${p.item_name} (${p.item_code}), merged`, `dicatat sebagai ${p.item_name} (${p.item_code}), sudah digabung`)}</span>
                        )}
                      </li>
                    ))}
                    {rows.length > 10 && (
                      <li className="px-4 py-2 text-[11px] text-slate-500">{tr(`+${rows.length - 10} older transactions`, `+${rows.length - 10} transaksi lebih lama`)}</li>
                    )}
                  </ul>
                )}
              </Loaded>
            </div>

            <MoveHistory d={d} mayAdjust={mayAdjust} catalogue={catalogue} onChanged={() => { reload(); onChanged(); }} />
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}
