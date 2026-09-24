"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Upload, AlertTriangle, Clock, Flag, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { mondayOf, officeToday, shiftDay } from "@/lib/office";
import { isLiveMode } from "@/lib/live";
import { hr } from "@/demo/api";
import type { TimesheetTotal } from "@/services/hr/contracts";
import { DAY_MARK_SHORT, OVERTIME_STAGE_LABEL, type DayState } from "@/services/hr/contracts";
import Link from "next/link";
import { useSession } from "@/store/session";
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
/** Two weeks: the one before this and this one. Last week is the one a
 *  weekly payroll pays, and this week is the one being tapped into. Until F154
 *  this was a constant — the demo's own fortnight, 29 Aug – 7 Sep 2026 — so in
 *  live mode the grid never showed a day anybody could still fix. */
const SPAN_DAYS = 14;

/** Where the grid opens: the last fortnight in live mode; in the demo, the
 *  fortnight its fixtures were recorded in, which is otherwise an empty grid. */
function defaultFrom(): string {
  return isLiveMode() ? mondayOf(shiftDay(officeToday(), -7)) : "2026-08-24";
}

const CELL: Record<DayState, string> = {
  complete: "bg-emerald-50 text-emerald-800 border-emerald-200",
  review: "bg-amber-50 text-amber-900 border-amber-300 font-semibold",
  marked: "bg-violet-50 text-violet-800 border-violet-200",
  off: "bg-slate-50 text-slate-300 border-slate-100",
};

