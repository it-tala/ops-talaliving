"use client";

import { useRef, useState } from "react";
import { CalendarDays, CalendarRange, ClipboardPen, ListTree, PackageCheck, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { WorkEvidencePanel } from "@/components/hr/work-evidence";
import { WorkWeekGrid, weekStartOf, type WeekRowKey } from "@/components/hr/work-week-grid";
import { cn } from "@/lib/cn";
import { addDays } from "@/services/hr/task-periods";
import { officeToday } from "@/lib/office";
import { hr } from "@/demo/api";
import type { WorkItemStatus, WorkItemView, WorkLogEntry, WorkProgress } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const DADAKAN = "__dadakan__";
const NEW_ITEM = "__new_item__";
const ITEM = "item:";

/** *Hari ini* — what the person did, in their own words (D371), laid out the
 *  way the personal work-plan sheet is (D428).
 *
 *  Pick the task it was for, one of your own long-running items, or
 *  *dadakan* with who asked; say how far it got; hours if you know them. Any
 *  day can be written — past days, and coming ones as your own plan. The
 *  record keeps when a line was written, and a planned day counts as logged
 *  only once you come back to it on the day (D428).
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
     HRD access would otherwise be handed everybody's items on its own profile. */
  const [items, reloadItems] = useLoad(() => hr.listWorkItems({ employee_no: employeeNo }), [employeeNo]);
  /* What the person planned for today across their tasks (D384) — the log
     below is written against it. */
  const [plan] = useLoad(() => hr.getMyPlan(), [today]);
  const blank = { entry_id: null as string | null, date: today, task: "", summary: "", progress: "lanjut" as WorkProgress,
                  requested_by: "", hours: "" };
  const [draft, setDraft] = useState(blank);
  /* The day the list below shows: the form's day. */
  const [lines, reloadLines] = useLoad(
    () => hr.listWorkLog({ from: draft.date, to: draft.date, employee_no: employeeNo }), [draft.date, employeeNo]);
  const [newItem, setNewItem] = useState("");
  const [listItem, setListItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  /* A task can carry a line up to the day it was closed (0267). */
  const openTasks = tasks.status === "ready"
    ? tasks.data.filter((t) => t.status === "OPEN"
        || (t.status === "DONE" && t.done_at !== null && draft.date <= t.done_at.slice(0, 10)))
    : [];
  const itemList = items.status === "ready" ? items.data : [];
  const openItems = itemList.filter((i) => i.status === "aktif" || draft.task === ITEM + i.id);
  const isDadakan = draft.task === DADAKAN;
  const isNewItem = draft.task === NEW_ITEM;
  const itemId = draft.task.startsWith(ITEM) ? draft.task.slice(ITEM.length) : null;
  const ahead = draft.date > today;

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    setBusy(true);
    let item = itemId;
    if (isNewItem) {
      const made = await hr.saveWorkItem({ title: newItem });
      if (made.error) {
        setBusy(false);
        toast("warning", tr("Item not made", "Item tidak dibuat"), made.error.message);
        return;
      }
      item = made.data.id;
      setNewItem(""); reloadItems();
    }
    const res = await hr.logWork({
      entry_id: draft.entry_id,
      work_date: draft.date,
      task_no: isDadakan || item ? null : draft.task,
      item_id: item,
      summary: draft.summary,
      progress: draft.progress,
      requested_by: isDadakan ? draft.requested_by : null,
      hours: draft.hours ? Number(draft.hours.replace(",", ".")) : null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", ahead ? tr("Planned", "Direncanakan") : tr("Logged", "Tercatat"),
      res.data.task_title ?? res.data.item_title ?? tr("Dadakan", "Dadakan"));
    setDraft({ ...blank, date: draft.date });
    reloadLines(); reloadItems(); setStamp((n) => n + 1);
  }

  function edit(l: WorkLogEntry) {
    setDraft({
      entry_id: l.id, date: l.work_date,
      task: l.task_no ?? (l.item_id ? ITEM + l.item_id : DADAKAN), summary: l.summary, progress: l.progress,
      requested_by: l.requested_by ?? "", hours: l.hours === null ? "" : String(l.hours),
    });
    scrollToForm();
  }

  function pick(day: string, row: WeekRowKey) {
    setDraft({
      ...blank, date: day,
      task: row.kind === "tugas" ? row.task_no : row.kind === "item" ? ITEM + row.item_id : DADAKAN,
    });
    scrollToForm();
  }

  async function setItemStatus(it: WorkItemView, status: WorkItemStatus) {
    setBusy(true);
    const res = await hr.saveWorkItem({ item_id: it.id, status });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    reloadItems(); setStamp((n) => n + 1);
  }

  async function renameItem(it: WorkItemView) {
    const title = window.prompt(tr("New name for the item", "Nama baru untuk item ini"), it.title);
    if (title === null || !title.trim() || title.trim() === it.title) return;
    setBusy(true);
    const res = await hr.saveWorkItem({ item_id: it.id, title });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    reloadItems(); setStamp((n) => n + 1);
  }

  async function addItem() {
    setBusy(true);
    const res = await hr.saveWorkItem({ title: listItem });
    setBusy(false);
    if (res.error) { toast("warning", tr("Item not made", "Item tidak dibuat"), res.error.message); return; }
    setListItem(""); reloadItems(); setStamp((n) => n + 1);
  }

  async function remove(l: WorkLogEntry) {
    if (!window.confirm(tr(`Remove this line from ${l.work_date}?`, `Hapus catatan ini dari ${l.work_date}?`))) return;
    setBusy(true);
    const res = await hr.removeWorkLog({ entry_id: l.id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak terhapus"), res.error.message); return; }
    if (draft.entry_id === l.id) setDraft({ ...blank, date: draft.date });
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
    reloadTasks(); reloadLines(); setStamp((n) => n + 1);
  }

  const progressChoices: [WorkProgress, string, string][] = [
    ["lanjut", "Ongoing", "Lanjut"], ["selesai", "Done", "Selesai"], ["tertahan", "Blocked", "Tertahan"],
  ];

  return (
    <div className="space-y-4">
      {plan.status === "ready" && plan.data.length > 0 && (
        <Card>
          <CardHeader
            title={tr("Planned for today", "Rencana hari ini")}
            subtitle={tr("Your own targets from the tasks' daily plans. Log against them: what got done, and how far.",
                         "Target Anda sendiri dari rencana per hari di tiap tugas. Catat terhadapnya: apa yang selesai, dan sejauh mana.")}
            icon={CalendarDays}
          />
          <ul className="divide-y divide-slate-100">
            {plan.data.map((l) => {
              const open = openTasks.some((t) => t.task_no === l.task_no);
              const logged = draft.date === today && lines.status === "ready" && lines.data.some((x) => x.task_no === l.task_no);
              return (
                <li key={l.task_no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-slate-500">
                      {l.goal_rank !== null ? `#${l.goal_rank} · ` : ""}{l.title}
                    </span>
                    <span className="text-slate-800">{l.target}</span>
                  </span>
                  {logged ? (
                    <Badge tone="green">{tr("logged", "sudah dicatat")}</Badge>
                  ) : open && (
                    <Button size="sm" variant="outline" icon={ClipboardPen}
                      onClick={() => { setDraft({ ...blank, task: l.task_no, summary: l.target }); scrollToForm(); }}>
                      {tr("Log it", "Catat")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div ref={formRef} className="scroll-mt-4">
      <Card>
        <CardHeader
          title={draft.entry_id ? tr("Change a line", "Ubah catatan")
            : ahead ? tr(`Plan — ${draft.date}`, `Rencana — ${draft.date}`)
            : draft.date === today ? tr(`Today's log — ${today}`, `Laporan hari ini — ${today}`)
            : tr(`Log for ${draft.date}`, `Laporan ${draft.date}`)}
          subtitle={tr(
            "What did you work on — for a task, one of your own items, or dadakan? Any day: past days, or coming ones as your plan.",
            "Apa yang Anda kerjakan — untuk tugas, item jangka panjang Anda, atau dadakan? Hari apa pun: yang lewat, atau ke depan sebagai rencana.",
          )}
          icon={ClipboardPen}
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="text-[12px] text-slate-600">
            {tr("Day", "Tanggal")}
            <input type="date" value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value || today })}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            {draft.date !== today && (
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {ahead
                  ? tr("A plan. It counts as logged once you open it again on the day.",
                       "Rencana. Dihitung terisi setelah Anda membukanya lagi pada harinya.")
                  : tr("Written later — the log keeps the day it was written.",
                       "Diisi belakangan — laporan menyimpan tanggal penulisannya.")}
              </span>
            )}
          </label>
          <label className="text-[12px] text-slate-600">
            {tr("For", "Untuk")}
            <select value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">{tr("— choose a task, an item, or dadakan —", "— pilih tugas, item, atau dadakan —")}</option>
              {openTasks.length > 0 && (
                <optgroup label={tr("Assigned tasks", "Tugas yang diberikan")}>
                  {openTasks.map((t) => (
                    <option key={t.task_no} value={t.task_no}>
                      {t.goal_rank !== null ? `#${t.goal_rank} · ` : ""}{t.title}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={tr("My long-running items", "Item jangka panjang saya")}>
                {openItems.map((i) => <option key={i.id} value={ITEM + i.id}>{i.title}</option>)}
                <option value={NEW_ITEM}>{tr("+ New item…", "+ Item baru…")}</option>
              </optgroup>
              <option value={DADAKAN}>{tr("Dadakan — not an assigned task", "Dadakan — bukan tugas yang diberikan")}</option>
            </select>
          </label>
          {isNewItem && (
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              <ListTree className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
              {tr("Name of the new item", "Nama item baru")}
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} maxLength={120}
                placeholder={tr("e.g. Google Workspace, HRD system", "mis. Google Workspace, Sistem HRD")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr("A row of your own that runs for weeks — it stays in the list until you mark it done.",
                    "Baris milik Anda sendiri yang berjalan berminggu-minggu — tetap di daftar sampai Anda tandai selesai.")}
              </span>
            </label>
          )}
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
            <Button size="sm" variant="ghost" onClick={() => setDraft({ ...blank, date: draft.date })}>{tr("Cancel", "Batal")}</Button>
          )}
          <Button size="sm" onClick={save}
            disabled={busy || !draft.task || !draft.summary.trim() || (isDadakan && !draft.requested_by.trim())
              || (isNewItem && !newItem.trim())}>
            {draft.entry_id ? tr("Save change", "Simpan perubahan")
              : ahead ? tr("Add to the plan", "Tambah ke rencana")
              : tr("Add to the log", "Tambah ke laporan")}
          </Button>
        </div>
      </Card>
      </div>

      <Card>
        <CardHeader title={draft.date === today ? tr("Logged today", "Tercatat hari ini") : tr(`Logged for ${draft.date}`, `Tercatat untuk ${draft.date}`)} icon={ClipboardPen} />
        <Loaded state={lines} onRetry={reloadLines}>
          {(list) => list.length === 0 ? (
            <p className="px-5 py-5 text-[13px] text-slate-500">
              {draft.date === today ? tr("Nothing yet today.", "Belum ada catatan hari ini.")
                : tr("Nothing on this day.", "Belum ada catatan pada hari ini.")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((l) => (
                <li key={l.id} className="px-5 py-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {l.kind === "dadakan"
                      ? <Badge tone="amber">{tr("dadakan", "dadakan")}</Badge>
                      : l.kind === "item"
                        ? <Badge tone="slate">{tr("item", "item")}</Badge>
                        : <Badge tone="brand">{l.goal_rank !== null ? `#${l.goal_rank}` : tr("task", "tugas")}</Badge>}
                    <span className="font-medium text-slate-800">{l.task_title ?? l.item_title ?? l.summary}</span>
                    <Badge tone={l.progress === "selesai" ? "green" : l.progress === "tertahan" ? "amber" : "slate"}>
                      {l.progress === "lanjut" ? tr("ongoing", "lanjut") : l.progress === "selesai" ? tr("done", "selesai") : tr("blocked", "tertahan")}
                    </Badge>
                    {l.hours !== null && <span className="text-[12px] text-slate-400">{tr(`${l.hours} h`, `${l.hours} jam`)}</span>}
                  </div>
                  {(l.task_title ?? l.item_title) && <p className="mt-0.5 text-slate-600">{l.summary}</p>}
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
        <CardHeader
          title={tr("Week by week", "Per minggu")}
          subtitle={tr(
            "Your log the way the work-plan sheet reads: one row per item, a summary per week, Monday to Sunday. Tap an empty cell to log or plan it.",
            "Laporan Anda seperti lembar rencana kerja: satu baris per item, ringkasan per minggu, Senin sampai Minggu. Ketuk sel kosong untuk mencatat atau merencanakan.",
          )}
          icon={CalendarRange}
        />
        <WorkWeekGrid employeeNo={employeeNo} initialWeek={weekStartOf(today)} stamp={stamp} onPick={pick} onEdit={edit} />
      </Card>

      <Card>
        <CardHeader
          title={tr("My long-running items", "Item jangka panjang saya")}
          subtitle={tr("Your own rows of the log. Mark one done or stopped when it ends — its lines stay.",
                       "Baris laporan milik Anda sendiri. Tandai selesai atau dihentikan bila berakhir — catatannya tetap.")}
          icon={ListTree}
        />
        <Loaded state={items} onRetry={reloadItems}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2 text-[13px]">
                  <span className={cn("min-w-0 flex-1", it.status === "aktif" ? "text-slate-800" : "text-slate-400 line-through")}>
                    {it.title}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {tr(`${it.entries} lines`, `${it.entries} catatan`)}{it.last_date && ` · ${it.last_date}`}
                  </span>
                  {it.status !== "aktif" && <Badge tone="slate">{it.status}</Badge>}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => renameItem(it)}>{tr("Rename", "Ganti nama")}</Button>
                  {it.status === "aktif" ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setItemStatus(it, "selesai")}>{tr("Done", "Selesai")}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setItemStatus(it, "dihentikan")}>{tr("Stop", "Hentikan")}</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setItemStatus(it, "aktif")}>{tr("Reopen", "Aktifkan")}</Button>
                  )}
                </li>
              ))}
              <li className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <input value={listItem} onChange={(e) => setListItem(e.target.value)} maxLength={120}
                  placeholder={tr("New item, e.g. Google Workspace", "Item baru, mis. Google Workspace")}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm" />
                <Button size="sm" variant="outline" icon={Plus} disabled={busy || !listItem.trim()} onClick={addItem}>
                  {tr("Add", "Tambah")}
                </Button>
              </li>
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
