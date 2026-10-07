"use client";

import { useState } from "react";
import { Plus, Scale, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import { ADJUSTMENT_LABEL, type AdjustmentKind } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** What HRD adds to or takes off a payslip, by hand, with a reason.
 *
 *  Kept apart from everything the system computes, because it is a different
 *  kind of thing (D155): base pay and overtime are arithmetic over records,
 *  while a deduction for lateness is a **decision** about one person. The
 *  system refuses to invent those — it does not know what a minute costs
 *  (Q41), what an SP costs, or what was left over last time.
 *
 *  What it does insist on is the sentence. A payslip that says
 *  *Potongan Rp 100.000* teaches an employee that money disappears; one that
 *  says *SP-1: meninggalkan pekerjaan tanpa izin, 24 Agustus* can be argued
 *  with, which is the point.
 */
export function Adjustments({
  runNo, editable, onChanged,
}: {
  runNo: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [rows, reload] = useLoad(() => hr.listAdjustments(runNo), [runNo]);
  const [people] = useLoad(() => hr.listEmployees(), []);
  const [draft, setDraft] = useState<{ employee_no: string; kind: AdjustmentKind; amount: number; reason: string }>({
    employee_no: "", kind: "late", amount: 0, reason: "",
  });
  const [busy, setBusy] = useState(false);
  const mayEdit = editable && can("payroll.run");

  /* Deductions are typed as a positive number and stored negative: nobody
     writes "minus fifty thousand" on a form, and a stray sign is a wage
     dispute. Additions are chosen explicitly. */
  const adds = draft.kind === "carry_over" || draft.kind === "bonus" || draft.kind === "retention_release";

  async function save() {
    setBusy(true);
    const res = await hr.saveAdjustment({
      run_no: runNo,
      employee_no: draft.employee_no,
      kind: draft.kind,
      amount: adds ? Math.abs(draft.amount) : -Math.abs(draft.amount),
      reason: draft.reason,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr("Adjustment saved", "Penyesuaian tersimpan"), `${ADJUSTMENT_LABEL[draft.kind]} · ${formatIDR(Math.abs(draft.amount))}`);
    setDraft({ ...draft, amount: 0, reason: "" });
    reload(); onChanged();
  }

  async function remove(id: string, label: string) {
    setBusy(true);
    const res = await hr.removeAdjustment({ run_no: runNo, adjustment_id: id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    toast("success", tr("Adjustment removed", "Penyesuaian dihapus"), label);
    reload(); onChanged();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Deductions & additions", "Potongan & tambahan")}
        subtitle={tr(
          "Lateness, SP, kasbon, and differences from the previous period — each with its reason, and all of them printed on the slip.",
          "Keterlambatan, SP, kasbon, dan selisih dari periode sebelumnya — masing-masing dengan alasannya, dan semuanya tercetak di slip.",
        )}
        icon={Scale}
      />
      <Loaded state={rows} onRetry={reload} skeletonRows={2}>
        {(all) => (
          <>
            <ul className="divide-y divide-slate-100">
              {all.length === 0 && (
                <li className="px-5 py-4 text-[13px] text-slate-500">
                  {tr("No deductions or additions in this period yet.", "Belum ada potongan atau tambahan di periode ini.")}
                </li>
              )}
              {all.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <span className="min-w-[150px] text-[13px] font-medium text-slate-800">
                    {a.full_name}
                    <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{a.employee_no}</span>
                  </span>
                  <Badge tone={a.amount < 0 ? "red" : "green"}>{ADJUSTMENT_LABEL[a.kind]}</Badge>
                  <span className="min-w-[200px] flex-1 text-[12px] text-slate-500">{a.reason}</span>
                  <span className={cn(
                    "whitespace-nowrap text-[13px] tabular-nums",
                    a.amount < 0 ? "text-rose-700" : "text-emerald-700",
                  )}>
                    {a.amount < 0 ? `(${formatIDR(-a.amount)})` : formatIDR(a.amount)}
                  </span>
                  {mayEdit && (
                    <Button size="sm" variant="ghost" icon={Trash2} disabled={busy}
                      onClick={() => remove(a.id, `${a.full_name} · ${ADJUSTMENT_LABEL[a.kind]}`)}>
                      <span className="sr-only">{tr("Remove", "Hapus")}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {mayEdit && (
              <Loaded state={people} skeletonRows={1}>
                {(emps) => (
                  <div className="border-t border-slate-100 px-5 py-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_150px_140px]">
                      <select
                        value={draft.employee_no}
                        onChange={(e) => setDraft({ ...draft, employee_no: e.target.value })}
                        aria-label={tr("Employee", "Karyawan")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("Choose employee…", "Pilih karyawan…")}</option>
                        {emps.map((e) => (
                          <option key={e.employee_no} value={e.employee_no}>
                            {e.full_name} · {e.employee_no}
                          </option>
                        ))}
                      </select>
                      <select
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...draft, kind: e.target.value as AdjustmentKind })}
                        aria-label={tr("Kind", "Jenis")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        {(Object.keys(ADJUSTMENT_LABEL) as AdjustmentKind[]).map((k) => (
                          <option key={k} value={k}>{ADJUSTMENT_LABEL[k]}</option>
                        ))}
                      </select>
                      <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        value={draft.reason}
                        onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                        placeholder={tr("Reason — printed as written on the employee's payslip", "Alasan — dicetak apa adanya di slip gaji karyawan")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <Button size="sm" icon={Plus} onClick={save}
                        disabled={busy || !draft.employee_no || draft.amount <= 0 || !draft.reason.trim()}>
                        {adds ? tr("Add", "Tambahkan") : tr("Deduct", "Potong")}
                      </Button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {tr(
                        `Enter a positive number — ${adds ? "this adds" : "this deducts"} because the kind is ${ADJUSTMENT_LABEL[draft.kind].toLowerCase()}. The system never works out a lateness or SP deduction by itself: that is a decision, and a decision needs a name and a sentence.`,
                        `Masukkan angka positif — ${adds ? "ini menambah" : "ini memotong"} karena jenisnya ${ADJUSTMENT_LABEL[draft.kind].toLowerCase()}. Sistem tidak pernah menghitung sendiri berapa potongan keterlambatan atau SP: itu keputusan, dan keputusan butuh nama serta kalimat.`,
                      )}
                    </p>
                  </div>
                )}
              </Loaded>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}
