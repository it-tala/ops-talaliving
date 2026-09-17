"use client";

import { useState } from "react";
import { Layers, AlertTriangle, ArrowDownToLine } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import { BOARD_MOVE_LABEL, type BoardMoveKind, type BoardStockView } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The rack, and what leaves it.
 *
 *  This used to be *what came off the saw* — a figure that only ever went up,
 *  which is why the old screen said in so many words that it was not stock.
 *  It is stock now (D203): the count is the sum of the sawing and every
 *  movement since, and the workshop reads it the way it asks for wood — by
 *  species and size, not by cubic metre.
 *
 *  Two columns are deliberately capable of being blank. **Nilai** is empty for
 *  boards whose load has no costed yield yet, and those boards are still
 *  counted in the quantity beside it — the rack is never short a board because
 *  nobody priced it (D172, D204).
 */
export function BoardStock({ onUsed }: { onUsed: () => void }) {
  const [stock, reload] = useLoad(() => inventory.listBoardStock(), []);
  const [open, setOpen] = useState<BoardStockView | null>(null);

  return (
    <>
      <Loaded state={stock} onRetry={reload}>
        {(rows) => {
          const onHand = rows.filter((r) => r.qty !== 0);
          const totalM3 = onHand.reduce((a, r) => a + r.m3, 0);
          const totalValue = onHand.reduce((a, r) => a + (r.value ?? 0), 0);
          const unpriced = onHand.reduce((a, r) => a + r.unpriced_qty, 0);
          const estimated = onHand.reduce((a, r) => a + r.estimated_qty, 0);

          return (
            <Card>
              <CardHeader
                title={`${onHand.length} ukuran di rak`}
                subtitle={`${formatNumber(totalM3)} m³ · senilai ${formatIDR(totalValue)}${
                  estimated > 0 ? ` · ${estimated} lembar dinilai pakai harga termahal` : ""}${
                  unpriced > 0 ? ` · ${unpriced} lembar terhitung tapi belum berharga` : ""}`}
                icon={Layers}
                action={<SourceBadge state={stock} />}
              />
              <div className="overflow-x-auto">
                <Paged rows={onHand} pageSize={20} unit="ukuran">
                  {(page) => (
                    <table className="w-full min-w-[880px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">Jenis · ukuran</th>
                          <th className="px-4 py-2 text-right">Di rak</th>
                          <th className="px-4 py-2 text-right">Digergaji</th>
                          <th className="px-4 py-2 text-right">Dipakai</th>
                          <th className="px-4 py-2 text-right">m³</th>
                          <th className="px-4 py-2 text-right">Rp / m³ papan</th>
                          <th className="px-4 py-2 text-right">Nilai</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {page.map((r) => (
                          <tr key={r.board_key} className="border-b border-slate-100">
                            <td className="px-4 py-2">
                              <span className="block font-medium text-slate-800">
                                {r.species} <span className="font-normal text-slate-500">· {r.size}</span>
                              </span>
                              {/* Dua kalimat yang berbeda, sengaja dipisah: satu
                                  memakai tarif termahal sejenis (D232), satu lagi
                                  memang tidak punya tarif apa pun. */}
                              {r.estimated_qty > 0 && r.estimate_per_m3 != null && (
                                <span className="block text-[11px] text-amber-700">
                                  {r.estimated_qty} lembar tanpa asal kiriman — dinilai pakai harga
                                  termahal {formatIDR(r.estimate_per_m3)}/m³
                                </span>
                              )}
                              {r.unpriced_qty > 0 && (
                                <span className="block text-[11px] text-amber-700">
                                  {r.unpriced_qty} lembar tanpa asal kiriman — dihitung, tidak dinilai
                                </span>
                              )}
                            </td>
                            <td className={cn("px-4 py-2 text-right font-semibold tabular-nums",
                              r.qty === 0 ? "text-slate-300" : "text-slate-900")}>{r.qty}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.sawn_total}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                              {r.issued_total}
                              {r.scrapped_total > 0 && (
                                <span className="block text-[10px] text-slate-400">{r.scrapped_total} rusak</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(r.m3)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                              {r.avg_cost_per_m3 == null ? "—" : formatIDR(r.avg_cost_per_m3)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                              {r.value == null ? "—" : formatIDR(r.value)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <Button size="sm" variant="outline" icon={ArrowDownToLine} onClick={() => setOpen(r)}>
                                Catat
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Paged>
              </div>
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                Isi rak dihitung dari laporan gergajian dikurangi pemakaian — tidak ada angka stok
                yang disimpan, jadi rak tidak bisa berbeda dengan rendemennya. Nilai memakai harga
                per m³ papan dari kiriman asalnya; lembar yang asal kirimannya tidak diketahui tetap
                dihitung dan tidak dinilai.
              </p>
            </Card>
          );
        }}
      </Loaded>

      {open && (
        <MoveDrawer
          stack={open}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); reload(); onUsed(); }}
        />
      )}
    </>
  );
}

const KINDS: BoardMoveKind[] = ["issue", "return", "scrap", "adjust"];

function MoveDrawer({ stack, onClose, onDone }: {
  stack: BoardStockView; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const { can } = useSession();
  const [kind, setKind] = useState<BoardMoveKind>("issue");
  const [qty, setQty] = useState(0);
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [purchase, setPurchase] = useState("");
  const [busy, setBusy] = useState(false);
  const mayAdjust = can("inventory.adjust");

  async function submit() {
    setBusy(true);
    const res = await inventory.moveBoards({
      board_key: stack.board_key, kind, qty,
      ref_no: ref || null, reason: reason || null, purchase_no: purchase || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", "Tidak dicatat", res.error.message); return; }
    toast("success", BOARD_MOVE_LABEL[kind], `${qty} lembar ${stack.species} ${stack.size}`);
    onDone();
  }

  const outward = kind === "issue" || kind === "scrap";
  const over = outward && qty > stack.qty;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-slate-900">{stack.species} · {stack.size}</h2>
        <p className="mb-4 text-[12px] text-slate-500">
          {stack.qty} lembar di rak · {formatNumber(stack.m3)} m³
        </p>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Button
              key={k} size="sm"
              variant={kind === k ? "primary" : "outline"}
              disabled={k === "adjust" && !mayAdjust}
              onClick={() => setKind(k)}
            >
              {BOARD_MOVE_LABEL[k]}
            </Button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block text-[12px] text-slate-500">
            Berapa lembar
            <NumberInput value={qty} onChange={setQty} />
          </label>

          {kind === "issue" && (
            <label className="block text-[12px] text-slate-500">
              Untuk pekerjaan (SPK)
              <input
                value={ref} onChange={(e) => setRef(e.target.value)}
                placeholder="spk-26-09-…"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </label>
          )}

          <label className="block text-[12px] text-slate-500">
            Dari kiriman mana <span className="text-slate-400">— kosongkan kalau tumpukannya campur</span>
            <input
              value={purchase} onChange={(e) => setPurchase(e.target.value)}
              placeholder="kyu-26-…"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Menentukan harga papan ini. Dikosongkan berarti jumlahnya tetap pasti dan nilainya
              dibiarkan kosong — bukan ditebak.
            </span>
          </label>

          {(kind === "adjust" || kind === "scrap") && (
            <label className="block text-[12px] text-slate-500">
              Alasan
              <input
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={kind === "adjust" ? "Hasil opname — fisik sekian, tercatat sekian" : "Melengkung, pecah, salah potong"}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </label>
          )}

          {over && (
            <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Di rak cuma ada {stack.qty}. Kalau fisiknya memang lebih, catat sebagai penyesuaian
              opname dengan alasannya — rak yang minus tidak bisa dipakai siapa pun lagi.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button disabled={busy || qty <= 0 || over} onClick={submit}>
              {busy ? "Menyimpan…" : "Catat"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Batal</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
