"use client";

import { useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { CashflowCell, CashflowRow, CashflowWeek } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { dayLabel, weekLabel } from "./shared";
import { field, labelCls } from "./LineDrawer";

/** One week of one line, different from its schedule — with a reason, because
 *  a changed week nobody can explain is the first thing to be doubted. */
export function WeekDialog({
  row, week, cell, onClose, onSaved,
}: { row: CashflowRow; week: CashflowWeek; cell: CashflowCell; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [skip, setSkip] = useState(cell.state === "SKIPPED");
  const [amount, setAmount] = useState(cell.planned);
  const [reason, setReason] = useState(cell.reason ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await accounting.setCashflowWeek({
      line_id: row.line.id || null, source_ref: row.line.id ? null : row.key, name: row.line.name,
      week_start: week.start, amount: skip ? null : amount, reason,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Week changed", "Minggu diubah"), `${row.line.name} · ${weekLabel(week.start, week.end)}`);
    onSaved();
  }
  async function reset() {
    setBusy(true);
    const res = await accounting.clearCashflowWeek(row.line.id, week.start);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak diubah"), res.error.message); return; }
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-md"
      title={`${row.line.name}`}
      subtitle={`${tr(`Week ${week.n}`, `Minggu ${week.n}`)} · ${weekLabel(week.start, week.end)} ${week.start.slice(0, 4)}`}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {cell.overridden && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset} disabled={busy}>{tr("Back to schedule", "Kembali ke jadwal")}</Button>}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Save} onClick={save} disabled={busy || !reason.trim()}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-[12px]">
          <div><dt className="text-slate-500">{tr("Projected", "Proyeksi")}</dt><dd className="font-semibold tabular-nums">{formatIDR(cell.planned)}</dd></div>
          <div><dt className="text-slate-500">{tr("Actual", "Aktual")}</dt><dd className="font-semibold tabular-nums">{formatIDR(cell.actual)}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500">{tr("Due in this week", "Jatuh tempo di minggu ini")}</dt>
            <dd>{cell.dates.length ? cell.dates.map(dayLabel).join(", ") : tr("nothing scheduled", "tidak ada jadwal")}</dd></div>
          {cell.trx_nos.length > 0 && <div className="col-span-2"><dt className="text-slate-500">{tr("Ledger rows", "Baris ledger")}</dt><dd className="break-all">{cell.trx_nos.join(", ")}</dd></div>}
        </dl>

        <div className="flex gap-2">
          <Button size="sm" variant={!skip ? "primary" : "outline"} onClick={() => setSkip(false)}>{tr("A different amount", "Nominal lain")}</Button>
          <Button size="sm" variant={skip ? "primary" : "outline"} onClick={() => setSkip(true)}>{tr("Not this week", "Tidak minggu ini")}</Button>
        </div>
        {!skip && (
          <div>
            <label className={labelCls}>{tr("This week's total for the line", "Total baris ini di minggu ini")}</label>
            <MoneyInput value={amount} onChange={setAmount} className="mt-1" />
          </div>
        )}
        <div>
          <label htmlFor="wk-reason" className={labelCls}>{tr("Why this week is different", "Kenapa minggu ini berbeda")}</label>
          <input id="wk-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={field}
            placeholder={tr("e.g. the client asked to move the termin", "mis. klien minta termin dimundurkan")} />
        </div>
        <p className="text-[11px] text-slate-500">
          {tr("Only the cashflow changes. A bill on the payment calendar stays as it is for accounting.",
            "Hanya cashflow yang berubah. Tagihan di kalender pembayaran tetap seperti semula untuk akuntansi.")}
        </p>
      </div>
    </Drawer>
  );
}
