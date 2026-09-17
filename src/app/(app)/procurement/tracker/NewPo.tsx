"use client";

import { useState } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { procurement } from "@/demo/api";
import { UNITS, type UomCode, type Vendor } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";

/** Placing an order from the tracker (D100).
 *
 *  The tracker is where somebody notices a supplier has nothing open, or that
 *  a job needs a second batch of the same glass. Sending them to the order
 *  list to start again loses that; the order belongs where the question was
 *  asked.
 *
 *  Two things this form insists on, because both are what the tracker later
 *  reads: a **vendor**, since an order is placed with somebody, and a **unit
 *  price on every line**, since a contract value nobody agreed cannot be
 *  outstanding. The deposit is optional but consequential — enter one and the
 *  order carries a DP term that becomes payable the moment it is issued, and
 *  nothing before that (D99).
 *
 *  What it produces is a **draft**. An order is a promise made to a supplier
 *  in the company's name, so leadership confirms it before it is sent, which
 *  means creating one cannot also send it (D132).
 */
type Line = { description: string; qty: number; uom: UomCode; unit_price: number };

const EMPTY: Line = { description: "", qty: 1, uom: "pcs", unit_price: 0 };

export function NewPo({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [vendors] = useLoad(() => procurement.listVendors({ curated: true }), []);
  const [vendorId, setVendorId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [dpPercent, setDpPercent] = useState(0);
  const [note, setNote] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);

  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price), 0);
  const deposit = Math.round((total * dpPercent) / 100);
  const ready = Boolean(vendorId) && lines.some((l) => l.description.trim() && l.qty > 0 && l.unit_price > 0);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setBusy(true);
    const res = await procurement.createPo({
      vendor_id: vendorId,
      lines: lines.filter((l) => l.description.trim()),
      dp_percent: dpPercent || null,
      note: note.trim() || null,
      expected_delivery: expected || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not created", res.error.message);
      return;
    }
    /* Which road it took is read off the answer, never assumed from the form.
       The message said *ask leadership to confirm it* for every order, which
       became wrong the moment leadership could confirm their own on creation
       (D267) — one fact, described in two places, and only one of them
       updated. Read the result instead (F87). */
    const value = formatIDR(res.data.lines.reduce((s, l) => s + l.line_total, 0));
    toast(
      "success",
      res.data.self_confirmed ? `${res.data.po_no} dibuat dan dikonfirmasi` : `${res.data.po_no} drafted`,
      res.data.self_confirmed
        ? `${res.data.vendor_name} · ${value} — Anda memegang wewenangnya, jadi konfirmasinya tercatat sekaligus. Tinggal dikirim ke pemasok.`
        : `${res.data.vendor_name} · ${value} — ask leadership to confirm it before it goes to the supplier`,
    );
    onCreated();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      title="New purchase order"
      subtitle="What we are ordering, from whom, at what price."
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Contract value</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{formatIDR(total)}</p>
          </div>
          {dpPercent > 0 && (
            <p className="text-[12px] text-slate-500">
              {dpPercent}% deposit — <strong className="text-slate-700">{formatIDR(deposit)}</strong>{" "}
              payable once the order is issued
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button icon={FileText} onClick={create} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create the draft"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-slate-500">Vendor</label>
          <div className="mt-1">
            <Combobox
              value={vendorId}
              onChange={setVendorId}
              placeholder="Search suppliers…"
              options={vendors.status === "ready"
                ? vendors.data.map((v: Vendor) => ({ value: v.id, label: v.name }))
                : []}
            />
          </div>
          {!vendorId && (
            <p className="mt-1 text-[11px] text-slate-500">
              An order is placed with somebody — the tracker files it under this name.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-xs text-slate-500">Items</label>
            <Button
              variant="ghost" size="sm" icon={Plus}
              onClick={() => setLines((prev) => [...prev, { ...EMPTY }])}
            >
              Add a line
            </Button>
          </div>
          <div className="mt-1 space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <label htmlFor={`po-desc-${i}`} className="block text-[11px] text-slate-500">Item</label>
                  <input
                    id={`po-desc-${i}`}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    placeholder="e.g. KACA TEMPERED 12MM"
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`po-qty-${i}`} className="block text-[11px] text-slate-500">Qty</label>
                  <NumberInput id={`po-qty-${i}`} size="sm" value={l.qty} min={0} onChange={(qty) => setLine(i, { qty })} className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`po-uom-${i}`} className="block text-[11px] text-slate-500">Unit</label>
                  <select
                    id={`po-uom-${i}`}
                    value={l.uom}
                    onChange={(e) => setLine(i, { uom: e.target.value as UomCode })}
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor={`po-price-${i}`} className="block text-[11px] text-slate-500">Unit price</label>
                  <MoneyInput id={`po-price-${i}`} size="sm" value={l.unit_price} onChange={(unit_price) => setLine(i, { unit_price })} className="mt-1" />
                </div>
                <div className="flex items-center justify-between sm:col-span-12">
                  <span className="text-[12px] tabular-nums text-slate-600">
                    {formatIDR(Math.round(l.qty * l.unit_price))}
                  </span>
                  {lines.length > 1 && (
                    <Button
                      variant="ghost" size="sm" icon={Trash2}
                      onClick={() => setLines((prev) => prev.filter((_, n) => n !== i))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="po-dp" className="block text-xs text-slate-500">Deposit (%)</label>
            <NumberInput id="po-dp" value={dpPercent} min={0} max={100} onChange={setDpPercent} className="mt-1" />
            <p className="mt-1 text-[11px] text-slate-500">
              Leave at 0 when nothing is paid up front. A deposit becomes payable
              when the order is issued, not when it is typed.
            </p>
          </div>
          <div>
            <label htmlFor="po-note" className="block text-xs text-slate-500">Note (optional)</label>
            <input
              id="po-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. delivery to HOTEL UBUD, week 3"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <label htmlFor="po-expected" className="mt-3 block text-xs text-slate-500">
              Expected delivery
            </label>
            <input
              id="po-expected"
              type="date"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              What the vendor says. It is the only thing that makes a delivery late
              rather than merely absent.
            </p>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
