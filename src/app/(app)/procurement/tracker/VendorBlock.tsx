"use client";

import { useState } from "react";
import { Package, Banknote, Camera, Link2 } from "lucide-react";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { PoJourney, PoLineJourney, VendorJourney } from "@/services/procurement/contracts";
import type { VendorPayment } from "@/services/accounting/contracts";
import { ReceiveForm } from "./ReceiveForm";

/** One vendor's whole story: four numbers, then every order, then every
 *  payment ever made to them.
 *
 *  The payment history is deliberately **vendor-wide rather than per order**.
 *  One transfer on 19 August closed three orders at once; splitting it into
 *  three payment rows would say the bank moved money three times, and reading
 *  it order by order would make each of the three look like a partial payment
 *  that never completed (D97).
 */
export function VendorBlock({
  journey, onChanged,
}: {
  journey: VendorJourney;
  onChanged: () => void;
}) {
  const [payments] = useLoad(() => accounting.paymentsForVendor(journey.vendor_id), [journey.vendor_id]);

  return (
    <div className="space-y-4">
      <dl className="grid gap-px overflow-hidden rounded-xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["Contract value", formatIDR(journey.contract_value), "everything ordered"],
          ["Paid to date", formatIDR(journey.paid), "money that left our bank"],
          ["Outstanding", formatIDR(journey.outstanding), "contracted, not yet paid"],
          ["Value received", formatIDR(journey.value_received), "what came through the door"],
        ] as [string, string, string][]).map(([k, v, note]) => (
          <div key={k} className="bg-white px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums tracking-tight text-slate-800">{v}</dd>
            <p className="text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </dl>

      {journey.pos.map((po) => (
        <OrderBlock key={po.po_no} po={po} onChanged={onChanged} />
      ))}

      {/* Payments across every order, because that is how they were made. */}
      <Card>
        <CardHeader
          title="Payment history — this vendor, all orders"
          subtitle="One transfer can close several orders. Recording it once, with what it applies to, keeps both facts true."
          icon={Banknote}
        />
        <DataTable
          dense
          columns={[
            {
              key: "when",
              header: "Date",
              render: (p) => (
                <div className="whitespace-nowrap">
                  <p className="text-[13px] text-slate-700">{p.trx_date}</p>
                  <p className="font-mono text-[10px] text-slate-400">{p.trx_no}</p>
                </div>
              ),
            },
            {
              key: "applies",
              header: "Applies to",
              className: "whitespace-normal",
              render: (p) => p.applies_to.length === 0
                ? <span className="text-[12px] text-amber-700">no order named</span>
                : (
                  <ul className="max-w-[260px] space-y-0.5">
                    {p.applies_to.map((a) => (
                      <li key={a.po_no} className="flex items-center gap-1.5 text-[12px] text-slate-600">
                        <Link2 className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="font-mono">{a.po_no}</span>
                        {p.applies_to.length > 1 && (
                          <span className="tabular-nums text-slate-400">{formatIDR(a.amount)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ),
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              render: (p) => (
                <span className={cn(
                  "tabular-nums font-medium",
                  p.status === "VOID" ? "text-slate-300 line-through" : "text-slate-800",
                )}>
                  {formatIDR(p.amount)}
                </span>
              ),
            },
            {
              key: "note",
              header: "Note",
              className: "whitespace-normal",
              render: (p) => (
                <span className="block max-w-[320px] whitespace-normal break-words text-[12px] text-slate-500">
                  {p.description}
                </span>
              ),
            },
            {
              key: "proof",
              header: "Proof",
              align: "center",
              render: (p) => (
                <EvidenceChip
                  attachmentId={p.proof_attachment_id}
                  present="on file" missing="missing"
                  title={`${p.trx_no} — payment proof`}
                />
              ),
            },
          ] as Column<VendorPayment>[]}
          rows={payments.status === "ready" ? payments.data : []}
          rowKey={(p) => p.trx_no + p.trx_date}
          empty="Nothing has been paid to this vendor yet."
          footer={payments.status === "ready" && payments.data.length > 0 ? (
            <tr>
              <td className="px-4 py-2.5 text-[13px] text-slate-600" colSpan={2}>Total paid</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">
                {formatIDR(payments.data.filter((p) => p.status !== "VOID").reduce((s, p) => s + p.amount, 0))}
              </td>
              <td colSpan={2} />
            </tr>
          ) : undefined}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Total PO — this vendor" icon={Package} />
          <DataTable
            dense
            columns={[
              { key: "po", header: "Order", render: (p) => <span className="font-mono text-[12px] text-slate-700">{p.po_no}</span> },
              { key: "v", header: "Contract", align: "right", render: (p) => <span className="tabular-nums text-slate-700">{formatIDR(p.contract_value)}</span> },
            ] as Column<PoJourney>[]}
            rows={journey.pos}
            rowKey={(p) => p.po_no}
            empty="No order has been issued to this supplier yet."
            footer={
              <>
                <tr>
                  <td className="px-4 py-2 text-[13px] text-slate-600">Total PO</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                    {formatIDR(journey.contract_value)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-[13px] text-slate-600">Balance</td>
                  <td className={cn(
                    "px-4 py-2 text-right tabular-nums font-semibold",
                    journey.outstanding > 0 ? "text-slate-800" : "text-emerald-700",
                  )}>
                    {formatIDR(journey.outstanding)}
                  </td>
                </tr>
              </>
            }
          />
        </Card>

        <Card>
          <CardHeader title="Billable now" icon={Banknote} />
          <div className="px-5 py-4">
            <p className={cn(
              "text-3xl font-bold tabular-nums tracking-tight",
              journey.billable_now > 0 ? "text-amber-700" : "text-slate-800",
            )}>
              {formatIDR(journey.billable_now)}
            </p>
            <p className="mt-2 text-[13px] text-slate-600">
              The deposit share once an order is issued, plus the delivered share of
              everything else, minus what has already been paid — per order, then
              added up.
            </p>
            <p className="mt-2 text-[13px] text-slate-500">
              {journey.billable_now > 0
                ? "Goods are here that nobody has paid for. This is what is safe to request next."
                : "Every order here already cleared that test — there is nothing safe to request next."}
            </p>
            {journey.credit > 0 && (
              /* Over-delivery, priced and named. Not billable, not ours to
                 spend, and not quietly folded into another order (D98). */
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                <strong className="tabular-nums">{formatIDR(journey.credit)}</strong> of goods
                arrived beyond what was ordered — a credit sitting with this vendor,
                not applied to any order here.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function OrderBlock({ po, onChanged }: { po: PoJourney; onChanged: () => void }) {
  const [receiving, setReceiving] = useState<string | null>(null);

  const columns: Column<PoLineJourney>[] = [
    {
      key: "item",
      header: "Item",
      className: "whitespace-normal",
      render: (l) => (
        <span className="block max-w-[320px] whitespace-normal break-words text-[13px] text-slate-800">
          {l.description}
        </span>
      ),
    },
    { key: "qty", header: "Qty", align: "right", render: (l) => <span className="tabular-nums text-[13px] text-slate-600">{formatNumber(l.qty)}</span> },
    { key: "price", header: "Unit price", align: "right", render: (l) => <span className="tabular-nums text-[13px] text-slate-600">{formatIDR(l.unit_price)}</span> },
    { key: "total", header: "Total", align: "right", render: (l) => <span className="tabular-nums text-slate-800">{formatIDR(l.line_total)}</span> },
    {
      key: "received",
      header: "Received",
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <span className="tabular-nums text-[13px] text-slate-700">
            {formatNumber(l.received)} of {formatNumber(l.qty)}
          </span>
          {l.receipts.length > 1 && (
            <span className="block text-[11px] text-slate-400">{l.receipts.length} shipments</span>
          )}
        </div>
      ),
    },
    {
      key: "condition",
      header: "Condition",
      render: (l) => (
        <Badge tone={
          l.condition === "GOOD" ? "green"
            : l.condition === "OVER" ? "amber"
              : l.condition === "NOT ARRIVED" ? "red"
                : l.condition === "PARTIAL" ? "amber" : "red"
        }>
          {l.condition === "OVER" ? `+${formatNumber(l.over)} OVER` : l.condition}
        </Badge>
      ),
    },
    {
      key: "act",
      header: "",
      render: (l) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost" size="sm" icon={Camera}
            onClick={() => setReceiving(receiving === l.po_line_id ? null : l.po_line_id)}
          >
            Record arrival
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={po.po_no}
        subtitle={[
          po.issued_at ? `issued ${po.issued_at.slice(0, 10)}` : "not issued",
          po.dp_percent ? `DP ${po.dp_percent}%` : "no deposit",
          `${formatIDR(po.contract_value)} contracted`,
        ].join(" · ")}
        icon={Package}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={po.payment_state === "SETTLED" ? "green" : po.payment_state === "PARTIAL" ? "amber" : "slate"}>
              {po.payment_state === "SETTLED" ? "PAID" : po.payment_state}
            </Badge>
            <Badge tone={po.delivery_state === "COMPLETE" ? "green" : po.delivery_state === "PARTIAL" ? "amber" : "red"}>
              {po.delivery_state === "COMPLETE" ? "RECEIVED" : po.delivery_state === "PENDING" ? "NOT ARRIVED" : po.delivery_state}
            </Badge>
            {po.credit > 0 && <Badge tone="amber">{formatIDR(po.credit)} credit</Badge>}
            {po.billable_now > 0 && (
              <Badge tone="violet">{formatIDR(po.billable_now)} billable</Badge>
            )}
          </div>
        }
      />
      <DataTable
        dense
        columns={columns}
        rows={po.lines}
        rowKey={(l) => l.po_line_id}
        empty="This order has no lines on it — an order with nothing on it is not an order."
      />

      {po.note && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">{po.note}</p>
      )}

      {/* Deliveries, with the tanda terima that proves each one. */}
      {po.lines.some((l) => l.receipts.length > 0) && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Delivery history</p>
          <ul className="mt-1.5 space-y-1.5">
            {po.lines.flatMap((l) => l.receipts.map((r) => (
              <li key={r.receipt_no + l.po_line_id} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className="font-mono text-slate-500">{r.receipt_no}</span>
                  <span className="font-medium text-slate-700">{formatNumber(r.qty)} {l.uom}</span>
                  <Badge tone={r.condition === "GOOD" ? "green" : "amber"}>{r.condition}</Badge>
                  <span className="text-slate-500">{r.at.slice(0, 10)}</span>
                  {r.status === "REPORTED" && (
                    <Badge tone="amber">reported — tanda terima to come</Badge>
                  )}
                  <span className="text-slate-500">received by <span className="text-slate-700">{r.by}</span></span>
                  {r.status === "CONFIRMED" && (
                    <span className="text-slate-500">checked by <span className="text-slate-700">{r.qc_by}</span></span>
                  )}
                </div>
                {/* Both halves, named separately: the photo says what arrived,
                    the tanda terima says we acknowledged it (D101) — and a
                    report is allowed to have only the first one (D131). */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <EvidenceChip
                    attachmentId={r.photo_attachment_id}
                    present="photo of the goods" missing="no photo"
                    title={`${r.receipt_no} — photo of the goods`}
                  />
                  <EvidenceChip
                    attachmentId={r.delivery_note_attachment_id}
                    present="tanda terima" missing="no tanda terima"
                    title={`${r.receipt_no} — tanda terima`}
                  />
                  {r.note && <span className="text-slate-500">{r.note}</span>}
                </div>
              </li>
            )))}
          </ul>
        </div>
      )}

      {receiving && (
        <div className="border-t border-slate-100 px-4 py-3">
          <ReceiveForm
            poLineId={receiving}
            line={po.lines.find((l) => l.po_line_id === receiving)!}
            onDone={() => { setReceiving(null); onChanged(); }}
          />
        </div>
      )}
    </Card>
  );
}
