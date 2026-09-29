"use client";

import { useState } from "react";
import { Check, Inbox, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { EvidenceStrip } from "@/components/ui/evidence-strip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { OvertimeDecider, SelfOvertimeView } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { useDayLabel } from "../../saya/shared";
import { useDecisionLine, useOvertimeStatus } from "../../saya/overtime-ask";

/** Overtime the employees asked for themselves, and the one decision each
 *  one gets (D333).
 *
 *  **HRD or leadership — either, not both.** HRD decides with `hrd.update`;
 *  leadership with the `approve_overtime` authority it already signs
 *  production sheets with, which is why the queue lives here, where
 *  leadership already approves overtime, and why this card is shown to an
 *  account that holds only that authority. The rows come from
 *  `self_overtime_queue()`, which carries the names a leader with no HR module
 *  could not otherwise read.
 *
 *  What the decider reads is what the ask is: what it was for, what came of it,
 *  the photos. An ask with no result yet can be declined but not approved —
 *  the seam says so too. The caller's own ask is listed and never decidable. */
export function SelfQueue({ onChanged }: { onChanged?: () => void }) {
  const tr = useTr();
  const [rows, reload] = useLoad(() => hr.listSelfOvertime(), []);
  const [showDone, setShowDone] = useState(false);

  function changed() { reload(); onChanged?.(); }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Asked for by employees", "Diajukan karyawan")}
        subtitle={tr(
          "Overtime sent from the phone. HRD or leadership approves it — only approved hours reach a payslip.",
          "Lembur yang dikirim dari HP. HRD atau pimpinan yang menyetujui — hanya jam yang disetujui masuk slip gaji.",
        )}
        icon={Inbox}
        action={<SourceBadge state={rows} />}
      />
      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const waiting = all.filter((r) => r.stage === "waiting_hrd");
          const done = all.filter((r) => r.stage !== "waiting_hrd");
          return (
            <>
              <ul className="divide-y divide-slate-100">
                {waiting.length === 0 && (
                  <li className="px-5 py-6 text-[13px] text-slate-500">
                    {tr("Nothing waiting for a decision.", "Tidak ada yang menunggu keputusan.")}
                  </li>
                )}
                {waiting.map((r) => <AskRow key={r.sheet_no} row={r} onDone={changed} />)}
              </ul>
              {done.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-2">
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    className="text-[12px] font-medium text-brand-700 hover:underline"
                  >
                    {showDone
                      ? tr("Hide decided", "Sembunyikan yang sudah diputuskan")
                      : tr(`Show ${done.length} decided`, `Tampilkan ${done.length} yang sudah diputuskan`)}
                  </button>
                </div>
              )}
              {showDone && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {done.slice(0, 20).map((r) => <AskRow key={r.sheet_no} row={r} onDone={changed} />)}
                </ul>
              )}
            </>
          );
        }}
      </Loaded>
    </Card>
  );
}

