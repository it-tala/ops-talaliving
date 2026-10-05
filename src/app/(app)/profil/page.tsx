"use client";

import { useState } from "react";
import {
  KeyRound, Activity, Fingerprint, Clock, CalendarClock, ClipboardList, Wallet,
  Check, Plus, AlertTriangle, ShieldAlert, PlayCircle, PauseCircle, PackageCheck, Users,
} from "lucide-react";
import {
  Badge, Button, Card, CardHeader, PageHeader, EmptyState,
} from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Tabs } from "@/components/ui/tabs";
import { EvidenceStrip } from "@/components/ui/evidence-strip";
import { LocatedTap } from "@/components/attendance/located-tap";
import { formatIDR, formatNumber } from "@/lib/format";
import { OFFICE_TZ, officeClock, officeDay, officeToday, shiftDay } from "@/lib/office";
import { hr, identity } from "@/demo/api";
import {
  LEAVE_KIND_LABEL, OVERTIME_STAGE_LABEL, type LeaveKind, type TaskView,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { GoalBoardList, GoalProgress } from "@/components/hr/goal-parts";
import { OvertimeForm } from "../saya/overtime-form";
import { OvertimeAskDetails, useOvertimeStatus } from "../saya/overtime-ask";
import { useDayLabel } from "../saya/shared";

/** The profile every account owns (W7) — a different object from every other
 *  screen in this system, because it is the one screen where "which rows may
 *  this account see" is answered by an account-to-employee link rather than
 *  by a module grant (0152, 0163–0166). Reset a password, read a personal
 *  history of what was done through this page, tap presensi from a phone
 *  instead of the reader at the door, ask for overtime and leave, see a
 *  reminder of what is due, and read one's own payslip.
 *
 *  Every write here is either self-scoped at the database (own row, checked
 *  against the account's own linked employee — never a filter in this
 *  component) or refused with `no_employee_link` for an account this system
 *  has never tied to a person. That refusal is not a bug in this screen: most
 *  accounts in this business are leadership, IT or office roles with no
 *  employee row at all, and the honest answer for them is that this half of
 *  the page has nothing to show, said plainly rather than as an empty table.
 */
export default function ProfilePage() {
  const { session } = useSession();
  const [me] = useLoad(() => hr.myProfile(), []);
  const tr = useTr();

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Profile", "Profil")}
        title={session?.user.full_name ?? tr("My profile", "Profil saya")}
        description={session?.user.email}
      />

      <Card>
        <Tabs
          defaultId="keamanan"
          items={[
            { id: "keamanan", label: tr("Security", "Keamanan"), content: <SecurityTab /> },
            { id: "aktivitas", label: tr("Activity", "Aktivitas"), content: <ActivityTab /> },
            { id: "presensi", label: tr("Attendance", "Presensi"), content: <AttendanceTab me={me} /> },
            { id: "lembur", label: tr("Overtime", "Lembur"), content: <OvertimeTab me={me} /> },
            { id: "cuti", label: tr("Leave & permits", "Cuti & izin"), content: <LeaveTab me={me} /> },
            { id: "tugas", label: tr("Tasks", "Tugas"), content: <TasksTab me={me} /> },
            { id: "gaji", label: tr("Pay", "Gaji"), content: <PayslipTab me={me} /> },
          ]}
        />
      </Card>
    </div>
  );
}

/** Every read-side tab that needs an employee link shares this shape: while
 *  it is loading, say so; once it is not, an account with nothing behind it
 *  reads one honest sentence instead of an empty list pretending to be a
 *  normal one. */
function NoEmployeeLink() {
  const tr = useTr();
  return (
    <EmptyState
      icon={ShieldAlert}
      title={tr("This account is not linked to an employee record yet", "Akun ini belum tertaut ke data karyawan")}
      description={tr(
        "Most office and leadership accounts are like this — attendance, overtime, leave and pay have no rows to show. Ask HRD to link this account if it should have one.",
        "Kebanyakan akun kantor dan kepemimpinan memang begitu — presensi, lembur, cuti dan gaji tidak punya baris untuk ditampilkan. Minta HRD menautkan akun ini kalau seharusnya ada.",
      )}
    />
  );
}

