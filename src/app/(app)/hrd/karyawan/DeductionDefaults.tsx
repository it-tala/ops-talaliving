"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import { ADJUSTMENT_LABEL, DEDUCTION_KINDS, type DeductionKind } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Potongan default per bulan (D389).
 *
 *  Owner: *tambahkan nilai potongan default per bulan sehingga bisa otomatis
 *  tidak perlu input per karyawan — retensi dan BPJS TK; BPJS Kesehatan juga
 *  tapi default 0 karena umumnya dibayar perusahaan.* Salaries only, once a
 *  month: *Buat payroll* starts every salaried person with these as
 *  deductions, and HRD can still take one off for a person there. A person's
 *  own amount, set in their drawer, wins over these. */
export function DeductionDefaults() {
  const tr = useTr();
  const { toast } = useToast();
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [rows, reload] = useLoad(() => hr.listDeductionDefaults(), []);
  const [draft, setDraft] = useState<Record<DeductionKind, number>>({ retention: 0, bpjs_tk: 0, bpjs_kes: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rows.status !== "ready") return;
    const next = { retention: 0, bpjs_tk: 0, bpjs_kes: 0 } as Record<DeductionKind, number>;
    for (const r of rows.data) next[r.kind] = r.amount;
    setDraft(next);
  }, [rows]);

  if (rows.status !== "ready" || rows.data.length === 0) return null;
  const saved = (k: DeductionKind) => rows.data.find((r) => r.kind === k)?.amount ?? 0;
  const changed = DEDUCTION_KINDS.filter((k) => draft[k] !== saved(k));

  async function save() {
    setBusy(true);
    for (const kind of changed) {
      const res = await hr.setDeductionDefault({ kind, amount: draft[kind] });
      if (res.error) {
        setBusy(false);
        toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
        return;
      }
    }
    setBusy(false);
    toast("success", tr("Default deductions saved", "Potongan default tersimpan"));
    reload();
  }

  const note: Record<DeductionKind, string> = {
    retention: tr("held back, kept as each person's balance", "ditahan, dicatat sebagai saldo tiap orang"),
    bpjs_tk: tr("the employee's share, a fixed amount", "bagian karyawan, nominal tetap"),
    bpjs_kes: tr("usually 0 — the company pays it", "umumnya 0 — dibayar perusahaan"),
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">{tr("Default deductions, per month", "Potongan default per bulan")}</p>
          <p className="text-[12px] text-slate-500">
            {tr(
              "Monthly salaries only, once a month. Generate payroll starts everybody with these; change or remove one per person there, or set a person's own amount in their record.",
              "Hanya gaji bulanan, sekali sebulan. Buat payroll langsung mengisinya untuk semua orang; ubah atau hapus per orang di sana, atau atur nilai sendiri seseorang di data karyawannya.",
            )}
          </p>
        </div>
        {mayEdit && (
          <Button size="sm" icon={Save} disabled={busy || changed.length === 0} onClick={save}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {DEDUCTION_KINDS.map((k) => (
          <div key={k}>
            <label htmlFor={`ded-${k}`} className="block text-xs text-slate-500">{ADJUSTMENT_LABEL[k]}</label>
            {mayEdit
              ? <MoneyInput id={`ded-${k}`} value={draft[k]} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} className="mt-1" />
              : <p className="mt-1 text-sm font-medium text-slate-800">{formatIDR(saved(k))}</p>}
            <p className="mt-1 text-[11px] text-slate-500">{note[k]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One salaried person's own monthly deductions (D389): blank follows the
 *  default, any number — zero included — is theirs. */
export function PersonDeductions({ employeeNo }: { employeeNo: string }) {
  const tr = useTr();
  const { toast } = useToast();
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [defaults] = useLoad(() => hr.listDeductionDefaults(), []);
  const [own, reload] = useLoad(() => hr.listEmployeeDeductions(employeeNo), [employeeNo]);
  /* null = follow the default. */
  const [draft, setDraft] = useState<Record<DeductionKind, number | null>>({ retention: null, bpjs_tk: null, bpjs_kes: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (own.status !== "ready") return;
    const next = { retention: null, bpjs_tk: null, bpjs_kes: null } as Record<DeductionKind, number | null>;
    for (const r of own.data) next[r.kind] = r.amount;
    setDraft(next);
  }, [own]);

  if (defaults.status !== "ready" || own.status !== "ready" || defaults.data.length === 0) return null;
  const def = (k: DeductionKind) => defaults.data.find((d) => d.kind === k)?.amount ?? 0;
  const saved = (k: DeductionKind) => own.data.find((d) => d.kind === k)?.amount ?? null;
  const changed = DEDUCTION_KINDS.filter((k) => draft[k] !== saved(k));

  async function save() {
    setBusy(true);
    for (const kind of changed) {
      const res = await hr.setEmployeeDeduction({ employee_no: employeeNo, kind, amount: draft[kind] });
      if (res.error) {
        setBusy(false);
        toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
        return;
      }
    }
    setBusy(false);
    toast("success", tr("Deductions saved", "Potongan tersimpan"));
    reload();
  }

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">{tr("Deductions, per month", "Potongan per bulan")}</p>
        {mayEdit && (
          <Button size="sm" variant="outline" icon={Save} disabled={busy || changed.length === 0} onClick={save}>
            {tr("Save deductions", "Simpan potongan")}
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {DEDUCTION_KINDS.map((k) => (
          <div key={k}>
            <label htmlFor={`own-${k}`} className="block text-[11px] text-slate-500">{ADJUSTMENT_LABEL[k]}</label>
            {draft[k] === null ? (
              <button
                type="button" id={`own-${k}`} disabled={!mayEdit}
                onClick={() => setDraft((d) => ({ ...d, [k]: def(k) }))}
                className="mt-1 h-9 w-full rounded-lg border border-dashed border-slate-300 px-2 text-left text-[12px] text-slate-500 hover:border-brand-400"
              >
                {tr(`Default · ${formatIDR(def(k))}`, `Ikut default · ${formatIDR(def(k))}`)}
              </button>
            ) : (
              <div className="mt-1 flex items-center gap-1">
                <MoneyInput id={`own-${k}`} value={draft[k] ?? 0} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
                {mayEdit && (
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, [k]: null }))}
                    className="whitespace-nowrap text-[11px] text-slate-500 underline hover:text-slate-700">
                    {tr("default", "default")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {tr(
          "Taken once a month on Generate payroll. Zero means this person pays none of it.",
          "Dipotong sekali sebulan saat Buat payroll. Nol berarti orang ini tidak dipotong.",
        )}
      </p>
    </div>
  );
}
