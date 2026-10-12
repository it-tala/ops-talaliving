"use client";

import { ClipboardCheck, Flag, Link2, UserRound } from "lucide-react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { useTr } from "@/lib/i18n";
import type { WorkProgress } from "@/services/hr/contracts";

const PROGRESS_LABEL: Record<WorkProgress, [string, string]> = {
  lanjut: ["ongoing", "lanjut"],
  selesai: ["done", "selesai"],
  tertahan: ["blocked", "tertahan"],
};

/** The evidence a performance advisory is written from (D372), for one person
 *  over one period — the same panel on HRD's KPI card and on the person's own
 *  profile, because the basis of an assessment is something the assessed can
 *  read.
 *
 *  The dadakan share is drawn and named, and said **not** to be a score:
 *  being interrupted is not the failure of the interrupted. What it shows the
 *  leader is where the priorities leaked, and to whom. */
export function WorkEvidencePanel({
  employeeNo, from, to, self = false,
}: { employeeNo: string; from: string; to: string; self?: boolean }) {
  const tr = useTr();
  const [ev, reload] = useLoad(
    () => hr.workEvidence({ employee_no: employeeNo, period_start: from, period_end: to }),
    [employeeNo, from, to],
  );
  return (
    <Loaded state={ev} onRetry={reload}>
      {(e) => {
        const dadakanPct = e.dadakan_share ?? 0;
        return (
          <div className="space-y-2.5 text-[12px] text-slate-600">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {self
                ? tr("What HRD reads for your assessment and PA", "Yang dibaca HRD untuk penilaian dan PA Anda")
                : tr("Evidence for the performance advisory", "Bukti untuk performance advisory (PA)")}
              {" · "}{e.period_start} – {e.period_end}
            </p>

            <p>
              <ClipboardCheck className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
              {!e.has_account
                ? tr("Does not owe a daily log — no office account (a floor worker's account does not write one).",
                     "Tidak wajib mengisi laporan harian — belum punya akun kantor (akun pekerja lapangan tidak mengisinya).")
                : e.days_expected === 0
                  ? tr(`No working day owed a log yet (counted from ${e.counted_from}, never today).`,
                       `Belum ada hari kerja yang wajib dilaporkan (dihitung sejak ${e.counted_from}, tanpa hari ini).`)
                  : <>
                      {tr("Daily log:", "Laporan harian:")}{" "}
                      <strong className="text-slate-800">
                        {tr(`${e.days_logged} of ${e.days_expected} working days`, `${e.days_logged} dari ${e.days_expected} hari kerja`)}
                      </strong>
                      {e.coverage !== null && <> ({e.coverage}%)</>}
                      <span className="text-slate-400">
                        {tr(" · leave, sick, permits, holidays and today are not counted",
                            " · cuti, sakit, izin, libur dan hari ini tidak dihitung")}
                      </span>
                    </>}
            </p>

            {e.entries > 0 && (
              <div>
                <p>
                  {tr(`${e.entries} entries: `, `${e.entries} entri: `)}
                  <strong className="text-slate-800">{tr(`${e.task_entries} on assigned tasks`, `${e.task_entries} untuk tugas yang diberikan`)}</strong>
                  {", "}
                  {e.item_entries > 0 && <>
                    <strong className="text-slate-800">{tr(`${e.item_entries} on own items`, `${e.item_entries} untuk item sendiri`)}</strong>
                    {", "}
                  </>}
                  <strong className="text-amber-800">{tr(`${e.dadakan_entries} dadakan`, `${e.dadakan_entries} dadakan`)}</strong>
                  {e.dadakan_share !== null && <> ({e.dadakan_share}%)</>}
                  {(e.hours_task > 0 || e.hours_item > 0 || e.hours_dadakan > 0) && (
                    <span className="text-slate-400">
                      {" · "}{tr(`${formatNumber(e.hours_task)} h on tasks, ${formatNumber(e.hours_item)} h on items, ${formatNumber(e.hours_dadakan)} h dadakan`,
                                 `${formatNumber(e.hours_task)} jam tugas, ${formatNumber(e.hours_item)} jam item, ${formatNumber(e.hours_dadakan)} jam dadakan`)}
                      {e.entries_without_hours > 0 && tr(` (${e.entries_without_hours} entries without hours)`, ` (${e.entries_without_hours} entri tanpa jam)`)}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${100 - dadakanPct}%` }} />
                  <div className="h-full bg-amber-400" style={{ width: `${dadakanPct}%` }} />
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {tr("The dadakan share is context, not a score: being interrupted is not the fault of the interrupted.",
                      "Porsi dadakan adalah konteks, bukan nilai: diinterupsi bukan kesalahan yang diinterupsi.")}
                </p>
                {(e.written_later > 0 || e.written_ahead > 0) && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {tr(`${e.written_later} written after their day, ${e.written_ahead} written ahead as a plan`,
                        `${e.written_later} ditulis sesudah harinya, ${e.written_ahead} ditulis di muka sebagai rencana`)}
                    <span className="text-slate-400">
                      {tr(" · a plan counts as logged only once it is opened again on or after its day",
                          " · rencana baru dihitung terisi setelah dibuka lagi pada harinya atau sesudahnya")}
                    </span>
                  </p>
                )}
              </div>
            )}

            {e.tasks.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-slate-500">{tr("Assigned work the days went into", "Tugas yang dikerjakan")}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {e.tasks.map((t) => (
                    <li key={t.task_no}>
                      <Link2 className="mr-1 inline h-3 w-3 text-slate-400" />
                      {t.title}
                      <span className="text-slate-400">
                        {" · "}{tr(`${t.days} days`, `${t.days} hari`)}
                        {" · "}{tr("last:", "terakhir:")} {tr(...PROGRESS_LABEL[t.last_progress])}
                        {t.status === "DONE" && tr(" · task closed", " · tugas ditutup")}
                        {t.goal_title && <> · {t.goal_title}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {e.items.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-slate-500">{tr("Own long-running items", "Item jangka panjang sendiri")}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {e.items.map((t) => (
                    <li key={t.title}>
                      <Link2 className="mr-1 inline h-3 w-3 text-slate-400" />
                      {t.title}
                      <span className="text-slate-400">
                        {" · "}{tr(`${t.days} days`, `${t.days} hari`)}
                        {" · "}{tr("last:", "terakhir:")} {tr(...PROGRESS_LABEL[t.last_progress])}
                        {t.status !== "aktif" && <> · {t.status}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {e.requesters.length > 0 && (
              <p>
                <UserRound className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                {tr("Dadakan came from:", "Dadakan datang dari:")}{" "}
                {e.requesters.map((r) => `${r.requested_by} (${r.entries})`).join(" · ")}
                {e.promoted > 0 && (
                  <span className="text-slate-400">
                    {tr(` · ${e.promoted} made into tasks`, ` · ${e.promoted} dijadikan tugas`)}
                  </span>
                )}
              </p>
            )}

            {e.goals.length > 0 && (
              <p>
                <Flag className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                {tr("Goals contributed to:", "Sasaran yang dikerjakan:")}{" "}
                {e.goals.map((g) => g.title).join(" · ")}
              </p>
            )}

            {e.entries === 0 && e.has_account && (
              <p className="text-slate-500">{tr("No daily log in this period.", "Tidak ada laporan harian pada periode ini.")}</p>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}
