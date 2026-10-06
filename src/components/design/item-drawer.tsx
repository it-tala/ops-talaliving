"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Pencil, RotateCcw, Undo2, XCircle } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { SaleFiles } from "@/components/files/sale-files";
import { OpenPoints } from "@/components/crm/meeting-lines";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { quotation } from "@/demo/api";
import { formatIDR, formatNumber } from "@/lib/format";
import type { QuotationLineView } from "@/services/quotation/contracts";
import { cn } from "@/lib/cn";
import { design, documents } from "@/demo/api";
import {
  APPROVAL_CHANNELS, DESIGN_ITEM_STATUSES, DESIGN_ORIGINS,
  type ApprovalChannel, type DesignApproval, type DesignItemView,
} from "@/services/design/contracts";
import type { AttachmentView } from "@/services/documents/contracts";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { ItemForm } from "./design-board";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** One design item: what it is, its files (ours and the client's), and the
 *  client's approval — recorded when it happens, never required (D378). */
export function ItemDrawer({
  itemNo, canEdit, onClose, onChanged,
}: { itemNo: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const tr = useTr();
  const [state, reload] = useLoad(() => design.getDesignItem(itemNo), [itemNo]);
  const item = state.status === "ready" ? state.data : null;
  const changed = () => { reload(); onChanged(); };

  return (
    <Drawer open onClose={onClose} width="max-w-2xl"
      title={item ? <span><span className="font-mono text-[13px] text-slate-500">{item.item_no}</span> · {item.name}</span> : itemNo}
      subtitle={item ? `${tr("Collection", "Koleksi")} ${item.collection_code} · ${item.collection_name} › ${item.room_name}` : undefined}>
      <Loaded state={state} onRetry={reload}>
        {(i) => (
          <div className="space-y-5">
            <Facts i={i} canEdit={canEdit} onChanged={changed} />
            <SaleFiles targets={[{ entity: "design_item", entity_no: i.item_no, label: i.item_no }]}
              canEdit={canEdit} onChanged={changed} />
            <Approvals i={i} canEdit={canEdit} onChanged={changed} />
            <ItemQuotes itemNo={i.item_no} refresh={i.updated_at} />
            <OpenPoints filter={{ item_no: i.item_no }} title={tr("Asked in meetings", "Diminta di meeting")}
              empty={tr("Nothing asked about this item in a meeting yet.", "Belum ada permintaan tentang item ini dari meeting.")} />
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

function Facts({ i, canEdit, onChanged }: { i: DesignItemView; canEdit: boolean; onChanged: () => void }) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const st = DESIGN_ITEM_STATUSES.find((s) => s.code === i.status)!;
  const og = DESIGN_ORIGINS.find((o) => o.code === i.origin)!;
  const dropped = i.status === "DROPPED";

  async function setDropped(on: boolean) {
    setBusy(true);
    const r = await design.setDesignItemDropped(i.item_no, on, on ? reason.trim() : null);
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", on ? tr("Item dropped", "Item dikeluarkan") : tr("Item back in the design", "Item kembali ke desain"), i.item_no);
    setDropping(false);
    setReason("");
    onChanged();
  }

  if (editing) {
    return (
      <ItemForm projectCode={i.project_code} collectionCode={i.collection_code} roomCode={i.room_code} item={i}
        onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
    );
  }

  const size = i.length_mm || i.width_mm || i.height_mm
    ? `${[i.length_mm, i.width_mm, i.height_mm].map((v) => v ?? "—").join(" × ")} mm` : "—";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        <Badge tone={i.origin === "tala" ? "brand" : i.origin === "client" ? "amber" : "violet"}>
          {tr("Designed by", "Desain dari")} {lang === "id" ? og.label_id : og.label}
        </Badge>
        {i.product_code && <Badge tone="slate">{tr("Product", "Produk")} {i.product_code}</Badge>}
        {canEdit && !dropped && (
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(true)}>{tr("Edit", "Ubah")}</Button>
            {!dropping && (
              <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setDropping(true)}>{tr("Drop", "Keluarkan")}</Button>
            )}
          </div>
        )}
        {canEdit && dropped && (
          <Button size="sm" variant="outline" icon={RotateCcw} className="ml-auto" onClick={() => setDropped(false)} disabled={busy}>
            {tr("Put back", "Kembalikan")}
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-4">
        <Fact k={tr("Qty", "Qty")} v={String(i.qty)} />
        <Fact k={tr("Size (L × W × H)", "Ukuran (P × L × T)")} v={size} />
        <Fact k={tr("Client", "Klien")} v={i.client_display ?? "—"} />
        <Fact k={tr("Files", "File")} v={tr(`${i.design_files} ours · ${i.client_files} client's`, `${i.design_files} kita · ${i.client_files} klien`)} />
      </dl>
      {i.note && <p className="text-[13px] text-slate-600">{i.note}</p>}
      {dropped && (
        <p className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-[12px] text-rose-800">
          {tr("Dropped", "Dikeluarkan")} {i.dropped_at?.slice(0, 10)} — {i.drop_reason}
        </p>
      )}
      {dropping && (
        <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/40 p-2.5">
          <label className="block text-xs text-slate-600">
            {tr("Why is it out of the design?", "Kenapa dikeluarkan dari desain?")}
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              placeholder={tr("e.g. client chose the loose sofa instead", "mis. klien memilih sofa lepas")} className={cn(inputCls, "mt-1")} />
          </label>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setDropping(false); setReason(""); }} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={XCircle} onClick={() => setDropped(true)} disabled={busy || !reason.trim()}>{tr("Drop item", "Keluarkan item")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
      <dd className="text-slate-800">{v}</dd>
    </div>
  );
}

function Approvals({ i, canEdit, onChanged }: { i: DesignItemView; canEdit: boolean; onChanged: () => void }) {
  const tr = useTr();
  const lang = useLang();
  const [state, reload] = useLoad(() => design.listDesignApprovals(i.item_no), [i.item_no, i.updated_at, i.approval_on]);
  const [form, setForm] = useState<null | "approved" | "withdrawn">(null);
  const channel = (c: ApprovalChannel) => {
    const x = APPROVAL_CHANNELS.find((a) => a.code === c);
    return x ? (lang === "id" ? x.label_id : x.label) : c;
  };
  const approved = i.approval_decision === "approved";

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{tr("Client approval", "Persetujuan klien")}</h3>
        {canEdit && i.status !== "DROPPED" && !form && (
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" icon={BadgeCheck} onClick={() => setForm("approved")}>{tr("Record approval", "Catat persetujuan")}</Button>
            {approved && (
              <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setForm("withdrawn")}>{tr("Withdrawn", "Ditarik")}</Button>
            )}
          </div>
        )}
      </div>
      {!approved && i.status !== "DROPPED" && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
          {tr("No client approval recorded. It is not required (D378) — but an item drawn and ordered without one is a risk worth knowing.",
            "Belum ada persetujuan klien yang dicatat. Tidak wajib (D378) — tapi item yang digambar dan dipesan tanpa persetujuan adalah risiko yang perlu diketahui.")}
        </p>
      )}
      {form && (
        <ApprovalForm i={i} decision={form} onCancel={() => setForm(null)}
          onDone={() => { setForm(null); reload(); onChanged(); }} />
      )}
      <Loaded state={state} onRetry={reload}>
        {(rows: DesignApproval[]) => rows.length === 0 ? (
          <p className="text-[12px] text-slate-400">{tr("Nothing recorded yet.", "Belum ada catatan.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {rows.map((a) => (
              <li key={a.id} className="px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.decision === "approved" ? "green" : "red"}>
                    {a.decision === "approved" ? tr("Approved", "Disetujui") : tr("Withdrawn", "Ditarik")}
                  </Badge>
                  <span className="text-slate-800">{a.decided_on} · {a.client_person}</span>
                  <span className="text-slate-500">{tr("via", "lewat")} {channel(a.channel)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  {a.attachment_filename && <>{tr("File approved:", "File yang disetujui:")} {a.attachment_filename} · </>}
                  {a.evidence_filename && <>{tr("Proof:", "Bukti:")} {a.evidence_filename} · </>}
                  {tr("recorded by", "dicatat oleh")} {a.recorded_by_name ?? "—"}
                </div>
                {a.note && <p className="mt-0.5 text-[12px] text-slate-600">{a.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </section>
  );
}

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

function ApprovalForm({
  i, decision, onDone, onCancel,
}: { i: DesignItemView; decision: "approved" | "withdrawn"; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const [files, setFiles] = useState<AttachmentView[]>([]);
  const [on, setOn] = useState(localToday());
  const [channel, setChannel] = useState<ApprovalChannel>("whatsapp");
  const [person, setPerson] = useState("");
  const [fileId, setFileId] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /* The approved file and its proof are picked from the item's own files: the
     database refuses any other (`file_not_on_item`). */
  useEffect(() => {
    let live = true;
    void documents.byEntity("design_item", i.item_no).then((r) => { if (live) setFiles(r.data ?? []); });
    return () => { live = false; };
  }, [i.item_no]);
  const kindOf = (f: AttachmentView) => f.links.find((l) => l.entity === "design_item" && l.entity_no === i.item_no)?.kind;
  const designFiles = files.filter((f) => kindOf(f) !== "Client Approval");
  const proofFiles = files.filter((f) => kindOf(f) === "Client Approval");

  async function save() {
    setBusy(true);
    const r = await design.recordDesignApproval({
      item_no: i.item_no, decision, decided_on: on, channel, client_person: person.trim(),
      attachment_id: fileId || null, evidence_attachment_id: evidenceId || null, note: note.trim() || null,
    });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", decision === "approved" ? tr("Approval recorded", "Persetujuan dicatat") : tr("Approval withdrawn", "Persetujuan ditarik"), i.item_no);
    onDone();
  }

  return (
    <div className={cn("mb-3 space-y-2 rounded-lg border p-2.5",
      decision === "approved" ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40")}>
      <p className="text-[12px] text-slate-700">
        {decision === "approved"
          ? tr("Who approved, when and how. Attach the proof (a WhatsApp screenshot, a signed print) as a Client Approval file first, then pick it here.",
            "Siapa yang menyetujui, kapan dan lewat apa. Unggah buktinya (screenshot WhatsApp, gambar yang ditandatangani) sebagai file Persetujuan Klien dulu, lalu pilih di sini.")
          : tr("The client took the approval back — say who and when.", "Klien menarik persetujuannya — catat siapa dan kapan.")}
      </p>
      <div className="grid gap-2 sm:grid-cols-[140px_150px_1fr]">
        <label className="text-xs text-slate-500">{tr("Date", "Tanggal")}
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} max={localToday()} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="text-xs text-slate-500">{tr("Channel", "Lewat")}
          <select value={channel} onChange={(e) => setChannel(e.target.value as ApprovalChannel)} className={cn(inputCls, "mt-1")}>
            {APPROVAL_CHANNELS.map((c) => <option key={c.code} value={c.code}>{lang === "id" ? c.label_id : c.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">{tr("Client person", "Orang dari klien")}
          <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder={tr("e.g. Mr. Hendra (owner)", "mis. Pak Hendra (owner)")} className={cn(inputCls, "mt-1")} />
        </label>
      </div>
      {decision === "approved" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-500">{tr("File approved", "File yang disetujui")}
            <select value={fileId} onChange={(e) => setFileId(e.target.value)} className={cn(inputCls, "mt-1")}>
              <option value="">{tr("— not stated —", "— tidak disebut —")}</option>
              {designFiles.map((f) => <option key={f.id} value={f.id}>{kindOf(f)} · {f.filename}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">{tr("Proof", "Bukti")}
            <select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} className={cn(inputCls, "mt-1")}>
              <option value="">{proofFiles.length ? tr("— none —", "— tidak ada —") : tr("— no Client Approval file yet —", "— belum ada file Persetujuan Klien —")}</option>
              {proofFiles.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
            </select>
          </label>
        </div>
      )}
      <label className="block text-xs text-slate-500">{tr("Note", "Catatan")}
        <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")} />
      </label>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={decision === "approved" ? BadgeCheck : Undo2} onClick={save} disabled={busy || !person.trim() || !on}>
          {decision === "approved" ? tr("Record approval", "Catat persetujuan") : tr("Record withdrawal", "Catat penarikan")}
        </Button>
      </div>
    </div>
  );
}

/** Every quotation that offered the item, and the drawing each was priced
 *  on (0225, P5). */
function ItemQuotes({ itemNo, refresh }: { itemNo: string; refresh: string }) {
  const tr = useTr();
  const [state, reload] = useLoad(() => quotation.listQuotationLinesForItem(itemNo), [itemNo, refresh]);
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{tr("Quotations", "Quotation")}</h3>
      <Loaded state={state} onRetry={reload} skeletonRows={1}>
        {(rows: QuotationLineView[]) => rows.length === 0 ? (
          <p className="text-[12px] text-slate-400">
            {tr("Not offered yet. On a draft quotation of this project: From design.", "Belum ditawarkan. Di quotation draft proyek ini: Dari desain.")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {rows.map((l) => (
              <li key={l.id} className="px-3 py-1.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2">
                  <Link href={`/proyek/quotation/${encodeURIComponent(l.quote_no)}`} className="font-mono text-[12px] text-brand-700 hover:underline">
                    {l.quote_no}
                  </Link>
                  <Badge tone={l.status === "ACCEPTED" ? "green" : l.status === "SENT" ? "brand" : l.status === "REJECTED" ? "red" : "slate"}>{l.status}</Badge>
                  <span className="text-slate-600">{formatNumber(l.qty)} {l.uom}</span>
                  <span className="ml-auto tabular-nums text-slate-800">{l.unit_price == null ? "—" : formatIDR(l.unit_price)}</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {l.design_file_name ? tr(`priced on ${l.design_file_name}`, `dihargai dari ${l.design_file_name}`) : tr("no drawing", "tanpa gambar")}
                </p>
                {l.design_changed && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    {tr("drawn again since — revise the quotation to price the new drawing", "sudah digambar ulang — revisi quotation untuk menghargai gambar baru")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </section>
  );
}
