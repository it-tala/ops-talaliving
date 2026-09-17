"use client";

import { useState } from "react";
import { AlertTriangle, Layers, Plus, TreePine } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import { LOG_MEASURE_LABEL, type LogPurchaseView } from "@/services/inventory/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { officeToday } from "@/lib/office";

/** One delivery of logs: every stick measured, every board that came out.
 *
 *  The four figures at the top are the whole module. Two of them are on the
 *  invoice. The other two — rendemen and rupiah per cubic metre of board — are
 *  what the invoice cannot tell you and what actually decides whether this
 *  vendor was cheap (D153).
 */
export function LogPurchaseDrawer({
  purchaseNo, onClose, onChanged,
}: {
  purchaseNo: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const [purchase, reload] = useLoad(() => inventory.getLogPurchase(purchaseNo), [purchaseNo]);
  const [busy, setBusy] = useState(false);
  const mayEdit = can("inventory.adjust") || can("inventory.update");

  const [log, setLog] = useState({ tag: "", d: 40, l: 300 });
  const [board, setBoard] = useState({
    tag: "", t: 30, w: 200, len: 3000, qty: 1,
    date: officeToday(),
  });

  async function addLog(p: LogPurchaseView) {
    setBusy(true);
    const res = await inventory.addLog({
      purchase_no: p.purchase_no, tag: log.tag, diameter_cm: log.d, length_cm: log.l,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message); return; }
    toast("success", "Batang tercatat", `${log.tag} · ø${log.d} cm × ${log.l} cm`);
    setLog({ tag: "", d: 40, l: 300 });
    reload(); onChanged();
  }

  async function addBoards(p: LogPurchaseView) {
    setBusy(true);
    const res = await inventory.reportBoards({
      purchase_no: p.purchase_no,
      log_tag: board.tag || null,
      thickness_mm: board.t, width_mm: board.w, length_mm: board.len,
      qty: board.qty, sawn_on: board.date,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message); return; }
    toast("success", `${board.qty} lembar tercatat`, `${board.t / 10} × ${board.w / 10} × ${board.len / 10} cm`);
    setBoard({ ...board, qty: 1 });
    reload(); onChanged();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-3xl"
      title={purchase.status === "ready" ? `${purchase.data.species} · ${purchase.data.vendor_name}` : purchaseNo}
      subtitle={purchase.status === "ready"
        ? `${purchaseNo} · diterima ${purchase.data.received_on} · ${LOG_MEASURE_LABEL[purchase.data.measure]}`
        : undefined}
    >
      <Loaded state={purchase} onRetry={reload}>
        {(p) => (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ["Kubikasi log", `${formatNumber(p.log_m3)} m³`,
                  p.claimed_m3 != null ? `penjual bilang ${formatNumber(p.claimed_m3)} m³` : `${p.logs.length} batang`],
                ["Kubikasi papan", p.sawn_m3 > 0 ? `${formatNumber(p.sawn_m3)} m³` : "—",
                  p.unsawn_m3 > 0 ? `${formatNumber(p.unsawn_m3)} m³ belum digergaji` : "seluruhnya sudah digergaji"],
                ["Rendemen", p.yield_percent == null ? "—" : `${p.yield_percent}%`,
                  "papan ÷ log yang sudah digergaji"],
                ["Rp / m³ papan", p.cost_per_sawn_m3 == null ? "—" : formatIDR(p.cost_per_sawn_m3),
                  p.cost_per_log_m3 == null ? "" : `log: ${formatIDR(p.cost_per_log_m3)}`],
              ] as [string, string, string][]).map(([k, v, note]) => (
                <div key={k} className={cn(
                  "rounded-xl border px-3 py-2.5",
                  k === "Rp / m³ papan" ? "border-brand-200 bg-brand-50/60" : "border-slate-200",
                )}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-slate-900">{v}</dd>
                  <p className="text-[10px] text-slate-500">{note}</p>
                </div>
              ))}
            </dl>
            <p className="text-[12px] text-slate-500">
              Nilai tagihan {formatIDR(p.total_cost)}.
              {p.note && ` ${p.note}`}
            </p>

            {p.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Perlu diperiksa
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-amber-900">
                  {p.warnings.map((w) => <li key={w}>· {w}</li>)}
                </ul>
              </div>
            )}

            {/* Every log, measured. */}
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <TreePine className="h-3.5 w-3.5" /> Batang ({p.logs.length})
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-1.5 text-left">Tanda</th>
                      <th className="px-3 py-1.5 text-right">Ø cm</th>
                      <th className="px-3 py-1.5 text-right">Panjang cm</th>
                      <th className="px-3 py-1.5 text-right">m³</th>
                      <th className="px-3 py-1.5 text-left">Digergaji</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.logs.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 font-mono text-slate-700">{l.tag}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.diameter_cm}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.length_cm}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{formatNumber(l.m3)}</td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {l.sawn_on ?? <span className="text-amber-700">belum</span>}
                          {l.note && <span className="block text-[10px] text-slate-400">{l.note}</span>}
                        </td>
                      </tr>
                    ))}
                    {p.logs.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Belum ada batang yang diukur.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {mayEdit && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_90px_auto]">
                  <input
                    value={log.tag} onChange={(e) => setLog({ ...log, tag: e.target.value.toUpperCase() })}
                    placeholder="Tanda, mis. A-09" aria-label="Tanda batang"
                    className="h-9 rounded-lg border border-slate-200 px-2 font-mono text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <NumberInput value={log.d} min={1} max={200} onChange={(v) => setLog({ ...log, d: v })} />
                  <NumberInput value={log.l} min={1} max={1500} onChange={(v) => setLog({ ...log, l: v })} />
                  <Button size="sm" icon={Plus} disabled={busy || !log.tag.trim()} onClick={() => addLog(p)}>
                    Batang
                  </Button>
                </div>
              )}
            </div>

            {/* Everything that came off the saw. */}
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <Layers className="h-3.5 w-3.5" /> Papan ({p.boards.reduce((a, b) => a + b.qty, 0)} lembar)
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-1.5 text-left">Ukuran</th>
                      <th className="px-3 py-1.5 text-right">Lembar</th>
                      <th className="px-3 py-1.5 text-right">m³ / lembar</th>
                      <th className="px-3 py-1.5 text-right">m³</th>
                      <th className="px-3 py-1.5 text-left">Tanggal · batang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.boards.map((b) => {
                      const from = b.log_id ? p.logs.find((l) => l.id === b.log_id) : null;
                      return (
                        <tr key={b.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-1.5 text-slate-800">
                            {b.size}
                            {b.grade && b.grade !== "A" && <Badge tone="slate" className="ml-2">{b.grade}</Badge>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{b.qty}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{formatNumber(b.m3_each)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{formatNumber(b.m3)}</td>
                          <td className="px-3 py-1.5 text-slate-500">
                            {b.sawn_on}
                            {from && <span className="ml-1 font-mono text-[10px] text-slate-400">{from.tag}</span>}
                            {b.note && <span className="block text-[10px] text-slate-400">{b.note}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {p.boards.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Belum ada papan yang dilaporkan.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {mayEdit && (
                <>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[90px_80px_80px_90px_70px_auto]">
                    <input
                      value={board.tag} onChange={(e) => setBoard({ ...board, tag: e.target.value.toUpperCase() })}
                      placeholder="Batang" aria-label="Dari batang"
                      className="h-9 rounded-lg border border-slate-200 px-2 font-mono text-sm focus:border-brand-400 focus:outline-none"
                    />
                    <NumberInput value={board.t} min={1} max={300} onChange={(v) => setBoard({ ...board, t: v })} />
                    <NumberInput value={board.w} min={1} max={2000} onChange={(v) => setBoard({ ...board, w: v })} />
                    <NumberInput value={board.len} min={1} max={12000} onChange={(v) => setBoard({ ...board, len: v })} />
                    <NumberInput value={board.qty} min={1} max={999} onChange={(v) => setBoard({ ...board, qty: v })} />
                    <Button size="sm" icon={Plus} disabled={busy} onClick={() => addBoards(p)}>Papan</Button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Tebal · lebar · panjang dalam <strong>milimeter</strong>, lalu jumlah lembar.
                    Kolom batang boleh kosong — satu hari menggergaji biasanya dilaporkan sebagai
                    satu tumpukan. Melaporkan papan dari sebuah batang sekaligus menandai batang itu
                    sudah digergaji.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}
