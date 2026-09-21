"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, Upload, FileText, Save } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents, procurement } from "@/demo/api";
import {
  TRANSACTION_TYPE_CODES, type Direction, type TransactionTypeCode,
} from "@/services/accounting/contracts";
import {
  DOC_KINDS, PRIMARY_DOC_KINDS, type DocKind,
} from "@/services/documents/contracts";
import { UNITS, type UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";

/** Writing a row into the ledger, with everything a row is supposed to have.
 *
 *  Two rules are enforced here rather than hoped for:
 *
 *  **No document, no row** (D85). At least one nota, transfer proof or photo
 *  of what arrived. A delivery note or the PO can come with it, but neither
 *  can stand alone — supporting is not proof. The files are uploaded and
 *  linked in the same act as the row, so an undocumented row never exists,
 *  not even for a moment.
 *
 *  **A purchase says what it bought** (D86): quantity, unit price and who it
 *  was bought from. An amount on its own cannot be compared to the last time
 *  we bought the same thing, which is the only way a price is ever found to
 *  be wrong.
 */
type DraftLine = { key: string; description: string; qty: number; uom: UomCode; unit_price: number };
type DraftDoc = { attachment_id: string; filename: string; kind: DocKind };

export function NewEntry({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const { toast } = useToast();
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const [vendors] = useLoad(() => procurement.listVendors({}), []);
  const [types] = useLoad(() => accounting.listTypeRows(), []);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<Direction>("OUT");
  const [typeCode, setTypeCode] = useState<TransactionTypeCode>("SUPPLIERS");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { key: "l1", description: "", qty: 1, uom: "pcs", unit_price: 0 },
  ]);
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [kind, setKind] = useState<DocKind>("Receipt / Invoice / Nota");
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(2);
  const fileRef = useRef<HTMLInputElement>(null);

  const isPurchase = types.status === "ready"
    ? types.data.find((t) => t.code === typeCode)?.is_purchase ?? false
    : false;
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price), 0);
  const hasPrimary = docs.some((d) => PRIMARY_DOC_KINDS.includes(d.kind));
  const payingAccounts = accounts.status === "ready" ? accounts.data : [];

  function patch(key: string, next: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  async function addFile(file: File) {
    const up = await documents.upload({ file, kind });
    if (up.error) { toast("critical", "Upload failed", up.error.message); return; }
    setDocs((d) => [...d, { attachment_id: up.data.id, filename: file.name, kind }]);
    if (up.data.duplicate_suspect) {
      toast("warning", "Identical bytes seen before", "Worth a look in case this is a duplicate.");
    }
  }

  async function post() {
    setBusy(true);
    const res = await accounting.postTransaction({
      trx_date: date,
      account_id: accountId,
      direction,
      amount_idr: total,
      type_code: typeCode,
      vendor_id: vendorId || null,
      description: description.trim(),
      source_ref: `manual:${date}:${accountId}:${total}:${description.trim().slice(0, 24)}`,
      lines: lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(), qty: l.qty, uom: l.uom,
          unit_price: l.unit_price, amount: Math.round(l.qty * l.unit_price),
        })),
      documents: docs.map((d) => ({ attachment_id: d.attachment_id, kind: d.kind })),
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not posted", res.error.message);
      return;
    }
    toast("success", `Posted ${res.data.trx_no}`, `${formatIDR(total)} · ${res.data.account_code}`);
    onPosted();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="New ledger entry"
      subtitle="Money that already moved — never a plan"
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[13px] tabular-nums text-slate-600">{formatIDR(total)}</span>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            size="sm" icon={Save} disabled={busy || total <= 0 || !accountId || !hasPrimary || !description.trim()}
            onClick={post}
          >
            {busy ? "Posting…" : "Post to the ledger"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ne-date" className="block text-xs text-slate-500">Date the money moved</label>
            <input
              id="ne-date" type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="ne-account" className="block text-xs text-slate-500">Account</label>
            <select
              id="ne-account" value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">Choose…</option>
              {payingAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ne-direction" className="block text-xs text-slate-500">In or out</label>
            <select
              id="ne-direction" value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="OUT">OUT — money left</option>
              <option value="IN">IN — money arrived</option>
            </select>
          </div>
          <div>
            <label htmlFor="ne-type" className="block text-xs text-slate-500">Type</label>
            <select
              id="ne-type" value={typeCode}
              onChange={(e) => setTypeCode(e.target.value as TransactionTypeCode)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {TRANSACTION_TYPE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ne-desc" className="block text-xs text-slate-500">Description</label>
            <input
              id="ne-desc" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. AMPLAS 120 GRIT, 500 lembar"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ne-vendor" className="block text-xs text-slate-500">
              Vendor {isPurchase && <span className="text-amber-700">— required for a purchase</span>}
            </label>
            <select
              id="ne-vendor" value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className={cn(
                "mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm focus:outline-none",
                isPurchase && !vendorId ? "border-amber-300" : "border-slate-200",
              )}
            >
              <option value="">Not a vendor purchase</option>
              {vendors.status === "ready" && vendors.data.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* What was bought: quantity and price, because an amount alone cannot
            be compared to the last time we bought the same thing (D86). */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What the money was for
          </p>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-d-${l.key}`}>Item</label>
                  <input
                    id={`nl-d-${l.key}`} value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                    placeholder="what was bought"
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-q-${l.key}`}>Qty</label>
                  <NumberInput id={`nl-q-${l.key}`} size="sm" value={l.qty} min={0}
                    onChange={(v) => patch(l.key, { qty: v })} className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-u-${l.key}`}>Unit</label>
                  <select
                    id={`nl-u-${l.key}`} value={l.uom}
                    onChange={(e) => patch(l.key, { uom: e.target.value as UomCode })}
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-p-${l.key}`}>Unit price</label>
                  <MoneyInput id={`nl-p-${l.key}`} size="sm" value={l.unit_price}
                    onChange={(v) => patch(l.key, { unit_price: v })} className="mt-1" />
                </div>
                <div className="flex items-center justify-between gap-2 sm:col-span-12">
                  <span className="text-[12px] tabular-nums text-slate-600">
                    {formatIDR(Math.round(l.qty * l.unit_price))}
                  </span>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="sm" icon={Trash2}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline" size="sm" icon={Plus} className="mt-2"
            onClick={() => {
              const key = `l${nextKey.current++}`;
              setLines((ls) => [...ls, { key, description: "", qty: 1, uom: "pcs", unit_price: 0 }]);
            }}
          >
            Another item
          </Button>
        </section>

        {/* No document, no row (D85). */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Documents
          </p>
          {docs.length > 0 ? (
            <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {docs.map((d) => (
                <li key={d.attachment_id} className="flex items-center gap-3 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{d.filename}</span>
                  <Badge tone={PRIMARY_DOC_KINDS.includes(d.kind) ? "violet" : "slate"}>{d.kind}</Badge>
                  <Button variant="ghost" size="sm" icon={Trash2}
                    onClick={() => setDocs((all) => all.filter((x) => x.attachment_id !== d.attachment_id))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-[13px] text-slate-500">Nothing attached yet.</p>
          )}

          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3">
            <label htmlFor="ne-kind" className="block text-xs text-slate-500">Document type</label>
            <select
              id="ne-kind" value={kind}
              onChange={(e) => setKind(e.target.value as DocKind)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}{PRIMARY_DOC_KINDS.includes(k) ? "" : " (supporting)"}
                </option>
              ))}
            </select>
            <input
              ref={fileRef} id="ne-file" type="file" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" icon={Upload} className="mt-2 w-full"
              onClick={() => fileRef.current?.click()}>
              Attach a file
            </Button>
            <p className={cn("mt-2 text-[11px]", hasPrimary ? "text-slate-500" : "text-amber-700")}>
              {hasPrimary
                ? "At least one nota, transfer proof or photo is on file — the row can be posted."
                : "At least one nota, transfer proof or photo of what arrived is required. A delivery note or a PO can come with it, but supporting is not proof."}
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
