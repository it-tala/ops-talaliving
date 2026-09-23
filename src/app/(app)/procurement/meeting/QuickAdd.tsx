"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { procurement } from "@/demo/api";
import { type UomCode, type Vendor } from "@/services/procurement/contracts";
import { useLoad } from "@/components/ui/loaded";
import { useToast } from "@/store/toast";
import { UomOptions } from "@/components/ui/uom-options";

/** Adding an item without leaving the meeting.
 *
 *  Somebody says "we also need thinner" and it has to be on the list before
 *  the conversation moves on. Sending them to the full request form loses the
 *  room, and a note on paper never comes back.
 *
 *  What it creates is an ordinary purchase request — same document, same
 *  number, same queue (D73). The only thing skipped is the draft stage, which
 *  exists for assembling a list, and a meeting is not assembling a list.
 */
export function QuickAdd({ onAdded }: { onAdded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState<UomCode>("pcs");
  const [price, setPrice] = useState(0);
  const [vendorId, setVendorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [vendors] = useLoad(() => procurement.listVendors({ curated: true }), []);

  const total = Math.round(qty * price);

  async function add() {
    setBusy(true);
    const res = await procurement.quickAddLine({
      description: description.trim(),
      purpose: purpose.trim() || null,
      qty, uom, unit_price: price,
      vendor_id: vendorId || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not added", res.error.message);
      return;
    }
    toast("success", `Added ${res.data.line_no_full}`, `${res.data.description} · ${formatIDR(res.data.item_total)}`);
    setDescription(""); setPurpose(""); setQty(1); setPrice(0); setVendorId("");
    onAdded();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" icon={Plus} onClick={() => setOpen(true)}>
        Add an item
      </Button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3">
      <div className="grid gap-2.5 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label htmlFor="qa-desc" className="block text-[11px] text-slate-500">Item</label>
          <input
            id="qa-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. THINNER ND 5L"
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="qa-purpose" className="block text-[11px] text-slate-500">What it is for</label>
          <input
            id="qa-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Spray booth, HOTEL UBUD"
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="qa-qty" className="block text-[11px] text-slate-500">Qty</label>
          <NumberInput id="qa-qty" size="sm" value={qty} min={0} onChange={setQty} className="mt-1" />
        </div>
        <div>
          <label htmlFor="qa-uom" className="block text-[11px] text-slate-500">Unit</label>
          <select
            id="qa-uom"
            value={uom}
            onChange={(e) => setUom(e.target.value as UomCode)}
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
          >
            <UomOptions current={uom} />
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="qa-price" className="block text-[11px] text-slate-500">Unit price</label>
          <MoneyInput id="qa-price" size="sm" value={price} onChange={setPrice} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="qa-vendor" className="block text-[11px] text-slate-500">Vendor (optional)</label>
          <select
            id="qa-vendor"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
          >
            <option value="">not decided</option>
            {vendors.status === "ready" && vendors.data.map((v: Vendor) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <span className="mr-auto text-[13px] tabular-nums text-slate-600">{formatIDR(total)}</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" icon={Plus} onClick={add} disabled={busy || !description.trim()}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Creates a real purchase request with its own number, submitted straight
        away — it joins the list below rather than sitting in somebody&apos;s drafts.
      </p>
    </div>
  );
}
