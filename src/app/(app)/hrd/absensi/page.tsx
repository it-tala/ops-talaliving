"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Upload, AlertTriangle, Clock, Flag, ChevronLeft, ChevronRight, Moon, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { mondayOf, officeToday, shiftDay } from "@/lib/office";
import { isLiveMode } from "@/lib/live";
import { hr } from "@/demo/api";
import type { PayBasis, PayrollLine, TimesheetDay, TimesheetTotal } from "@/services/hr/contracts";
import { DAY_MARK_SHORT, OVERTIME_STAGE_LABEL, PAY_WEEK_STARTS_DEFAULT, type DayState } from "@/services/hr/contracts";
import Link from "next/link";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { ImportScans } from "./ImportScans";
import { DayDrawer } from "./DayDrawer";
import { MarkDay } from "./MarkDay";

/** The timesheet: every person, every day, and whether the machine told us
 *  enough to pay them.
 *
 *  A full day is six taps — masuk, istirahat keluar, istirahat masuk, pulang,
 *  and the lembur pair when there is one. The reader gives us four on a good
 *  day. In the real export this was built against, **48 days out of 227** have
 *  an odd number: a missing *istirahat masuk*, a second tap eleven minutes
 *  later, one scan and nothing else.
 *
 *  So the grid's job is not to display attendance. It is to show, at a glance,
 *  **which days a person still has to read** — because until they have, a
 *  payroll over this period is arithmetic rather than wages (D141).
 */
/** One pay week, or five days at a time (D345, D350). Owner: *cukup
 *  menampilkan absensi per 5 hari, total jam kerja dan estimasi gaji —
 *  terpisah untuk karyawan bulanan dan mingguan*, and then: *tampilan absensi
 *  berdasarkan minggu, awal minggu mulai dari Sabtu … Jumat*. So the grid opens
 *  on the week — Sabtu–Jumat unless the rule book says otherwise — which is the
 *  week the weekly payroll pays. *5 hari* is five **calendar** days, not five
 *  working days: opened fresh it is the five days up to today. Days that have
 *  not happened yet are drawn as *belum*, so a Thursday missing on a
 *  Wednesday reads as not yet rather than as nobody came. */
type Span = 5 | 7;

/** The first day of the pay week `key` falls in, for a week starting on ISO
 *  weekday `isodow` — the weekly payroll's own rule (D340). */
function payWeekStart(key: string, isodow: number): string {
  const monday = mondayOf(key);
  const start = shiftDay(monday, isodow - 1);
  return start > key ? shiftDay(start, -7) : start;
}

/** Where the grid opens: this pay week, or the last five days, in live mode;
 *  in the demo, the week its fixtures were recorded in, which is otherwise an
 *  empty grid. */
function defaultFrom(span: Span, weekStartsOn: number): string {
  if (!isLiveMode()) return span === 5 ? "2026-08-31" : payWeekStart("2026-08-31", weekStartsOn);
  return span === 5 ? shiftDay(officeToday(), -4) : payWeekStart(officeToday(), weekStartsOn);
}

/** Present, and short of the schedule (D353). */
const SHORT_CELL = "bg-rose-50 text-rose-800 border-rose-300 font-semibold";

const CELL: Record<DayState, string> = {
  complete: "bg-emerald-50 text-emerald-800 border-emerald-200",
  review: "bg-amber-50 text-amber-900 border-amber-300 font-semibold",
  marked: "bg-violet-50 text-violet-800 border-violet-200",
  off: "bg-slate-50 text-slate-300 border-slate-100",
};

