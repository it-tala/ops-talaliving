"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { addDays } from "@/services/hr/task-periods";
import { hr } from "@/demo/api";
import type { WorkLogEntry, WorkItemView, WorkWeek } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** The Monday of the week a day falls in (D427: weeks start on Monday). */
export function weekStartOf(day: string): string {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}

const MONTHS: [string, string][] = [
  ["January", "Januari"], ["February", "Februari"], ["March", "Maret"], ["April", "April"],
  ["May", "Mei"], ["June", "Juni"], ["July", "Juli"], ["August", "Agustus"],
  ["September", "September"], ["October", "Oktober"], ["November", "November"], ["December", "Desember"],
];
const DAYS: [string, string][] = [
  ["Mon", "Sen"], ["Tue", "Sel"], ["Wed", "Rab"], ["Thu", "Kam"], ["Fri", "Jum"], ["Sat", "Sab"], ["Sun", "Min"],
];

/** *Oktober Minggu 2* — the sheet's label: the month the Monday is in, and
 *  which of that month's Mondays it is. */
export function weekLabel(monday: string, tr: (en: string, id: string) => string): string {
  const month = Number(monday.slice(5, 7)) - 1;
  const n = Math.ceil(Number(monday.slice(8, 10)) / 7);
  return tr(`${MONTHS[month][0]} week ${n}`, `${MONTHS[month][1]} minggu ${n}`);
}

/** Which row of the grid a cell is: a task, an item, or dadakan / lainnya. */
export type WeekRowKey =
  | { kind: "tugas"; task_no: string }
  | { kind: "item"; item_id: string }
  | { kind: "dadakan" };

type Row = { key: string; ref: WeekRowKey; title: string; sub: string | null; closed: boolean };

function rowKeyOf(l: WorkLogEntry): string {
  return l.kind === "tugas" ? `t:${l.task_no}` : l.kind === "item" ? `i:${l.item_id}` : "d";
}

/** Laporan harian **per minggu** — the shape of the personal work-plan sheet
 *  (D427): one row per item, task or dadakan; a week summary, then Senin to
 *  Minggu. Days the person does not work are shaded; an office holiday is
 *  named. Lines dated ahead of when they were written are plans and read as
 *  such.
 *
 *  On the reader's own week, an empty cell (`onPick`) or a line (`onEdit`)
 *  opens the form, and the summary is written in place. Anybody else's week —
 *  HRD's reading — is read-only.
 */
export function WorkWeekGrid({ employeeNo, initialWeek, stamp = 0, onPick, onEdit }: {
  employeeNo: string;
  initialWeek?: string;
  /** Bumped by the parent after it writes a line, to reload. */
  stamp?: number;
  onPick?: (day: string, row: WeekRowKey) => void;
  onEdit?: (line: WorkLogEntry) => void;
}) {
  const tr = useTr();
  const today = officeToday();
  const [week, setWeek] = useState(initialWeek ?? weekStartOf(today));
  const end = addDays(week, 6);

  const [cal, reloadCal] = useLoad(() => hr.getWorkWeek({ employee_no: employeeNo, week_start: week }),
    [employeeNo, week, stamp], { keepPrevious: true });
  const [lines] = useLoad(() => hr.listWorkLog({ from: week, to: end, employee_no: employeeNo }),
    [employeeNo, week, stamp], { keepPrevious: true });
  const [items] = useLoad(() => hr.listWorkItems({ employee_no: employeeNo }), [employeeNo, stamp], { keepPrevious: true });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => setWeek(addDays(week, -7))}>
          <span className="sr-only">{tr("Previous week", "Minggu sebelumnya")}</span>
        </Button>
        <span className="min-w-0 text-[13px]">
          <span className="font-medium text-slate-800">{weekLabel(week, tr)}</span>
          <span className="text-slate-500"> · {week.slice(8, 10)}/{week.slice(5, 7)} – {end.slice(8, 10)}/{end.slice(5, 7)}</span>
        </span>
        <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => setWeek(addDays(week, 7))}>
          <span className="sr-only">{tr("Next week", "Minggu berikutnya")}</span>
        </Button>
        {week !== weekStartOf(today) && (
          <Button size="sm" variant="outline" onClick={() => setWeek(weekStartOf(today))}>{tr("This week", "Minggu ini")}</Button>
        )}
      </div>
      <Loaded state={cal} onRetry={reloadCal}>
        {(w) => (
          <Grid week={w} today={today}
            lines={lines.status === "ready" ? lines.data : []}
            items={items.status === "ready" ? items.data : []}
            onPick={w.mine ? onPick : undefined} onEdit={w.mine ? onEdit : undefined} onSaved={reloadCal} />
        )}
      </Loaded>
    </div>
  );
}

