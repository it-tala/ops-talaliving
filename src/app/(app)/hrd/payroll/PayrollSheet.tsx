"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckSquare, ChevronRight, ClipboardList, Pencil, SlidersHorizontal, Square } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ADJUSTMENT_LABEL, type PayrollLine } from "@/services/hr/contracts";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import { AdjustSection, ConfirmAll, DayEditor, type AdjustEditor } from "./SheetEditors";
import { useTr } from "@/lib/i18n";
import { officeClock } from "@/lib/office";

/** Payroll as one sheet (0213, D373).
 *
 *  Owner: *pastikan absensi lengkap; tampilkan rate gaji bulanan, pokok,
 *  tunjangan, bonus, potongan, rate harian dan rate per jam; breakdown
 *  masing-masing orang dalam tabel yang bisa diklik; total orang, gaji,
 *  komponen penambahan dan pengurangan dalam satu halaman, dengan checkbox
 *  untuk menahan orang tertentu.*
 *
 *  One component for both places a payroll is read: the generate screen,
 *  before anything is opened, and the run, after. Every figure is the
 *  database's — `additions_total`, `deductions_total` and `take_home` per line.
 *  The only arithmetic here is the header's sum over the people ticked, which
 *  moves as boxes are ticked and cannot wait for a round trip; it adds whole
 *  rupiah the database already rounded, so there is nothing to round twice.
 */

/** Somebody the sheet lists who is not paid by it: held, or paid by another
 *  run. They keep a row so the reason is on the page. */
export interface SheetAside {
  employee_no: string;
  full_name: string;
  pay_basis: string;
  reason: string;
  /** Another run pays them: the box is not theirs to tick here. */
  locked: boolean;
}

