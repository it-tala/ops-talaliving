"use client";

/** Money between two of our own accounts, typed once (0282, L15).
 *
 *  Owner, 2026-10-15: *ketika transfer internal antar 2 rekening bank, cukup
 *  dimasukan sumber dana dari mana, misal BCA 271 ke Jenius, maka otomatis
 *  tercatat 2 transaksi IN dan OUT.* Until now a transfer was two entries
 *  typed separately, and the book shows what that costs: the halves do not
 *  match and nothing links the ones that do.
 *
 *  One form: from, to, amount, the bank's fee if there is one, the date, the
 *  proof. `post_transfer` writes the OUT, the IN and the fee as three ordinary
 *  rows with one `transfer_id`, or nothing at all. A leadership account can
 *  be either end — its leg is written too and read by `approve_funds` only
 *  (D391). When either end is a dollar account, the dollar amount is typed
 *  beside the rupiah: the dollar leg is written in dollars, the rupiah leg
 *  remembers the dollars, and the rate is computed, never typed (0285).
 */
import { useRef, useState } from "react";
import { ArrowRight, Upload, FileText, Save } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents } from "@/demo/api";
import { DOC_KINDS, PRIMARY_DOC_KINDS, type DocKind } from "@/services/documents/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

type DraftDoc = { attachment_id: string; filename: string; kind: DocKind };

