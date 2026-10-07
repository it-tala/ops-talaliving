"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  ADJUSTMENT_LABEL, DAY_MARK_LABEL, RETENTION_DEFAULT,
  type AdjustmentKind, type PersonDayEdits,
} from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** What the payroll drawer can change (D388).
 *
 *  Owner: *di kolom additions tambahkan bonus yang nilainya bebas di input
 *  beserta alasan, lalu others; di deductions tambahkan RETENTION default
 *  500.000, sama — nilai, catatan, lalu others.* And: *pastikan attendance day
 *  by day bisa di edit — input absensi yang belum lengkap, atau hadir namun
 *  mangkir sehingga HRD bisa memilih tidak membayarkan; default hadir =
 *  dibayar = tunjangan.*
 *
 *  Both editors are the same on the generate sheet and on a draft run; only
 *  where an adjustment is kept differs, so that is the caller's (`AdjustEditor`).
 */

/** One adjustment the drawer lists, with the key it is removed by. */
export interface EditableAdjustment {
  key: string;
  kind: AdjustmentKind;
  /** Signed. */
  amount: number;
  reason: string;
}

/** Where a person's adjustments live: in the sheet's memory before the run
 *  exists, or on the run. Each call answers an error sentence, or null. */
export interface AdjustEditor {
  list: (employeeNo: string) => EditableAdjustment[];
  add: (employeeNo: string, a: { kind: AdjustmentKind; amount: number; reason: string }) => Promise<string | null>;
  remove: (employeeNo: string, key: string) => Promise<string | null>;
}

/** The kinds each column offers. Retensi starts at 500.000; nothing else
 *  starts anywhere — the number is typed. */
const ADDS: AdjustmentKind[] = ["bonus", "other", "retention_release"];
const TAKES: AdjustmentKind[] = ["retention", "bpjs_tk", "bpjs_kes", "other"];

