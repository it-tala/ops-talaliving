"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { useLoad } from "@/components/ui/loaded";
import { accounting } from "@/demo/api";
import type { CashflowSettings } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { labelCls } from "./LineDrawer";

/** The two settings the verdict rests on: the minimum the company should
 *  never go under, and which ledger categories are money moving between our
 *  own accounts (neither in nor out for the company). */
export function SettingsDrawer({ settings, onClose, onSaved }: { settings: CashflowSettings; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [types] = useLoad(() => accounting.listTypeRows(), []);
  const [min, setMin] = useState(settings.min_balance);
  const [transfers, setTransfers] = useState<string[]>(settings.transfer_types);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await accounting.setCashflowSettings({ min_balance: min, transfer_types: transfers });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-md"
      title={tr("Cashflow settings", "Pengaturan cashflow")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label className={labelCls}>{tr("Safe minimum balance", "Batas aman saldo")}</label>
          <MoneyInput value={min} onChange={setMin} className="mt-1" />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("Below this the cashflow reads thin (amber); below zero it reads runs out (red). A month of payroll is a common choice.",
              "Di bawah angka ini cashflow terbaca menipis (kuning); di bawah nol terbaca habis (merah). Sebulan gaji adalah pilihan yang umum.")}
          </p>
        </div>
        <div>
          <span className={labelCls}>{tr("Transfers between our own accounts", "Transfer antar rekening sendiri")}</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {types.status === "ready" && types.data.map((x) => {
              const on = transfers.includes(x.code);
              return (
                <button key={x.code} onClick={() => setTransfers(on ? transfers.filter((t) => t !== x.code) : [...transfers, x.code])}
                  className={on ? "rounded-full bg-brand-600 px-2.5 py-1 text-[12px] text-white" : "rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-200"}>
                  {x.code}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("Rows of these categories move money inside the company, so they are neither cash in nor cash out.",
              "Baris kategori ini memindahkan uang di dalam perusahaan, jadi bukan cash in maupun cash out.")}
          </p>
        </div>
      </div>
    </Drawer>
  );
}
