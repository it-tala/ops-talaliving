"use client";

import { useState } from "react";
import {
  KeyRound, Activity, Fingerprint, Clock, CalendarClock, ClipboardList, Wallet,
  Check, Plus, AlertTriangle, ShieldAlert,
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
  LEAVE_KIND_LABEL, OVERTIME_STAGE_LABEL, type LeaveKind,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
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

/* ── Tugas ────────────────────────────────────────────────────────────── */

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
  const [busy, setBusy] = useState<string | null>(null);

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

  return (
    <Card>
      <CardHeader
        title={tr("My tasks", "Tugas saya")}
        subtitle={tr(
          "Reminders, and the basis for KPIs — a blocked task is not counted against its person (D261).",
          "Pengingat, dan dasar untuk KPI — tugas yang tertahan tidak dihitung merugikan orangnya (D261).",
        )}
        icon={ClipboardList}
      />
      <Loaded state={tasks} onRetry={reload}>
        {(list) => (
          <ul className="divide-y divide-slate-100">
            {list.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No tasks.", "Tidak ada tugas.")}</li>
            )}
            {/* Already in the board's own order — `queue_rank` then due date,
                computed by `v_task`/`taskViews` alike (0152). Re-sorting here
                would be a second opinion about what to show first. */}
            {list.map((t) => (
              <li key={t.task_no} className="px-5 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-800">{t.title}</span>
                  {t.overdue && <Badge tone="red">{tr("Overdue", "Terlambat")}</Badge>}
                  {t.chase_due && <Badge tone="amber">{tr("Chased today", "Ditagih hari ini")}</Badge>}
                  {t.blocked_reason && <Badge tone="slate">{tr("Blocked", "Tertahan")}</Badge>}
                  {t.status !== "OPEN" && <Badge tone="green">{t.status}</Badge>}
                  {!t.acknowledged && t.status === "OPEN" && (
                    <Button size="sm" variant="outline" icon={Check} disabled={busy === t.task_no} onClick={() => acknowledge(t.task_no)}>
                      {tr("Acknowledge", "Terima")}
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-slate-600">
                  {tr("Due", "Jatuh tempo")} {t.due_date}{t.period_label ? ` · ${tr("period", "periode")} ${t.period_label}` : ""}
                </p>
                {t.deliverable && <p className="mt-0.5 text-[12px] text-slate-500">{tr("Deliverable:", "Diserahkan:")} {t.deliverable}</p>}
                {t.blocked_reason && <p className="mt-0.5 text-[12px] text-amber-700">{tr("Blocked:", "Tertahan:")} {t.blocked_reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Card>
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