export function TransferEntry({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0);
  const [description, setDescription] = useState("");
  /** The foreign leg's own amount when one end is not a rupiah account (0285). */
  const [billedAmt, setBilledAmt] = useState(0);
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [kind, setKind] = useState<DocKind>("Payment Proof");
  const [busy, setBusy] = useState(false);

  const rows = accounts.status === "ready" ? accounts.data.filter((a) => a.is_active !== false) : [];
  const from = rows.find((a) => a.account_id === fromId);
  const to = rows.find((a) => a.account_id === toId);
  const fromForeign = !!(from && from.currency && from.currency !== "IDR");
  const toForeign = !!(to && to.currency && to.currency !== "IDR");
  /** The one foreign currency in play, if any; two foreign ends are refused by the seam. */
  const foreign = fromForeign ? from!.currency! : toForeign ? to!.currency! : null;
  const hasPrimary = docs.some((d) => PRIMARY_DOC_KINDS.includes(d.kind));
  const canPost = !!from && !!to && from.account_id !== to.account_id && amount > 0 && fee >= 0
    && hasPrimary && (!foreign || billedAmt > 0);
  const autoName = from && to ? `Transfer ${from.code} → ${to.code}` : "";

  async function addFile(file: File) {
    const up = await documents.upload({ file, kind });
    if (up.error) { toast("critical", tr("Upload failed", "Unggah gagal"), up.error.message); return; }
    setDocs((d) => [...d, { attachment_id: up.data.id, filename: file.name, kind }]);
    if (up.data.reused) {
      toast("info", tr("Already in Drive from Google Chat", "Sudah ada di Drive dari Google Chat"),
        tr("The same file was linked instead of uploaded again.", "File yang sama ditautkan, tidak diunggah ulang."));
    }
  }

  async function post() {
    if (!from || !to) return;
    setBusy(true);
    const res = await accounting.postTransfer({
      from_account_id: from.account_id, to_account_id: to.account_id,
      amount_idr: Math.round(amount), fee: fee > 0 ? Math.round(fee) : null,
      trx_date: date, description: description.trim() || null,
      documents: docs.map((d) => ({ attachment_id: d.attachment_id, kind: d.kind })),
      ...(foreign ? { billed_currency: foreign, billed_amount: billedAmt } : {}),
    }, `transfer-${date}-${from.account_id}-${to.account_id}-${Math.round(amount)}`);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Transfer recorded", "Pindah dana tercatat"),
      tr(`${formatIDR(res.data.amount)} ${res.data.from_account} → ${res.data.to_account} · ${res.data.out_trx_no} and ${res.data.in_trx_no}${res.data.fee_trx_no ? ` · fee ${res.data.fee_trx_no}` : ""}`,
         `${formatIDR(res.data.amount)} ${res.data.from_account} → ${res.data.to_account} · ${res.data.out_trx_no} dan ${res.data.in_trx_no}${res.data.fee_trx_no ? ` · biaya ${res.data.fee_trx_no}` : ""}`));
    onPosted();
  }

  const select = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <Drawer
      open
      onClose={onClose}
      title={tr("Move money between our accounts", "Pindah dana antar rekening")}
      subtitle={tr("One entry — the OUT and the IN are written together", "Satu input — baris keluar dan masuk tercatat bersama")}
      width="max-w-xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[13px] tabular-nums text-slate-600">
            {formatIDR(Math.round(amount))}{fee > 0 ? tr(` + fee ${formatIDR(Math.round(fee))}`, ` + biaya ${formatIDR(Math.round(fee))}`) : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button size="sm" icon={Save} disabled={busy || !canPost} onClick={post} data-testid="tf-post">
            {busy ? tr("Recording…", "Mencatat…") : tr("Record the transfer", "Catat pindah dana")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <section className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tf-from" className="block text-xs text-slate-500">{tr("From", "Dari")}</label>
            <select id="tf-from" value={fromId} onChange={(e) => setFromId(e.target.value)} className={select}>
              <option value="">{tr("Choose…", "Pilih…")}</option>
              {rows.map((a) => <option key={a.account_id} value={a.account_id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tf-to" className="block text-xs text-slate-500">{tr("To", "Ke")}</label>
            <select id="tf-to" value={toId} onChange={(e) => setToId(e.target.value)} className={select}>
              <option value="">{tr("Choose…", "Pilih…")}</option>
              {rows.filter((a) => a.account_id !== fromId).map((a) => <option key={a.account_id} value={a.account_id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tf-amount" className="block text-xs text-slate-500">{toForeign && !fromForeign
              ? tr("Amount that left (IDR)", "Jumlah yang keluar (IDR)")
              : tr("Amount that arrived (IDR)", "Jumlah yang sampai (IDR)")}</label>
            <MoneyInput id="tf-amount" value={amount} onChange={setAmount} className="mt-1" />
          </div>
          <div>
            <label htmlFor="tf-fee" className="block text-xs text-slate-500">{tr("Bank fee (optional)", "Biaya bank (opsional)")}</label>
            <MoneyInput id="tf-fee" value={fee} onChange={setFee} className="mt-1" />
            <p className="mt-1 text-[11px] text-slate-500">{tr("Its own BANK CHARGES row on the source account.", "Jadi baris BANK CHARGES sendiri di rekening sumber.")}</p>
          </div>
          {foreign && (
            <div>
              <label htmlFor="tf-billed" className="block text-xs text-slate-500">{fromForeign
                ? tr(`Amount in ${foreign} that left ${from?.code}`, `Jumlah ${foreign} yang keluar dari ${from?.code}`)
                : tr(`Amount in ${foreign} that arrived in ${to?.code}`, `Jumlah ${foreign} yang sampai di ${to?.code}`)}</label>
              <NumberInput id="tf-billed" value={billedAmt} min={0} onChange={setBilledAmt} className="mt-1" />
              {billedAmt > 0 && amount > 0 && (
                <p className="mt-1 text-[11px] text-slate-500">{tr(`rate ${formatIDR(Math.round(amount / billedAmt))} per ${foreign}, computed`, `kurs ${formatIDR(Math.round(amount / billedAmt))} per ${foreign}, dihitung`)}</p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="tf-date" className="block text-xs text-slate-500">{tr("Date the money moved", "Tanggal uang bergerak")}</label>
            <input id="tf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={select} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="tf-desc" className="block text-xs text-slate-500">{tr("Description (optional)", "Keterangan (opsional)")}</label>
            <input id="tf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={autoName || tr("e.g. top up Jenius Cards", "mis. top up Jenius Cards")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          </div>
        </section>

        {from && to && (
          <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600" data-testid="tf-preview">
            <p className="flex items-center gap-2">
              <span className="font-medium text-slate-800">{from.code}</span>
              <span className="text-rose-700">− {formatIDR(Math.round(amount) + Math.round(fee))}</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-800">{to.code}</span>
              <span className="text-emerald-700">+ {formatIDR(Math.round(amount))}</span>
            </p>
            {(from.custody === "leadership" || to.custody === "leadership") && (
              <p className="mt-1">{tr("One end is a leadership account: its row is written too, and only approve_funds reads it.", "Salah satu ujungnya rekening pimpinan: barisnya ikut ditulis, dan hanya approve_funds yang membacanya.")}</p>
            )}
          </section>
        )}

        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <FileText className="h-3.5 w-3.5" /> {tr("Proof", "Bukti")}
          </p>
          {docs.length > 0 ? (
            <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {docs.map((d) => (
                <li key={d.attachment_id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-slate-700">{d.filename}</span>
                  <Badge tone={PRIMARY_DOC_KINDS.includes(d.kind) ? "green" : "slate"}>{d.kind}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setDocs((x) => x.filter((y) => y.attachment_id !== d.attachment_id))}>{tr("Remove", "Hapus")}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-[13px] text-slate-500">{tr("Nothing attached yet.", "Belum ada lampiran.")}</p>
          )}
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3">
            <label htmlFor="tf-kind" className="block text-xs text-slate-500">{tr("Document type", "Jenis dokumen")}</label>
            <select id="tf-kind" value={kind} onChange={(e) => setKind(e.target.value as DocKind)} className={select}>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>{k}{PRIMARY_DOC_KINDS.includes(k) ? "" : tr(" (supporting)", " (pendukung)")}</option>
              ))}
            </select>
            <input ref={fileRef} id="tf-file" type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = ""; }} />
            <Button variant="outline" size="sm" icon={Upload} className="mt-2 w-full" onClick={() => fileRef.current?.click()}>
              {tr("Attach the transfer proof", "Lampirkan bukti transfer")}
            </Button>
            <p className={cn("mt-2 text-[11px]", hasPrimary ? "text-slate-500" : "text-amber-700")}>
              {hasPrimary
                ? tr("The same proof is filed on every row of the transfer.", "Bukti yang sama terlampir di setiap baris transfer.")
                : tr("A transfer proof or bank statement is required — it is filed on both legs.", "Wajib ada bukti transfer atau rekening koran — dilampirkan di kedua kaki.")}
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
