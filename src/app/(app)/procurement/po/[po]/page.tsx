"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Banknote, CalendarClock, FileText, Link2, Package, PenLine, Send, Lock,
  Check, MessageCircle, Printer, Truck,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { QrCode } from "@/components/ui/qr";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import type { PoTermView, PoTermState } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { AmendLine } from "./AmendLine";
import { ClosePo } from "./ClosePo";

/** One order, end to end.
 *
 *  The part that exists nowhere else is the **schedule**: 30% on issue, the
 *  rest on delivery, and which of those may actually be asked for today. A
 *  term is a trigger plus a share, so its state has two halves — has the
 *  trigger fired, and have the terms before it been paid. The second half is
 *  the guard: a final instalment cannot quietly go out on an order whose
 *  deposit never did, and the screen names the term holding it up rather than
 *  saying "not allowed" (D128).
 */
const TERM_TONE: Record<PoTermState, string> = {
  PAID: "green",
  PARTIAL: "amber",
  PAYABLE: "brand",
  BLOCKED: "red",
  "NOT DUE": "slate",
};

export default function PoDetailPage({ params }: { params: { po: string } }) {
  const poNo = decodeURIComponent(params.po);
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [detail, reload] = useLoad(() => procurement.getPoDetail(poNo), [poNo]);
  const [amending, setAmending] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const mayEdit = can("procurement.update");
  const mayApprove = hasAuthority("approve_goods");

  async function ask() {
    setBusy(true);
    const res = await procurement.requestPoApproval({ po_no: poNo });
    setBusy(false);
    if (res.error) { toast("warning", "Not sent", res.error.message); return; }
    toast("success", `${poNo} sent for confirmation`, "It cannot go to the supplier until leadership says yes.");
    reload();
  }

  async function approve() {
    setBusy(true);
    const res = await procurement.approvePo({ po_no: poNo, approved: true });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Not confirmed", res.error.message); return; }
    toast("success", `${poNo} confirmed`, "It can be issued and sent to the supplier.");
    reload();
  }

  /** The order, as a message the vendor actually receives. The PDF is printed
   *  from the same page it links to, so there is no second renderer to drift
   *  from the first (D133). */
  function whatsapp(phone: string | null, text: string) {
    const digits = (phone ?? "").replace(/[^0-9]/g, "").replace(/^0/, "62");
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  async function issue() {
    setBusy(true);
    const res = await procurement.issuePo(poNo);
    setBusy(false);
    if (res.error) { toast("warning", "Not issued", res.error.message); return; }
    toast("success", `${poNo} issued`, "The deposit is payable and it now counts against what we owe.");
    reload();
  }

  const termColumns: Column<PoTermView>[] = [
    {
      key: "term",
      header: "Term",
      render: (t) => (
        <div className="whitespace-nowrap">
          <p className="font-mono text-[12px] text-slate-700">{t.term_no}</p>
          <p className="text-[11px] text-slate-500">
            {t.kind} · {t.basis === "percent" ? `${t.basis_value}%` : "fixed"}
          </p>
        </div>
      ),
    },
    {
      key: "trigger",
      header: "When",
      className: "whitespace-normal",
      render: (t) => (
        <div>
          <span className="text-[12px] text-slate-600">{t.trigger}</span>
          {/* Jatuh tempo = tanggal ekspektasi pengiriman (D234). Tanggal yang
              belum terjadi ditandai ± supaya janji tidak terbaca sebagai fakta. */}
          {t.expected_on && t.expected_basis !== "stated" && (
            <span className={cn(
              "block whitespace-nowrap text-[11px] tabular-nums",
              t.expected_basis === "expected" ? "text-amber-700" : "text-slate-400",
            )}>
              {t.expected_basis === "expected" ? "± " : ""}{t.expected_on}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (t) => <span className="whitespace-nowrap tabular-nums text-slate-800">{formatIDR(t.amount)}</span>,
    },
    {
      key: "covered",
      header: "Paid against it",
      align: "right",
      render: (t) => (
        <span className={cn("whitespace-nowrap tabular-nums", t.covered > 0 ? "text-slate-700" : "text-slate-300")}>
          {formatIDR(t.covered)}
        </span>
      ),
    },
    {
      key: "state",
      header: "",
      render: (t) => (
        <div className="whitespace-nowrap">
          <Badge tone={TERM_TONE[t.state] as "green"}>{t.state}</Badge>
          {t.blocked_by && (
            <p className="mt-0.5 text-[11px] text-rose-700">{t.blocked_by} has not been paid</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Link
        href="/procurement/po"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All orders
      </Link>

      <Loaded state={detail} onRetry={reload}>
        {(d) => (
          <>
            <PageHeader
              breadcrumb="Purchase order"
              title={d.po_no}
              description={`${d.vendor_name} · ${d.status === "DRAFT"
                ? "a draft — not sent, so nothing is owed"
                : d.issued_at
                  ? `issued ${d.issued_at.slice(0, 10)}${d.issued_by_name ? ` by ${d.issued_by_name}` : ""}`
                  : d.status.toLowerCase()}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge state={detail} />
                  {d.status !== "DRAFT" && (
                    <>
                      <Button
                        variant="outline" icon={Printer}
                        onClick={() => window.open(`/procurement/po/${encodeURIComponent(d.po_no)}/print`, "_blank", "noopener")}
                      >
                        Print / PDF
                      </Button>
                      <Button
                        variant="outline" icon={MessageCircle}
                        onClick={() => whatsapp(
                          d.vendor_phone,
                          `Halo${d.vendor_pic ? ` ${d.vendor_pic}` : ""}, berikut PO ${d.po_no} dari ${"PT TALAHOME"} senilai ${formatIDR(d.status_view.contract_value)}${d.expected_delivery ? `, diharapkan tiba ${d.expected_delivery}` : ""}. PDF menyusul. Terima kasih.`,
                        )}
                      >
                        Send on WhatsApp
                      </Button>
                    </>
                  )}
                  {mayEdit && d.status === "DRAFT" && !d.approval_asked_at && !d.approved_at && (
                    <Button variant="outline" icon={Send} disabled={busy} onClick={ask}>
                      {busy ? "Sending…" : "Ask leadership to confirm"}
                    </Button>
                  )}
                  {mayApprove && d.status === "DRAFT" && !d.approved_at && (
                    <Button icon={Check} disabled={busy} onClick={approve}>
                      {busy ? "Confirming…" : "Confirm it"}
                    </Button>
                  )}
                  {mayEdit && d.status === "DRAFT" && d.approved_at && (
                    <Button icon={Send} disabled={busy} onClick={issue}>
                      {busy ? "Issuing…" : "Issue and send it"}
                    </Button>
                  )}
                  {mayEdit && d.status === "ISSUED" && (
                    <Button variant="outline" icon={Lock} onClick={() => setClosing(true)}>Close it</Button>
                  )}
                </div>
              }
            />

            {d.status === "DRAFT" && (
              <div className={cn(
                "mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-[13px]",
                d.approved_at ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  : d.approval_asked_at ? "border-amber-200 bg-amber-50/70 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-700",
              )}>
                <Check className="h-4 w-4 shrink-0" />
                {d.approved_at ? (
                  <span>
                    Confirmed by {d.approved_by_name ?? "leadership"} on {d.approved_at.slice(0, 10)} —
                    it can be issued and sent to the supplier.
                    {/* Which road it came down is recorded, not inferred. A
                        rubber stamp that looks like a second pair of eyes is
                        worse than no stamp, so a self-confirmation says so on
                        its face (D267). */}
                    {d.self_confirmed && (
                      <strong> Ditulis dan dikonfirmasi dalam satu tindakan — pembuatnya sendiri yang
                      memegang wewenangnya, jadi tidak ada pihak kedua yang memeriksanya.</strong>
                    )}
                  </span>
                ) : d.approval_asked_at ? (
                  <span>
                    Waiting on leadership since {d.approval_asked_at.slice(0, 16).replace("T", " ")}
                    {d.approval_asked_by_name ? `, asked by ${d.approval_asked_by_name}` : ""}
                    {d.approval_sent_to ? `, sent to ${d.approval_sent_to}` : ""}. Nothing
                    goes to the supplier until they answer — from their own account, not from whoever&apos;s
                    laptop the meeting is running on.
                  </span>
                ) : (
                  <span>
                    A draft. An order is a promise made in the company&apos;s name, so leadership
                    confirms it before the supplier hears about it.
                  </span>
                )}
              </div>
            )}

            {d.revision > d.sent_revision && (
              /* Amending an issued order does not go back to leadership — the
                 vendor already has it. What it does mean is that the paper in
                 their hand is wrong (D135). */
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-900">
                <PenLine className="h-4 w-4 shrink-0" />
                <span>
                  Changed since it was sent — the supplier has revision {d.sent_revision}, this is{" "}
                  <strong>revision {d.revision}</strong>.
                </span>
                {mayEdit && (
                  <Button
                    size="sm" variant="outline" className="ml-auto" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const res = await procurement.markPoResent(d.po_no);
                      setBusy(false);
                      if (res.error) { toast("warning", "Not marked", res.error.message); return; }
                      toast("success", `Revision ${d.revision} sent`, "Print it and send it on WhatsApp if you have not already.");
                      reload();
                    }}
                  >
                    I have sent revision {d.revision}
                  </Button>
                )}
              </div>
            )}

            {d.expected_delivery && (
              <div className={cn(
                "mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px]",
                d.days_late ? "border-rose-200 bg-rose-50/70 text-rose-900" : "border-slate-200 bg-white text-slate-600",
              )}>
                <Truck className="h-4 w-4 shrink-0" />
                {d.days_late
                  ? <span>Promised for <strong>{d.expected_delivery}</strong> — <strong>{d.days_late} day(s) late</strong>, and not everything has arrived.</span>
                  : <span>Expected <strong>{d.expected_delivery}</strong>.</span>}
              </div>
            )}

            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  ["Contract", formatIDR(d.status_view.contract_value), `${d.lines.length} line(s)`],
                  ["Paid", formatIDR(d.status_view.paid_to_date), d.status_view.payment_state.toLowerCase()],
                  ["Arrived", formatIDR(d.status_view.value_received), d.status_view.delivery_state.toLowerCase()],
                  ["Payable now", formatIDR(d.payable_now), "terms whose trigger has fired"],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      k === "Payable now" && d.payable_now > 0 ? "text-brand-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-600">
                {d.status_view.exposure > 0 ? (
                  <>
                    <strong className="tabular-nums text-amber-800">{formatIDR(d.status_view.exposure)}</strong>{" "}
                    has been paid ahead of what has arrived — our money is with the vendor.
                  </>
                ) : d.status_view.exposure < 0 ? (
                  <>
                    <strong className="tabular-nums">{formatIDR(Math.abs(d.status_view.exposure))}</strong>{" "}
                    of goods are here that have not been paid for — the vendor is carrying us.
                  </>
                ) : (
                  <>Money and goods are level on this order.</>
                )}
              </p>
            </div>

            {/* The QR that works today, and the honest note about the one that
                does not. Scanning this opens the order for somebody who is
                already signed in — the receiving clerk at the gate with a
                lorry in front of them, which is the scan that actually happens
                here. The vendor-facing version, where the supplier scans the
                paper and sees the status of their own order, needs a public
                read route and a token per order; until that exists it is
                deliberately NOT printed on the PDF the vendor receives, because
                a QR that fails for the person holding it is worse than no QR
                (W3, F82). */}
            <Card className="mb-4">
              <div className="flex items-start gap-4 p-5">
                <QrCode path={`/procurement/po/${encodeURIComponent(d.po_no)}`} title={d.po_no} size={88} className="shrink-0 rounded ring-1 ring-slate-200" />
                <div className="min-w-0 text-[13px]">
                  <p className="font-medium text-slate-800">Scan untuk membuka order ini</p>
                  <p className="mt-0.5 text-slate-500">
                    Mengarah ke halaman PO <span className="font-mono">{d.po_no}</span> di sistem ini — untuk tim
                    kita sendiri yang sudah punya login, misalnya saat barang datang di gerbang.
                  </p>
                  <p className="mt-1.5 text-[12px] text-amber-700">
                    Belum dicetak di PDF yang diterima vendor. Vendor tidak punya akun di sini, jadi QR itu
                    baru berguna kalau ada halaman publik dan token per order — itu bagian Fase 2.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="mb-4">
              <CardHeader
                title="Payment terms"
                subtitle="A term is a trigger and a share. What has been paid is applied oldest first, because nothing in a transfer says which term it was for."
                icon={CalendarClock}
              />
              <DataTable
                dense columns={termColumns} rows={d.terms} rowKey={(t) => t.term_no}
                empty="No schedule — this order is payable as one amount."
              />
            </Card>

            <Card className="mb-4">
              <CardHeader
                title="What was ordered"
                subtitle={d.status === "ISSUED"
                  ? "An issued order only moves by amendment: the old line stays and points at the new one."
                  : "Still a draft — change it freely until it is issued."}
                icon={Package}
              />
              <DataTable
                dense
                columns={[
                  {
                    key: "item", header: "Item", className: "whitespace-normal",
                    render: (l) => (
                      <span className="block max-w-[340px] whitespace-normal break-words text-[13px] text-slate-800">
                        {l.description}
                      </span>
                    ),
                  },
                  { key: "qty", header: "Qty", align: "right", render: (l) => (
                    <span className="whitespace-nowrap text-[13px] text-slate-600">{formatNumber(l.qty)} {l.uom}</span>
                  ) },
                  { key: "price", header: "Unit price", align: "right", render: (l) => (
                    <span className="whitespace-nowrap tabular-nums text-slate-700">{formatIDR(l.unit_price)}</span>
                  ) },
                  { key: "total", header: "Total", align: "right", render: (l) => (
                    <span className="whitespace-nowrap tabular-nums text-slate-800">{formatIDR(l.line_total)}</span>
                  ) },
                  { key: "recv", header: "Received", align: "right", render: (l) => (
                    <span className="whitespace-nowrap text-[13px] text-slate-600">
                      {formatNumber(l.received)} of {formatNumber(l.qty)}
                    </span>
                  ) },
                  { key: "cond", header: "", render: (l) => (
                    <Badge tone={l.condition === "GOOD" ? "green" : l.condition === "NOT ARRIVED" ? "slate" : "amber"}>
                      {l.condition}
                    </Badge>
                  ) },
                  ...(mayEdit && d.status !== "CLOSED" ? [{
                    key: "amend", header: "", align: "right" as const,
                    render: (l: typeof d.lines[number]) => (
                      <Button variant="ghost" size="sm" icon={PenLine} onClick={() => setAmending(l.line_no)}>
                        Amend
                      </Button>
                    ),
                  }] : []),
                ]}
                rows={d.lines}
                rowKey={(l) => l.po_line_id}
                empty="No lines on this order."
              />
            </Card>

            {d.amendments.length > 0 && (
              <Card className="mb-4">
                <CardHeader title="What it used to say" subtitle="An issued obligation moves by supersession — the old rows stay." icon={PenLine} />
                <ul className="divide-y divide-slate-100">
                  {d.amendments.map((a, i) => (
                    <li key={`${a.line_no}:${i}`} className="flex flex-wrap items-center gap-x-3 px-5 py-2 text-[13px]">
                      <span className="font-mono text-[12px] text-slate-500">line {a.line_no}</span>
                      <span className="text-slate-500 line-through">{a.from}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-800">{a.to}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Paid against this order" icon={Banknote} />
                <DataTable
                  dense
                  columns={[
                    { key: "when", header: "Date", render: (p) => (
                      <div className="whitespace-nowrap">
                        <p className="text-[13px] text-slate-700">{p.trx_date}</p>
                        <p className="font-mono text-[10px] text-slate-400">{p.trx_no}</p>
                      </div>
                    ) },
                    { key: "what", header: "Note", className: "whitespace-normal", render: (p) => (
                      <span className="block max-w-[260px] whitespace-normal break-words text-[12px] text-slate-500">
                        {p.description}
                      </span>
                    ) },
                    { key: "amt", header: "Amount", align: "right", render: (p) => (
                      <span className="whitespace-nowrap tabular-nums text-slate-800">{formatIDR(p.amount)}</span>
                    ) },
                  ]}
                  rows={d.payments}
                  rowKey={(p) => p.trx_no}
                  empty="Nothing has been paid against this order."
                  footer={d.payments.length > 0 ? (
                    <tr>
                      <td className="px-4 py-2 text-[13px] text-slate-600" colSpan={2}>Total</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                        {formatIDR(d.payments.reduce((s, p) => s + p.amount, 0))}
                      </td>
                    </tr>
                  ) : undefined}
                />
              </Card>

              <Card>
                <CardHeader
                  title="Filed against it"
                  subtitle="Everything attached to the order or to a delivery made against it."
                  icon={FileText}
                />
                {d.documents.length === 0 ? (
                  <p className="px-5 py-6 text-[13px] text-amber-700">
                    Nothing is filed against this order — no photo, no tanda terima, no invoice.
                    It cannot be closed until something is.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {d.documents.map((f) => (
                      <li key={f.attachment_id + f.kind} className="flex items-center gap-3 px-5 py-2">
                        {f.url
                          ? <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                          : <FileText className="h-4 w-4 shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1">
                          {f.url ? (
                            <a href={f.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[13px] text-brand-700 underline">
                              {f.filename}
                            </a>
                          ) : (
                            <span className="block truncate text-[13px] text-slate-700">{f.filename}</span>
                          )}
                          <span className="block text-[11px] text-slate-400">{f.kind}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {amending !== null && (
              <AmendLine
                poNo={d.po_no}
                line={d.lines.find((l) => l.line_no === amending)!}
                onClose={() => setAmending(null)}
                onSaved={() => { setAmending(null); reload(); }}
              />
            )}
            {closing && (
              <ClosePo
                poNo={d.po_no}
                blockers={d.close_blockers}
                onClose={() => setClosing(false)}
                onClosed={() => { setClosing(false); reload(); }}
              />
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
