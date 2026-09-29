"use client";

import { useState } from "react";
import { Clock, Factory, Laptop, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  OVERTIME_KIND_LABEL, OVERTIME_STAGE_LABEL,
  type OvertimeKind, type OvertimeStage, type OvertimeSheetView,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { NewSheet } from "./NewSheet";
import { SheetDrawer } from "./SheetDrawer";
import { SelfQueue } from "./SelfQueue";
import { useOvertimeStatus } from "../../saya/overtime-ask";

/** Lembur, as two different pieces of paper.
 *
 *  The owner described them, and they are not variants of one thing:
 *
 *  - **Produksi** — one sheet, one night, many names, and against each name
 *    what was made and how far it got. Signed by leadership, because it is a
 *    batch of wages and a batch of production claims at the same time.
 *  - **Staff** — one sheet per session, one person, with their own report of
 *    the work, usually a screenshot. **Paid unless HRD says otherwise**: the
 *    person already stayed, the report is attached, and making a designer's
 *    Tuesday evening wait on the Direktur is how a rule becomes a rubber
 *    stamp (D146).
 *
 *  So the list shows both, with the stage each one is stuck at — because the
 *  sheet nobody has signed for a week is the only thing on this screen that
 *  needs somebody today.
 */
const STAGE_TONE: Record<OvertimeStage, "amber" | "violet" | "brand" | "green" | "slate" | "red"> = {
  waiting_hrd: "amber",
  waiting_surat: "violet",
  waiting_leader: "brand",
  approved: "green",
  paid_default: "green",
  paid_checked: "green",
  unpaid: "slate",
  declined: "red",
};

export default function OvertimePage() {
  const { can, hasAuthority } = useSession();
  const tr = useTr();
  const otStatus = useOvertimeStatus();
  const [sheets, reload] = useLoad(() => hr.listOvertimeSheets(), []);
  const [creating, setCreating] = useState<OvertimeKind | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /* Lembar lembur bertambah tiap minggu — daftarnya dipaginasi, tidak
     dirender seluruhnya (D157). */
  const { shown: rows, pager } = usePaged(sheets.status === "ready" ? sheets.data : [], 15);
  const mayEdit = can("hrd.update");
  /* Leadership reaches this screen by the `approve_overtime` authority alone
     (D333): the asks are theirs to decide too, the sheets are HRD's. */
  const maySheets = can("hrd.read") || can("payroll.read");
  const mayAsks = can("hrd.read") || hasAuthority("approve_overtime");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Overtime", "Lembur")}
        description={tr(
          "Asked for by employees: approved by HRD or leadership. Production sheets: one night, many names, signed by leadership. Staff sessions keyed by HRD: paid unless said otherwise.",
          "Diajukan karyawan: disetujui HRD atau pimpinan. Lembar produksi: satu malam, banyak nama, ditandatangani pimpinan. Sesi staff yang dicatat HRD: dibayar kecuali dikatakan lain.",
        )}
        actions={mayEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={Factory} onClick={() => setCreating("production")}>{tr("Production sheet", "Lembar produksi")}</Button>
            <Button icon={Laptop} variant="outline" onClick={() => setCreating("staff")}>{tr("Staff session", "Sesi staff")}</Button>
          </div>
        ) : undefined}
      />

      {mayAsks && <SelfQueue onChanged={reload} />}

      {maySheets && <Loaded state={sheets} onRetry={reload}>
        {(all) => {
          const waiting = all.filter((s) =>
            s.stage === "waiting_hrd" || s.stage === "waiting_surat" || s.stage === "waiting_leader");
          const unreviewed = all.filter((s) => s.stage === "paid_default");
          const hours = (rows: OvertimeSheetView[]) => rows.reduce((a, s) => a + s.total_hours, 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("Waiting for signature", "Menunggu tanda tangan"), String(waiting.length), tr(`${formatNumber(hours(waiting))} hours not yet on a payslip`, `${formatNumber(hours(waiting))} jam belum masuk payslip`)],
                    [tr("Paid, not yet reviewed", "Dibayar, belum ditinjau"), String(unreviewed.length), tr("staff sessions — paid by default", "sesi staff — default dibayar")],
                    [tr("Production sheets", "Lembar produksi"), String(all.filter((s) => s.kind === "production").length), tr("one night, many names", "satu malam, banyak nama")],
                    [tr("Staff sessions", "Sesi staff"), String(all.filter((s) => s.kind === "staff").length), tr("one session, one report", "satu sesi, satu laporan")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        k === tr("Waiting for signature", "Menunggu tanda tangan") && waiting.length > 0 ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <Card>
                <CardHeader
                  title={tr(`${all.length} sheets`, `${all.length} lembar`)}
                  subtitle={tr("Click to see who, how many hours, and what was worked on.", "Klik untuk melihat siapa saja, berapa jam, dan apa yang dikerjakan.")}
                  icon={Clock}
                  action={<SourceBadge state={sheets} />}
                />
                <ul className="divide-y divide-slate-100">
                  {all.length === 0 && (
                    <li className="px-5 py-8 text-[13px] text-slate-500">{tr("No overtime sheets yet.", "Belum ada lembar lembur.")}</li>
                  )}
                  {rows.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setOpen(s.sheet_no)}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50"
                      >
                        <span className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                          s.kind === "production" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500",
                        )}>
                          {s.kind === "production" ? <Factory className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                        </span>
                        <span className="min-w-[190px] flex-1">
                          <span className="block text-[13px] font-medium text-slate-800">{s.purpose}</span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {s.sheet_no} · {s.work_date} · {OVERTIME_KIND_LABEL[s.kind]}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-[12px] text-slate-600">
                          {tr(`${s.lines.length} people · ${formatNumber(s.total_hours)} hours`, `${s.lines.length} orang · ${formatNumber(s.total_hours)} jam`)}
                        </span>
                        {s.kind === "production" && s.lines.some((l) => l.wo_no) && (
                          <Badge tone="slate">
                            {new Set(s.lines.filter((l) => l.wo_no).map((l) => l.wo_no)).size} Job Order
                          </Badge>
                        )}
                        <Badge tone={STAGE_TONE[s.stage]} dot>
                          {s.via === "self" ? otStatus(s).label : OVERTIME_STAGE_LABEL[s.stage]}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
                {pager}
                {mayEdit && (
                  <p className="flex items-center gap-2 border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500">
                    <Plus className="h-3.5 w-3.5" />
                    {tr(
                      "Overtime hours reach the payslip only once the sheet is complete — production needs the surat and leadership's signature, staff only a report.",
                      "Jam lembur hanya masuk payslip setelah lembarnya lengkap — produksi butuh surat dan tanda tangan pimpinan, staff cukup laporan.",
                    )}
                  </p>
                )}
              </Card>
            </>
          );
        }}
      </Loaded>}

      {creating && (
        <NewSheet
          kind={creating}
          onClose={() => setCreating(null)}
          onDone={(sheetNo) => { setCreating(null); reload(); setOpen(sheetNo); }}
        />
      )}
      {open && (
        <SheetDrawer sheetNo={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  );
}
