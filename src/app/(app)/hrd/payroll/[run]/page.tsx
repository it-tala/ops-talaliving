"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Printer, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { Adjustments } from "./Adjustments";
import { Members } from "./Members";
import { PayRun } from "./PayRun";
import { PayrollSheet, type SheetAside } from "../PayrollSheet";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One run, line by line, with what each figure is made of.
 *
 *  Nothing here is stored. Every number is computed from the days and the
 *  approved overtime at the moment it is read (A3), which is why an open day
 *  changes the figure the instant somebody closes it — and why approving a run
 *  is refused while any are open (D139).
 */
/** A date, some days later or earlier. UTC arithmetic on a string, because the
 *  office day is not the browser's day (F17). */
function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export default function PayrollRunPage({ params }: { params: Promise<{ run: string }> }) {
  /* Next 15 hands route params to the page as a promise, so it can start
     rendering before the segment is resolved. `use` unwraps it here — the
     rest of the component reads the same plain string it always did. */
  const { run } = use(params);
  const runNo = decodeURIComponent(run);
  const { hasAuthority, can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [detail, reload] = useLoad(() => hr.getPayroll(runNo), [runNo]);
  const [busy, setBusy] = useState(false);
  const mayRun = can("payroll.run");
  /* Who the run was opened for and is not paying: held, or paid by another
     run. They keep a row on the sheet, with the reason (0213). */
  const [members, reloadMembers] = useLoad(() => hr.listRunMembers(runNo), [runNo]);
  const asides: SheetAside[] = members.status === "ready"
    ? members.data.filter((m) => !m.included).map((m) => ({
      employee_no: m.employee_no, full_name: m.full_name, pay_basis: m.pay_basis,
      reason: m.note ?? "", locked: m.auto,
    }))
    : [];
  const [holdReason, setHoldReason] = useState("");
  const [focusNo, setFocusNo] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusNo(null), []);

  async function toggleMember(employeeNo: string, on: boolean) {
    setBusy(true);
    const res = await hr.setRunMember({
      run_no: runNo, employee_no: employeeNo, included: on,
      note: on ? null : holdReason.trim() || "Ditahan HRD",
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not changed", "Tidak diubah"), res.error.message);
      return;
    }
    toast("success", on ? tr("Paid by this run", "Ikut dibayar run ini") : tr("Held", "Ditahan"), employeeNo);
    reload(); reloadMembers();
  }
  const mayApprove = hasAuthority("approve_funds");

  async function approve() {
    setBusy(true);
    const res = await hr.approvePayroll(runNo);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not approved", "Tidak disetujui"), res.error.message);
      return;
    }
    toast("success", tr(`${runNo} approved`, `${runNo} disetujui`), tr("It can be paid from the ledger.", "Sudah bisa dibayar dari buku besar."));
    reload();
  }


  return (
    <div>
      <Link href="/hrd/payroll" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All runs", "Semua periode gaji")}
      </Link>

      <Loaded state={detail} onRetry={reload}>
        {(d) => (
          <>
            <PageHeader
              breadcrumb={tr("Payroll", "Penggajian")}
              title={d.run_no}
              description={tr(`${d.period_start} → ${d.period_end} · ${d.lines.length} people on this run`, `${d.period_start} → ${d.period_end} · ${d.lines.length} orang di run ini`)}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge state={detail} />
                  {/* Walking to the week before or after this run. A run is a
                      document over a period; the period exists whether or not
                      anybody opened one, so the arrows never dead-end (D158). */}
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, -7)}`}>
                    <Button variant="outline" size="sm" icon={ChevronLeft}>{tr("Previous week", "Minggu sebelumnya")}</Button>
                  </Link>
                  <Link href={`/hrd/payroll/minggu?from=${shiftDate(d.period_start, 7)}`}>
                    <Button variant="outline" size="sm">
                      {tr("Next week", "Minggu berikutnya")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline" icon={Printer}
                    onClick={() => window.open(`/hrd/payroll/${encodeURIComponent(d.run_no)}/payslip`, "_blank", "noopener")}
                  >
                    {tr("Payslips", "Slip gaji")}
                  </Button>
                  {mayApprove && d.status === "DRAFT" && (
                    <Button icon={Check} disabled={busy} onClick={approve}>
                      {busy ? tr("Approving…", "Menyetujui…") : tr("Approve the run", "Setujui periode gaji")}
                    </Button>
                  )}
                </div>
              }
            />

            {d.pending_overtime_hours > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                <span>
                  {tr(
                    `${formatNumber(d.pending_overtime_hours)} overtime hour(s) are claimed and not approved. They are not in any figure here — approve them and the gross moves.`,
                    `${formatNumber(d.pending_overtime_hours)} jam lembur diajukan dan belum disetujui. Jam itu tidak masuk angka mana pun di sini — setujui dan bruto akan berubah.`,
                  )}
                </span>
              </div>
            )}

            <PayRun run={d} onPosted={reload} />

            {/* The sheet (0213, D371): every person, their attendance and rates,
                what is added and what is taken, and a box — unticking holds
                somebody off this run with the reason below. */}
            {d.status === "DRAFT" && mayRun && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
                <label htmlFor="hold-reason">{tr("Reason when unticking somebody:", "Alasan saat menghapus centang:")}</label>
                <input
                  id="hold-reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
                  placeholder={tr("e.g. paid next week", "mis. dibayar minggu depan")}
                  className="h-8 min-w-[240px] flex-1 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                />
              </div>
            )}
            <PayrollSheet
              lines={d.lines}
              asides={asides}
              selectable={d.status === "DRAFT" && mayRun}
              selected={new Set(d.lines.map((l) => l.employee_no))}
              onToggle={toggleMember}
              onPersonSettings={d.status === "DRAFT" && mayRun ? setFocusNo : undefined}
            />

            <Members
              key={`${d.run_no}:${JSON.stringify(d.components ?? {})}:${d.components_note ?? ""}`}
              run={d}
              editable={d.status === "DRAFT"}
              onChanged={() => { reload(); reloadMembers(); }}
              focusNo={focusNo}
              onFocusDone={clearFocus}
            />

            <Adjustments
              runNo={d.run_no}
              editable={d.status === "DRAFT"}
              onChanged={reload}
            />

          </>
        )}
      </Loaded>
    </div>
  );
}
