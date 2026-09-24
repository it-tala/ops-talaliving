"use client";

import { useState } from "react";
import {
  AlarmClock, CalendarRange, Check, ListChecks, PauseCircle, PlayCircle,
  Plus, Repeat, Ban, PackageCheck, BellRing, MailCheck,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import { CADENCE_LABEL, type Cadence } from "@/services/hr/task-periods";
import type { TaskView } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

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
 *  What is deliberately **not** here: none of this feeds anybody's score. A
 *  missed chase, an unacknowledged task and an empty hand-over note are each at
 *  least as much the leader's failure as the assignee's, and a number that
 *  cannot tell the difference punishes the wrong person. They are printed.
 */
export default function TasksPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const today = officeToday();

  const [tasks, reloadTasks] = useLoad(() => hr.listTasks(), []);
  const [routines, reloadRoutines] = useLoad(() => hr.listTaskRoutines(), []);
  const [employees] = useLoad(() => hr.listEmployees(), []);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"open" | "all" | "routines">("open");

  const mayCreate = can("hrd.create");
  const mayEdit = can("hrd.update");

  /* One draft for a one-off task, one for a routine. Kept flat and keyed by
     field name rather than rebuilt per keystroke — a map keyed by a value the
     user is typing loses the caret on every character (F142's shape). */
  const [draft, setDraft] = useState({
    assignee_no: "", title: "", due_date: "", deliverable: "",
    period_start: "", period_end: "", chase_date: "",
  });
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
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak dibuat", res.error.message);
      return;
    }
    toast("success", `${res.data.task_no} dibuat`,
      `${res.data.assignee_name} · jatuh tempo ${res.data.due_date}`
      + (res.data.chase_date ? ` · ditagih ${res.data.chase_date}` : ""));
    setDraft({ assignee_no: draft.assignee_no, title: "", due_date: "", deliverable: "",
               period_start: "", period_end: "", chase_date: "" });
    setAdding(false);
    reloadTasks();
  }

  async function chase(t: TaskView) {
    const note = window.prompt(
      `Menagih ${t.assignee_name}: ${t.title}\n\n`
      + "Apa jawabannya? Catatan ini yang dibaca saat ditagih lagi — dan tugas ini "
      + "keluar dari daftar tagihan begitu dicatat, bukan setelah pekerjaannya datang.",
      "",
    );
    if (note === null) return;
    setBusy(true);
    const res = await hr.chaseTask({ task_no: t.task_no, note });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak tercatat", res.error.message); return; }
    toast("success", t.task_no, "Penagihan dicatat");
    reloadTasks();
  }

  async function acknowledge(t: TaskView) {
    setBusy(true);
    const res = await hr.acknowledgeTask({ task_no: t.task_no });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", t.task_no, "Ditandai sudah diterima orangnya");
    reloadTasks();
  }

  async function act(t: TaskView, action: "done" | "block" | "unblock" | "cancel") {
    let reason: string | null = null;
    let delivered: string | null = null;
    if (action === "block") {
      reason = window.prompt("Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya, jadi alasannya wajib.");
      if (!reason?.trim()) return;
    }
    if (action === "cancel") {
      reason = window.prompt("Kenapa dibatalkan?");
      if (!reason?.trim()) return;
    }
    if (action === "done") {
      /* Asked, never required. Refusing to let somebody close their own work
         over an empty text box is how a tracker stops being used (A6). */
      delivered = window.prompt(
        t.deliverable
          ? `Yang diminta: ${t.deliverable}\n\nApa yang diserahkan? Boleh dikosongkan.`
          : "Apa yang diserahkan? Boleh dikosongkan.",
        "",
      );
      if (delivered === null) return;
    }
    setBusy(true);
    const res = await hr.updateTask({ task_no: t.task_no, action, reason, delivered });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", t.task_no,
      action === "done" ? "Selesai" : action === "block" ? "Ditandai tertahan"
      : action === "unblock" ? "Tidak lagi tertahan" : "Dibatalkan");
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
    if (res.error) { toast("warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", `${res.data.routine_no} dibuat`,
      `${CADENCE_LABEL[res.data.cadence]} · ${res.data.assignee_name} · periode berjalan ${res.data.current_period}`);
    setRDraft({ ...rDraft, title: "", deliverable: "" });
    setAddingRoutine(false);
    reloadRoutines();
  }

  async function endRoutine(routineNo: string, title: string) {
    const reason = window.prompt(
      `Menghentikan "${title}".\n\n`
      + "Kenapa dihentikan? Tugas yang sudah terbit tetap berlaku — yang berhenti "
      + "adalah penerbitan periode berikutnya.",
    );
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await hr.endTaskRoutine({ routine_no: routineNo, reason });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", routineNo,
      res.data.open_count > 0
        ? `Dihentikan. ${res.data.open_count} tugas yang sudah terbit masih terbuka.`
        : "Dihentikan.");
    reloadRoutines(); reloadTasks();
  }

  async function roll() {
    setBusy(true);
    const res = await hr.rollTaskRoutines({});
    setBusy(false);
    if (res.error) { toast("warning", "Tidak diterbitkan", res.error.message); return; }
    /* Both numbers, always. "0 dibuat" means *nothing was needed* and it also
       means *everything collided*, and those are not the same news. */
    toast(res.data.created > 0 ? "success" : "info",
      `${res.data.created} tugas terbit`,
      res.data.already_there > 0
        ? `${res.data.already_there} periode sudah ada dan dilewati.`
        : "Tidak ada periode yang terlewat.");
    reloadTasks(); reloadRoutines();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Pemantauan tugas"
        description="Tugas rutin dan tugas tambahan, lengkap dengan periode pengerjaannya, apa yang harus diserahkan, dan kapan ditagih. Yang mengingat tanggal penagihan adalah papan ini, bukan orangnya."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {mayCreate && (
              <Button size="sm" variant="ghost" onClick={roll} disabled={busy}>
                <Repeat className="h-4 w-4" /> Terbitkan periode
              </Button>
            )}
            {mayCreate && (
              <Button size="sm" onClick={() => { setAdding((v) => !v); setAddingRoutine(false); }}>
                <Plus className="h-4 w-4" /> Tugas baru
              </Button>
            )}
            <SourceBadge state={tasks} />
          </div>
        }
      />

      {/* ── what has to be asked for, today ──────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader
          title="Ditagih hari ini"
          subtitle={
            chases.length === 0
              ? "Tidak ada yang jatuh tempo ditagih. Daftar ini kosong karena sudah ditagih atau memang belum waktunya — bukan karena tidak ada tugas."
              : `${chases.length} tugas sudah sampai tanggal penagihannya dan belum ada yang menanyakan.`
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
                    {t.period_label && <> · periode <span className="font-medium">{t.period_label}</span></>}
                    {" · jatuh tempo "}{t.due_date}
                    {t.days_left < 0
                      ? <span className="text-rose-700"> ({-t.days_left} hari lewat)</span>
                      : <span className="text-slate-400"> ({t.days_left} hari lagi)</span>}
                  </p>
                  {t.deliverable && (
                    <p className="mt-0.5 text-[12px] text-slate-600">
                      <span className="text-slate-400">yang diminta:</span> {t.deliverable}
                    </p>
                  )}
                  {!t.acknowledged && (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      Belum ada tanda tugas ini diterima orangnya.
                    </p>
                  )}
                </div>
                {mayEdit && (
                  <Button size="sm" onClick={() => chase(t)} disabled={busy}>
                    <AlarmClock className="h-4 w-4" /> Catat penagihan
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {unheard > 0 && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
          <strong>{unheard} dari {open.length} tugas terbuka belum ditandai diterima.</strong>{" "}
          Tanda itu bukan syarat apa pun — yang belum ditandai tetap jatuh tempo dan tetap
          terlambat kalau terlambat. Gunanya nanti, waktu pertanyaannya menjadi
          <em> apakah orangnya memang pernah diberi tahu</em>, dan jawabannya harus ada
          bekasnya di dua sisi.
        </p>
      )}

      <div className="mb-3 flex gap-1.5">
        {([["open", "Terbuka"], ["all", "Semua"], ["routines", "Tugas rutin"]] as const).map(([k, label]) => (
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
          <CardHeader title="Tugas baru" subtitle="Periode dan tanggal penagihan boleh dikosongkan — keduanya untuk tugas yang menutup satu rentang waktu, bukan satu permintaan sekali jalan." icon={Plus} />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <label className="text-[12px] text-slate-600">
              Untuk siapa
              <select
                value={draft.assignee_no}
                onChange={(e) => setDraft({ ...draft, assignee_no: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              >
                <option value="">— pilih —</option>
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
              Tugasnya apa
              <input
                value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
            </label>
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              Yang harus diserahkan
              <input
                value={draft.deliverable}
                onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
                placeholder="Laporan stok dalam bentuk excel, dikirim ke email pimpinan"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                Kalimat ini yang dipakai dua orang untuk menyepakati arti <em>selesai</em>.
              </span>
            </label>
            <label className="text-[12px] text-slate-600">
              Periode mulai
              <input type="date" value={draft.period_start}
                onChange={(e) => setDraft({ ...draft, period_start: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              Periode selesai
              <input type="date" value={draft.period_end}
                onChange={(e) => setDraft({ ...draft, period_end: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              Jatuh tempo
              <input type="date" value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600">
              Ditagih tanggal
              <input type="date" value={draft.chase_date}
                onChange={(e) => setDraft({ ...draft, chase_date: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                Hari papan ini mengingatkan untuk menanyakannya. Tidak boleh lewat dari jatuh tempo.
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Batal</Button>
            <Button size="sm" onClick={add} disabled={busy || !draft.assignee_no || !draft.title || !draft.due_date}>
              Simpan
            </Button>
          </div>
        </Card>
      )}

      {tab !== "routines" && (
        <Loaded state={tasks} onRetry={reloadTasks}>
          {(all) => {
            const list = tab === "open" ? all.filter((t) => t.status === "OPEN") : all;
            if (list.length === 0) {
              return (
                <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
                  Belum ada tugas di sini.
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
                                rutin
                              </span>
                            )}
                          </p>
                          <p className="text-[12px] text-slate-500">
                            <span className="font-mono text-[11px]">{t.task_no}</span>
                            {" · "}{t.assignee_name}
                            {t.period_label && <> · {t.period_label}</>}
                            {" · "}{t.due_date}
                          </p>
                          {t.deliverable && (
                            <p className="mt-0.5 text-[12px] text-slate-600">
                              <span className="text-slate-400">diminta:</span> {t.deliverable}
                            </p>
                          )}
                          {t.delivered_note && (
                            <p className="mt-0.5 text-[12px] text-emerald-800">
                              <PackageCheck className="mr-1 inline h-3.5 w-3.5" />
                              {t.delivered_note}
                            </p>
                          )}
                          {t.blocked_reason && (
                            <p className="mt-0.5 text-[12px] text-amber-800">
                              <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
                              {t.blocked_reason}
                            </p>
                          )}
                          {t.cancelled_reason && (
                            <p className="mt-0.5 text-[12px] text-slate-500">
                              Dibatalkan: {t.cancelled_reason}
                            </p>
                          )}
                          {t.chased_at && (
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Ditagih {t.chased_at.slice(0, 10)}
                              {t.chased_by_name && <> oleh {t.chased_by_name}</>}
                              {t.chase_note && <>: {t.chase_note}</>}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {t.overdue && <Badge tone="red">terlambat {-t.days_left} hari</Badge>}
                            {t.chase_due && <Badge tone="amber">ditagih hari ini</Badge>}
                            {t.status === "OPEN" && t.blocked_reason && <Badge tone="amber">tertahan</Badge>}
                            {t.status === "DONE" && (
                              <Badge tone={t.late ? "amber" : "green"}>
                                {t.late ? "selesai terlambat" : "selesai"}
                              </Badge>
                            )}
                            {t.status === "CANCELLED" && <Badge tone="slate">dibatalkan</Badge>}
                            {t.status === "OPEN" && !t.acknowledged && (
                              <Badge tone="slate">belum dibaca</Badge>
                            )}
                          </div>
                          {mayEdit && t.status === "OPEN" && (
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {!t.acknowledged && (
                                <Button size="sm" variant="ghost" onClick={() => acknowledge(t)} disabled={busy}>
                                  <MailCheck className="h-4 w-4" /> Diterima
                                </Button>
                              )}
                              {t.chase_date && !t.chased_at && (
                                <Button size="sm" variant="ghost" onClick={() => chase(t)} disabled={busy}>
                                  <AlarmClock className="h-4 w-4" /> Tagih
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => act(t, "done")} disabled={busy}>
                                <Check className="h-4 w-4" /> Selesai
                              </Button>
                              {t.blocked_reason ? (
                                <Button size="sm" variant="ghost" onClick={() => act(t, "unblock")} disabled={busy}>
                                  <PlayCircle className="h-4 w-4" /> Lanjut
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => act(t, "block")} disabled={busy}>
                                  <PauseCircle className="h-4 w-4" /> Tertahan
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => act(t, "cancel")} disabled={busy}>
                                <Ban className="h-4 w-4" /> Batal
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
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
            Tugas rutin bukan tugas: ia tidak punya jatuh tempo dan tidak bisa diselesaikan.
            Yang diselesaikan adalah tugas yang <strong>diterbitkan</strong> darinya, satu per
            periode. <strong>Terbitkan periode</strong> boleh ditekan berapa kali pun — periode
            yang sudah ada dilewati, bukan digandakan.
            {" "}Iramanya tidak bisa diganti setelah berjalan: mengganti irama memotong ulang
            batas setiap periode, dan periode yang sudah terbit akan bertabrakan diam-diam
            dengan yang baru. Hentikan yang lama, buat yang baru.
          </p>
          {mayCreate && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" onClick={() => setAddingRoutine((v) => !v)}>
                <Plus className="h-4 w-4" /> Tugas rutin baru
              </Button>
            </div>
          )}
          {addingRoutine && mayCreate && (
            <Card className="mb-4">
              <CardHeader title="Tugas rutin baru" icon={Repeat} />
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
                <label className="text-[12px] text-slate-600">
                  Untuk siapa
                  <select
                    value={rDraft.assignee_no}
                    onChange={(e) => setRDraft({ ...rDraft, assignee_no: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  >
                    <option value="">— pilih —</option>
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
                  Irama
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
                  Tugasnya apa
                  <input
                    value={rDraft.title} onChange={(e) => setRDraft({ ...rDraft, title: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Yang harus diserahkan
                  <input
                    value={rDraft.deliverable}
                    onChange={(e) => setRDraft({ ...rDraft, deliverable: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Jatuh tempo — hari setelah periode selesai
                  <input
                    type="number" min={0} max={60} value={rDraft.due_offset_days}
                    onChange={(e) => setRDraft({ ...rDraft, due_offset_days: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    Laporan bulanan yang ditagih tanggal 5 berarti 4.
                  </span>
                </label>
                <label className="text-[12px] text-slate-600">
                  Ditagih — hari sebelum jatuh tempo
                  <input
                    type="number" min={0} max={60} value={rDraft.chase_lead_days}
                    onChange={(e) => setRDraft({ ...rDraft, chase_lead_days: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                  />
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    Nol berarti ditanyakan pada hari jatuh temponya — jujur, tapi biasanya sudah terlambat untuk menolong.
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => setAddingRoutine(false)}>Batal</Button>
                <Button size="sm" onClick={addRoutine}
                  disabled={busy || !rDraft.assignee_no || !rDraft.title || !rDraft.deliverable}>
                  Simpan
                </Button>
              </div>
            </Card>
          )}
          <Loaded state={routines} onRetry={reloadRoutines}>
            {(list) => list.length === 0 ? (
              <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
                Belum ada tugas rutin.
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
                          ? <Badge tone="green">berjalan</Badge>
                          : <Badge tone="slate">berhenti {r.ends_on}</Badge>
                      }
                    />
                    <div className="space-y-1.5 px-5 py-3 text-[13px]">
                      <p className="text-slate-700">
                        <span className="text-slate-400">diserahkan:</span> {r.deliverable}
                      </p>
                      {r.detail && <p className="text-[12px] text-slate-500">{r.detail}</p>}
                      <p className="text-[12px] text-slate-500">
                        <CalendarRange className="mr-1 inline h-3.5 w-3.5" />
                        Periode berjalan <strong>{r.current_period}</strong> · jatuh tempo{" "}
                        <span className="font-mono">{r.current_due}</span>
                        {r.chase_lead_days > 0 && <> · ditagih {r.chase_lead_days} hari sebelumnya</>}
                      </p>
                      <p className="text-[12px] text-slate-500">
                        <ListChecks className="mr-1 inline h-3.5 w-3.5" />
                        {r.raised_count} terbit, {r.open_count} masih terbuka
                      </p>
                      {r.ended_reason && (
                        <p className="text-[12px] text-slate-500">Dihentikan: {r.ended_reason}</p>
                      )}
                    </div>
                    {mayEdit && r.live && (
                      <div className="flex justify-end border-t border-slate-100 px-5 py-2.5">
                        <Button size="sm" variant="ghost" onClick={() => endRoutine(r.routine_no, r.title)} disabled={busy}>
                          <Ban className="h-4 w-4" /> Hentikan
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
        Hari kantor hari ini {today}. Tidak satu pun yang di halaman ini masuk ke penilaian
        siapa pun: penagihan yang terlewat, tugas yang belum ditandai diterima, dan catatan
        penyerahan yang kosong sekurang-kurangnya sama-sama kelalaian yang memberi tugas dan
        yang menerimanya — dan angka yang tidak bisa membedakan keduanya akan menghukum orang
        yang salah.
      </p>
    </div>
  );
}