export function AdjustSection({
  side, employeeNo, editor,
}: {
  side: "add" | "take";
  employeeNo: string;
  editor: AdjustEditor;
}) {
  const tr = useTr();
  const [kind, setKind] = useState<AdjustmentKind | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = editor.list(employeeNo).filter((a) => (side === "add" ? a.amount > 0 : a.amount < 0));
  const kinds = side === "add" ? ADDS : TAKES;

  function start(k: AdjustmentKind) {
    setKind(k); setAmount(k === "retention" ? RETENTION_DEFAULT : 0); setReason(""); setErr(null);
  }

  async function save() {
    if (!kind) return;
    setBusy(true);
    const e = await editor.add(employeeNo, {
      kind, amount: side === "add" ? Math.abs(amount) : -Math.abs(amount), reason: reason.trim(),
    });
    setBusy(false);
    if (e) { setErr(e); return; }
    setKind(null);
  }

  async function drop(key: string) {
    setBusy(true);
    const e = await editor.remove(employeeNo, key);
    setBusy(false);
    if (e) setErr(e);
  }

  const tone = side === "add" ? "text-emerald-700" : "text-rose-700";
  return (
    <>
      {rows.map((a) => (
        <div key={a.key} className="flex items-start justify-between gap-3 py-1">
          <span className="text-slate-600">
            {ADJUSTMENT_LABEL[a.kind]}
            <span className="block text-[11px] text-slate-400">{a.reason}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("whitespace-nowrap tabular-nums", tone)}>
              {side === "add" ? formatIDR(a.amount) : `(${formatIDR(-a.amount)})`}
            </span>
            <button
              type="button" disabled={busy} onClick={() => drop(a.key)}
              aria-label={tr(`Remove ${ADJUSTMENT_LABEL[a.kind]}`, `Hapus ${ADJUSTMENT_LABEL[a.kind]}`)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ))}

      {kind ? (
        <div className="my-1.5 space-y-2 rounded-lg bg-slate-50 p-2.5">
          <p className="text-[12px] font-medium text-slate-700">
            {side === "add" ? "+ " : "− "}{ADJUSTMENT_LABEL[kind]}
          </p>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
            <MoneyInput id={`adj-${side}-amount`} value={amount} onChange={setAmount} />
            <input
              id={`adj-${side}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={kind === "bonus"
                ? tr("Why the bonus — printed on the payslip", "Alasan bonus — tercetak di slip")
                : kind === "retention"
                  ? tr("Why it is held back", "Alasan retensi")
                  : tr("What it is for — printed on the payslip", "Untuk apa — tercetak di slip")}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          {err && <p className="text-[11px] text-rose-700">{err}</p>}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" icon={X} onClick={() => setKind(null)}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" disabled={busy || amount <= 0 || !reason.trim()} onClick={save}>
              {busy ? tr("Saving…", "Menyimpan…") : tr("Add", "Tambahkan")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 py-1.5">
          {kinds.map((k) => (
            <Button key={k} size="sm" variant="outline" icon={Plus} onClick={() => start(k)}>
              {ADJUSTMENT_LABEL[k]}
            </Button>
          ))}
          {err && <p className="w-full text-[11px] text-rose-700">{err}</p>}
        </div>
      )}
    </>
  );
}

/** One day's status, as HRD can set it from the drawer. */
type DayChoice = "paid" | "truant" | "no_allowance";

/** The editor under one day of the drawer's attendance table.
 *
 *  *Default hadir = dibayar = tunjangan.* The two other answers are the ones
 *  the system already knows how to keep, with a sentence each: **mangkir** is a
 *  day marked *tidak masuk* (no wage, no allowance — the mark beats the taps,
 *  D142), and **tanpa tunjangan** is the allowance withheld for that day
 *  (D250). A day the machine left incomplete takes the tap it missed. */
export function DayEditor({
  employeeNo, workDate, open, edits, onDone,
}: {
  employeeNo: string;
  workDate: string;
  /** The machine left this day unread. */
  open: boolean;
  edits: PersonDayEdits | null;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const mark = edits?.marks.find((m) => m.work_date === workDate) ?? null;
  const withheld = edits?.withholdings.find((w) => w.work_date === workDate && w.restored_at === null) ?? null;
  const current: DayChoice = mark?.kind === "absent" ? "truant" : withheld ? "no_allowance" : "paid";
  const [choice, setChoice] = useState<DayChoice>(current);
  const [reason, setReason] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(p: Promise<{ error?: { message: string } | null }>, done: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return false; }
    toast("success", done);
    return true;
  }

  async function addTap() {
    if (await run(hr.addScan({ employee_no: employeeNo, work_date: workDate, time, reason: reason.trim() }),
      tr(`Tap ${time} added`, `Tap ${time} ditambahkan`))) { setTime(""); onDone(); }
  }

  async function setStatus() {
    const why = reason.trim();
    /* Undo what the day carries now, then write what was chosen. */
    if (current === "truant" && mark) {
      if (!(await run(hr.unmarkDay(mark.id, why), tr("Mark removed", "Tanda dihapus")))) return;
    }
    if (current === "no_allowance" && withheld) {
      if (!(await run(hr.restoreAllowance({ id: withheld.id, reason: why }), tr("Allowance restored", "Tunjangan dikembalikan")))) return;
    }
    if (choice === "truant") {
      await run(hr.markDay({ employee_no: employeeNo, work_date: workDate, kind: "absent", reason: `Mangkir — ${why}` }),
        tr("Marked: present but truant, not paid", "Ditandai: hadir tapi mangkir, tidak dibayar"));
    } else if (choice === "no_allowance") {
      await run(hr.withholdAllowance({ employee_no: employeeNo, work_date: workDate, reason: why }),
        tr("Allowance withheld for this day", "Tunjangan hari ini tidak dibayar"));
    }
    onDone();
  }

  /* A mark other than mangkir (sakit, cuti, tanggal merah…) is changed where it
     was made; the drawer only says so. */
  const otherMark = mark && mark.kind !== "absent" ? mark : null;
  const options: [DayChoice, string, string][] = [
    ["paid", tr("Present — paid", "Hadir — dibayar"), tr("wage and allowance (default)", "upah dan tunjangan (default)")],
    ["truant", tr("Present but truant — not paid", "Hadir tapi mangkir — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
    ["no_allowance", tr("Present — no allowance", "Hadir — tanpa tunjangan"), tr("wage paid, allowance not", "upah dibayar, tunjangan tidak")],
  ];

  return (
    <div className="space-y-2.5 bg-slate-50 px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`tap-${workDate}`} className="block text-[11px] text-slate-500">
            {open ? tr("Tap the machine missed", "Tap yang terlewat") : tr("Add a tap", "Tambah tap")}
          </label>
          <input id={`tap-${workDate}`} type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="mt-0.5 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none" />
        </div>
        <Button size="sm" variant="outline" disabled={busy || !time || !reason.trim()} onClick={addTap}>
          {tr("Add tap", "Tambah tap")}
        </Button>
      </div>

      {otherMark ? (
        <p className="text-slate-600">
          {tr(`Marked ${DAY_MARK_LABEL[otherMark.kind]}: `, `Ditandai ${DAY_MARK_LABEL[otherMark.kind]}: `)}
          <span className="italic">{otherMark.reason}</span>
          {" — "}{tr("change it on the attendance screen.", "ubah di layar absensi.")}
        </p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="text-[11px] text-slate-500">{tr("This day is", "Hari ini")}</legend>
          {options.map(([v, label, note]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name={`day-${workDate}`} checked={choice === v} onChange={() => setChoice(v)} className="mt-0.5" />
              <span>
                <span className={cn("font-medium", v === "paid" ? "text-emerald-700" : "text-rose-700")}>{label}</span>
                <span className="block text-[11px] text-slate-500">{note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          value={reason} onChange={(e) => setReason(e.target.value)}
          aria-label={tr("Reason", "Alasan")}
          placeholder={tr("Reason — kept with the change", "Alasan — disimpan bersama perubahannya")}
          className="h-8 min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
        />
        {!otherMark && (
          <Button size="sm" icon={Pencil} disabled={busy || choice === current || !reason.trim()} onClick={setStatus}>
            {tr("Save status", "Simpan status")}
          </Button>
        )}
      </div>
    </div>
  );
}
