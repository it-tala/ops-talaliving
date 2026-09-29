"use client";

import { useRef, useState } from "react";
import { Check, FileText, Factory, Paperclip, Upload, X } from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { documents, hr, production } from "@/demo/api";
import {
  OVERTIME_KIND_LABEL, OVERTIME_STAGE_LABEL, type OvertimeSheetView,
} from "@/services/hr/contracts";
import { STAGE_NAME } from "@/services/production/contracts";
import { ImportForm } from "./ImportForm";
import { DecideAsk } from "./SelfQueue";
import { useDecisionLine } from "../../saya/overtime-ask";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One sheet, in full — and the one place the two kinds visibly differ.
 *
 *  A production sheet shows the production facts beside each name, and signing
 *  it does two things at once: it pays the hours **and** it moves the work
 *  order on the production board (D147). That second half is composed here, at
 *  the screen, because `hr` and `production` may not reach into each other
 *  (ADR-004) — the sheet number travels with the posting, so a repeat is a
 *  no-op rather than a second set of doors.
 *
 *  A staff sheet shows the report and one decision: paid, or not paid with a
 *  reason. It never waits for leadership (D146).
 */
export function SheetDrawer({
  sheetNo, onClose, onChanged,
}: {
  sheetNo: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can, hasAuthority, session } = useSession();
  const decisionLine = useDecisionLine();
  const { toast } = useToast();
  const tr = useTr();
  const [sheet, reload] = useLoad(() => hr.getOvertimeSheet(sheetNo), [sheetNo]);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mayHrd = can("hrd.update");
  const mayLeader = hasAuthority("approve_overtime");

  function after(title: string, message: string) {
    toast("success", title, message);
    reload();
    onChanged();
  }

  async function attach(f: File, kind: string) {
    setBusy(true);
    const up = await documents.upload({ file: f, kind: "Laporan Lembur" });
    if (up.error) { setBusy(false); toast("critical", tr("Upload failed", "Upload gagal"), up.error.message); return; }
    const res = await hr.attachOvertimeDoc({ sheet_no: sheetNo, attachment_id: up.data.id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not attached", "Tidak terlampir"), res.error.message); return; }
    after(tr(`${kind} attached`, `${kind} terlampir`), f.name);
  }

  /** Signing a production sheet also reports the work.
   *
   *  Lines are summed per order and stage first: two people finishing the same
   *  three doors is one report of three, not two reports that happen to share
   *  an idempotency key. */
  async function postProduction(s: OvertimeSheetView) {
    const byStage = new Map<string, { wo_no: string; stage: string; qty: number; who: string[] }>();
    for (const l of s.lines) {
      if (!l.wo_no || !l.stage || !l.qty_done) continue;
      const key = `${l.wo_no}|${l.stage}`;
      const found = byStage.get(key) ?? { wo_no: l.wo_no, stage: l.stage, qty: 0, who: [] };
      found.qty += l.qty_done;
      found.who.push(l.full_name);
      byStage.set(key, found);
    }
    if (byStage.size === 0) return;

    const failed: string[] = [];
    for (const p of byStage.values()) {
      const res = await production.recordProgress({
        wo_no: p.wo_no, stage: p.stage, qty: p.qty,
        work_date: s.work_date,
        worked_by: p.who.join(", "),
        source: "overtime_sheet", source_ref: s.sheet_no,
        note: `Lembur ${s.sheet_no}`,
      });
      if (res.error) failed.push(`${p.wo_no} · ${STAGE_NAME(p.stage)}: ${res.error.message}`);
    }
    if (failed.length > 0) {
      toast("warning", tr("Some did not reach the production board", "Sebagian tidak masuk papan produksi"), failed[0]);
    } else {
      toast(
        "success",
        tr(`${byStage.size} reports on the production board`, `${byStage.size} laporan masuk papan produksi`),
        tr("This signature is also the production report.", "Tanda tangan ini sekaligus laporan produksinya."),
      );
    }
  }

  async function decide(s: OvertimeSheetView, step: "hrd" | "leader", approved: boolean) {
    if (!approved && !reason.trim()) {
      toast("warning", tr("Reason needed", "Butuh alasan"), tr("Refusing overtime that was already worked needs one sentence.", "Menolak lembur yang sudah dikerjakan butuh satu kalimat."));
      return;
    }
    setBusy(true);
    const res = await hr.decideOvertimeSheet({
      sheet_no: sheetNo, step, approved, reason: approved ? null : reason,
    });
    if (res.error) {
      setBusy(false);
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not decided", "Belum diputuskan"), res.error.message);
      return;
    }
    if (approved && step === "leader" && s.kind === "production") await postProduction(res.data);
    setBusy(false);
    setReason("");
    after(
      approved
        ? (step === "hrd" ? tr("Checked by HRD", "Diperiksa HRD") : tr("Signed by leadership", "Ditandatangani pimpinan"))
        : tr("Not paid", "Tidak dibayar"),
      tr(`${sheetNo} · ${formatNumber(s.total_hours)} hours`, `${sheetNo} · ${formatNumber(s.total_hours)} jam`),
    );
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={sheet.status === "ready" ? sheet.data.purpose : sheetNo}
      subtitle={sheet.status === "ready"
        ? `${sheetNo} · ${sheet.data.work_date} · ${OVERTIME_KIND_LABEL[sheet.data.kind]}`
        : undefined}
    >
      <Loaded state={sheet} onRetry={reload}>
        {(s) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.payable ? "green" : s.stage === "declined" || s.stage === "unpaid" ? "slate" : "amber"} dot>
                {OVERTIME_STAGE_LABEL[s.stage]}
              </Badge>
              <span className="text-[12px] text-slate-500">
                {tr(`${s.lines.length} people · ${formatNumber(s.total_hours)} hours`, `${s.lines.length} orang · ${formatNumber(s.total_hours)} jam`)}
                {s.payable ? tr(" · on the payslip", " · masuk payslip") : tr(" · not yet on the payslip", " · belum masuk payslip")}
              </span>
            </div>

            {s.unpaid_reason && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700">
                <strong>{tr("Not paid.", "Tidak dibayar.")}</strong> {s.unpaid_reason}
              </p>
            )}
            {s.declined_reason && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-900">
                <strong>{tr("Declined.", "Ditolak.")}</strong> {s.declined_reason}
              </p>
            )}

            {/* Who, how long, doing what — and for production, on which order. */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left">{tr("Name", "Nama")}</th>
                    <th className="px-3 py-2 text-right">{tr("Hours", "Jam")}</th>
                    <th className="px-3 py-2 text-right">{tr("Pay (form)", "Gaji (form)")}</th>
                    <th className="px-3 py-2 text-left">{tr("Work", "Pekerjaan")}</th>
                    {s.kind === "production" && <th className="px-3 py-2 text-left">{tr("Item · process · qty", "Item · proses · jumlah")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <span className="block font-medium text-slate-800">{l.full_name}</span>
                        <span className="block font-mono text-[10px] text-slate-400">{l.employee_no}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(l.hours)}</td>
                      {/* What the paper said against this name. Where it is
                          there, it is what payroll pays (D154). */}
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {l.form_amount == null
                          ? <span className="text-slate-300" title={tr("No figure on the form — paid at the normal hourly rate", "Tidak ada angka di form — dibayar tarif jam biasa")}>—</span>
                          : formatIDR(l.form_amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {l.task}
                        {l.deliverable && (
                          <span className="block text-[12px] text-slate-500">{tr("Deliverable", "Deliverable")}: <span className="text-slate-700">{l.deliverable}</span></span>
                        )}
                        {l.result_note && (
                          <span className="block text-[12px] text-slate-500">{tr("Result", "Hasil")}: <span className="text-slate-700">{l.result_note}</span></span>
                        )}
                      </td>
                      {s.kind === "production" && (
                        <td className="px-3 py-2">
                          {l.wo_no ? (
                            <>
                              <Link href="/produksi/jadwal" className="font-mono text-[11px] text-brand-700 underline">
                                {l.wo_no}
                              </Link>
                              <span className="block text-[11px] text-slate-500">
                                {l.stage ? STAGE_NAME(l.stage) : "—"}
                                {l.qty_done
                                  ? tr(` · ${formatNumber(l.qty_done)} units`, ` · ${formatNumber(l.qty_done)} unit`)
                                  : tr(" · no units finished", " · tidak ada unit selesai")}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400">{tr("not tied to an order", "tidak terkait pesanan")}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* The paper. Signed sheet for production, screenshot for staff. */}
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                <FileText className="h-4 w-4 text-slate-400" />
                {s.kind === "production" ? tr("Surat lembur (signed)", "Surat lembur (tanda tangan)") : tr("Work report (screenshot)", "Laporan pekerjaan (screenshot)")}
              </p>
              {s.evidence ? (
                <p className="mt-0.5 text-[12px] text-slate-600">{s.evidence.filename} · {s.evidence.kind}</p>
              ) : (
                <p className="mt-0.5 text-[12px] text-amber-800">
                  {s.kind === "production"
                    ? tr("None yet. Leadership cannot sign before the surat is attached.", "Belum ada. Pimpinan tidak bisa menandatangani sebelum suratnya dilampirkan.")
                    : tr("None yet. The report is the evidence for this session — attach a screenshot of the work.", "Belum ada. Laporan adalah bukti sesi ini — lampirkan screenshot pekerjaannya.")}
                </p>
              )}
              {mayHrd && !s.evidence && (
                <>
                  <input
                    ref={fileRef} type="file" className="hidden" accept="application/pdf,image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void attach(f, s.kind === "production" ? tr("Surat lembur", "Surat lembur") : tr("Report", "Laporan"));
                    }}
                  />
                  <Button size="sm" variant="outline" icon={Paperclip} className="mt-2" disabled={busy}
                    onClick={() => fileRef.current?.click()}>
                    {tr("Attach", "Lampirkan")}
                  </Button>
                </>
              )}
            </div>

            {/* The form itself, read rather than retyped (D154). */}
            {mayHrd && s.kind === "production" && !s.hrd_checked_at && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Upload className="h-4 w-4 text-slate-400" /> {tr("Fill the sheet from the overtime form", "Isi lembar dari form lembur")}
                </p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {tr(
                    "The PT Talahome paper form — NO · NAMA · DESCRIPTION · GAJI · JAM — exported as CSV, then read in here. Names are matched against the employee records; unknown ones are reported, not created.",
                    "Form kertas PT Talahome — NO · NAMA · DESCRIPTION · GAJI · JAM — di-export sebagai CSV, lalu dibaca ke sini. Nama dicocokkan dengan data karyawan; yang tidak dikenal dilaporkan, bukan dibuat.",
                  )}
                </p>
                <Button size="sm" variant="outline" icon={Upload} className="mt-2"
                  onClick={() => setImporting(true)}>
                  {tr("Upload form", "Upload form")}
                </Button>
              </div>
            )}

            {/* Signatures. Production takes two; staff takes one. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1">
                  {s.hrd_checked_at
                    ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                    : <span className="h-3.5 w-3.5 rounded-full border border-dashed border-slate-300" />}
                  {s.hrd_checked_at ? tr("HRD has checked", "HRD sudah memeriksa") : tr("HRD has not checked", "HRD belum memeriksa")}
                </span>
                {s.kind === "production" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1">
                    {s.leader_approved_at
                      ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                      : <span className="h-3.5 w-3.5 rounded-full border border-dashed border-slate-300" />}
                    {s.leader_approved_at ? tr("Leadership has signed", "Pimpinan sudah menandatangani") : tr("Leadership has not signed", "Pimpinan belum menandatangani")}
                  </span>
                )}
                {s.kind === "staff" && (
                  <span className="text-[11px] text-slate-500">
                    {tr("Staff overtime does not need leadership's signature.", "Lembur staff tidak perlu tanda tangan pimpinan.")}
                  </span>
                )}
              </div>

              {/* An ask from the phone gets one decision, HRD's or
                  leadership's (D333) — the queue's buttons, not the two
                  signatures below. */}
              {s.via === "self" && (
                s.decided_at ? (
                  <p className="text-[12px] text-slate-600">
                    {decisionLine(s)}{s.decision_note ? ` — ${s.decision_note}` : ""}
                  </p>
                ) : (
                  <DecideAsk
                    sheetNo={s.sheet_no}
                    hasResult={!!s.lines[0]?.result_note}
                    mine={s.created_by === session?.user.id}
                    onDone={() => { reload(); onChanged(); }}
                  />
                )
              )}
              {s.via !== "self" && (mayHrd || mayLeader) && s.stage !== "declined" && (
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <input
                    value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder={tr("Reason — only needed if not paid / declined.", "Alasan — hanya perlu kalau tidak dibayar / ditolak.")}
                    className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {mayHrd && !s.hrd_checked_at && (
                      <>
                        <Button size="sm" variant="ghost" icon={X} disabled={busy}
                          onClick={() => decide(s, "hrd", false)}>
                          {s.kind === "staff" ? tr("Not paid", "Tidak dibayar") : tr("Decline", "Tolak")}
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => decide(s, "hrd", true)}>
                          {s.kind === "staff" ? tr("Review — still paid", "Tinjau — tetap dibayar") : tr("Check & pass on", "Periksa & teruskan")}
                        </Button>
                      </>
                    )}
                    {mayHrd && s.kind === "staff" && s.hrd_checked_at && (
                      <Button size="sm" variant="ghost" disabled
                        title={s.paid ? tr("Decided: paid", "Sudah diputuskan: dibayar") : tr("Decided: not paid", "Sudah diputuskan: tidak dibayar")}>
                        {tr("Already decided by HRD", "Sudah diputuskan HRD")}
                      </Button>
                    )}
                    {s.kind === "production" && s.hrd_checked_at && !s.leader_approved_at && (
                      mayLeader ? (
                        <>
                          <Button size="sm" variant="ghost" icon={X} disabled={busy}
                            onClick={() => decide(s, "leader", false)}>
                            {tr("Decline", "Tolak")}
                          </Button>
                          <Button
                            size="sm" icon={Factory}
                            disabled={busy || !s.evidence}
                            title={s.evidence ? "" : tr("Surat lembur not attached yet", "Surat lembur belum dilampirkan")}
                            onClick={() => decide(s, "leader", true)}
                          >
                            {tr("Sign & report production", "Tanda tangani & laporkan produksi")}
                          </Button>
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {s.evidence ? tr("waiting for leadership's signature", "menunggu tanda tangan pimpinan") : tr("waiting for the surat lembur", "menunggu surat lembur")}
                        </span>
                      )
                    )}
                  </div>
                  {s.kind === "production" && !s.leader_approved_at && s.lines.some((l) => l.wo_no && l.qty_done) && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {tr(
                        `Leadership's signature also records ${formatNumber(s.lines.reduce((a, l) => a + (l.qty_done ?? 0), 0))} units on the production board.`,
                        `Tanda tangan pimpinan juga mencatat ${formatNumber(s.lines.reduce((a, l) => a + (l.qty_done ?? 0), 0))} unit ke papan produksi.`,
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Loaded>

      {importing && (
        <ImportForm
          sheetNo={sheetNo}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); reload(); onChanged(); }}
        />
      )}
    </Drawer>
  );
}
