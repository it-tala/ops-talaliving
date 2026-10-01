"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { procurement } from "@/demo/api";
import type { PoDetail } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Asking for the payment an order has earned (0203, D358).
 *
 *  Goods confirmed with the tanda terima make part of the order billable. This
 *  raises one request line **against** the order for it and submits it, so it
 *  is decided at the meeting like any other request. When that line is paid
 *  the payment names the order too, and the order's payment state (and its
 *  terms, the cicilan) moves without anybody pointing the money twice.
 *
 *  The database decides how much may be asked: billable now, less what is
 *  already asked for and not yet paid. Leaving the amount empty asks for all
 *  of it.
 */
export function RequestPayment({ po, onRequested }: { po: PoDetail; onRequested: () => void }) {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const unpaidGoods = Math.max(-po.status_view.exposure, 0);

  if (!can("procurement.create") || !can("procurement.update") || po.status !== "ISSUED") return null;

  async function ask() {
    setBusy(true);
    const res = await procurement.requestPoPayment({ po_no: po.po_no, amount: amount > 0 ? amount : null, note: note || null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not requested", "Tidak diajukan"), res.error.message);
      return;
    }
    setLast(res.data.line_no);
    setAmount(0);
    setNote("");
    toast("success", tr(`Requested as ${res.data.line_no}`, `Diajukan sebagai ${res.data.line_no}`), formatIDR(res.data.amount));
    onRequested();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Request payment (PR)", "Ajukan pembayaran (PR)")}
        subtitle={tr(
          "A request line against this order, sent to the meeting. When it is approved and paid, the payment reads on this order.",
          "Baris permintaan untuk PO ini, dikirim ke meeting. Setelah disetujui dan dibayar, pembayarannya tercatat di PO ini.",
        )}
        icon={Banknote}
      />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="po-req-amount" className="block text-xs text-slate-500">{tr("Amount", "Jumlah")}</label>
          <MoneyInput id="po-req-amount" value={amount} onChange={setAmount} className="mt-1"
            placeholder={tr("all that is billable", "semua yang bisa ditagih")} />
        </div>
        <div>
          <label htmlFor="po-req-note" className="block text-xs text-slate-500">{tr("Note", "Catatan")}</label>
          <input id="po-req-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("e.g. termin 2, delivery of 30 Sep", "mis. termin 2, kiriman 30 Sep")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        <Button disabled={busy} onClick={ask}>{busy ? tr("Requesting…", "Mengajukan…") : tr("Request", "Ajukan")}</Button>
        <p className="text-[11px] text-slate-500 sm:col-span-3">
          {unpaidGoods > 0
            ? tr(`${formatIDR(unpaidGoods)} of goods are here and not yet paid.`, `${formatIDR(unpaidGoods)} barang sudah tiba dan belum dibayar.`)
            : tr("Nothing arrived is unpaid — a down payment due on issue can still be asked for.", "Tidak ada barang tiba yang belum dibayar — DP yang jatuh tempo saat terbit tetap bisa diajukan.")}
          {last && <> · {tr("Last request:", "Pengajuan terakhir:")} <Link className="underline" href="/procurement/meeting">{last}</Link></>}
        </p>
      </div>
    </Card>
  );
}
