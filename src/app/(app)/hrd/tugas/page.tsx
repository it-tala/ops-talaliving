"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlarmClock, CalendarRange, Check, ListChecks, PauseCircle, PlayCircle,
  Plus, Repeat, Ban, PackageCheck, BellRing, MailCheck, Target, Link2, SlidersHorizontal, RotateCcw,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { Cadence } from "@/services/hr/task-periods";
import { CADENCE_LABEL, type TaskView } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { GoalsPanel } from "./goals-panel";
import { DailyPanel } from "./daily-panel";
import { BacklogPanel } from "./backlog-panel";
import { TaskPrs, prsByTask } from "@/components/hr/task-prs";

/** Pemantauan tugas — the module built against a failure the owner described
 *  in one sentence (D303):
 *
 *    *karyawan meeting dengan pimpinan, pimpinan assign tugas baik rutin maupun
 *     tugas tambahan baru. Pimpinan lupa. Karyawan tidak mengerjakan.*
 *
 *  Three breakages, and the old tracker answered none of them. It knew a task
 *  existed and when it was due. It did not know what *finished* looked like, it
 *  could not tell this month's report from last month's, nobody was ever
 *  reminded to ask, and there was no evidence the task had ever been heard.
 *
 *  So the screen opens on **Ditagih hari ini** and not on the full list. That
 *  ordering is the whole design. A board that opens on everything is a board
 *  whose reader has to work out what to do next, every time, and the thing they
 *  are worst at — remembering to ask — is exactly what gets skipped. The first
 *  card is a short list of names and one button each, and it empties as the
 *  asking gets recorded.
 *
 *  Two refusals worth knowing about before reading the code:
 *
 *  - **A chase comes off the list when somebody asks, not when the work
 *    arrives.** Those are two different events and only one of them belongs to
 *    the person reading this screen. Recording the ask is how the next person
 *    to open it is not shown a task already chased an hour ago.
 *  - **A blocked task is never chased.** Chasing somebody for work that is
 *    waiting on a third party is how a tracker teaches people to stop reporting
 *    blockers, and then it measures nothing at all (D261).
 *
 *  Since D367 the page opens on **Sasaran & prioritas**: the ranked results the
 *  tasks are parts of. The leader's 2026-10-05 message — *allocate work by
 *  priorities which are changing rapidly … a lot of parts but no result* — is
 *  answered there and in `goals-panel.tsx`. Tasks gain a goal, a part they
 *  start from, and **Atur** to move their plan without cancelling them.
 *
 *  What is deliberately **not** here: none of this feeds anybody's score. A
 *  missed chase, an unacknowledged task and an empty hand-over note are each at
 *  least as much the leader's failure as the assignee's, and a number that
 *  cannot tell the difference punishes the wrong person. They are printed.
 */
export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <Tasks />
    </Suspense>
  );
}

const TABS = ["goals", "backlog", "daily", "open", "all", "routines"] as const;
type TabKey = (typeof TABS)[number];