function AskRow({ row: r, onDone }: { row: SelfOvertimeView; onDone: () => void }) {
  const tr = useTr();
  const day = useDayLabel();
  const status = useOvertimeStatus()({ via: "self", ...r });
  const decision = useDecisionLine()(r);
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[14px] font-medium text-slate-800">{r.full_name}</span>
        <span className="font-mono text-[11px] text-slate-400">{r.employee_no}</span>
        <span className="text-[13px] text-slate-600">
          {day(r.work_date)} · {tr(`${formatNumber(r.hours)} hours`, `${formatNumber(r.hours)} jam`)}
        </span>
        <Badge className="ml-auto" tone={status.tone} dot>{status.label}</Badge>
      </div>
      <dl className="mt-2 grid gap-1 text-[13px] sm:grid-cols-[110px_1fr]">
        <dt className="text-slate-500">{tr("Deliverable", "Deliverable")}</dt>
        <dd className="text-slate-800">{r.deliverable ?? "—"}</dd>
        <dt className="text-slate-500">{tr("Result", "Hasil")}</dt>
        <dd className={cn(r.result_note ? "text-slate-800" : "text-amber-700")}>
          {r.result_note ?? tr("Not written yet", "Belum ditulis")}
        </dd>
        {r.task && (
          <>
            <dt className="text-slate-500">{tr("Task", "Tugas")}</dt>
            <dd className="text-slate-700">{r.task}</dd>
          </>
        )}
      </dl>
      <div className="mt-2">
        <EvidenceStrip entity="overtime" entityNo={r.sheet_no} canEdit={false} />
      </div>
      {decision ? (
        <p className="mt-2 text-[12px] text-slate-500">
          {decision}{r.decision_note ? ` — ${r.decision_note}` : ""}
        </p>
      ) : (
        <DecideAsk sheetNo={r.sheet_no} hasResult={!!r.result_note} mine={r.mine} onDone={onDone} />
      )}
      <p className="mt-1 font-mono text-[10px] text-slate-400">{r.sheet_no}</p>
    </li>
  );
}

/** Approve or decline one ask, with a note. Shared by the queue and the sheet
 *  drawer so an ask has one set of buttons wherever it is opened. */
export function DecideAsk({
  sheetNo, hasResult, mine, onDone,
}: {
  sheetNo: string;
  hasResult: boolean;
  mine: boolean;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const { can, hasAuthority } = useSession();
  const mayHrd = can("hrd.update");
  const mayLeader = hasAuthority("approve_overtime");
  const [as, setAs] = useState<OvertimeDecider>(mayHrd ? "hrd" : "leader");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!mayHrd && !mayLeader) return null;
  if (mine) {
    return (
      <p className="mt-2 text-[12px] text-slate-500">
        {tr("Your own overtime — another HRD or leadership account decides it.", "Lembur Anda sendiri — HRD atau pimpinan yang lain yang memutuskan.")}
      </p>
    );
  }

  async function decide(approved: boolean) {
    setBusy(true);
    const res = await hr.decideSelfOvertime({ sheet_no: sheetNo, approved, note: note.trim() || null, as });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not decided", "Belum diputuskan"), res.error.message);
      return;
    }
    toast("success",
      approved ? tr("Approved", "Disetujui") : tr("Declined", "Ditolak"),
      tr(`${sheetNo} · as ${as === "hrd" ? "HRD" : "leadership"}`, `${sheetNo} · sebagai ${as === "hrd" ? "HRD" : "pimpinan"}`));
    setNote("");
    onDone();
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 px-3 py-3">
      {mayHrd && mayLeader && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-600">
          <span>{tr("Deciding as", "Memutuskan sebagai")}</span>
          {(["hrd", "leader"] as const).map((k) => (
            <button
              key={k} onClick={() => setAs(k)}
              className={cn(
                "rounded-lg border px-2 py-0.5",
                as === k ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600",
              )}
            >
              {k === "hrd" ? "HRD" : tr("Leadership", "Pimpinan")}
            </button>
          ))}
        </div>
      )}
      <input
        value={note} onChange={(e) => setNote(e.target.value)}
        aria-label={tr("Note", "Catatan")}
        placeholder={tr("Note — required to decline, read by the employee.", "Catatan — wajib kalau menolak, dibaca karyawannya.")}
        className="h-10 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {!hasResult && (
          <span className="mr-auto text-[11px] text-amber-700">
            {tr("No result yet — it can be declined, not approved.", "Belum ada hasil — bisa ditolak, belum bisa disetujui.")}
          </span>
        )}
        <Button size="sm" variant="ghost" icon={X} disabled={busy || !note.trim()} onClick={() => decide(false)}>
          {tr("Decline", "Tolak")}
        </Button>
        <Button size="sm" icon={Check} disabled={busy || !hasResult} onClick={() => decide(true)}>
          {tr("Approve", "Setujui")}
        </Button>
      </div>
    </div>
  );
}
