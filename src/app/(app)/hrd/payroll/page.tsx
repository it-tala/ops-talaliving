"use client";

import Link from "next/link";
import { Wallet, ClipboardList } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import type { PayrollRun } from "@/services/hr/contracts";
import { PAY_GROUP_LABELS } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useTr, useLang } from "@/lib/i18n";

/** Payroll: the runs, and one way to make one (D386).
 *
 *  There were three — *Buka periode gaji* here, *Buat payroll*, and *Gajian
 *  mingguan* — each opening a run its own way. The owner: *buang yang tidak
 *  perlu, sederhanakan.* What is left is the sheet (`/hrd/payroll/buat`, D373):
 *  any group, any week or month, attendance and every rate in view, a box per
 *  person. A run, once made, is opened from this list.
 */
export default function PayrollPage() {
  const { can } = useSession();
  const tr = useTr();
  const [runs, reload] = useLoad(() => hr.listPayrollRuns(), []);
  const lang = useLang();
  const mayRun = can("payroll.run");

  const columns: Column<PayrollRun>[] = [
    {
      key: "run", header: tr("Run", "Periode gaji"),
      render: (r) => (
        <div className="whitespace-nowrap">
          <p className="font-mono text-[13px] font-medium text-slate-800">{r.run_no}</p>
          <p className="text-[11px] text-slate-500">{r.period_start} → {r.period_end}</p>
        </div>
      ),
    },
    {
      key: "group", header: tr("For", "Untuk"),
      render: (r) => (
        <span className="whitespace-nowrap text-[12px] text-slate-600">
          {PAY_GROUP_LABELS[r.pay_group ?? "all"][lang]}
        </span>
      ),
    },
    {
      key: "status", header: tr("Status", "Status"),
      render: (r) => (
        <Badge tone={r.status === "PAID" ? "green" : r.status === "APPROVED" ? "brand" : "slate"}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: "note", header: tr("Note", "Catatan"), className: "whitespace-normal",
      render: (r) => (
        <span className="block max-w-[320px] whitespace-normal break-words text-[12px] text-slate-500">
          {r.note ?? (r.paid_trx_no ? tr(`paid · ${r.paid_trx_no}`, `dibayar · ${r.paid_trx_no}`) : "—")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Payroll", "Penggajian")}
        description={tr(
          "Computed from attendance, approved overtime and each person's terms, every time it is read. Generate a run from the sheet; open one below to approve it or print payslips.",
          "Dihitung dari absensi, lembur yang disetujui dan ketentuan gaji tiap orang, setiap kali dibaca. Buat run dari lembar payroll; buka salah satu di bawah untuk menyetujui atau mencetak slip gaji.",
        )}
        actions={mayRun ? (
          <Link href="/hrd/payroll/buat">
            <Button icon={ClipboardList}>{tr("Generate payroll", "Buat payroll")}</Button>
          </Link>
        ) : undefined}
      />

      <Loaded state={runs} onRetry={reload}>
        {(all) => (
          <Card>
            <CardHeader
              title={tr(`${all.length} run(s)`, `${all.length} periode gaji`)}
              subtitle={tr("Open one to see every line, the days behind it, and what is still unresolved.", "Buka salah satu untuk melihat setiap baris, hari-hari di baliknya, dan apa yang masih belum selesai.")}
              icon={Wallet}
              action={<SourceBadge state={runs} />}
            />
            <DataTable
              dense columns={columns} rows={all} rowKey={(r) => r.run_no}
              onRowClick={(r) => { window.location.href = `/hrd/payroll/${r.run_no}`; }}
              empty={tr("No payroll has been run yet.", "Belum ada penggajian yang dijalankan.")}
            />
          </Card>
        )}
      </Loaded>

      <p className="mt-4 text-[12px] text-slate-400">
        {tr("Days the machine could not describe are read on the", "Hari yang tidak bisa dijelaskan mesin dibaca di")}{" "}
        <Link href="/hrd/absensi" className="underline">{tr("timesheet", "timesheet")}</Link>{" "}
        {tr("— a run cannot be approved while any are still unread.", "— periode gaji tidak bisa disetujui selama masih ada yang belum dibaca.")}
      </p>
    </div>
  );
}
