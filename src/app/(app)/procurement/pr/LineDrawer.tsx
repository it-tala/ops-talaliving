"use client";

import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, Pencil, Save, Upload, FileText } from "lucide-react";
import { Badge, Button, Progress } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, documents } from "@/demo/api";
import {
  MEETING_STATE_LABEL, PR_CATEGORIES,
  type PrLineView, type UomCode, type PrCategory,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { EvidenceStrip } from "@/components/ui/evidence-strip";
import { VariancePanel } from "./VariancePanel";
import { DecisionPanel } from "./DecisionPanel";
import { PayFromLine } from "./PayFromLine";
import { UomOptions } from "@/components/ui/uom-options";

/** One item, everything about it.
 *
 *  Evidence is attached from HERE, standing on the line, rather than uploaded
 *  somewhere central and matched to a line afterwards (ADR-010). The parent is
 *  known because you navigated from it, so the form asks only what kind of
 *  document this is.
 */
export function LineDrawer({
  line, onClose, onChanged, onRemove, others,
}: {
  line: PrLineView | null;
  onClose: () => void;
  onChanged: (l: PrLineView) => void;
  onRemove: (l: PrLineView) => void;
  /** The rest of the board, so a document can be pointed at the sibling lines
   *  of the same submission without a second lookup. */
  others?: PrLineView[];
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PrLineView>>({});
  const [saving, setSaving] = useState(false);
  /* A payment proof just attached here, held so the ledger form can reuse the
     same file instead of asking for it a second time. */
  const [proof, setProof] = useState<{ id: string; filename: string } | null>(null);
  const mayEdit = can("procurement.update");

  /* Editable until somebody approves it, not merely while it is a draft
     (D66). The API is the guard; this only decides whether to offer it. */
  const editable = !!line && !line.approval?.approved && !line.removed_at && line.coverage.covered === 0;

  useEffect(() => {
    setEditing(false);
    setProof(null);
  }, [line?.id]);

  if (!line) return null;

  function startEdit() {
    setDraft({
      description: line!.description, qty: line!.qty, uom: line!.uom,
      unit_price: line!.unit_price, category: line!.category,
      purpose: line!.purpose, need_by: line!.need_by,
      item_total: line!.item_total,
    });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const res = await procurement.updateLine(line!.line_no_full, {
      description: draft.description ?? "",
      qty: draft.qty ?? null,
      uom: draft.uom ?? null,
      unit_price: draft.unit_price ?? null,
      category: draft.category ?? null,
      purpose: (draft.purpose ?? "").toString().trim() || null,
      need_by: draft.need_by ?? null,
      /* Sent explicitly, because the amount is not always quantity × price:
         a service line has neither, and the total is the only figure it has. */
      item_total: draft.item_total ?? 0,
    });
    setSaving(false);
    if (res.error) { toast(res.error.status === 409 ? "warning" : "critical", "Not saved", res.error.message); return; }
    toast("success", "Line updated", line!.line_no_full);
    setEditing(false);
    onChanged(res.data);
  }

  /* The other items in the same submission: one invoice often covers several
     of them, and pointing at them is a first-class action rather than three
     uploads of the same photograph. */
  const siblings = (others ?? [])
    .filter((l) => l.doc_no === line.doc_no && l.id !== line.id)
    .map((l) => ({ entity: "pr_line" as const, entity_no: l.line_no_full, label: `${l.description} · ${l.line_no_full}` }));

  async function refreshLine() {
    const relist = await procurement.listAllLines();
    const updated = relist.data?.find((l) => l.id === line!.id);
    if (updated) onChanged(updated);
  }

  const cov = line.coverage;
  const pct = cov.approved > 0 ? (cov.covered / cov.approved) * 100 : 0;

  return (
    <Drawer
      open={!!line}
      onClose={onClose}
      title={line.description}
      subtitle={`${line.line_no_full} · ${line.requested_by_name}`}
      width="max-w-xl"
      footer={
        mayEdit ? (
          editing ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button size="sm" icon={Save} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save line"}</Button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {!line.removed_at && (
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onRemove(line)}>
                  No longer needed
                </Button>
              )}
              {editable && (
                <Button variant="outline" size="sm" icon={Pencil} onClick={startEdit}>Edit item</Button>
              )}
            </div>
          )
        ) : null
      }
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind="line" status={line.status} />
          <Badge tone={
            line.meeting_state === "settled" ? "green"
              : line.meeting_state === "paid_unapproved" ? "red"
                : line.meeting_state === "approved_unpaid" ? "brand" : "amber"
          }>
            {MEETING_STATE_LABEL[line.meeting_state]}
          </Badge>
          {line.has_payment_proof && <Badge tone="violet">payment proof on file</Badge>}
          {/* A line can be COMPLETED and still owe an answer. Without this the
              header would read "Approved and paid" over a Rp 225.000 overpayment. */}
          {line.variance.material && !line.variance.explanation && (
            <Badge tone="red">difference not explained</Badge>
          )}
          {/* Which job on the floor this was bought for. It is what lets the
              purchase be counted against that job's BOM projection (D152). */}
          {line.source_wo_no && (
            <Link href="/produksi/jadwal">
              <Badge tone="slate">untuk {line.source_wo_no}</Badge>
            </Link>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="ed-desc" className="block text-xs text-slate-500">Item</label>
              <input id="ed-desc" value={draft.description ?? ""}
                     onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                     className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="ed-purpose" className="block text-xs text-slate-500">What is it for</label>
              <input id="ed-purpose" value={(draft.purpose ?? "") as string}
                     onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                     placeholder="e.g. Table tops, VILLA SEMINYAK"
                     className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label htmlFor="ed-qty" className="block text-xs text-slate-500">Qty</label>
                <NumberInput
                  id="ed-qty"
                  value={draft.qty ?? 0}
                  onChange={(v) => setDraft({
                    ...draft, qty: v, item_total: Math.round(v * (draft.unit_price ?? 0)),
                  })}
                  min={0}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="ed-uom" className="block text-xs text-slate-500">Unit</label>
                <select id="ed-uom" value={draft.uom ?? "pcs"}
                        onChange={(e) => setDraft({ ...draft, uom: e.target.value as UomCode })}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                  <UomOptions current={draft.uom ?? "pcs"} />
                </select>
              </div>
              <div className="col-span-2">
                <label htmlFor="ed-price" className="block text-xs text-slate-500">Unit price</label>
                <MoneyInput
                  id="ed-price"
                  value={draft.unit_price ?? 0}
                  onChange={(v) => setDraft({
                    ...draft,
                    unit_price: v,
                    /* The amount follows the price while both parts exist. */
                    item_total: Math.round((draft.qty ?? 0) * v),
                  })}
                  className="mt-1"
                />
              </div>
              <div className="col-span-2 sm:col-span-4">
                <label htmlFor="ed-total" className="block text-xs text-slate-500">
                  Amount <span className="text-slate-400">— editable on its own, for a line with no quantity</span>
                </label>
                <MoneyInput
                  id="ed-total"
                  value={draft.item_total ?? 0}
                  onChange={(v) => setDraft({ ...draft, item_total: v })}
                  className="mt-1"
                />
                {/* Said, not corrected: a vendor quoting a lump sum for two
                    sets is a real thing, and silently overwriting the figure
                    somebody typed is how a screen loses trust. */}
                {draft.qty != null && draft.unit_price != null
                  && Math.round(draft.qty * draft.unit_price) !== draft.item_total && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {formatNumber(draft.qty)} × {formatIDR(draft.unit_price)} ={" "}
                    {formatIDR(Math.round(draft.qty * draft.unit_price))} — the amount above
                    is different, and it is the one that will be used.
                  </p>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="ed-cat" className="block text-xs text-slate-500">Category</label>
              <select id="ed-cat" value={draft.category ?? "OTHER"}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value as PrCategory })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                {PR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <>
            {line.purpose ? (
              <div className="rounded-lg bg-brand-50/60 px-3 py-2.5 text-[13px] text-brand-900">
                {line.purpose}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-[13px] text-slate-500">
                No note on what this is for. Approving a price without knowing the job
                is guesswork.
              </p>
            )}

            <dl className="space-y-2.5">
              {([
                ["Quantity", line.qty != null ? `${formatNumber(line.qty)} ${line.uom ?? ""}` : "—"],
                ["Unit price", line.unit_price != null ? formatIDR(line.unit_price) : "—"],
                ["Requested", formatIDR(line.item_total)],
                ["Approved", line.approval?.approved ? formatIDR(line.approval.approved_amount ?? line.item_total) : "not yet"],
                ["Vendor", line.vendor_name ?? "not decided"],
                ["Category", line.category ?? "—"],
                ["Needed by", line.need_by ?? "—"],
                ["From", `${line.doc_no}${line.submitted_at ? ` · ${line.submitted_at.slice(0, 10)}` : ""}`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>

            <DecisionPanel line={line} onChanged={onChanged} />

            {cov.covered > 0 && (
              <div>
                <Progress value={pct} tone={cov.settled ? "green" : "amber"} />
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatIDR(cov.covered)} of {formatIDR(cov.approved)} covered
                  {/* Owed and short are not the same thing: once somebody has
                      explained the gap, the rest was never spent. */}
                  {cov.remaining > 0 && (cov.settled
                    ? ` · closed ${formatIDR(cov.remaining)} short`
                    : ` · ${formatIDR(cov.remaining)} still owed`)}
                </p>
              </div>
            )}

            <VariancePanel line={line} onChanged={onChanged} />

            {line.trx_nos.length > 0 && (
              <p className="text-[12px] text-slate-500">
                Paid by{" "}
                <span className="font-mono text-slate-600">{line.trx_nos.join(", ")}</span>
                {" "}— the same money, read from the ledger rather than repeated here.
              </p>
            )}

            {/* Only on an approved line. Money moving before a yes is a real
                event and the ledger records it when it happens — but the
                application will not offer it as an ordinary button (D21). */}
            {line.approval?.approved && !cov.settled && !line.removed_at && (
              <PayFromLine
                line={line}
                proof={proof}
                onPosted={async () => {
                  setProof(null);
                  await refreshLine();
                }}
              />
            )}

            {/* Evidence, attached from the line itself (ADR-010). The same
                component serves the ledger row: it is the same road. */}
            <EvidenceStrip
              entity="pr_line"
              entityNo={line.line_no_full}
              canEdit={mayEdit}
              defaultKind="Payment Proof"
              alsoCovers={siblings}
              onChanged={async () => {
                await refreshLine();
                /* Whatever was just filed as a payment proof is offered to the
                   ledger form below, so the same file is never uploaded twice. */
                const docs = await documents.byEntity("pr_line", line!.line_no_full);
                const latest = docs.data
                  ?.filter((a) => a.links.some((l) => l.kind === "Payment Proof"))
                  .slice(-1)[0];
                if (latest) setProof({ id: latest.id, filename: latest.filename });
              }}
              note="Attached here, to this item — the system already knows which line, which vendor and which amount, so it only asks what kind of document this is."
            />

          </>
        )}
      </div>
    </Drawer>
  );
}
