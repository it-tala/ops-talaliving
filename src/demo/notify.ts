/** The sandbox's `ops_hr.task_notify()` trigger (0215, D374).
 *
 *  In the database the notification is a trigger on the task row, so every
 *  road a task takes to a person — assign, a routine, a dadakan line made a
 *  task, a task moved — says it without the seam remembering to. The demo has
 *  the same shape for the same reason: `apply()` hands every mutation's before
 *  and after to `notifyTasks`, and the seams in `api/hr.ts` stay as they are.
 *
 *  The rules are the trigger's, line for line:
 *   • a task that is OPEN and new, or moved to somebody else → its assignee,
 *     when they have an account and are not the one who did it;
 *   • a task that became DONE → HRD at write or admin, and its assigner, minus
 *     whoever closed it and minus the assignee.
 *  Each notice is a bell row and an `hr.task.*` outbox event.
 */
import type { DemoState, DemoNotification } from "./state";
import type { Task } from "@/services/hr/contracts";
import { officeDay } from "@/lib/office";

let seq = 0;
function nextId(state: DemoState): number {
  const top = (state.notifications ?? []).reduce((m, n) => Math.max(m, n.id), 0);
  seq = Math.max(seq, top) + 1;
  return seq;
}

function push(draft: DemoState, row: Omit<DemoNotification, "id" | "created_at" | "read_at">,
              event: string, payload: Record<string, unknown>, to: string, toName: string) {
  draft.notifications = draft.notifications ?? [];
  draft.notifications.unshift({ id: nextId(draft), created_at: new Date().toISOString(), read_at: null, ...row });
  draft.outbox.unshift({
    id: `evt_${Date.now().toString(36)}${draft.notifications.length.toString(36)}`,
    service: "hr", event_type: event, occurred_at: new Date().toISOString(), delivered_at: null,
    payload: { ...payload, to, to_name: toName, link: row.link },
  });
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

export function notifyTasks(before: DemoState, draft: DemoState) {
  const actor = draft.session_user_id;
  const prev = new Map(before.tasks.map((t) => [t.id, t]));
  const accountOf = (employeeId: string) => {
    const emp = draft.employees.find((e) => e.id === employeeId);
    const link = emp && draft.employee_accounts?.find((a) => a.employee_no === emp.employee_no);
    const user = link && draft.users.find((u) => u.id === link.user_id && u.is_active);
    return { emp, user };
  };

  for (const t of draft.tasks) {
    const old = prev.get(t.id);
    // `apply()` clones the whole state, so rows are compared by what changed,
    // never by identity.
    if (old && old.status === t.status && old.assignee_id === t.assignee_id) continue;
    const { emp, user } = accountOf(t.assignee_id);
    const goal = t.goal_id ? draft.goals.find((g) => g.id === t.goal_id) : undefined;
    const wait = t.waits_on ? draft.tasks.find((w) => w.id === t.waits_on) : undefined;

    if (t.status === "OPEN" && (!old || old.assignee_id !== t.assignee_id)
        && user && user.id !== actor) {
      const by = draft.users.find((u) => u.id === t.assigned_by)?.full_name ?? "HRD";
      const data = {
        task_no: t.task_no, title: t.title, detail: t.detail, due_date: t.due_date,
        deliverable: t.deliverable, assigned_by: by,
        goal_no: goal?.goal_no ?? null, goal_title: goal?.title ?? null, goal_rank: goal?.rank ?? null,
        waits_on_no: wait?.task_no ?? null, waits_on_title: wait?.title ?? null,
        routine: t.routine_id !== null, moved: Boolean(old),
      };
      push(draft, {
        user_id: user.id, kind: "task.assigned",
        title: `Tugas baru dari ${by}: ${t.title} — jatuh tempo ${fmtDate(t.due_date)}`,
        data, link: "/profil?tab=tugas", entity_no: t.task_no,
      }, "hr.task.assigned", data, user.email, user.full_name);
    }

    if (old && old.status !== "DONE" && t.status === "DONE") {
      deliver(draft, t, emp?.full_name ?? "", emp?.employee_no ?? "", user?.id ?? null, actor, goal);
    }
  }
}

function deliver(draft: DemoState, t: Task, assignee: string, assigneeNo: string,
                 assigneeUser: string | null, actor: string,
                 goal: DemoState["goals"][number] | undefined) {
  const late = t.done_at !== null && officeDay(new Date(t.done_at)) > t.due_date;
  const doneBy = draft.users.find((u) => u.id === t.done_by)?.full_name ?? assignee;
  const data = {
    task_no: t.task_no, title: t.title, assignee, assignee_no: assigneeNo,
    deliverable: t.deliverable, delivered_note: t.delivered_note,
    due_date: t.due_date, done_on: t.done_at ? officeDay(new Date(t.done_at)) : null,
    late, done_by: doneBy, by_assignee: t.done_by === assigneeUser,
    goal_no: goal?.goal_no ?? null, goal_title: goal?.title ?? null, goal_rank: goal?.rank ?? null,
  };
  const recipients = draft.users.filter((u) => u.is_active && (
    u.id === t.assigned_by
    || u.modules.some((m) => m.module === "hrd" && (m.level === "write" || m.level === "admin"))));
  for (const r of recipients) {
    if (r.id === actor || r.id === assigneeUser) continue;
    push(draft, {
      user_id: r.id, kind: "task.delivered",
      title: `${assignee} menyerahkan tugas: ${t.title}${late ? " (terlambat)" : ""}`,
      data, link: "/hrd/tugas?tab=all", entity_no: t.task_no,
    }, "hr.task.delivered", data, r.email, r.full_name);
  }
}
