"use client";

import { useState } from "react";
import { ClipboardPen, PackageCheck, Pencil, Trash2, Zap } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { WorkEvidencePanel } from "@/components/hr/work-evidence";
import { cn } from "@/lib/cn";
import { addDays } from "@/services/hr/task-periods";
import { officeToday } from "@/lib/office";
import { hr } from "@/demo/api";
import type { WorkLogEntry, WorkProgress } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const DADAKAN = "__dadakan__";

/** *Hari ini* — what the person did today, in their own words (D371).
 *
 *  Pick the task it was for, or *dadakan* with who asked; say how far it got;
 *  hours if you know them. Only today can be written or changed: the log is
 *  what a review is read from (D372), and a log written the night before the
 *  review is not evidence of anything.
 *
 *  *Selesai* here does not close a task. Closing still takes the hand-over
 *  note (D368), and the button for it sits right beside the line, so the two
 *  stay one tap apart rather than one silently doing the other.
 */
export function DailyLogTab({ employeeNo }: { employeeNo: string }) {
  const { toast } = useToast();
  const tr = useTr();
  const today = officeToday();

  const [tasks, reloadTasks] = useLoad(() => hr.listTasks({ assignee_no: employeeNo }), [employeeNo]);
  /* Forced to this person, as the Tugas tab is: an account that also holds
     HRD access would otherwise be handed everybody's day on its own profile. */
  const [lines, reloadLines] = useLoad(
    () => hr.listWorkLog({ from: today, to: today, employee_no: employeeNo }), [today, employeeNo]);
  const blank = { entry_id: null as string | null, task: "", summary: "", progress: "lanjut" as WorkProgress,
                  requested_by: "", hours: "" };
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);

  const openTasks = tasks.status === "ready"
    ? tasks.data.filter((t) => t.status === "OPEN" || (t.status === "DONE" && t.done_at?.slice(0, 10) === today))
    : [];
  const isDadakan = draft.task === DADAKAN;

  async function save() {
    setBusy(true);
    const res = await hr.logWork({
      entry_id: draft.entry_id,
      task_no: isDadakan ? null : draft.task,
      summary: draft.summary,
      progress: draft.progress,
      requested_by: isDadakan ? draft.requested_by : null,
      hours: draft.hours ? Number(draft.hours.replace(",", ".")) : null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Logged", "Tercatat"), res.data.task_title ?? tr("Dadakan", "Dadakan"));
    setDraft(blank);
    reloadLines(); setStamp((n) => n + 1);
  }

  function edit(l: WorkLogEntry) {
    setDraft({
      entry_id: l.id, task: l.task_no ?? DADAKAN, summary: l.summary, progress: l.progress,
      requested_by: l.requested_by ?? "", hours: l.hours === null ? "" : String(l.hours),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(l: WorkLogEntry) {
    if (!window.confirm(tr("Remove this line from today's log?", "Hapus catatan ini dari laporan hari ini?"))) return;
    setBusy(true);
    const res = await hr.removeWorkLog({ entry_id: l.id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak terhapus"), res.error.message); return; }
    reloadLines(); setStamp((n) => n + 1);
  }

  async function closeTask(l: WorkLogEntry) {
    const delivered = window.prompt(tr(
      `Close "${l.task_title}".\n\nWhat did you hand over, and where? Required.`,
      `Tutup "${l.task_title}".\n\nApa yang Anda serahkan, dan ke mana? Wajib diisi.`,
    ), "");
    if (delivered === null) return;
    if (!delivered.trim()) {
      toast("warning", tr("Not closed", "Belum ditutup"), tr("Write what was handed over.", "Tulis apa yang diserahkan."));
      return;
    }
    setBusy(true);
    const res = await hr.updateTask({ task_no: l.task_no!, action: "done", delivered });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not closed", "Belum ditutup"), res.error.message); return; }
    toast("success", l.task_no!, tr("Task closed and handed over.", "Tugas ditutup dan diserahkan."));
    reloadTasks(); reloadLines();
  }

  const progressChoices: [WorkProgress, string, string][] = [
    ["lanjut", "Ongoing", "Lanjut"], ["selesai", "Done", "Selesai"], ["tertahan", "Blocked", "Tertahan"],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={draft.entry_id ? tr("Change a line", "Ubah catatan") : tr(`Today's log — ${today}`, `Laporan hari ini — ${today}`)}
          subtitle={tr(
            "What did you work on, for which task — or was it dadakan? Only today can be written or changed.",
            "Apa yang Anda kerjakan, untuk tugas mana — atau dadakan? Hanya hari ini yang bisa diisi atau diubah.",
          )}
          icon={ClipboardPen}
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="text-[12px] text-slate-600 sm:col-span-2">
            {tr("For", "Untuk")}
            <select value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">{tr("— choose a task, or dadakan —", "— pilih tugas, atau dadakan —")}</option>
              {openTasks.map((t) => (
                <option key={t.task_no} value={t.task_no}>
                  {t.goal_rank !== null ? `#${t.goal_rank} · ` : ""}{t.title}
                </option>
              ))}
              <option value={DADAKAN}>{tr("Dadakan — not an assigned task", "Dadakan — bukan tugas yang diberikan")}</option>
            </select>
          </label>
          {isDadakan && (
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              <Zap className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
              {tr("Who asked for it", "Diminta oleh siapa")}
              <input value={draft.requested_by} onChange={(e) => setDraft({ ...draft, requested_by: e.target.value })}
                placeholder={tr("e.g. Pak Evin, the procurement team", "mis. Pak Evin, tim procurement")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr("Required — it is what shows where the day went, and it is never held against you.",
                    "Wajib — ini yang menunjukkan ke mana hari Anda terpakai, dan tidak pernah dihitung merugikan Anda.")}
              </span>
            </label>
          )}
          <label className="text-[12px] text-slate-600 sm:col-span-2">
            {tr("What you did", "Yang dikerjakan")}
            <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <div className="text-[12px] text-slate-600">
            {tr("Progress", "Progres")}
            <div className="mt-1 flex gap-1.5">
              {progressChoices.map(([k, en, id]) => (
                <button key={k} type="button" onClick={() => setDraft({ ...draft, progress: k })}
                  className={cn("h-9 flex-1 rounded-lg border text-[13px] font-medium",
                    draft.progress === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                  {tr(en, id)}
                </button>
              ))}
            </div>
          </div>
          <label className="text-[12px] text-slate-600">
            {tr("Hours (optional)", "Jam (boleh kosong)")}
            <input value={draft.hours} inputMode="decimal" onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {draft.entry_id && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(blank)}>{tr("Cancel", "Batal")}</Button>
          )}
          <Button size="sm" onClick={save}
            disabled={busy || !draft.task || !draft.summary.trim() || (isDadakan && !draft.requested_by.trim())}>
            {draft.entry_id ? tr("Save change", "Simpan perubahan") : tr("Add to today's log", "Tambah ke laporan hari ini")}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title={tr("Logged today", "Tercatat hari ini")} icon={ClipboardPen} />
        <Loaded state={lines} onRetry={reloadLines}>
          {(list) => list.length === 0 ? (
            <p className="px-5 py-5 text-[13px] text-slate-500">
              {tr("Nothing yet today.", "Belum ada catatan hari ini.")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((l) => (
                <li key={l.id} className="px-5 py-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {l.kind === "dadakan"
                      ? <Badge tone="amber">{tr("dadakan", "dadakan")}</Badge>
                      : <Badge tone="brand">{l.goal_rank !== null ? `#${l.goal_rank}` : tr("task", "tugas")}</Badge>}
                    <span className="font-medium text-slate-800">{l.task_title ?? l.summary}</span>
                    <Badge tone={l.progress === "selesai" ? "green" : l.progress === "tertahan" ? "amber" : "slate"}>
                      {l.progress === "lanjut" ? tr("ongoing", "lanjut") : l.progress === "selesai" ? tr("done", "selesai") : tr("blocked", "tertahan")}
                    </Badge>
                    {l.hours !== null && <span className="text-[12px] text-slate-400">{tr(`${l.hours} h`, `${l.hours} jam`)}</span>}
                  </div>
                  {l.task_title && <p className="mt-0.5 text-slate-600">{l.summary}</p>}
                  {l.requested_by && (
                    <p className="text-[12px] text-slate-500">{tr("asked by", "diminta oleh")} {l.requested_by}</p>
                  )}
                  {l.promoted_task_no && (
                    <p className="text-[12px] text-slate-500">{tr("HRD made this a task:", "HRD menjadikannya tugas:")} {l.promoted_task_no}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {l.editable && (
                      <>
                        <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => edit(l)}>{tr("Change", "Ubah")}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => remove(l)}>{tr("Remove", "Hapus")}</Button>
                      </>
                    )}
                    {l.kind === "tugas" && l.progress === "selesai" && l.task_status === "OPEN" && (
                      <Button size="sm" variant="outline" icon={PackageCheck} disabled={busy} onClick={() => closeTask(l)}>
                        {tr("Close the task & hand over", "Tutup tugas & serahkan")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      <Card>
        <div className="px-5 py-4">
          <WorkEvidencePanel employeeNo={employeeNo} from={addDays(today, -29)} to={today} self key={stamp} />
        </div>
      </Card>
    </div>
  );
}
