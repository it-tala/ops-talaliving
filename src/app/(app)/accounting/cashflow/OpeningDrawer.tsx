"use client";

import { useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { Cashflow } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { monthLabel } from "./shared";
import { field, labelCls } from "./LineDrawer";

/** Where the walk starts: every account at the start of the month, from the
 *  ledger — and, because the ledger does not hold every movement of every
 *  leadership account, a figure leadership may type instead. Both are shown;
 *  the typed one wins. */
export function OpeningDrawer({ cf, onClose, onSaved }: { cf: Cashflow; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [amount, setAmount] = useState(cf.opening.typed?.amount ?? cf.opening.ledger);
  const [note, setNote] = useState(cf.opening.typed?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save(clear = false) {
    setBusy(true);
    const res = await accounting.setCashflowOpening(cf.from_month, clear ? null : amount, note || null);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-md"
      title={tr(`Starting balance · ${monthLabel(cf.from_month, true)}`, `Saldo awal · ${monthLabel(cf.from_month, true)}`)}
      subtitle={tr("Every account on the 1st, from the ledger.", "Semua rekening per tanggal 1, dari ledger.")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {cf.opening.typed && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => save(true)} disabled={busy}>{tr("Use the ledger's", "Pakai angka ledger")}</Button>}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Save} onClick={() => save(false)} disabled={busy}>{tr("Use this figure", "Pakai angka ini")}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <table className="w-full text-[13px]">
          <tbody>
            {cf.opening.accounts.map((a) => (
              <tr key={a.code} className="border-b border-slate-100">
                <td className="py-1.5 text-slate-700">{a.code}
                  {a.custody === "leadership" && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{tr("leadership", "pimpinan")}</span>}
                </td>
                <td className={cn("py-1.5 text-right tabular-nums", a.balance < 0 ? "text-rose-700" : "text-slate-800")}>{formatIDR(a.balance)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-semibold text-slate-800">{tr("Ledger total", "Total ledger")}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{formatIDR(cf.opening.ledger)}</td>
            </tr>
          </tbody>
        </table>

        <div className="rounded-lg border border-slate-200 p-3">
          <label className={labelCls}>{tr("The real total in the banks on the 1st", "Total sebenarnya di bank per tanggal 1")}</label>
          <MoneyInput value={amount} onChange={setAmount} className="mt-1" />
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field}
            placeholder={tr("e.g. checked against the bank statements", "mis. sudah dicek dengan rekening koran")} />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("Type it when the ledger is behind — a transfer into a leadership account not yet booked. The difference from the ledger stays visible.",
              "Ketik bila ledger tertinggal — transfer ke rekening pimpinan yang belum dibukukan. Selisihnya dengan ledger tetap terlihat.")}
            {cf.opening.typed && <> {tr("Difference now:", "Selisih saat ini:")} <strong>{formatIDR(cf.opening.typed.amount - cf.opening.ledger)}</strong></>}
          </p>
        </div>
      </div>
    </Drawer>
  );
}
