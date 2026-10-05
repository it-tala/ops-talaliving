"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet, Plus, AlertTriangle, CalendarRange } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { hr } from "@/demo/api";
import type { PayGroup, PayrollRun } from "@/services/hr/contracts";
import { PAY_GROUPS, PAY_GROUP_LABELS } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr, useLang } from "@/lib/i18n";

/** Payroll runs, and the one thing this screen refuses to pretend.
 *
 *  It computes **gross**. BPJS Kesehatan, BPJS Ketenagakerjaan and PPh 21 all
 *  apply to this business and none of them has been described to us, so none
 *  of them is invented here (Q30–Q32). A missing deduction is obvious on a
 *  payslip; a wrong one is discovered by somebody who is short at the end of
 *  the month.
 */
export default function PayrollPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [runs, reload] = useLoad(() => hr.listPayrollRuns(), []);
  const [from, setFrom] = useState("2026-09-07");
  const [to, setTo] = useState("2026-09-11");
  /* Who the run is for (0211, D369): opening it writes its people, and HRD
     takes them off or puts them on from the run's own page. */
  const [group, setGroup] = useState<PayGroup>("monthly");
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  /* The module has one verb of its own — `run` — and it is the right one:
     opening and approving a payroll are the same permission. */
  const mayRun = can("payroll.run");

  async function open() {
    setBusy(true);
    const res = await hr.openPayroll({ period_start: from, period_end: to, pay_group: group });
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
    window.location.href = `/hrd/payroll/${encodeURIComponent(res.data.run_no)}`;
  }

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
          "Computed from attendance and approved overtime, every time it is read. Gross only — deductions are not modelled until somebody tells us which apply.",
          "Dihitung dari absensi dan lembur yang disetujui, setiap kali dibaca. Hanya bruto — potongan belum dimodelkan sampai ada yang memberi tahu mana yang berlaku.",
        )}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
        <div>
          <label htmlFor="p-from" className="block text-xs text-slate-500">{tr("Period from", "Periode dari")}</label>
          <input
            id="p-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="p-to" className="block text-xs text-slate-500">{tr("to", "sampai")}</label>
          <input
            id="p-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="p-group" className="block text-xs text-slate-500">{tr("For", "Untuk")}</label>
          <select
            id="p-group" value={group} onChange={(e) => setGroup(e.target.value as PayGroup)}
            className="mt-1 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {PAY_GROUPS.map((g) => <option key={g} value={g}>{PAY_GROUP_LABELS[g][lang]}</option>)}
          </select>
        </div>
        <Button icon={Plus} disabled={busy || !mayRun} onClick={open}>
          {busy ? tr("Opening…", "Membuka…") : tr("Open a run", "Buka periode gaji")}
        </Button>
        <p className="text-[12px] text-slate-500">
          {tr(
            "Weekly for day and hourly wages, monthly for salaries. A salary is prorated by working days when the run is shorter than the month, or the person joined or left inside it.",
            "Mingguan untuk upah harian dan per jam, bulanan untuk gaji. Gaji bulanan diprorata per hari kerja kalau run lebih pendek dari sebulan, atau orangnya masuk/keluar di tengah bulan.",
          )}
        </p>
        {/* The workshop's week is looked at far more often than the list of
            runs is, and it can be walked without opening anything (D158). */}
        <Link href="/hrd/payroll/minggu" className="ml-auto">
          <Button variant="outline" icon={CalendarRange}>{tr("Weekly payroll", "Gajian mingguan")}</Button>
        </Link>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>{tr("Gross only.", "Hanya bruto.")}</strong>{" "}
          {tr(
            "BPJS Kesehatan, BPJS Ketenagakerjaan and PPh 21 are not computed — nobody has told us which apply here, at what rate, or who pays which half. Inventing them would produce a payslip that looks right and is wrong.",
            "BPJS Kesehatan, BPJS Ketenagakerjaan dan PPh 21 tidak dihitung — belum ada yang memberi tahu mana yang berlaku di sini, berapa tarifnya, atau siapa menanggung bagian mana. Mengarangnya akan menghasilkan payslip yang terlihat benar tapi salah.",
          )}
        </span>
      </div>

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
