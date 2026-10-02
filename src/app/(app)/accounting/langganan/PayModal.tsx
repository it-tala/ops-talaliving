"use client";

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { accounting } from "@/demo/api";
import type { SubscriptionView } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

export const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Recording what was actually charged for one billing.
 *
 *  The rupiah is what leaves the account and is the figure the calendar keeps;
 *  the dollars, where there are any, are only there so the rate it really
 *  went at is a fact (rupiah ÷ dollars, bank margin included) rather than a
 *  guess. The register never posts to the ledger — this is the whole record.
 *
 *  It loads the register itself so the calendar can open it from a due line
 *  knowing only the subscription's id and the month. */
export function PayModal({ subscriptionId, period, onClose, onSaved }: {
  subscriptionId: string; period: string; onClose: () => void; onSaved: () => void;
}) {
  const tr = useTr();
  const [register, reload] = useLoad(() => accounting.getSubscriptions(), []);
  return (
    <Modal open onClose={onClose} width="max-w-lg" title={tr("Record a payment", "Catat pembayaran")}>
      <Loaded state={register} onRetry={reload}>
        {(r) => {
          const sub = r.subscriptions.find((s) => s.id === subscriptionId);
          if (!sub) return <p className="text-[13px] text-slate-500">{tr("This subscription no longer exists.", "Langganan ini sudah tidak ada.")}</p>;
          return <PayForm sub={sub} usdIdr={r.usd_idr} period={period} onClose={onClose} onSaved={onSaved} />;
        }}
      </Loaded>
    </Modal>
  );
}

function PayForm({ sub, usdIdr, period, onClose, onSaved }: {
  sub: SubscriptionView; usdIdr: number; period: string; onClose: () => void; onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const existing = sub.payments.find((p) => p.period === period) ?? null;
  const isUsd = sub.currency === "USD";

  const [paidOn, setPaidOn] = useState(existing?.paid_on ?? officeToday());
  const [dollars, setDollars] = useState(existing?.amount_usd ?? (isUsd ? sub.amount : 0));
  const [rupiah, setRupiah] = useState(existing?.amount_idr ?? sub.planned_idr);
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const rate = isUsd && dollars > 0 ? rupiah / dollars : null;
  const off = rate ? ((rate - usdIdr) / usdIdr) * 100 : null;

  async function save() {
    setBusy(true);
    const res = await accounting.recordSubscriptionPayment(sub.id, {
      period, paid_on: paidOn, amount_idr: rupiah,
      amount_usd: isUsd ? dollars : null, note: note || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Payment recorded", "Pembayaran tercatat"), `${sub.name} · ${period} · ${formatIDR(rupiah)}`);
    onSaved();
  }

  async function remove() {
    setBusy(true);
    const res = await accounting.removeSubscriptionPayment(sub.id, period);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    toast("success", tr("Payment removed", "Pembayaran dihapus"), `${sub.name} · ${period}`);
    onSaved();
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-slate-600">
        <strong className="text-slate-800">{sub.name}</strong> · {period}
        <span className="block text-[12px] text-slate-500">
          {isUsd
            ? tr(`Expected ${usd(sub.amount)} × Rp ${usdIdr.toLocaleString("id-ID")} = ${formatIDR(sub.planned_idr)}`,
              `Diperkirakan ${usd(sub.amount)} × Rp ${usdIdr.toLocaleString("id-ID")} = ${formatIDR(sub.planned_idr)}`)
            : tr(`Expected ${formatIDR(sub.planned_idr)}`, `Diperkirakan ${formatIDR(sub.planned_idr)}`)}
        </span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sp-date" className="block text-xs text-slate-500">{tr("Charged on", "Ditagih tanggal")}</label>
          <input id="sp-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        {isUsd && (
          <div>
            <label htmlFor="sp-usd" className="block text-xs text-slate-500">{tr("Dollars charged", "Dolar yang ditagih")}</label>
            <NumberInput id="sp-usd" value={dollars} onChange={setDollars} step={0.01} min={0} className="mt-1" />
          </div>
        )}
        <div className={isUsd ? "sm:col-span-2" : ""}>
          <label htmlFor="sp-idr" className="block text-xs text-slate-500">{tr("Rupiah that left", "Rupiah yang keluar")}</label>
          <MoneyInput id="sp-idr" value={rupiah} onChange={setRupiah} className="mt-1" />
        </div>
      </div>

      {rate && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          {tr("The rate it really went at:", "Kurs yang sebenarnya dipakai:")}{" "}
          <strong className="tabular-nums text-slate-800">Rp {Math.round(rate).toLocaleString("id-ID")}</strong>
          {off !== null && (
            <span className={off > 0 ? "text-amber-700" : "text-emerald-700"}>
              {" "}({off > 0 ? "+" : ""}{off.toFixed(1)}% {tr("against the plan rate", "dari kurs rencana")})
            </span>
          )}
        </p>
      )}

      <div>
        <label htmlFor="sp-note" className="block text-xs text-slate-500">{tr("Note (optional)", "Catatan (opsional)")}</label>
        <input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={tr("e.g. prorated upgrade", "mis. upgrade prorata")}
          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {existing && (
          <Button variant="ghost" size="sm" icon={Trash2} onClick={remove} disabled={busy}>
            {tr("Remove this payment", "Hapus pembayaran ini")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || rupiah <= 0 || !paidOn || (isUsd && dollars <= 0)}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
          </Button>
        </div>
      </div>
    </div>
  );
}
