"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Camera, Layers, Plus, TreePine, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { documents, inventory } from "@/demo/api";
import {
  LOG_COST_LABEL, LOG_MEASURE_LABEL, type LogCostKind, type LogPurchaseView,
} from "@/services/inventory/contracts";
import { shrinkImage } from "./notaFile";
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

  const costFileRef = useRef<HTMLInputElement>(null);
  const [cost, setCost] = useState<{ kind: LogCostKind; amount: number; payee: string; date: string; file: File | null }>({
    kind: "angkut", amount: 0, payee: "", date: officeToday(), file: null,
  });

  /** A cost nota's photo: read for its figures when a model is there, filed as
   *  evidence either way. A reading that fails leaves the form as typed. */
  async function pickCostNota(file: File | null) {
    setCost((c) => ({ ...c, file }));
    if (!file) return;
    const res = await inventory.readNotaImage(await shrinkImage(file));
    if (res.error) return;
    const s = res.data;
    const first = s.costs[0];
    setCost((c) => ({
      ...c,
      kind: first?.kind ?? c.kind,
      amount: s.costs.reduce((a, x) => a + x.amount, 0) || s.total_guess || c.amount,
      payee: s.vendor_guess ?? c.payee,
      date: s.date_guess ?? c.date,
    }));
  }

  async function addCost(p: LogPurchaseView) {
    setBusy(true);
    let notaId: string | null = null;
    if (cost.file) {
      const up = await documents.upload({ file: cost.file, kind: "Receipt / Invoice / Nota" });
      if (up.error) toast("warning", "Foto nota tidak tersimpan", `${up.error.message} Biayanya tetap dicatat.`);
      else notaId = up.data.id;
    }
    const res = await inventory.addLogCost({
      purchase_no: p.purchase_no, kind: cost.kind, amount: cost.amount,
      incurred_on: cost.date, payee: cost.payee || null, nota_attachment_id: notaId,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message); return; }
    toast("success", `Biaya ${LOG_COST_LABEL[cost.kind].toLowerCase()} tercatat`, formatIDR(cost.amount));
    setCost({ kind: "angkut", amount: 0, payee: "", date: officeToday(), file: null });
    if (costFileRef.current) costFileRef.current.value = "";
    reload(); onChanged();
  }

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
                ["Rp / m³ papan", p.landed_cost_per_sawn_m3 == null ? "—" : formatIDR(p.landed_cost_per_sawn_m3),
                  p.landed_cost_per_sawn_m2 == null ? "sampai rak" : `${formatIDR(p.landed_cost_per_sawn_m2)} / m² · sampai rak`],
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
              Nilai kayu {formatIDR(p.total_cost)}
              {p.extra_cost > 0 && <> + biaya {formatIDR(p.extra_cost)} = <strong className="font-medium text-slate-700">{formatIDR(p.landed_cost)}</strong></>}.
              {p.cost_per_sawn_m3 != null && p.extra_cost > 0 && ` Kayu saja ${formatIDR(p.cost_per_sawn_m3)} / m³ papan.`}
              {p.cost_per_log_m3 != null && ` Per m³ log ${formatIDR(p.cost_per_log_m3)} (nota).`}
              {p.note && ` ${p.note}`}
            </p>

            {/* What the invoice leaves out — each from its own nota. */}
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <Truck className="h-3.5 w-3.5" /> Biaya di luar kayu ({p.costs.length})
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-1.5 text-left">Jenis</th>
                      <th className="px-3 py-1.5 text-left">Dibayar ke</th>
                      <th className="px-3 py-1.5 text-left">Tanggal</th>
                      <th className="px-3 py-1.5 text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.costs.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-slate-800">
                          {LOG_COST_LABEL[c.kind]}
                          {c.nota_attachment_id && <Badge tone="slate" className="ml-2">nota</Badge>}
                          {c.note && <span className="block text-[10px] text-slate-400">{c.note}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{c.payee ?? "—"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{c.incurred_on}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{formatIDR(c.amount)}</td>
                      </tr>
                    ))}
                    {p.costs.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        Belum ada biaya angkut atau potong — angka di atas masih harga kayu saja.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {mayEdit && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <select
                    value={cost.kind} onChange={(e) => setCost({ ...cost, kind: e.target.value as LogCostKind })}
                    aria-label="Jenis biaya"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    {(Object.keys(LOG_COST_LABEL) as LogCostKind[]).map((k) => (
                      <option key={k} value={k}>{LOG_COST_LABEL[k]}</option>
                    ))}
                  </select>
                  <input
                    value={cost.payee} onChange={(e) => setCost({ ...cost, payee: e.target.value })}
                    placeholder="Dibayar ke" aria-label="Dibayar ke"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <input
                    type="date" value={cost.date} onChange={(e) => setCost({ ...cost, date: e.target.value })}
                    aria-label="Tanggal biaya"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <MoneyInput value={cost.amount} onChange={(v) => setCost({ ...cost, amount: v })} />
                  <input
                    ref={costFileRef} type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={(e) => pickCostNota(e.target.files?.[0] ?? null)}
                  />
                  <Button size="sm" variant={cost.file ? "primary" : "outline"} icon={Camera}
                    onClick={() => costFileRef.current?.click()}>
                    {cost.file ? "Nota ✓" : "Nota"}
                  </Button>
                  <Button size="sm" icon={Plus} disabled={busy || cost.amount <= 0} onClick={() => addCost(p)}>
                    Biaya
                  </Button>
                </div>
              )}
            </div>

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
