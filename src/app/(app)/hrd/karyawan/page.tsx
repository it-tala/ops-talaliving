"use client";

import { useState } from "react";
import { Users, Plus, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import type { Employee } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { EmployeeDrawer } from "./EmployeeDrawer";

/** Who works here, and what a day of their time costs.
 *
 *  Two kinds of people and one list. Staff are on a monthly salary; the
 *  workshop is paid for the days they are actually here (owner: *gaji atau
 *  rate*). The difference shows up in exactly one place — how a day becomes
 *  money — so it is a column, not two screens.
 */
export default function EmployeesPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => hr.listEmployees({ include_left: true }), []);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  const mayEdit = can("hrd.update");
  const [sched] = useLoad(() => hr.listSchedules(), []);
  const schedules = sched.status === "ready" ? sched.data.schedules : [];

  const columns: Column<Employee>[] = [
    {
      key: "who",
      header: "Employee",
      className: "whitespace-normal",
      render: (e) => (
        <div className="max-w-[280px]">
          <p className="font-medium text-slate-800">{e.full_name}</p>
          <p className="text-[12px] text-slate-500">{e.position} · {e.unit}</p>
          <p className="font-mono text-[10px] text-slate-400">{e.employee_no}</p>
        </div>
      ),
    },
    {
      key: "schedule",
      header: "Jadwal",
      render: (e) => {
        /* Which pattern, and **whether it is this person's or their unit's**.
           The two look the same on a payslip and are different facts: one
           follows them when they move units, the other does not (D281). */
        const own = e.schedule_code
          ? schedules.find((sc) => sc.code === e.schedule_code)
          : undefined;
        const viaUnit = schedules.find((sc) => sc.units.includes(e.unit));
        const sc = own ?? viaUnit;
        if (!sc) return <span className="text-[12px] text-amber-700">tanpa jadwal</span>;
        return (
          <div className="max-w-[190px]">
            <p className="text-[12px] text-slate-700">{sc.name}</p>
            <p className="text-[10px] text-slate-400">
              {own ? "ditetapkan" : "ikut unit"}
              {sc.hours.weekly_hours != null && ` · ${sc.hours.weekly_hours} jam/mg`}
            </p>
          </div>
        );
      },
    },
    {
      key: "basis",
      header: "Paid",
      render: (e) => (
        <Badge tone={e.pay_basis === "monthly" ? "brand" : "slate"}>
          {e.pay_basis === "monthly" ? "monthly" : e.pay_basis === "daily" ? "per day" : "per hour"}
        </Badge>
      ),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      render: (e) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums font-medium text-slate-800">{formatIDR(e.base_rate)}</span>
          <p className="text-[11px] text-slate-500">
            pokok · {e.pay_basis === "monthly" ? "per month"
              : e.pay_basis === "daily" ? `per day · ${formatNumber(e.daily_hours)}h`
                : "per hour"}
          </p>
          {e.allowance_rate > 0 && (
            <p className="text-[11px] text-slate-500">
              + {formatIDR(e.allowance_rate)} tunjangan / hari hadir
            </p>
          )}
        </div>
      ),
    },
    {
      key: "leave",
      header: "Hak cuti",
      align: "right",
      render: (e) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums text-slate-700">{formatNumber(e.paid_leave_days)}</span>
          <p className="text-[11px] text-slate-400">hari berbayar</p>
        </div>
      ),
    },
    {
      key: "joined",
      header: "Since",
      render: (e) => <span className="whitespace-nowrap text-[12px] text-slate-500">{e.joined_on}</span>,
    },
    {
      key: "state",
      header: "",
      render: (e) => e.active
        ? <Badge tone="green">active</Badge>
        : <Badge tone="slate">left {e.left_on}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Employees"
        description="Everybody on the payroll, and what their time costs. Deductions are not modelled yet — see the payroll screen."
        actions={mayEdit ? <Button icon={Plus} onClick={() => setAdding(true)}>Add somebody</Button> : undefined}
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const active = all.filter((e) => e.active);
          const left = all.filter((e) => !e.active);
          const monthly = active.filter((e) => e.pay_basis === "monthly");
          const daily = active.filter((e) => e.pay_basis !== "monthly");
          /* Pokok and tunjangan kept apart in the tiles for the same reason
             they are kept apart on the slip: one is owed whatever happens and
             the other is earned by turning up, and a single total would hide
             which of the two a month's wage bill actually is (D250). */
          const monthlyCost = monthly.reduce((s, e) => s + e.base_rate, 0);
          const monthlyAllowance = monthly.reduce((s, e) => s + e.allowance_rate, 0);
          /* A full day of the workshop **does** include the allowance: everybody
             in is exactly the condition that earns it. */
          const dailyCost = daily.reduce((s, e) => s + e.base_rate + e.allowance_rate, 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    ["People", String(active.length), `${monthly.length} on salary, ${daily.length} on a rate`],
                    ["Salaries", formatIDR(monthlyCost), monthlyAllowance > 0
                      ? `pokok setiap bulan · + ${formatIDR(monthlyAllowance)} tunjangan per hari hadir`
                      : "every month, whatever the machine says"],
                    ["A full day of the workshop", formatIDR(dailyCost), `${daily.length} people, if everybody is in — pokok + tunjangan`],
                    ["Left", String(left.length), "records kept — a payslip from March is still a fact"],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-800">{v}</dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <Card className="mb-4">
                <CardHeader
                  title={`${active.length} working here`}
                  subtitle="Click somebody to change what they are paid — the figure before and after goes on the audit row."
                  icon={Users}
                  action={<SourceBadge state={rows} />}
                />
                <DataTable
                  dense columns={columns} rows={active} rowKey={(e) => e.employee_no}
                  onRowClick={(e) => mayEdit && setEditing(e)}
                  empty="Nobody on the payroll yet."
                />
              </Card>

              {left.length > 0 && (
                <Card>
                  <CardHeader title={`${left.length} who have left`} icon={Wallet} />
                  <DataTable
                    dense columns={columns} rows={left} rowKey={(e) => e.employee_no}
                    empty="Nobody has left."
                  />
                </Card>
              )}
            </>
          );
        }}
      </Loaded>

      {(adding || editing) && (
        <EmployeeDrawer
          employee={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
