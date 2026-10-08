"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  ADJUSTMENT_LABEL, DAY_MARK_LABEL, OVERTIME_STAGE_LABEL, RETENTION_DEFAULT,
  type AdjustmentKind, type OvertimePreviewRow, type PersonDayEdits,
} from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { clockFace, minutesOfClock } from "@/services/hr/overtime-clock";
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
type DayChoice = "unset" | "paid" | "truant" | "absent" | "no_allowance";

/** The editor under one day of the drawer's attendance table.
 *
 *  *Default hadir = dibayar = tunjangan.* The other answers are the ones the
 *  system already knows how to keep, with a sentence each: **mangkir** is a
 *  day marked *tidak masuk* (no wage, no allowance — the mark beats the taps,
 *  D142), and **tanpa tunjangan** is the allowance withheld for that day
 *  (D250). A day the machine left incomplete takes the tap it missed.
 *
 *  0242 (D394): a salaried working day with **no tap and no mark** is not
 *  paid until HRD answers it — *hadir tanpa tap* (a confirmation, with the
 *  reason) or *tidak masuk* (a mark). */
export function DayEditor({
  employeeNo, workDate, open, unconfirmed = false, confirmed = false, noTapSalary = false,
  machineOvertime = 0, edits, onDone,
}: {
  employeeNo: string;
  workDate: string;
  /** The machine left this day unread. */
  open: boolean;
  /** A salaried working day with no tap and no mark, not yet answered. */
  unconfirmed?: boolean;
  /** HRD confirmed it as present without a tap. */
  confirmed?: boolean;
  /** A salaried day with no tap at all, answered or not. */
  noTapSalary?: boolean;
  /** Hours past the day on the machine — evidence, never pay (D138). */
  machineOvertime?: number;
  edits: PersonDayEdits | null;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const mark = edits?.marks.find((m) => m.work_date === workDate) ?? null;
  const withheld = edits?.withholdings.find((w) => w.work_date === workDate && w.restored_at === null) ?? null;
  const current: DayChoice = mark?.kind === "absent"
    ? (mark.reason.startsWith("Mangkir") ? "truant" : "absent")
    : unconfirmed ? "unset" : withheld ? "no_allowance" : "paid";
  const [choice, setChoice] = useState<DayChoice>(current);
  const [reason, setReason] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  /* 0243 (D395): this night's overtime on any sheet, and the hours to approve
     — the machine's, until HRD says otherwise. */
  const nights = (edits?.overtime ?? []).filter((o) => o.work_date === workDate);
  const liveNight = nights.find((o) => o.stage !== "declined" && o.stage !== "unpaid") ?? null;
  /* 0244 (D396): approved by the clock — start and finish, the schedule's
     end and the last tap until HRD says otherwise — with the ranges and the
     money shown before anything is written. */
  const toInput = (m: number | null | undefined) => (m == null ? "" : clockFace(m % 1440).replace(".", ":"));
  const [otFrom, setOtFrom] = useState("");
  const [otUntil, setOtUntil] = useState("");
  const [preview, setPreview] = useState<OvertimePreviewRow[]>([]);
  useEffect(() => {
    if (liveNight) return;
    let gone = false;
    const from = minutesOfClock(otFrom);
    const until = minutesOfClock(otUntil);
    void hr.overtimePreview({ employee_no: employeeNo, work_date: workDate, from_minutes: from, until_minutes: until })
      .then((res) => {
        if (gone || res.error) return;
        setPreview(res.data);
        const first = res.data[0];
        if (first && !otFrom && first.from_minutes != null) setOtFrom(toInput(first.from_minutes));
        if (first && !otUntil && first.until_minutes != null) setOtUntil(toInput(first.until_minutes));
      });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otFrom, otUntil, employeeNo, workDate]);
  const ranges = preview.filter((r) => r.seg_from != null && r.hours != null);
  const otHours = Math.round(ranges.reduce((t, r) => t + (r.hours ?? 0), 0) * 100) / 100;
  const otAmount = ranges.reduce((t, r) => t + (r.amount ?? 0), 0);

  async function run(p: Promise<{ error?: { message: string } | null }>, done: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return false; }
    toast("success", done);
    return true;
  }

  async function approveOvertime() {
    if (await run(hr.approveDayOvertime({
      employee_no: employeeNo, work_date: workDate, reason: reason.trim(),
      from_minutes: minutesOfClock(otFrom), until_minutes: minutesOfClock(otUntil),
    }), tr(`${otHours} h overtime approved`, `Lembur ${otHours} jam disetujui`))) onDone();
  }

  async function withdrawOvertime(sheetNo: string) {
    if (await run(hr.withdrawDayOvertime({ sheet_no: sheetNo, reason: reason.trim() }),
      tr("Overtime withdrawn", "Lembur dibatalkan"))) onDone();
  }

  async function addTap() {
    if (await run(hr.addScan({ employee_no: employeeNo, work_date: workDate, time, reason: reason.trim() }),
      tr(`Tap ${time} added`, `Tap ${time} ditambahkan`))) { setTime(""); onDone(); }
  }

  async function setStatus() {
    const why = reason.trim();
    /* Undo what the day carries now, then write what was chosen. */
    if ((current === "truant" || current === "absent") && mark) {
      if (!(await run(hr.unmarkDay(mark.id, why), tr("Mark removed", "Tanda dihapus")))) return;
    }
    if (current === "no_allowance" && withheld) {
      if (!(await run(hr.restoreAllowance({ id: withheld.id, reason: why }), tr("Allowance restored", "Tunjangan dikembalikan")))) return;
    }
    if (confirmed && (choice === "truant" || choice === "absent")) {
      if (!(await run(hr.withdrawPresence({ employee_no: employeeNo, work_date: workDate, reason: why }),
        tr("Confirmation withdrawn", "Konfirmasi hadir dibatalkan")))) return;
    }
    /* A day with no tap is present only when HRD says so (D394). */
    const needsConfirm = (choice === "paid" || choice === "no_allowance")
      && (unconfirmed || (noTapSalary && !confirmed && (current === "truant" || current === "absent")));
    if (needsConfirm) {
      if (!(await run(hr.confirmPresence({ employee_no: employeeNo, dates: [workDate], reason: why }),
        tr("Confirmed present without a tap", "Dikonfirmasi hadir tanpa tap")))) return;
    }
    if (choice === "truant") {
      await run(hr.markDay({ employee_no: employeeNo, work_date: workDate, kind: "absent", reason: `Mangkir — ${why}` }),
        tr("Marked: present but truant, not paid", "Ditandai: hadir tapi mangkir, tidak dibayar"));
    } else if (choice === "absent") {
      await run(hr.markDay({ employee_no: employeeNo, work_date: workDate, kind: "absent", reason: why }),
        tr("Marked: absent, not paid", "Ditandai: tidak masuk, tidak dibayar"));
    } else if (choice === "no_allowance") {
      await run(hr.withholdAllowance({ employee_no: employeeNo, work_date: workDate, reason: why }),
        tr("Allowance withheld for this day", "Tunjangan hari ini tidak dibayar"));
    }
    onDone();
  }

  /* A mark other than tidak masuk (sakit, cuti, tanggal merah…) is changed
     where it was made; the drawer only says so. */
  const otherMark = mark && mark.kind !== "absent" ? mark : null;
  const options: [DayChoice, string, string][] = noTapSalary ? [
    ["paid", tr("Present without a tap — paid", "Hadir tanpa tap — dibayar"), tr("HRD confirms it; wage and allowance", "dikonfirmasi HRD; upah dan tunjangan")],
    ["no_allowance", tr("Present without a tap — no allowance", "Hadir tanpa tap — tanpa tunjangan"), tr("wage paid, allowance not", "upah dibayar, tunjangan tidak")],
    ["absent", tr("Did not come in — not paid", "Tidak masuk — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
    ["truant", tr("Present but truant — not paid", "Hadir tapi mangkir — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
  ] : [
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

      {/* Lembur (D395): approved here with the reason, it is paid and lands in Penambahan. */}
      <div className="space-y-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
        <p className="text-[11px] text-slate-500">
          {tr("Overtime", "Lembur")}
          {machineOvertime > 0 && <> · {tr(`machine ${machineOvertime} h`, `mesin ${machineOvertime} jam`)}</>}
        </p>
        {nights.map((o) => (
          <div key={o.sheet_no} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-medium", o.payable ? "text-emerald-700" : "text-slate-500")}>
              {tr(`${o.hours} h`, `${o.hours} jam`)} · {OVERTIME_STAGE_LABEL[o.stage]}
            </span>
            <span className="font-mono text-[11px] text-slate-400">{o.sheet_no}</span>
            {o.reason && <span className="italic text-slate-600">{o.reason}</span>}
            {o.payable && o.kind === "staff" && o.via === "hrd" && (
              <Button size="sm" variant="ghost" disabled={busy || !reason.trim()} onClick={() => withdrawOvertime(o.sheet_no)}>
                {tr("Withdraw", "Batalkan")}
              </Button>
            )}
          </div>
        ))}
        {liveNight && !liveNight.payable && (
          <p className="text-[11px] text-amber-700">
            {tr("Still being decided on its sheet — decide it on the Overtime screen.", "Masih diputuskan di lembarnya — putuskan di layar Lembur.")}
          </p>
        )}
        {!liveNight && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={`otf-${workDate}`} className="block text-[11px] text-slate-500">{tr("Start", "Mulai")}</label>
                <input id={`otf-${workDate}`} type="time" value={otFrom} onChange={(e) => setOtFrom(e.target.value)}
                  className="mt-0.5 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] tabular-nums focus:border-brand-400 focus:outline-none" />
              </div>
              <div>
                <label htmlFor={`otu-${workDate}`} className="block text-[11px] text-slate-500">{tr("Finish", "Selesai")}</label>
                <input id={`otu-${workDate}`} type="time" value={otUntil} onChange={(e) => setOtUntil(e.target.value)}
                  className="mt-0.5 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] tabular-nums focus:border-brand-400 focus:outline-none" />
              </div>
              <Button size="sm" variant="outline" disabled={busy || !(otHours > 0) || !reason.trim()} onClick={approveOvertime}>
                {tr(`Approve ${otHours} h`, `Setujui ${otHours} jam`)}
              </Button>
              <span className="text-[11px] text-slate-500">{tr("reason below; added to Additions", "alasan di bawah; masuk Penambahan")}</span>
            </div>
            {ranges.length > 0 && (
              <table className="w-full text-[11px] tabular-nums">
                <tbody>
                  {ranges.map((r, i) => (
                    <tr key={i} className="text-slate-600">
                      <td className="py-0.5">{clockFace(r.seg_from!)}–{clockFace(r.seg_until!)}</td>
                      <td className="text-right">{tr(`${r.hours} h`, `${String(r.hours).replace(".", ",")} jam`)}</td>
                      <td className="text-right">{r.multiplier}×</td>
                      <td className="text-right">{formatIDR(Math.round(r.hourly * (r.multiplier ?? 0)))}/{tr("h", "jam")}</td>
                      <td className="text-right font-medium text-slate-800">{formatIDR(r.amount ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-100 font-medium text-slate-800">
                    <td className="py-0.5">{tr("Total", "Jumlah")}</td>
                    <td className="text-right">{tr(`${otHours} h`, `${String(otHours).replace(".", ",")} jam`)}</td>
                    <td colSpan={2} />
                    <td className="text-right">{formatIDR(otAmount)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {ranges.length === 0 && otFrom && otUntil && (
              <p className="text-[11px] text-slate-500">{tr("Nothing to pay in that window.", "Tidak ada jam lembur yang dibayar di rentang itu.")}</p>
            )}
          </>
        )}
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
          {unconfirmed && (
            <p className="text-[11px] font-medium text-amber-700">
              {tr("No tap and no mark — not paid until you choose.", "Tanpa tap dan tanpa keterangan — belum dibayar sampai dipilih.")}
            </p>
          )}
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

/** Every unanswered no-tap day of one person, confirmed at once (D394) — for a
 *  gap the machine left in its file, which is a fact about the machine, not
 *  about each day. One reason for all of them. */
export function ConfirmAll({ employeeNo, dates, onDone }: {
  employeeNo: string; dates: string[]; onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const short = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

  async function confirm() {
    setBusy(true);
    const res = await hr.confirmPresence({ employee_no: employeeNo, dates, reason: reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`${dates.length} day(s) confirmed present`, `${dates.length} hari dikonfirmasi hadir`));
    setReason("");
    onDone();
  }

  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900">
      <p>
        {tr(`${dates.length} working day(s) with no tap and no mark: `, `${dates.length} hari kerja tanpa tap dan tanpa keterangan: `)}
        <span className="font-medium tabular-nums">{dates.map(short).join(", ")}</span>.{" "}
        {tr("Not paid until answered — per day with the pencil, or all at once:", "Belum dibayar sampai dijawab — per hari lewat pensil, atau sekaligus:")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={reason} onChange={(e) => setReason(e.target.value)}
          aria-label={tr("Reason for confirming", "Alasan konfirmasi")}
          placeholder={tr("Reason — e.g. machine file missing these days", "Alasan — mis. file mesin tidak memuat hari-hari ini")}
          className="h-8 min-w-[220px] flex-1 rounded-lg border border-amber-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
        />
        <Button size="sm" disabled={busy || !reason.trim()} onClick={confirm}>
          {tr(`Confirm all ${dates.length} present`, `Konfirmasi hadir semua (${dates.length})`)}
        </Button>
      </div>
    </div>
  );
}
