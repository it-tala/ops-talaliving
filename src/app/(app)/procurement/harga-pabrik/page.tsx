"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, ChevronDown, ChevronRight, Factory, Paperclip, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { FactoryLineRow, FactoryQuoteForm, useFactoryAccess } from "@/components/design/factory-prices";
import { design } from "@/demo/api";
import { cn } from "@/lib/cn";
import type { FactoryQuote, FactoryQuoteLine } from "@/services/design/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Procurement › Factory prices (0256, O2, kajian F255 §5.3).
 *
 *  TALA finds the order; a partner factory makes it. Procurement sends the
 *  drawings and the BOM and records what comes back (Q90): one offer per
 *  factory per project, in IDR or USD, with a price per design item and the
 *  factory's own paper. The newest offer from a factory is the one that
 *  counts; the first offer for an item prices it until somebody chooses
 *  another factory — on the item, here, or in Design. A wrong offer is voided
 *  with a reason, never edited, so what was quoted stays on record for the
 *  evaluation O9 will read.
 */
export default function FactoryPricesPage() {
  const tr = useTr();
  const access = useFactoryAccess();
  const [project, setProject] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  const [recording, setRecording] = useState(false);
  const [state, reload] = useLoad(() => design.listFactoryQuotes(project ? { project_code: project } : {}), [project]);
  const [all] = useLoad(() => design.listFactoryQuotes({}), [state]);
  const projects = all.status === "ready"
    ? [...new Map(all.data.map((q) => [q.project_code, q])).values()].sort((a, b) => a.project_code.localeCompare(b.project_code))
    : [];

  /* Factory prices are procurement's and the cost readers' (D375, D415): a
     seller reaching this address sees why not, not the prices. */
  if (!access.see) {
    return (
      <div>
        <PageHeader breadcrumb={tr("Procurement", "Procurement")} title={tr("Factory prices", "Harga pabrik")} />
        <Card>
          <p className="px-4 py-6 text-[13px] text-slate-600">
            {tr("Factory prices are for procurement and for whoever sees a quotation's cost (project editors).",
              "Harga pabrik untuk procurement dan untuk yang melihat ongkos quotation (pengelola proyek).")}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Procurement")}
        title={tr("Factory prices", "Harga pabrik")}
        description={tr(
          "What the partner factories quoted for each design item. The chosen price is what a quotation to the client is costed from.",
          "Harga yang diberikan pabrik mitra untuk setiap item desain. Harga yang dipilih menjadi ongkos di quotation ke klien.")}
        actions={access.write && (
          <Button icon={Plus} onClick={() => setRecording(true)}>{tr("Record an offer", "Catat penawaran")}</Button>
        )}
      />

      <Card>
        <CardHeader
          title={tr("Offers", "Penawaran")}
          subtitle={tr("Newest first. Open one to see its prices per item.", "Terbaru di atas. Buka satu untuk melihat harga per item.")}
          icon={Factory}
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge state={state} />
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                {tr("Show voided", "Tampilkan yang dibatalkan")}
              </label>
              <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={tr("Project", "Proyek")}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">
                <option value="">{tr("All projects", "Semua proyek")}</option>
                {projects.map((p) => <option key={p.project_code} value={p.project_code}>{p.project_code} · {p.project_name}</option>)}
              </select>
            </div>
          )}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => {
            const shown = rows.filter((q) => showVoided || !q.voided_at);
            return shown.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">
                {rows.length
                  ? tr("Only voided offers here.", "Hanya ada penawaran yang dibatalkan.")
                  : tr("No factory has quoted yet. Record the first offer when a factory answers with its prices.",
                    "Belum ada penawaran pabrik. Catat penawaran pertama saat pabrik mengirim harganya.")}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((q) => <OfferRow key={q.id} q={q} canWrite={access.write} onChanged={reload} />)}
              </ul>
            );
          }}
        </Loaded>
      </Card>

      <Drawer open={recording} onClose={() => setRecording(false)} width="max-w-2xl"
        title={tr("Record a factory offer", "Catat penawaran pabrik")}
        subtitle={tr("One factory, one project; a price for each item it covers.", "Satu pabrik, satu proyek; harga untuk setiap item yang ditawar.")}>
        {recording && (
          <FactoryQuoteForm projectCode={project || null}
            onCancel={() => setRecording(false)}
            onDone={() => { setRecording(false); reload(); }} />
        )}
      </Drawer>
    </div>
  );
}

