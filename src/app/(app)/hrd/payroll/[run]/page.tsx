"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Printer, AlertTriangle, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { PayrollLine } from "@/services/hr/contracts";
import { PAY_COMPONENT_LABEL, DEDUCTION_COMPONENTS } from "@/services/hr/contracts";
import { Adjustments } from "./Adjustments";
import { Members } from "./Members";
import { PayRun } from "./PayRun";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

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

export default function PayrollRunPage({ params }: { params: Promise<{ run: string }> }) {
  /* Next 15 hands route params to the page as a promise, so it can start
     rendering before the segment is resolved. `use` unwraps it here — the
     rest of the component reads the same plain string it always did. */
  const { run } = use(params);
  const runNo = decodeURIComponent(run);
  const { hasAuthority } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [detail, reload] = useLoad(() => hr.getPayroll(runNo), [runNo]);
  const [busy, setBusy] = useState(false);
  const mayApprove = hasAuthority("approve_funds");

  async function approve() {
    setBusy(true);
    const res = await hr.approvePayroll(runNo);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not approved", "Tidak disetujui"), res.error.message);
      return;
    }
    toast("success", tr(`${runNo} approved`, `${runNo} disetujui`), tr("It can be paid from the ledger.", "Sudah bisa dibayar dari buku besar."));
    reload();
  }

  const columns: Column<PayrollLine>[] = [
    {
      key: "who", header: tr("Employee", "Karyawan"), className: "whitespace-normal",
      render: (l) => (
        <div className="max-w-[240px]">
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
          {l.pay_basis === "monthly" ? tr("salary", "gaji bulanan") : tr(`${formatNumber(l.days_worked)} day(s)`, `${formatNumber(l.days_worked)} hari`)}
          <p className="text-[11px] text-slate-400">
            {l.pay_basis === "monthly" ? formatIDR(l.base_rate) : tr(`${formatIDR(l.base_rate)} / day`, `${formatIDR(l.base_rate)} / hari`)}
          </p>
          {/* What the paid days are made of. A total nobody can take apart is
              the one an employee argues with (D144). */}
          {(l.days_sick_paid > 0 || l.days_leave_paid > 0) && (
            <p className="text-[11px] text-emerald-700">
              {[
                l.days_sick_paid > 0 ? tr(`${formatNumber(l.days_sick_paid)} sick (with note)`, `${formatNumber(l.days_sick_paid)} sakit (surat)`) : null,
                l.days_leave_paid > 0 ? tr(`${formatNumber(l.days_leave_paid)} paid leave`, `${formatNumber(l.days_leave_paid)} cuti berbayar`) : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {l.days_unpaid > 0 && (
            <p className="text-[11px] text-slate-400">{tr(`${formatNumber(l.days_unpaid)} unpaid days`, `${formatNumber(l.days_unpaid)} hari tidak dibayar`)}</p>
          )}
        </div>
      ),
    },
    {
      key: "base", header: tr("Base", "Pokok"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums text-slate-800">{formatIDR(l.base_pay)}</span>
          {/* A salary less than a month, and why: the working days it is
              paid for, month by month (0211, D369). */}
          {l.pay_basis === "monthly" && (l.proration ?? []).some((m) => m.paid_days !== m.workdays) && (
            <>
              {(l.proration ?? []).map((m) => (
                <p key={m.month} className="text-[11px] text-slate-500">
                  {tr(`${m.paid_days}/${m.workdays} working days ${m.month}`, `${m.paid_days}/${m.workdays} hari kerja ${m.month}`)}
                </p>
              ))}
              {(l.proration ?? []).some((m) => m.absent_days > 0) && (
                <p className="text-[11px] text-rose-700">
                  {tr(
                    `−${(l.proration ?? []).reduce((a, m) => a + m.absent_days, 0)} unpaid day(s)`,
                    `−${(l.proration ?? []).reduce((a, m) => a + m.absent_days, 0)} hari tidak dibayar`,
                  )}
                </p>
              )}
            </>
          )}
          {/* Components switched off for this line, by the run or for the
              person, and what they would have been. */}
          {(l.components_off ?? []).filter((o) => o.amount !== 0 || o.scope === "person").map((o) => (
            <p key={o.component} className="text-[11px] text-amber-700">
              {PAY_COMPONENT_LABEL[o.component]}: {DEDUCTION_COMPONENTS.has(o.component)
                ? tr("not deducted", "tidak dipotong") : tr("not paid", "tidak dibayar")}
              {o.amount !== 0 ? ` (${formatIDR(Math.abs(o.amount))})` : ""}
            </p>
          ))}
        </div>
      ),
    },
    {
      key: "allowance", header: tr("Allowance", "Tunjangan"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className={cn("tabular-nums", l.allowance_pay > 0 ? "text-slate-800" : "text-slate-300")}>
            {formatIDR(l.allowance_pay)}
          </span>
          {l.allowance_rate > 0 && (
            <p className="text-[11px] text-slate-500">{tr(`${formatNumber(l.allowance_days)} days present`, `${formatNumber(l.allowance_days)} hari hadir`)}</p>
          )}
          {/* The days HRD took it off, counted here and explained on the slip
              (D250) — a smaller number with no reason beside it is the one
              somebody comes back about. */}
          {l.allowance_withheld_days > 0 && (
            <p className="text-[11px] text-amber-700">
              {tr(`−${formatNumber(l.allowance_withheld_days)} days withheld`, `−${formatNumber(l.allowance_withheld_days)} hari ditahan`)}
            </p>
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
          {/* Which ladder produced it (D173). */}
          {l.overtime_parts.length > 0 && (
            <p className="text-[11px] text-slate-400">
              {l.overtime_parts.map((p) => (p.multiplier > 0 ? `${formatNumber(p.hours)}×${formatNumber(p.multiplier)}` : tr("form", "form"))).join(" + ")}
            </p>
          )}
          {l.overtime_pending_hours > 0 && (
            <p className="text-[11px] text-amber-700">{tr(`${formatNumber(l.overtime_pending_hours)} h waiting`, `${formatNumber(l.overtime_pending_hours)} jam menunggu`)}</p>
          )}
        </div>
      ),
    },
    {
      key: "adj", header: tr("Adjustments", "Penyesuaian"), align: "right",
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
            <p className="text-[11px] text-amber-700">{tr(`late ${l.late_minutes} min, not yet deducted`, `terlambat ${l.late_minutes} mnt, belum dipotong`)}</p>
          )}
        </div>
      ),
    },
    {
      key: "gross", header: tr("Take-home", "Diterima"), align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums font-semibold text-slate-900">{formatIDR(l.net)}</span>
          {l.net !== l.gross && (
            <p className="text-[11px] text-slate-500">{tr(`gross ${formatIDR(l.gross)}`, `bruto ${formatIDR(l.gross)}`)}</p>
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
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All runs", "Semua periode gaji")}
      </Link>

      <Loaded state={detail} onRetry={reload}>
        {(d) => (
          <>
            <PageHeader
              breadcrumb={tr("Payroll", "Penggajian")}
              title={d.run_no}
              description={tr(`${d.period_start} → ${d.period_end} · ${d.lines.length} people on this run`, `${d.period_start} → ${d.period_end} · ${d.lines.length} orang di run ini`)}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge state={detail} />
                  {/* Walking to the week before or after this run. A run is a
                      document over a period; the period exists whether or not
                      anybody opened one, so the arrows never dead-end (D158). */}
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, -7)}`}>
                    <Button variant="outline" size="sm" icon={ChevronLeft}>{tr("Previous week", "Minggu sebelumnya")}</Button>
                  </Link>
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, 7)}`}>
                    <Button variant="outline" size="sm">
                      {tr("Next week", "Minggu berikutnya")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline" icon={Printer}
                    onClick={() => window.open(`/hrd/payroll/${encodeURIComponent(d.run_no)}/payslip`, "_blank", "noopener")}
                  >
                    {tr("Payslips", "Slip gaji")}
                  </Button>
                  {mayApprove && d.status === "DRAFT" && (
                    <Button icon={Check} disabled={busy} onClick={approve}>
                      {busy ? tr("Approving…", "Menyetujui…") : tr("Approve the run", "Setujui periode gaji")}
                    </Button>
                  )}
                </div>
              }
            />

            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  [tr("Gross", "Bruto"), formatIDR(d.gross_total), tr("before any deduction", "sebelum potongan apa pun"), false],
                  [tr("Take-home", "Diterima"), formatIDR(d.net_total),
                    d.adjustment_total === 0 ? tr("no adjustments", "tidak ada penyesuaian")
                      : tr(
                        `${d.adjustment_total < 0 ? "−" : "+"}${formatIDR(Math.abs(d.adjustment_total))} manual adjustments`,
                        `${d.adjustment_total < 0 ? "−" : "+"}${formatIDR(Math.abs(d.adjustment_total))} penyesuaian tangan`,
                      ), false],
                  [tr("People", "Orang"), String(d.lines.length), tr("on this run", "ikut run ini"), false],
                  [tr("Days unread", "Hari belum dibaca"), String(d.open_days), d.open_days > 0
                    ? tr("must be read before approval", "harus dibaca sebelum disetujui")
                    : tr("every day has been read", "semua hari sudah dibaca"), d.open_days > 0],
                  [tr("Overtime waiting", "Lembur menunggu"), tr(`${formatNumber(d.pending_overtime_hours)} h`, `${formatNumber(d.pending_overtime_hours)} jam`), tr("claimed, not approved — not in the figures", "diajukan, belum disetujui — tidak masuk angka"), d.pending_overtime_hours > 0],
                /* The fourth field says whether the figure needs attention. It
                   used to be decided by comparing the label's text, and the
                   *Days unread* tile never lit because its label had been
                   renamed from *Open days* (F172). */
                ] as [string, string, string, boolean][]).map(([k, v, note, warn]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      warn ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                <strong className="text-slate-700">{tr("Gross only.", "Hanya bruto.")}</strong>{" "}
                {tr(
                  "BPJS and PPh 21 are not computed — nobody has told us which apply, at what rate, or who pays which half.",
                  "BPJS dan PPh 21 tidak dihitung — belum ada yang memberi tahu mana yang berlaku, berapa tarifnya, atau siapa menanggung bagian mana.",
                )}
              </p>
            </div>

            {d.open_days > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {tr(
                    `${d.open_days} day(s) in this period are still unread — the machine left them incomplete and nobody has said what happened. The figures below are computable and not trustworthy, and the people they are wrong about are paid by the day.`,
                    `${d.open_days} hari di periode ini belum dibaca — mesin meninggalkannya tidak lengkap dan belum ada yang menjelaskan apa yang terjadi. Angka di bawah bisa dihitung tapi belum bisa dipercaya, dan orang yang terdampak dibayar per hari.`,
                  )}
                </span>
                <Link href="/hrd/absensi" className="ml-auto">
                  <Button size="sm" variant="outline">{tr("Read them", "Baca sekarang")}</Button>
                </Link>
              </div>
            )}

            {d.pending_overtime_hours > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                <span>
                  {tr(
                    `${formatNumber(d.pending_overtime_hours)} overtime hour(s) are claimed and not approved. They are not in any figure here — approve them and the gross moves.`,
                    `${formatNumber(d.pending_overtime_hours)} jam lembur diajukan dan belum disetujui. Jam itu tidak masuk angka mana pun di sini — setujui dan bruto akan berubah.`,
                  )}
                </span>
              </div>
            )}

            <PayRun run={d} onPosted={reload} />

            <Members
              key={`${d.run_no}:${JSON.stringify(d.components ?? {})}:${d.components_note ?? ""}`}
              run={d}
              editable={d.status === "DRAFT"}
              onChanged={reload}
            />

            <Adjustments
              runNo={d.run_no}
              editable={d.status === "DRAFT"}
              onChanged={reload}
            />

            <Card>
              <CardHeader
                title={tr("Every line", "Semua baris")}
                subtitle={tr("Computed from the days and the approved overtime, each time this page is read.", "Dihitung dari hari kerja dan lembur yang disetujui, setiap kali halaman ini dibaca.")}
                icon={Check}
              />
              <DataTable
                dense columns={columns} rows={d.lines} rowKey={(l) => l.employee_no}
                empty={tr("Nobody was employed during this period.", "Tidak ada yang bekerja selama periode ini.")}
                footer={
                  <tr>
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-slate-700" colSpan={4}>{tr("Gross total", "Total bruto")}</td>
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
