"use client";

import { useEffect, useState } from "react";
import {
  Ban, CheckCircle2, Link2, ArrowUpRight, History, Pencil,
} from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents } from "@/demo/api";
import type { TransactionDetail } from "@/services/accounting/contracts";
import type { AuditRow } from "@/demo/state";
import type { AttachmentView } from "@/services/documents/contracts";
import { EvidenceStrip, type CoverTarget, type EvidenceSlot } from "@/components/ui/evidence-strip";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The documents a ledger row is expected to carry (owner, 2026-09-23).
 *  Money going out is a purchase: its nota, the transfer, a photo of what
 *  came, and the paper saying it arrived. Money coming in is proven by the
 *  transfer and, when there is one, the invoice it paid. */
const OUT_SLOTS: EvidenceSlot[] = [
  { kind: "Receipt / Invoice / Nota", label: "Receipt / Nota" },
  { kind: "Invoice", label: "Invoice", optional: true },
  { kind: "Payment Proof", label: "Payment proof" },
  { kind: "Receiving Item", label: "Item photo" },
  { kind: "Receiving Report", label: "Receiving report", optional: true },
];
const IN_SLOTS: EvidenceSlot[] = [
  { kind: "Payment Proof", label: "Payment proof" },
  { kind: "Invoice", label: "Invoice", optional: true },
];

/** How a History entry reads. The trail stores the seam's own verb; a person
 *  reading the row wants to know what happened to it. */
const ACTION_LABEL: Record<string, string> = {
  post: "Posted",
  edit: "Edited",
  void: "Voided",
  complete: "Marked completed",
  link: "Document attached",
  attach_link: "Document attached",
  unlink: "Document removed",
  attach_unlink: "Document removed",
};

/** One ledger row, and everything that hangs off it.
 *
 *  Three things live here that the old system kept in three different places:
 *  what the money was for (its lines), what it settled (its allocations, each
 *  naming a request line), and what proves it (documents attached **from
 *  here**, ADR-010 — the row is known because you navigated from it, so the
 *  form asks only what kind of document this is).
 *
 *  Correcting is VOID, never delete (A5): the row stays, the amount goes to
 *  zero, and the reason is mandatory. A deleted row cannot be asked about.
 *  A wrong amount or description is fixed in place with Edit (owner,
 *  2026-09-23) — an amount change needs a remark, and the audit log keeps
 *  both values.
 */