function Tasks() {
  const { can } = useSession();
  const params = useSearchParams();
  const { toast } = useToast();
  const tr = useTr();
  const today = officeToday();

  const [tasks, reloadTasks] = useLoad(() => hr.listTasks(), []);
  /* GitHub PRs that named a task (D382) — read with the tasks, so a PR that
     just closed one shows beside it. */
  const [prList] = useLoad(() => hr.listTaskPullRequests(), [tasks]);
  const prs = prsByTask(prList.status === "ready" ? prList.data : undefined);
  const [routines, reloadRoutines] = useLoad(() => hr.listTaskRoutines(), []);
  const [employees] = useLoad(() => hr.listEmployees(), []);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>("goals");
  /* `?tab=all` is where the bell sends HRD for a hand-over (D374). Followed
     whenever it changes, so a second notification clicked while already here
     still lands. */
  const asked = params.get("tab");
  useEffect(() => {
    if (asked && (TABS as readonly string[]).includes(asked)) setTab(asked as TabKey);
  }, [asked]);

  const mayCreate = can("hrd.create");
  const mayEdit = can("hrd.update");

  /* One draft for a one-off task, one for a routine. Kept flat and keyed by
     field name rather than rebuilt per keystroke — a map keyed by a value the
     user is typing loses the caret on every character (F142's shape). */
  const [draft, setDraft] = useState({
    assignee_no: "", title: "", due_date: "", deliverable: "",
    period_start: "", period_end: "", chase_date: "",
    goal_no: "", waits_on_no: "",
  });
  /* The plan of one open task, being moved (D368). Full state, as `edit_task`
     takes it: every field is sent as it should now be. */
  const [planning, setPlanning] = useState<string | null>(null);
  const [plan, setPlan] = useState({
    due_date: "", assignee_no: "", goal_no: "", waits_on_no: "", chase_date: "",
  });
  const [goalList] = useLoad(() => hr.listGoals(), [tasks]);
  const openGoals = goalList.status === "ready" ? goalList.data : [];
  const [rDraft, setRDraft] = useState({
    title: "", deliverable: "", assignee_no: "",
    cadence: "MONTHLY" as Cadence, due_offset_days: 4, chase_lead_days: 2,
  });
  const [adding, setAdding] = useState(false);
  const [addingRoutine, setAddingRoutine] = useState(false);

  /* Three straight filters over a list of a few dozen rows, and deliberately
     not memoised: `rows` is rebuilt whenever the load state changes, so a
     `useMemo` keyed on it would recompute every render anyway and only add a
     dependency nobody can check. */
  const rows = tasks.status === "ready" ? tasks.data : [];
  const chases = rows.filter((t) => t.chase_due);
  const open = rows.filter((t) => t.status === "OPEN");
  const unheard = open.filter((t) => !t.acknowledged).length;

  async function add() {
    setBusy(true);
    const res = await hr.createTask({
      assignee_no: draft.assignee_no, title: draft.title, due_date: draft.due_date,
      deliverable: draft.deliverable || null,
      period_start: draft.period_start || null,
      period_end: draft.period_end || null,
      chase_date: draft.chase_date || null,
      goal_no: draft.goal_no || null,
      waits_on_no: draft.waits_on_no || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not created", "Tidak dibuat"), res.error.message);
      return;
    }
    toast("success", tr(`${res.data.task_no} created`, `${res.data.task_no} dibuat`),
      tr(`${res.data.assignee_name} · due ${res.data.due_date}`, `${res.data.assignee_name} · jatuh tempo ${res.data.due_date}`)
      + (res.data.chase_date ? tr(` · chased ${res.data.chase_date}`, ` · ditagih ${res.data.chase_date}`) : ""));
    setDraft({ assignee_no: draft.assignee_no, title: "", due_date: "", deliverable: "",
               period_start: "", period_end: "", chase_date: "",
               goal_no: draft.goal_no, waits_on_no: "" });
    setAdding(false);
    reloadTasks();
  }

  async function chase(t: TaskView) {
    const note = window.prompt(
      tr(`Chasing ${t.assignee_name}: ${t.title}\n\n`, `Menagih ${t.assignee_name}: ${t.title}\n\n`)
      + tr(
        "What was the answer? This note is what is read at the next chase — and the task "
        + "leaves the chase list as soon as it is recorded, not once the work arrives.",
        "Apa jawabannya? Catatan ini yang dibaca saat ditagih lagi — dan tugas ini "
        + "keluar dari daftar tagihan begitu dicatat, bukan setelah pekerjaannya datang.",
      ),
      "",
    );
    if (note === null) return;
    setBusy(true);
    const res = await hr.chaseTask({ task_no: t.task_no, note });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", t.task_no, tr("Chase recorded", "Penagihan dicatat"));
    reloadTasks();
  }

  async function acknowledge(t: TaskView) {
    setBusy(true);
    const res = await hr.acknowledgeTask({ task_no: t.task_no });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", t.task_no, tr("Marked as received by the person", "Ditandai sudah diterima orangnya"));
    reloadTasks();
  }

  /** The parts of one goal a task could start from — never itself, never a
   *  cancelled one. */
  function partsOf(goalNo: string, except?: string) {
    return rows.filter((x) => x.goal_no === goalNo && x.status !== "CANCELLED" && x.task_no !== except);
  }

  function addPart(goalNo: string) {
    setDraft({ ...draft, goal_no: goalNo, waits_on_no: "" });
    setAdding(true);
    setAddingRoutine(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startPlanning(t: TaskView) {
    setPlanning(t.task_no);
    setPlan({
      due_date: t.due_date, assignee_no: t.assignee_no,
      goal_no: t.goal_no ?? "", waits_on_no: t.waits_on_no ?? "", chase_date: t.chase_date ?? "",
    });
  }

  async function savePlan(t: TaskView) {
    setBusy(true);
    const res = await hr.editTask({
      task_no: t.task_no, due_date: plan.due_date, assignee_no: plan.assignee_no,
      goal_no: plan.goal_no || null, waits_on_no: plan.waits_on_no || null,
      chase_date: plan.chase_date || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Plan not changed", "Rencana tidak berubah"), res.error.message); return; }
    toast("success", t.task_no,
      res.data.assignee_no !== t.assignee_no
        ? tr(`Now with ${res.data.assignee_name} — not yet read by them.`, `Sekarang dipegang ${res.data.assignee_name} — belum dibaca olehnya.`)
        : tr("Plan changed.", "Rencana diubah."));
    setPlanning(null);
    reloadTasks();
  }

  async function act(t: TaskView, action: "done" | "block" | "unblock" | "cancel" | "reopen") {
    let reason: string | null = null;
    let delivered: string | null = null;
    if (action === "block") {
      reason = window.prompt(tr(
        "Blocked waiting on what? A blocked task is taken out of the person's assessment, so the reason is required.",
        "Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya, jadi alasannya wajib.",
      ));
      if (!reason?.trim()) return;
    }
    if (action === "cancel") {
      reason = window.prompt(tr("Why is it cancelled?", "Kenapa dibatalkan?"));
      if (!reason?.trim()) return;
    }
    if (action === "reopen") {
      reason = window.prompt(tr(
        "Why is it reopened? What is missing from what was handed over? The person reads this sentence.",
        "Kenapa dibuka lagi? Yang diserahkan kurang apa? Kalimat ini yang dibaca orangnya.",
      ));
      if (!reason?.trim()) return;
    }
    if (action === "done") {
      /* Asked, never required. Refusing to let somebody close their own work
         over an empty text box is how a tracker stops being used (A6). */
      delivered = window.prompt(
        t.deliverable
          ? tr(
            `Asked for: ${t.deliverable}\n\nWhat was handed over? May be left empty.`,
            `Yang diminta: ${t.deliverable}\n\nApa yang diserahkan? Boleh dikosongkan.`,
          )
          : tr("What was handed over? May be left empty.", "Apa yang diserahkan? Boleh dikosongkan."),
        "",
      );
      if (delivered === null) return;
    }
    setBusy(true);
    const res = await hr.updateTask({ task_no: t.task_no, action, reason, delivered });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", t.task_no,
      action === "done" ? tr("Done", "Selesai") : action === "block" ? tr("Marked blocked", "Ditandai tertahan")
      : action === "unblock" ? tr("No longer blocked", "Tidak lagi tertahan")
      : action === "reopen" ? tr("Reopened", "Dibuka lagi") : tr("Cancelled", "Dibatalkan"));
    reloadTasks();
  }

  async function addRoutine() {
    setBusy(true);
    const res = await hr.saveTaskRoutine({
      title: rDraft.title, deliverable: rDraft.deliverable,
      assignee_no: rDraft.assignee_no, cadence: rDraft.cadence,
      due_offset_days: rDraft.due_offset_days, chase_lead_days: rDraft.chase_lead_days,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`${res.data.routine_no} created`, `${res.data.routine_no} dibuat`),
      tr(
        `${CADENCE_LABEL[res.data.cadence]} · ${res.data.assignee_name} · current period ${res.data.current_period}`,
        `${CADENCE_LABEL[res.data.cadence]} · ${res.data.assignee_name} · periode berjalan ${res.data.current_period}`,
      ));
    setRDraft({ ...rDraft, title: "", deliverable: "" });
    setAddingRoutine(false);
    reloadRoutines();
  }

  async function endRoutine(routineNo: string, title: string) {
    const reason = window.prompt(
      tr(`Stopping "${title}".\n\n`, `Menghentikan "${title}".\n\n`)
      + tr(
        "Why is it stopped? Tasks already raised still stand — what stops is raising the next periods.",
        "Kenapa dihentikan? Tugas yang sudah terbit tetap berlaku — yang berhenti "
        + "adalah penerbitan periode berikutnya.",
      ),
    );
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await hr.endTaskRoutine({ routine_no: routineNo, reason });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", routineNo,
      res.data.open_count > 0
        ? tr(
          `Stopped. ${res.data.open_count} tasks already raised are still open.`,
          `Dihentikan. ${res.data.open_count} tugas yang sudah terbit masih terbuka.`,
        )
        : tr("Stopped.", "Dihentikan."));
    reloadRoutines(); reloadTasks();
  }

  async function roll() {
    setBusy(true);
    const res = await hr.rollTaskRoutines({});
    setBusy(false);
    if (res.error) { toast("warning", tr("Not raised", "Tidak diterbitkan"), res.error.message); return; }
    /* Both numbers, always. "0 dibuat" means *nothing was needed* and it also
       means *everything collided*, and those are not the same news. */
    toast(res.data.created > 0 ? "success" : "info",
      tr(`${res.data.created} tasks raised`, `${res.data.created} tugas terbit`),
      res.data.already_there > 0
        ? tr(
          `${res.data.already_there} periods already existed and were skipped.`,
          `${res.data.already_there} periode sudah ada dan dilewati.`,
        )
        : tr("No period was missed.", "Tidak ada periode yang terlewat."));
    reloadTasks(); reloadRoutines();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Task tracking", "Pemantauan tugas")}
        description={tr(
          "Routine and extra tasks, with their working period, what has to be handed over, and when to chase. This board remembers the chase date, not the person.",
          "Tugas rutin dan tugas tambahan, lengkap dengan periode pengerjaannya, apa yang harus diserahkan, dan kapan ditagih. Yang mengingat tanggal penagihan adalah papan ini, bukan orangnya.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {mayCreate && (
              <Button size="sm" variant="ghost" onClick={roll} disabled={busy}>
                <Repeat className="h-4 w-4" /> {tr("Raise periods", "Terbitkan periode")}
              </Button>
            )}
            {mayCreate && (
              <Button size="sm" onClick={() => { setAdding((v) => !v); setAddingRoutine(false); }}>
                <Plus className="h-4 w-4" /> {tr("New task", "Tugas baru")}
              </Button>
            )}
            <SourceBadge state={tasks} />
          </div>
        }
      />

      {/* ── what has to be asked for, today ──────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader
          title={tr("To chase today", "Ditagih hari ini")}
          subtitle={
            chases.length === 0
              ? tr(
                "Nothing is due to be chased. This list is empty because it was chased already or it is not time yet — not because there are no tasks.",
                "Tidak ada yang jatuh tempo ditagih. Daftar ini kosong karena sudah ditagih atau memang belum waktunya — bukan karena tidak ada tugas.",
              )
              : tr(
                `${chases.length} tasks have reached their chase date and nobody has asked yet.`,
                `${chases.length} tugas sudah sampai tanggal penagihannya dan belum ada yang menanyakan.`,
              )
          }
          icon={BellRing}
          action={<Badge tone={chases.length > 0 ? "amber" : "slate"}>{chases.length}</Badge>}
        />
        {chases.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {chases.map((t) => (
              <li key={t.task_no} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-medium text-slate-800">{t.title}</p>
                  <p className="text-[12px] text-slate-500">
                    {t.assignee_name}
                    {t.period_label && <> · {tr("period", "periode")} <span className="font-medium">{t.period_label}</span></>}
                    {tr(" · due ", " · jatuh tempo ")}{t.due_date}
                    {t.days_left < 0
                      ? <span className="text-rose-700">{tr(` (${-t.days_left} days over)`, ` (${-t.days_left} hari lewat)`)}</span>
                      : <span className="text-slate-400">{tr(` (${t.days_left} days left)`, ` (${t.days_left} hari lagi)`)}</span>}
                  </p>
                  {t.deliverable && (
                    <p className="mt-0.5 text-[12px] text-slate-600">
                      <span className="text-slate-400">{tr("asked for:", "yang diminta:")}</span> {t.deliverable}
                    </p>
                  )}
                  {!t.acknowledged && (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      {tr("No sign yet that the person has received this task.", "Belum ada tanda tugas ini diterima orangnya.")}
                    </p>
                  )}
                </div>
                {mayEdit && (
                  <Button size="sm" onClick={() => chase(t)} disabled={busy}>
                    <AlarmClock className="h-4 w-4" /> {tr("Record chase", "Catat penagihan")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {unheard > 0 && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
          <strong>{tr(
            `${unheard} of ${open.length} open tasks are not marked as received.`,
            `${unheard} dari ${open.length} tugas terbuka belum ditandai diterima.`,
          )}</strong>{" "}
          {tr(
            "The mark is not a condition for anything — an unmarked task still falls due and is still late if it is late. It matters later, when the question becomes",
            "Tanda itu bukan syarat apa pun — yang belum ditandai tetap jatuh tempo dan tetap terlambat kalau terlambat. Gunanya nanti, waktu pertanyaannya menjadi",
          )}
          <em>{tr(" whether the person was ever actually told", " apakah orangnya memang pernah diberi tahu")}</em>
          {tr(", and the answer has to leave a trace on both sides.", ", dan jawabannya harus ada bekasnya di dua sisi.")}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {([["goals", tr("Goals & priority", "Sasaran & prioritas")], ["backlog", tr("Waiting list", "Daftar tunggu")], ["daily", tr("Daily log", "Laporan harian")], ["open", tr("Open", "Terbuka")], ["all", tr("All", "Semua")], ["routines", tr("Routine tasks", "Tugas rutin")]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "h-8 rounded-lg px-3 text-[13px] font-medium",
              tab === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {label}
            {k === "open" && <span className="ml-1.5 opacity-70">{open.length}</span>}
          </button>
        ))}
      </div>

      {adding && mayCreate && (
        <Card className="mb-4">
          <CardHeader
            title={tr("New task", "Tugas baru")}
            subtitle={tr(
              "Period and chase date may be left empty — both are for a task that covers a span of time, not a one-off request.",
              "Periode dan tanggal penagihan boleh dikosongkan — keduanya untuk tugas yang menutup satu rentang waktu, bukan satu permintaan sekali jalan.",
            )}
            icon={Plus}
          />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <label className="text-[12px] text-slate-600">
              {tr("For whom", "Untuk siapa")}
              <select
                value={draft.assignee_no}
                onChange={(e) => setDraft({ ...draft, assignee_no: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              >
                <option value="">{tr("— choose —", "— pilih —")}</option>
                {employees.status === "ready" && employees.data
                  .filter((e) => e.active)
                  .map((e) => (
                    <option key={e.employee_no} value={e.employee_no}>
                      {e.full_name} · {e.employee_no}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("What is the task", "Tugasnya apa")}
              <input
                value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              <Target className="mr-1 inline h-3.5 w-3.5" />
              {tr("Part of goal", "Bagian dari sasaran")}
              <select
                value={draft.goal_no}
                onChange={(e) => setDraft({ ...draft, goal_no: e.target.value, waits_on_no: "" })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              >
                <option value="">{tr("— none (stands on its own) —", "— tidak ada (berdiri sendiri) —")}</option>
                {openGoals.map((g) => (
                  <option key={g.goal_no} value={g.goal_no}>#{g.rank} · {g.title}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              <Link2 className="mr-1 inline h-3.5 w-3.5" />
              {tr("Starts after", "Mulai setelah")}
              <select
                value={draft.waits_on_no}
                disabled={!draft.goal_no}
                onChange={(e) => setDraft({ ...draft, waits_on_no: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm disabled:bg-slate-50"
              >
                <option value="">{tr("— nothing, can start now —", "— tidak ada, bisa langsung mulai —")}</option>
                {draft.goal_no && partsOf(draft.goal_no).map((x) => (
                  <option key={x.task_no} value={x.task_no}>{x.title} · {x.assignee_name}</option>
                ))}
              </select>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr("Only between parts of the same goal: the drawing before the BOM, the BOM before the PR.",
                    "Hanya antar bagian sasaran yang sama: gambar sebelum BOM, BOM sebelum PR.")}
              </span>
            </label>
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              {tr("What must be handed over", "Yang harus diserahkan")}
              <input
                value={draft.deliverable}
                onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
                placeholder={tr("Stock report as an Excel file, sent to the leader's email", "Laporan stok dalam bentuk excel, dikirim ke email pimpinan")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr("This sentence is what two people use to agree on what", "Kalimat ini yang dipakai dua orang untuk menyepakati arti")}{" "}
                <em>{tr("done", "selesai")}</em>{tr(" means.", ".")}
              </span>
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Period start", "Periode mulai")}
              <input type="date" value={draft.period_start}
                onChange={(e) => setDraft({ ...draft, period_start: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Period end", "Periode selesai")}
              <input type="date" value={draft.period_end}
                onChange={(e) => setDraft({ ...draft, period_end: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Due date", "Jatuh tempo")}
              <input type="date" value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Chase on", "Ditagih tanggal")}
              <input type="date" value={draft.chase_date}
                onChange={(e) => setDraft({ ...draft, chase_date: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr(
                  "The day this board reminds you to ask. It may not be after the due date.",
                  "Hari papan ini mengingatkan untuk menanyakannya. Tidak boleh lewat dari jatuh tempo.",
                )}
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={add} disabled={busy || !draft.assignee_no || !draft.title || !draft.due_date}>
              {tr("Save", "Simpan")}
            </Button>
          </div>
        </Card>
      )}

      {tab === "goals" && (
        <GoalsPanel
          employees={employees.status === "ready" ? employees.data : []}
          mayCreate={mayCreate}
          mayEdit={mayEdit}
          onAddPart={addPart}
          stamp={tasks.status === "ready" ? tasks.data : null}
          onChanged={reloadTasks}
        />
      )}

      {tab === "backlog" && (
        <BacklogPanel
          employees={employees.status === "ready" ? employees.data : []}
          goals={openGoals}
          mayCreate={mayCreate}
          mayEdit={mayEdit}
          onChanged={reloadTasks}
        />
      )}

      {tab === "daily" && (
        <DailyPanel goals={openGoals} mayCreate={mayCreate} onChanged={reloadTasks} />
      )}

      {(tab === "open" || tab === "all") && (
        <Loaded state={tasks} onRetry={reloadTasks}>
          {(all) => {
            const list = tab === "open" ? all.filter((t) => t.status === "OPEN") : all;
            if (list.length === 0) {
              return (
                <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
                  {tr("No tasks here yet.", "Belum ada tugas di sini.")}
                </p></Card>
              );
            }
            return (
              <Card>
                <ul className="divide-y divide-slate-100">
                  {list.map((t) => (
                    <li key={t.task_no} className="px-5 py-3">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <div className="min-w-[240px] flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            {t.title}
                            {t.routine_no && (
                              <span className="ml-2 align-middle text-[10px] font-normal uppercase tracking-wide text-slate-400">
                                {tr("routine", "rutin")}
                              </span>
                            )}
                          </p>
                          <p className="text-[12px] text-slate-500">
                            <span className="font-mono text-[11px]">{t.task_no}</span>
                            {" · "}{t.assignee_name}
                            {t.period_label && <> · {t.period_label}</>}
                            {" · "}{t.due_date}
                          </p>
                          {t.goal_no && (
                            <p className="mt-0.5 text-[12px] text-slate-600">
                              <Target className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                              {t.goal_rank !== null && <strong className="font-semibold">#{t.goal_rank} </strong>}
                              {t.goal_title}
                            </p>
                          )}
                          {t.waits_on_no && (
                            <p className={cn("mt-0.5 text-[12px]", t.waiting ? "text-slate-700" : "text-slate-400")}>
                              <Link2 className="mr-1 inline h-3.5 w-3.5" />
                              {t.waiting
                                ? tr(`Waiting on: ${t.waits_on_title} (${t.waits_on_assignee})`, `Menunggu: ${t.waits_on_title} (${t.waits_on_assignee})`)
                                : tr(`Started from: ${t.waits_on_title}`, `Mulai dari: ${t.waits_on_title}`)}
                            </p>
                          )}
                          {t.deliverable && (
                            <p className="mt-0.5 text-[12px] text-slate-600">
                              <span className="text-slate-400">{tr("asked for:", "diminta:")}</span> {t.deliverable}
                            </p>
                          )}
                          {t.delivered_note && (
                            <p className="mt-0.5 text-[12px] text-emerald-800">
                              <PackageCheck className="mr-1 inline h-3.5 w-3.5" />
                              {t.delivered_note}
                            </p>
                          )}
                          <TaskPrs prs={prs.get(t.task_no)} open={t.status === "OPEN"} />
                          {t.blocked_reason && (
                            <p className="mt-0.5 text-[12px] text-amber-800">
                              <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
                              {t.blocked_reason}
                            </p>
                          )}
                          {t.cancelled_reason && (
                            <p className="mt-0.5 text-[12px] text-slate-500">
                              {tr("Cancelled:", "Dibatalkan:")} {t.cancelled_reason}
                            </p>
                          )}
                          {t.chased_at && (
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {tr("Chased", "Ditagih")} {t.chased_at.slice(0, 10)}
                              {t.chased_by_name && <> {tr("by", "oleh")} {t.chased_by_name}</>}
                              {t.chase_note && <>: {t.chase_note}</>}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {t.overdue && <Badge tone="red">{tr(`${-t.days_left} days late`, `terlambat ${-t.days_left} hari`)}</Badge>}
                            {t.chase_due && <Badge tone="amber">{tr("chase today", "ditagih hari ini")}</Badge>}
                            {t.status === "OPEN" && t.blocked_reason && <Badge tone="amber">{tr("blocked", "tertahan")}</Badge>}
                            {t.status === "DONE" && (
                              <Badge tone={t.late ? "amber" : "green"}>
                                {t.late ? tr("done late", "selesai terlambat") : tr("done", "selesai")}
                              </Badge>
                            )}
                            {t.status === "CANCELLED" && <Badge tone="slate">{tr("cancelled", "dibatalkan")}</Badge>}
                            {t.status === "OPEN" && !t.acknowledged && (
                              <Badge tone="slate">{tr("not yet read", "belum dibaca")}</Badge>
                            )}
                            {t.status === "OPEN" && t.has_started && !t.blocked_reason && (
                              <Badge tone="brand">{tr("in progress", "sedang dikerjakan")}</Badge>
                            )}
                          </div>
                          {mayEdit && t.status === "OPEN" && (
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {!t.acknowledged && (
                                <Button size="sm" variant="ghost" onClick={() => acknowledge(t)} disabled={busy}>
                                  <MailCheck className="h-4 w-4" /> {tr("Received", "Diterima")}
                                </Button>
                              )}
                              {t.chase_date && !t.chased_at && (
                                <Button size="sm" variant="ghost" onClick={() => chase(t)} disabled={busy}>
                                  <AlarmClock className="h-4 w-4" /> {tr("Chase", "Tagih")}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => act(t, "done")} disabled={busy}>
                                <Check className="h-4 w-4" /> {tr("Done", "Selesai")}
                              </Button>
                              {t.blocked_reason ? (
                                <Button size="sm" variant="ghost" onClick={() => act(t, "unblock")} disabled={busy}>
                                  <PlayCircle className="h-4 w-4" /> {tr("Resume", "Lanjut")}
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => act(t, "block")} disabled={busy}>
                                  <PauseCircle className="h-4 w-4" /> {tr("Blocked", "Tertahan")}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => startPlanning(t)} disabled={busy}>
                                <SlidersHorizontal className="h-4 w-4" /> {tr("Plan", "Atur")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => act(t, "cancel")} disabled={busy}>
                                <Ban className="h-4 w-4" /> {tr("Cancel", "Batal")}
                              </Button>
                            </div>
                          )}
                          {mayEdit && t.status === "DONE" && (
                            <Button size="sm" variant="ghost" onClick={() => act(t, "reopen")} disabled={busy}>
                              <RotateCcw className="h-4 w-4" /> {tr("Reopen", "Buka lagi")}
                            </Button>
                          )}
                        </div>
                      </div>
                      {planning === t.task_no && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="mb-2 text-[12px] text-slate-600">
                            {tr(
                              "Move the plan without cancelling the work. A due date cannot move into the past — that would make the person late by somebody else's hand. A new person starts as not yet read.",
                              "Geser rencananya tanpa membatalkan pekerjaannya. Jatuh tempo tidak bisa dipindah ke masa lalu — itu membuat orangnya terlambat oleh tangan orang lain. Orang baru mulai dari belum dibaca.",
                            )}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="text-[12px] text-slate-600">
                              {tr("Due date", "Jatuh tempo")}
                              <input type="date" value={plan.due_date}
                                onChange={(e) => setPlan({ ...plan, due_date: e.target.value })}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                            </label>
                            <label className="text-[12px] text-slate-600">
                              {tr("Held by", "Dipegang oleh")}
                              <select value={plan.assignee_no}
                                onChange={(e) => setPlan({ ...plan, assignee_no: e.target.value })}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                                {employees.status === "ready" && employees.data
                                  .filter((e) => e.active || e.employee_no === t.assignee_no)
                                  .map((e) => (
                                    <option key={e.employee_no} value={e.employee_no}>{e.full_name} · {e.employee_no}</option>
                                  ))}
                              </select>
                            </label>
                            <label className="text-[12px] text-slate-600">
                              {tr("Chase on", "Ditagih tanggal")}
                              <input type="date" value={plan.chase_date}
                                onChange={(e) => setPlan({ ...plan, chase_date: e.target.value })}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                            </label>
                            <label className="text-[12px] text-slate-600">
                              {tr("Part of goal", "Bagian dari sasaran")}
                              <select value={plan.goal_no}
                                onChange={(e) => setPlan({ ...plan, goal_no: e.target.value, waits_on_no: "" })}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                                <option value="">{tr("— none —", "— tidak ada —")}</option>
                                {openGoals.map((g) => (
                                  <option key={g.goal_no} value={g.goal_no}>#{g.rank} · {g.title}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[12px] text-slate-600 sm:col-span-2">
                              {tr("Starts after", "Mulai setelah")}
                              <select value={plan.waits_on_no} disabled={!plan.goal_no}
                                onChange={(e) => setPlan({ ...plan, waits_on_no: e.target.value })}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-50">
                                <option value="">{tr("— nothing —", "— tidak ada —")}</option>
                                {plan.goal_no && partsOf(plan.goal_no, t.task_no).map((x) => (
                                  <option key={x.task_no} value={x.task_no}>{x.title} · {x.assignee_name}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setPlanning(null)}>{tr("Cancel", "Batal")}</Button>
                            <Button size="sm" onClick={() => savePlan(t)} disabled={busy || !plan.due_date || !plan.assignee_no}>
                              {tr("Save plan", "Simpan rencana")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          }}
        </Loaded>
      )}

      {/* ── the standing expectations ─────────────────────────────────────── */}
      {tab === "routines" && (
        <>
          <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
            {tr(
              "A routine is not a task: it has no due date and cannot be finished. What gets finished is the task",
              "Tugas rutin bukan tugas: ia tidak punya jatuh tempo dan tidak bisa diselesaikan. Yang diselesaikan adalah tugas yang",
            )}{" "}
            <strong>{tr("raised", "diterbitkan")}</strong>{" "}
            {tr("from it, one per period.", "darinya, satu per periode.")}{" "}
            <strong>{tr("Raise periods", "Terbitkan periode")}</strong>{" "}
            {tr(
              "can be pressed any number of times — periods that already exist are skipped, not duplicated.",
              "boleh ditekan berapa kali pun — periode yang sudah ada dilewati, bukan digandakan.",
            )}
            {" "}{tr(
              "The cadence cannot be changed once running: changing it re-cuts every period boundary, and periods already raised would silently collide with the new ones. Stop the old one, create a new one.",
              "Iramanya tidak bisa diganti setelah berjalan: mengganti irama memotong ulang batas setiap periode, dan periode yang sudah terbit akan bertabrakan diam-diam dengan yang baru. Hentikan yang lama, buat yang baru.",
            )}
          </p>
          {mayCreate && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" onClick={() => setAddingRoutine((v) => !v)}>
                <Plus className="h-4 w-4" /> {tr("New routine task", "Tugas rutin baru")}
              </Button>
            </div>
          )}
          {addingRoutine && mayCreate && (
            <Card className="mb-4">
              <CardHeader title={tr("New routine task", "Tugas rutin baru")} icon={Repeat} />
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
                <label className="text-[12px] text-slate-600">
                  {tr("For whom", "Untuk siapa")}
                  <select
                    value={rDraft.assignee_no}
                    onChange={(e) => setRDraft({ ...rDraft, assignee_no: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  >
                    <option value="">{tr("— choose —", "— pilih —")}</option>
                    {employees.status === "ready" && employees.data
                      .filter((e) => e.active)
                      .map((e) => (
                        <option key={e.employee_no} value={e.employee_no}>
                          {e.full_name} · {e.employee_no}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-[12px] text-slate-600">
                  {tr("Cadence", "Irama")}
                  <select
                    value={rDraft.cadence}
                    onChange={(e) => setRDraft({ ...rDraft, cadence: e.target.value as Cadence })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  >
                    {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                      <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-slate-600">
                  {tr("What is the task", "Tugasnya apa")}
                  <input
                    value={rDraft.title} onChange={(e) => setRDraft({ ...rDraft, title: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  {tr("What must be handed over", "Yang harus diserahkan")}
                  <input
                    value={rDraft.deliverable}
                    onChange={(e) => setRDraft({ ...rDraft, deliverable: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  {tr("Due — days after the period ends", "Jatuh tempo — hari setelah periode selesai")}
                  <input
                    type="number" min={0} max={60} value={rDraft.due_offset_days}
                    onChange={(e) => setRDraft({ ...rDraft, due_offset_days: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {tr("A monthly report chased on the 5th means 4.", "Laporan bulanan yang ditagih tanggal 5 berarti 4.")}
                  </span>
                </label>
                <label className="text-[12px] text-slate-600">
                  {tr("Chased — days before the due date", "Ditagih — hari sebelum jatuh tempo")}
                  <input
                    type="number" min={0} max={60} value={rDraft.chase_lead_days}
                    onChange={(e) => setRDraft({ ...rDraft, chase_lead_days: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {tr(
                      "Zero means asking on the due date itself — honest, but usually too late to help.",
                      "Nol berarti ditanyakan pada hari jatuh temponya — jujur, tapi biasanya sudah terlambat untuk menolong.",
                    )}
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => setAddingRoutine(false)}>{tr("Cancel", "Batal")}</Button>
                <Button size="sm" onClick={addRoutine}
                  disabled={busy || !rDraft.assignee_no || !rDraft.title || !rDraft.deliverable}>
                  {tr("Save", "Simpan")}
                </Button>
              </div>
            </Card>
          )}
          <Loaded state={routines} onRetry={reloadRoutines}>
            {(list) => list.length === 0 ? (
              <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
                {tr("No routine tasks yet.", "Belum ada tugas rutin.")}
              </p></Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {list.map((r) => (
                  <Card key={r.routine_no}>
                    <CardHeader
                      title={r.title}
                      subtitle={`${CADENCE_LABEL[r.cadence]} · ${r.assignee_name}`}
                      icon={r.live ? Repeat : Ban}
                      action={
                        r.live
                          ? <Badge tone="green">{tr("running", "berjalan")}</Badge>
                          : <Badge tone="slate">{tr("stopped", "berhenti")} {r.ends_on}</Badge>
                      }
                    />
                    <div className="space-y-1.5 px-5 py-3 text-[13px]">
                      <p className="text-slate-700">
                        <span className="text-slate-400">{tr("handed over:", "diserahkan:")}</span> {r.deliverable}
                      </p>
                      {r.detail && <p className="text-[12px] text-slate-500">{r.detail}</p>}
                      <p className="text-[12px] text-slate-500">
                        <CalendarRange className="mr-1 inline h-3.5 w-3.5" />
                        {tr("Current period", "Periode berjalan")} <strong>{r.current_period}</strong>{tr(" · due", " · jatuh tempo")}{" "}
                        <span className="font-mono">{r.current_due}</span>
                        {r.chase_lead_days > 0 && tr(` · chased ${r.chase_lead_days} days before`, ` · ditagih ${r.chase_lead_days} hari sebelumnya`)}
                      </p>
                      <p className="text-[12px] text-slate-500">
                        <ListChecks className="mr-1 inline h-3.5 w-3.5" />
                        {tr(`${r.raised_count} raised, ${r.open_count} still open`, `${r.raised_count} terbit, ${r.open_count} masih terbuka`)}
                      </p>
                      {r.ended_reason && (
                        <p className="text-[12px] text-slate-500">{tr("Stopped:", "Dihentikan:")} {r.ended_reason}</p>
                      )}
                    </div>
                    {mayEdit && r.live && (
                      <div className="flex justify-end border-t border-slate-100 px-5 py-2.5">
                        <Button size="sm" variant="ghost" onClick={() => endRoutine(r.routine_no, r.title)} disabled={busy}>
                          <Ban className="h-4 w-4" /> {tr("Stop", "Hentikan")}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Loaded>
        </>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        {tr(
          `Today's office day is ${today}. Nothing on this page feeds anybody's assessment: a missed chase, a task not marked as received and an empty hand-over note are at least as much the failure of whoever assigned the task as of whoever received it — and a number that cannot tell the two apart punishes the wrong person.`,
          `Hari kantor hari ini ${today}. Tidak satu pun yang di halaman ini masuk ke penilaian siapa pun: penagihan yang terlewat, tugas yang belum ditandai diterima, dan catatan penyerahan yang kosong sekurang-kurangnya sama-sama kelalaian yang memberi tugas dan yang menerimanya — dan angka yang tidak bisa membedakan keduanya akan menghukum orang yang salah.`,
        )}
      </p>
    </div>
  );
}