export default function TimesheetPage() {
  const { can, hasAuthority } = useSession();
  /* Read off the address, as the weekly payroll does, so a link (or a reload)
     lands on the fortnight somebody was looking at. */
  const [from, setFrom] = useState(() => {
    const asked = typeof window === "undefined"
      ? null : new URLSearchParams(window.location.search).get("from");
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? mondayOf(asked) : defaultFrom();
  });
  const to = shiftDay(from, SPAN_DAYS - 1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", from);
    window.history.replaceState(null, "", url.toString());
  }, [from]);
  const [sheet, reload] = useLoad(() => hr.getTimesheet({ from, to }), [from, to]);
  const [sheets, reloadSheets] = useLoad(() => hr.listOvertimeSheets(), []);
  const [importing, setImporting] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [open, setOpen] = useState<{ employee_no: string; work_date: string } | null>(null);
  /* The grid pages by person. Computed out here rather than inside the
     `Loaded` callback, which is not always called and so is no place for a
     hook (D157). */
  const { shown: people, pager: peoplePager } = usePaged(
    sheet.status === "ready" ? sheet.data.employees : [],
    12,
  );
  const mayEdit = can("hrd.update");
  const mayLeader = hasAuthority("approve_overtime");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Timesheet"
        description={`${from} → ${to}. Six taps make a full day; the reader gives four on a good one. Amber is a day somebody still has to read.`}
        actions={mayEdit ? (
          <Button icon={Upload} onClick={() => setImporting(true)}>Upload biometric file</Button>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => setFrom(shiftDay(from, -7))}>
          Minggu sebelumnya
        </Button>
        <span className="px-2 font-mono text-[12px] text-slate-500">{from} → {to}</span>
        <Button variant="outline" size="sm" onClick={() => setFrom(shiftDay(from, 7))}>
          Minggu depan <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFrom(defaultFrom())}>
          Dua minggu terakhir
        </Button>
      </div>

      <Loaded state={sheet} onRetry={reload}>
        {(s) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  ["People", String(s.employees.length), "on the machine this period"],
                  ["Days to read", String(s.needs_review), s.needs_review > 0 ? "the machine could not describe these" : "the machine described every day"],
                  ["Marked by HRD", String(s.marked), "holiday, half day, absent, sick"],
                  ["Complete", String(s.days.filter((d) => d.state === "complete").length), "nothing to do"],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      k === "Days to read" && s.needs_review > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              {s.needs_review > 0 && (
                <p className="border-t border-slate-100 bg-amber-50/60 px-4 py-2.5 text-[12px] text-amber-900">
                  A payroll over this period cannot be approved until these are read. Click any amber
                  cell to see the taps the machine actually recorded.
                </p>
              )}
            </div>

            <Card className="mb-4">
              <CardHeader
                title="Every person, every day"
                subtitle="Click a cell for the taps behind it. Click a date to mark the whole day — tanggal merah, setengah hari."
                icon={CalendarCheck}
                action={<SourceBadge state={sheet} />}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="sticky left-0 z-10 bg-slate-50/70 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Employee
                      </th>
                      {s.dates.map((d) => (
                        <th key={d} className="px-2 py-2.5 text-center text-[11px] font-semibold text-slate-500">
                          <button
                            onClick={() => mayEdit && setMarking(d)}
                            className="underline decoration-dotted underline-offset-4 hover:text-brand-700"
                            title="Mark this day for everybody"
                          >
                            {d.slice(8)}/{d.slice(5, 7)}
                          </button>
                        </th>
                      ))}
                      {/* Pertanyaan yang ditanyakan sebelum *hari ini kenapa*:
                          berapa jam, berapa hari. Dijumlahkan di basis data,
                          bukan di sini (0067). */}
                      <th className="sticky right-0 z-10 border-l border-slate-200 bg-slate-50/70 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((e) => (
                      <tr key={e.employee_no} className="border-b border-slate-100">
                        <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-1.5 text-left">
                          <span className="block text-[13px] font-medium text-slate-800">{e.full_name}</span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {e.employee_no} · {e.pay_basis === "monthly" ? "bulanan" : "harian"}
                          </span>
                        </th>
                        {s.dates.map((date) => {
                          const day = s.days.find((d) => d.employee_no === e.employee_no && d.work_date === date);
                          if (!day) return <td key={date} />;
                          return (
                            <td key={date} className="px-1 py-1 text-center">
                              <button
                                onClick={() => setOpen({ employee_no: e.employee_no, work_date: date })}
                                className={cn(
                                  "w-full rounded border px-1 py-1 text-[11px] leading-tight transition-colors hover:brightness-95",
                                  CELL[day.state],
                                )}
                                title={day.issues.join(" · ") || day.mark?.reason || ""}
                              >
                                {day.state === "off" ? "—"
                                  : day.state === "marked" ? DAY_MARK_SHORT[day.mark!.kind]
                                    : day.state === "review" ? `${day.scans.length} tap`
                                      : formatNumber(day.work_hours)}
                              </button>
                            </td>
                          );
                        })}
                        <TotalCell total={s.totals.find((t) => t.employee_no === e.employee_no)} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Forty names today, more next year: the grid pages like every
                  other table rather than growing without limit (D157). */}
              {peoplePager}
              <p className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-emerald-800">hours</span> read cleanly
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-amber-900">n tap</span> needs reading
                <span className="rounded border border-violet-200 bg-violet-50 px-1.5 text-violet-800">marked</span> HRD said what happened
                <span className="rounded border border-slate-100 bg-slate-50 px-1.5 text-slate-400">—</span> no tap at all
              </p>
            </Card>

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
                      title="Lembur"
                      subtitle="Jam lembur tidak dicatat dari mesin — ia datang sebagai lembar, dan lembar itu yang ditandatangani."
                      icon={Clock}
                      action={
                        <Link href="/hrd/lembur">
                          <Button size="sm" variant="outline">Buka lembar lembur</Button>
                        </Link>
                      }
                    />
                    <ul className="divide-y divide-slate-100">
                      {waiting.length === 0 && unreviewed.length === 0 && (
                        <li className="px-5 py-5 text-[13px] text-slate-500">
                          Tidak ada lembar yang menunggu keputusan.
                        </li>
                      )}
                      {[...waiting, ...unreviewed].slice(0, 6).map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className="min-w-[180px] flex-1 text-[13px] text-slate-800">
                            {x.purpose}
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{x.sheet_no} · {x.work_date}</span>
                          </span>
                          <span className="whitespace-nowrap text-[12px] text-slate-600">
                            {x.lines.length} orang · {formatNumber(x.total_hours)} jam
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

      {importing && <ImportScans onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
      {marking && <MarkDay date={marking} onClose={() => setMarking(null)} onDone={() => { setMarking(null); reload(); }} />}
      {open && (
        <DayDrawer
          employeeNo={open.employee_no}
          workDate={open.work_date}
          onClose={() => setOpen(null)}
          onChanged={() => { reload(); }}
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
  if (!total) return <td className="sticky right-0 border-l border-slate-200 bg-white" />;
  return (
    <td className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-1.5 text-right">
      <span className="block text-[13px] font-semibold tabular-nums text-slate-800">
        {formatNumber(total.work_hours)} jam
      </span>
      <span className="block text-[10px] tabular-nums text-slate-400">
        {formatNumber(total.days_counted)} hari
      </span>
      {total.days_review > 0 && (
        <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-amber-700">
          {total.days_review} belum dibaca
        </span>
      )}
    </td>
  );
}