export default function TimesheetPage() {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  /* Read off the address, as the weekly payroll does, so a link (or a reload)
     lands on the fortnight somebody was looking at. */
  const [span, setSpan] = useState<Span>(() => {
    const asked = typeof window === "undefined"
      ? null : new URLSearchParams(window.location.search).get("span");
    return asked === "5" ? 5 : 7;
  });
  /* Which weekday a pay week starts on is the rule book's (D340). */
  const [books] = useLoad(() => hr.listPayRules(), []);
  const weekStartsOn = (() => {
    if (books.status !== "ready") return PAY_WEEK_STARTS_DEFAULT;
    const today = officeToday();
    const inForce = [...books.data]
      .filter((b) => b.effective_from <= today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version - b.version)
      .pop();
    return inForce?.rules.pay_week_starts_isodow ?? PAY_WEEK_STARTS_DEFAULT;
  })();
  /* A day short of its schedule is drawn red (D353) — under the reading that
     makes hours the schedule's (`in_out`), where short means late or early.
     Judged against the book in force **on that day**, rounded as the hours
     are, so a day read on time is never red by its own rounding. */
  const isShort = (day: TimesheetDay): boolean => {
    if (books.status !== "ready" || day.state !== "complete" || day.scheduled_hours == null) return false;
    const book = [...books.data]
      .filter((b) => b.effective_from <= day.work_date)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version - b.version)
      .pop();
    if (book?.rules.day_reading !== "in_out") return false;
    const step = book.rules.hours_rounding_minutes ?? 15;
    const quota = step > 0 ? Math.round((day.scheduled_hours * 60) / step) * step / 60 : day.scheduled_hours;
    return day.work_hours < quota - 0.001;
  };
  const [from, setFrom] = useState(() => {
    const asked = typeof window === "undefined"
      ? null : new URLSearchParams(window.location.search).get("from");
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : defaultFrom(span, PAY_WEEK_STARTS_DEFAULT);
  });
  /* A rule book that starts the week on another day moves the week shown
     onto it once the book has loaded. */
  useEffect(() => {
    if (span === 7) setFrom((f) => payWeekStart(f, weekStartsOn));
  }, [weekStartsOn, span]);
  const to = shiftDay(from, span - 1);
  const today = officeToday();
  const notYet = datesBetween(from, to).filter((d) => d > today);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", from);
    url.searchParams.set("span", String(span));
    window.history.replaceState(null, "", url.toString());
  }, [from, span]);
  const [sheet, reload] = useLoad(() => hr.getTimesheet({ from, to }), [from, to]);
  /* What the days are worth — the weekly payroll's own figures for exactly
     these days, never a second calculation here (A3). */
  const [pay, reloadPay] = useLoad(() => hr.previewPayroll({ period_start: from, period_end: to }), [from, to]);
  const [sheets, reloadSheets] = useLoad(() => hr.listOvertimeSheets(), []);
  const [importing, setImporting] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [open, setOpen] = useState<{ employee_no: string; work_date: string } | null>(null);
  const mayEdit = can("hrd.update");
  const mayLeader = hasAuthority("approve_overtime");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Timesheet", "Absensi")}
        description={tr(
          `${from} → ${to}. Six taps make a full day; the reader gives four on a good one. Amber is a day somebody still has to read.`,
          `${from} → ${to}. Enam tap membuat satu hari penuh; mesin memberi empat pada hari yang baik. Kuning adalah hari yang masih harus dibaca seseorang.`,
        )}
        actions={mayEdit ? (
          <Button icon={Upload} onClick={() => setImporting(true)}>{tr("Upload biometric file", "Unggah file biometrik")}</Button>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label={tr("Days shown", "Hari yang ditampilkan")}>
          {([7, 5] as Span[]).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={span === n}
              onClick={() => { setSpan(n); setFrom(n === 7 ? payWeekStart(from, weekStartsOn) : from); }}
              className={cn("px-3 py-1.5 text-[12px] font-medium",
                span === n ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
            >
              {n === 5 ? tr("5 days", "5 hari")
                : tr(`Week (${DAY_SHORT[weekStartsOn % 7]}–${DAY_SHORT[(weekStartsOn + 6) % 7]})`,
                     `Minggu (${DAY_SHORT[weekStartsOn % 7]}–${DAY_SHORT[(weekStartsOn + 6) % 7]})`)}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => setFrom(shiftDay(from, -span))}>
          {span === 5 ? tr("Previous 5 days", "5 hari sebelumnya") : tr("Previous week", "Minggu sebelumnya")}
        </Button>
        <span className="px-2 font-mono text-[12px] text-slate-500">{from} → {to}</span>
        <Button variant="outline" size="sm" onClick={() => setFrom(shiftDay(from, span))}>
          {span === 5 ? tr("Next 5 days", "5 hari berikutnya") : tr("Next week", "Minggu depan")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFrom(defaultFrom(span, weekStartsOn))}>
          {span === 5 ? tr("Last 5 days", "5 hari terakhir") : tr("This week", "Minggu ini")}
        </Button>
      </div>
      {notYet.length > 0 && (
        <p className="-mt-2 mb-4 text-[12px] text-slate-500">
          {tr(
            `${notYet.map(dayLabel).join(", ")} ${notYet.length === 1 ? "has" : "have"} not happened yet — today is ${dayLabel(today)}.`,
            `${notYet.map(dayLabel).join(", ")} belum terjadi — hari ini ${dayLabel(today)}.`,
          )}
        </p>
      )}

      <Loaded state={sheet} onRetry={reload}>
        {(s) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  [tr("People", "Orang"), String(s.employees.length), tr("on the machine this period", "di mesin periode ini")],
                  [tr("Days to read", "Hari untuk dibaca"), String(s.needs_review), s.needs_review > 0 ? tr("the machine could not describe these", "mesin tidak bisa menjelaskan hari-hari ini") : tr("the machine described every day", "mesin menjelaskan setiap hari")],
                  [tr("Marked by HRD", "Ditandai HRD"), String(s.marked), tr("holiday, half day, absent, sick", "libur, setengah hari, absen, sakit")],
                  [tr("Complete", "Lengkap"), String(s.days.filter((d) => d.state === "complete").length), tr("nothing to do", "tidak ada yang perlu dilakukan")],
                ] as [string, string, string][]).map(([k, v, note], i) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      i === 1 && s.needs_review > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              {s.needs_review > 0 && (
                <p className="border-t border-slate-100 bg-amber-50/60 px-4 py-2.5 text-[12px] text-amber-900">
                  {tr(
                    "A payroll over this period cannot be approved until these are read. Click any amber cell to see the taps the machine actually recorded.",
                    "Penggajian untuk periode ini tidak bisa disetujui sampai hari-hari ini dibaca. Klik sel kuning mana pun untuk melihat tap yang benar-benar direkam mesin.",
                  )}
                </p>
              )}
            </div>

            {/* Two groups, because the two are paid differently and read for
                different things (D345): somebody on a day rate is paid for
                exactly these days, somebody on a salary is paid the month
                and these days only move the allowance. */}
            {([
              ["weekly", tr("Weekly — paid by the day", "Mingguan — dibayar per hari"),
                tr("What these days earn: day rate × days (Saturday, Sunday and red days at the schedule's multiplier), allowance, and approved overtime. Days still to read are not in it yet.",
                   "Yang dihasilkan hari-hari ini: upah harian × hari (Sabtu, Minggu dan tanggal merah dengan pengali jadwal), tunjangan, dan lembur yang disetujui. Hari yang belum dibaca belum masuk.")],
              ["monthly", tr("Monthly — on a salary", "Bulanan — bergaji bulanan"),
                tr("The salary is the month's whatever these days say; what these days add is the allowance for days present and approved overtime.",
                   "Gajinya gaji sebulan apa pun isi hari-hari ini; yang ditambahkan hari-hari ini adalah tunjangan hari hadir dan lembur yang disetujui.")],
            ] as ["weekly" | "monthly", string, string][]).map(([group, title, subtitle]) => (
              <PeopleGrid
                key={group}
                group={group}
                title={title}
                subtitle={subtitle}
                sheet={s}
                sheetState={sheet}
                pay={pay.status === "ready" ? pay.data.lines : null}
                payFailed={pay.status === "failed"}
                onRetryPay={reloadPay}
                mayEdit={mayEdit}
                onMarkDate={setMarking}
                onOpen={(employee_no, work_date) => setOpen({ employee_no, work_date })}
                isShort={isShort}
              />
            ))}

            {/* Overtime lives on its own screen now: it arrives as a sheet,
                and the two kinds of sheet answer to different people (D146).
                What belongs here is only the part that touches attendance —
                how many hours the machine saw that nobody has signed for. */}
            <Loaded state={sheets} onRetry={reloadSheets}>
              {(all) => {
                const waiting = all.filter((x) =>
                  x.stage === "waiting_hrd" || x.stage === "waiting_surat" || x.stage === "waiting_leader");
                const unreviewed = all.filter((x) => x.stage === "paid_default");
                return (
                  <Card>
                    <CardHeader
                      title={tr("Overtime", "Lembur")}
                      subtitle={tr(
                        "Overtime hours are not taken from the machine — they arrive as a sheet, and the sheet is what gets signed.",
                        "Jam lembur tidak dicatat dari mesin — ia datang sebagai lembar, dan lembar itu yang ditandatangani.",
                      )}
                      icon={Clock}
                      action={
                        <Link href="/hrd/lembur">
                          <Button size="sm" variant="outline">{tr("Open overtime sheets", "Buka lembar lembur")}</Button>
                        </Link>
                      }
                    />
                    <ul className="divide-y divide-slate-100">
                      {waiting.length === 0 && unreviewed.length === 0 && (
                        <li className="px-5 py-5 text-[13px] text-slate-500">
                          {tr("No sheets are waiting for a decision.", "Tidak ada lembar yang menunggu keputusan.")}
                        </li>
                      )}
                      {[...waiting, ...unreviewed].slice(0, 6).map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className="min-w-[180px] flex-1 text-[13px] text-slate-800">
                            {x.purpose}
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{x.sheet_no} · {x.work_date}</span>
                          </span>
                          <span className="whitespace-nowrap text-[12px] text-slate-600">
                            {tr(`${x.lines.length} people`, `${x.lines.length} orang`)} · {tr(`${formatNumber(x.total_hours)} h`, `${formatNumber(x.total_hours)} jam`)}
                          </span>
                          <Badge tone={x.payable ? "green" : "amber"} dot>{OVERTIME_STAGE_LABEL[x.stage]}</Badge>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              }}
            </Loaded>
          </>
        )}
      </Loaded>

      {importing && <ImportScans onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); reloadPay(); }} />}
      {marking && <MarkDay date={marking} onClose={() => setMarking(null)} onDone={() => { setMarking(null); reload(); reloadPay(); }} />}
      {open && (
        <DayDrawer
          employeeNo={open.employee_no}
          workDate={open.work_date}
          onClose={() => setOpen(null)}
          onChanged={() => { reload(); reloadPay(); }}
        />
      )}
    </div>
  );
}


