"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { accounting } from "@/demo/api";
import type {
  SubscriptionCurrency, SubscriptionCycle, SubscriptionPriceKind, SubscriptionView,
} from "@/services/accounting/contracts";
import { plannedIdr } from "@/services/accounting/subscriptions";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { usd } from "./PayModal";

const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

/** One subscription: what it is, how often it is billed, whether the price is
 *  fixed or pay as you go, the currency, and how it is paid.
 *
 *  The payment method is an account from master data and nothing else — no
 *  card is managed here and nothing is posted to the ledger. */
export function SubscriptionDrawer({ sub, usdIdr, onClose, onSaved }: {
  sub: SubscriptionView | null; usdIdr: number; onClose: () => void; onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [accounts] = useLoad(() => accounting.listAccountRows(), []);
  const [name, setName] = useState(sub?.name ?? "");
  const [provider, setProvider] = useState(sub?.provider ?? "");
  const [email, setEmail] = useState(sub?.login_email ?? "");
  const [cycle, setCycle] = useState<SubscriptionCycle>(sub?.cycle ?? "monthly");
  const [kind, setKind] = useState<SubscriptionPriceKind>(sub?.amount_kind ?? "fixed");
  const [currency, setCurrency] = useState<SubscriptionCurrency>(sub?.currency ?? "USD");
  const [amount, setAmount] = useState(sub?.amount ?? 0);
  const [startOn, setStartOn] = useState(sub?.start_on ?? officeToday());
  const [endsOn, setEndsOn] = useState(sub?.ends_on ?? "");
  const [accountId, setAccountId] = useState(sub?.account_id ?? "");
  const [note, setNote] = useState(sub?.note ?? "");
  const [busy, setBusy] = useState(false);

  const idr = plannedIdr({ currency, amount }, usdIdr);

  async function save() {
    setBusy(true);
    const res = await accounting.saveSubscription({
      name, provider: provider || null, login_email: email || null, cycle, amount_kind: kind,
      currency, amount, start_on: startOn, ends_on: endsOn || null,
      account_id: accountId || null, note: note || null,
    }, sub?.id ?? null);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", sub ? tr("Updated", "Diperbarui") : tr("Subscription added", "Langganan ditambahkan"), `${name} · ${formatIDR(idr)}`);
    onSaved();
  }

  const seg = <T extends string>(value: T, set: (v: T) => void, items: [T, string][], label: string) => (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[12px]" role="radiogroup" aria-label={label}>
      {items.map(([k, text]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => set(k)}
          className={value === k ? "rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white" : "rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-50"}>
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={sub ? sub.name : tr("New subscription", "Langganan baru")}
      subtitle={tr("How it is billed, in which currency, and how it is paid.", "Cara penagihannya, mata uangnya, dan cara membayarnya.")}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !name.trim() || amount <= 0 || !startOn}>
            {busy ? tr("Saving…", "Menyimpan…") : sub ? tr("Save", "Simpan") : tr("Add it", "Tambahkan")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="sd-name" className="block text-xs text-slate-500">{tr("Service", "Layanan")}</label>
          <input id="sd-name" value={name} onChange={(e) => setName(e.target.value)} className={field}
            placeholder={tr("e.g. Supabase", "mis. Supabase")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sd-provider" className="block text-xs text-slate-500">{tr("Vendor", "Vendor")}</label>
            <input id="sd-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="sd-email" className="block text-xs text-slate-500">{tr("Registered to (email)", "Terdaftar atas (email)")}</label>
            <input id="sd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <span className="block text-xs text-slate-500">{tr("Billed", "Ditagih")}</span>
          <div className="mt-1">
            {seg(cycle, setCycle, [
              ["monthly", tr("Monthly", "Bulanan")],
              ["yearly", tr("Yearly", "Tahunan")],
              ["biennial", tr("Every 2 years", "Setiap 2 tahun")],
            ], tr("Billing cycle", "Siklus tagihan"))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {cycle === "monthly"
              ? tr("The same day every month.", "Tanggal yang sama setiap bulan.")
              : tr("One large charge in one month of the calendar — not a twelfth of it every month.", "Satu tagihan besar di satu bulan kalender — bukan seperduabelas setiap bulan.")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="block text-xs text-slate-500">{tr("Price", "Harga")}</span>
            <div className="mt-1">
              {seg(kind, setKind, [
                ["fixed", tr("Fixed", "Tetap")],
                ["payg", tr("Pay as you go", "Sesuai pemakaian")],
              ], tr("Price kind", "Jenis harga"))}
            </div>
          </div>
          <div>
            <span className="block text-xs text-slate-500">{tr("Billed in", "Ditagih dalam")}</span>
            <div className="mt-1">
              {seg(currency, setCurrency, [["USD", "USD"], ["IDR", "IDR"]], tr("Currency", "Mata uang"))}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="sd-amount" className="block text-xs text-slate-500">
            {kind === "payg" ? tr("Expected per billing", "Perkiraan per tagihan") : tr("Amount per billing", "Jumlah per tagihan")}
            {" "}({currency})
          </label>
          {currency === "USD"
            ? <NumberInput id="sd-amount" value={amount} onChange={setAmount} step={0.01} min={0} className="mt-1" />
            : <MoneyInput id="sd-amount" value={amount} onChange={setAmount} className="mt-1" />}
          <p className="mt-1 text-[11px] text-slate-500">
            {currency === "USD"
              ? tr(`${usd(amount)} × Rp ${usdIdr.toLocaleString("id-ID")} = ${formatIDR(idr)} at the plan rate. Include the vendor's VAT if it charges one.`,
                `${usd(amount)} × Rp ${usdIdr.toLocaleString("id-ID")} = ${formatIDR(idr)} dengan kurs rencana. Sertakan PPN bila vendor menariknya.`)
              : kind === "payg"
                ? tr("Billed on use — whatever is charged settles it.", "Ditagih sesuai pemakaian — berapa pun yang ditagih melunasinya.")
                : tr("A payment below this is still recorded as paid; the difference is shown.", "Pembayaran di bawah ini tetap tercatat lunas; selisihnya ditampilkan.")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sd-start" className="block text-xs text-slate-500">
              {cycle === "monthly" ? tr("A billing date (sets the day)", "Satu tanggal tagih (menentukan harinya)") : tr("Next billing date", "Tanggal tagih berikutnya")}
            </label>
            <input id="sd-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="sd-end" className="block text-xs text-slate-500">{tr("Ends on (optional)", "Berakhir (opsional)")}</label>
            <input id="sd-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="sd-account" className="block text-xs text-slate-500">{tr("Paid with", "Dibayar dengan")}</label>
          <select id="sd-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
            <option value="">{tr("— not set —", "— belum diisi —")}</option>
            {(accounts.status === "ready" ? accounts.data : []).filter((a) => a.is_active).map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("From master data · Accounts. Only a label: nothing is posted to the ledger.", "Dari master data · Rekening. Hanya label: tidak ada yang diposting ke ledger.")}
          </p>
        </div>

        <div>
          <label htmlFor="sd-note" className="block text-xs text-slate-500">{tr("Note (optional)", "Catatan (opsional)")}</label>
          <input id="sd-note" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </div>
      </div>
    </Drawer>
  );
}
