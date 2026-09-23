"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Upload, Inbox, FileText, Check } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents, procurement } from "@/demo/api";
import type { AccountBalance, IncomingMoney } from "@/services/accounting/contracts";
import type { RoundSummary } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";

/** Marking a round funded, and the proof that says it was.
 *
 *  No proof, no transfer (D80). "Transferred" is a claim about the bank, and
 *  the old sheet's version of that claim was a tick somebody typed — which is
 *  why a round could read funded while the money was still sitting in the
 *  leadership account.
 *
 *  Two roads, because the money arrives two ways (D81):
 *
 *  **We move it.** Somebody in accounting makes the transfer and uploads the
 *  receipt here. Both ledger legs are written — out of the leadership account,
 *  into BCA 271 — and the file is filed against the receiving row. A transfer
 *  between our own accounts is two rows, not one; recording it once, on
 *  whichever side somebody was looking at, is how the two accounts came to
 *  disagree by exactly the amount that moved.
 *
 *  **Leadership moved it and dropped the proof in chat.** Then the money is
 *  already in the inbox, waiting to be booked. Booking it writes the IN row
 *  and files the same photo against it; the round then points at money that is
 *  already in the ledger rather than at a second, invented copy of it.
 */
export function TransferForm({
  round, onDone,
}: {
  round: RoundSummary;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [road, setRoad] = useState<"upload" | "booked">("upload");
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const [incoming, reloadIncoming] = useLoad(() => accounting.listIncoming(), []);
  const [waiting, reloadWaiting] = useLoad(() => accounting.listIncomingReview(), []);
  const [fromId, setFromId] = useState("");
  /* Defaults to what is still missing, not to the whole round: the second
     instalment is for the part the first one did not cover (D82). */
  const [amount, setAmount] = useState(round.transfer_shortfall || round.requested_total);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows: AccountBalance[] = accounts.status === "ready" ? accounts.data : [];
  const sources = rows.filter((a) => a.custody === "leadership" && a.is_active !== false);
  const target = rows.find((a) => a.code === "BCA 271");

  useEffect(() => {
    setFromId((cur) => cur || sources[0]?.account_id || "");
  }, [sources]);

  useEffect(() => {
    setAmount(round.transfer_shortfall || round.requested_total);
  }, [round.round_no, round.transfer_shortfall, round.requested_total]);

  /** Road one: we moved it, here is the receipt. */
  async function recordWithUpload() {
    if (!target) { toast("critical", "No paying account", "BCA 271 is not in the account list."); return; }
    if (!file) { toast("warning", "Proof first", "A round is funded when there is proof it was funded."); return; }
    setBusy(true);

    const up = await documents.upload({ file, kind: "Payment Proof" });
    if (up.error) { setBusy(false); toast("critical", "Upload failed", up.error.message); return; }

    const label = `Round ${round.round_no} funding`;
    /* Out of the leadership account first: if the second leg fails, the books
       show money that left and has not landed, which somebody can see and
       correct. The reverse would show money appearing from nowhere. */
    const out = await accounting.postTransaction({
      trx_date: date, account_id: fromId, direction: "OUT", amount_idr: amount,
      type_code: "CASHFLOW", description: `${label} — transfer to BCA 271`,
      /* One source_ref per instalment, so a second transfer is a second pair
         of rows and a retry of the first is still a duplicate (A4). */
      source_ref: `round:${round.round_no}:out:${round.transfers.length + 1}`,
      /* The same receipt proves both legs — one file, two links. A ledger row
         cannot exist without evidence (D85), and inventing a second copy of
         the same photo would only make the duplicate check ring. */
      documents: [{ attachment_id: up.data.id, kind: "Payment Proof" }],
    });
    if (out.error) {
      setBusy(false);
      toast(out.error.status === 403 ? "critical" : "warning", "Not recorded", out.error.message);
      return;
    }

    const inLeg = await accounting.postTransaction({
      trx_date: date, account_id: target.account_id, direction: "IN", amount_idr: amount,
      type_code: "CASHFLOW",
      description: `${label} — from ${rows.find((a) => a.account_id === fromId)?.code ?? "leadership"}`,
      source_ref: `round:${round.round_no}:in:${round.transfers.length + 1}`,
      documents: [{ attachment_id: up.data.id, kind: "Payment Proof" }],
    });
    if (inLeg.error) {
      setBusy(false);
      toast("critical", "Half recorded", `${out.data.trx_no} left the leadership account but the receiving leg failed: ${inLeg.error.message}`);
      return;
    }

    await finish(amount, inLeg.data.trx_no, up.data.id);
  }

  /** Road two: it is already in the ledger — point at it. */
  async function fundFromBooked(row: IncomingMoney) {
    if (!row.proof_attachment_id) {
      toast("warning", "No proof on that row", "That money is booked but has no transfer receipt filed against it. Attach one to the transaction first.");
      return;
    }
    setBusy(true);
    await finish(row.amount_idr, row.trx_no, row.proof_attachment_id);
  }

  /** Road two, first half: book what leadership dropped in chat. */
  async function bookFromChat(refId: string, amountIdr: number) {
    if (!target) return;
    setBusy(true);
    const res = await accounting.confirmIncoming({
      ref_id: refId, account_id: target.account_id, trx_date: date, amount_idr: amountIdr,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not booked", res.error.message);
      return;
    }
    toast("success", `Booked as ${res.data.trx_no}`, `${formatIDR(res.data.amount_idr)} into BCA 271`);
    reloadWaiting();
    reloadIncoming();
  }

  async function finish(amt: number, trxNo: string, proofId: string) {
    const res = await procurement.transferRound(round.round_no, {
      amount: amt, trx_no: trxNo, proof_attachment_id: proofId,
    });
    setBusy(false);
    if (res.error) {
      toast("warning", "Ledger written, round unchanged", `${trxNo} is posted. ${res.error.message}`);
      return;
    }
    toast("success", `Transferred ${formatIDR(amt)}`, `${trxNo} — no item is paid by this`);
    setFile(null);
    onDone();
  }

  /* A ledger row already counted against this round is not offered again. */
  const used = new Set(round.transfers.map((t) => t.trx_no));
  const booked: IncomingMoney[] = incoming.status === "ready"
    ? incoming.data.filter((r) => !used.has(r.trx_no))
    : [];
  const chatRows = waiting.status === "ready" ? waiting.data : [];

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3">
      {round.transfers.length > 0 && (
        <p className="mb-3 text-[13px] text-slate-600">
          {formatIDR(round.transferred_total)} has come in already ·{" "}
          <span className="font-medium text-amber-700">{formatIDR(round.transfer_shortfall)} still short</span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {([
          ["upload", "We transferred it", Upload],
          ["booked", `Money already in${chatRows.length ? ` · ${chatRows.length} waiting` : ""}`, Inbox],
        ] as [typeof road, string, typeof Upload][]).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setRoad(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors",
              road === key
                ? "border-brand-300 bg-brand-50 text-brand-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {road === "upload" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="tf-date" className="block text-xs text-slate-500">Date</label>
              <input
                id="tf-date" type="date" value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="tf-from" className="block text-xs text-slate-500">From</label>
              <select
                id="tf-from" value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                {sources.map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.code} — {formatIDR(a.balance)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tf-amount" className="block text-xs text-slate-500">Amount</label>
              <MoneyInput id="tf-amount" value={amount} onChange={setAmount} className="mt-1" />
            </div>
            <div>
              <label className="block text-xs text-slate-500" htmlFor="tf-file">Transfer receipt</label>
              <input
                ref={fileRef} id="tf-file" type="file" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
              />
              <Button
                variant="outline" size="sm" icon={Upload}
                className="mt-1 w-full"
                onClick={() => fileRef.current?.click()}
              >
                <span className="truncate">{file ? file.name : "Choose the proof"}</span>
              </Button>
            </div>
          </div>

          <Button
            size="sm" icon={ArrowRightLeft} className="mt-3"
            disabled={busy || !fromId || amount <= 0 || !file}
            onClick={recordWithUpload}
          >
            {busy ? "Recording…" : `Record ${formatIDR(amount)} with its proof`}
          </Button>
          <p className="mt-2 text-[11px] text-slate-500">
            Writes both legs — out of the leadership account, into BCA 271 — files
            the receipt against the receiving row, and marks the round funded. It
            marks nothing paid: money reaching our own account is not a vendor
            being paid.
          </p>
        </>
      ) : (
        <div className="space-y-3">
          {chatRows.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-800">
                Waiting to be booked — sent to chat
              </p>
              <ul className="mt-2 space-y-2">
                {chatRows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-slate-700">
                        {r.extracted.note ?? "Transfer proof"}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {r.reported_at.slice(0, 10)} · read as {formatIDR(r.extracted.amount_idr ?? 0)}
                        {r.extracted.confidence != null && ` · ${r.extracted.confidence}% sure`}
                      </span>
                    </span>
                    <Button
                      size="sm" variant="outline" icon={Check} disabled={busy}
                      onClick={() => bookFromChat(r.ref_id, r.extracted.amount_idr ?? 0)}
                    >
                      Book as money in
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-amber-800">
                The reading is a proposal, never a posting — booking it is a person
                agreeing with the number.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Booked into BCA 271
            </p>
            {booked.length === 0 ? (
              <p className="text-[13px] text-slate-500">Nothing has come into BCA 271 yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {booked.map((row) => (
                  <li key={row.trx_no} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-slate-700">{row.description}</span>
                      <span className="block font-mono text-[10px] text-slate-400">
                        {row.trx_no} · {row.trx_date}
                      </span>
                    </span>
                    <span className="tabular-nums text-[13px] font-medium text-slate-800">
                      {formatIDR(row.amount_idr)}
                    </span>
                    {row.proof_filename
                      ? <Badge tone="violet">proof on file</Badge>
                      : <Badge tone="amber">no proof</Badge>}
                    <Button
                      size="sm" variant="outline" disabled={busy || !row.proof_attachment_id}
                      onClick={() => fundFromBooked(row)}
                    >
                      Fund this round
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
