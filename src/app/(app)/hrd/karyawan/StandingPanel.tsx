"use client";

import { useState } from "react";
import { formatIDR, formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import { officeToday } from "@/lib/office";
import { useTr } from "@/lib/i18n";

/** One person as HRD reads them: the month's attendance as payroll counts it,
 *  the year's leave, and the retensi balance (D388).
 *
 *  Owner: *catat saldonya, tapi jangan ditampilkan ke user — cukup HRD aja yang
 *  bisa melihat data karyawan seperti retensi, saldo cuti, jumlah absensi,
 *  jumlah terlambat.* The database answers nothing to an account without
 *  `hrd.read` or `payroll.read`, so this panel is empty there by design, not
 *  just hidden. */
export function StandingPanel({ employeeNo }: { employeeNo: string }) {
  const tr = useTr();
  const [month, setMonth] = useState(officeToday().slice(0, 7));
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = officeToday();
  const to = monthEnd < today ? monthEnd : today;
  const [state] = useLoad(() => hr.employeeStanding({ employee_no: employeeNo, from, to }), [employeeNo, from, to]);

  if (state.status !== "ready" || !state.data) {
    return state.status === "ready" ? null : (
      <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-[12px] text-slate-400">
        {tr("Reading…", "Membaca…")}
      </div>
    );
  }
  const s = state.data;
  const cells: [string, string, string?][] = [
    [tr("Present", "Hadir"), tr(`${formatNumber(s.days_present)} d`, `${formatNumber(s.days_present)} hari`)],
    [tr("Unpaid (alpa)", "Tidak dibayar (alpa)"), tr(`${s.days_unpaid} d`, `${s.days_unpaid} hari`)],
    [tr("Late", "Terlambat"), tr(`${s.late_minutes} min / ${s.late_days} d`, `${s.late_minutes} mnt / ${s.late_days} hari`)],
    [tr("Sick / leave paid", "Sakit / cuti dibayar"), `${s.days_sick_paid} / ${s.days_leave_paid}`],
    [tr("No allowance", "Tanpa tunjangan"), tr(`${s.allowance_withheld_days} d`, `${s.allowance_withheld_days} hari`)],
    [tr("Unread days", "Belum dibaca"), String(s.days_open)],
    [tr("Leave left", "Sisa cuti"), s.leave_remaining == null ? "—" : `${s.leave_remaining} / ${s.leave_entitlement}`,
      tr(`${s.leave_taken ?? 0} taken this year`, `${s.leave_taken ?? 0} terpakai tahun ini`)],
    [tr("Retention held", "Saldo retensi"), formatIDR(s.retention_balance),
      s.retention_in_draft !== 0 ? tr(`+ ${formatIDR(s.retention_in_draft)} in draft runs`, `+ ${formatIDR(s.retention_in_draft)} di run draft`) : undefined],
  ];
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-violet-900">{tr("HRD only — standing", "Khusus HRD — ringkasan")}</p>
        <input
          type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label={tr("Month", "Bulan")}
          className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] focus:border-brand-400 focus:outline-none"
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        {cells.map(([k, v, note]) => (
          <div key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium tabular-nums text-slate-800">{v}</dd>
            {note && <p className="text-[10px] text-slate-500">{note}</p>}
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {tr(
          "Not shown to the employee. Attendance counts to today for the current month.",
          "Tidak ditampilkan ke karyawan. Absensi bulan berjalan dihitung sampai hari ini.",
        )}
      </p>
    </div>
  );
}
