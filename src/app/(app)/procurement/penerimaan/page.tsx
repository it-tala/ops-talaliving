"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, FileSignature, PackageCheck, Moon } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { NumberInput } from "@/components/ui/number-input";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { documents, identity, procurement } from "@/demo/api";
import { RECEIPT_CONDITIONS, type ReceiptCondition } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The morning queue.
 *
 *  Goods from outside arrive when they arrive. Whoever is there at 23:40 —
 *  procurement on call, a supervisor, the guard on the gate — photographs it
 *  and says *it came*. That is a **report**: enough to record the arrival,
 *  never enough to count it.
 *
 *  This is the other half (D131). Procurement, who are accountable for what
 *  arrived, file the signed tanda terima, name who checked it, and correct the
 *  quantity somebody counted in the dark. Until that happens the goods are on
 *  the screen everywhere and in the numbers nowhere, which is the honest
 *  position: it is here, and we have not acknowledged it in writing.
 */
export default function ReceivingPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => procurement.listReported(), []);
  const mayConfirm = can("procurement.update");

  return (
    <div>
      <PageHeader
        breadcrumb="Procurement"
        title="Receiving report"
        description="Arrivals somebody reported and nobody has completed. The photograph says it came; the tanda terima says we acknowledged it — and only the second one makes it count."
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => (
          <Card>
            <CardHeader
              title={all.length === 0 ? "Nothing waiting" : `${all.length} arrival(s) waiting for the tanda terima`}
              subtitle="Oldest first — the longer one sits here, the harder it is to remember what was in the crate."
              icon={PackageCheck}
              action={<SourceBadge state={rows} />}
            />
            {all.length === 0 ? (
              <p className="px-5 py-8 text-[13px] text-slate-500">
                Every arrival that has been reported is confirmed. Deliveries recorded with
                both the photo and the tanda terima never appear here — they count straight away.
              </p>
            ) : (
              <Paged rows={all} pageSize={12} unit="kiriman">
                {(shown) => (
                  <ul className="divide-y divide-slate-100">
                    {shown.map((r) => (
                      <Row key={r.receipt_no} row={r} mayConfirm={mayConfirm} onDone={reload} />
                    ))}
                  </ul>
                )}
              </Paged>
            )}
          </Card>
        )}
      </Loaded>

      <p className="mt-4 text-[12px] text-slate-400">
        A delivery is normally recorded from the order itself, on{" "}
        <Link href="/procurement/tracker" className="underline">the purchase tracker</Link>.
        This page exists for the ones that could not wait for office hours.
      </p>
    </div>
  );
}

type ReportedRow = Awaited<ReturnType<typeof procurement.listReported>>["data"] extends (infer T)[] | undefined
  ? T : never;

function Row({ row, mayConfirm, onDone }: { row: ReportedRow; mayConfirm: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [people] = useLoad(() => identity.listUsers(), []);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(row.qty_received);
  const [condition, setCondition] = useState<ReceiptCondition>(
    row.condition === "WAITING FOR CONFIRMATION" ? "GOOD" : row.condition,
  );
  const [qcBy, setQcBy] = useState("");
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hours = Math.max(
    Math.round((Date.now() - Date.parse(row.received_at)) / 3_600_000), 0,
  );

  async function upload(f: File) {
    const up = await documents.upload({ file: f, kind: "Delivery Note" });
    if (up.error) { toast("critical", "Upload failed", up.error.message); return; }
    setDoc({ id: up.data.id, name: f.name });
  }

  async function confirm() {
    if (!doc) return;
    setBusy(true);
    const res = await procurement.confirmReceipt({
      receipt_no: row.receipt_no,
      delivery_note_attachment_id: doc.id,
      qc_by: qcBy || null,
      qty_received: qty,
      condition,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not confirmed", res.error.message);
      return;
    }
    toast("success", `${row.receipt_no} confirmed`, `${formatNumber(qty)} now counts as received.`);
    onDone();
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[12px] text-slate-500">{row.receipt_no}</span>
        <span className="min-w-[200px] flex-1 text-[13px] font-medium text-slate-800">
          {row.description}
          {row.vendor_name && <span className="font-normal text-slate-500"> · {row.vendor_name}</span>}
        </span>
        <span className="text-[12px] text-slate-600">
          {formatNumber(row.qty_received)} reported
        </span>
        <Badge tone={hours > 24 ? "red" : "amber"}>
          {hours < 1 ? "just now" : `${hours}h ago`}
        </Badge>
        {mayConfirm && (
          <Button size="sm" variant={open ? "ghost" : "outline"} onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Complete it"}
          </Button>
        )}
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <Moon className="h-3 w-3" />
        reported by {row.reported_by_name} · {row.received_at.slice(0, 16).replace("T", " ")}
        {row.po_no && <> · <Link href={`/procurement/po/${row.po_no}`} className="underline">{row.po_no}</Link></>}
        {row.note && <span className="text-slate-600">{row.note}</span>}
      </p>

      {open && (
        <div className="mt-2 grid gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 sm:grid-cols-4">
          <div>
            <label htmlFor={`q-${row.id}`} className="block text-xs text-slate-500">Counted in daylight</label>
            <NumberInput id={`q-${row.id}`} value={qty} min={0} onChange={setQty} className="mt-1" />
          </div>
          <div>
            <label htmlFor={`c-${row.id}`} className="block text-xs text-slate-500">Condition</label>
            <select
              id={`c-${row.id}`} value={condition}
              onChange={(e) => setCondition(e.target.value as ReceiptCondition)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {RECEIPT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`qc-${row.id}`} className="block text-xs text-slate-500">Checked by</label>
            <select
              id={`qc-${row.id}`} value={qcBy} onChange={(e) => setQcBy(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">me — I checked it myself</option>
              {people.status === "ready" && people.data.map((s) => (
                <option key={s.user.id} value={s.user.id}>{s.user.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs text-slate-500">Signed tanda terima</span>
            <input
              ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
            />
            <Button
              variant="outline" size="sm" icon={doc ? FileSignature : Camera}
              className="mt-1 w-full" onClick={() => fileRef.current?.click()}
            >
              <span className="max-w-[150px] truncate">{doc ? doc.name : "Photograph it"}</span>
            </Button>
          </div>

          <div className="sm:col-span-4 flex flex-wrap items-center gap-2">
            <span className={doc ? "text-[12px] text-slate-500" : "text-[12px] text-amber-700"}>
              {doc
                ? "This is what makes it count as received."
                : "Without the tanda terima it stays reported — the goods are here, and we have not acknowledged them in writing."}
            </span>
            <Button size="sm" className="ml-auto" disabled={busy || !doc} onClick={confirm}>
              {busy ? "Confirming…" : "Confirm it"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
