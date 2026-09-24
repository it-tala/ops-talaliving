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
import { formatIDR, formatNumber } from "@/lib/format";
import { hr, identity } from "@/demo/api";
import {
  LEAVE_KIND_LABEL, OVERTIME_STAGE_LABEL, type LeaveKind,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The profile every account owns (W7) — a different object from every other
 *  screen in this system, because it is the one screen where "which rows may
 *  this account see" is answered by an account-to-employee link rather than
 *  by a module grant (0152, 0155–0158). Reset a password, read a personal
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

  return (
    <div>
      <PageHeader
        breadcrumb="Profil"
        title={session?.user.full_name ?? "Profil saya"}
        description={session?.user.email}
      />

      <Card>
        <Tabs
          defaultId="keamanan"
          items={[
            { id: "keamanan", label: "Keamanan", content: <SecurityTab /> },
            { id: "aktivitas", label: "Aktivitas", content: <ActivityTab /> },
            { id: "presensi", label: "Presensi", content: <AttendanceTab me={me} /> },
            { id: "lembur", label: "Lembur", content: <OvertimeTab me={me} /> },
            { id: "cuti", label: "Cuti & izin", content: <LeaveTab me={me} /> },
            { id: "tugas", label: "Tugas", content: <TasksTab me={me} /> },
            { id: "gaji", label: "Gaji", content: <PayslipTab me={me} /> },
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
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Akun ini belum tertaut ke data karyawan"
      description="Kebanyakan akun kantor dan kepemimpinan memang begitu — presensi, lembur, cuti dan gaji tidak punya baris untuk ditampilkan. Minta HRD menautkan akun ini kalau seharusnya ada."
    />
  );
}

/* ── Keamanan ─────────────────────────────────────────────────────────── */

function SecurityTab() {
  const { session } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function sendReset() {
    if (!session?.user.email) return;
    setBusy(true);
    const res = await identity.requestPasswordReset(session.user.email);
    setBusy(false);
    if (res.error) {
      toast("warning", "Tidak terkirim", res.error.message);
      return;
    }
    toast(
      "success", "Tautan terkirim",
      `Kalau ${session.user.email} punya akun di sini, sebuah tautan sudah dikirim ke alamat itu.`,
    );
  }

  return (
    <Card>
      <CardHeader
        title="Kata sandi"
        subtitle="Sebuah tautan dikirim ke alamat email akun ini sendiri — tidak ada kata sandi yang diketik di sini."
        icon={KeyRound}
      />
      <div className="px-5 py-4">
        <p className="text-sm text-slate-600">
          Masuk: <span className="font-medium text-slate-800">{session?.user.email}</span>
        </p>
        <Button className="mt-3" icon={KeyRound} disabled={busy} onClick={sendReset}>
          {busy ? "Mengirim…" : "Kirim tautan ganti kata sandi"}
        </Button>
      </div>
    </Card>
  );
}

/* ── Aktivitas ────────────────────────────────────────────────────────── */

function ActivityTab() {
  const [rows, reload] = useLoad(() => identity.listMyActivity(), []);
  return (
    <Card>
      <CardHeader
        title="Aktivitas terakhir"
        subtitle="Yang tercatat tentang tindakan akun ini sendiri — masuk, ganti kata sandi, tap presensi, pengajuan. Bukan jejak audit IT: itu dibaca IT dan pimpinan, bukan pemiliknya sendiri."
        icon={Activity}
      />
      <Loaded state={rows} onRetry={reload}>
        {(list) => (
          <ul className="divide-y divide-slate-100">
            {list.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada aktivitas tercatat.</li>
            )}
            {list.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="w-[130px] shrink-0 font-mono text-[11px] text-slate-400">
                  {r.at.slice(0, 16).replace("T", " ")}
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function AttendanceTab({ me }: { me: ReturnType<typeof useLoad<Awaited<ReturnType<typeof hr.myProfile>>["data"]>>[0] }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const linked = me.status === "ready" ? me.data : null;
  const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const [days, reloadDays] = useLoad(
    () => (linked ? hr.attendanceFor({ employee_no: linked.employee_no, from, to: todayIso() })
                  : Promise.resolve({ data: [] })),
    [linked?.employee_no],
  );

  async function tap() {
    setBusy(true);
    const res = await hr.tapSelf();
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Tap tercatat", `Pukul ${res.data.at.slice(11, 16)}.`);
    reloadDays();
  }

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <Card>
      <CardHeader
        title="Presensi"
        subtitle="Tap dari sesi ini sendiri, bukan dari mesin di pintu — satu tap seperti tap lainnya. Yang menentukan masuk atau pulang adalah bacaan hari itu, bukan tombolnya."
        icon={Fingerprint}
        action={<Button icon={Fingerprint} disabled={busy} onClick={tap}>{busy ? "Mencatat…" : "Tap presensi"}</Button>}
      />
      <Loaded state={days} onRetry={reloadDays}>
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada presensi 14 hari terakhir.</li>
            )}
            {rows.map((d) => (
              <li key={d.work_date} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[13px]">
                <span className="w-[92px] font-medium text-slate-800">{d.work_date}</span>
                <Badge tone={d.state === "review" ? "amber" : d.state === "complete" ? "green" : "slate"}>
                  {d.state}
                </Badge>
                <span className="text-slate-600">
                  {d.scans.length === 0 ? "tidak ada tap" : `${d.scans.length} tap · ${formatNumber(d.work_hours)} jam kerja`}
                </span>
                {d.overtime_hours > 0 && <span className="text-brand-700">+{formatNumber(d.overtime_hours)} jam lembur</span>}
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
  const { toast } = useToast();
  const [sheets, reload] = useLoad(() => hr.myOvertimeSheets(), []);
  const [draft, setDraft] = useState({ work_date: todayIso(), hours: "", result_note: "", task: "" });
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const linked = me.status === "ready" ? me.data : null;

  async function submit() {
    setBusy(true);
    const res = await hr.reportOvertimeSelf({
      work_date: draft.work_date, hours: Number(draft.hours),
      result_note: draft.result_note, task: draft.task || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", `${res.data.sheet_no} tercatat`, "Lampirkan bukti tangkapan layar di bawah, lalu tunggu HRD.");
    setJustCreated(res.data.sheet_no);
    setDraft({ work_date: todayIso(), hours: "", result_note: "", task: "" });
    reload();
  }

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Ajukan lembur"
          subtitle="Durasi, dan hasil kerja yang dicapai — HRD memutuskan dari kalimat ini, bukan dari jam saja. Lembur staf dibayar secara bawaan (HRD bisa mengubahnya)."
          icon={CalendarClock}
        />
        <div className="px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-[140px_100px_1fr]">
            <input
              type="date" value={draft.work_date} max={todayIso()}
              onChange={(e) => setDraft({ ...draft, work_date: e.target.value })}
              aria-label="Tanggal"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <input
              type="number" min={0.5} max={12} step={0.5} value={draft.hours}
              onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
              placeholder="Jam" aria-label="Jam"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <input
              value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}
              placeholder="Tugas (opsional)"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <textarea
            value={draft.result_note} onChange={(e) => setDraft({ ...draft, result_note: e.target.value })}
            placeholder="Hasil kerja — apa yang selesai selama lembur ini"
            rows={2}
            className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
          />
          <Button
            className="mt-2" size="sm" icon={Plus} disabled={busy || !draft.hours || !draft.result_note.trim()}
            onClick={submit}
          >
            {busy ? "Menyimpan…" : "Ajukan"}
          </Button>
        </div>
      </Card>

      {justCreated && (
        <Card>
          <CardHeader title="Bukti tangkapan layar" subtitle={justCreated} icon={Plus} />
          <EvidenceStrip
            entity="overtime"
            entityNo={justCreated}
            canEdit
            defaultKind="Laporan Lembur"
            slots={[{ kind: "Laporan Lembur", label: "Bukti tangkapan layar / hasil kerja" }]}
            onChanged={reload}
          />
        </Card>
      )}

      <Card>
        <CardHeader title="Riwayat lembur saya" icon={Clock} />
        <Loaded state={sheets} onRetry={reload}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada lembur yang diajukan.</li>
              )}
              {list.map((s) => {
                const mine = s.lines[0];
                return (
                  <li key={s.sheet_no} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="font-medium text-slate-800">{s.work_date}</span>
                      <span className="text-slate-600">{formatNumber(mine?.hours ?? 0)} jam</span>
                      <Badge tone={s.payable ? "green" : s.stage === "declined" ? "red" : "slate"}>
                        {OVERTIME_STAGE_LABEL[s.stage]}
                      </Badge>
                      <span className="font-mono text-[10px] text-slate-400">{s.sheet_no}</span>
                    </div>
                    {mine?.result_note && <p className="mt-1 text-[12px] text-slate-600">{mine.result_note}</p>}
                    {!s.evidence && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> Belum ada bukti dilampirkan.
                      </p>
                    )}
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
      toast(res.error.status === 409 ? "warning" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", `${res.data.request_no} tercatat`, `${res.data.days} hari, menunggu keputusan HRD.`);
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
            <CardHeader title="Jatah cuti saya" icon={CalendarClock} />
            <div className="grid grid-cols-2 gap-4 px-5 py-4 text-[13px] sm:grid-cols-4">
              <div><p className="text-slate-500">Jatah</p><p className="text-lg font-semibold text-slate-800">{b.entitlement} hari</p></div>
              <div><p className="text-slate-500">Terpakai</p><p className="text-lg font-semibold text-slate-800">{b.taken} hari</p></div>
              <div><p className="text-slate-500">Sudah disetujui</p><p className="text-lg font-semibold text-slate-800">{b.booked} hari</p></div>
              <div>
                <p className="text-slate-500">Sisa</p>
                <p className={`text-lg font-semibold ${b.remaining === 0 ? "text-amber-700" : "text-slate-800"}`}>{b.remaining} hari</p>
              </div>
            </div>
            {b.over > 0 && (
              <p className="border-t border-slate-100 bg-amber-50/60 px-5 py-2 text-[12px] text-amber-900">
                {b.over} hari terpakai di luar jatah — tercatat, tidak dibayar.
              </p>
            )}
          </Card>
        )}
      </Loaded>

      <Card>
        <CardHeader title="Ajukan cuti / izin" subtitle="Satu rentang tanggal, satu alasan — itu yang dibaca saat diputuskan." icon={Plus} />
        <div className="px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-[130px_150px_150px]">
            <select
              value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LeaveKind })}
              aria-label="Jenis"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {(Object.keys(LEAVE_KIND_LABEL) as LeaveKind[]).map((k) => (
                <option key={k} value={k}>{LEAVE_KIND_LABEL[k]}</option>
              ))}
            </select>
            <input
              type="date" value={draft.from_date} onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
              aria-label="Dari tanggal"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <input
              type="date" value={draft.to_date} onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
              aria-label="Sampai tanggal"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Alasan"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <Button size="sm" disabled={busy || !draft.from_date || !draft.reason.trim()} onClick={file}>
              {busy ? "Menyimpan…" : "Ajukan"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Riwayat pengajuan saya" icon={Clock} />
        <Loaded state={requests} onRetry={reloadRequests}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada pengajuan.</li>
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
      toast("warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Diterima", `${taskNo} ditandai diterima.`);
    reload();
  }

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <Card>
      <CardHeader
        title="Tugas saya"
        subtitle="Pengingat, dan dasar untuk KPI — tugas yang tertahan tidak dihitung merugikan orangnya (D261)."
        icon={ClipboardList}
      />
      <Loaded state={tasks} onRetry={reload}>
        {(list) => (
          <ul className="divide-y divide-slate-100">
            {list.length === 0 && (
              <li className="px-5 py-6 text-[13px] text-slate-500">Tidak ada tugas.</li>
            )}
            {/* Already in the board's own order — `queue_rank` then due date,
                computed by `v_task`/`taskViews` alike (0152). Re-sorting here
                would be a second opinion about what to show first. */}
            {list.map((t) => (
              <li key={t.task_no} className="px-5 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-800">{t.title}</span>
                  {t.overdue && <Badge tone="red">Terlambat</Badge>}
                  {t.chase_due && <Badge tone="amber">Ditagih hari ini</Badge>}
                  {t.blocked_reason && <Badge tone="slate">Tertahan</Badge>}
                  {t.status !== "OPEN" && <Badge tone="green">{t.status}</Badge>}
                  {!t.acknowledged && t.status === "OPEN" && (
                    <Button size="sm" variant="outline" icon={Check} disabled={busy === t.task_no} onClick={() => acknowledge(t.task_no)}>
                      Terima
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-slate-600">
                  Jatuh tempo {t.due_date}{t.period_label ? ` · periode ${t.period_label}` : ""}
                </p>
                {t.deliverable && <p className="mt-0.5 text-[12px] text-slate-500">Diserahkan: {t.deliverable}</p>}
                {t.blocked_reason && <p className="mt-0.5 text-[12px] text-amber-700">Tertahan: {t.blocked_reason}</p>}
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
  const [runs, reloadRuns] = useLoad(() => hr.myPayslips(), []);
  const [runNo, setRunNo] = useState<string | null>(null);
  const [slip, reloadSlip] = useLoad(() => (runNo ? hr.myPayslip(runNo) : Promise.resolve({ data: null })), [runNo]);
  const linked = me.status === "ready" ? me.data : null;

  if (me.status === "loading") return null;
  if (!linked) return <NoEmployeeLink />;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Card>
        <CardHeader title="Periode" icon={Wallet} />
        <Loaded state={runs} onRetry={reloadRuns}>
          {(list) => (
            <ul className="divide-y divide-slate-100">
              {list.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada slip yang bisa dibaca.</li>
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
          Pilih periode di sebelah kiri.
        </Card>
      ) : (
        <Loaded state={slip} onRetry={reloadSlip}>
          {(line) => !line ? (
            <Card className="px-5 py-16 text-center text-[13px] text-slate-500">
              Tidak ada slip untuk periode ini.
            </Card>
          ) : (
            <Card>
              <CardHeader title={`Slip gaji — ${runNo}`} subtitle={line.full_name} icon={Wallet} />
              <div className="grid grid-cols-2 gap-4 px-5 py-4 text-[13px] sm:grid-cols-3">
                <Row label="Pokok" value={formatIDR(line.base_pay)} />
                <Row label="Tunjangan" value={formatIDR(line.allowance_pay)} />
                <Row label="Lembur" value={formatIDR(line.overtime_pay)} />
                <Row label="Bruto" value={formatIDR(line.gross)} />
                <Row label="Penyesuaian" value={formatIDR(line.adjustment_total)} />
                <Row label="Neto" value={formatIDR(line.net)} bold />
                {line.contribution_total > 0 && <Row label="Potongan BPJS" value={`− ${formatIDR(line.contribution_total)}`} />}
                <Row label="Diterima" value={formatIDR(line.take_home)} bold />
              </div>
              {line.adjustments.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3 text-[12px]">
                  <p className="mb-1 font-medium text-slate-700">Penyesuaian</p>
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
                {line.days_present} hari kerja · {line.days_unpaid > 0 ? `${line.days_unpaid} hari tidak dibayar` : "tidak ada hari tidak dibayar"}.
                Potongan pajak (PPh 21) tidak dihitung sistem ini.
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