/* ── Keamanan ─────────────────────────────────────────────────────────── */

function SecurityTab() {
  const { session } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [busy, setBusy] = useState(false);

  async function sendReset() {
    if (!session?.user.email) return;
    setBusy(true);
    const res = await identity.requestPasswordReset(session.user.email);
    setBusy(false);
    if (res.error) {
      toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message);
      return;
    }
    toast(
      "success", tr("Link sent", "Tautan terkirim"),
      tr(
        `If ${session.user.email} has an account here, a link has been sent to that address.`,
        `Kalau ${session.user.email} punya akun di sini, sebuah tautan sudah dikirim ke alamat itu.`,
      ),
    );
  }

  return (
    <Card>
      <CardHeader
        title={tr("Password", "Kata sandi")}
        subtitle={tr(
          "A link is sent to this account's own email address — no password is typed here.",
          "Sebuah tautan dikirim ke alamat email akun ini sendiri — tidak ada kata sandi yang diketik di sini.",
        )}
        icon={KeyRound}
      />
      <div className="px-5 py-4">
        <p className="text-sm text-slate-600">
          {tr("Signed in as:", "Masuk:")} <span className="font-medium text-slate-800">{session?.user.email}</span>
        </p>
        <Button className="mt-3" icon={KeyRound} disabled={busy} onClick={sendReset}>
          {busy ? tr("Sending…", "Mengirim…") : tr("Send a password change link", "Kirim tautan ganti kata sandi")}
        </Button>
      </div>
    </Card>
  );
}

/* ── Aktivitas ────────────────────────────────────────────────────────── */