function Grid({ week, today, lines, items, onPick, onEdit, onSaved }: {
  week: WorkWeek; today: string; lines: WorkLogEntry[]; items: WorkItemView[];
  onPick?: (day: string, row: WeekRowKey) => void;
  onEdit?: (line: WorkLogEntry) => void;
  onSaved: () => void;
}) {
  const tr = useTr();

  /* Rows: the person's open items, then any item or task this week touched
     (a line or a summary), then dadakan / lainnya — always there, because it
     is where the unplanned goes. */
  const rows: Row[] = [];
  const seen = new Set<string>();
  const add = (r: Row) => { if (!seen.has(r.key)) { seen.add(r.key); rows.push(r); } };
  const used = new Set(lines.map(rowKeyOf));
  for (const n of week.notes) used.add(n.item_id ? `i:${n.item_id}` : n.task_no ? `t:${n.task_no}` : "d");
  for (const it of items) {
    if (it.status === "aktif" || used.has(`i:${it.id}`)) {
      add({ key: `i:${it.id}`, ref: { kind: "item", item_id: it.id }, title: it.title,
            sub: it.status === "aktif" ? null : it.status, closed: it.status !== "aktif" });
    }
  }
  for (const l of lines.filter((x) => x.kind === "tugas")) {
    add({ key: `t:${l.task_no}`, ref: { kind: "tugas", task_no: l.task_no! }, title: l.task_title ?? l.task_no!,
          sub: l.goal_rank !== null ? tr(`task · goal #${l.goal_rank}`, `tugas · sasaran #${l.goal_rank}`) : tr("task", "tugas"),
          closed: l.task_status !== "OPEN" });
  }
  for (const n of week.notes.filter((x) => x.task_no)) {
    add({ key: `t:${n.task_no}`, ref: { kind: "tugas", task_no: n.task_no! }, title: n.task_title ?? n.task_no!,
          sub: tr("task", "tugas"), closed: false });
  }
  add({ key: "d", ref: { kind: "dadakan" }, title: tr("Dadakan / other", "Dadakan / lainnya"), sub: null, closed: false });

  const noteOf = (r: Row) => week.notes.find((n) =>
    r.ref.kind === "item" ? n.item_id === r.ref.item_id
      : r.ref.kind === "tugas" ? n.task_no === r.ref.task_no
        : n.item_id === null && n.task_no === null)?.summary ?? "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] table-fixed border-collapse text-[12px]">
        <colgroup>
          <col className="w-[170px]" />
          <col className="w-[180px]" />
          {week.days.map((d) => <col key={d.date} />)}
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] text-slate-500">
            <th className="border-b border-r border-slate-200 px-2 py-1.5 font-medium">{tr("Item", "Item")}</th>
            <th className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 font-medium">
              {tr("Week summary", "Ringkasan minggu")}
            </th>
            {week.days.map((d, i) => (
              <th key={d.date} title={d.holiday ?? d.mark_reason ?? undefined}
                className={cn("border-b border-r border-slate-200 px-2 py-1.5 font-medium",
                  d.holiday ? "bg-rose-50" : !d.works ? "bg-slate-100" : "",
                  d.date === today && "text-slate-900")}>
                <span className={cn(d.date === today && "rounded bg-slate-800 px-1 text-white")}>
                  {tr(...DAYS[i])} {d.date.slice(8, 10)}
                </span>
                {d.holiday && <span className="block truncate font-normal text-rose-700">{d.holiday}</span>}
                {!d.holiday && d.mark_kind && <span className="block truncate font-normal text-slate-500">{d.mark_kind}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              <th scope="row" className="border-b border-r border-slate-200 px-2 py-1.5 text-left font-normal">
                <span className={cn("block font-medium", r.closed ? "text-slate-400" : "text-slate-800")}>
                  {r.ref.kind === "dadakan" && <Zap className="mr-0.5 inline h-3 w-3 text-amber-600" />}
                  {r.title}
                </span>
                {r.sub && <span className="block text-[11px] text-slate-400">{r.sub}</span>}
              </th>
              <td className="border-b border-r border-slate-200 bg-slate-50/60 p-0">
                <WeekNote mine={week.mine} weekStart={week.week_start} row={r.ref} value={noteOf(r)} onSaved={onSaved} />
              </td>
              {week.days.map((d) => {
                const here = lines.filter((l) => l.work_date === d.date && rowKeyOf(l) === r.key);
                const canAdd = onPick && !(r.closed && r.ref.kind !== "dadakan") && (here.length === 0 || r.ref.kind === "dadakan");
                return (
                  <td key={d.date}
                    className={cn("border-b border-r border-slate-200 px-1.5 py-1",
                      d.holiday ? "bg-rose-50/60" : !d.works ? "bg-slate-100/70" : "")}>
                    {here.map((l) => {
                      const plan = l.written_on < l.work_date;
                      return (
                        <button key={l.id} type="button" disabled={!onEdit || !l.editable}
                          onClick={() => onEdit?.(l)}
                          title={plan ? tr(`planned on ${l.written_on}`, `direncanakan ${l.written_on}`)
                            : l.written_on > l.work_date ? tr(`written on ${l.written_on}`, `ditulis ${l.written_on}`) : undefined}
                          className={cn("mb-1 block w-full rounded px-1 py-0.5 text-left leading-snug",
                            onEdit && l.editable ? "hover:bg-slate-100" : "cursor-default",
                            plan && "border border-dashed border-slate-300 italic text-slate-500")}>
                          <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                            l.progress === "selesai" ? "bg-emerald-500" : l.progress === "tertahan" ? "bg-amber-500" : "bg-slate-400")} />
                          {l.summary}
                          {l.requested_by && <span className="text-slate-400"> — {l.requested_by}</span>}
                          {l.hours !== null && <span className="text-slate-400"> · {tr(`${l.hours}h`, `${l.hours}j`)}</span>}
                        </button>
                      );
                    })}
                    {canAdd && (
                      <button type="button" onClick={() => onPick!(d.date, r.ref)}
                        className="block w-full rounded px-1 py-0.5 text-left text-[11px] text-slate-300 hover:bg-slate-100 hover:text-slate-600">
                        + {d.date > today ? tr("plan", "rencana") : tr("log", "catat")}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />{tr("done", "selesai")}
        <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />{tr("ongoing", "lanjut")}
        <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />{tr("blocked", "tertahan")}
        <span className="ml-3 italic">{tr("dashed = written ahead as a plan", "garis putus = ditulis di muka sebagai rencana")}</span>
        <span className="ml-3">{tr("grey = not a working day; pink = holiday", "abu-abu = bukan hari kerja; merah muda = libur")}</span>
      </p>
    </div>
  );
}

/** The week's summary for one row, written in place on one's own week and
 *  saved when the field is left. */
function WeekNote({ mine, weekStart, row, value, onSaved }: {
  mine: boolean; weekStart: string; row: WeekRowKey; value: string; onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(value), [value, weekStart]);

  if (!mine) {
    return <p className="whitespace-pre-wrap px-2 py-1.5 text-slate-700">{value || <span className="text-slate-300">—</span>}</p>;
  }
  async function save() {
    if (text.trim() === value.trim()) return;
    setBusy(true);
    const res = await hr.saveWorkWeekNote({
      week_start: weekStart, summary: text,
      item_id: row.kind === "item" ? row.item_id : null,
      task_no: row.kind === "tugas" ? row.task_no : null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    onSaved();
  }
  return (
    <textarea value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onBlur={save} rows={3}
      placeholder={tr("What this week came to…", "Hasil minggu ini…")}
      aria-label={tr("Week summary", "Ringkasan minggu")}
      className="block w-full resize-y border-0 bg-transparent px-2 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-300" />
  );
}
