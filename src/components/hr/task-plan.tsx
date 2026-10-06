"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { hr } from "@/demo/api";
import type { TaskPlanDay } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const DAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Rencana per hari (D384): one line per day from today to the due date —
 *  what the holder means to get done that day toward this task.
 *
 *  The holder writes; anybody else allowed to see it (HRD) reads the same
 *  rows. Each line saves when the field is left, so a plan is never lost to
 *  a forgotten button. A day off is shown as one, so the plan is read
 *  against the real calendar. Nothing here is scored (D261). */
export function TaskPlanDays({ taskNo, stamp }: { taskNo: string; stamp?: unknown }) {
  const tr = useTr();
  const [days, reload] = useLoad(() => hr.getTaskPlan({ task_no: taskNo }), [taskNo, stamp]);
  return (
    <Loaded state={days} onRetry={reload}>
      {(list) => <PlanRows taskNo={taskNo} days={list} tr={tr} />}
    </Loaded>
  );
}

function PlanRows({ taskNo, days, tr }: {
  taskNo: string; days: TaskPlanDay[]; tr: (en: string, id: string) => string;
}) {
  const today = officeToday();
  /* Saved targets, kept here so the count moves the moment a line is saved. */
  const [targets, setTargets] = useState<Record<string, string>>(
    () => Object.fromEntries(days.map((d) => [d.plan_date, d.target ?? ""])));
  const working = days.filter((d) => d.works && d.plan_date >= today);
  const planned = working.filter((d) => (targets[d.plan_date] ?? "").trim() !== "");
  const anyEditable = days.some((d) => d.editable);
  /* A month-long task is thirty lines: the next week shows, the rest on ask. */
  const [all, setAll] = useState(false);
  const shown = all ? days : days.slice(0, 7);

  /* Past its due date with nothing left to plan: say what to do instead of
     drawing a field that would only refuse. */
  if (!anyEditable && days.every((d) => !d.target) && days.length > 0 && days[days.length - 1].plan_date >= today) {
    return (
      <p className="text-[12px] text-slate-500">
        {tr("The due date has passed, so there are no days left to plan. Hand it over, mark it blocked, or ask HRD for a new date.",
            "Jatuh tempo sudah lewat, jadi tidak ada hari tersisa untuk direncanakan. Serahkan, tandai tertahan, atau minta tanggal baru ke HRD.")}
      </p>
    );
  }
  if (days.length === 0) {
    return <p className="text-[12px] text-slate-500">{tr("No plan was written.", "Tidak ada rencana yang ditulis.")}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-slate-500">
        {anyEditable
          ? tr(`What will you get done each day to hand this over on time? ${planned.length} of ${working.length} working days planned.`,
               `Apa yang akan Anda selesaikan tiap hari supaya tugas ini selesai tepat waktu? ${planned.length} dari ${working.length} hari kerja sudah direncanakan.`)
          : tr(`${planned.length} of ${working.length} remaining working days planned.`,
               `${planned.length} dari ${working.length} hari kerja tersisa sudah direncanakan.`)}
      </p>
      <ul className="space-y-1">
        {shown.map((d) => (
          <PlanRow key={d.plan_date} taskNo={taskNo} day={d} today={today} tr={tr}
            onSaved={(text) => setTargets((m) => ({ ...m, [d.plan_date]: text }))} />
        ))}
      </ul>
      {days.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-[12px] font-medium text-brand-700 hover:underline">
          {tr(`Show all ${days.length} days to the due date`, `Tampilkan semua ${days.length} hari sampai jatuh tempo`)}
        </button>
      )}
    </div>
  );
}

function PlanRow({ taskNo, day, today, tr, onSaved }: {
  taskNo: string; day: TaskPlanDay; today: string; tr: (en: string, id: string) => string;
  onSaved: (text: string) => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState(day.target ?? "");
  const [saved, setSaved] = useState(day.target ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => { setText(day.target ?? ""); setSaved(day.target ?? ""); }, [day.target]);

  const wd = new Date(`${day.plan_date}T00:00:00Z`).getUTCDay();
  const label = `${tr(DAYS_EN[wd], DAYS_ID[wd])} ${day.plan_date.slice(8, 10)}-${day.plan_date.slice(5, 7)}`;
  const isToday = day.plan_date === today;
  const past = day.plan_date < today;

  async function save() {
    if (text.trim() === saved.trim()) return;
    setState("saving");
    const res = await hr.saveTaskPlan({ task_no: taskNo, plan_date: day.plan_date, target: text });
    if (res.error) {
      setState("idle");
      toast("warning", tr("Plan not saved", "Rencana tidak tersimpan"), res.error.message);
      return;
    }
    setSaved(text);
    onSaved(text);
    setState("saved");
    window.setTimeout(() => setState("idle"), 1500);
  }

  return (
    <li className={cn("flex items-start gap-2", !day.works && "opacity-60")}>
      <span className={cn("mt-1.5 w-16 shrink-0 font-mono text-[11px]",
        isToday ? "font-semibold text-brand-700" : past ? "text-slate-400" : "text-slate-500")}>
        {label}
      </span>
      {day.editable ? (
        <input
          id={`plan-${taskNo}-${day.plan_date}`}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder={day.works
            ? (isToday ? tr("Today's target for this task", "Target hari ini untuk tugas ini") : tr("Target for this day", "Target hari ini"))
            : tr("Day off", "Hari libur")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px] placeholder:text-slate-300"
        />
      ) : (
        <span className={cn("min-w-0 flex-1 pt-1 text-[13px]", day.target ? "text-slate-700" : "text-slate-300")}>
          {day.target ?? (day.works ? "—" : tr("day off", "libur"))}
        </span>
      )}
      <span className="mt-1.5 w-4 shrink-0">
        {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {state === "saved" && <Check className="h-3.5 w-3.5 text-emerald-600" />}
      </span>
    </li>
  );
}
