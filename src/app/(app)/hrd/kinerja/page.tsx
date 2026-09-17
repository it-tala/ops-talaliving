"use client";

import { useState } from "react";
import Link from "next/link";
import { Gauge, ListChecks, Plus, Check, Ban, PauseCircle, PlayCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The KPI analyzer and the task tracker — the owner asked for both, and they
 *  are one screen because one is the evidence for the other (D260, D261).
 *
 *  This is the first module in the system that measures **people**, and it is
 *  built defensively for that reason. Three rules hold it together, and each is
 *  here because its opposite would quietly hurt somebody:
 *
 *  - **Unmeasured is not zero.** The office does not use the fingerprint
 *    reader, so punctuality cannot be measured for office staff. A blank is
 *    printed, with the reason, and the weight is redistributed over what could
 *    be measured — not scored 0, and not silently scored 100.
 *  - **A blocked task is not a failure.** It leaves the arithmetic entirely,
 *    because a tracker that punishes people for reporting blockers is one that
 *    stops being told about them.
 *  - **Entitlements are not absences.** Sakit with a letter and cuti out of the
 *    balance come out of the denominator: taking leave you are owed must not
 *    lower your score.
 *
 *  And one limitation printed on every card rather than hidden: production work
 *  is recorded against a **name**, not a person, so none of it reaches the
 *  score. Matching people by string into a performance record is how the wrong
 *  review lands on the wrong person.
 */
export default function KpiPage() {
  const { can } = useSession();
  const { toast } = useToast();
  /* A **period**, not a calendar month.
   *
   *  Performance is reviewed over the period somebody was paid for, and the
   *  payroll run already carries exactly that. It also avoids the thing a month
   *  slider does on real data: attendance arrives in fortnights from the
   *  machine, so a calendar month can hold three days of taps and every measure
   *  falls below its floor — which reads as the screen being broken rather than
   *  as the period being the wrong shape. */
  const [runs] = useLoad(() => hr.listPayrollRuns(), []);
  const latest = runs.status === "ready" && runs.data.length > 0
    ? [...runs.data].sort((a, b) => b.period_end.localeCompare(a.period_end))[0]
    : null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const start = from || latest?.period_start || `${officeToday().slice(0, 7)}-01`;
  const end = to || latest?.period_end || officeToday();
  const [kpi, reloadKpi] = useLoad(
    () => hr.getKpi({ period_start: start, period_end: end }),
    [start, end],
  );
  const [tasks, reloadTasks] = useLoad(() => hr.listTasks(), []);
  const [employees] = useLoad(() => hr.listEmployees(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [who, setWho] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const mayEdit = can("hrd.create");

  async function add() {
    setBusy(true);
    const res = await hr.createTask({ assignee_no: who, title, due_date: due });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak dibuat", res.error.message);
      return;
    }
    toast("success", `${res.data.task_no} dibuat`, `${res.data.assignee_name} · jatuh tempo ${due}`);
    setTitle(""); setDue("");
    reloadTasks(); reloadKpi();
  }

  async function act(taskNo: string, action: "done" | "block" | "unblock" | "cancel") {
    let reason: string | null = null;
    if (action === "block") {
      reason = window.prompt("Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya, jadi alasannya wajib.");
      if (!reason?.trim()) return;
    }
    if (action === "cancel") {
      reason = window.prompt("Kenapa dibatalkan?");
      if (!reason?.trim()) return;
    }
    setBusy(true);
    const res = await hr.updateTask({ task_no: taskNo, action, reason });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", taskNo, action === "done" ? "Selesai" : action === "block" ? "Ditandai tertahan" : action === "unblock" ? "Tidak lagi tertahan" : "Dibatalkan");
    reloadTasks(); reloadKpi();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Kinerja & tugas"
        description="Penilaian dihitung dari yang benar-benar tercatat, dan menolak menilai apa yang datanya tidak ada. Tiap ukuran menyebut sumbernya dan atas berapa hari ia dihitung, supaya angkanya bisa dibantah — bukan hanya dipercaya."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date" value={start} onChange={(e) => setFrom(e.target.value)}
              aria-label="Periode mulai"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date" value={end} onChange={(e) => setTo(e.target.value)}
              aria-label="Periode sampai"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            {latest && (start !== latest.period_start || end !== latest.period_end) && (
              <Button size="sm" variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>
                Periode gajian terakhir
              </Button>
            )}
            <SourceBadge state={kpi} />
          </div>
        }
      />

      <Loaded state={kpi} onRetry={reloadKpi}>
        {(rows) => {
          const scored = rows.filter((r) => r.score !== null);
          const unscored = rows.length - scored.length;
          return (
            <>
              <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
                <strong>{scored.length} dari {rows.length} orang punya nilai gabungan</strong> untuk{" "}
                <span className="font-mono">{start} → {end}</span>.
                Sisanya <strong>bukan bernilai rendah</strong> — datanya belum cukup untuk dinilai, dan
                kartunya menyebutkan ukuran mana yang tidak bisa dihitung dan kenapa. Pekerjaan di papan
                produksi tercatat atas nama, belum tertaut ke karyawan, jadi belum masuk ke penilaian
                mana pun.
              </p>

              <div className="mb-4 grid gap-3 lg:grid-cols-2">
                {rows.map((r) => (
                  <Card key={r.employee_id}>
                    <CardHeader
                      title={r.full_name}
                      subtitle={`${r.position} · ${r.unit}`}
                      icon={Gauge}
                      action={
                        <div className="text-right">
                          {r.score === null ? (
                            <Badge tone="slate">belum dinilai</Badge>
                          ) : (
                            <span className={cn(
                              "text-xl font-bold tabular-nums",
                              r.score >= 90 ? "text-emerald-700" : r.score >= 75 ? "text-slate-800" : "text-amber-700",
                            )}>
                              {r.score}
                            </span>
                          )}
                          <span className="block text-[10px] text-slate-400">
                            {r.measured_count} dari {r.measure_count} ukuran
                          </span>
                        </div>
                      }
                    />
                    <ul className="divide-y divide-slate-100">
                      {r.measures.map((m) => (
                        <li key={m.key} className="px-5 py-2 text-[13px]">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className="min-w-[150px] flex-1 text-slate-700">{m.label}</span>
                            <span className="text-[11px] text-slate-400">bobot {m.weight}%</span>
                            {m.value === null ? (
                              <span className="text-[12px] text-slate-400">tidak terukur</span>
                            ) : (
                              <span className={cn("w-12 text-right font-semibold tabular-nums",
                                m.value >= 90 ? "text-emerald-700" : m.value >= 75 ? "text-slate-700" : "text-amber-700")}>
                                {m.value}%
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {m.value === null ? m.unmeasured_reason : m.basis}
                          </p>
                          <p className="text-[10px] text-slate-400">sumber: {m.source}</p>
                        </li>
                      ))}
                    </ul>
                    {/* The deliverable half of what the owner asked for, beside
                        the scores and never inside them: pieces of different
                        products do not add up, so this is evidence, not a
                        figure (D264). */}
                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-[12px]">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Hasil produksi</p>
                      {r.work ? (
                        <>
                          <p className="text-slate-700">
                            {formatNumber(r.work.qty)} pcs dalam {r.work.entries} entri ·{" "}
                            {r.work.by_stage.map((st) => `${st.name} ${st.qty}`).join(" · ")}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {r.work.work_orders.map((w) => `${w.wo_no} ${w.product_name}`).join(" · ")}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            tidak dinilai — satu lemari dan satu nakas tidak bisa dijumlahkan
                          </p>
                        </>
                      ) : (
                        <p className="text-slate-500">
                          Belum ada pekerjaan produksi yang tertaut ke orang ini.
                          {r.work_attribution.unknown > 0 && (
                            <>
                              {" "}
                              <span className="text-amber-700">
                                {r.work_attribution.unknown} entri periode ini masih atas nama yang belum
                                ditautkan
                              </span>{" "}
                              — kosong di sini belum tentu berarti tidak mengerjakan apa pun.
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                      {r.score_reason && <p className="text-slate-600">{r.score_reason}</p>}
                      <p>
                        Lembur {formatNumber(r.overtime_hours)} jam — ditampilkan sebagai konteks,{" "}
                        <strong>tidak dinilai</strong>: angka yang naik saat orang pulang malam
                        mengajarkan hal yang salah.
                      </p>
                      {r.tasks_blocked > 0 && (
                        <p className="text-amber-700">
                          {r.tasks_blocked} tugas tertahan menunggu pihak lain — tidak dihitung sebagai
                          kegagalannya.
                        </p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>

              {rows[0] && rows[0].work_attribution.unknown > 0 && (
                <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  <strong>
                    {rows[0].work_attribution.coverage}% entri produksi periode ini sudah jelas siapa yang
                    mengerjakan
                  </strong>{" "}
                  ({rows[0].work_attribution.employee} tertaut ke karyawan,{" "}
                  {rows[0].work_attribution.not_a_person} ditandai bukan satu orang,{" "}
                  {rows[0].work_attribution.unknown} belum dijawab). Selama masih ada yang belum dijawab,
                  kolom hasil produksi yang kosong tidak bisa dibaca sebagai nol.{" "}
                  <Link href="/produksi/penautan" className="font-medium underline">
                    Tautkan namanya
                  </Link>
                  .
                </p>
              )}

              {unscored > 0 && (
                <p className="mb-4 text-[12px] text-slate-500">
                  Nilai gabungan baru muncul setelah cukup banyak ukuran bisa dihitung. Ambangnya ada di
                  pengaturan, begitu juga bobot tiap ukuran.
                </p>
              )}
            </>
          );
        }}
      </Loaded>

      <Loaded state={tasks} onRetry={reloadTasks}>
        {(rows) => (
          <Card>
            <CardHeader
              title={`Task tracker — ${rows.filter((t) => t.status === "OPEN").length} terbuka`}
              subtitle="Terlambat dulu, lalu yang tertahan, lalu menurut tanggal. Yang tertahan berwarna lain karena ia menunggu orang lain, bukan pemiliknya."
              icon={ListChecks}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 text-left">Tugas</th>
                    <th className="px-4 py-2 text-left">Untuk</th>
                    <th className="px-4 py-2 text-left">Jatuh tempo</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    {mayEdit && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className={cn(
                      "border-b border-slate-100",
                      t.status !== "OPEN" && "opacity-60",
                      t.blocked_reason && "bg-violet-50/40",
                    )}>
                      <td className="px-4 py-2">
                        <span className="block text-slate-800">{t.title}</span>
                        <span className="block font-mono text-[10px] text-slate-400">{t.task_no}</span>
                        {t.detail && <span className="block text-[11px] text-slate-500">{t.detail}</span>}
                        {t.blocked_reason && (
                          <span className="block text-[11px] text-violet-800">
                            Tertahan: {t.blocked_reason}
                          </span>
                        )}
                        {t.cancelled_reason && (
                          <span className="block text-[11px] text-slate-500">Dibatalkan: {t.cancelled_reason}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {t.assignee_name}
                        <span className="block font-mono text-[10px] text-slate-400">{t.assignee_no}</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                        {t.due_date}
                        {t.status === "OPEN" && !t.blocked_reason && t.days_left >= 0 && (
                          <span className="block text-[10px] text-slate-400">{t.days_left} hari lagi</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {t.status === "CANCELLED" ? <Badge tone="slate">dibatalkan</Badge>
                          : t.status === "DONE" ? (
                            <Badge tone={t.late ? "amber" : "green"}>
                              {t.late ? `selesai telat ${-(t.days_early ?? 0)} hari` : "selesai tepat waktu"}
                            </Badge>
                          ) : t.blocked_reason ? <Badge tone="violet">tertahan</Badge>
                            : t.overdue ? <Badge tone="red" dot>lewat {-t.days_left} hari</Badge>
                              : <Badge tone="slate">terbuka</Badge>}
                      </td>
                      {mayEdit && (
                        <td className="px-4 py-2">
                          {t.status === "OPEN" && (
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button size="sm" variant="outline" icon={Check} disabled={busy}
                                onClick={() => act(t.task_no, "done")}>Selesai</Button>
                              {t.blocked_reason ? (
                                <Button size="sm" variant="ghost" icon={PlayCircle} disabled={busy}
                                  onClick={() => act(t.task_no, "unblock")}>Lanjut</Button>
                              ) : (
                                <Button size="sm" variant="ghost" icon={PauseCircle} disabled={busy}
                                  onClick={() => act(t.task_no, "block")}>Tertahan</Button>
                              )}
                              <Button size="sm" variant="ghost" icon={Ban} disabled={busy}
                                onClick={() => act(t.task_no, "cancel")}>Batal</Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mayEdit && (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Plus className="h-4 w-4 text-slate-400" /> Tugas baru
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[220px_1fr_160px_auto]">
                  <Loaded state={employees} skeletonRows={1}>
                    {(emps) => (
                      <select
                        value={who} onChange={(e) => setWho(e.target.value)}
                        aria-label="Untuk siapa"
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">Untuk siapa…</option>
                        {emps.filter((e) => e.active).map((e) => (
                          <option key={e.id} value={e.employee_no}>{e.full_name}</option>
                        ))}
                      </select>
                    )}
                  </Loaded>
                  <input
                    value={title} onChange={(e) => setTitle(e.target.value)}
                    placeholder="Apa yang harus dikerjakan"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <input
                    type="date" value={due} onChange={(e) => setDue(e.target.value)}
                    aria-label="Jatuh tempo"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button size="sm" disabled={busy || !who || !title.trim() || !due} onClick={add}>
                    Tugaskan
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </Loaded>
    </div>
  );
}