/** Berapa jam dan berapa hari, di ujung barisnya.
 *
 *  **Hari yang belum dibaca dicetak di sebelah totalnya, bukan di catatan
 *  kaki.** Sebuah periode dengan empat hari yang belum dibaca punya total yang
 *  pasti terlalu kecil, dan sebuah angka yang terlalu kecil tanpa keterangan
 *  adalah angka yang dipercaya orang. */
function TotalCell({ total }: { total?: TimesheetTotal }) {
  const tr = useTr();
  if (!total) return <td className="sticky right-0 border-l border-slate-200 bg-white" />;
  return (
    <td className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-1.5 text-right">
      <span className="block text-[13px] font-semibold tabular-nums text-slate-800">
        {tr(`${formatNumber(total.work_hours)} h`, `${formatNumber(total.work_hours)} jam`)}
      </span>
      <span className="block text-[10px] tabular-nums text-slate-400">
        {tr(`${formatNumber(total.days_counted)} days`, `${formatNumber(total.days_counted)} hari`)}
      </span>
      {total.days_review > 0 && (
        <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-amber-700">
          {tr(`${total.days_review} not yet read`, `${total.days_review} belum dibaca`)}
        </span>
      )}
    </td>
  );
}


interface Sheet {
  days: TimesheetDay[];
  dates: string[];
  employees: { employee_no: string; full_name: string; pay_basis: PayBasis }[];
  totals: TimesheetTotal[];
  needs_review: number;
  marked: number;
}

