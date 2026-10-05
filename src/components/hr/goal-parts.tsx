"use client";

import { CheckCircle2, Circle, Hourglass, Link2, PackageCheck, PauseCircle, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { GoalBoardTask, GoalView } from "@/services/hr/contracts";
import { useTr } from "@/lib/i18n";

/** How far along a result is, counted over **every** part of it (D367).
 *
 *  The same numbers on HRD's board and on a staff member's profile, because
 *  both read `list_goals()`: a drafter must not see a six-part result as a
 *  one-part result just because only one part is theirs. */
export function GoalProgress({ g }: { g: GoalView }) {
  const tr = useTr();
  const pct = g.tasks_total === 0 ? 0 : Math.round((g.tasks_done / g.tasks_total) * 100);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
        <span>
          {g.tasks_total === 0
            ? tr("No parts yet — a result with no parts is a wish.", "Belum ada bagian — hasil tanpa bagian masih berupa keinginan.")
            : tr(`${g.tasks_done} of ${g.tasks_total} parts done`, `${g.tasks_done} dari ${g.tasks_total} bagian selesai`)}
        </span>
        {g.tasks_overdue > 0 && <Badge tone="red">{tr(`${g.tasks_overdue} late`, `${g.tasks_overdue} terlambat`)}</Badge>}
        {g.tasks_blocked > 0 && <Badge tone="amber">{tr(`${g.tasks_blocked} blocked`, `${g.tasks_blocked} tertahan`)}</Badge>}
        {g.tasks_waiting > 0 && <Badge tone="slate">{tr(`${g.tasks_waiting} waiting on a previous part`, `${g.tasks_waiting} menunggu bagian sebelumnya`)}</Badge>}
        {g.tasks_unacknowledged > 0 && <Badge tone="slate">{tr(`${g.tasks_unacknowledged} not yet read`, `${g.tasks_unacknowledged} belum dibaca`)}</Badge>}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full", g.late ? "bg-rose-500" : "bg-emerald-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** One part of a goal, as anybody in it reads it. */
function PartRow({ p }: { p: GoalBoardTask }) {
  const tr = useTr();
  const Icon = p.status === "DONE" ? CheckCircle2
    : p.blocked_reason ? PauseCircle
    : p.waiting ? Hourglass
    : p.started_at ? PlayCircle
    : Circle;
  const tone = p.status === "DONE" ? "text-emerald-600"
    : p.status === "CANCELLED" ? "text-slate-300"
    : p.overdue ? "text-rose-600"
    : p.blocked_reason ? "text-amber-600"
    : p.started_at ? "text-brand-600"
    : "text-slate-400";
  return (
    <li className={cn("flex gap-2.5 px-4 py-2.5", p.is_mine && "bg-brand-50/40")}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className={cn("text-slate-800", p.status === "CANCELLED" && "line-through text-slate-400")}>
          {p.title}
          {p.is_mine && <span className="ml-1.5 text-[11px] font-medium text-brand-700">{tr("· yours", "· milik Anda")}</span>}
        </p>
        <p className="text-[12px] text-slate-500">
          {p.assignee_name}
          {" · "}{p.status === "DONE" && p.done_at
            ? tr(`done ${p.done_at.slice(0, 10)}`, `selesai ${p.done_at.slice(0, 10)}`)
            : tr(`due ${p.due_date}`, `jatuh tempo ${p.due_date}`)}
          {p.overdue && <span className="text-rose-700">{tr(` (${-p.days_left} days late)`, ` (terlambat ${-p.days_left} hari)`)}</span>}
          {p.status === "OPEN" && !p.acknowledged && <span className="text-slate-400">{tr(" · not yet read", " · belum dibaca")}</span>}
          {p.status === "OPEN" && p.started_at && !p.blocked_reason && <span className="text-brand-700">{tr(" · in progress", " · sedang dikerjakan")}</span>}
        </p>
        {p.waits_on_no && (
          <p className={cn("text-[12px]", p.waiting ? "text-slate-600" : "text-slate-400")}>
            <Link2 className="mr-1 inline h-3.5 w-3.5" />
            {p.waiting
              ? tr(`Starts after: ${p.waits_on_title} — not finished yet`, `Mulai setelah: ${p.waits_on_title} — belum selesai`)
              : tr(`Started from: ${p.waits_on_title}`, `Mulai dari: ${p.waits_on_title}`)}
          </p>
        )}
        {p.deliverable && p.status === "OPEN" && (
          <p className="text-[12px] text-slate-500"><span className="text-slate-400">{tr("asked for:", "diminta:")}</span> {p.deliverable}</p>
        )}
        {p.blocked_reason && p.status === "OPEN" && (
          <p className="text-[12px] text-amber-800">{tr("Blocked:", "Tertahan:")} {p.blocked_reason}</p>
        )}
        {p.delivered_note && p.status === "DONE" && (
          <p className="text-[12px] text-emerald-800">
            <PackageCheck className="mr-1 inline h-3.5 w-3.5" />{p.delivered_note}
          </p>
        )}
      </div>
    </li>
  );
}

/** Every part of one goal — who holds what, what waits on what, what was
 *  handed over. The team view the leader asked for: *we have to put the
 *  parts together* starts with everybody seeing the parts. */
export function GoalBoardList({ goalNo, stamp }: { goalNo: string; stamp?: unknown }) {
  const tr = useTr();
  const [parts, reload] = useLoad(() => hr.goalBoard({ goal_no: goalNo }), [goalNo, stamp]);
  return (
    <Loaded state={parts} onRetry={reload}>
      {(list) => list.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">
          {tr("No parts yet. Add a task to this goal.", "Belum ada bagian. Tambahkan tugas ke sasaran ini.")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((p) => <PartRow key={p.task_no} p={p} />)}
        </ul>
      )}
    </Loaded>
  );
}
