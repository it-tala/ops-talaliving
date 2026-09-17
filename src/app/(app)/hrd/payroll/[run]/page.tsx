"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Printer, AlertTriangle, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { PayrollLine } from "@/services/hr/contracts";
import { Adjustments } from "./Adjustments";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** One run, line by line, with what each figure is made of.
 *
 *  Nothing here is stored. Every number is computed from the days and the
 *  approved overtime at the moment it is read (A3), which is why an open day
 *  changes the figure the instant somebody closes it — and why approving a run
 *  is refused while any are open (D139).
 */
/** A date, some days later or earlier. UTC arithmetic on a string, because the
 *  office day is not the browser's day (F17). */
function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export default function PayrollRunPage({ params }: { params: { run: string } }) {
  const runNo = decodeURIComponent(params.run);
  const { hasAuthority } = useSession();
  const { toast } = useToast();
  const [detail, reload] = useLoad(() => hr.getPayroll(runNo), [runNo]);
  const [busy, setBusy] = useState(false);
  const mayApprove = hasAuthority("approve_funds");

  async function approve() {
    setBusy(true);
    const res = await hr.approvePayroll(runNo);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not approved", res.error.message);
      return;
    }
    toast("success", `${runNo} approved`, "It can be paid from the ledger.");
    reload();
  }

  const columns: Column<PayrollLine>[] = [
    {
      key: "who", header: "Employee", className: "whitespace-normal",
      render: (l) => (
        <div className="max-w-[240px]">
          <p className="font-medium text-slate-800">{l.full_name}</p>
          <p className="text-[12px] text-slate-500">{l.position}</p>
          <p className="font-mono text-[10px] text-slate-400">{l.employee_no}</p>
        </div>
      ),
    },
    {
      key: "basis", header: "Basis", align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right text-[12px] text-slate-600">
          {l.pay_basis === "monthly" ? "salary" : `${formatNumber(l.days_worked)} day(s)`}
          <p className="text-[11px] text-slate-400">
            {l.pay_basis === "monthly" ? formatIDR(l.base_rate) : `${formatIDR(l.base_rate)} / day`}
          </p>
          {/* What the paid days are made of. A total nobody can take apart is
              the one an employee argues with (D144). */}
          {(l.days_sick_paid > 0 || l.days_leave_paid > 0) && (
            <p className="text-[11px] text-emerald-700">
              {[
                l.days_sick_paid > 0 ? `${formatNumber(l.days_sick_paid)} sakit (surat)` : null,
                l.days_leave_paid > 0 ? `${formatNumber(l.days_leave_paid)} cuti berbayar` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {l.days_unpaid > 0 && (
            <p className="text-[11px] text-slate-400">{formatNumber(l.days_unpaid)} hari tidak dibayar</p>
          )}
        </div>
      ),
    },
    {
      key: "base", header: "Pokok", align: "right",
      render: (l) => <span className="whitespace-nowrap tabular-nums text-slate-800">{formatIDR(l.base_pay)}</span>,
    },
    {
      key: "allowance", header: "Tunjangan", align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className={cn("tabular-nums", l.allowance_pay > 0 ? "text-slate-800" : "text-slate-300")}>
            {formatIDR(l.allowance_pay)}
          </span>
          {l.allowance_rate > 0 && (
            <p className="text-[11px] text-slate-500">{formatNumber(l.allowance_days)} hari hadir</p>
          )}
          {/* The days HRD took it off, counted here and explained on the slip
              (D250) — a smaller number with no reason beside it is the one
              somebody comes back about. */}
          {l.allowance_withheld_days > 0 && (
            <p className="text-[11px] text-amber-700">
              −{formatNumber(l.allowance_withheld_days)} hari ditahan
            </p>
          )}
        </div>
      ),
    },
    {
      key: "ot", header: "Overtime", align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className={cn("tabular-nums", l.overtime_pay > 0 ? "text-slate-800" : "text-slate-300")}>
            {formatIDR(l.overtime_pay)}
          </span>
          {l.overtime_hours > 0 && <p className="text-[11px] text-slate-500">{formatNumber(l.overtime_hours)} h approved</p>}
          {/* Which ladder produced it (D173). */}
          {l.overtime_parts.length > 0 && (
            <p className="text-[11px] text-slate-400">
              {l.overtime_parts.map((p) => (p.multiplier > 0 ? `${formatNumber(p.hours)}×${formatNumber(p.multiplier)}` : "form")).join(" + ")}
            </p>
          )}
          {l.overtime_pending_hours > 0 && (
            <p className="text-[11px] text-amber-700">{formatNumber(l.overtime_pending_hours)} h waiting</p>
          )}
        </div>
      ),
    },
    {
      key: "adj", header: "Penyesuaian", align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          {l.adjustment_total === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <>
              <span className={cn("tabular-nums", l.adjustment_total < 0 ? "text-rose-700" : "text-emerald-700")}>
                {l.adjustment_total < 0 ? `(${formatIDR(-l.adjustment_total)})` : formatIDR(l.adjustment_total)}
              </span>
              <p className="text-[11px] text-slate-500">{l.adjustments.map((a) => a.label).join(", ")}</p>
            </>
          )}
          {l.late_minutes > 0 && l.adjustments.every((a) => a.kind !== "late") && (
            <p className="text-[11px] text-amber-700">terlambat {l.late_minutes} mnt, belum dipotong</p>
          )}
        </div>
      ),
    },
    {
      key: "gross", header: "Diterima", align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums font-semibold text-slate-900">{formatIDR(l.net)}</span>
          {l.net !== l.gross && (
            <p className="text-[11px] text-slate-500">bruto {formatIDR(l.gross)}</p>
          )}
        </div>
      ),
    },
    {
      key: "warn", header: "", className: "whitespace-normal",
      render: (l) => l.warnings.length === 0 ? null : (
        <span className="block max-w-[240px] whitespace-normal text-[11px] text-amber-700">
          {l.warnings.join(" · ")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <Link href="/hrd/payroll" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> All runs
      </Link>

      <Loaded state={detail} onRetry={reload}>
        {(d) => (
          <>
            <PageHeader
              breadcrumb="Payroll"
              title={d.run_no}
              description={`${d.period_start} → ${d.period_end} · ${d.lines.length} people`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge state={detail} />
                  {/* Walking to the week before or after this run. A run is a
                      document over a period; the period exists whether or not
                      anybody opened one, so the arrows never dead-end (D158). */}
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, -7)}`}>
                    <Button variant="outline" size="sm" icon={ChevronLeft}>Minggu sebelumnya</Button>
                  </Link>
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, 7)}`}>
                    <Button variant="outline" size="sm">
                      Minggu berikutnya <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline" icon={Printer}
                    onClick={() => window.open(`/hrd/payroll/${encodeURIComponent(d.run_no)}/payslip`, "_blank", "noopener")}
                  >
                    Payslips
                  </Button>
                  {mayApprove && d.status === "DRAFT" && (
                    <Button icon={Check} disabled={busy} onClick={approve}>
                      {busy ? "Approving…" : "Approve the run"}
                    </Button>
                  )}
                </div>
              }
            />

            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  ["Gross", formatIDR(d.gross_total), "before any deduction"],
                  ["Diterima", formatIDR(d.net_total),
                    d.adjustment_total === 0 ? "tidak ada penyesuaian"
                      : `${d.adjustment_total < 0 ? "−" : "+"}${formatIDR(Math.abs(d.adjustment_total))} penyesuaian tangan`],
                  ["People", String(d.lines.length), "employed during the period"],
                  ["Days unread", String(d.open_days), d.open_days > 0 ? "must be read before approval" : "every day has been read"],
                  ["Overtime waiting", `${formatNumber(d.pending_overtime_hours)} h`, "claimed, not approved — not in the figures"],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      (k === "Open days" && d.open_days > 0) || (k === "Overtime waiting" && d.pending_overtime_hours > 0)
                        ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                <strong className="text-slate-700">Gross only.</strong> BPJS and PPh 21 are not
                computed — nobody has told us which apply, at what rate, or who pays which half.
              </p>
            </div>

            {d.open_days > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {d.open_days} day(s) in this period are still unread — the machine left them
                  incomplete and nobody has said what happened. The figures below are computable
                  and not trustworthy, and the people they are wrong about are paid by the day.
                </span>
                <Link href="/hrd/absensi" className="ml-auto">
                  <Button size="sm" variant="outline">Read them</Button>
                </Link>
              </div>
            )}

            {d.pending_overtime_hours > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                <span>
                  {formatNumber(d.pending_overtime_hours)} overtime hour(s) are claimed and not
                  approved. They are not in any figure here — approve them and the gross moves.
                </span>
              </div>
            )}

            <Adjustments
              runNo={d.run_no}
              editable={d.status === "DRAFT"}
              onChanged={reload}
            />

            <Card>
              <CardHeader
                title="Every line"
                subtitle="Computed from the days and the approved overtime, each time this page is read."
                icon={Check}
              />
              <DataTable
                dense columns={columns} rows={d.lines} rowKey={(l) => l.employee_no}
                empty="Nobody was employed during this period."
                footer={
                  <tr>
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-slate-700" colSpan={4}>Gross total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">
                      {formatIDR(d.gross_total)}
                    </td>
                    <td />
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