function ActivityTab() {
  const tr = useTr();
  const [rows, reload] = useLoad(() => identity.listMyActivity(), []);
  return (
    <Card>
      <CardHeader
        title={tr("Recent activity", "Aktivitas terakhir")}
        subtitle={tr(
          "What is recorded about this account's own actions — sign-ins, password changes, attendance taps, requests. Not the IT audit trail: that is read by IT and leadership, not by its owner.",
          "Yang tercatat tentang tindakan akun ini sendiri — masuk, ganti kata sandi, tap presensi, pengajuan. Bukan jejak audit IT: itu dibaca IT dan pimpinan, bukan pemiliknya sendiri.",
        )}
        icon={Activity}
      />
      <Loaded state={rows} onRetry={reload}>
        {(list) => (
          <ul className="divide-y divide-slate-100">
            {list.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No activity recorded yet.", "Belum ada aktivitas tercatat.")}</li>
            )}
            {list.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="w-[130px] shrink-0 font-mono text-[11px] text-slate-400">
                  {officeDay(new Date(r.at))} {officeClock(new Date(r.at))}
                </span>
                <span className="text-slate-700">{r.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}

/* ── Presensi ─────────────────────────────────────────────────────────── */

function AttendanceTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const tr = useTr();
  const linked = me.status === "ready" ? me.data : null;
  /* The office day, not UTC's (D327): early in the office morning the UTC day
     is still yesterday, and a 07:25 clock-in would sit outside `to` until it
     turned. */
  const [days, reloadDays] = useLoad(
    () => {
      const to = officeToday();
      return linked ? hr.attendanceFor({ employee_no: linked.employee_no, from: shiftDay(to, -13), to })
                    : Promise.resolve({ data: [] });
    },
    [linked?.employee_no],
  );

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <Card>
      <CardHeader
        title={tr("Attendance", "Presensi")}
        subtitle={tr(
          "A tap from this session itself, not from the machine at the door — one tap like any other. Whether it is arrival or departure is decided by reading the day, not by the button.",
          "Tap dari sesi ini sendiri, bukan dari mesin di pintu — satu tap seperti tap lainnya. Yang menentukan masuk atau pulang adalah bacaan hari itu, bukan tombolnya.",
        )}
        icon={Fingerprint}
      />
      {/* D332: the tap reads the phone's location once and is judged against
          the warehouse. `/saya` takes this component when D331 lands. */}
      <LocatedTap className="border-b border-slate-100 px-5 pb-4 pt-1" onTapped={() => reloadDays()} />
      <Loaded state={days} onRetry={reloadDays}>
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No attendance in the last 14 days.", "Belum ada presensi 14 hari terakhir.")}</li>
            )}
            {rows.map((d) => (
              <li key={d.work_date} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[13px]">
                <span className="w-[92px] font-medium text-slate-800">{d.work_date}</span>
                <Badge tone={d.state === "review" ? "amber" : d.state === "complete" ? "green" : "slate"}>
                  {d.state}
                </Badge>
                <span className="text-slate-600">
                  {d.scans.length === 0
                    ? tr("no taps", "tidak ada tap")
                    : tr(`${d.scans.length} tap(s) · ${formatNumber(d.work_hours)} working hours`, `${d.scans.length} tap · ${formatNumber(d.work_hours)} jam kerja`)}
                </span>
                {d.overtime_hours > 0 && <span className="text-brand-700">{tr(`+${formatNumber(d.overtime_hours)} overtime hours`, `+${formatNumber(d.overtime_hours)} jam lembur`)}</span>}
                {d.issues.length > 0 && <span className="text-amber-700">{d.issues.join(" · ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}

/* ── Lembur ───────────────────────────────────────────────────────────── */

function OvertimeTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const tr = useTr();
  const [sheets, reload] = useLoad(() => hr.myOvertimeSheets(), []);
  const status = useOvertimeStatus();
  const day = useDayLabel();
  const linked = me.status === "ready" ? me.data : null;

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  /* The same form and the same history row as `/saya` (D331, D333): one ask,
     wherever the person happens to be standing. */
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={tr("Request overtime", "Ajukan lembur")}
          subtitle={tr(
            "What the overtime is for, and — now or later — what was finished. HRD or leadership approves it; only approved hours reach the payslip.",
            "Untuk apa lemburnya, dan — sekarang atau menyusul — apa yang selesai. HRD atau pimpinan yang menyetujui; hanya jam yang disetujui masuk slip gaji.",
          )}
          icon={CalendarClock}
        />
        <div className="max-w-xl px-5 py-4">
          <OvertimeForm onDone={reload} />
        </div>
      </Card>

      <Card>
        <CardHeader title={tr("My overtime history", "Riwayat lembur saya")} icon={Clock} />
        <Loaded state={sheets} onRetry={reload}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No overtime requested yet.", "Belum ada lembur yang diajukan.")}</li>
              )}
              {list.map((s) => {
                const mine = s.lines[0];
                const st = status(s);
                return (
                  <li key={s.sheet_no} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="font-medium text-slate-800">{day(s.work_date)}</span>
                      <span className="text-slate-600">{tr(`${formatNumber(mine?.hours ?? 0)} hours`, `${formatNumber(mine?.hours ?? 0)} jam`)}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="font-mono text-[10px] text-slate-400">{s.sheet_no}</span>
                    </div>
                    <OvertimeAskDetails sheet={s} onChanged={reload} />
                  </li>
                );
              })}
            </ul>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

/* ── Cuti & izin ──────────────────────────────────────────────────────── */

function LeaveTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const { toast } = useToast();
  const tr = useTr();
  const [balance, reloadBalance] = useLoad(() => hr.myLeaveBalance(), []);
  const [requests, reloadRequests] = useLoad(() => hr.myLeaveRequests(), []);
  const [draft, setDraft] = useState({ kind: "cuti" as LeaveKind, from_date: "", to_date: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const linked = me.status === "ready" ? me.data : null;

  async function file() {
    setBusy(true);
    const res = await hr.requestLeave({
      kind: draft.kind, from_date: draft.from_date, to_date: draft.to_date || draft.from_date,
      reason: draft.reason,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`${res.data.request_no} recorded`, `${res.data.request_no} tercatat`),
      tr(`${res.data.days} day(s), awaiting HRD's decision.`, `${res.data.days} hari, menunggu keputusan HRD.`),
    );
    setDraft({ kind: "cuti", from_date: "", to_date: "", reason: "" });
    reloadRequests(); reloadBalance();
  }

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <div className="space-y-4">
      <Loaded state={balance}>
        {(b) => b && (
          <Card>
            <CardHeader title={tr("My leave allowance", "Jatah cuti saya")} icon={CalendarClock} />
            <div className="grid grid-cols-2 gap-4 px-5 py-4 text-[13px] sm:grid-cols-4">
              <div><p className="text-slate-500">{tr("Allowance", "Jatah")}</p><p className="text-lg font-semibold text-slate-800">{tr(`${b.entitlement} days`, `${b.entitlement} hari`)}</p></div>
              <div><p className="text-slate-500">{tr("Taken", "Terpakai")}</p><p className="text-lg font-semibold text-slate-800">{tr(`${b.taken} days`, `${b.taken} hari`)}</p></div>
              <div><p className="text-slate-500">{tr("Approved", "Sudah disetujui")}</p><p className="text-lg font-semibold text-slate-800">{tr(`${b.booked} days`, `${b.booked} hari`)}</p></div>
              <div>
                <p className="text-slate-500">{tr("Remaining", "Sisa")}</p>
                <p className={`text-lg font-semibold ${b.remaining === 0 ? "text-amber-700" : "text-slate-800"}`}>{tr(`${b.remaining} days`, `${b.remaining} hari`)}</p>
              </div>
            </div>
            {b.over > 0 && (
              <p className="border-t border-slate-100 bg-amber-50/60 px-5 py-2 text-[12px] text-amber-900">
                {tr(`${b.over} day(s) taken beyond the allowance — recorded, unpaid.`, `${b.over} hari terpakai di luar jatah — tercatat, tidak dibayar.`)}
              </p>
            )}
          </Card>
        )}
      </Loaded>

      <Card>
        <CardHeader
          title={tr("Request leave / permit", "Ajukan cuti / izin")}
          subtitle={tr("One date range, one reason — that is what is read when it is decided.", "Satu rentang tanggal, satu alasan — itu yang dibaca saat diputuskan.")}
          icon={Plus}
        />
        <div className="px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-[130px_150px_150px]">
            <select
              value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LeaveKind })}
              aria-label={tr("Kind", "Jenis")}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {(Object.keys(LEAVE_KIND_LABEL) as LeaveKind[]).map((k) => (
                <option key={k} value={k}>{LEAVE_KIND_LABEL[k]}</option>
              ))}
            </select>
            <input
              type="date" value={draft.from_date} onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
              aria-label={tr("From date", "Dari tanggal")}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <input
              type="date" value={draft.to_date} onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
              aria-label={tr("To date", "Sampai tanggal")}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder={tr("Reason", "Alasan")}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <Button size="sm" disabled={busy || !draft.from_date || !draft.reason.trim()} onClick={file}>
              {busy ? tr("Saving…", "Menyimpan…") : tr("Submit", "Ajukan")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={tr("My request history", "Riwayat pengajuan saya")} icon={Clock} />
        <Loaded state={requests} onRetry={reloadRequests}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No requests yet.", "Belum ada pengajuan.")}</li>
              )}
              {list.map((r) => (
                <li key={r.id} className="px-5 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === "APPROVED" ? "green" : r.status === "REJECTED" ? "red" : "slate"}>
                      {r.status}
                    </Badge>
                    <span className="text-slate-700">{LEAVE_KIND_LABEL[r.kind]} · {r.from_date} → {r.to_date}</span>
                    <span className="font-mono text-[10px] text-slate-400">{r.request_no}</span>
                  </div>
                  <p className="mt-0.5 text-slate-600">{r.reason}</p>
                  {r.decision_note && <p className="mt-0.5 text-[11px] text-slate-500">{r.decided_by_name}: {r.decision_note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

/* ── Tugas ────────────────────────────────────────────────────────────
 *
 *  Grouped by goal, in the goal's rank (D367): the order of the groups is the
 *  leader's priority, so *what do I do first* is answered by the page and not
 *  by asking. Under each goal, the reader's own parts with the things they
 *  can do about them — receive, start, hand over, say what they are waiting
 *  on (D368) — and, one tap away, every other part of the same goal: who holds
 *  it, what it waits on, what was handed over. Tasks that belong to no goal
 *  follow, then what is finished.
 */

function TasksTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const { toast } = useToast();
  const tr = useTr();
  const linked = me.status === "ready" ? me.data : null;
  /* `listTasks()` composes RLS the same way `v_task` does: without an
     `hrd.read` grant it already answers "just mine", but an account that
     also holds HRD access would otherwise be handed the whole board on its
     own profile page — a second audience `listTasks` was never meant to
     serve here. So the filter is forced to this account's own employee
     number regardless of what other grants it holds; a profile page shows
     one person's tasks, never a roster. */
  const [tasks, reload] = useLoad(
    () => (linked ? hr.listTasks({ assignee_no: linked.employee_no }) : Promise.resolve({ data: [] })),
    [linked?.employee_no],
  );
  /* The same narrowing for goals: `list_goals()` hands an HRD account every
     goal, and this page is one person's — narrowed below to the goals with a
     part of theirs, and the goals they put together. */
  const [goals, reloadGoals] = useLoad(
    () => (linked ? hr.listGoals() : Promise.resolve({ data: [] })),
    [linked?.employee_no, tasks],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);

  async function run(t: TaskView, action: "start" | "done" | "block" | "unblock") {
    let reason: string | null = null;
    let delivered: string | null = null;
    if (action === "block") {
      reason = window.prompt(
        tr(
          "Waiting on what, or on whom? A blocked task is not counted against you — and this sentence is what the person holding it up reads.",
          "Tertahan menunggu apa, atau siapa? Tugas yang tertahan tidak dihitung merugikan Anda — dan kalimat ini yang dibaca pihak yang menahannya.",
        ),
        t.waiting && t.waits_on_title
          ? tr(`Waiting on "${t.waits_on_title}" (${t.waits_on_assignee})`, `Menunggu "${t.waits_on_title}" (${t.waits_on_assignee})`)
          : "",
      );
      if (!reason?.trim()) return;
    }
    if (action === "done") {
      delivered = window.prompt(
        (t.deliverable
          ? tr(`Asked for: ${t.deliverable}\n\n`, `Yang diminta: ${t.deliverable}\n\n`)
          : "")
        + tr("What did you hand over, and where? Required.", "Apa yang Anda serahkan, dan ke mana? Wajib diisi."),
        "",
      );
      if (delivered === null) return;
      if (!delivered.trim()) {
        toast("warning", tr("Not finished", "Belum selesai"), tr(
          "Write what was handed over — without it nobody can check the task is really done.",
          "Tulis apa yang diserahkan — tanpa itu tidak ada yang bisa memeriksa bahwa tugasnya memang selesai.",
        ));
        return;
      }
    }
    setBusy(t.task_no);
    const res = await hr.updateTask({ task_no: t.task_no, action, reason, delivered });
    setBusy(null);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success", t.task_no,
      action === "start" ? tr("Marked as started.", "Ditandai mulai dikerjakan.")
      : action === "done" ? tr("Done and handed over.", "Selesai dan diserahkan.")
      : action === "block" ? tr("Marked blocked.", "Ditandai tertahan.")
      : tr("No longer blocked.", "Tidak lagi tertahan."));
    reload();
  }

  async function acknowledge(taskNo: string) {
    setBusy(taskNo);
    const res = await hr.acknowledgeTask({ task_no: taskNo });
    setBusy(null);
    if (res.error) {
      toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Acknowledged", "Diterima"), tr(`${taskNo} marked as acknowledged.`, `${taskNo} ditandai diterima.`));
    reload();
  }

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  /* A render function, not a nested component: a component declared inside
     another is a new type every render and React would remount every row. */
  function taskLine(t: TaskView) {
    const isBusy = busy === t.task_no;
    return (
      <li key={t.task_no} className="px-5 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-slate-800">{t.title}</span>
          {t.overdue && <Badge tone="red">{tr("Overdue", "Terlambat")}</Badge>}
          {t.chase_due && <Badge tone="amber">{tr("Chased today", "Ditagih hari ini")}</Badge>}
          {t.status === "OPEN" && t.blocked_reason && <Badge tone="amber">{tr("Blocked", "Tertahan")}</Badge>}
          {t.status === "OPEN" && t.waiting && !t.blocked_reason && <Badge tone="slate">{tr("Waiting", "Menunggu")}</Badge>}
          {t.status === "OPEN" && t.has_started && !t.blocked_reason && <Badge tone="brand">{tr("In progress", "Sedang dikerjakan")}</Badge>}
          {t.status === "DONE" && <Badge tone="green">{tr("Done", "Selesai")}</Badge>}
          {t.status === "CANCELLED" && <Badge tone="slate">{tr("Cancelled", "Dibatalkan")}</Badge>}
        </div>
        <p className="mt-0.5 text-slate-600">
          {tr("Due", "Jatuh tempo")} {t.due_date}{t.period_label ? ` · ${tr("period", "periode")} ${t.period_label}` : ""}
          <span className="text-slate-400"> · {tr("from", "dari")} {t.assigned_by_name}</span>
        </p>
        {t.waits_on_no && t.status === "OPEN" && (
          <p className={`mt-0.5 text-[12px] ${t.waiting ? "text-slate-700" : "text-slate-400"}`}>
            {t.waiting
              ? tr(`Starts after "${t.waits_on_title}" (${t.waits_on_assignee}) — not finished yet.`,
                   `Mulai setelah "${t.waits_on_title}" (${t.waits_on_assignee}) — belum selesai.`)
              : tr(`"${t.waits_on_title}" is finished — you can start.`, `"${t.waits_on_title}" sudah selesai — bisa dimulai.`)}
          </p>
        )}
        {t.deliverable && <p className="mt-0.5 text-[12px] text-slate-500">{tr("Deliverable:", "Diserahkan:")} {t.deliverable}</p>}
        {t.blocked_reason && t.status === "OPEN" && <p className="mt-0.5 text-[12px] text-amber-700">{tr("Blocked:", "Tertahan:")} {t.blocked_reason}</p>}
        {t.delivered_note && t.status === "DONE" && <p className="mt-0.5 text-[12px] text-emerald-800">{t.delivered_note}</p>}
        {t.status === "OPEN" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!t.acknowledged && (
              <Button size="sm" variant="outline" icon={Check} disabled={isBusy} onClick={() => acknowledge(t.task_no)}>
                {tr("Acknowledge", "Terima")}
              </Button>
            )}
            {!t.has_started && (
              <Button size="sm" variant="outline" icon={PlayCircle} disabled={isBusy} onClick={() => run(t, "start")}>
                {tr("Start", "Mulai")}
              </Button>
            )}
            <Button size="sm" variant="outline" icon={PackageCheck} disabled={isBusy} onClick={() => run(t, "done")}>
              {tr("Done & hand over", "Selesai & serahkan")}
            </Button>
            {t.blocked_reason ? (
              <Button size="sm" variant="outline" icon={PlayCircle} disabled={isBusy} onClick={() => run(t, "unblock")}>
                {tr("Resume", "Lanjutkan")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" icon={PauseCircle} disabled={isBusy} onClick={() => run(t, "block")}>
                {tr("Blocked", "Tertahan")}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <Loaded state={tasks} onRetry={reload}>
      {(list) => {
        const mineOpen = list.filter((t) => t.status === "OPEN");
        const closed = list.filter((t) => t.status !== "OPEN").slice(0, 10);
        /* A goal stays on this page while it is open and the reader has any
           part in it, finished or not, or puts it together: somebody whose
           part is done still follows the result to the end — that is what
           *put the parts together* asks of everybody in it. */
        const myGoals = goals.status === "ready"
          ? goals.data.filter((g) => g.is_owner || list.some((t) => t.goal_no === g.goal_no))
          : [];
        const inGoals = new Set(myGoals.map((g) => g.goal_no));
        const loose = mineOpen.filter((t) => !t.goal_no || !inGoals.has(t.goal_no));
        return (
          <div className="space-y-4">
            {list.length === 0 && myGoals.length === 0 && (
              <Card><p className="px-5 py-6 text-[13px] text-slate-500">{tr("No tasks.", "Tidak ada tugas.")}</p></Card>
            )}

            {myGoals.length > 0 && (
              <p className="text-[12px] text-slate-500">
                {tr(
                  "Your work, grouped by the goal it is part of, in the leader's order of priority — #1 first.",
                  "Pekerjaan Anda, dikelompokkan menurut sasaran yang dibentuknya, dalam urutan prioritas pimpinan — #1 lebih dulu.",
                )}
              </p>
            )}

            {myGoals.map((g) => {
              const mine = mineOpen.filter((t) => t.goal_no === g.goal_no);
              return (
                <Card key={g.goal_no}>
                  <div className="flex gap-3 px-5 py-4">
                    <span className="w-9 shrink-0 text-xl font-semibold text-slate-800">#{g.rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-slate-800">
                        {g.title}
                        {g.late && <span className="ml-2 align-middle"><Badge tone="red">{tr("past target", "lewat target")}</Badge></span>}
                      </p>
                      <p className="text-[13px] text-slate-600">{g.outcome}</p>
                      <p className="text-[12px] text-slate-500">
                        {g.is_owner
                          ? tr("You put the parts together", "Anda yang menyatukan bagian-bagiannya")
                          : tr(`Put together by ${g.owner_name}`, `Disatukan oleh ${g.owner_name}`)}
                        {" · "}{tr("target", "target")} {g.target_date}
                      </p>
                      <div className="mt-2"><GoalProgress g={g} /></div>
                    </div>
                  </div>
                  {mine.length === 0 && (
                    <p className="border-t border-slate-100 px-5 py-2.5 text-[12px] text-slate-500">
                      {g.is_owner && g.my_open === 0 && !list.some((t) => t.goal_no === g.goal_no)
                        ? tr("You hold no part of this yourself — you put the parts together.", "Anda tidak memegang bagian sendiri — Anda yang menyatukan bagian-bagiannya.")
                        : tr("Your part is done. The goal is reached when every part is.", "Bagian Anda sudah selesai. Sasarannya tercapai kalau semua bagian selesai.")}
                    </p>
                  )}
                  {mine.length > 0 && (
                    <ul className="divide-y divide-slate-100 border-t border-slate-100">
                      {mine.map((t) => taskLine(t))}
                    </ul>
                  )}
                  <div className="border-t border-slate-100 px-5 py-2">
                    <Button size="sm" variant="ghost" icon={Users}
                      onClick={() => setTeam(team === g.goal_no ? null : g.goal_no)}>
                      {team === g.goal_no
                        ? tr("Hide the other parts", "Sembunyikan bagian lain")
                        : tr(`See all ${g.tasks_total} parts and who holds them`, `Lihat semua ${g.tasks_total} bagian dan pemegangnya`)}
                    </Button>
                  </div>
                  {team === g.goal_no && (
                    <div className="border-t border-slate-100">
                      <GoalBoardList goalNo={g.goal_no} stamp={tasks} />
                    </div>
                  )}
                </Card>
              );
            })}

            {loose.length > 0 && (
              <Card>
                <CardHeader
                  title={myGoals.length > 0 ? tr("Other tasks", "Tugas lain") : tr("My tasks", "Tugas saya")}
                  subtitle={tr(
                    "Not part of a goal — routine work and one-off requests. A blocked task is not counted against you (D261).",
                    "Bukan bagian dari sasaran — pekerjaan rutin dan permintaan sekali jalan. Tugas yang tertahan tidak dihitung merugikan Anda (D261).",
                  )}
                  icon={ClipboardList}
                />
                {/* Already in the board's own order — `queue_rank`, the goal's
                    rank, then due date, computed by `v_task`/`taskViews` alike.
                    Re-sorting here would be a second opinion. */}
                <ul className="divide-y divide-slate-100">
                  {loose.map((t) => taskLine(t))}
                </ul>
              </Card>
            )}

            {closed.length > 0 && (
              <Card>
                <CardHeader title={tr("Recently closed", "Baru ditutup")} icon={Check} />
                <ul className="divide-y divide-slate-100">
                  {closed.map((t) => taskLine(t))}
                </ul>
              </Card>
            )}
            {goals.status === "failed" && (
              <Button size="sm" variant="ghost" onClick={reloadGoals}>{tr("Reload goals", "Muat ulang sasaran")}</Button>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

/* ── Gaji ─────────────────────────────────────────────────────────────── */

function PayslipTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const tr = useTr();
  const [runs, reloadRuns] = useLoad(() => hr.myPayslips(), []);
  const [runNo, setRunNo] = useState<string | null>(null);
  const [slip, reloadSlip] = useLoad(() => (runNo ? hr.myPayslip(runNo) : Promise.resolve({ data: null })), [runNo]);
  const linked = me.status === "ready" ? me.data : null;

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Card>
        <CardHeader title={tr("Period", "Periode")} icon={Wallet} />
        <Loaded state={runs} onRetry={reloadRuns}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No payslip available to read yet.", "Belum ada slip yang bisa dibaca.")}</li>
              )}
              {list.map((r) => (
                <li key={r.run_no}>
                  <button
                    onClick={() => setRunNo(r.run_no)}
                    className={`block w-full px-5 py-2.5 text-left text-[13px] hover:bg-slate-50 ${runNo === r.run_no ? "bg-brand-50 text-brand-700" : "text-slate-700"}`}
                  >
                    {r.period_start} → {r.period_end}
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      {!runNo ? (
        <Card className="flex items-center justify-center px-5 py-16 text-[13px] text-slate-500">
          {tr("Choose a period on the left.", "Pilih periode di sebelah kiri.")}
        </Card>
      ) : (
        <Loaded state={slip} onRetry={reloadSlip}>
          {(line) => !line ? (
            <Card className="px-5 py-16 text-center text-[13px] text-slate-500">
              {tr("No payslip for this period.", "Tidak ada slip untuk periode ini.")}
            </Card>
          ) : (
            <Card>
              <CardHeader title={tr(`Payslip — ${runNo}`, `Slip gaji — ${runNo}`)} subtitle={line.full_name} icon={Wallet} />
              <div className="grid grid-cols-2 gap-4 px-5 py-4 text-[13px] sm:grid-cols-3">
                <Row label={tr("Base", "Pokok")} value={formatIDR(line.base_pay)} />
                <Row label={tr("Allowance", "Tunjangan")} value={formatIDR(line.allowance_pay)} />
                <Row label={tr("Overtime", "Lembur")} value={formatIDR(line.overtime_pay)} />
                <Row label={tr("Gross", "Bruto")} value={formatIDR(line.gross)} />
                <Row label={tr("Adjustments", "Penyesuaian")} value={formatIDR(line.adjustment_total)} />
                <Row label={tr("Net", "Neto")} value={formatIDR(line.net)} bold />
                {line.contribution_total > 0 && <Row label={tr("BPJS deduction", "Potongan BPJS")} value={`− ${formatIDR(line.contribution_total)}`} />}
                <Row label={tr("Take-home", "Diterima")} value={formatIDR(line.take_home)} bold />
              </div>
              {line.adjustments.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3 text-[12px]">
                  <p className="mb-1 font-medium text-slate-700">{tr("Adjustments", "Penyesuaian")}</p>
                  <ul className="space-y-0.5 text-slate-600">
                    {line.adjustments.map((a, i) => (
                      <li key={i}>{a.label}: {formatIDR(a.amount)} — {a.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {line.warnings.length > 0 && (
                <p className="border-t border-slate-100 bg-amber-50/60 px-5 py-2 text-[12px] text-amber-900">
                  {line.warnings.join(" · ")}
                </p>
              )}
              <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400">
                {tr(`${line.days_present} working days`, `${line.days_present} hari kerja`)} ·{" "}
                {line.days_unpaid > 0
                  ? tr(`${line.days_unpaid} unpaid day(s)`, `${line.days_unpaid} hari tidak dibayar`)
                  : tr("no unpaid days", "tidak ada hari tidak dibayar")}.{" "}
                {tr("Tax deduction (PPh 21) is not computed by this system.", "Potongan pajak (PPh 21) tidak dihitung sistem ini.")}
              </p>
            </Card>
          )}
        </Loaded>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className={bold ? "text-base font-semibold text-slate-800" : "text-slate-700"}>{value}</p>
    </div>
  );
}
