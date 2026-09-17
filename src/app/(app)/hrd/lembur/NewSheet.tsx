"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { NumberInput } from "@/components/ui/number-input";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { hr, production } from "@/demo/api";
import { OVERTIME_KIND_LABEL, type OvertimeKind } from "@/services/hr/contracts";
import { STAGE_NAME } from "@/services/production/contracts";
import { useToast } from "@/store/toast";
import { officeToday } from "@/lib/office";

/** Opening a sheet, and putting names on it.
 *
 *  A production line asks three extra things — **item apa, proses sampai mana,
 *  berapa** — and they are not decoration: signing this sheet is what moves
 *  the work order on the production board (D147). Typing them here is the
 *  alternative to writing the same night down twice and discovering next week
 *  that the two copies disagree.
 *
 *  A staff line asks none of them. One person, one session, what they did.
 */
type Draft = {
  employee_no: string;
  hours: number;
  task: string;
  wo_no: string;
  stage: string;
  qty_done: number;
};

const blank = (): Draft => ({ employee_no: "", hours: 2, task: "", wo_no: "", stage: "", qty_done: 0 });

export function NewSheet({
  kind, onClose, onDone,
}: {
  kind: OvertimeKind;
  onClose: () => void;
  onDone: (sheetNo: string) => void;
}) {
  const { toast } = useToast();
  const [people] = useLoad(() => hr.listEmployees(), []);
  const [orders] = useLoad(() => production.listWorkOrders(), []);
  const [workDate, setWorkDate] = useState(officeToday());
  const [purpose, setPurpose] = useState("");
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [busy, setBusy] = useState(false);

  const isProduction = kind === "production";
  const usable = rows.filter((r) => r.employee_no && r.hours > 0 && r.task.trim());

  function set(i: number, patch: Partial<Draft>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    const made = await hr.createOvertimeSheet({ kind, work_date: workDate, purpose });
    if (made.error) { setBusy(false); toast("warning", "Lembar tidak dibuat", made.error.message); return; }

    const sheetNo = made.data.sheet_no;
    const failed: string[] = [];
    for (const r of usable) {
      const res = await hr.addOvertimeLine({
        sheet_no: sheetNo,
        employee_no: r.employee_no,
        hours: r.hours,
        task: r.task,
        wo_no: isProduction ? r.wo_no || null : null,
        stage: isProduction ? r.stage || null : null,
        qty_done: isProduction && r.qty_done > 0 ? r.qty_done : null,
      });
      if (res.error) failed.push(`${r.employee_no}: ${res.error.message}`);
    }
    setBusy(false);
    if (failed.length > 0) {
      toast("warning", `${failed.length} baris tidak masuk`, failed[0]);
    } else {
      toast("success", "Lembar dibuat", `${sheetNo} · ${usable.length} nama`);
    }
    onDone(sheetNo);
  }

  return (
    <Drawer
      open onClose={onClose} width={isProduction ? "max-w-3xl" : "max-w-lg"}
      title={OVERTIME_KIND_LABEL[kind]}
      subtitle={isProduction
        ? "Satu malam, banyak nama. Tiap nama membawa item, tahap dan jumlah — itu juga laporan produksinya."
        : "Satu sesi, satu orang. Laporannya dilampirkan setelah lembar dibuat."}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            {isProduction
              ? "Pimpinan menandatangani lembar ini setelah HRD memeriksa jamnya."
              : "Dibayar kecuali HRD memutuskan lain."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={save} disabled={busy || !purpose.trim() || usable.length === 0}>
              {busy ? "Menyimpan…" : `Buat lembar · ${usable.length} nama`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div>
            <label htmlFor="s-date" className="block text-xs text-slate-500">Tanggal kerja</label>
            <input
              id="s-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="s-purpose" className="block text-xs text-slate-500">Kenapa ada lembur</label>
            <input
              id="s-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}
              placeholder={isProduction ? "Kejar kirim meja BABY ISLAND — finishing dan packing." : "Rekap penawaran vendor untuk rapat Senin."}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>

        <Loaded state={people} skeletonRows={3}>
          {(emps) => (
            <Loaded state={orders} skeletonRows={2}>
              {(wos) => (
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 px-3 py-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_90px_auto]">
                        <select
                          value={r.employee_no}
                          onChange={(e) => set(i, { employee_no: e.target.value })}
                          aria-label="Karyawan"
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          <option value="">Pilih karyawan…</option>
                          {emps.map((e) => (
                            <option key={e.employee_no} value={e.employee_no}>
                              {e.full_name} · {e.employee_no}
                            </option>
                          ))}
                        </select>
                        <NumberInput value={r.hours} min={0} max={12} step={0.5} onChange={(v) => set(i, { hours: v })} />
                        {rows.length > 1 && (
                          <Button size="sm" variant="ghost" icon={Trash2}
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                            <span className="sr-only">Hapus baris</span>
                          </Button>
                        )}
                      </div>
                      <input
                        value={r.task} onChange={(e) => set(i, { task: e.target.value })}
                        placeholder={isProduction ? "Finishing meja set ke-3, coating kedua." : "Apa yang dikerjakan dan sampai mana."}
                        className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      {isProduction && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_100px]">
                          <select
                            value={r.wo_no} onChange={(e) => set(i, { wo_no: e.target.value })}
                            aria-label="Pesanan"
                            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          >
                            <option value="">Item / SPK…</option>
                            {wos.map((w) => (
                              <option key={w.wo_no} value={w.wo_no}>
                                {w.item_name} · {w.wo_no} ({formatNumber(w.completed)}/{formatNumber(w.qty)} {w.uom})
                              </option>
                            ))}
                          </select>
                          <select
                            value={r.stage} onChange={(e) => set(i, { stage: e.target.value })}
                            aria-label="Tahap"
                            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          >
                            <option value="">Proses…</option>
                            {/* The stages **of the order chosen on this row**.
                                A subcontracted order has no Pembuatan, and
                                offering it here would produce a sheet the
                                production API refuses on the night leadership
                                signs it — which is the worst possible moment
                                to find out (D254). */}
                            {(wos.find((w) => w.wo_no === r.wo_no)?.stages ?? []).map((s) => (
                              <option key={s.stage} value={s.stage}>{s.seq}. {s.name}</option>
                            ))}
                          </select>
                          <NumberInput value={r.qty_done} min={0} max={9999} onChange={(v) => set(i, { qty_done: v })} />
                        </div>
                      )}
                      {isProduction && r.wo_no && r.stage && r.qty_done > 0 && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Masuk ke papan produksi sebagai {formatNumber(r.qty_done)} unit di tahap {STAGE_NAME(r.stage)} — setelah pimpinan tanda tangan.
                        </p>
                      )}
                    </div>
                  ))}

                  {isProduction && (
                    <Button size="sm" variant="outline" icon={Plus} onClick={() => setRows((rs) => [...rs, blank()])}>
                      Tambah nama
                    </Button>
                  )}
                </div>
              )}
            </Loaded>
          )}
        </Loaded>
      </div>
    </Drawer>
  );
}
