"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Flag, Inbox, Users } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { addDays } from "@/services/hr/task-periods";
import type { BacklogItem, CandidateGoal, GoalView, TaskView } from "@/services/hr/contracts";
import { useTr } from "@/lib/i18n";
import { TaskPlanDays } from "./task-plan";

/** Roadmap — the task board as a timeline (Gantt), the way Asana's Timeline,
 *  Jira's Timeline, ClickUp's Gantt and GitHub Projects' Roadmap draw it.
 *
 *  Read-only on purpose: a bar is drawn from dates the database already
 *  holds, and moving work is done with *Atur* (D368), where the rules live.
 *
 *  - **Swimlanes** by goal (in the leader's rank) or by person (workload).
 *  - **Bar** from when the work could start — its period, else when it was
 *    started, else when it was given — to its due date; a finished task ends
 *    on the day it was finished.
 *  - **Overdue** work grows a red tail from the due date to today; blocked
 *    and waiting work is drawn as such, never as late (D261).
 *  - **Arrows** for *Mulai setelah* (`waits_on`), the dependency every Gantt
 *    draws; a **diamond** for a goal's target; a **dot** for the chase date;
 *    a vertical line for today.
 *  - **Belum dijadwalkan**: the daftar tunggu (D381) — work with no dates
 *    yet, listed beside the chart the way Asana lists unscheduled tasks.
 *  - **Kandidat** (D393): projects that may or may not happen, in a lane of
 *    their own at the bottom — a dashed bar from the month they would start
 *    to their target, and a flag on the day they are decided.
 */

type Zoom = "week" | "month" | "quarter";
type Group = "goal" | "person";

const PX: Record<Zoom, number> = { week: 40, month: 16, quarter: 6 };
const ROW = 34;
const HEAD = 46;
const LABEL_W = 248;

const DAY = 86_400_000;
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const diff = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const dm = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

type State = "done" | "late" | "blocked" | "waiting" | "progress" | "todo" | "cancelled";

function stateOf(t: TaskView): State {
  if (t.status === "CANCELLED") return "cancelled";
  if (t.status === "DONE") return "done";
  if (t.blocked_reason) return "blocked";
  if (t.overdue) return "late";
  if (t.waiting) return "waiting";
  return t.has_started ? "progress" : "todo";
}

const STATE_STYLE: Record<State, string> = {
  done: "bg-emerald-500 text-white",
  late: "bg-red-500 text-white",
  blocked: "bg-amber-400 text-amber-950",
  waiting: "border border-dashed border-slate-400 bg-white text-slate-500",
  progress: "bg-brand-600 text-white",
  todo: "bg-brand-200 text-brand-900",
  cancelled: "bg-slate-200 text-slate-400 line-through",
};

interface Bar {
  t: TaskView;
  start: string;
  end: string;
  state: State;
}

function barOf(t: TaskView): Bar {
  const begun = t.period_start ?? dayOf(t.started_at) ?? dayOf(t.assigned_at) ?? t.due_date;
  const end = t.status === "DONE" && t.done_at ? dayOf(t.done_at)! : t.due_date;
  const start = begun > end ? end : begun;
  return { t, start, end, state: stateOf(t) };
}

/** Cascade, as every Gantt draws it: an open part that waits on another
 *  cannot start before that one ends — and an overdue predecessor ends today
 *  at the earliest. Repeated so a chain of parts settles. */
function cascade(bars: Bar[], today: string): Bar[] {
  const map = new Map(bars.map((b) => [b.t.task_no, { ...b }]));
  for (let pass = 0; pass < 4; pass++) {
    for (const b of map.values()) {
      if (b.t.status !== "OPEN" || !b.t.waits_on_no) continue;
      const p = map.get(b.t.waits_on_no);
      if (!p) continue;
      const pEnd = p.t.status === "OPEN" && p.end < today ? today : p.end;
      const after = addDays(pEnd, 1);
      if (after > b.start) b.start = after > b.end ? b.end : after;
    }
  }
  return [...map.values()];
}

const isDaily = (t: TaskView) => t.routine_cadence === "DAILY";

