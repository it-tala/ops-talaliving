"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarRange, Plus, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { PayrollLine } from "@/services/hr/contracts";
import { PAY_WEEK_STARTS_DEFAULT } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr, type Tr } from "@/lib/i18n";

/** One week of wages, and the arrows to walk to the next one.
 *
 *  The workshop is paid weekly, so the question is *what does this week look
 *  like* rather than *what does run pyr-26-09-06_01 look like* (owner). The
 *  figures are derived from the days either way (A3), which is what makes
 *  walking backwards possible at all: a week nobody opened a run for still has
 *  a payroll, it simply has no document.
 *
 *  Where a run exists, this screen shows that run — its status, and the
 *  adjustments HRD typed against it, which belong to the run and not to the
 *  week (D155). Where none exists it says so, and offers to open one (D158).
 */

/** Monday of the week a date falls in. Dates are walked as strings and the
 *  arithmetic is done in UTC, because the office day is not the browser's day
 *  (F17). */
function mondayOf(key: string): string {
  return weekStartOf(key, 1);
}

/** The first day of the pay week a date falls in, for a week that starts on
 *  ISO weekday `isodow` (1 Senin … 7 Minggu). The workshop's week runs
 *  Sabtu–Jumat (6), the way the payroll sheet pays it — read from the rule
 *  book's `pay_week_starts_isodow` (D340), never assumed here. */
function weekStartOf(key: string, isodow: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const js = new Date(t).getUTCDay();
  const dow = js === 0 ? 7 : js;
  return iso(t - ((dow - isodow + 7) % 7) * 86_400_000);
}

