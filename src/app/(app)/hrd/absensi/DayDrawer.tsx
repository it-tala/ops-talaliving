"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Flag, Plus, Clock, Undo2, Paperclip, Wallet, Moon } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatNumber } from "@/lib/format";
import { officeClock, officeDay } from "@/lib/office";
import { cn } from "@/lib/cn";
import { documents, hr } from "@/demo/api";
import {
  SCAN_SLOTS, SLOT_LABEL, DAY_MARK_LABEL,
  type DayMarkKind, type ScanSlot,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { instantInDay } from "@/services/hr/schedule-rules";
import { TapWhereLine } from "@/components/attendance/located-tap";
import { actualHours } from "@/services/hr/on-site";

/** A tap's office calendar day and clock face, from the instant rather than
 *  from the string's own offset, so a night's morning tap can say it is
 *  *tomorrow* whichever zone the row arrived in (F17). The zone is
 *  `src/lib/office.ts`'s (WIB since D334), not a number written here. */
function tapDay(iso: string): string {
  return officeDay(Date.parse(iso));
}
function tapClock(iso: string): string {
  return officeClock(Date.parse(iso));
}

/** One person, one day, and everything that is known about it.
 *
 *  The six slots are shown whether or not the machine filled them, because the
 *  hole is the point: a day with no *istirahat masuk* is not a day with three
 *  taps, it is a day where somebody has to say what happened between noon and
 *  one. Taps the rule could not place are listed underneath, unexplained and
 *  visible, rather than quietly dropped.
 *
 *  Two ways out of a `review` day, and both are acts with a name on them:
 *  type the tap the machine missed, with a reason (D137), or mark the day for
 *  what it actually was — sick, half day, tanggal merah (D142).
 */
export function DayDrawer({
  employeeNo, workDate, onClose, onChanged,
}: {
  employeeNo: string;
  workDate: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [day, reload] = useLoad(() => hr.getDay({ employee_no: employeeNo, work_date: workDate }), [employeeNo, workDate]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState("");
  const [addReason, setAddReason] = useState("");
  const [kind, setKind] = useState<DayMarkKind | null>(null);
  const [markReason, setMarkReason] = useState("");
  const [claiming, setClaiming] = useState(false);
  const suratRef = useRef<HTMLInputElement>(null);
  const [otHours, setOtHours] = useState(0);
  const [otReason, setOtReason] = useState("");
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  /* Taking a mark back needs a sentence, because the mark is withdrawn rather
     than deleted and the sentence is what the next person reads (C19). */
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const [holds, reloadHolds] = useLoad(
    () => hr.listWithholdings({ employee_no: employeeNo, from: workDate, to: workDate }),
    [employeeNo, workDate],
  );

  const mayEdit = can("hrd.update");
  const mayClaim = can("hrd.create");

  function after(kindOf: string, message: string) {
    toast("success", kindOf, message);
    reload();
    onChanged();
  }

  async function addScan() {
    setBusy(true);
    const res = await hr.addScan({ employee_no: employeeNo, work_date: workDate, time, reason: addReason });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not added", "Tidak ditambahkan"), res.error.message); return; }
    setAdding(false); setTime(""); setAddReason("");
    after(tr("Tap added", "Tap ditambahkan"), tr(`${workDate} · ${time} · typed by hand, with a reason on the audit row.`, `${workDate} · ${time} · diketik manual, dengan alasan di baris audit.`));
  }

  async function mark() {
    if (!kind) return;
    setBusy(true);
    const res = await hr.markDay({ work_date: workDate, kind, reason: markReason, employee_no: employeeNo });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not marked", "Tidak ditandai"), res.error.message); return; }
    setKind(null); setMarkReason("");
    after(tr("Day marked", "Hari ditandai"), `${workDate} · ${DAY_MARK_LABEL[res.data.kind]}`);
  }

  async function unmark(markId: string) {
    setBusy(true);
    const res = await hr.unmarkDay(markId, undoReason);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    setUndoing(false); setUndoReason("");
    after(tr("Mark withdrawn", "Tanda ditarik"), tr(`${workDate} is back to what the machine recorded.`, `${workDate} kembali ke yang direkam mesin.`));
  }

  /* HRD deciding the day earns no tunjangan, and saying why. A separate act
     from marking the day (D250): WFH is a worked day with a right timesheet
     and no allowance, and making the mark carry that would falsify the day to
     get the money right. */
  async function hold() {
    setBusy(true);
    const res = await hr.withholdAllowance({
      employee_no: employeeNo, work_date: workDate, reason: holdReason,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    setHoldOpen(false); setHoldReason("");
    reloadHolds();
    after(tr("Allowance withheld", "Tunjangan ditahan"), `${workDate} · ${res.data.reason}`);
  }

  async function release(id: string) {
    const why = window.prompt(tr("Why is it being restored? Usually because the first one was misread.", "Kenapa dikembalikan? Biasanya karena yang pertama salah baca."));
    if (!why?.trim()) return;
    setBusy(true);
    const res = await hr.restoreAllowance({ id, reason: why });
    setBusy(false);
    if (res.error) { toast("warning", tr("Could not be restored", "Tidak bisa dikembalikan"), res.error.message); return; }
    reloadHolds();
    after(tr("Allowance restored", "Tunjangan dikembalikan"), res.data.restored_reason ?? "");
  }

  /** The surat dokter is what turns a sick day into a paid one (D144), so it
   *  is attached from the day it belongs to — the same road as every other
   *  document here. */
  async function attachSurat(f: File, markId: string) {
    setBusy(true);
    const up = await documents.upload({ file: f, kind: "Surat Dokter" });
    if (up.error) { setBusy(false); toast("critical", tr("Upload failed", "Upload gagal"), up.error.message); return; }
    const res = await hr.attachSuratDokter({ mark_id: markId, attachment_id: up.data.id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not attached", "Tidak terlampir"), res.error.message); return; }
    after(tr("Doctor’s note attached", "Surat dokter terlampir"), tr("This day now counts as paid.", "Hari ini sekarang terhitung dibayar."));
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-xl"
      title={day.status === "ready" ? day.data.full_name : employeeNo}
      subtitle={`${workDate} · ${employeeNo}`}
    >
      <Loaded state={day} onRetry={reload}>
        {(d) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {d.state === "complete" && <Badge tone="green" dot>{tr("read cleanly", "terbaca bersih")}</Badge>}
              {d.state === "review" && <Badge tone="amber" dot>{tr("needs reading", "perlu dibaca")}</Badge>}
              {d.state === "marked" && <Badge tone="violet" dot>{DAY_MARK_LABEL[d.mark!.kind]}</Badge>}
              {d.state === "off" && <Badge tone="slate" dot>{tr("no tap at all", "tidak ada tap sama sekali")}</Badge>}
              <span className="text-[12px] text-slate-500">
                {tr(`${formatNumber(d.work_hours)} h paid`, `${formatNumber(d.work_hours)} jam dibayar`)}
                {/* Hours actually worked beside hours paid (D354, D362): first tap to
                    last, less the break. */}
                {actualHours(d) != null && tr(
                  ` · ${formatNumber(actualHours(d)!)} h actually worked (${officeClock(new Date(d.scans[0].at))}–${officeClock(new Date(d.scans[d.scans.length - 1].at))}, less ${formatNumber(d.break_hours)} h break)`,
                  ` · ${formatNumber(actualHours(d)!)} jam kerja aktual (${officeClock(new Date(d.scans[0].at))}–${officeClock(new Date(d.scans[d.scans.length - 1].at))}, dikurangi istirahat ${formatNumber(d.break_hours)} jam)`,
                )}
                {actualHours(d) == null && d.break_hours > 0 && tr(` · ${formatNumber(d.break_hours)} h break`, ` · ${formatNumber(d.break_hours)} jam istirahat`)}
                {d.overtime_hours > 0 && tr(` · ${formatNumber(d.overtime_hours)} h overtime`, ` · ${formatNumber(d.overtime_hours)} jam lembur`)}
                {tr(` · day value ${formatNumber(d.day_value)}`, ` · nilai hari ${formatNumber(d.day_value)}`)}
              </span>
            </div>

            {/* What this day is worth on a payslip, and why — the question an
                employee asks, answered where HRD can see it too (D144). */}
            <div className={cn(
              "rounded-xl border px-4 py-3",
              d.day_value > 0 ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-slate-50",
            )}>
              <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                <Wallet className="h-4 w-4 text-slate-400" />
                {tr("Value for payroll:", "Nilai untuk payroll:")} <strong className="tabular-nums">{tr(`${formatNumber(d.day_value)} days`, `${formatNumber(d.day_value)} hari`)}</strong>
              </p>
              <p className="mt-0.5 text-[12px] text-slate-600">{d.pay.why}</p>
              {d.pay.fixable && (
                <p className="mt-1 text-[12px] text-amber-800">{d.pay.fixable}</p>
              )}
              {mayEdit && d.mark?.kind === "sick" && d.day_value === 0 && (
                <>
                  <input
                    ref={suratRef} type="file" className="hidden" accept="image/*,application/pdf"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachSurat(f, d.mark!.id); }}
                  />
                  <Button size="sm" variant="outline" icon={Paperclip} className="mt-2" disabled={busy}
                    onClick={() => suratRef.current?.click()}>
                    {tr("Attach doctor’s note", "Lampirkan surat dokter")}
                  </Button>
                </>
              )}
            </div>

            {d.mark && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-violet-900">
                  {DAY_MARK_LABEL[d.mark.kind]}
                  {d.mark.employee_id === null && <span className="ml-2 font-normal">— {tr("whole office", "seluruh kantor")}</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-violet-900">{d.mark.reason}</p>
                {d.mark.kind === "holiday" && (
                  <p className="mt-1 text-[11px] text-violet-800">
                    {tr(
                      "Public holiday: hours on this day count as overtime, and the day itself adds nothing to the days worked.",
                      "Tanggal merah: jam pada hari ini dihitung lembur, dan hari itu sendiri tidak menambah hari kerja.",
                    )}
                  </p>
                )}
                {d.mark.kind === "half_day" && (
                  <p className="mt-1 text-[11px] text-violet-800">{tr("Half day: payroll counts this as 0.5 day.", "Setengah hari: payroll menghitung ini 0,5 hari.")}</p>
                )}
                {d.mark.kind === "sick" && d.day_value > 0 && (
                  <p className="mt-1 text-[11px] text-violet-800">{tr("Doctor’s note attached — this day is paid in full.", "Surat dokter sudah dilampirkan — hari ini dibayar penuh.")}</p>
                )}
                {mayEdit && d.mark.employee_id !== null && !undoing && (
                  <Button size="sm" variant="ghost" icon={Undo2} className="mt-2" disabled={busy}
                    onClick={() => setUndoing(true)}>
                    {tr("Withdraw this mark", "Tarik tanda ini")}
                  </Button>
                )}
                {mayEdit && d.mark.employee_id !== null && undoing && (
                  <div className="mt-2">
                    <input
                      value={undoReason} onChange={(e) => setUndoReason(e.target.value)}
                      placeholder={tr("Why it is withdrawn — wrong person, wrong date, the note turned up…", "Kenapa ditarik — salah orang, salah tanggal, suratnya ternyata ada…")}
                      className="h-9 w-full rounded-lg border border-violet-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-violet-800">
                      {tr("The mark stays on record. What the next person reads is the reason.", "Tandanya tetap tercatat. Yang dibaca orang berikutnya adalah alasannya.")}
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" disabled={busy}
                        onClick={() => { setUndoing(false); setUndoReason(""); }}>
                        {tr("Cancel", "Batal")}
                      </Button>
                      <Button size="sm" icon={Undo2} disabled={busy || !undoReason.trim()}
                        onClick={() => unmark(d.mark!.id)}>
                        {tr("Withdraw", "Tarik")}
                      </Button>
                    </div>
                  </div>
                )}
                {d.mark.employee_id === null && (
                  <p className="mt-2 text-[11px] text-violet-800">
                    {tr("Marked for everybody — remove it from the date header on the timesheet.", "Ditandai untuk semua orang — hapus dari judul tanggal di absensi.")}
                  </p>
                )}
              </div>
            )}

            {/* A night reads into the next morning (D330). Said here, because a
                pulang at 07.05 on a day dated the evening before otherwise looks
                like a typo — and because the window is exactly where the reading
                drew its line, not a rule the screen worked out again. */}
            {d.overnight && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-indigo-900">
                  <Moon className="h-4 w-4" /> {tr("Night shift — one working day across midnight", "Shift malam — satu hari kerja melewati tengah malam")}
                </p>
                <p className="mt-0.5 text-[12px] text-indigo-900">
                  {tr(
                    `Taps from ${tapClock(d.window_from)} on ${d.work_date} until ${tapClock(d.window_to)} the next day are read into this day. Each tap is still stored on the calendar day it happened.`,
                    `Tap dari ${tapClock(d.window_from)} tanggal ${d.work_date} sampai ${tapClock(d.window_to)} esok harinya dibaca ke hari ini. Setiap tap tetap tersimpan pada tanggal kalender kejadiannya.`,
                  )}
                </p>
              </div>
            )}

            {d.issues.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> {tr("What the machine could not tell us", "Yang tidak bisa diberitahukan mesin")}
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-amber-900">
                  {d.issues.map((i) => <li key={i}>· {i}</li>)}
                </ul>
              </div>
            )}

            {/* Read fine, and still worth saying. Its own box, in slate rather
                than amber, because *the rule could not fit the taps* and
                *something here is worth a look* are different sentences and
                only the first one stops the day being paid (D270). */}
            {d.notes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-slate-700">{tr("Notes on this day", "Catatan hari ini")}</p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                  {d.notes.map((n) => <li key={n}>· {n}</li>)}
                </ul>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {tr(
                    "Does not affect this day's pay. A break over the allowance is reported, never deducted — the same as lateness, until somebody decides otherwise.",
                    "Tidak memengaruhi pembayaran hari ini. Istirahat yang lewat jatah dilaporkan, tidak pernah dipotong — sama seperti keterlambatan, sampai ada yang memutuskan sebaliknya.",
                  )}
                </p>
              </div>
            )}

            {/* The six slots, holes included. */}
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">{tr("The six taps of a full day", "Enam tap dalam sehari penuh")}</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {SCAN_SLOTS.map((slot: ScanSlot) => {
                  const at = d.slots[slot];
                  const tap = d.scans.find((s) => s.slot === slot);
                  return (
                    <li key={slot} className="flex items-center gap-3 px-3 py-2">
                      <span className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                        at ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400",
                      )}>
                        {at ? <Check className="h-3 w-3" /> : "—"}
                      </span>
                      <span className="flex-1 text-[13px] text-slate-700">{SLOT_LABEL[slot]}</span>
                      <span className={cn("font-mono text-[13px] tabular-nums", at ? "text-slate-800" : "text-slate-300")}>
                        {at ? tapClock(at) : "··:··"}
                        {at && tapDay(at) > workDate && (
                          <span className="ml-1 text-[10px] font-sans text-indigo-700">{tr("next day", "esok")}</span>
                        )}
                      </span>
                      <span className="w-16 text-right text-[10px] uppercase tracking-wide text-slate-400">
                        {tap ? tap.verify : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Everything the reader recorded, including what the rule could not place. */}
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                {tr(`Every tap, and where it was made (${d.scans.length})`, `Semua tap dan tempatnya (${d.scans.length})`)}
              </p>
              {d.scans.length === 0 ? (
                <p className="rounded-xl border border-slate-200 px-3 py-3 text-[13px] text-slate-500">
                  {tr(
                    "Nobody scanned on this day. That is a fact, not a gap — but only HRD can say whether it was a day off, sick leave or an absence.",
                    "Tidak ada yang tap pada hari ini. Itu fakta, bukan celah — tetapi hanya HRD yang bisa mengatakan apakah itu hari libur, sakit, atau absen.",
                  )}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="day-taps">
                  {d.scans.map((s) => (
                    <li key={s.at} className={cn(
                      "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-[12px]",
                      s.slot ? "text-slate-700" : "bg-amber-50 text-amber-900",
                    )}>
                      <span className="font-mono tabular-nums">{tapClock(s.at)}</span>
                      {tapDay(s.at) > workDate && <span className="text-[11px] text-indigo-700">{tr("next day", "esok")}</span>}
                      <span className="text-[11px] text-slate-400">{s.verify}</span>
                      <span className="text-[11px]">{s.slot ? SLOT_LABEL[s.slot] : tr("unreadable", "tidak terbaca")}</span>
                      {/* Where it was made (D344): the warehouse reader, the
                          phone's reading and selfie, or HRD's reason. */}
                      <span className="basis-full text-[11px]"><TapWhereLine where={s.where} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {mayEdit && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                {/* Add the tap the machine missed. */}
                {adding ? (
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="text-[13px] font-medium text-slate-800">{tr("Put in a tap the machine missed", "Masukkan tap yang terlewat oleh mesin")}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr]">
                      <input
                        type="time" value={time} onChange={(e) => setTime(e.target.value)}
                        aria-label={tr("Time", "Waktu")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <input
                        value={addReason} onChange={(e) => setAddReason(e.target.value)}
                        placeholder={tr("Why the machine missed it — machine off, finger not read…", "Kenapa mesin melewatkannya — mesin mati, jari tidak terbaca…")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                    {/* On a night, a morning time lands on the next calendar day.
                        Said before saving, in the same words the save will use,
                        so nobody types 07.05 and wonders where it went. */}
                    {d.overnight && time && instantInDay(workDate, time, d.window_from).slice(0, 10) !== workDate && (
                      <p className="mt-1 text-[11px] text-indigo-800">
                        {tr(
                          `Recorded as ${instantInDay(workDate, time, d.window_from).slice(0, 10)} ${time} — the morning that ends this night.`,
                          `Dicatat sebagai ${instantInDay(workDate, time, d.window_from).slice(0, 10)} ${time} — pagi yang mengakhiri malam ini.`,
                        )}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {tr("The reason is what separates a correction from a favour three months later.", "Alasan itulah yang membedakan koreksi dari bantuan tiga bulan kemudian.")}
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
                      <Button size="sm" onClick={addScan} disabled={busy || !time || !addReason.trim()}>{tr("Add tap", "Tambah tap")}</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding(true)}>
                    {tr("Tap the machine missed", "Tap yang terlewat mesin")}
                  </Button>
                )}

                {/* Say what the day actually was. */}
                {!d.mark && (
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                      <Flag className="h-4 w-4 text-slate-400" /> {tr(`Mark this day for ${d.full_name}`, `Tandai hari ini untuk ${d.full_name}`)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(Object.keys(DAY_MARK_LABEL) as DayMarkKind[]).map((k) => (
                        <Button key={k} size="sm" variant={kind === k ? "primary" : "outline"}
                          onClick={() => setKind(kind === k ? null : k)}>
                          {DAY_MARK_LABEL[k]}
                        </Button>
                      ))}
                    </div>
                    {kind && (
                      <>
                        <input
                          value={markReason} onChange={(e) => setMarkReason(e.target.value)}
                          placeholder={tr("Reason — doctor’s note, family permit, office event…", "Keterangan — surat dokter, izin keluarga, acara kantor…")}
                          className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                          {kind === "half_day" ? tr("Counted as 0.5 day.", "Dihitung 0,5 hari.")
                            : kind === "holiday" ? tr("Hours worked on a public holiday count as overtime.", "Jam yang dikerjakan pada tanggal merah dihitung lembur.")
                              : kind === "sick" ? tr("Paid in full when a doctor’s note is attached — it can follow later.", "Dibayar penuh bila surat dokter dilampirkan — bisa menyusul.")
                                : kind === "leave" ? tr("Paid while this person still has leave entitlement; the rest is recorded unpaid.", "Dibayar bila hak cuti orang ini masih ada; sisanya tercatat tanpa dibayar.")
                                  : tr("Recorded, not paid.", "Tercatat, tidak dibayar.")}
                        </p>
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" onClick={mark} disabled={busy || !markReason.trim()}>
                            {tr(`Mark as ${DAY_MARK_LABEL[kind].toLowerCase()}`, `Tandai sebagai ${DAY_MARK_LABEL[kind].toLowerCase()}`)}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The tunjangan for this one day — its own decision, its own reason
                (D250). Shown for everybody so *this day earned it* is as
                visible as *this day did not*. */}
            {mayEdit && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Wallet className="h-4 w-4 text-slate-400" /> {tr("Allowance for this day", "Tunjangan hari ini")}
                </p>
                <Loaded state={holds} onRetry={reloadHolds}>
                  {(rows) => {
                    const active = rows.find((w) => w.restored_by === null);
                    const restored = rows.filter((w) => w.restored_by !== null);
                    return (
                      <>
                        {active ? (
                          <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900">
                            <strong className="font-medium">{tr("Withheld", "Ditahan")}</strong> — {active.reason}
                            <span className="mt-0.5 block text-[11px] text-amber-700">
                              {active.by_name}, {active.at.slice(0, 10)}
                            </span>
                            <Button size="sm" variant="outline" icon={Undo2} className="mt-2"
                              disabled={busy} onClick={() => release(active.id)}>
                              {tr("Restore", "Kembalikan")}
                            </Button>
                          </div>
                        ) : holdOpen ? (
                          <div className="mt-1.5 rounded-lg border border-slate-200 px-3 py-2">
                            <input
                              value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
                              placeholder={tr("WFH · half day · absent — the reason", "WFH · setengah hari · tidak masuk — alasannya")}
                              className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                            <p className="mt-1 text-[11px] text-slate-500">
                              {tr("Lateness is", "Terlambat")} <strong>{tr("not", "bukan")}</strong>{" "}
                              {tr(
                                "a reason here: lateness is deducted per hour, and the allowance is still paid if the person was present.",
                                "alasan di sini: terlambat dipotong per jam, tunjangannya tetap dibayar kalau orangnya hadir.",
                              )}
                            </p>
                            <div className="mt-2 flex justify-end gap-2">
                              <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => setHoldOpen(false)}>{tr("Cancel", "Batal")}</Button>
                              <Button size="sm" disabled={busy || !holdReason.trim()} onClick={hold}>
                                {tr("Withhold allowance", "Tahan tunjangan")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-0.5 text-[12px] text-slate-500">
                              {tr("Paid — this day is recorded as present.", "Dibayar — hari ini tercatat hadir.")}
                            </p>
                            <Button size="sm" variant="outline" className="mt-2"
                              onClick={() => setHoldOpen(true)}>
                              {tr("Withhold this day’s allowance", "Tahan tunjangan hari ini")}
                            </Button>
                          </>
                        )}
                        {restored.map((w) => (
                          <p key={w.id} className="mt-1.5 text-[11px] text-slate-400">
                            {tr(`Withheld once (${w.reason}) — restored by ${w.restored_by_name}: ${w.restored_reason}`, `Pernah ditahan (${w.reason}) — dikembalikan ${w.restored_by_name}: ${w.restored_reason}`)}
                          </p>
                        ))}
                      </>
                    );
                  }}
                </Loaded>
              </div>
            )}

            {/* Hours past the day, shown and never self-claiming.
                Overtime is a sheet — production or staff — and which one it is
                decides who signs it (D146). The drawer says the hours exist
                and sends the person to the sheet rather than growing a third
                way to record them. */}
            {mayClaim && d.overtime_hours > 0 && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Clock className="h-4 w-4 text-slate-400" />
                  {tr(`${formatNumber(d.overtime_hours)} h past working hours recorded on the machine`, `${formatNumber(d.overtime_hours)} jam lewat jam kerja tercatat di mesin`)}
                </p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {tr(
                    "The machine knows the person was still on site, not that they were working. These hours are paid only once they are on an overtime sheet — production is signed by the leader, staff is decided by HRD.",
                    "Mesin tahu dia masih di tempat, bukan bahwa dia bekerja. Jam ini baru dibayar setelah masuk lembar lembur — produksi ditandatangani pimpinan, staff diputuskan HRD.",
                  )}
                </p>
                <Link href="/hrd/lembur">
                  <Button size="sm" variant="outline" className="mt-2">{tr("Open overtime sheets", "Buka lembar lembur")}</Button>
                </Link>
              </div>
            )}

          </div>
        )}
      </Loaded>
    </Drawer>
  );
}