export function PayrollSheet({
  lines, asides = [], selectable = false, selected, onToggle, onToggleAll,
  blocked, onPersonSettings, title, adjust, period, editDays = false, onChanged,
}: {
  lines: PayrollLine[];
  asides?: SheetAside[];
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (employeeNo: string, on: boolean) => void;
  onToggleAll?: (on: boolean) => void;
  /** Why a line cannot be ticked (attendance not complete), or null. */
  blocked?: (l: PayrollLine) => string | null;
  /** Open this person's component switches (the run page only). */
  onPersonSettings?: (employeeNo: string) => void;
  title?: string;
  /** Bonus, retensi and lain-lain, typed in the drawer (D388). Absent where
   *  nothing may be changed — a signed run. */
  adjust?: AdjustEditor;
  /** The period the lines cover — the day editor reads the marks in it. */
  period?: { from: string; to: string };
  /** Whether the drawer may change a day: add a missed tap, mark *mangkir*,
   *  take the allowance off (D388). */
  editDays?: boolean;
  /** Something in the drawer changed a figure: read the sheet again. */
  onChanged?: () => void;
}) {
  const tr = useTr();
  /* By number, not the line: the drawer must show the line as it is after a
     change, and the line object is replaced when the sheet is read again. */
  const [openNo, setOpenNo] = useState<string | null>(null);
  const open = openNo ? lines.find((l) => l.employee_no === openNo) ?? null : null;
  const isOn = (l: PayrollLine) => !selectable || (selected?.has(l.employee_no) ?? true);
  const counted = lines.filter(isOn);

  /* The header, over the people ticked. */
  const sum = (f: (l: PayrollLine) => number) => counted.reduce((t, l) => t + f(l), 0);
  const people = counted.length;
  const additions = sum((l) => l.additions_total);
  const deductions = sum((l) => l.deductions_total);
  const takeHome = sum((l) => l.take_home);
  const openDays = lines.reduce((t, l) => t + l.days_open, 0);
  const incomplete = lines.filter((l) => l.days_open > 0);
  /* 0242 (D394): of the open days, the salaried working days with no tap and
     no mark — said apart, because they are answered differently. */
  const unconfirmedDays = lines.reduce((t, l) => t + (l.days_unconfirmed ?? 0), 0);
  const openLabel = (l: PayrollLine) => {
    const unc = l.days_unconfirmed ?? 0;
    const unread = l.days_open - unc;
    return [
      unread > 0 ? tr(`${unread} unread`, `${unread} belum dibaca`) : null,
      unc > 0 ? tr(`${unc} no tap, not confirmed`, `${unc} tanpa tap, belum dikonfirmasi`) : null,
    ].filter(Boolean).join(" · ");
  };

  const lateDays = (l: PayrollLine) => (l.days ?? []).filter((d) => (d.late_minutes ?? 0) > 0).length;

  return (
    <>
      {/* ── 1. the totals, on the people ticked ── */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
        <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
          {([
            [tr("People", "Orang"), String(people),
              selectable ? tr(`of ${lines.length} in the period`, `dari ${lines.length} di periode ini`) : tr("on this run", "ikut run ini"), false],
            [tr("Additions", "Penambahan"), formatIDR(additions), tr("pay, allowance, overtime, bonus", "pokok, tunjangan, lembur, bonus"), false],
            [tr("Deductions", "Pengurangan"), formatIDR(deductions), tr("late, short hours, BPJS, kasbon…", "terlambat, jam kurang, BPJS, kasbon…"), deductions > 0],
            [tr("Take-home", "Diterima"), formatIDR(takeHome), tr("additions less deductions", "penambahan dikurangi pengurangan"), false],
            [tr("Attendance", "Absensi"), openDays === 0 ? tr("complete", "lengkap") : tr(`${openDays} day(s) open`, `${openDays} hari belum beres`),
              openDays === 0 ? tr("every day has been read", "semua hari sudah dibaca") : tr(`${incomplete.length} person(s) affected`, `${incomplete.length} orang terdampak`), openDays > 0],
          ] as [string, string, string, boolean][]).map(([k, v, note, warn]) => (
            <div key={k} className="px-4 py-3.5">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className={cn("mt-0.5 text-xl font-bold tabular-nums tracking-tight", warn ? "text-amber-700" : "text-slate-800")}>{v}</dd>
              <p className="text-[11px] text-slate-500">{note}</p>
            </div>
          ))}
        </dl>
      </div>

      {/* ── attendance first: who cannot be paid until a day is read ── */}
      {incomplete.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {tr("Attendance not complete", "Absensi belum lengkap")}
          </p>
          <p className="mt-1">
            {incomplete.map((l) => `${l.full_name} (${openLabel(l)})`).join(" · ")}
          </p>
          {unconfirmedDays > 0 && (
            <p className="mt-1 text-[12px]">
              {tr(
                "A salaried working day with no tap and no mark is not paid until HRD says what it was: present without a tap, or a mark (absent, permit, sick, leave). Open the person and set the day, or confirm their days at once. Someone who does not tap at all (a leader) is set as exempt in their employee record.",
                "Hari kerja gaji bulanan tanpa tap dan tanpa keterangan belum dibayar sampai HRD memutuskan: hadir tanpa tap, atau ditandai (alpa, izin, sakit, cuti). Buka orangnya lalu ubah per hari, atau konfirmasi sekaligus. Orang yang memang tidak absen (pimpinan) diatur ‘tidak wajib absensi’ di data karyawannya.",
              )}
            </p>
          )}
          <p className="mt-1 text-[12px]">
            {tr(
              "A day the machine left incomplete is worth nothing until somebody reads it. Read them on the timesheet; until then these people are held.",
              "Hari yang tidak lengkap di mesin belum bernilai sampai ada yang membacanya. Baca di absensi; sampai itu, orang-orang ini ditahan.",
            )}{" "}
            <Link href="/hrd/absensi" className="font-medium underline">{tr("Open attendance", "Buka absensi")}</Link>
          </p>
        </div>
      )}

      {/* ── 2–3. the sheet ── */}
      <Card className="mb-4">
        <CardHeader
          title={title ?? tr("Everybody, line by line", "Semua orang, baris per baris")}
          subtitle={tr(
            "Click a row for the day-by-day attendance, the rates and every addition and deduction.",
            "Klik baris untuk absensi per hari, rate, dan setiap penambahan serta pengurangan.",
          )}
          icon={ClipboardList}
          action={selectable && onToggleAll ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" icon={CheckSquare} onClick={() => onToggleAll(true)}>{tr("All", "Semua")}</Button>
              <Button size="sm" variant="outline" icon={Square} onClick={() => onToggleAll(false)}>{tr("None", "Kosongkan")}</Button>
            </div>
          ) : undefined}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {selectable && <th className="w-10 px-3 py-2" />}
                <th className="px-3 py-2">{tr("Employee", "Karyawan")}</th>
                <th className="px-3 py-2 text-right">{tr("Attendance", "Absensi")}</th>
                <th className="px-3 py-2 text-right">{tr("Rates", "Rate")}</th>
                <th className="px-3 py-2 text-right">{tr("Additions", "Penambahan")}</th>
                <th className="px-3 py-2 text-right">{tr("Deductions", "Pengurangan")}</th>
                <th className="px-3 py-2 text-right">{tr("Take-home", "Diterima")}</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && asides.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  {tr("Nobody in this period.", "Tidak ada orang di periode ini.")}
                </td></tr>
              )}
              {lines.map((l) => {
                const why = blocked?.(l) ?? null;
                const on = isOn(l);
                return (
                  <tr
                    key={l.employee_no}
                    onClick={() => setOpenNo(l.employee_no)}
                    className={cn("cursor-pointer align-top hover:bg-brand-50/30", !on && "bg-slate-50/70 text-slate-400")}
                  >
                    {selectable && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox" checked={on} disabled={why !== null}
                          title={why ?? undefined}
                          aria-label={tr(`Pay ${l.full_name}`, `Bayar ${l.full_name}`)}
                          onChange={(e) => onToggle?.(l.employee_no, e.target.checked)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <p className={cn("font-medium", on ? "text-slate-800" : "text-slate-500")}>{l.full_name}</p>
                      <p className="text-[11px] text-slate-500">
                        {l.position} · <span className="font-mono">{l.employee_no}</span>
                      </p>
                      <Badge tone={l.pay_basis === "monthly" ? "violet" : "slate"}>
                        {l.pay_basis === "monthly" ? tr("monthly", "bulanan") : l.pay_basis === "daily" ? tr("daily", "harian") : tr("hourly", "per jam")}
                      </Badge>
                      {l.attendance_exempt && <Badge tone="slate">{tr("no attendance required", "tidak wajib absensi")}</Badge>}
                      {why && <p className="mt-1 text-[11px] text-amber-700">{why}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-[12px]">
                      <p className="tabular-nums text-slate-700">{tr(`${formatNumber(l.days_worked)} d · ${formatNumber(l.normal_hours)} h`, `${formatNumber(l.days_worked)} hr · ${formatNumber(l.normal_hours)} jam`)}</p>
                      <p className={cn("tabular-nums", l.late_minutes > 0 ? "text-amber-700" : "text-slate-400")}>
                        {tr(`late ${l.late_minutes} min / ${lateDays(l)} d`, `telat ${l.late_minutes} mnt / ${lateDays(l)} hr`)}
                      </p>
                      <p className={cn("tabular-nums", l.overtime_hours > 0 ? "text-slate-700" : "text-slate-400")}>
                        {tr(`overtime ${formatNumber(l.overtime_hours)} h`, `lembur ${formatNumber(l.overtime_hours)} jam`)}
                      </p>
                      {l.days_open > 0 && <p className="font-medium text-amber-700">{openLabel(l)}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-[12px] text-slate-600">
                      {l.pay_basis === "monthly" && <p>{tr("month", "bulan")} {formatIDR(l.base_rate)}</p>}
                      <p>{tr("day", "hari")} {l.daily_rate != null ? formatIDR(l.daily_rate) : "—"}</p>
                      <p>{tr("hour", "jam")} {formatIDR(l.hourly)}</p>
                      {l.allowance_rate > 0 && <p className="text-slate-400">{tr("allow.", "tunj.")} {l.allowance_daily != null ? formatIDR(l.allowance_daily) : "—"}/{tr("d", "hr")}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatIDR(l.additions_total)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", l.deductions_total > 0 ? "text-rose-700" : "text-slate-300")}>
                      {l.deductions_total > 0 ? `(${formatIDR(l.deductions_total)})` : "—"}
                      {l.absence_deduction > 0 && (
                        <p className="text-[11px] text-slate-500">{tr(`alpa −${formatIDR(l.absence_deduction)} in pay`, `alpa −${formatIDR(l.absence_deduction)} di pokok`)}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatIDR(l.take_home)}</td>
                    <td className="py-2.5 pr-2 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                );
              })}
              {asides.map((a) => (
                <tr key={`aside-${a.employee_no}`} className="bg-slate-50/70 align-top text-slate-400">
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={false} disabled={a.locked}
                        aria-label={tr(`Pay ${a.full_name}`, `Bayar ${a.full_name}`)}
                        onChange={(e) => onToggle?.(a.employee_no, e.target.checked)} />
                    </td>
                  )}
                  <td className="px-3 py-2.5" colSpan={selectable ? 6 : 6}>
                    <p className="font-medium text-slate-500 line-through">{a.full_name}
                      <span className="ml-2 font-mono text-[10px] font-normal no-underline">{a.employee_no}</span>
                    </p>
                    <p className="text-[12px] text-slate-500">{a.reason}</p>
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 text-[13px] font-semibold">
                <tr>
                  {selectable && <td />}
                  <td className="px-3 py-2.5 text-slate-700" colSpan={3}>
                    {tr(`Total · ${people} people`, `Total · ${people} orang`)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatIDR(additions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-rose-700">({formatIDR(deductions)})</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{formatIDR(takeHome)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {open && (
        <PersonBreakdown line={open} onClose={() => setOpenNo(null)}
          adjust={adjust} period={period} editDays={editDays} onChanged={onChanged}
          onPersonSettings={onPersonSettings ? () => { onPersonSettings(open.employee_no); setOpenNo(null); } : undefined} />
      )}
    </>
  );
}

const WEEKDAY_ID = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WEEKDAY_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One person, taken apart: the rates, every addition and deduction, and the
 *  days they came from. */
function PersonBreakdown({ line: l, onClose, onPersonSettings, adjust, period, editDays, onChanged }: {
  line: PayrollLine; onClose: () => void; onPersonSettings?: () => void;
  adjust?: AdjustEditor; period?: { from: string; to: string }; editDays?: boolean; onChanged?: () => void;
}) {
  const tr = useTr();
  const canEditDays = !!editDays && !!period;
  const [edits, reloadEdits] = useLoad(
    () => (canEditDays && period
      ? hr.personDayEdits({ employee_no: l.employee_no, from: period.from, to: period.to })
      : Promise.resolve({ data: null, error: null } as never)),
    [l.employee_no, period?.from, period?.to, canEditDays],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const dayDone = () => { setEditing(null); reloadEdits(); onChanged?.(); };
  /* *Mangkir* is a day marked absent with that word first (D388): the mark
     the system already pays nothing for, said the way HRD said it. */
  const truant = (date: string) => edits.status === "ready"
    && !!edits.data?.marks.some((m) => m.work_date === date && m.kind === "absent" && m.reason.startsWith("Mangkir"));
  const approvedOt = new Map<string, number>();
  for (const p of l.overtime_parts) approvedOt.set(p.work_date, (approvedOt.get(p.work_date) ?? 0) + p.hours);
  /* 0243/0244 (D395, D396): the overtime parts, one line each, with why the
     night was approved where the drawer knows it. */
  const nightReason = new Map((edits.status === "ready" ? edits.data?.overtime ?? [] : [])
    .map((o) => [o.sheet_no, o.reason ?? ""] as const));
  const reasonOf = (sheetNo: string) => nightReason.get(sheetNo) ?? "";
  const otDetail = l.overtime_parts.length > 0;
  const plus = l.adjustments.filter((a) => a.amount > 0);
  const minus = l.adjustments.filter((a) => a.amount < 0);
  const hhmm = (v: string | null) => {
    if (!v) return "—";
    if (/^\d{2}:\d{2}$/.test(v)) return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : officeClock(d);
  };

  const Row = ({ k, v, tone, note }: { k: string; v: string; tone?: "plus" | "minus" | "muted"; note?: string }) => (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-slate-600">{k}{note && <span className="block text-[11px] text-slate-400">{note}</span>}</span>
      <span className={cn("whitespace-nowrap tabular-nums",
        tone === "plus" && "text-emerald-700", tone === "minus" && "text-rose-700", tone === "muted" && "text-slate-400")}>{v}</span>
    </div>
  );

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={l.full_name}
      subtitle={`${l.employee_no} · ${l.position}`}
      footer={
        <div className="flex items-center justify-between gap-2">
          {onPersonSettings
            ? <Button variant="outline" icon={SlidersHorizontal} onClick={onPersonSettings}>{tr("Components for this person", "Komponen orang ini")}</Button>
            : <span />}
          <Button variant="ghost" onClick={onClose}>{tr("Close", "Tutup")}</Button>
        </div>
      }
    >
      <div className="space-y-5 text-[13px]">
        {/* Rates */}
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tr("Rates", "Rate")}</h3>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
            <Row k={tr("Monthly salary", "Gaji bulanan")} v={l.pay_basis === "monthly" ? formatIDR(l.base_rate) : "—"} tone={l.pay_basis === "monthly" ? undefined : "muted"} />
            <Row k={tr("Daily rate", "Rate harian")} v={l.daily_rate != null ? formatIDR(l.daily_rate) : "—"}
              note={l.pay_basis === "monthly" ? tr("salary ÷ the month's working days", "gaji ÷ hari kerja bulan itu") : l.pay_basis === "hourly" ? tr("hour wage × contracted day", "upah per jam × jam kerja sehari") : undefined} />
            <Row k={tr("Hourly rate", "Rate per jam")} v={formatIDR(l.hourly)}
              note={tr(`the hour overtime is priced at (${l.hourly_basis})`, `jam yang dipakai menghitung lembur (${l.hourly_basis})`)} />
            {/* A salary's tunjangan is a month, and the day is derived (D386). */}
            {l.pay_basis === "monthly" && (
              <Row k={tr("Monthly allowance", "Tunjangan bulanan")} v={l.allowance_rate > 0 ? formatIDR(l.allowance_rate) : "—"} tone={l.allowance_rate > 0 ? undefined : "muted"} />
            )}
            <Row k={tr("Allowance, per day", "Tunjangan per hari")} v={l.allowance_rate > 0 && l.allowance_daily != null ? formatIDR(l.allowance_daily) : "—"}
              tone={l.allowance_rate > 0 ? undefined : "muted"}
              note={l.pay_basis === "monthly" && l.allowance_rate > 0 ? tr("allowance ÷ the month's working days", "tunjangan ÷ hari kerja bulan itu") : undefined} />
          </div>
        </section>

        {/* Additions */}
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{tr("Additions", "Penambahan")}</h3>
          <div className="divide-y divide-slate-100 rounded-lg border border-emerald-100 px-3">
            <Row k={l.pay_basis === "monthly" ? tr("Base salary", "Gaji pokok") : tr(`Wage · ${formatNumber(l.days_worked)} days`, `Upah · ${formatNumber(l.days_worked)} hari`)}
              v={formatIDR(l.base_pay)} tone="plus"
              note={l.pay_basis === "monthly" && l.proration.some((m) => m.paid_days !== m.workdays)
                ? l.proration.map((m) => tr(`${m.paid_days}/${m.workdays} working days ${m.month}`, `${m.paid_days}/${m.workdays} hari kerja ${m.month}`)).join(" + ")
                : undefined} />
            <Row k={tr(`Allowance · ${formatNumber(l.allowance_days)} days`, `Tunjangan · ${formatNumber(l.allowance_days)} hari`)} v={formatIDR(l.allowance_pay)} tone={l.allowance_pay > 0 ? "plus" : "muted"} />
            <Row k={tr(`Overtime · ${formatNumber(l.overtime_hours)} h approved`, `Lembur · ${formatNumber(l.overtime_hours)} jam disetujui`)} v={formatIDR(l.overtime_pay)} tone={l.overtime_pay > 0 ? "plus" : "muted"}
              note={l.overtime_parts.length > 0 && !otDetail
                ? l.overtime_parts.map((p) => (p.multiplier > 0 ? `${formatNumber(p.hours)}×${formatNumber(p.multiplier)}` : tr("form", "form"))).join(" + ")
                : undefined} />
            {/* 0244 (D396): every part on its own line — the day, the clock
                range (or the ladder's rung), hours, the hour's price at that
                multiplier, the amount, and why it was approved. */}
            {otDetail && (
              <table className="my-1 w-full text-[11px] tabular-nums text-slate-600">
                <tbody>
                  {l.overtime_parts.map((p, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap py-0.5 pr-2">{p.work_date.slice(8)}/{p.work_date.slice(5, 7)}</td>
                      <td className="whitespace-nowrap pr-2">{p.label}</td>
                      <td className="whitespace-nowrap pr-2 text-right">{formatNumber(p.hours)} {tr("h", "jam")}</td>
                      <td className="whitespace-nowrap pr-2 text-right">
                        {p.multiplier > 0 ? `${formatIDR(Math.round(p.hourly * p.multiplier))}/${tr("h", "jam")}` : "—"}
                      </td>
                      <td className="whitespace-nowrap pr-2 text-right font-medium text-slate-800">{formatIDR(p.amount)}</td>
                      <td className="text-slate-500">{reasonOf(p.source)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {adjust
              ? <AdjustSection side="add" employeeNo={l.employee_no} editor={adjust} />
              : plus.map((a, i) => <Row key={`p${i}`} k={`${a.label ?? ADJUSTMENT_LABEL[a.kind]}`} note={a.reason} v={formatIDR(a.amount)} tone="plus" />)}
            <Row k={tr("Total additions", "Total penambahan")} v={formatIDR(l.additions_total)} tone="plus" />
          </div>
        </section>

        {/* Deductions */}
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">{tr("Deductions", "Pengurangan")}</h3>
          <div className="divide-y divide-slate-100 rounded-lg border border-rose-100 px-3">
            {l.absence_deduction > 0 && (
              <Row k={tr("Alpa (already inside the base)", "Alpa (sudah di dalam pokok)")} v={`(${formatIDR(l.absence_deduction)})`} tone="muted"
                note={(l.days_unconfirmed ?? 0) > 0
                  ? tr(`includes ${l.days_unconfirmed} day(s) with no tap not yet confirmed; not taken a second time`,
                    `termasuk ${l.days_unconfirmed} hari tanpa tap yang belum dikonfirmasi; tidak dipotong dua kali`)
                  : tr("not taken a second time", "tidak dipotong dua kali")} />
            )}
            <Row k={tr(`Late · ${l.late_minutes} min`, `Terlambat · ${l.late_minutes} mnt`)} v={l.late_deduction > 0 ? `(${formatIDR(l.late_deduction)})` : "—"}
              tone={l.late_deduction > 0 ? "minus" : "muted"}
              note={l.late_minutes > 0 && l.late_deduction === 0 ? tr("not deducted under the current rules", "belum dipotong menurut aturan sekarang") : undefined} />
            <Row k={tr(`Short hours · ${formatNumber(l.undertime_hours)} h`, `Jam kurang · ${formatNumber(l.undertime_hours)} jam`)} v={l.undertime_amount > 0 ? `(${formatIDR(l.undertime_amount)})` : "—"} tone={l.undertime_amount > 0 ? "minus" : "muted"} />
            {l.contributions.map((c) => <Row key={c.scheme} k={c.label} v={`(${formatIDR(c.employee)})`} tone="minus" />)}
            {adjust
              ? <AdjustSection side="take" employeeNo={l.employee_no} editor={adjust} />
              : minus.map((a, i) => <Row key={`m${i}`} k={`${a.label ?? ADJUSTMENT_LABEL[a.kind]}`} note={a.reason} v={`(${formatIDR(-a.amount)})`} tone="minus" />)}
            {l.components_off.filter((o) => o.amount !== 0 || o.scope === "person").map((o) => (
              <Row key={o.component} k={tr(`Switched off: ${o.component}`, `Dimatikan: ${o.component}`)} note={o.reason} v={formatIDR(Math.abs(o.amount))} tone="muted" />
            ))}
            <Row k={tr("Total deductions", "Total pengurangan")} v={`(${formatIDR(l.deductions_total)})`} tone="minus" />
          </div>
        </section>

        <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3 text-white">
          <span>{tr("Take-home", "Diterima")}</span>
          <span className="text-lg font-bold tabular-nums">{formatIDR(l.take_home)}</span>
        </div>

        {/* Days */}
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {tr("Attendance, day by day", "Absensi per hari")}
          </h3>
          {l.attendance_exempt && (
            <p className="mb-1.5 text-[12px] text-slate-500">
              {tr("No attendance required (set by HRD): a working day with no tap is paid.",
                "Tidak wajib absensi (diatur HRD): hari kerja tanpa tap tetap dibayar.")}
            </p>
          )}
          {canEditDays && (l.days_unconfirmed ?? 0) > 0 && (
            <ConfirmAll employeeNo={l.employee_no}
              dates={l.days.filter((d) => d.unconfirmed).map((d) => d.work_date)} onDone={dayDone} />
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">{tr("Day", "Hari")}</th>
                  <th className="px-2 py-1.5">{tr("In", "Masuk")}</th>
                  <th className="px-2 py-1.5">{tr("Out", "Pulang")}</th>
                  <th className="px-2 py-1.5 text-right">{tr("Hours", "Jam kerja")}</th>
                  <th className="px-2 py-1.5 text-right">{tr("Late", "Telat")}</th>
                  <th className="px-2 py-1.5 text-right">{tr("OT (machine / approved)", "Lembur (mesin / disetujui)")}</th>
                  <th className="px-2 py-1.5">{tr("Status", "Status")}</th>
                  {canEditDays && <th className="w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {l.days.map((d) => {
                  const ot = approvedOt.get(d.work_date) ?? 0;
                  const withheld = edits.status === "ready"
                    && edits.data?.withholdings.some((w) => w.work_date === d.work_date && w.restored_at === null);
                  return (
                    <Fragment key={d.work_date}>
                    <tr className={cn(d.open && "bg-amber-50/70", editing === d.work_date && "bg-brand-50/40")}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                        {tr(WEEKDAY_EN[d.weekday], WEEKDAY_ID[d.weekday])} {d.work_date.slice(8)}/{d.work_date.slice(5, 7)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{hhmm(d.in_at)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{hhmm(d.out_at)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.work_hours > 0 ? formatNumber(d.work_hours) : "—"}</td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", (d.late_minutes ?? 0) > 0 ? "text-amber-700" : "text-slate-300")}>
                        {(d.late_minutes ?? 0) > 0 ? tr(`${d.late_minutes} min`, `${d.late_minutes} mnt`) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        <span className={d.overtime_hours > 0 ? "text-slate-500" : "text-slate-300"}>{formatNumber(d.overtime_hours)}</span>
                        {" / "}
                        <span className={ot > 0 ? "font-medium text-slate-800" : "text-slate-300"}>{formatNumber(ot)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px]">
                        {d.unconfirmed ? <span className="font-medium text-amber-700">{tr("no tap — check", "tanpa tap — cek")}</span>
                          : d.open ? <span className="font-medium text-amber-700">{tr("unread", "belum dibaca")}</span>
                          : d.confirmed ? <span className="text-emerald-700">{tr("present (HRD)", "hadir (konfirmasi HRD)")}</span>
                          : truant(d.work_date) ? <span className="font-medium text-rose-700">{tr("truant", "mangkir")}</span>
                          : d.mark ? <span className="text-slate-600">{d.mark}</span>
                            : d.assumed ? <span className="text-slate-500">{tr("assumed", "asumsi")}</span>
                              : d.fraction != null
                                ? <span className="font-medium text-amber-700" title={tr("work ÷ schedule", "jam kerja ÷ jam jadwal")}>
                                    {tr(`${formatNumber(d.fraction)} day`, `${formatNumber(d.fraction)} hari`)}
                                  </span>
                              : d.day_value > 0 ? <span className="text-emerald-700">{d.day_value === 1 ? tr("present", "hadir") : `${formatNumber(d.day_value)}`}</span>
                                : <span className="text-slate-400">—</span>}
                        {withheld && <span className="block text-rose-700">{tr("no allowance", "tanpa tunjangan")}</span>}
                        {d.break_kept && <span className="block text-slate-500">{tr("break kept", "istirahat tidak dipotong")}</span>}
                      </td>
                      {canEditDays && (
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() => setEditing(editing === d.work_date ? null : d.work_date)}
                            aria-label={tr(`Edit ${d.work_date}`, `Ubah ${d.work_date}`)}
                            className={cn("rounded p-1 hover:bg-slate-100", d.open ? "text-amber-700" : "text-slate-400")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                    {canEditDays && editing === d.work_date && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <DayEditor
                            key={`${d.work_date}:${d.unconfirmed}:${d.confirmed}:${edits.status === "ready" ? JSON.stringify(edits.data) : ""}`}
                            employeeNo={l.employee_no} workDate={d.work_date} open={d.open && !d.unconfirmed}
                            unconfirmed={!!d.unconfirmed} confirmed={!!d.confirmed}
                            noTapSalary={l.pay_basis === "monthly" && (!!d.unconfirmed || !!d.confirmed || (!d.in_at && !d.out_at))}
                            machineOvertime={d.overtime_hours}
                            breakKept={!!d.break_kept}
                            edits={edits.status === "ready" ? edits.data : null}
                            onDone={dayDone}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
                <tr>
                  <td className="px-2 py-1.5" colSpan={3}>{tr(`${formatNumber(l.days_worked)} day(s) paid`, `${formatNumber(l.days_worked)} hari dibayar`)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(l.normal_hours)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.late_minutes > 0 ? tr(`${l.late_minutes} min`, `${l.late_minutes} mnt`) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(l.overtime_hours)}</td>
                  <td colSpan={canEditDays ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {l.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-amber-800">
            {l.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
