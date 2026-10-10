"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** *Tidak wajib absensi* (0242, D394).
 *
 *  Owner: *secara aturan harusnya tidak ada pengecualian, tapi seperti EVIN
 *  karena dia pimpinan maka dia tidak perlu absensi.* Everybody else's working
 *  day with no tap waits for HRD before it is paid; somebody set here is paid
 *  it, as salaries were before. On with a reason, off with a reason from
 *  today on — the periods already read stay as they were. HRD's only.
 *  A day wage set here is paid each working day with no tap as a full day
 *  (0254, D411). */
export function AttendanceExempt({ employeeNo, dayWage = false }: { employeeNo: string; dayWage?: boolean }) {
  const tr = useTr();
  const { toast } = useToast();
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [list, reload] = useLoad(() => hr.listAttendanceExemptions(), []);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (list.status !== "ready") return null;
  const mine = list.data.find((x) => x.employee_no === employeeNo) ?? null;

  async function set(exempt: boolean) {
    setBusy(true);
    const res = await hr.setAttendanceExempt({ employee_no: employeeNo, exempt, reason: reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", exempt
      ? tr("No attendance required from now", "Sekarang tidak wajib absensi")
      : tr("Attendance required again", "Kembali wajib absensi"));
    setReason("");
    reload();
  }

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-600">{tr("Attendance", "Absensi")}</p>
      <p className="mt-1 text-[12px] text-slate-700">
        {mine
          ? <>{tr("Not required", "Tidak wajib absensi")} — <span className="italic">{mine.reason}</span>{mine.by_name ? ` (${mine.by_name})` : ""}</>
          : dayWage
            ? tr("Required — a day is paid when it has a tap.", "Wajib — hari dibayar kalau ada tap.")
            : tr("Required — a working day with no tap is held until HRD confirms it.",
              "Wajib — hari kerja tanpa tap ditahan sampai HRD mengonfirmasinya.")}
      </p>
      {dayWage && mine && (
        <p className="mt-0.5 text-[11px] text-slate-500">
          {tr("Each working day of the schedule with no tap and no mark is paid as a full day.",
            "Setiap hari kerja sesuai jadwal tanpa tap dan tanpa tanda dibayar sehari penuh.")}
        </p>
      )}
      {mayEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason} onChange={(e) => setReason(e.target.value)}
            aria-label={tr("Reason", "Alasan")}
            placeholder={mine ? tr("Why it ends", "Alasan diakhiri") : tr("Why — e.g. leadership, does not tap", "Alasan — mis. pimpinan, tidak absen")}
            className="h-8 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
          />
          <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => set(!mine)}>
            {mine ? tr("Require attendance", "Jadikan wajib absensi") : tr("Set as not required", "Jadikan tidak wajib absensi")}
          </Button>
        </div>
      )}
    </div>
  );
}
