"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { STAGE_NAME, type ProgressEntry, type ProgressEntryOnOrder } from "@/services/production/contracts";
import {
  progressByDay, progressByHour, progressDays, spanLabel, spanMinutes,
} from "@/services/production/progress-view";
import { officeToday, OFFICE_TZ } from "@/lib/office";
import { useTr } from "@/lib/i18n";

/** How the Job Order moved over time: per day, or hour by hour within a day
 *  (D351). The hourly view starts from where the order stood that morning, and
 *  shows empty hours as empty. */
export function ProgressOverTime({ entries, stageOrder, qty }: { entries: ProgressEntry[]; stageOrder: string[]; qty: number }) {
  const tr = useTr();
  const days = useMemo(() => progressDays(entries), [entries]);
  const timedDays = useMemo(
    () => progressDays(entries.filter((e) => spanMinutes(e) !== null)), [entries],
  );
  const [mode, setMode] = useState<"hour" | "day">(timedDays.length > 0 ? "hour" : "day");
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : (timedDays[0] ?? days[0] ?? officeToday());
  /* The order's own stages, and before them any code an old entry still
     carries — the cutting and assembly bought in since D275 happened before
     the sanding, and a day that only did those must not read as empty. */
  const stages = useMemo(() => {
    const present = new Set(entries.map((e) => e.stage));
    const firstDay = (s: string) => entries.filter((e) => e.stage === s).map((e) => e.work_date).sort()[0];
    const old = [...present].filter((s) => !stageOrder.includes(s))
      .sort((a, b) => firstDay(a).localeCompare(firstDay(b)));
    return [...old, ...stageOrder.filter((s) => present.has(s))];
  }, [entries, stageOrder]);
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
          <Clock className="h-3.5 w-3.5" /> {tr("Progress over time", "Progres berdasarkan waktu")}
        </p>
        <div className="ml-auto flex items-center gap-1">
          {([["hour", tr("Per hour", "Per jam")], ["day", tr("Per day", "Per hari")]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                mode === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {label}
            </button>
          ))}
          {mode === "hour" && (
            <select value={day} onChange={(e) => setPicked(e.target.value)} aria-label={tr("Day", "Hari")}
              className="h-7 rounded-lg border border-slate-200 px-1.5 text-[12px] focus:border-brand-400 focus:outline-none">
              {days.map((d) => (
                <option key={d} value={d}>{d}{timedDays.includes(d) ? "" : tr(" (no hours)", " (tanpa jam)")}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {mode === "day" ? <ByDay entries={entries} stages={stages} qty={qty} /> : <ByHour entries={entries} stages={stages} qty={qty} day={day} />}
    </div>
  );
}

function ByDay({ entries, stages, qty }: { entries: ProgressEntry[]; stages: string[]; qty: number }) {
  const tr = useTr();
  const rows = useMemo(() => progressByDay(entries).reverse(), [entries]);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[480px] text-[12px]">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-1.5 font-medium">{tr("Date", "Tanggal")}</th>
            {stages.map((s) => <th key={s} className="px-2 py-1.5 text-right font-medium">{STAGE_NAME(s)}</th>)}
            <th className="px-3 py-1.5 font-medium">{tr("Who", "Siapa")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="px-3 py-1.5 tabular-nums text-slate-600">
                {r.day}
                {r.timed > 0 && <span className="ml-1 text-[10px] text-slate-400">({tr(`${r.timed} timed`, `${r.timed} berjam`)})</span>}
              </td>
              {stages.map((s) => <StageCell key={s} delta={r.stages[s]} total={r.cumulative[s]} qty={qty} />)}
              <td className="px-3 py-1.5 text-slate-500">{r.workers.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByHour({ entries, stages, qty, day }: { entries: ProgressEntry[]; stages: string[]; qty: number; day: string }) {
  const tr = useTr();
  const d = useMemo(() => progressByHour(entries, day), [entries, day]);
  /* Only the stages worked that day: an hourly table for a Thursday of sanding
     does not need a column for the cutting done in August. */
  const cols = stages.filter((s) => entries.some((e) => e.work_date === day && e.stage === s));
  const hasBefore = cols.some((s) => (d.before[s] ?? 0) !== 0);
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-1.5 font-medium">{tr(`Hour (${OFFICE_TZ.short})`, `Jam (${OFFICE_TZ.short})`)}</th>
              {cols.map((s) => <th key={s} className="px-2 py-1.5 text-right font-medium">{STAGE_NAME(s)}</th>)}
              <th className="px-3 py-1.5 font-medium">{tr("Who", "Siapa")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {hasBefore && (
              <tr className="bg-slate-50/60 text-slate-500">
                <td className="px-3 py-1.5">{tr("Before this day", "Sebelum hari ini")}</td>
                {cols.map((s) => <StageCell key={s} delta={undefined} total={d.before[s]} qty={qty} />)}
                <td />
              </tr>
            )}
            {d.slots.map((slot) => (
              <tr key={slot.index} className={slot.entries.length === 0 ? "text-slate-400" : undefined}>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{slot.label}</td>
                {cols.map((s) => <StageCell key={s} delta={slot.stages[s]} total={slot.cumulative[s]} qty={qty} />)}
                <td className="px-3 py-1.5 text-slate-500">
                  {slot.entries.length === 0
                    ? <span className="text-amber-700">{tr("nothing finished this hour", "tidak ada yang selesai jam ini")}</span>
                    : slot.entries.map((e) => (
                      <span key={e.id} className="mr-2 inline-block">
                        {e.worked_by ?? "—"}{" "}
                        <span className="text-slate-400">{spanLabel(e)} {STAGE_NAME(e.stage)} {e.qty > 0 ? "+" : ""}{formatNumber(e.qty)}</span>
                      </span>
                    ))}
                </td>
              </tr>
            ))}
            {d.slots.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-3 py-3 text-slate-500">
                  {tr("No entry on this day has hours written.", "Tidak ada catatan hari ini yang punya jam.")}
                </td>
              </tr>
            )}
            {d.untimed.entries.length > 0 && (
              <tr className="bg-amber-50/50">
                <td className="px-3 py-1.5 text-amber-800">{tr("Hours not recorded", "Jam tidak dicatat")}</td>
                {cols.map((s) => <StageCell key={s} delta={d.untimed.stages[s]} total={undefined} qty={qty} />)}
                <td className="px-3 py-1.5 text-slate-500">
                  {[...new Set(d.untimed.entries.map((e) => e.worked_by).filter(Boolean))].join(", ") || "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {tr(
          "Each entry sits in the hour it finished in, shown with its span. Entries without hours are counted for the day and not placed in an hour — the time they were typed is not the time they were worked.",
          "Setiap catatan masuk ke jam selesainya, dengan rentangnya ditampilkan. Catatan tanpa jam dihitung untuk harinya dan tidak ditaruh di jam mana pun — waktu diketik bukan waktu dikerjakan.",
        )}
      </p>
    </div>
  );
}

function StageCell({ delta, total, qty }: { delta: number | undefined; total: number | undefined; qty: number }) {
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      {delta ? (
        <span className={cn("block font-medium", delta < 0 ? "text-rose-700" : "text-slate-800")}>
          {delta > 0 ? "+" : ""}{formatNumber(delta)}
        </span>
      ) : <span className="block text-slate-300">·</span>}
      {total !== undefined && (
        <span className={cn("block text-[10px]", total >= qty ? "text-emerald-700" : "text-slate-400")}>
          {formatNumber(total)}/{formatNumber(qty)}
        </span>
      )}
    </td>
  );
}


/** Every piece reported across the floor on one day, in the hour it finished,
 *  with who did it (D351). Across products the pieces are **listed, not
 *  summed** — four chairs and two wardrobes are not six of anything (D264). */
export function FloorHourly({ day }: { day: string }) {
  const [state, reload] = useLoad(() => production.listProgressForDay(day), [day]);
  return (
    <Loaded state={state} onRetry={reload} skeletonRows={3}>
      {(rows) => <FloorTable rows={rows} day={day} />}
    </Loaded>
  );
}

function FloorTable({ rows, day }: { rows: ProgressEntryOnOrder[]; day: string }) {
  const tr = useTr();
  const d = useMemo(() => progressByHour(rows, day), [rows, day]);
  if (rows.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-slate-500">{tr("Nothing reported on this day.", "Belum ada hasil kerja yang dilaporkan pada hari ini.")}</p>;
  }
  const line = (e: ProgressEntryOnOrder) => (
    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-[10px] text-slate-400">{e.wo_no}</span>
      <span className="text-slate-700">{e.item_name}</span>
      <Badge tone="slate">{STAGE_NAME(e.stage)}</Badge>
      <span className={cn("tabular-nums font-medium", e.qty < 0 ? "text-rose-700" : "text-slate-800")}>
        {e.qty > 0 ? "+" : ""}{formatNumber(e.qty)} {e.uom}
      </span>
      <span className="text-slate-500">{e.worked_by ?? "—"}</span>
      {spanLabel(e) && <span className="text-[11px] text-slate-400">{spanLabel(e)}</span>}
    </li>
  );
  return (
    <ul className="divide-y divide-slate-100 text-[12px]">
      {d.slots.map((slot) => (
        <li key={slot.index} className="flex gap-3 px-5 py-2">
          <span className="w-28 shrink-0 tabular-nums text-slate-500">{slot.label}</span>
          {slot.entries.length === 0
            ? <span className="text-amber-700">{tr("nothing finished this hour", "tidak ada yang selesai jam ini")}</span>
            : <ul className="flex-1 space-y-0.5">{slot.entries.map(line)}</ul>}
        </li>
      ))}
      {d.untimed.entries.length > 0 && (
        <li className="flex gap-3 bg-amber-50/50 px-5 py-2">
          <span className="w-28 shrink-0 text-amber-800">{tr("Hours not recorded", "Jam tidak dicatat")}</span>
          <ul className="flex-1 space-y-0.5">{d.untimed.entries.map(line)}</ul>
        </li>
      )}
    </ul>
  );
}