function OfferRow({ q, canWrite, onChanged }: { q: FactoryQuote; canWrite: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, reloadLines] = useLoad(
    () => (open ? design.listFactoryQuoteLines({ fq_no: q.fq_no }) : Promise.resolve({ data: null })), [open, q.fq_no]);

  async function voidIt() {
    setBusy(true);
    const res = await design.voidFactoryQuote(q.fq_no, reason.trim());
    setBusy(false);
    if (res.error) { toast("warning", tr("Not voided", "Tidak dibatalkan"), res.error.message); return; }
    toast("success", tr(`${q.fq_no} voided`, `${q.fq_no} dibatalkan`),
      tr("Items priced from it fall back to the same factory's newest price, else to none.", "Item yang dihargai dari penawaran ini kembali ke harga terbaru pabrik yang sama, kalau tidak ada tanpa harga pabrik."));
    setVoiding(false);
    setReason("");
    onChanged();
  }

  async function choose(l: FactoryQuoteLine) {
    const res = await design.chooseFactoryLine(l.item_no, l.id);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success", tr("Factory chosen", "Pabrik dipilih"), `${l.item_no} · ${q.vendor_name ?? ""}`);
    reloadLines();
    onChanged();
  }

  return (
    <li className={cn("px-4 py-2.5 text-[13px]", q.voided_at && "bg-slate-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-left"
          aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          <span className="font-medium text-slate-800">{q.vendor_name ?? q.vendor_code}</span>
        </button>
        <span className="font-mono text-[11px] text-slate-400">{q.fq_no}</span>
        <Badge tone="slate">{q.currency}</Badge>
        {q.voided_at && <Badge tone="red">{tr("Voided", "Dibatalkan")}</Badge>}
        {!q.voided_at && q.expired && <Badge tone="amber">{tr("Past validity", "Lewat masa berlaku")}</Badge>}
        <Link href={`/proyek/order?open=${encodeURIComponent(q.project_code)}`} className="text-[12px] text-brand-700 hover:underline">
          {q.project_code} · {q.project_name}
        </Link>
        {q.client_display && <span className="text-[12px] text-slate-500">{q.client_display}</span>}
        <span className="ml-auto text-[12px] text-slate-500">
          {tr(`${q.line_count} item(s) · ${q.chosen_count} chosen`, `${q.line_count} item · ${q.chosen_count} dipilih`)}
        </span>
      </div>
      <p className="mt-0.5 pl-5 text-[11px] text-slate-500">
        {[
          `${tr("quoted", "penawaran")} ${q.quoted_on}`,
          q.valid_until ? tr(`valid to ${q.valid_until}`, `berlaku s.d. ${q.valid_until}`) : null,
          q.recorded_by_name ? tr(`recorded by ${q.recorded_by_name}`, `dicatat ${q.recorded_by_name}`) : null,
          q.note,
        ].filter(Boolean).join(" · ")}
        {q.attachment_filename && (
          <> · {q.attachment_url
            ? <a href={q.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"><Paperclip className="h-3 w-3" />{q.attachment_filename}</a>
            : <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{q.attachment_filename}</span>}</>
        )}
      </p>
      {q.voided_at && q.void_reason && <p className="pl-5 text-[11px] text-rose-700">{tr("Voided", "Dibatalkan")}: {q.void_reason}</p>}
      {open && (
        <div className="mt-2 pl-5">
          <Loaded state={lines} onRetry={reloadLines} skeletonRows={1}>
            {(rows) => (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {(rows ?? []).map((l) => <FactoryLineRow key={l.id} l={l} showItem canChoose={canWrite} onChoose={choose} />)}
              </ul>
            )}
          </Loaded>
          {canWrite && !q.voided_at && (
            voiding ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                  placeholder={tr("why — wrong price, wrong item, wrong factory", "kenapa — salah harga, salah item, salah pabrik")}
                  className="h-8 min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none" />
                <Button size="sm" variant="danger" icon={Ban} disabled={busy || !reason.trim()} onClick={voidIt}>{tr("Void offer", "Batalkan penawaran")}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setVoiding(false); setReason(""); }}>{tr("Cancel", "Batal")}</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setVoiding(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-700">
                <Ban className="h-3 w-3" /> {tr("Void this offer", "Batalkan penawaran ini")}
              </button>
            )
          )}
        </div>
      )}
    </li>
  );
}
