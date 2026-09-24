"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, Upload } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting, documents } from "@/demo/api";
import type { AccountBalance } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Paying an approved run from its own page (F154).
 *
 *  Until this existed a run stopped at APPROVED: `record_payroll_paid` wanted
 *  the number of a ledger row somebody had typed elsewhere, and no screen
 *  called it. `post_payroll_run` writes the one ledger row for the whole run —
 *  never a line per person, because the ledger is read more widely than pay is
 *  (D218) — and marks the run PAID in the same call.
 *
 *  The amount starts at *Diterima*. It is not held to it: which figure a run
 *  pays is still Q56, and the envelope reports both beside what was paid.
 */
export function PayRun({
  run, onPosted,
}: {
  run: { run_no: string; status: string; net_total: number; paid_trx_no?: string | null };
  onPosted: () => void;
}) {
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const mayPost = can("accounting.create") && hasAuthority("post_ledger");
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(Math.max(run.net_total, 0));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mayPost) return;
    void accounting.listAccounts().then((r) => {
      if (!r.data) return;
      const paying = r.data.filter((a) => a.is_paying && a.is_active !== false);
      setAccounts(paying);
      setAccountId((cur) => cur || paying[0]?.account_id || "");
    });
  }, [mayPost]);

  useEffect(() => { setAmount(Math.max(run.net_total, 0)); }, [run.run_no, run.net_total]);

  if (run.status === "PAID" && run.paid_trx_no) {
    return (
      <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-[13px] text-emerald-900">
        Sudah dibayar lewat{" "}
        <Link href={`/accounting/ledger?trx=${encodeURIComponent(run.paid_trx_no)}`} className="font-mono underline">
          {run.paid_trx_no}
        </Link>.
      </p>
    );
  }
  if (!mayPost || run.status !== "APPROVED") return null;

  async function post() {
    if (!file) {
      toast("warning", "Bukti dulu", "Pembayaran dicatat bersama buktinya — bukti transfer.");
      return;
    }
    setPosting(true);
    const up = await documents.upload({ file, kind: "Payment Proof" });
    if (up.error) { setPosting(false); toast("critical", "Upload gagal", up.error.message); return; }
    const res = await accounting.postPayrollRun({
      run_no: run.run_no, amount, account_id: accountId, trx_date: date, attachment_id: up.data.id,
    });
    setPosting(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Belum tercatat", res.error.message);
      return;
    }
    toast("success", `Tercatat sebagai ${res.data.trx_no}`, `${formatIDR(amount)} · ${run.run_no}`);
    setFile(null);
    onPosted();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Bayar run ini"
        subtitle="Satu baris buku besar untuk seluruh run, lalu run ini tertulis PAID. Gaji per orang tidak ditulis ke buku besar."
        icon={Banknote}
      />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
        <div>
          <label htmlFor="run-pay-date" className="block text-xs text-slate-500">Tanggal bayar</label>
          <input id="run-pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="run-pay-amount" className="block text-xs text-slate-500">Nominal dibayar</label>
          <MoneyInput id="run-pay-amount" value={amount} onChange={setAmount} className="mt-1" />
          <p className="mt-1 text-[11px] text-slate-500">Diterima menurut run: {formatIDR(run.net_total)}</p>
        </div>
        <div>
          <label htmlFor="run-pay-account" className="block text-xs text-slate-500">Dibayar dari</label>
          <select id="run-pay-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
            {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <input ref={fileRef} type="file" className="hidden" aria-label="Bukti transfer gaji"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <Button variant="outline" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
            {file ? file.name : "Lampirkan bukti transfer"}
          </Button>
          {amount !== run.net_total && amount > 0 && (
            <p className="mt-2 text-[12px] text-amber-800">
              Berbeda dari <em>Diterima</em> ({formatIDR(run.net_total)}). Tetap dicatat — mana yang
              dibayar sebuah run belum diputuskan (Q56) — dan keduanya tersimpan berdampingan.
            </p>
          )}
          <Button size="sm" className="mt-3 w-full" onClick={post}
            disabled={posting || !accountId || amount <= 0 || !file}>
            {posting ? "Mencatat…" : `Catat ${formatIDR(amount)} ke buku besar`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