type Row =
  | { kind: "lane"; key: string; title: string; sub: string; target: string | null; rank: number | null; late: boolean }
  | { kind: "task"; key: string; bar: Bar }
  /* One row per daily routine, one cell per day (D383): a bar per morning
     would bury every other line on the chart. */
  | { kind: "daily"; key: string; title: string; person: string; cells: TaskView[] }
  | { kind: "candidate"; key: string; c: CandidateGoal };

export function TaskRoadmap({
  tasks, goals, backlog, candidates = [],
}: {
  tasks: TaskView[];
  goals: GoalView[];
  backlog: BacklogItem[];
  /** Undecided goals (D393); empty for a reader who may not see them. */
  candidates?: CandidateGoal[];
}) {
  const tr = useTr();
  const today = officeToday();
  const [zoom, setZoom] = useState<Zoom>("month");
  const [group, setGroup] = useState<Group>("goal");
  const [showDone, setShowDone] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const dailyRows = useMemo(() => {
    const by = new Map<string, TaskView[]>();
    for (const t of tasks) {
      if (!isDaily(t) || t.status === "CANCELLED" || !t.routine_no) continue;
      by.set(t.routine_no, [...(by.get(t.routine_no) ?? []), t]);
    }
    return [...by.entries()].map(([no, cells]) => ({
      kind: "daily" as const, key: `d:${no}`, title: cells[0].title,
      person: cells[0].assignee_name, cells,
    })).sort((a, b) => a.person.localeCompare(b.person) || a.title.localeCompare(b.title));
  }, [tasks]);

  const bars = useMemo(() => cascade(tasks
    .filter((t) => t.status !== "CANCELLED" && !isDaily(t))
    .filter((t) => showDone || t.status === "OPEN"
      || (t.done_at !== null && diff(dayOf(t.done_at)!, today) <= 14))
    .map(barOf), today), [tasks, showDone, today]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const sortBars = (a: Bar, b: Bar) =>
      (a.t.status === "OPEN" ? 0 : 1) - (b.t.status === "OPEN" ? 0 : 1)
      || (a.t.waits_on_no ? 1 : 0) - (b.t.waits_on_no ? 1 : 0)
      || a.start.localeCompare(b.start) || a.end.localeCompare(b.end);
    if (group === "goal") {
      const byGoal = new Map<string, Bar[]>();
      for (const b of bars) {
        const k = b.t.goal_no ?? "";
        byGoal.set(k, [...(byGoal.get(k) ?? []), b]);
      }
      const ordered = [...goals].sort((a, b) => (a.rank ?? 1e6) - (b.rank ?? 1e6));
      for (const g of ordered) {
        const list = byGoal.get(g.goal_no) ?? [];
        if (list.length === 0 && g.status !== "OPEN") continue;
        out.push({
          kind: "lane", key: `g:${g.goal_no}`, title: g.title,
          sub: tr(`put together by ${g.owner_name}`, `disatukan oleh ${g.owner_name}`),
          target: g.target_date, rank: g.rank, late: g.late,
        });
        for (const b of [...list].sort(sortBars)) out.push({ kind: "task", key: b.t.task_no, bar: b });
        byGoal.delete(g.goal_no);
      }
      const loose = [...byGoal.values()].flat();
      if (loose.length > 0) {
        out.push({ kind: "lane", key: "g:-", title: tr("Not part of a goal", "Tanpa sasaran"),
                   sub: tr("routine and one-off work", "tugas rutin dan permintaan sekali jalan"),
                   target: null, rank: null, late: false });
        for (const b of loose.sort(sortBars)) out.push({ kind: "task", key: b.t.task_no, bar: b });
      }
      if (dailyRows.length > 0) {
        out.push({ kind: "lane", key: "g:daily", title: tr("Daily routines", "Tugas rutin harian"),
                   sub: tr("one row per routine, one cell per working day", "satu baris per rutin, satu kotak per hari kerja"),
                   target: null, rank: null, late: false });
        out.push(...dailyRows);
      }
      if (candidates.length > 0) {
        out.push({ kind: "lane", key: "g:cand", title: tr("Candidates — not decided", "Kandidat — belum diputuskan"),
                   sub: tr("may or may not happen; nobody is tasked", "mungkin jalan, mungkin tidak; belum ada yang ditugaskan"),
                   target: null, rank: null, late: false });
        for (const c of [...candidates].sort((a, b) => a.decide_by.localeCompare(b.decide_by))) {
          out.push({ kind: "candidate", key: `c:${c.goal_no}`, c });
        }
      }
    } else {
      const byPerson = new Map<string, Bar[]>();
      for (const b of bars) byPerson.set(b.t.assignee_name, [...(byPerson.get(b.t.assignee_name) ?? []), b]);
      for (const d of dailyRows) if (!byPerson.has(d.person)) byPerson.set(d.person, []);
      for (const [name, list] of [...byPerson.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const open = list.filter((b) => b.t.status === "OPEN").length;
        out.push({ kind: "lane", key: `p:${name}`, title: name,
                   sub: tr(`${open} open`, `${open} terbuka`), target: null, rank: null, late: false });
        out.push(...dailyRows.filter((d) => d.person === name));
        for (const b of [...list].sort(sortBars)) out.push({ kind: "task", key: b.t.task_no, bar: b });
      }
    }
    return out;
  }, [bars, dailyRows, goals, candidates, group, tr]);

  /* The window: everything drawn, plus a margin, never less than eight weeks
     around today and never more than a year. */
  const [from, to] = useMemo(() => {
    const dates = [today, ...bars.flatMap((b) => [b.start, b.end]),
      ...rows.flatMap((r) => (r.kind === "lane" && r.target ? [r.target] : [])),
      ...rows.flatMap((r) => (r.kind === "candidate"
        ? [r.c.starts_month ?? r.c.decide_by, r.c.decide_by, r.c.target_date] : [])),
      ...dailyRows.flatMap((d) => d.cells.map((c) => c.due_date)).filter((d) => diff(d, today) <= 30)];
    let lo = dates.reduce((m, d) => (d < m ? d : m), today);
    let hi = dates.reduce((m, d) => (d > m ? d : m), today);
    lo = addDays(lo, -3); hi = addDays(hi, 10);
    if (diff(lo, today) < 14) lo = addDays(today, -14);
    if (diff(today, hi) < 42) hi = addDays(today, 42);
    if (diff(lo, hi) > 366) lo = addDays(hi, -366);
    if (zoom === "quarter") lo = `${lo.slice(0, 7)}-01`;
    return [lo, hi];
  }, [bars, rows, dailyRows, today, zoom]);

  const px = PX[zoom];
  const days = diff(from, to) + 1;
  const width = days * px;
  const x = (d: string) => diff(from, d) * px;
  const rowY = new Map<string, number>();
  rows.forEach((r, i) => rowY.set(r.key, HEAD + i * ROW));
  const height = HEAD + rows.length * ROW;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(today) - 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, from]);

  /* Ticks: each day when there is room, each Monday otherwise; months above. */
  const ticks: { d: string; label: string; strong: boolean }[] = [];
  const months: { d: string; label: string; left: number; w: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const wd = new Date(toMs(d)).getUTCDay();
    if (zoom === "week" || (zoom === "month" && (wd === 1 || i === 0)) || (zoom === "quarter" && wd === 1)) {
      ticks.push({ d, label: zoom === "week" ? d.slice(8, 10) : dm(d), strong: wd === 1 });
    }
    if (i === 0 || d.endsWith("-01")) {
      const m = +d.slice(5, 7) - 1;
      months.push({ d, label: `${MONTHS[m]} ${d.slice(0, 4)}`, left: i * px, w: 0 });
    }
  }
  months.forEach((m, i) => { m.w = (i + 1 < months.length ? months[i + 1].left : width) - m.left; });
  const sundays = zoom === "quarter" ? [] : Array.from({ length: days }, (_, i) => addDays(from, i))
    .filter((d) => new Date(toMs(d)).getUTCDay() === 0);

  /* Dependency arrows: predecessor's end to successor's start. */
  const byNo = new Map(bars.map((b) => [b.t.task_no, b]));
  const arrows = bars.flatMap((b) => {
    const p = b.t.waits_on_no ? byNo.get(b.t.waits_on_no) : undefined;
    if (!p || !rowY.has(p.t.task_no) || !rowY.has(b.t.task_no)) return [];
    const x1 = x(p.end) + px, y1 = rowY.get(p.t.task_no)! + ROW / 2;
    const x2 = x(b.start), y2 = rowY.get(b.t.task_no)! + ROW / 2;
    const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
    return [{ key: `${p.t.task_no}>${b.t.task_no}`, d: `M${x1},${y1} H${mid} V${y2} H${x2 - 2}`, open: p.t.status === "OPEN" }];
  });

  const sel = picked ? byNo.get(picked) : undefined;
  const unscheduled = backlog.filter((b) => b.status === "OPEN");
  const counts = bars.reduce((m, b) => ({ ...m, [b.state]: (m[b.state] ?? 0) + 1 }), {} as Record<State, number>);

  const seg = (on: boolean) => cn("h-8 px-3 text-[12px] font-medium",
    on ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tr("Zoom", "Skala")} className="flex overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
          {([["week", tr("Weeks", "Minggu")], ["month", tr("Months", "Bulan")], ["quarter", tr("Quarter", "Kuartal")]] as const).map(([k, l]) => (
            <button key={k} className={seg(zoom === k)} aria-pressed={zoom === k} onClick={() => setZoom(k)}>{l}</button>
          ))}
        </div>
        <div role="group" aria-label={tr("Group by", "Kelompokkan")} className="flex overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
          <button className={seg(group === "goal")} aria-pressed={group === "goal"} onClick={() => setGroup("goal")}>
            <Flag className="mr-1 inline h-3.5 w-3.5" />{tr("By goal", "Per sasaran")}
          </button>
          <button className={seg(group === "person")} aria-pressed={group === "person"} onClick={() => setGroup("person")}>
            <Users className="mr-1 inline h-3.5 w-3.5" />{tr("By person", "Per orang")}
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          {tr("Show everything finished", "Tampilkan semua yang selesai")}
        </label>
        <button className="ml-auto h-8 rounded-lg px-3 text-[12px] font-medium text-brand-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
          onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - 160); }}>
          {tr("Today", "Hari ini")}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        {([
          ["progress", tr("In progress", "Sedang dikerjakan")], ["todo", tr("Not started", "Belum mulai")],
          ["waiting", tr("Waiting on a part", "Menunggu bagian lain")], ["blocked", tr("Blocked", "Tertahan")],
          ["late", tr("Overdue", "Terlambat")], ["done", tr("Done", "Selesai")],
        ] as const).map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <i className={cn("inline-block h-2.5 w-5 rounded-sm", STATE_STYLE[k])} />{l}
            <span className="text-slate-400">{counts[k] ?? 0}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rotate-45 bg-slate-800" />{tr("goal target", "target sasaran")}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full border-2 border-slate-700 bg-white" />{tr("chase date", "ditagih")}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-0.5 bg-red-500" />{tr("today", "hari ini")}</span>
        {candidates.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-5 rounded-sm border border-dashed border-violet-400 bg-violet-50" />{tr("candidate", "kandidat")}
            <Flag className="h-3 w-3 text-violet-600" />{tr("decide by", "diputuskan")}
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {tr("No open tasks to draw.", "Belum ada tugas terbuka untuk digambar.")}
          </p>
        ) : (
          <div className="flex">
            {/* Labels: fixed column, the same rows as the chart. */}
            <div className="shrink-0 border-r border-slate-200 bg-white" style={{ width: LABEL_W, maxWidth: "45%" }}>
              <div className="flex items-end border-b border-slate-200 px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400"
                style={{ height: HEAD }}>
                {group === "goal" ? tr("Goal · part", "Sasaran · bagian") : tr("Person · task", "Orang · tugas")}
              </div>
              {rows.map((r) => r.kind === "lane" ? (
                <div key={r.key} className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3" style={{ height: ROW }}>
                  {r.rank !== null && <span className="font-mono text-[11px] font-semibold text-slate-500">#{r.rank}</span>}
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-800" title={`${r.title} — ${r.sub}`}>{r.title}</span>
                  {r.late && <Badge tone="red">{tr("late", "lewat")}</Badge>}
                </div>
              ) : r.kind === "candidate" ? (
                <div key={r.key} className="flex items-center gap-1.5 border-b border-slate-100 px-3 pl-5" style={{ height: ROW }}>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700" title={`${r.c.title} — ${r.c.outcome}`}>{r.c.title}</span>
                  <span className="shrink-0 rounded bg-violet-50 px-1 text-[10px] text-violet-700">
                    {r.c.items > 0 ? tr(`${r.c.items} ${r.c.items === 1 ? "part" : "parts"}`, `${r.c.items} bagian`) : tr("candidate", "kandidat")}
                  </span>
                </div>
              ) : r.kind === "daily" ? (
                <div key={r.key} className="flex items-center gap-1.5 border-b border-slate-100 px-3 pl-5" style={{ height: ROW }}>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700" title={r.title}>{r.title}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{tr("daily", "harian")}</span>
                  {group === "goal" && <span className="shrink-0 truncate text-[11px] text-slate-400" style={{ maxWidth: 64 }}>{r.person.split(" ")[0]}</span>}
                </div>
              ) : (
                <button key={r.key} onClick={() => setPicked(picked === r.key ? null : r.key)}
                  className={cn("flex w-full items-center gap-1.5 border-b border-slate-100 px-3 pl-5 text-left hover:bg-slate-50",
                    picked === r.key && "bg-brand-50")} style={{ height: ROW }}>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700" title={r.bar.t.title}>{r.bar.t.title}</span>
                  <span className="shrink-0 truncate text-[11px] text-slate-400" style={{ maxWidth: 84 }}>
                    {group === "goal" ? r.bar.t.assignee_name.split(" ")[0] : (r.bar.t.goal_rank !== null ? `#${r.bar.t.goal_rank}` : "")}
                  </span>
                </button>
              ))}
            </div>

            {/* The chart: scrolls sideways inside itself, never the page. */}
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} aria-label={tr("Timeline, scroll sideways", "Timeline, geser ke samping")}>
              <div className="relative" style={{ width, height }}>
                {/* months + ticks */}
                {months.map((m) => (
                  <div key={m.d} className="absolute top-0 border-l border-slate-200 px-1.5 pt-1 text-[11px] font-semibold text-slate-600"
                    style={{ left: m.left, width: m.w, height: 20 }}>
                    {/* Sticky, so the month stays named while its first days scroll away. */}
                    <span className="sticky left-1">{m.label}</span>
                  </div>
                ))}
                {ticks.map((t) => (
                  <div key={t.d} className={cn("absolute font-mono text-[10px]", t.strong ? "text-slate-500" : "text-slate-400")}
                    style={{ left: x(t.d) + 2, top: 24 }}>{t.label}</div>
                ))}
                <div className="absolute inset-x-0 border-b border-slate-200" style={{ top: HEAD - 1 }} />
                {/* weekends, week lines */}
                {sundays.map((d) => (
                  <div key={d} className="absolute bg-slate-100/70" style={{ left: x(d), width: px, top: HEAD, height: height - HEAD }} />
                ))}
                {ticks.filter((t) => t.strong).map((t) => (
                  <div key={`l${t.d}`} className="absolute border-l border-slate-100" style={{ left: x(t.d), top: HEAD, height: height - HEAD }} />
                ))}
                {/* lane stripes */}
                {rows.map((r) => r.kind === "lane" && (
                  <div key={`s${r.key}`} className="absolute inset-x-0 bg-slate-50/80" style={{ top: rowY.get(r.key), height: ROW }} />
                ))}
                {/* today */}
                <div className="absolute z-20 w-0.5 bg-red-500" style={{ left: x(today) + px / 2, top: 18, height: height - 18 }}>
                  <span className="absolute -left-4 -top-0.5 rounded bg-red-500 px-1 font-mono text-[9px] text-white">{dm(today)}</span>
                </div>

                {/* dependency arrows */}
                <svg className="pointer-events-none absolute left-0 top-0 z-10" width={width} height={height} aria-hidden="true">
                  <defs>
                    <marker id="rm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.key} d={a.d} fill="none" stroke="#64748b" strokeWidth={1.25}
                      strokeDasharray={a.open ? "3 3" : undefined} markerEnd="url(#rm-arrow)" />
                  ))}
                </svg>

                {/* goal targets */}
                {rows.map((r) => r.kind === "lane" && r.target && (
                  <div key={`m${r.key}`} className={cn("absolute z-20 h-3 w-3 rotate-45 border-2 border-white", r.late ? "bg-red-600" : "bg-slate-800")}
                    title={tr(`Target ${r.target}`, `Target ${r.target}`)}
                    style={{ left: x(r.target) + px / 2 - 6, top: rowY.get(r.key)! + ROW / 2 - 6 }} />
                ))}

                {/* daily routines: one cell per day */}
                {rows.map((r) => r.kind === "daily" && r.cells.map((c) => {
                  const day = c.period_start ?? c.due_date;
                  const st = stateOf(c);
                  const tone = st === "done" ? (c.late ? "bg-emerald-300" : "bg-emerald-500")
                    : st === "late" ? "bg-red-500" : st === "blocked" ? "bg-amber-400" : "bg-brand-600";
                  return (
                    <div key={`c${c.task_no}`} className={cn("absolute z-10 rounded-sm", tone)}
                      title={`${c.title} · ${day} · ${st === "done" ? tr("done", "selesai") : st === "late" ? tr("missed", "terlewat") : tr("open", "terbuka")}`}
                      style={{ left: x(day) + 1, width: Math.max(3, px - 2), top: rowY.get(r.key)! + 9, height: ROW - 18 }} />
                  );
                }))}

                {/* candidates: dashed span and the decision flag */}
                {rows.map((r) => {
                  if (r.kind !== "candidate") return null;
                  const c = r.c;
                  const start = c.starts_month ?? c.decide_by;
                  const top = rowY.get(r.key)! + 7;
                  const w = Math.max(px, (diff(start, c.target_date) + 1) * px);
                  const due = c.decide_by <= today;
                  return (
                    <div key={`k${r.key}`}>
                      <div className="absolute z-10 flex items-center overflow-hidden whitespace-nowrap rounded border border-dashed border-violet-400 bg-violet-50/80 px-1.5 font-mono text-[10px] text-violet-800"
                        title={tr(`${c.title} · would start ${start} · target ${c.target_date}`, `${c.title} · perkiraan mulai ${start} · target ${c.target_date}`)}
                        style={{ left: x(start), width: w, top, height: ROW - 14 }}>
                        {w > 90 ? `${dm(start)}–${dm(c.target_date)}` : ""}
                      </div>
                      <div className="absolute z-20" title={tr(`Decide by ${c.decide_by}`, `Diputuskan paling lambat ${c.decide_by}`)}
                        style={{ left: x(c.decide_by) + px / 2 - 1, top: top - 6, height: ROW - 2 }}>
                        <div className={cn("h-full w-0.5", due ? "bg-red-500" : "bg-violet-600")} />
                        <Flag className={cn("absolute -top-1 left-0 h-3 w-3", due ? "text-red-600" : "text-violet-600")} />
                      </div>
                    </div>
                  );
                })}

                {/* bars */}
                {rows.map((r) => {
                  if (r.kind !== "task") return null;
                  const b = r.bar;
                  const top = rowY.get(r.key)! + 7;
                  const left = x(b.start);
                  const w = Math.max(px, (diff(b.start, b.end) + 1) * px);
                  const tail = b.state === "late" ? (diff(b.end, today)) * px : 0;
                  const label = w > 70 ? `${dm(b.start)}–${dm(b.end)}` : "";
                  return (
                    <div key={`b${r.key}`}>
                      <button onClick={() => setPicked(picked === r.key ? null : r.key)}
                        title={`${b.t.title} · ${b.t.assignee_name} · ${b.start} → ${b.end}`}
                        className={cn("absolute z-10 flex items-center overflow-hidden whitespace-nowrap rounded px-1.5 font-mono text-[10px] shadow-sm",
                          b.state === "late" ? "bg-brand-600 text-white" : STATE_STYLE[b.state],
                          picked === r.key && "ring-2 ring-slate-900 ring-offset-1")}
                        style={{ left, width: w, top, height: ROW - 14 }}>
                        {label}
                      </button>
                      {tail > 0 && (
                        <div className="absolute z-10 rounded-r bg-red-500/80"
                          title={tr(`${tail / px} days past due`, `${tail / px} hari lewat jatuh tempo`)}
                          style={{ left: left + w, width: tail, top: top + 3, height: ROW - 20,
                                   backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,.35) 4px 8px)" }} />
                      )}
                      {b.t.chase_date && b.t.status === "OPEN" && (
                        <div className="absolute z-20 h-2 w-2 rounded-full border-2 border-slate-700 bg-white"
                          title={tr(`Chase on ${b.t.chase_date}`, `Ditagih ${b.t.chase_date}`)}
                          style={{ left: x(b.t.chase_date) + px / 2 - 4, top: top - 5 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Card>

      {sel && (
        <Card>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3 text-[13px]">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-slate-400">{sel.t.task_no}</p>
              <p className="font-medium text-slate-800">{sel.t.title}</p>
              {sel.t.deliverable && <p className="text-[12px] text-slate-600">{tr("Hand over:", "Diserahkan:")} {sel.t.deliverable}</p>}
              {sel.t.waits_on_title && <p className="text-[12px] text-slate-500">{tr("Starts after:", "Mulai setelah:")} {sel.t.waits_on_title} ({sel.t.waits_on_assignee})</p>}
              {sel.t.blocked_reason && <p className="text-[12px] text-amber-700">{tr("Blocked:", "Tertahan:")} {sel.t.blocked_reason}</p>}
              {sel.t.delivered_note && <p className="text-[12px] text-emerald-800">{sel.t.delivered_note}</p>}
              {/* The holder's own plan for the days up to the due date (D384). */}
              <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {tr("Daily plan", "Rencana per hari")}
                </p>
                <TaskPlanDays taskNo={sel.t.task_no} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-slate-600 sm:grid-cols-4">
              <dt className="text-slate-400">{tr("Holder", "Pemegang")}</dt><dd>{sel.t.assignee_name}</dd>
              <dt className="text-slate-400">{tr("Starts", "Mulai")}</dt><dd className="font-mono">{sel.start}</dd>
              <dt className="text-slate-400">{tr("Due", "Jatuh tempo")}</dt><dd className="font-mono">{sel.t.due_date}</dd>
              <dt className="text-slate-400">{tr("Chase", "Ditagih")}</dt><dd className="font-mono">{sel.t.chase_date ?? "—"}</dd>
            </dl>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5">
          <Inbox className="h-4 w-4 text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-800">
            {tr(`Not scheduled yet (${unscheduled.length})`, `Belum dijadwalkan (${unscheduled.length})`)}
          </span>
          <span className="text-[12px] text-slate-500">
            {tr("— the waiting list: no person, no dates. Assign from the Waiting list tab.",
                "— daftar tunggu: belum ada orang dan tanggal. Tugaskan dari tab Daftar tunggu.")}
          </span>
        </div>
        {unscheduled.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-slate-500">{tr("Nothing waiting.", "Tidak ada yang menunggu.")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 px-5 py-3">
            {unscheduled.map((b) => (
              <li key={b.item_no} className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-[12px] text-slate-700">
                <span className="font-mono text-slate-400">#{b.position}</span> {b.title}
                {b.unit && <span className="text-slate-400"> · {b.unit}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <CalendarRange className="h-3.5 w-3.5" />
        {tr("A bar runs from the work's period, start, or the day it was given, to its due date; finished work ends on the day it was done. Change dates with Plan on the task.",
            "Batang dimulai dari periode, hari mulai, atau hari diberikan, sampai jatuh tempo; pekerjaan yang selesai berakhir di hari selesainya. Ubah tanggal lewat Atur pada tugasnya.")}
      </p>
    </div>
  );
}