/** One group's days, hours and what they are worth (D345). */
function PeopleGrid({
  group, title, subtitle, sheet: s, sheetState, pay, payFailed, onRetryPay, mayEdit, onMarkDate, onOpen, isShort,
}: {
  group: "weekly" | "monthly";
  title: string;
  subtitle: string;
  sheet: Sheet;
  sheetState: Parameters<typeof SourceBadge>[0]["state"];
  pay: PayrollLine[] | null;
  payFailed: boolean;
  onRetryPay: () => void;
  mayEdit: boolean;
  onMarkDate: (date: string) => void;
  onOpen: (employeeNo: string, workDate: string) => void;
  isShort: (day: TimesheetDay) => boolean;
}) {
  const tr = useTr();
  const members = s.employees.filter((e) => (e.pay_basis === "monthly") === (group === "monthly"));
  /* Pages by person like every table (D157). */
  const { shown: people, pager } = usePaged(members, 12);
  const lineOf = new Map((pay ?? []).map((l) => [l.employee_no, l]));
  if (members.length === 0) return null;

  const weeklySum = members.reduce((n, e) => n + (lineOf.get(e.employee_no)?.gross ?? 0), 0);
  const monthlyAdd = members.reduce((n, e) => {
    const l = lineOf.get(e.employee_no);
    return n + (l ? l.allowance_pay + l.overtime_pay : 0);
  }, 0);
  const today = officeToday();
  const hoursSum = members.reduce((n, e) => n + (s.totals.find((t) => t.employee_no === e.employee_no)?.work_hours ?? 0), 0);

  return (
    <Card className="mb-4" data-testid={`grid-${group}`}>
      <CardHeader
        title={tr(`${title} · ${members.length}`, `${title} · ${members.length}`)}
        subtitle={subtitle}
        icon={group === "weekly" ? CalendarCheck : Wallet}
        action={<SourceBadge state={sheetState} />}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70">
              <th className="sticky left-0 z-10 bg-slate-50/70 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {tr("Employee", "Karyawan")}
              </th>
              {s.dates.map((d) => (
                <th key={d} className={cn("px-2 py-2.5 text-center text-[11px] font-semibold", d > today ? "text-slate-300" : "text-slate-500")}>
                  <button
                    onClick={() => mayEdit && onMarkDate(d)}
                    className="underline decoration-dotted underline-offset-4 hover:text-brand-700"
                    title={tr("Mark this day for everybody", "Tandai hari ini untuk semua orang")}
                  >
                    {dayLabel(d)}
                  </button>
                  {d > today && <span className="block text-[9px] font-normal">{tr("not yet", "belum")}</span>}
                </th>
              ))}
              <th className="border-l border-slate-200 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {tr("Hours", "Jam")}
              </th>
              <th className="sticky right-0 z-10 border-l border-slate-200 bg-slate-50/70 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {tr("Estimated pay", "Estimasi gaji")}
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((e) => (
              <tr key={e.employee_no} className="border-b border-slate-100">
                <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-1.5 text-left">
                  <span className="block text-[13px] font-medium text-slate-800">{e.full_name}</span>
                  <span className="block font-mono text-[10px] text-slate-400">
                    {e.employee_no} · {e.pay_basis === "monthly" ? tr("monthly", "bulanan") : e.pay_basis === "daily" ? tr("daily", "harian") : tr("hourly", "per jam")}
                  </span>
                </th>
                {s.dates.map((date) => {
                  /* A day that has not happened is not a day nobody came. */
                  if (date > today) {
                    return (
                      <td key={date} className="px-1 py-1 text-center">
                        <span className="block w-full rounded border border-dashed border-slate-200 px-1 py-1 text-[10px] leading-tight text-slate-300">
                          {tr("not yet", "belum")}
                        </span>
                      </td>
                    );
                  }
                  const day = s.days.find((d) => d.employee_no === e.employee_no && d.work_date === date);
                  if (!day) return <td key={date} />;
                  return (
                    <td key={date} className="px-1 py-1 text-center">
                      <button
                        onClick={() => onOpen(e.employee_no, date)}
                        className={cn(
                          "w-full rounded border px-1 py-1 text-[11px] leading-tight transition-colors hover:brightness-95",
                          isShort(day) ? SHORT_CELL : CELL[day.state],
                        )}
                        title={day.issues.join(" · ") || day.mark?.reason || day.notes.join(" · ") || ""}
                      >
                        {day.overnight && day.state !== "off" && (
                          <Moon className="mr-0.5 inline h-2.5 w-2.5 align-[-1px]" aria-label={tr("night shift", "shift malam")} />
                        )}
                        {day.state === "off" ? "—"
                          : day.state === "marked" ? DAY_MARK_SHORT[day.mark!.kind]
                            : day.state === "review" ? tr(`${day.scans.length} tap`, `${day.scans.length} tap`)
                              : formatNumber(day.work_hours)}
                        {(day.pay_multiplier ?? 1) > 1 && day.day_value > 0 && (
                          <span className="ml-0.5 text-[9px] font-semibold text-amber-700">×{day.pay_multiplier}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <TotalCell total={s.totals.find((t) => t.employee_no === e.employee_no)} />
                <PayCell line={lineOf.get(e.employee_no)} monthly={group === "monthly"} loading={pay === null && !payFailed} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50/50">
              <th scope="row" colSpan={s.dates.length + 1} className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {tr(`All ${members.length}`, `Semua ${members.length}`)}
              </th>
              <td className="border-l border-slate-200 px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-slate-800">
                {tr(`${formatNumber(hoursSum)} h`, `${formatNumber(hoursSum)} jam`)}
              </td>
              <td className="sticky right-0 border-l border-slate-200 bg-slate-50 px-3 py-2 text-right">
                {pay && (
                  <>
                    <span className="block text-[13px] font-bold tabular-nums text-slate-800">
                      {group === "weekly" ? formatIDR(weeklySum) : `+ ${formatIDR(monthlyAdd)}`}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {group === "weekly" ? tr("gross, these days", "bruto, hari-hari ini") : tr("allowance + overtime, these days", "tunjangan + lembur, hari-hari ini")}
                    </span>
                  </>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {payFailed && (
        <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-amber-800">
          {tr("The estimate could not be computed. ", "Estimasi tidak bisa dihitung. ")}
          <button className="underline" onClick={onRetryPay}>{tr("Try again", "Coba lagi")}</button>
        </p>
      )}
      {pager}
      <p className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-emerald-800">{tr("hours", "jam")}</span> {tr("read cleanly", "terbaca bersih")}
        <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-amber-900">{tr("n tap", "n tap")}</span> {tr("needs reading", "perlu dibaca")}
        <span className="rounded border border-violet-200 bg-violet-50 px-1.5 text-violet-800">{tr("marked", "ditandai")}</span> {tr("HRD said what happened", "HRD menyatakan apa yang terjadi")}
        <span className="rounded border border-rose-300 bg-rose-50 px-1.5 text-rose-800">{tr("hours", "jam")}</span> {tr("short of the schedule — late or left early", "kurang dari jadwal — telat atau pulang cepat")}
        <span className="rounded border border-slate-100 bg-slate-50 px-1.5 text-slate-400">—</span> {tr("no tap at all", "tidak ada tap sama sekali")}
        <span><span className="font-semibold text-amber-700">×2</span> {tr("paid at the schedule's multiplier", "dibayar dengan pengali jadwal")}</span>
        <span className="inline-flex items-center gap-1"><Moon className="h-3 w-3 text-indigo-600" /> {tr("night shift, counted on the day it started", "shift malam, dihitung pada hari mulainya")}</span>
      </p>
    </Card>
  );
}

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** `Sab 26/09`. */
function dayLabel(d: string): string {
  return `${DAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8)}/${d.slice(5, 7)}`;
}

/** Every day from `from` to `to`, both included. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

/** What the days are worth — the payroll line for exactly these days. For a
 *  day rate that is the pay; for a salary it is the month, plus what these
 *  days add. A figure with unread days beside it says so (it is too low). */
function PayCell({ line, monthly, loading }: { line?: PayrollLine; monthly: boolean; loading: boolean }) {
  const tr = useTr();
  if (!line) {
    return (
      <td className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-1.5 text-right text-[11px] text-slate-400">
        {loading ? "…" : "—"}
      </td>
    );
  }
  return (
    <td className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-1.5 text-right" data-testid="pay-cell">
      {monthly ? (
        <>
          <span className="block text-[13px] font-semibold tabular-nums text-slate-800">{formatIDR(line.base_pay)}</span>
          <span className="block text-[10px] text-slate-400">{tr("per month", "per bulan")}</span>
          {(line.allowance_pay > 0 || line.overtime_pay > 0) && (
            <span className="block text-[10px] tabular-nums text-slate-500">
              + {formatIDR(line.allowance_pay + line.overtime_pay)} {tr("these days", "hari ini")}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="block text-[13px] font-semibold tabular-nums text-slate-800">{formatIDR(line.gross)}</span>
          <span className="block text-[10px] tabular-nums text-slate-400">
            {formatIDR(line.base_pay)}{line.allowance_pay > 0 && ` + ${formatIDR(line.allowance_pay)}`}{line.overtime_pay > 0 && ` + ${tr("OT", "lembur")} ${formatIDR(line.overtime_pay)}`}
          </span>
        </>
      )}
      {line.days_open > 0 && (
        <span className="mt-0.5 block text-[10px] font-medium text-amber-700">
          {tr(`${line.days_open} day(s) unread — too low`, `${line.days_open} hari belum dibaca — masih kurang`)}
        </span>
      )}
    </td>
  );
}
