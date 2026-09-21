"use client";

import { useRef, useState } from "react";
import { Camera, Upload, PackageCheck, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import type { DocKind } from "@/services/documents/contracts";
import { cn } from "@/lib/cn";
import { documents, identity, procurement } from "@/demo/api";
import { RECEIPT_CONDITIONS, type ReceiptCondition, type PoLineJourney } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";

/** Recording what actually arrived — with everything a delivery is made of.
 *
 *  The photograph is always required — it is the one thing whoever is standing
 *  there can produce, and without it there is no evidence anything arrived.
 *
 *  The **tanda terima is required to confirm, not to report** (D131). Goods
 *  from outside arrive when they arrive, often at night, and refusing the
 *  report until the signed paper exists does not produce the paper — it loses
 *  the arrival. So a delivery with only a photo is recorded as **reported**:
 *  visible everywhere, counted nowhere, and waiting for procurement to
 *  complete it in the morning.
 *
 *  Quantities are cumulative and append-only. Four shipments against one line
 *  are four receipts, not one number edited four times.
 */
type Slot = { id: string; name: string } | null;

export function ReceiveForm({
  poLineId, line, onDone,
}: {
  poLineId: string;
  line: PoLineJourney;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [people] = useLoad(() => identity.listUsers(), []);
  const remaining = Math.max(line.qty - line.received, 0);
  const [qty, setQty] = useState(remaining || line.qty);
  const [condition, setCondition] = useState<ReceiptCondition>("GOOD");
  const [qcBy, setQcBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Slot>(null);
  const [tandaTerima, setTandaTerima] = useState<Slot>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  /* The kind travels with the slot, because it is what decides which shared
     drive the file lands in (0035) — a goods photo and a signed tanda terima
     are two different documents and the picker knows which is which. */
  async function upload(f: File, set: (s: Slot) => void, kind: DocKind) {
    const up = await documents.upload({ file: f, kind });
    if (up.error) { toast("critical", "Upload failed", up.error.message); return; }
    set({ id: up.data.id, name: f.name });
  }

  async function submit() {
    setBusy(true);
    const res = await procurement.createReceipt({
      po_line_id: poLineId,
      qty_received: qty,
      condition,
      qc_by: qcBy || null,
      documents: [
        ...(photo ? [{ attachment_id: photo.id, kind: "Receiving Item" as const }] : []),
        ...(tandaTerima ? [{ attachment_id: tandaTerima.id, kind: "Delivery Note" as const }] : []),
      ],
      note: note.trim() || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 422 ? "warning" : "critical", "Not recorded", res.error.message);
      return;
    }
    const reported = res.data.receipt.status === "REPORTED";
    toast(
      res.data.notified ? "warning" : reported ? "info" : "success",
      reported
        ? `Reported ${formatNumber(qty)} ${line.uom}`
        : `Received ${formatNumber(qty)} ${line.uom}`,
      res.data.notified
        ? "Condition needs attention — the line stays open."
        : reported
          ? `${res.data.receipt.receipt_no} · waiting for the tanda terima, so it counts for nothing yet`
          : `${res.data.receipt.receipt_no} · photo and tanda terima on file`,
    );
    onDone();
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-slate-700">
        <PackageCheck className="h-4 w-4 text-slate-400" />
        {line.description}
        <span className="text-[12px] font-normal text-slate-400">
          {formatNumber(line.received)} of {formatNumber(line.qty)} {line.uom} so far
        </span>
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="rc-qty" className="block text-xs text-slate-500">How many arrived</label>
          <NumberInput id="rc-qty" value={qty} min={0} onChange={setQty} className="mt-1" />
        </div>
        <div>
          <label htmlFor="rc-cond" className="block text-xs text-slate-500">Condition</label>
          <select
            id="rc-cond" value={condition}
            onChange={(e) => setCondition(e.target.value as ReceiptCondition)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {RECEIPT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rc-qc" className="block text-xs text-slate-500">Checked by (QC)</label>
          <select
            id="rc-qc" value={qcBy}
            onChange={(e) => setQcBy(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            <option value="">me — I checked it myself</option>
            {people.status === "ready" && people.data.map((s) => (
              <option key={s.user.id} value={s.user.id}>{s.user.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rc-note" className="block text-xs text-slate-500">Note (optional)</label>
          <input
            ref={noteRef}
            id="rc-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. two sheets more than ordered"
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Two documents, two questions. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <DocSlot
          label="Photo of the goods"
          hint="what actually arrived"
          value={photo}
          icon={Camera}
          onPick={(f) => upload(f, setPhoto, "Receiving Item")}
          inputRef={photoRef}
          capture
        />
        <DocSlot
          label="Tanda terima"
          hint="signed — that we acknowledged it"
          value={tandaTerima}
          icon={FileSignature}
          onPick={(f) => upload(f, setTandaTerima, "Delivery Note")}
          inputRef={photoFileRef}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn("text-[12px]", photo && tandaTerima ? "text-slate-500" : photo ? "text-amber-700" : "text-slate-500")}>
          {photo && tandaTerima
            ? "Both on file — this counts as received."
            : photo
              ? "No tanda terima yet: this is recorded as reported. It shows on the order and counts for nothing until procurement completes it."
              : "The photograph is required — it is what says anything arrived at all."}
        </span>
        <Button
          size="sm" className="ml-auto"
          disabled={busy || qty <= 0 || !photo}
          onClick={submit}
        >
          {busy ? "Recording…" : tandaTerima ? "Record what arrived" : "Report it — tanda terima follows"}
        </Button>
      </div>

      {qty > remaining && remaining > 0 && (
        <p className="mt-2 text-[12px] text-amber-700">
          {formatNumber(qty - remaining)} {line.uom} more than what is still outstanding.
          Recorded as it is — over-delivery is a credit with the vendor, not a
          rounding error.
        </p>
      )}
    </div>
  );
}

function DocSlot({
  label, hint, value, icon: Icon, onPick, inputRef, capture,
}: {
  label: string;
  hint: string;
  value: Slot;
  icon: typeof Camera;
  onPick: (f: File) => void;
  /* React 19 types `useRef<T>(null)` as `RefObject<T | null>` — the ref is
     null until the input mounts, and the type now says so. The prop has to
     admit that null, or no ref a caller actually holds will fit it. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  capture?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5",
      value ? "border-violet-200 bg-violet-50/50" : "border-dashed border-slate-300",
    )}>
      <p className="text-[12px] font-medium text-slate-700">{label}</p>
      <p className="text-[11px] text-slate-500">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      <Button
        variant="outline" size="sm" icon={value ? Icon : capture ? Camera : Upload}
        className="mt-2 w-full"
        onClick={() => inputRef.current?.click()}
      >
        <span className="max-w-[180px] truncate">{value ? value.name : capture ? "Photograph" : "Choose a file"}</span>
      </Button>
    </div>
  );
}