function shift(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return iso(Date.UTC(y, m - 1, d) + days * 86_400_000);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `31 Agu – 6 Sep 2026`, the way a week is said out loud. */
function periodLabel(from: string, to: string, tr: Tr): string {
  const [, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const left = `${fd} ${tr(MONTH_EN[fm - 1], MONTH[fm - 1])}`;
  const right = `${td} ${tr(MONTH_EN[tm - 1], MONTH[tm - 1])} ${ty}`;
  return `${left} – ${right}`;
}

export default function PayrollWeekPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  /* The week containing today, which is the one somebody almost always wants
     when they open this screen — unless a link named one, which is how the run
     screen hands over the week it is showing. Read straight off the address
     rather than through `useSearchParams`, which would put the whole screen
     behind a Suspense boundary for one optional date. */
  const [weekStart, setWeekStart] = useState(() => {
    const asked = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("from");
    return mondayOf(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)
      ? asked
      : new Date().toISOString().slice(0, 10));
  });
  const weekEnd = shift(weekStart, 6);

  /* Which weekday a pay week starts on is the rule book's to say (D340). */
  const [books] = useLoad(() => hr.listPayRules(), []);
  const startDow = (() => {
    if (books.status !== "ready") return PAY_WEEK_STARTS_DEFAULT;
    const today = new Date().toISOString().slice(0, 10);
    const inForce = [...books.data]
      .filter((b) => b.effective_from <= today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.version - b.version)
      .pop();
    return inForce?.rules.pay_week_starts_isodow ?? PAY_WEEK_STARTS_DEFAULT;
  })();
  useEffect(() => {
    setWeekStart((w) => weekStartOf(w, startDow));
  }, [startDow]);

  /* Walking a week changes the address too, so a reload or a shared link lands
     on the week somebody was actually looking at. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", weekStart);
    window.history.replaceState(null, "", url.toString());
  }, [weekStart]);
  const [view, reload] = useLoad(
    () => hr.previewPayroll({ period_start: weekStart, period_end: weekEnd }),
    [weekStart, weekEnd],
  );
  const [busy, setBusy] = useState(false);
  const mayRun = can("payroll.run");

  async function open() {
    setBusy(true);
    const res = await hr.openPayroll({ period_start: weekStart, period_end: weekEnd });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not opened", "Tidak dibuka"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`${res.data.run_no} opened`, `${res.data.run_no} dibuka`),
      tr(`${res.data.lines.length} people · ${formatIDR(res.data.gross_total)} gross`, `${res.data.lines.length} orang · ${formatIDR(res.data.gross_total)} bruto`),
    );
    reload();
  }

  const columns: Column<PayrollLine>[] = [
    {
      key: "who", header: tr("Employee", "Karyawan"), className: "whitespace-normal",
      render: (l) => (
        <div className="max-w-[220px]">
          <p className="font-medium text-slate-800">{l.full_name}</p>
          <p className="text-[12px] text-slate-500">{l.position}</p>
          <p className="font-mono text-[10px] text-slate-400">{l.employee_no}</p>
        </div>
      ),
    },
    {
      key: "basis", header: tr("Basis", "Dasar"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right text-[12px] text-slate-600">
          {l.pay_basis === "monthly" ? tr("monthly", "bulanan") : tr(`${formatNumber(l.days_worked)} days`, `${formatNumber(l.days_worked)} hari`)}
          <p className="text-[11px] text-slate-400">
            {l.pay_basis === "monthly" ? formatIDR(l.base_rate) : tr(`${formatIDR(l.base_rate)} / day`, `${formatIDR(l.base_rate)} / hari`)}
          </p>
          {l.days_open > 0 && (
            <p className="text-[11px] text-amber-700">{tr(`${l.days_open} days not yet read`, `${l.days_open} hari belum dibaca`)}</p>
          )}
        </div>
      ),
    },
    {
      key: "ot", header: tr("Overtime", "Lembur"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className={cn("tabular-nums", l.overtime_pay > 0 ? "text-slate-800" : "text-slate-300")}>
            {formatIDR(l.overtime_pay)}
          </span>
          {l.overtime_hours > 0 && <p className="text-[11px] text-slate-500">{tr(`${formatNumber(l.overtime_hours)} h approved`, `${formatNumber(l.overtime_hours)} jam disetujui`)}</p>}
        </div>
      ),
    },
    {
      key: "net", header: tr("Take-home", "Diterima"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className="font-semibold tabular-nums text-slate-900">{formatIDR(l.net)}</span>
          {l.net !== l.gross && <p className="text-[11px] text-slate-500">{tr(`gross ${formatIDR(l.gross)}`, `bruto ${formatIDR(l.gross)}`)}</p>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Link href="/hrd/payroll" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All runs", "Semua run")}
      </Link>

      <PageHeader
        breadcrumb={tr("HRD · Payroll", "HRD · Penggajian")}
        title={tr("Weekly payroll", "Gajian mingguan")}
        description={tr(
          "One pay week, starting on the weekday the rule book sets. The figures are computed from attendance and approved overtime each time this screen opens — a week with no run yet can still be seen.",
          "Satu minggu gaji, mulai hari yang ditetapkan buku aturan. Angkanya dihitung dari absensi dan lembur yang disetujui setiap kali layar ini dibuka — minggu yang belum dibuatkan run pun tetap bisa dilihat.",
        )}
        actions={<SourceBadge state={view} />}
      />

      {/* The slider itself. Today's week is one click away however far back
          somebody has walked. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-card">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => setWeekStart(shift(weekStart, -7))}>
            {tr("Last week", "Minggu lalu")}
          </Button>
          <div className="px-2 text-center">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
              <CalendarRange className="h-4 w-4 text-slate-400" />
              {periodLabel(weekStart, weekEnd, tr)}
            </p>
            <p className="font-mono text-[10px] text-slate-400">{weekStart} → {weekEnd}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(shift(weekStart, 7))}>
            {tr("Next week", "Minggu depan")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => setWeekStart(weekStartOf(new Date().toISOString().slice(0, 10), startDow))}
        >
          {tr("This week", "Minggu ini")}
        </Button>
      </div>

      <Loaded state={view} onRetry={reload}>
        {(d) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  [tr("Gross", "Bruto"), formatIDR(d.gross_total), tr("before any deduction", "sebelum potongan apa pun")],
                  [tr("Take-home", "Diterima"), formatIDR(d.net_total),
                    d.adjustment_total === 0 ? tr("no adjustments", "tidak ada penyesuaian")
                      : tr(
                        `${d.adjustment_total < 0 ? "−" : "+"}${formatIDR(Math.abs(d.adjustment_total))} manual adjustments`,
                        `${d.adjustment_total < 0 ? "−" : "+"}${formatIDR(Math.abs(d.adjustment_total))} penyesuaian tangan`,
                      )],
                  [tr("People", "Orang"), String(d.lines.length), tr("working this week", "bekerja di minggu ini")],
                  [tr("Days unread", "Hari belum dibaca"), String(d.open_days),
                    d.open_days > 0
                      ? tr("must be read before approval", "harus dibaca sebelum disetujui")
                      : tr("every day has been read", "semua hari sudah dibaca")],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      k === tr("Days unread", "Hari belum dibaca") && d.open_days > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
            </div>

            {/* Whether this week is a document yet. */}
            <div className={cn(
              "mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-[13px]",
              d.opened ? "border-slate-200 bg-white text-slate-600" : "border-amber-200 bg-amber-50/70 text-amber-900",
            )}>
              {d.opened ? (
                <>
                  <Badge tone={d.status === "PAID" ? "green" : d.status === "APPROVED" ? "brand" : "slate"}>
                    {d.status}
                  </Badge>
                  <span>
                    {tr("This week already has run", "Minggu ini sudah punya run")}{" "}
                    <span className="font-mono">{d.run_no}</span>{" "}
                    {tr(
                      "— its adjustments, approval and payslips are there.",
                      "— penyesuaian, persetujuan dan slip gajinya ada di sana.",
                    )}
                  </span>
                  <Link href={`/hrd/payroll/${encodeURIComponent(d.run_no)}`} className="ml-auto">
                    <Button size="sm" variant="outline">{tr("Open run", "Buka run")}</Button>
                  </Link>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {tr(
                      "No run for this week yet. The figures below are computed from attendance, but there is no document yet: it cannot be approved, and its payslips cannot be printed.",
                      "Belum ada run untuk minggu ini. Angka di bawah dihitung dari absensi, tapi belum ada dokumen: tidak bisa disetujui, dan slip gajinya belum bisa dicetak.",
                    )}
                  </span>
                  {mayRun && (
                    <Button size="sm" icon={Plus} disabled={busy} onClick={open} className="ml-auto">
                      {busy ? tr("Opening…", "Membuka…") : tr("Open this week's run", "Buka run minggu ini")}
                    </Button>
                  )}
                </>
              )}
            </div>

            <Card>
              <CardHeader
                title={tr("Per person", "Per orang")}
                subtitle={tr(
                  "Recomputed each time this screen opens, from working days and approved overtime.",
                  "Dihitung ulang setiap kali layar ini dibuka, dari hari kerja dan lembur yang sudah disetujui.",
                )}
                icon={CalendarRange}
              />
              <DataTable
                dense columns={columns} rows={d.lines} rowKey={(l) => l.employee_no}
                pageSize={15}
                empty={tr("No employees this week.", "Tidak ada karyawan di minggu ini.")}
                footer={
                  <tr>
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-slate-700" colSpan={3}>
                      {tr(`Total take-home · ${d.lines.length} people`, `Total diterima · ${d.lines.length} orang`)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">
                      {formatIDR(d.net_total)}
                    </td>
                  </tr>
                }
              />
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}
