"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Upload, Link2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting, documents } from "@/demo/api";
import type { PrLineView } from "@/services/procurement/contracts";
import {
  TRANSACTION_TYPE_CODES, type AccountBalance, type TransactionTypeCode,
} from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Paying a line and writing the ledger row are one act, not two.
 *
 *  The old way was two people doing the same work twice: procurement marked
 *  the line paid and uploaded the proof, accounting typed the same amount into
 *  a spreadsheet and filed the same file. Nothing joined the two, so a
 *  disagreement between them could only be found by reading both.
 *
 *  Here the payment proof uploaded from a line IS the ledger entry: one
 *  transaction, allocated to this line, carrying the PR number in its
 *  description and the document attached to both records (D14, ADR-006).
 */
export function PayFromLine({
  line, proof, onPosted,
}: {
  line: PrLineView;
  /** A payment proof just attached to this line, offered as the ledger
   *  evidence so the same file is never uploaded twice. */
  proof: { id: string; filename: string } | null;
  onPosted: () => void;
}) {
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(line.coverage.remaining || line.coverage.approved);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<TransactionTypeCode>("SUPPLIERS");
  const [posting, setPosting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Two separate questions, and both have to be yes: may this person work in
   * accounting at all, and do they hold the authority to put a row in the
   * ledger (D24). */
  const mayPost = can("accounting.create") && hasAuthority("post_ledger");

  useEffect(() => {
    if (!mayPost) return;
    void accounting.listAccounts().then((r) => {
      if (!r.data) return;
      const paying = r.data.filter((a) => a.is_paying);
      setAccounts(paying);
      setAccountId((cur) => cur || paying[0]?.account_id || "");
    });
  }, [mayPost]);

  useEffect(() => {
    setAmount(line.coverage.remaining || line.coverage.approved);
  }, [line.id, line.coverage.remaining, line.coverage.approved]);

  if (!mayPost) return null;

  async function post() {
    if (!proof && !file) {
      /* No document, no ledger row (D85). The panel says so before the service
         has to refuse it. */
      toast("warning", "Proof first", "A payment is recorded with its proof — the transfer receipt or the nota.");
      return;
    }
    setPosting(true);
    let attachmentId = proof?.id;
    if (!attachmentId && file) {
      const up = await documents.upload({ file, kind: "Payment Proof" });
      if (up.error) { setPosting(false); toast("critical", "Upload failed", up.error.message); return; }
      attachmentId = up.data.id;
      await documents.link({
        attachment_id: up.data.id, entity: "pr_line",
        entity_no: line.line_no_full, kind: "Payment Proof",
      });
    }
    const res = await accounting.postFromLine({
      line_no: line.line_no_full, amount, account_id: accountId,
      trx_date: date, type_code: type, attachment_id: attachmentId!,
    });
    setPosting(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not posted", res.error.message);
      return;
    }
    toast("success", `Posted as ${res.data.trx_no}`, `${formatIDR(amount)} · ${line.line_no_full}`);
    setFile(null);
    onPosted();
  }

  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-800">
        <Banknote className="h-3.5 w-3.5" /> Record the payment
      </p>
      <p className="mt-1.5 text-[12px] text-brand-900">
        Posting from here writes the ledger row, allocates it to this line and
        files the document against both — the ledger entry carries{" "}
        <span className="font-mono">{line.line_no_full}</span>, so the payment
        and the request can never drift apart.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pay-date" className="block text-xs text-slate-500">Date paid</label>
          <input
            id="pay-date" type="date" value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="pay-amount" className="block text-xs text-slate-500">Amount paid</label>
          <MoneyInput id="pay-amount" value={amount} onChange={setAmount} className="mt-1" />
        </div>
        <div>
          <label htmlFor="pay-account" className="block text-xs text-slate-500">Paid from</label>
          <select
            id="pay-account" value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pay-type" className="block text-xs text-slate-500">Ledger type</label>
          <select
            id="pay-type" value={type}
            onChange={(e) => setType(e.target.value as TransactionTypeCode)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {TRANSACTION_TYPE_CODES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {amount !== line.coverage.remaining && line.coverage.remaining > 0 && (
        <p className="mt-2 text-[12px] text-amber-800">
          {formatIDR(line.coverage.remaining)} is what is still approved and
          unpaid. Posting {formatIDR(amount)} leaves a difference somebody will
          have to explain — which is fine, as long as it is on purpose.
        </p>
      )}

      {proof ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-2 text-[13px] text-slate-700">
          <Link2 className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1 truncate">{proof.filename}</span>
          <span className="text-[11px] text-slate-400">will be filed on the ledger row too</span>
        </p>
      ) : (
        <>
          <input
            ref={fileRef} id="pay-file" type="file" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
          />
          <Button
            variant="outline" size="sm" icon={Upload} className="mt-3"
            onClick={() => fileRef.current?.click()}
          >
            {file ? file.name : "Attach the payment proof"}
          </Button>
        </>
      )}

      {!proof && !file && (
        <p className="mt-2 text-[11px] text-amber-700">
          Attach the payment proof first — a ledger row without a document is a
          number somebody typed.
        </p>
      )}

      <Button
        size="sm" className="mt-3 w-full"
        onClick={post}
        disabled={posting || !accountId || amount <= 0 || (!proof && !file)}
      >
        {posting ? "Posting…" : `Post ${formatIDR(amount)} to the ledger`}
      </Button>
    </section>
  );
}
