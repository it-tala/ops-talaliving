"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  ADJUSTMENT_LABEL, DAY_MARK_LABEL, OVERTIME_STAGE_LABEL, RETENTION_DEFAULT, TAP_KINDS, TAP_KIND_LABEL,
  type AdjustmentKind, type DayScan, type OvertimePreviewRow, type PersonDayEdits, type TapKind,
} from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { clockFace, minutesOfClock } from "@/services/hr/overtime-clock";
import { officeClock } from "@/lib/office";

const clockOf = (iso: string) => officeClock(new Date(iso));
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
type DayChoice = "unset" | "paid" | "truant" | "absent" | "no_allowance" | "half";

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
  machineOvertime = 0, breakKept = false, edits, onDone,
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
  /** HRD ticked *istirahat tidak dipotong* for this day (D398). */
  breakKept?: boolean;
  edits: PersonDayEdits | null;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const mark = edits?.marks.find((m) => m.work_date === workDate) ?? null;
  const withheld = edits?.withholdings.find((w) => w.work_date === workDate && w.restored_at === null) ?? null;
  const current: DayChoice = mark?.kind === "absent"
    ? (mark.reason.startsWith("Mangkir") ? "truant" : "absent")
    : mark?.kind === "half_day" && noTapSalary ? "half"
      : unconfirmed ? "unset" : withheld ? "no_allowance" : "paid";
  /* 0246 (D398): the taps HRD typed on this day — the only ones it can take
     back — and whether the break is kept. */
  const typed = (edits?.manual_scans ?? []).filter((x) => x.work_date === workDate);
  /* 0253 (D410): every tap of the day, whoever recorded it — each can be
     changed or taken out. An older answer without them lists HRD's own. */
  const dayScans: DayScan[] = edits?.scans
    ? edits.scans.filter((x) => x.work_date === workDate)
    : typed.map((x) => ({ id: x.id, work_date: x.work_date, at: x.at, source: "manual" as const, kind: null, reason: x.reason, edited_from: null }));
  const [editingTap, setEditingTap] = useState<string | null>(null);
  const [tapTime, setTapTime] = useState("");
  const [tapKind, setTapKind] = useState<TapKind | "">("");
  /* 0253: an approved evening opened at its own times to be changed. */
  const [editingSheet, setEditingSheet] = useState<string | null>(null);
  const kept = (edits?.break_kept ?? []).find((x) => x.work_date === workDate) ?? null;
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
    if (liveNight && !editingSheet) return;
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
  }, [otFrom, otUntil, employeeNo, workDate, editingSheet]);
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

  function openOvertime(o: { sheet_no: string; from_minutes?: number | null; until_minutes?: number | null }) {
    setEditingSheet(o.sheet_no);
    setOtFrom(toInput(o.from_minutes));
    setOtUntil(toInput(o.until_minutes));
  }

  async function reviseOvertime() {
    if (!editingSheet) return;
    if (await run(hr.reviseDayOvertime({
      sheet_no: editingSheet, reason: reason.trim(),
      from_minutes: minutesOfClock(otFrom), until_minutes: minutesOfClock(otUntil),
    }), tr(`Overtime changed to ${otHours} h`, `Lembur diubah menjadi ${otHours} jam`))) { setEditingSheet(null); onDone(); }
  }

  async function withdrawOvertime(sheetNo: string) {
    if (await run(hr.withdrawDayOvertime({ sheet_no: sheetNo, reason: reason.trim() }),
      tr("Overtime withdrawn", "Lembur dibatalkan"))) onDone();
  }

  async function toggleBreak() {
    if (await run(hr.keepBreak({ employee_no: employeeNo, work_date: workDate, keep: !kept, reason: reason.trim() }),
      kept ? tr("Break deducted again", "Istirahat dipotong lagi") : tr("Break not deducted", "Istirahat tidak dipotong"))) onDone();
  }

  async function voidTap(id: string, at: string) {
    if (await run(hr.voidScan({ scan_id: id, reason: reason.trim() }),
      tr(`Tap ${at} removed`, `Tap ${at} dihapus`))) onDone();
  }

  function openTap(x: DayScan) {
    setEditingTap(x.id);
    setTapTime(clockOf(x.at));
    setTapKind(x.kind ?? "");
  }

  async function saveTap(id: string) {
    if (await run(hr.editScan({
      scan_id: id, employee_no: employeeNo, work_date: workDate, time: tapTime,
      kind: tapKind === "" ? null : tapKind, reason: reason.trim(),
    }), tr(`Tap changed to ${tapTime}`, `Tap diubah menjadi ${tapTime}`))) { setEditingTap(null); onDone(); }
  }

  async function addTap() {
    if (await run(hr.addScan({ employee_no: employeeNo, work_date: workDate, time, reason: reason.trim() }),
      tr(`Tap ${time} added`, `Tap ${time} ditambahkan`))) { setTime(""); onDone(); }
  }

  async function setStatus() {
    const why = reason.trim();
    /* Undo what the day carries now, then write what was chosen. */
    if ((current === "truant" || current === "absent" || current === "half") && mark) {
      if (!(await run(hr.unmarkDay(mark.id, why), tr("Mark removed", "Tanda dihapus")))) return;
    }
    if (current === "no_allowance" && withheld) {
      if (!(await run(hr.restoreAllowance({ id: withheld.id, reason: why }), tr("Allowance restored", "Tunjangan dikembalikan")))) return;
    }
    if (confirmed && (choice === "truant" || choice === "absent" || choice === "half")) {
      if (!(await run(hr.withdrawPresence({ employee_no: employeeNo, work_date: workDate, reason: why }),
        tr("Confirmation withdrawn", "Konfirmasi hadir dibatalkan")))) return;
    }
    /* A day with no tap is present only when HRD says so (D394). */
    const needsConfirm = (choice === "paid" || choice === "no_allowance")
      && (unconfirmed || (noTapSalary && !confirmed && (current === "truant" || current === "absent" || current === "half")));
    if (needsConfirm) {
      if (!(await run(hr.confirmPresence({ employee_no: employeeNo, dates: [workDate], reason: why }),
        tr("Confirmed present without a tap", "Dikonfirmasi hadir tanpa tap")))) return;
    }
    if (choice === "truant") {
      await run(hr.markDay({ employee_no: employeeNo, work_date: workDate, kind: "absent", reason: `Mangkir — ${why}` }),
        tr("Marked: present but truant, not paid", "Ditandai: hadir tapi mangkir, tidak dibayar"));
    } else if (choice === "half") {
      await run(hr.markDay({ employee_no: employeeNo, work_date: workDate, kind: "half_day", reason: why }),
        tr("Marked: half day, paid 0.5", "Ditandai: setengah hari, dibayar 0,5"));
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
  const otherMark = mark && mark.kind !== "absent" && !(mark.kind === "half_day" && noTapSalary) ? mark : null;
  const options: [DayChoice, string, string][] = noTapSalary ? [
    ["paid", tr("Present without a tap — paid", "Hadir tanpa tap — dibayar"), tr("HRD confirms it; wage and allowance", "dikonfirmasi HRD; upah dan tunjangan")],
    ["no_allowance", tr("Present without a tap — no allowance", "Hadir tanpa tap — tanpa tunjangan"), tr("wage paid, allowance not", "upah dibayar, tunjangan tidak")],
    ["half", tr("Half day — paid 0.5", "Setengah hari — dibayar 0,5"), tr("e.g. an office event for half the day", "mis. acara kantor setengah hari")],
    ["absent", tr("Did not come in — not paid", "Tidak masuk — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
    ["truant", tr("Present but truant — not paid", "Hadir tapi mangkir — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
  ] : [
    ["paid", tr("Present — paid", "Hadir — dibayar"), tr("wage and allowance (default)", "upah dan tunjangan (default)")],
    ["truant", tr("Present but truant — not paid", "Hadir tapi mangkir — tidak dibayar"), tr("no wage, no allowance for the day", "tanpa upah dan tunjangan hari itu")],
    ["no_allowance", tr("Present — no allowance", "Hadir — tanpa tunjangan"), tr("wage paid, allowance not", "upah dibayar, tunjangan tidak")],
  ];

  const SOURCE_LABEL: Record<DayScan["source"], string> = {
    import: tr("machine", "mesin"), self: tr("phone", "HP"), manual: tr("HRD", "HRD"),
  };

  return (
    <div className="space-y-2.5 bg-slate-50 px-3 py-2.5 text-[12px]">
      {/* 0253 (D410): the reason first — every change below needs one, and a
          field at the bottom left every button grey with nothing saying why. */}
      <div>
        <label htmlFor={`why-${workDate}`} className="block text-[11px] font-medium text-slate-600">
          {tr("Reason — needed for every change on this day", "Alasan — wajib untuk setiap perubahan di hari ini")}
        </label>
        <input
          id={`why-${workDate}`} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={tr("e.g. machine read 09.10, came at 08.00 (CCTV)", "mis. mesin terbaca 09.10, datang 08.00 (CCTV)")}
          className="mt-0.5 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
        />
        {!reason.trim() && (
          <p className="mt-0.5 text-[11px] text-amber-700">
            {tr("Buttons below are enabled once a reason is written.", "Tombol di bawah aktif setelah alasan diisi.")}
          </p>
        )}
      </div>

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

      {dayScans.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500">{tr("Taps — change or remove any of them", "Tap — bisa diubah atau dihapus")}</p>
          {dayScans.map((x) => {
            const at = clockOf(x.at);
            if (editingTap === x.id) {
              return (
                <div key={x.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-200 bg-white px-2 py-1.5">
                  <div>
                    <label htmlFor={`tt-${x.id}`} className="block text-[11px] text-slate-500">{tr("Correct time", "Jam yang benar")}</label>
                    <input id={`tt-${x.id}`} type="time" value={tapTime} onChange={(e) => setTapTime(e.target.value)}
                      className="mt-0.5 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] tabular-nums focus:border-brand-400 focus:outline-none" />
                  </div>
                  <div>
                    <label htmlFor={`tk-${x.id}`} className="block text-[11px] text-slate-500">{tr("Kind", "Jenis")}</label>
                    <select id={`tk-${x.id}`} value={tapKind} onChange={(e) => setTapKind(e.target.value as TapKind | "")}
                      className="mt-0.5 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none">
                      <option value="">{tr("By the clock", "Otomatis (menurut jam)")}</option>
                      {TAP_KINDS.map((k) => <option key={k} value={k}>{TAP_KIND_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <Button size="sm" disabled={busy || !tapTime || !reason.trim()} onClick={() => saveTap(x.id)}>
                    {tr("Save", "Simpan")}
                  </Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setEditingTap(null)}>{tr("Cancel", "Batal")}</Button>
                </div>
              );
            }
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums text-slate-700">{at}</span>
                <span className="rounded bg-slate-100 px-1.5 text-[10px] uppercase tracking-wide text-slate-500">{SOURCE_LABEL[x.source]}</span>
                {x.kind && <span className="text-slate-600">{TAP_KIND_LABEL[x.kind]}</span>}
                {x.edited_from && (
                  <span className="text-[11px] text-slate-500">{tr(`was ${clockOf(x.edited_from)}`, `semula ${clockOf(x.edited_from)}`)}</span>
                )}
                {x.source === "manual" && x.reason && <span className="italic text-slate-500">{x.reason}</span>}
                <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => openTap(x)}>
                  {tr("Change", "Ubah")}
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} disabled={busy || !reason.trim()} onClick={() => voidTap(x.id, at)}>
                  {tr("Remove", "Hapus")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* 0246 (D398): the break — lunch, the overtime break, a rest day's lunch. */}
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={!!kept || breakKept} disabled={busy || !reason.trim()} onChange={toggleBreak} className="mt-0.5" />
        <span>
          <span className="font-medium text-slate-700">{tr("Break not deducted", "Istirahat tidak dipotong")}</span>
          <span className="block text-[11px] text-slate-500">
            {kept
              ? <>{tr("Kept: ", "Tidak dipotong: ")}<span className="italic">{kept.reason}</span>{tr(" — untick with a reason to deduct again", " — hapus centang dengan alasan untuk memotong lagi")}</>
              : tr("Worked through the break, or left before it — lunch, the overtime break and a weekend's lunch alike. Reason above.",
                "Bekerja penuh selama istirahat, atau pulang sebelum istirahat — berlaku untuk istirahat siang, istirahat lembur dan istirahat Sabtu/Minggu. Alasan di atas.")}
          </span>
        </span>
      </label>

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
            {o.payable && o.from_minutes != null && o.until_minutes != null && (
              <span className="tabular-nums text-slate-600">{clockFace(o.from_minutes)}–{clockFace(o.until_minutes)}</span>
            )}
            {o.payable && o.kind === "staff" && o.via === "hrd" && editingSheet !== o.sheet_no && (
              <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => openOvertime(o)}>
                {tr("Change times", "Ubah jam")}
              </Button>
            )}
            {o.payable && o.kind === "staff" && o.via === "hrd" && (
              <Button size="sm" variant="ghost" disabled={busy || !reason.trim()} onClick={() => withdrawOvertime(o.sheet_no)}>
                {tr("Withdraw", "Batalkan")}
              </Button>
            )}
          </div>
        ))}
        {liveNight && !liveNight.payable && !editingSheet && (
          <p className="text-[11px] text-amber-700">
            {tr("Still being decided on its sheet — decide it on the Overtime screen.", "Masih diputuskan di lembarnya — putuskan di layar Lembur.")}
          </p>
        )}
        {(!liveNight || editingSheet) && (
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
              {editingSheet ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy || !(otHours > 0) || !reason.trim()} onClick={reviseOvertime}>
                    {tr(`Save change — ${otHours} h`, `Simpan perubahan — ${otHours} jam`)}
                  </Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setEditingSheet(null)}>{tr("Cancel", "Batal")}</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={busy || !(otHours > 0) || !reason.trim()} onClick={approveOvertime}>
                  {tr(`Approve ${otHours} h`, `Setujui ${otHours} jam`)}
                </Button>
              )}
              <span className="text-[11px] text-slate-500">{tr("reason above; added to Additions", "alasan di atas; masuk Penambahan")}</span>
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

      {!otherMark && (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" icon={Pencil} disabled={busy || choice === current || !reason.trim()} onClick={setStatus}>
            {tr("Save status", "Simpan status")}
          </Button>
        </div>
      )}
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
