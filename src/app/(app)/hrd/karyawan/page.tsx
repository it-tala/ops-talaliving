"use client";

import { useMemo, useState } from "react";
import { Users, Plus, Wallet, Search, X, Phone, Mail } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import type { Employee, EmployeeAccount } from "@/services/hr/contracts";
import { leaveStanding } from "@/services/hr/employee-rules";
import { officeToday } from "@/lib/office";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { EmployeeDrawer } from "./EmployeeDrawer";

/** Who works here, and what a day of their time costs.
 *
 *  Two kinds of people and one list. Staff are on a monthly salary; the
 *  workshop is paid for the days they are actually here (owner: *gaji atau
 *  rate*). The difference shows up in exactly one place — how a day becomes
 *  money — so it is a column, not two screens.
 */
export default function EmployeesPage() {
  const tr = useTr();
  const { can } = useSession();
  const [rows, reload] = useLoad(() => hr.listEmployees({ include_left: true }), []);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  /* Forty-odd people over two pages: finding one by paging is the wrong
     tool (owner). The search sits above both lists and filters them both,
     so somebody who has left is found the same way. */
  const [q, setQ] = useState("");
  const mayEdit = can("hrd.update");
  const today = officeToday();
  const [sched] = useLoad(() => hr.listSchedules(), []);
  const schedules = sched.status === "ready" ? sched.data.schedules : [];
  /* Which account each person signs in with — read-only here; IT links it on
     `/it/pengguna` (D329). */
  const [accts] = useLoad(() => hr.listEmployeeAccounts(), []);
  const accountOf = useMemo(() => {
    const m = new Map<string, EmployeeAccount>();
    if (accts.status === "ready") for (const a of accts.data) m.set(a.employee_id, a);
    return m;
  }, [accts]);

  const columns: Column<Employee>[] = [
    {
      key: "who",
      header: tr("Employee", "Karyawan"),
      className: "whitespace-normal",
      render: (e) => (
        <div className="max-w-[280px]">
          <p className="font-medium text-slate-800">{e.full_name}</p>
          <p className="text-[12px] text-slate-500">{e.position} · {e.unit}</p>
          <p className="font-mono text-[10px] text-slate-400">{e.employee_no}</p>
          {(e.phone || e.email) && (
            <p className="flex flex-wrap gap-x-2 text-[11px] text-slate-500">
              {e.phone && (
                <a href={`tel:${e.phone}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-0.5 hover:text-brand-700">
                  <Phone className="h-3 w-3" />{e.phone}
                </a>
              )}
              {e.email && (
                <a href={`mailto:${e.email}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-0.5 break-all hover:text-brand-700">
                  <Mail className="h-3 w-3" />{e.email}
                </a>
              )}
            </p>
          )}
          {accts.status === "ready" && (() => {
            const a = accountOf.get(e.id);
            return a?.user_email
              ? <p className="break-all text-[11px] text-slate-500" title={tr("Signs in with this account", "Masuk dengan akun ini")}>{tr("account", "akun")}: {a.user_email}</p>
              : <p className="text-[11px] text-slate-400">{tr("no account", "belum punya akun")}</p>;
          })()}
        </div>
      ),
    },
    {
      key: "schedule",
      header: tr("Schedule", "Jadwal"),
      render: (e) => {
        /* Which pattern, and **whether it is this person's or their unit's**.
           The two look the same on a payslip and are different facts: one
           follows them when they move units, the other does not (D281). */
        const own = e.schedule_code
          ? schedules.find((sc) => sc.code === e.schedule_code)
          : undefined;
        const viaUnit = schedules.find((sc) => sc.units.includes(e.unit));
        const sc = own ?? viaUnit;
        if (!sc) return <span className="text-[12px] text-amber-700">{tr("no schedule", "tanpa jadwal")}</span>;
        return (
          <div className="max-w-[190px]">
            <p className="text-[12px] text-slate-700">{sc.name}</p>
            <p className="text-[10px] text-slate-400">
              {own ? tr("assigned", "ditetapkan") : tr("via unit", "ikut unit")}
              {sc.hours.weekly_hours != null && tr(` · ${sc.hours.weekly_hours} h/wk`, ` · ${sc.hours.weekly_hours} jam/mg`)}
            </p>
          </div>
        );
      },
    },
    {
      key: "basis",
      header: tr("Paid", "Dibayar"),
      render: (e) => (
        <Badge tone={e.pay_basis === "monthly" ? "brand" : "slate"}>
          {e.pay_basis === "monthly" ? tr("monthly", "bulanan") : e.pay_basis === "daily" ? tr("per day", "per hari") : tr("per hour", "per jam")}
        </Badge>
      ),
    },
    {
      key: "rate",
      header: tr("Rate", "Tarif"),
      align: "right",
      render: (e) => (
        <div className="whitespace-nowrap text-right">
          <span className="tabular-nums font-medium text-slate-800">{formatIDR(e.base_rate)}</span>
          <p className="text-[11px] text-slate-500">
            {tr("base", "pokok")} · {e.pay_basis === "monthly" ? tr("per month", "per bulan")
              : e.pay_basis === "daily" ? tr(`per day · ${formatNumber(e.daily_hours)}h`, `per hari · ${formatNumber(e.daily_hours)} jam`)
                : tr("per hour", "per jam")}
          </p>
          {e.allowance_rate > 0 && (
            <p className="text-[11px] text-slate-500">
              + {formatIDR(e.allowance_rate)} {tr("allowance / day present", "tunjangan / hari hadir")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "leave",
      header: tr("Leave entitlement", "Hak cuti"),
      align: "right",
      render: (e) => {
        /* Nought until a year of service, then HRD writes it (D349) — so the
           column says which of the three a nought is. */
        const st = leaveStanding(e, today);
        return (
          <div className="whitespace-nowrap text-right">
            <span className="tabular-nums text-slate-700">{formatNumber(e.paid_leave_days)}</span>
            {st.kind === "set" && <p className="text-[11px] text-slate-400">{tr("paid days", "hari berbayar")}</p>}
            {st.kind === "waiting" && <p className="text-[11px] text-slate-400">{tr(`entitled from ${st.from}`, `berhak mulai ${st.from}`)}</p>}
            {st.kind === "due" && e.active && <p className="text-[11px] font-medium text-amber-700">{tr("a year is up — fill in", "sudah 1 tahun — isi")}</p>}
            {st.kind === "no_start" && e.active && <p className="text-[11px] text-amber-700">{tr("no start date", "tanggal masuk kosong")}</p>}
          </div>
        );
      },
    },
    {
      key: "joined",
      header: tr("Since", "Sejak"),
      render: (e) => <span className="whitespace-nowrap text-[12px] text-slate-500">{e.joined_on}</span>,
    },
    {
      key: "state",
      header: "",
      render: (e) => e.active
        ? <Badge tone="green">{tr("active", "aktif")}</Badge>
        : <Badge tone="slate">{tr("left", "keluar")} {e.left_on}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Employees", "Karyawan")}
        description={tr(
          "Everybody on the payroll, and what their time costs. Deductions are not modelled yet — see the payroll screen.",
          "Semua orang di daftar gaji, dan berapa biaya waktu mereka. Potongan belum dimodelkan — lihat layar penggajian.",
        )}
        actions={mayEdit ? <Button icon={Plus} onClick={() => setAdding(true)}>{tr("Add somebody", "Tambah orang")}</Button> : undefined}
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

          const needle = q.trim().toLowerCase();
          const matches = (e: Employee) => !needle
            || `${e.full_name} ${e.employee_no} ${e.position} ${e.unit} ${accountOf.get(e.id)?.user_email ?? ""} ${e.email ?? ""} ${e.phone ?? ""}`
              .toLowerCase().includes(needle);
          /* People whose year is up and whose entitlement nobody has written
             yet — HRD's to fill in, so the screen counts them (D349). */
          const leaveDue = active.filter((e) => leaveStanding(e, today).kind === "due");
          const activeShown = active.filter(matches);
          const leftShown = left.filter(matches);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("People", "Orang"), String(active.length), tr(`${monthly.length} on salary, ${daily.length} on a rate`, `${monthly.length} bergaji bulanan, ${daily.length} dengan tarif`)],
                    [tr("Salaries", "Gaji"), formatIDR(monthlyCost), monthlyAllowance > 0
                      ? tr(`base pay every month · + ${formatIDR(monthlyAllowance)} allowance per day present`, `pokok setiap bulan · + ${formatIDR(monthlyAllowance)} tunjangan per hari hadir`)
                      : tr("every month, whatever the machine says", "setiap bulan, apa pun kata mesin")],
                    [tr("A full day of the workshop", "Sehari penuh workshop"), formatIDR(dailyCost), tr(`${daily.length} people, if everybody is in — base + allowance`, `${daily.length} orang, kalau semua hadir — pokok + tunjangan`)],
                    [tr("Left", "Keluar"), String(left.length), tr("records kept — a payslip from March is still a fact", "catatan tetap disimpan — slip gaji bulan Maret tetap sebuah fakta")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-800">{v}</dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <label className="relative flex-1 sm:max-w-md">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text" value={q} onChange={(ev) => setQ(ev.target.value)}
                    placeholder={tr("Search name, number, position, unit, phone or email", "Cari nama, nomor, jabatan, unit, HP atau email")}
                    aria-label={tr("Search employees", "Cari karyawan")}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  {q && (
                    <button
                      type="button" onClick={() => setQ("")} aria-label={tr("Clear search", "Hapus pencarian")}
                      className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </label>
                {needle && (
                  <span className="text-[12px] text-slate-500">
                    {tr(`${activeShown.length + leftShown.length} found`, `${activeShown.length + leftShown.length} ditemukan`)}
                  </span>
                )}
              </div>

              {leaveDue.length > 0 && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800">
                  {tr(
                    `${leaveDue.length} ${leaveDue.length === 1 ? "person has" : "people have"} worked a year and ${leaveDue.length === 1 ? "has" : "have"} no leave entitlement yet: `,
                    `${leaveDue.length} orang sudah 1 tahun bekerja dan hak cutinya belum diisi: `,
                  )}
                  {leaveDue.map((e) => e.full_name).join(", ")}.
                </p>
              )}

              <Card className="mb-4">
                <CardHeader
                  title={needle
                    ? tr(`${activeShown.length} of ${active.length} working here`, `${activeShown.length} dari ${active.length} bekerja di sini`)
                    : tr(`${active.length} working here`, `${active.length} bekerja di sini`)}
                  subtitle={tr(
                    "Click somebody to change what they are paid, or to offboard them — the figure before and after goes on the audit row.",
                    "Klik seseorang untuk mengubah bayarannya atau mengeluarkannya — angka sebelum dan sesudahnya dicatat di baris audit.",
                  )}
                  icon={Users}
                  action={<SourceBadge state={rows} />}
                />
                <DataTable
                  dense columns={columns} rows={activeShown} rowKey={(e) => e.employee_no}
                  onRowClick={(e) => mayEdit && setEditing(e)}
                  empty={needle
                    ? tr("Nobody working here matches.", "Tidak ada karyawan aktif yang cocok.")
                    : tr("Nobody on the payroll yet.", "Belum ada orang di daftar gaji.")}
                />
              </Card>

              {leftShown.length > 0 && (
                <Card>
                  <CardHeader
                    title={needle
                      ? tr(`${leftShown.length} of ${left.length} who have left`, `${leftShown.length} dari ${left.length} yang sudah keluar`)
                      : tr(`${left.length} who have left`, `${left.length} yang sudah keluar`)}
                    icon={Wallet}
                  />
                  <DataTable
                    dense columns={columns} rows={leftShown} rowKey={(e) => e.employee_no}
                    onRowClick={(e) => mayEdit && setEditing(e)}
                    empty={tr("Nobody has left.", "Belum ada yang keluar.")}
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
          account={editing ? accountOf.get(editing.id) ?? null : null}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