export function TrxDrawer({
  trxNo, onClose, onChanged,
}: {
  trxNo: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { hasAuthority } = useSession();
  const { toast } = useToast();
  const [trx, setTrx] = useState<TransactionDetail | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  /* Documents that live on the request lines this money paid for. The receipt
     photographed at the workshop door is visible from the bank row that
     funded it, without either of them being copied (ADR-010). */
  const [reached, setReached] = useState<{ label: string; attachments: AttachmentView[] }[]>([]);
  const [alsoCovers, setAlsoCovers] = useState<CoverTarget[]>([]);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [allocLine, setAllocLine] = useState("");
  const [allocAmount, setAllocAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAmount, setEditAmount] = useState(0);
  const [editDesc, setEditDesc] = useState("");
  const [editReason, setEditReason] = useState("");
  const mayPost = hasAuthority("post_ledger");

  useEffect(() => {
    setVoidOpen(false);
    setReason("");
    setEditOpen(false);
    if (!trxNo) { setTrx(null); setReached([]); return; }
    void load(trxNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trxNo]);

  async function load(no: string) {
    const [detail, trail] = await Promise.all([
      accounting.getTransaction(no),
      accounting.historyFor(no),
    ]);
    if (trail.data) setHistory(trail.data);
    if (!detail.data) return;
    setTrx(detail.data);
    setAllocAmount(detail.data.unallocated);

    /* Both directions of the money-to-document path: what the lines this row
       paid for already carry, and what else this row's own document could
       plausibly cover. */
    const lineNos = detail.data.allocations
      .map((a) => a.pr_line_no)
      .filter((x): x is string => !!x);
    const groups = await Promise.all(lineNos.map(async (lineNo) => ({
      label: lineNo,
      attachments: (await documents.byEntity("pr_line", lineNo)).data ?? [],
    })));
    setReached(groups);
    setAlsoCovers(lineNos.map((lineNo) => ({
      entity: "pr_line" as const, entity_no: lineNo, label: `The request line ${lineNo}`,
    })));
  }

  if (!trxNo || !trx) return null;

  async function allocate() {
    setBusy(true);
    const res = await accounting.allocate({
      trx_no: trx!.trx_no, pr_line_no: allocLine.trim(), amount: allocAmount,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not allocated", res.error.message);
      return;
    }
    toast("success", "Allocated", `${formatIDR(allocAmount)} → ${allocLine.trim()}`);
    setAllocLine("");
    await load(trx!.trx_no);
    onChanged();
  }

  async function voidIt() {
    setBusy(true);
    const res = await accounting.voidTransaction(trx!.trx_no, reason);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not voided", res.error.message);
      return;
    }
    toast("success", `${trx!.trx_no} voided`, "The row stays, the amount is zero, the reason is on it.");
    setVoidOpen(false);
    await load(trx!.trx_no);
    onChanged();
  }

  function openEdit() {
    setEditAmount(trx!.amount_idr);
    setEditDesc(trx!.description);
    setEditReason("");
    setVoidOpen(false);
    setEditOpen(true);
  }

  const amountChanged = !!trx && editAmount !== trx.amount_idr;
  const descChanged = !!trx && editDesc.trim() !== trx.description;

  async function saveEdit() {
    setBusy(true);
    const res = await accounting.editTransaction({
      trx_no: trx!.trx_no,
      ...(amountChanged ? { amount_idr: editAmount } : {}),
      ...(descChanged ? { description: editDesc.trim() } : {}),
      ...(editReason.trim() ? { reason: editReason.trim() } : {}),
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not saved", res.error.message);
      return;
    }
    toast("success", `${trx!.trx_no} updated`, "The change and its remark are in the audit log.");
    setEditOpen(false);
    await load(trx!.trx_no);
    onChanged();
  }

  async function complete() {
    setBusy(true);
    const res = await accounting.markComplete(trx!.trx_no);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not changed", res.error.message);
      return;
    }
    toast("success", `${trx!.trx_no} completed`, "Everything about it is finished.");
    await load(trx!.trx_no);
    onChanged();
  }

  return (
    <Drawer
      open={!!trxNo}
      onClose={onClose}
      title={trx.description}
      subtitle={`${trx.trx_no} · ${trx.trx_date} · ${trx.account_code}`}
      width="max-w-xl"
      footer={mayPost && trx.status !== "VOID" ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Voiding is for a row that should never have existed, and it is one
              click away from a row somebody was only reading. So it sits
              behind a deliberate step rather than beside the ordinary action
              (D89) — the button is there, it just cannot be hit by accident. */}
          <button
            onClick={() => { setEditOpen(false); setVoidOpen((v) => !v); }}
            className="mr-auto text-[12px] text-slate-400 underline decoration-dotted underline-offset-4 hover:text-rose-700"
          >
            Something wrong with this row?
          </button>
          <Button variant="outline" size="sm" icon={Pencil} disabled={busy} onClick={openEdit}>
            Edit
          </Button>
          {trx.status !== "COMPLETED" && (
            <Button variant="outline" size="sm" icon={CheckCircle2} disabled={busy} onClick={complete}>
              Mark completed
            </Button>
          )}
        </div>
      ) : null}
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind="trx" status={trx.status} />
          <Badge tone={trx.direction === "IN" ? "green" : "slate"}>{trx.direction}</Badge>
          <Badge tone="slate">{trx.type_code}</Badge>
          {trx.has_payment_proof && <Badge tone="violet">payment proof</Badge>}
          {/* Not a budget figure: the money is gone. This says only that a
              purchase names no request, which is the row worth asking about
              (D88). */}
          {trx.unallocated > 0 && trx.status !== "VOID" && trx.expects_allocation && (
            <Badge tone="amber">no request behind it</Badge>
          )}
        </div>

        {trx.void_reason && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">
            {trx.void_reason}
          </p>
        )}

        {editOpen && (
          <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 px-3 py-3" data-testid="trx-edit">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
              <Pencil className="h-4 w-4" /> Edit this entry
            </p>
            <div>
              <label htmlFor="trx-edit-amount" className="block text-xs text-slate-600">Amount</label>
              <MoneyInput id="trx-edit-amount" value={editAmount} onChange={setEditAmount} className="mt-1" />
              {amountChanged && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Was {formatIDR(trx.amount_idr)}
                  {trx.allocated_total > 0 && ` · ${formatIDR(trx.allocated_total)} already applied to requests — it cannot go below that`}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="trx-edit-desc" className="block text-xs text-slate-600">Description</label>
              <input
                id="trx-edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="trx-edit-reason" className="block text-xs text-slate-600">
                Remarks {amountChanged ? <span className="text-rose-700">— required when the amount changes</span> : "(optional)"}
              </label>
              <textarea
                id="trx-edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={2}
                placeholder="e.g. the nota says Rp 600.000, the transfer was typed wrong"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                size="sm"
                disabled={busy || (!amountChanged && !descChanged) || editAmount <= 0 || !editDesc.trim()
                  || (amountChanged && !editReason.trim())}
                onClick={saveEdit}
              >
                Save changes
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Every edit is recorded in the audit log with the old and new values, who made it and the remark.
            </p>
          </div>
        )}

        {voidOpen && (
          <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-3">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-rose-900">
              <Ban className="h-4 w-4" /> Void this entry
            </p>
            <p className="text-[12px] text-rose-800">
              Only for a row that should never have existed — a double entry, a
              wrong account. If only the amount or the description is wrong, use
              Edit instead.
            </p>
            <label htmlFor="void-reason" className="block text-xs text-rose-900">
              Why is this being voided? Required — a row with no reason cannot be asked about later.
            </label>
            <input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. entered twice, the first one is trx-26-08-29_002"
              className="w-full rounded-lg border border-rose-200 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setVoidOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={busy || !reason.trim()} onClick={voidIt}>
                Void this row
              </Button>
            </div>
            <p className="text-[11px] text-rose-800">
              The row stays and the amount goes to zero. Nothing is deleted — a
              correction is a new statement beside the old one, never an erasure.
            </p>
          </div>
        )}

        <dl className="space-y-2.5">
          {([
            ["Amount", formatIDR(trx.amount_idr)],
            ["Type", trx.type_code],
            ["Vendor", trx.vendor_name ?? "—"],
            ["Posted", `${trx.posted_at.slice(0, 10)}`],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>

        {trx.lines.length > 0 && (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">What it bought</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {trx.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 text-slate-700">{l.description}</span>
                  <span className="text-[11px] text-slate-400">
                    {l.qty ?? "—"} {l.uom ?? ""} × {formatIDR(l.unit_price ?? 0)}
                  </span>
                  <span className="tabular-nums text-slate-800">{formatIDR(l.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* What this money settled. Every allocation names a request line, so
            the path from a bank row back to who asked for it is one hop. */}
        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Link2 className="h-3.5 w-3.5" /> What it paid for
          </p>
          {trx.status === "VOID" && trx.allocations.length > 0 && (
            <p className="mb-2 text-[12px] text-rose-700">
              These no longer count towards anything: the transaction is void, so
              every line it funded is owed again. The rows stay so the history
              still reads.
            </p>
          )}
          {trx.allocations.length > 0 ? (
            <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {trx.allocations.map((a) => (
                <li key={a.id} className={cn("px-3 py-2 text-[13px]", a.superseded_by && "opacity-50")}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-700">{a.line_description ?? a.pr_line_no ?? a.po_no}</span>
                      <span className="block font-mono text-[10px] text-slate-400">
                        {a.pr_line_no ?? a.po_no} · {a.method}
                        {a.superseded_by && " · superseded"}
                      </span>
                    </span>
                    <span className="tabular-nums text-slate-800">{formatIDR(a.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[13px] text-slate-500">
              No request behind this one yet. Money that left with nothing asking
              for it is exactly the row worth a question, so it is shown rather
              than left to a report nobody runs.
            </p>
          )}

          {mayPost && trx.status !== "VOID" && trx.unallocated > 0 && trx.expects_allocation && (
            <div className="space-y-2 rounded-lg border border-dashed border-slate-300 px-3 py-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="alloc-line" className="block text-xs text-slate-500">Request line</label>
                  <input
                    id="alloc-line"
                    value={allocLine}
                    onChange={(e) => setAllocLine(e.target.value)}
                    placeholder="pr-26-09-04_01-L01"
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 font-mono text-[13px] focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="alloc-amount" className="block text-xs text-slate-500">Amount</label>
                  <MoneyInput id="alloc-amount" value={allocAmount} onChange={setAllocAmount} className="mt-1" />
                </div>
              </div>
              <Button size="sm" className="w-full" disabled={busy || !allocLine.trim() || allocAmount <= 0} onClick={allocate}>
                Point this money at that line
              </Button>
              <p className="text-[11px] text-slate-500">
                The line is checked against procurement before anything is written,
                and what is pointed at a line can never exceed what actually left
                the account.
              </p>
            </div>
          )}
        </section>

        {/* Evidence, attached from the row itself (ADR-010) — the same
            component the request line uses, because it is the same road. */}
        <EvidenceStrip
          entity="transaction"
          entityNo={trx.trx_no}
          canEdit={mayPost && trx.status !== "VOID"}
          defaultKind="Receipt / Invoice / Nota"
          slots={trx.direction === "IN" ? IN_SLOTS : OUT_SLOTS}
          alsoCovers={alsoCovers}
          reachedFrom={reached}
          onChanged={() => { void load(trx!.trx_no); onChanged(); }}
          note="Attached here, to this row — the system already knows the date, the account and the amount, so it only asks what kind of document this is."
        />

        {/* What has happened to this row. Fraud and anomaly questions are
            never "who touched the ledger this month" — they are "what happened
            to THIS row", asked while looking at it (D84). */}
        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <History className="h-3.5 w-3.5" /> History
          </p>
          {history.length === 0 ? (
            <p className="text-[13px] text-slate-500">Nothing recorded — this row predates the trail.</p>
          ) : (
            <ol className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px]">
                  <p className="text-slate-700">
                    <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                    {h.outcome !== "ok" && <span className="ml-1 text-rose-700">· {h.outcome}</span>}
                    <span className="text-slate-400"> · {h.actor_email} · {new Date(h.at).toLocaleString()}</span>
                  </p>
                  {h.reason && <p className="mt-0.5 text-slate-600">{h.reason}</p>}
                  {h.detail && (
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      {Object.entries(h.detail).map(([k, v]) => (
                        <li key={k}>
                          <span className="text-slate-400">{k}:</span>{" "}
                          {typeof v === "number" ? v.toLocaleString() : String(v)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {trx.pr_line_nos.length > 0 && (
          <p className="flex items-start gap-2 text-[12px] text-slate-500">
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Reaches{" "}
              <span className="font-mono text-slate-600">{trx.pr_line_nos.join(", ")}</span>{" "}
              on the requests board — same money, read from the other end.
            </span>
          </p>
        )}
      </div>
    </Drawer>
  );
}
