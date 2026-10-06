"use client";

import { useState } from "react";
import { ArrowUpRight, ClipboardList, Zap } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { hr } from "@/demo/api";
import type { GoalView, WorkLogEntry } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const MARK_LABEL: Record<string, [string, string]> = {
  holiday: ["holiday", "libur"], half_day: ["half day", "setengah hari"], absent: ["absent", "mangkir"],
  sick: ["sick", "sakit"], leave: ["leave", "cuti"], permit: ["permit", "izin"],
};

/** Laporan harian — one day, everybody who can log (D371).
 *
 *  Opens on who has **not** logged, because that is the line somebody acts on.
 *  A day off or a marked day with no log is not a missing log, and the row
 *  says which. The share of dadakan is the leader's number: it shows where the
 *  ranked priorities leaked, and to whose requests — never a score on the
 *  person interrupted.
 *
 *  A dadakan line can be made a task (**Jadikan tugas**): interruptions that
 *  turn out to be real work become visible work, in a goal if they belong to
 *  one. HRD cannot write or change anybody's log — only read it.
 */
export function DailyPanel({ goals, mayCreate, onChanged }: {
  goals: GoalView[]; mayCreate: boolean; onChanged: () => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const [date, setDate] = useState(officeToday());
  const [roster, reloadRoster] = useLoad(() => hr.workLogRoster({ date }), [date]);
  const [lines, reloadLines] = useLoad(() => hr.listWorkLog({ from: date, to: date }), [date]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState<{ id: string; due: string; goal: string } | null>(null);

  async function promote(l: WorkLogEntry) {
    if (!promoting || promoting.id !== l.id) return;
    setBusy(true);
    const res = await hr.promoteWorkLog({ entry_id: l.id, due_date: promoting.due, goal_no: promoting.goal || null });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not made a task", "Tidak dijadikan tugas"), res.error.message); return; }
    toast("success", res.data.task_no, tr(`Now a task for ${res.data.assignee_name}.`, `Sekarang tugas untuk ${res.data.assignee_name}.`));
    setPromoting(null);
    reloadLines(); reloadRoster(); onChanged();
  }

  return (
    <div>
      <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
        {tr(
          "What each person did on a day, in their own words: for which task, or dadakan and who asked. The log is the basis of the daily-log measure and of the performance advisory (PA). It is written only by the person and only on the day itself — HRD reads it, never edits it.",
          "Apa yang dikerjakan setiap orang pada satu hari, dengan kata-katanya sendiri: untuk tugas mana, atau dadakan dan siapa yang meminta. Laporan ini dasar ukuran laporan harian dan performance advisory (PA). Hanya ditulis oleh orangnya sendiri dan hanya pada hari itu — HRD membacanya, tidak pernah mengubahnya.",
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-slate-600">
          {tr("Day", "Hari")}{" "}
          <input type="date" value={date} max={officeToday()} onChange={(e) => setDate(e.target.value || officeToday())}
            className="ml-1 h-8 rounded-lg border border-slate-200 px-2 text-sm" />
        </label>
        <Loaded state={roster} onRetry={reloadRoster}>
          {(rows) => {
            const all = rows.reduce((a, r) => a + r.entries, 0);
            const dadakan = rows.reduce((a, r) => a + r.dadakan_entries, 0);
            const owed = rows.filter((r) => r.scheduled && (r.mark_kind === null || r.mark_kind === "half_day"));
            const missing = owed.filter((r) => r.entries === 0).length;
            return (
              <span className="text-[12px] text-slate-600">
                {tr(`${owed.length - missing} of ${owed.length} logged`, `${owed.length - missing} dari ${owed.length} sudah mengisi`)}
                {all > 0 && (
                  <> · <span className="text-amber-800">
                    {tr(`${Math.round((dadakan / all) * 100)}% of entries dadakan`, `${Math.round((dadakan / all) * 100)}% entri dadakan`)}
                  </span></>
                )}
              </span>
            );
          }}
        </Loaded>
      </div>

      <Loaded state={roster} onRetry={reloadRoster}>
        {(rows) => rows.length === 0 ? (
          <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
            {tr("Nobody has an account to log with yet.", "Belum ada yang punya akun untuk mengisi laporan.")}
          </p></Card>
        ) : (
          <Card>
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => {
                const off = !r.scheduled || (r.mark_kind !== null && r.mark_kind !== "half_day");
                const mine = lines.status === "ready" ? lines.data.filter((l) => l.employee_no === r.employee_no) : [];
                return (
                  <li key={r.employee_no}>
                    <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50"
                      onClick={() => setOpen(open === r.employee_no ? null : r.employee_no)}>
                      <span className="min-w-[180px] flex-1">
                        <span className="text-sm font-medium text-slate-800">{r.full_name}</span>
                        <span className="block text-[11px] text-slate-500">{r.position} · {r.unit}</span>
                      </span>
                      {r.entries === 0 ? (
                        off
                          ? <Badge tone="slate">{r.mark_kind ? tr(...(MARK_LABEL[r.mark_kind] ?? [r.mark_kind, r.mark_kind])) : tr("day off", "libur")}</Badge>
                          : <Badge tone="red">{tr("not logged", "belum mengisi")}</Badge>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
                          <Badge tone="brand">{tr(`${r.task_entries} task`, `${r.task_entries} tugas`)}</Badge>
                          {r.dadakan_entries > 0 && <Badge tone="amber">{tr(`${r.dadakan_entries} dadakan`, `${r.dadakan_entries} dadakan`)}</Badge>}
                          {r.hours > 0 && <span className="text-slate-400">{tr(`${r.hours} h`, `${r.hours} jam`)}</span>}
                        </span>
                      )}
                    </button>
                    {open === r.employee_no && (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-2">
                        {mine.length === 0 ? (
                          <p className="py-2 text-[13px] text-slate-500">{tr("No lines on this day.", "Tidak ada catatan pada hari ini.")}</p>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {mine.map((l) => (
                              <li key={l.id} className="py-2 text-[13px]">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {l.kind === "dadakan"
                                    ? <Badge tone="amber"><Zap className="mr-0.5 inline h-3 w-3" />{tr("dadakan", "dadakan")}</Badge>
                                    : <Badge tone="brand">{l.goal_rank !== null ? `#${l.goal_rank}` : tr("task", "tugas")}</Badge>}
                                  <span className="text-slate-800">{l.task_title ?? l.summary}</span>
                                  <span className={cn("text-[12px]",
                                    l.progress === "selesai" ? "text-emerald-700" : l.progress === "tertahan" ? "text-amber-700" : "text-slate-500")}>
                                    {l.progress}
                                  </span>
                                  {l.hours !== null && <span className="text-[12px] text-slate-400">{tr(`${l.hours} h`, `${l.hours} jam`)}</span>}
                                </div>
                                {l.task_title && <p className="text-slate-600">{l.summary}</p>}
                                {l.requested_by && <p className="text-[12px] text-slate-500">{tr("asked by", "diminta oleh")} {l.requested_by}</p>}
                                {l.promoted_task_no && (
                                  <p className="text-[12px] text-slate-500">
                                    <ArrowUpRight className="mr-0.5 inline h-3 w-3" />{tr("now task", "sekarang tugas")} {l.promoted_task_no}
                                  </p>
                                )}
                                {mayCreate && l.kind === "dadakan" && !l.promoted_task_no && (
                                  promoting?.id === l.id ? (
                                    <div className="mt-1.5 flex flex-wrap items-end gap-2">
                                      <label className="text-[12px] text-slate-600">
                                        {tr("Due", "Jatuh tempo")}
                                        <input type="date" value={promoting.due} min={officeToday()}
                                          onChange={(e) => setPromoting({ ...promoting, due: e.target.value })}
                                          className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                                      </label>
                                      <label className="text-[12px] text-slate-600">
                                        {tr("Goal (optional)", "Sasaran (boleh kosong)")}
                                        <select value={promoting.goal} onChange={(e) => setPromoting({ ...promoting, goal: e.target.value })}
                                          className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                                          <option value="">{tr("— none —", "— tidak ada —")}</option>
                                          {goals.map((g) => <option key={g.goal_no} value={g.goal_no}>#{g.rank} · {g.title}</option>)}
                                        </select>
                                      </label>
                                      <Button size="sm" disabled={busy || !promoting.due} onClick={() => promote(l)}>
                                        {tr("Make it a task", "Jadikan tugas")}
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setPromoting(null)}>{tr("Cancel", "Batal")}</Button>
                                    </div>
                                  ) : (
                                    <Button size="sm" variant="ghost" icon={ClipboardList} className="mt-1"
                                      onClick={() => setPromoting({ id: l.id, due: officeToday(), goal: "" })}>
                                      {tr("Make it a task", "Jadikan tugas")}
                                    </Button>
                                  )
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Loaded>
    </div>
  );
}
