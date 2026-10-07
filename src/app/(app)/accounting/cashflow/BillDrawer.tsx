"use client";

import { useState } from "react";
import { Save, EyeOff, Link2 } from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { accounting } from "@/demo/api";
import type { CashflowCategory, CashflowRow } from "@/services/accounting/contracts";
import { CASHFLOW_OUT_CATEGORIES } from "@/services/accounting/contracts";
import { addMonths, growthFactor } from "@/services/accounting/cashflow";
import { useToast } from "@/store/toast";
import { useT, useTr } from "@/lib/i18n";
import { CATEGORY_LABEL, scheduleLabel } from "./shared";
import { GrowthFields, field, labelCls } from "./LineDrawer";

/** A monthly bill, as the cashflow sees it. The bill itself — its dates, its
 *  figure, its payments — belongs to the payment calendar or the subscription
 *  register. What is changed here is the projection only: a different amount,
 *  growth per month, or leaving it out. Accounting's calendar is untouched. */
export function BillDrawer({ row, onClose, onSaved }: { row: CashflowRow; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const t = useT();
  const { toast } = useToast();
  const thisMonth = officeToday().slice(0, 7);
  const l = row.line;
  const [category, setCategory] = useState<CashflowCategory>(l.category);
  const [follow, setFollow] = useState(l.amount === null);
  const [amount, setAmount] = useState(l.amount ?? row.base_amount ?? 0);
  const [growth, setGrowth] = useState(String(l.growth_pct ?? 0));
  const [growthFrom, setGrowthFrom] = useState(l.growth_from ?? thisMonth);
  const [note, setNote] = useState(l.note ?? "");
  const [busy, setBusy] = useState(false);
  const base = follow ? row.base_amount ?? 0 : amount;
  const g = Number(growth) || 0;
  const preview = g !== 0 && base > 0
    ? [0, 3, 6, 11].map((n) => {
      const m = addMonths(growthFrom, n);
      return [m, Math.round(base * growthFactor({ growth_pct: g, growth_from: growthFrom, starts_on: null }, m, thisMonth))] as const;
    })
    : null;

  async function save(hidden = false) {
    setBusy(true);
    const res = await accounting.saveCashflowBill({
      source_ref: row.key, name: l.name, category,
      amount: follow ? null : amount, growth_pct: g, growth_from: g ? growthFrom : null, hidden, note: note || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", hidden ? tr("Left out of the cashflow", "Tidak dihitung di cashflow") : tr("Projection updated", "Proyeksi diperbarui"), l.name);
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={l.name}
      subtitle={row.source === "subscription"
        ? tr("From the subscription register — its price and payments stay there.", "Dari daftar langganan — harga dan pembayarannya tetap di sana.")
        : tr("From the payment calendar — its dates and payments stay there.", "Dari kalender pembayaran — tanggal dan pembayarannya tetap di sana.")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" icon={EyeOff} onClick={() => save(true)} disabled={busy}>{tr("Leave out", "Jangan hitung")}</Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Save} onClick={() => save(false)} disabled={busy || (!follow && amount <= 0)}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-[12px]">
          <div><dt className="text-slate-500">{tr("On the calendar", "Di kalender")}</dt><dd className="font-semibold tabular-nums text-slate-800">{formatIDR(row.base_amount ?? 0)}</dd></div>
          <div><dt className="text-slate-500">{tr("Bill date", "Tanggal tagihan")}</dt><dd className="font-semibold text-slate-800">{scheduleLabel(row, tr)}</dd></div>
          <div><dt className="text-slate-500">{tr("Paid from", "Dibayar dari")}</dt><dd className="text-slate-800">{row.account_code ?? "—"}</dd></div>
          <div><dt className="text-slate-500">{tr("12 months, projected", "12 bulan, proyeksi")}</dt><dd className="tabular-nums text-slate-800">{formatIDRCompact(row.planned_total)}</dd></div>
        </dl>

        <div>
          <label htmlFor="cb-cat" className={labelCls}>{tr("Group", "Kelompok")}</label>
          <select id="cb-cat" value={category} onChange={(e) => setCategory(e.target.value as CashflowCategory)} className={field}>
            {CASHFLOW_OUT_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
          </select>
        </div>

        <div>
          <span className={labelCls}>{tr("Amount in the cashflow", "Nominal di cashflow")}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant={follow ? "primary" : "outline"} onClick={() => setFollow(true)}>{tr("Follow the calendar", "Ikut kalender")}</Button>
            <Button size="sm" variant={!follow ? "primary" : "outline"} onClick={() => setFollow(false)}>{tr("Own figure", "Nominal sendiri")}</Button>
          </div>
          {!follow && <MoneyInput value={amount} onChange={setAmount} className="mt-2" />}
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("Per occurrence. A month the calendar itself changed (a THR month) keeps the calendar's figure.",
              "Per kejadian. Bulan yang diubah di kalender sendiri (bulan THR) tetap memakai angka kalender.")}
          </p>
        </div>

        <GrowthFields growth={growth} setGrowth={setGrowth} growthFrom={growthFrom} setGrowthFrom={setGrowthFrom} preview={preview} />

        <div>
          <label htmlFor="cb-note" className={labelCls}>{tr("Why (optional)", "Alasan (opsional)")}</label>
          <input id="cb-note" value={note} onChange={(e) => setNote(e.target.value)} className={field}
            placeholder={tr("e.g. two new hires a month from November", "mis. dua tukang baru per bulan mulai November")} />
        </div>

        <Link href={row.source === "subscription" ? "/accounting/langganan" : "/accounting/calendar"}
          className="flex items-center gap-1.5 text-[12px] font-medium text-brand-700 hover:underline">
          <Link2 className="h-3.5 w-3.5" />
          {row.source === "subscription" ? tr("Open the subscription register", "Buka daftar langganan") : tr("Open the payment calendar", "Buka kalender pembayaran")}
        </Link>
      </div>
    </Drawer>
  );
}
