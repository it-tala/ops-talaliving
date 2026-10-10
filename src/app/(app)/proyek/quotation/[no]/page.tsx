"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CopyPlus, FileSignature, Layers, Pencil, Plus, Printer, Save, Send, ThumbsDown, ThumbsUp, Trash2, X,
} from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { UomOptions } from "@/components/ui/uom-options";
import { formatIDR, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, production, quotation } from "@/demo/api";
import { ClosingForm } from "@/components/sales/closing-form";
import {
  QUOTATION_STATUSES, QUOTATION_STATUS_LABEL,
  type QuotationDetail, type QuotationLineView, type QuotationView,
} from "@/services/quotation/contracts";
import { pctOk, quotePrice } from "@/services/quotation/pricing";
import { ActivityLog } from "@/components/crm/activity-log";
import { SaleFiles } from "@/components/files/sale-files";
import {
  LineDesignNote, LineDesignPicker, QuoteFromDesign, groupLines, isHeading, useOfferableItems,
} from "@/components/sales/quote-design";
import { useSession } from "@/store/session";
import { useCanSell } from "@/lib/sell";
import { useToast } from "@/store/toast";
import { useTr, type Tr } from "@/lib/i18n";

/** One quotation: the terms, the lines, the price — and what happens next.
 *
 *  The arithmetic is the owner's sentence: ongkos produksi (from the released
 *  BOM, or typed by hand for something not yet costed) plus marketing and
 *  overhead, divided by what the margin leaves — harga jual. The three
 *  percentages sit on the quotation and every line inherits them; a line can
 *  override any of them, or have its price set outright.
 *
 *  Cost, percentages and margin are shown only to someone who can edit a
 *  project. A reader sees what the client sees.
 */
export default function QuotationPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = use(params);
  const tr = useTr();
  const quoteNo = decodeURIComponent(no);
  const [detail, reload] = useLoad(() => quotation.getQuotation(quoteNo), [quoteNo]);

  return (
    <div>
      <Link href="/proyek/quotation" className="mb-3 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All quotations", "Semua quotation")}
      </Link>
      <Loaded state={detail} onRetry={reload}>
        {(d) => <Editor d={d} reload={reload} source={<SourceBadge state={detail} />} />}
      </Loaded>
    </div>
  );
}

const inputCls = "h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50";

function Editor({ d, reload, source }: { d: QuotationDetail; reload: () => void; source: React.ReactNode }) {
  const tr = useTr();
  const { can } = useSession();
  const canSell = useCanSell();
  const { toast } = useToast();
  const q = d.quotation;
  /* Selling is leadership's and marketing's too (D375); cost and margin stay
     with project access (0133). */
  const mayEdit = canSell();
  const draft = q.status === "DRAFT";
  const editable = mayEdit && draft;
  const seeCost = d.lines.some((l) => l.cost_visible) || (d.lines.length === 0 && can("project.update"));
  const [project, reloadProject] = useLoad(() => procurement.getProject(q.project_code), [q.project_code]);
  const [closingProject, setClosingProject] = useState(false);
  const st = QUOTATION_STATUSES.find((s) => s.code === q.status)!;
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function run<T>(label: string, fn: () => Promise<{ error?: { status: number; message: string } | null; data?: T }>, done?: (data: T) => void) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr(`${label} failed`, `${label} gagal`), res.error.message); return; }
    done?.(res.data as T);
    reload();
  }

  const send = () => {
    if (!window.confirm(tr(`Send ${q.quote_no} to the client? Once sent, prices are locked — changes go through a revision.`, `Kirim ${q.quote_no} ke klien? Setelah dikirim, harga dikunci — perubahan lewat revisi.`))) return;
    return run(tr("Send", "Kirim"), () => quotation.sendQuotation(q.quote_no),
      () => toast("success", tr("Quotation sent", "Quotation terkirim"), tr(`${q.quote_no} — prices locked. Print it to send to the client.`, `${q.quote_no} — harga dikunci. Cetak untuk dikirim ke klien.`)));
  };
  const revise = () => run(tr("Revision", "Revisi"), () => quotation.reviseQuotation(q.quote_no), (v: QuotationView) => {
    toast("success", tr("Revision created", "Revisi dibuat"), `${v.quote_no} · Rev ${v.rev}`);
    window.location.assign(`/proyek/quotation/${encodeURIComponent(v.quote_no)}`);
  });
  const accept = () => {
    if (!window.confirm(tr(`Did the client accept ${q.quote_no}? All items go into project ${q.project_code}'s order at these prices.`, `Klien menyetujui ${q.quote_no}? Semua item masuk ke pesanan proyek ${q.project_code} dengan harga ini.`))) return;
    return run(tr("Acceptance", "Persetujuan"), () => quotation.decideQuotation(q.quote_no, true),
      (r: { order_lines_added: number }) => toast("success", tr("Accepted — now an order", "Disetujui — jadi pesanan"),
        tr(`${r.order_lines_added} items added to order ${q.project_code}. The project moves to Deal.`, `${r.order_lines_added} item masuk ke pesanan ${q.project_code}. Proyek pindah ke Deal.`)));
  };
  const reject = () => run(tr("Rejection", "Penolakan"), () => quotation.decideQuotation(q.quote_no, false, reason),
    () => { setRejecting(false); setReason(""); toast("info", tr("Recorded as rejected", "Dicatat ditolak"), q.quote_no); });

  return (
    <>
      <PageHeader
        breadcrumb={`Quotation · ${q.project_code}`}
        title={`${q.quote_no} · Rev ${q.rev}`}
        description={`${q.project_name}${q.client_name ? ` — ${q.client_name}` : ""}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {source}
            <Badge tone={st.tone}>{st.label}</Badge>
            {q.expired && <Badge tone="red">{tr("Expired", "Kedaluwarsa")}</Badge>}
            <Link href={`/proyek/quotation/${encodeURIComponent(q.quote_no)}/print`} target="_blank">
              <Button variant="outline" icon={Printer}>{draft ? tr("Preview", "Pratinjau") : tr("Print", "Cetak")}</Button>
            </Link>
            {editable && <Button icon={Send} disabled={busy} onClick={send}>{tr("Send to client", "Kirim ke klien")}</Button>}
            {mayEdit && (q.status === "SENT" || q.status === "REJECTED") && q.is_current !== false && (
              <Button variant="outline" icon={CopyPlus} disabled={busy} onClick={revise}>{tr("Revise", "Revisi")}</Button>
            )}
            {mayEdit && q.status === "SENT" && (
              <>
                <Button icon={ThumbsUp} disabled={busy} onClick={accept}>{tr("Accepted", "Disetujui")}</Button>
                <Button variant="outline" icon={ThumbsDown} disabled={busy} onClick={() => setRejecting((v) => !v)}>{tr("Rejected", "Ditolak")}</Button>
              </>
            )}
          </div>
        )}
      />

      {rejecting && (
        <Card className="mb-4 border-rose-200">
          <div className="flex flex-wrap items-end gap-2 px-4 py-3">
            <label className="block flex-1 text-xs text-slate-500">{tr("Why was it rejected?", "Kenapa ditolak?")}
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={tr("price, timing, design — this question will come up again", "harga, waktu, desain — pertanyaan ini akan datang lagi")}
                className={cn(inputCls, "mt-1 h-9")} />
            </label>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={reject}>{tr("Record rejection", "Catat ditolak")}</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>{tr("Cancel", "Batal")}</Button>
          </div>
        </Card>
      )}

      {q.status === "REJECTED" && (
        <div className="mb-4 space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">
          <p>
            {tr("Rejected by the client", "Ditolak klien")}{q.decision_reason ? `: “${q.decision_reason}”` : ""}.{" "}
            {project.status === "ready" && (project.data.status === "INQUIRY" || project.data.status === "QUOTATION_SENT") && q.is_current !== false
              ? tr("This was the quotation in play. Revise it to offer again — or, if the client will not go on, mark the project lost so the pipeline says so.",
                "Ini quotation yang berlaku. Revisi untuk menawarkan ulang — atau, kalau klien tidak lanjut, tandai proyek tidak jadi supaya pipeline mencatatnya.")
              : tr("Create a revision to offer again.", "Buat revisi untuk menawarkan ulang.")}
          </p>
          {mayEdit && q.is_current !== false && project.status === "ready"
            && (project.data.status === "INQUIRY" || project.data.status === "QUOTATION_SENT") && (
            closingProject ? (
              <ClosingForm
                p={project.data}
                onCancel={() => setClosingProject(false)}
                onDone={() => { setClosingProject(false); reloadProject(); reload(); }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" icon={CopyPlus} disabled={busy} onClick={revise}>{tr("Revise", "Revisi")}</Button>
                <Button size="sm" variant="danger" onClick={() => setClosingProject(true)}>
                  {tr(`Mark project ${q.project_code} as lost`, `Tandai proyek ${q.project_code} tidak jadi`)}
                </Button>
              </div>
            )
          )}
          {project.status === "ready" && project.data.status === "LOST" && (
            <p className="text-[12px]">
              {tr(`Project ${q.project_code} is closed as lost`, `Proyek ${q.project_code} ditutup sebagai tidak jadi`)}
              {project.data.closing_reason_code ? ` · ${project.data.closing_reason_code}` : ""}.
            </p>
          )}
        </div>
      )}
      {q.status === "ACCEPTED" && (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800">
          {tr("Accepted", "Disetujui")}{q.decided_at ? ` ${q.decided_at.slice(0, 10)}` : ""} — {tr("its items are now in", "itemnya sudah masuk ke")}{" "}
          <Link href="/proyek/order" className="font-medium underline">{tr(`order ${q.project_code}`, `pesanan ${q.project_code}`)}</Link>.
          {" "}{tr("From there each item can get a Job Order.", "Dari sana tiap item bisa dibuatkan Job Order.")}
        </p>
      )}
      {q.status === "SUPERSEDED" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          {tr("Superseded by a newer revision — see the revision history below.", "Sudah diganti revisi yang lebih baru — lihat riwayat revisi di bawah.")}
        </p>
      )}

      <Terms q={q} editable={editable} seeCost={seeCost} onSaved={reload} />
      <CurrencyBar q={q} rows={d.lines} editable={editable} onSaved={reload} />
      <Lines q={q} rows={d.lines} editable={editable} seeCost={seeCost} onChanged={reload} />
      <Totals q={q} seeCost={seeCost} />

      {/* What the client said about this quotation, and when to ask again —
          the nudge a sent quotation needs (0134). A project with no master
          client has nobody to log against, so it is not offered. */}
      {q.client_code && (
        <div className="mt-4">
          <ActivityLog
            title={tr("Client communication", "Komunikasi dengan klien")}
            filter={{ quote_no: q.quote_no }}
            fixed={{ client_code: q.client_code, project_code: q.project_code, quote_no: q.quote_no }}
          />
        </div>
      )}

      {/* The proposal deck sent with it, the copy the client signed (P1). The
          project's other files are on the project page. */}
      <div className="mt-4">
        <SaleFiles
          targets={[{ entity: "quotation", entity_no: q.quote_no, label: `Quotation ${q.quote_no}` }]}
          canEdit={canSell()}
        />
      </div>

      {d.revisions.length > 1 && (
        <Card className="mt-4">
          <div className="px-4 py-3 text-[13px]">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">{tr("Revision history", "Riwayat revisi")}</p>
            <ul className="space-y-1">
              {d.revisions.map((r) => (
                <li key={r.quote_no} className="flex flex-wrap items-center gap-2">
                  <Link href={`/proyek/quotation/${encodeURIComponent(r.quote_no)}`}
                    className={cn("font-mono text-[12px] hover:underline", r.quote_no === q.quote_no ? "font-bold text-slate-900" : "text-brand-700")}>
                    {r.quote_no}
                  </Link>
                  <span className="text-slate-500">Rev {r.rev}</span>
                  <span className="text-slate-500">· {QUOTATION_STATUS_LABEL(r.status)}</span>
                  {r.sent_at && <span className="text-slate-400">· {tr("sent", "dikirim")} {r.sent_at.slice(0, 10)}</span>}
                  <span className="ml-auto tabular-nums text-slate-700">{r.grand_total == null ? "—" : formatMoney(r.grand_total, r.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}

/* ── the terms: validity, the three percentages, PPN ───────────────────── */

function Terms({ q, editable, seeCost, onSaved }: { q: QuotationView; editable: boolean; seeCost: boolean; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(() => termsOf(q));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await quotation.saveQuotation({
      quote_no: q.quote_no, valid_until: f.valid_until || null,
      marketing_pct: f.marketing_pct, overhead_pct: f.overhead_pct, margin_pct: f.margin_pct,
      vat: f.vat, vat_pct: f.vat_pct, terms: f.terms || null, note: f.note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Terms saved", "Ketentuan disimpan"), tr("Every line's price was recalculated.", "Harga semua baris dihitung ulang."));
    setEditing(false);
    onSaved();
  }

  const pct = (key: "marketing_pct" | "overhead_pct" | "margin_pct", label: string) => (
    <label className="block text-xs text-slate-500">{label}
      <NumberInput value={f[key]} min={0} max={99.99} step={0.5} onChange={(v) => setF({ ...f, [key]: v })} className="mt-1" />
    </label>
  );

  if (editing) {
    const ok = [f.marketing_pct, f.overhead_pct, f.margin_pct].every(pctOk);
    return (
      <Card className="mb-4">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          {pct("marketing_pct", "Marketing %")}
          {pct("overhead_pct", "Overhead %")}
          {pct("margin_pct", tr("Margin % (of selling price)", "Margin % (dari harga jual)"))}
          <label className="block text-xs text-slate-500">{tr("Valid until", "Berlaku sampai")}
            <input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })}
              className={cn(inputCls, "mt-1 h-10")} />
          </label>
          <div className="text-xs text-slate-500">PPN
            <div className="mt-1 flex h-10 items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
                <input type="checkbox" checked={f.vat} onChange={(e) => setF({ ...f, vat: e.target.checked })} /> {tr("Charge", "Kenakan")}
              </label>
              {f.vat && <NumberInput size="sm" value={f.vat_pct} min={0} max={99} step={1} onChange={(v) => setF({ ...f, vat_pct: v })} className="!w-16" />}
              {f.vat && <span>%</span>}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 lg:col-span-1">
            {tr("Example cost 1,000,000 →", "Contoh ongkos 1.000.000 →")}{" "}
            <strong className="tabular-nums text-slate-800">
              {ok ? formatIDR(quotePrice(1_000_000, f.marketing_pct, f.overhead_pct, f.margin_pct) ?? 0) : "—"}
            </strong>
          </div>
          <label className="block text-xs text-slate-500 sm:col-span-3">{tr("Terms & conditions (shown on the printout)", "Syarat & ketentuan (tampil di cetakan)")}
            <textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} rows={3}
              placeholder={tr("e.g. 50% down payment, balance before delivery. Prices exclude installation.", "mis. DP 50%, pelunasan sebelum kirim. Harga belum termasuk instalasi.")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]" />
          </label>
          <label className="block text-xs text-slate-500 sm:col-span-3">{tr("Note to the client", "Catatan untuk klien")}
            <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{tr("Cancel", "Batal")}</Button>
          <Button size="sm" icon={Save} disabled={busy || !ok} onClick={save}>{tr("Save", "Simpan")}</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-2 px-4 py-3 text-[13px]">
        {([
          ...(seeCost ? [
            ["Marketing", `${formatNumber(q.marketing_pct)}%`],
            ["Overhead", `${formatNumber(q.overhead_pct)}%`],
            ["Margin", tr(`${formatNumber(q.margin_pct)}% of selling price`, `${formatNumber(q.margin_pct)}% dari harga jual`)],
          ] : []),
          [tr("VAT (PPN)", "PPN"), q.vat ? `${formatNumber(q.vat_pct)}%` : tr("not charged", "tidak dikenakan")],
          [tr("Valid until", "Berlaku sampai"), q.valid_until ?? "—"],
          [tr("Production estimate", "Estimasi produksi"), q.max_lead_time_days == null ? "—" : tr(`${q.max_lead_time_days} working days`, `${q.max_lead_time_days} hari kerja`)],
          [tr("Sent", "Dikirim"), q.sent_at ? q.sent_at.slice(0, 10) : tr("not yet", "belum")],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k}>
            <span className="block text-[11px] uppercase tracking-wide text-slate-400">{k}</span>
            <span className="text-slate-800">{v}</span>
          </div>
        ))}
        {editable && (
          <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto" onClick={() => { setF(termsOf(q)); setEditing(true); }}>
            {tr("Edit", "Ubah")}
          </Button>
        )}
        {(q.terms || q.note) && (
          <div className="w-full space-y-1 text-[12px] text-slate-600">
            {q.terms && <p className="whitespace-pre-line"><span className="text-slate-400">{tr("Terms: ", "Syarat: ")}</span>{q.terms}</p>}
            {q.note && <p className="whitespace-pre-line"><span className="text-slate-400">{tr("Note: ", "Catatan: ")}</span>{q.note}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── the currency and the kurs (0256, D414) ──────────────────────────────── */

/** IDR or USD, and the kurs — rupiah per 1 USD, typed by a person, never
 *  fetched (D181). The kurs converts a cost in the other currency (a factory
 *  priced in USD on a rupiah quotation, our BOM on a dollar one) and reads a
 *  USD quotation in rupiah for the pipeline. A USD quotation is not sent
 *  without it. Its own seam, so the terms form keeps its own. */
function CurrencyBar({
  q, rows, editable, onSaved,
}: { q: QuotationView; rows: QuotationLineView[]; editable: boolean; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [cur, setCur] = useState(q.currency);
  const [rate, setRate] = useState(q.fx_rate == null ? "" : String(q.fx_rate));
  const [busy, setBusy] = useState(false);
  const needs = rows.filter((l) => l.cost_needs_rate).length;
  const rateNum = rate.trim() === "" ? null : Number(rate);
  const changed = cur !== q.currency || rateNum !== q.fx_rate;
  const bad = rateNum != null && !(rateNum > 0);

  async function save() {
    setBusy(true);
    const res = await quotation.setQuotationCurrency(q.quote_no, cur, rateNum);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Currency saved", "Mata uang disimpan"),
      cur === "USD"
        ? tr(`USD${rateNum ? ` at Rp ${formatNumber(rateNum)}` : " — no kurs yet"}. Prices recalculated.`, `USD${rateNum ? ` dengan kurs Rp ${formatNumber(rateNum)}` : " — kurs belum diisi"}. Harga dihitung ulang.`)
        : tr("Rupiah. Prices recalculated.", "Rupiah. Harga dihitung ulang."));
    onSaved();
  }

  if (!editable) {
    if (q.currency === "IDR" && q.fx_rate == null) return null;
    return (
      <p className="mb-4 text-[12px] text-slate-600">
        {tr("Currency", "Mata uang")} <strong className="text-slate-800">{q.currency}</strong>
        {q.fx_rate != null && <> · {tr("kurs", "kurs")} <strong className="tabular-nums text-slate-800">Rp {formatNumber(q.fx_rate)}</strong> / USD</>}
      </p>
    );
  }
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-end gap-3 px-4 py-2.5 text-[13px]">
        <div className="text-xs text-slate-500">{tr("Currency", "Mata uang")}
          <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-200">
            {(["IDR", "USD"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCur(c)}
                className={cn("h-8 px-3 text-[13px]", cur === c ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-xs text-slate-500">{tr("Kurs (Rp per 1 USD)", "Kurs (Rp untuk 1 USD)")}
          <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
            placeholder={cur === "USD" ? tr("e.g. 16250", "mis. 16250") : tr("only if a cost is in USD", "hanya bila ada ongkos dalam USD")}
            className="mt-1 h-8 w-44 rounded-lg border border-slate-200 px-2 text-right text-[13px] tabular-nums focus:border-brand-400 focus:outline-none" />
        </label>
        <Button size="sm" icon={Save} disabled={busy || !changed || bad} onClick={save}>{tr("Save", "Simpan")}</Button>
        <p className="min-w-[16rem] flex-1 text-[11px] text-slate-500">
          {cur === "USD"
            ? tr("Prices in USD, to the cent. The kurs reads them in rupiah for the pipeline and the order; it is needed before sending.",
              "Harga dalam USD, sampai sen. Kurs membaca nilainya dalam rupiah untuk pipeline dan pesanan; wajib diisi sebelum dikirim.")
            : tr("Prices in rupiah. A kurs is needed only when a factory priced an item in USD.",
              "Harga dalam rupiah. Kurs hanya perlu bila pabrik memberi harga dalam USD.")}
        </p>
        {(needs > 0 || (q.currency === "USD" && q.fx_rate == null)) && (
          <p className="w-full text-[12px] text-amber-700">
            {needs > 0
              ? tr(`${needs} line(s) have a cost in the other currency — fill in the kurs to price them.`, `${needs} baris punya ongkos dalam mata uang lain — isi kurs supaya berharga.`)
              : tr("Fill in the kurs before sending.", "Isi kurs sebelum dikirim.")}
          </p>
        )}
      </div>
    </Card>
  );
}

const termsOf = (q: QuotationView) => ({
  valid_until: q.valid_until ?? "", marketing_pct: q.marketing_pct, overhead_pct: q.overhead_pct,
  margin_pct: q.margin_pct, vat: q.vat, vat_pct: q.vat_pct, terms: q.terms ?? "", note: q.note ?? "",
});

/* ── the lines ───────────────────────────────────────────────────────────── */

interface LineDraft {
  product_code: string; description: string; qty: number; uom: string; lead: string;
  manual_cost: string; mkt: string; ovh: string; mrg: string; price: string; note: string;
  /** The design item and the pinned drawing (0225); empty for none / latest. */
  item_no: string; file_id: string;
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

const draftOf = (l: QuotationLineView | null): LineDraft => ({
  product_code: l?.product_code ?? "", description: l?.description ?? "", qty: l?.qty ?? 1, uom: l?.uom ?? "unit",
  lead: str(l?.line_lead_time_days), manual_cost: str(l?.manual_unit_cost),
  mkt: str(l?.line_marketing_pct), ovh: str(l?.line_overhead_pct), mrg: str(l?.line_margin_pct),
  price: str(l?.unit_price_override), note: l?.note ?? "",
  item_no: l?.design_item_no ?? "", file_id: l?.line_design_file_id ?? "",
});

function Lines({
  q, rows, editable, seeCost, onChanged,
}: {
  q: QuotationView; rows: QuotationLineView[]; editable: boolean; seeCost: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [products] = useLoad(() => production.listProducts({}), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [d, setD] = useState<LineDraft>(draftOf(null));
  const [busy, setBusy] = useState(false);
  const [fromDesign, setFromDesign] = useState(false);
  const known = products.status === "ready" ? products.data : [];
  const items = useOfferableItems(editable ? q.project_code : null);

  async function save(id: string | null) {
    setBusy(true);
    let res = await quotation.saveQuotationLine(q.quote_no, {
      id, product_code: d.product_code || null, description: d.description || null, qty: d.qty, uom: d.uom,
      lead_time_days: num(d.lead), manual_unit_cost: num(d.manual_cost),
      marketing_pct: num(d.mkt), overhead_pct: num(d.ovh), margin_pct: num(d.mrg),
      unit_price_override: num(d.price), note: d.note || null,
    });
    /* The design item goes through its own seam (0225), so the line's own
       save keeps the signature the running app calls. */
    const before = id ? rows.find((l) => l.id === id) : undefined;
    if (!res.error && ((before?.design_item_no ?? "") !== d.item_no || (before?.line_design_file_id ?? "") !== d.file_id)) {
      const linked = await quotation.setQuotationLineDesign(q.quote_no, res.data.id, d.item_no || null, d.file_id || null);
      if (linked.error) { setBusy(false); onChanged(); toast("warning", tr("Line saved, design item not linked", "Baris tersimpan, item desain tidak terhubung"), linked.error.message); return; }
      res = linked;
    }
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", id ? tr("Line updated", "Baris diperbarui") : tr("Item added", "Item ditambahkan"),
      `${res.data.description} · ${res.data.unit_price == null ? tr("no price yet", "belum berharga") : formatMoney(res.data.unit_price, q.currency)}`);
    setEditing(null);
    onChanged();
  }

  async function remove(l: QuotationLineView) {
    if (!window.confirm(tr(`Remove “${l.description}” from the quotation?`, `Hapus “${l.description}” dari quotation?`))) return;
    setBusy(true);
    const res = await quotation.removeQuotationLine(q.quote_no, l.id);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    onChanged();
  }

  /* What the row being edited would come to, before it is saved — the same
     function the database runs. */
  const picked = known.find((p) => p.product_code === d.product_code.trim().toUpperCase());
  /* The released cost is only known for a saved line (the catalogue's own
     figure may be the open draft's); a new line shows its price on save. */
  const saved = editing && editing !== "new" ? rows.find((l) => l.id === editing) : undefined;
  const liveCost = num(d.manual_cost)
    ?? (saved && !saved.cost_is_manual
        && (saved.cost_source === "factory" || saved.product_code === d.product_code.trim().toUpperCase()) ? saved.unit_cost : null);
  const preview = num(d.price) ?? quotePrice(liveCost,
    num(d.mkt) ?? q.marketing_pct, num(d.ovh) ?? q.overhead_pct, num(d.mrg) ?? q.margin_pct, q.currency);

  const pctCell = (key: "mkt" | "ovh" | "mrg", inherit: number, label: string) => (
    <input value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} inputMode="decimal"
      placeholder={formatNumber(inherit)} aria-label={label} title={tr(`${label} — empty: follows the quotation (${formatNumber(inherit)}%)`, `${label} — kosong: ikut quotation (${formatNumber(inherit)}%)`)}
      className={cn(inputCls, "w-14 text-right")} />
  );

  const editRow = (id: string | null) => (
    <tr className="border-b border-slate-100 bg-brand-50/40 align-top">
      <td className="px-3 py-2">
        <input value={d.product_code} onChange={(e) => {
          const code = e.target.value.toUpperCase();
          const hit = known.find((x) => x.product_code === code);
          setD({ ...d, product_code: code, uom: hit?.uom ?? d.uom });
        }}
          list="qt-products" placeholder={tr("item code (from catalog)", "item code (dari katalog)")} aria-label="Item code"
          className={cn(inputCls, "font-mono text-[12px]")} autoFocus />
        <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
          placeholder={picked ? picked.name : tr("item name for the client", "nama item untuk klien")} aria-label={tr("Description", "Deskripsi")} className={cn(inputCls, "mt-1")} />
        <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })}
          placeholder={tr("details (optional) — size, finishing", "keterangan (opsional) — ukuran, finishing")} aria-label={tr("Details", "Keterangan")} className={cn(inputCls, "mt-1 h-7 text-[12px]")} />
        <LineDesignPicker items={items} itemNo={d.item_no} fileId={d.file_id}
          onChange={(item_no, file_id) => setD({ ...d, item_no, file_id })} />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <NumberInput size="sm" value={d.qty} min={0} max={999_999} step={1} onChange={(v) => setD({ ...d, qty: v })} className="!w-16" />
          <select value={d.uom} onChange={(e) => setD({ ...d, uom: e.target.value })} aria-label={tr("Unit", "Satuan")}
            className="h-8 rounded-lg border border-slate-200 bg-white px-1 text-[12px]">
            <UomOptions current={d.uom} />
          </select>
        </div>
      </td>
      <td className="px-3 py-2">
        <input value={d.lead} onChange={(e) => setD({ ...d, lead: e.target.value })} inputMode="numeric"
          placeholder={picked?.lead_time_days != null ? String(picked.lead_time_days) : tr("days", "hari")} aria-label={tr("Production estimate (days)", "Estimasi produksi (hari)")}
          className={cn(inputCls, "w-16 text-right")} />
      </td>
      {seeCost && (
        <td className="px-3 py-2 text-right">
          <input value={d.manual_cost} onChange={(e) => setD({ ...d, manual_cost: e.target.value })} inputMode="numeric"
            placeholder={saved?.unit_cost != null && !saved.cost_is_manual ? formatNumber(saved.unit_cost) : tr("factory / BOM", "pabrik / BOM")}
            aria-label={tr("Manual cost per unit", "Ongkos manual per unit")}
            title={tr(`Empty: the factory price chosen for the design item, else the released BOM. Typed: in ${q.currency}.`,
              `Kosong: harga pabrik yang dipilih untuk item desain, kalau tidak ada BOM yang dirilis. Diketik: dalam ${q.currency}.`)}
            className={cn(inputCls, "w-28 text-right")} />
        </td>
      )}
      {seeCost && (
        <td className="px-3 py-2">
          <div className="flex justify-end gap-1">
            {pctCell("mkt", q.marketing_pct, "Marketing %")}
            {pctCell("ovh", q.overhead_pct, "Overhead %")}
            {pctCell("mrg", q.margin_pct, "Margin %")}
          </div>
        </td>
      )}
      <td className="px-3 py-2 text-right">
        <input value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} inputMode="numeric"
          placeholder={preview == null ? tr("selling price", "harga jual") : formatNumber(preview)} aria-label={tr("Selling price per unit (fixed)", "Harga jual per unit (tetapkan)")}
          title={tr("Empty: calculated by the formula", "Kosong: dihitung dari rumus")} className={cn(inputCls, "w-28 text-right")} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
        {preview == null ? "—" : formatMoney(preview * d.qty, q.currency)}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        <button onClick={() => save(id)} disabled={busy || (!d.description.trim() && !d.product_code.trim()) || d.qty <= 0}
          aria-label={tr("Save", "Simpan")} className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => setEditing(null)} aria-label={tr("Cancel", "Batal")} className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );

  const cols = 5 + (seeCost ? 2 : 0) + (editable ? 1 : 0);

  return (
    <Card>
      <datalist id="qt-products">
        {known.map((x) => <option key={x.product_code} value={x.product_code}>{x.name}</option>)}
      </datalist>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <FileSignature className="h-4 w-4 text-slate-400" />
        <p className="text-[13px] font-semibold text-slate-800">{tr("Items offered", "Item ditawarkan")}</p>
        <span className="text-[12px] text-slate-400">
          {tr(`${rows.length} lines`, `${rows.length} baris`)}
          {q.lines_without_cost > 0 && draftCount(q, tr)}
        </span>
        {editable && editing === null && !fromDesign && (
          <div className="ml-auto flex gap-1.5">
            {items.length > 0 && (
              <Button size="sm" variant="outline" icon={Layers} onClick={() => setFromDesign(true)}>
                {tr("From design", "Dari desain")}
              </Button>
            )}
            <Button size="sm" icon={Plus} onClick={() => { setD(draftOf(null)); setEditing("new"); }}>
              {tr("Add item", "Tambah item")}
            </Button>
          </div>
        )}
      </div>
      {fromDesign && (
        <QuoteFromDesign quoteNo={q.quote_no} items={items} onLines={rows}
          onDone={() => { setFromDesign(false); onChanged(); }} onCancel={() => setFromDesign(false)} />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">{tr("Item", "Item")}</th>
              <th className="px-3 py-2 text-right">{tr("Quantity", "Jumlah")}</th>
              <th className="px-3 py-2 text-right">{tr("Production", "Produksi")}</th>
              {seeCost && <th className="px-3 py-2 text-right">{tr("Cost / unit", "Ongkos / unit")}</th>}
              {seeCost && <th className="px-3 py-2 text-right">Mkt · Ovh · Margin %</th>}
              <th className="px-3 py-2 text-right">{tr("Selling price / unit", "Harga jual / unit")}</th>
              <th className="px-3 py-2 text-right">{tr("Line total", "Jumlah harga")}</th>
              {editable && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {groupLines(rows).map((l) => isHeading(l) ? (
              <tr key={`h-${l.key}`} className="border-b border-slate-100 bg-slate-50/50">
                <td colSpan={cols} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l.heading || tr("Other items", "Item lain")}
                </td>
              </tr>
            ) : editing === l.id ? <Frag key={l.id}>{editRow(l.id)}</Frag> : (
              <tr key={l.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-3 py-2">
                  <span className="block text-slate-800">{l.line_no}. {l.description}</span>
                  {l.product_code && (
                    <Link href={`/produksi/bom?open=${encodeURIComponent(l.product_code)}`}
                      className="font-mono text-[11px] text-brand-700 hover:underline">
                      {l.product_code}{l.bom_rev != null && ` · BOM rev ${l.bom_rev}`}
                    </Link>
                  )}
                  {l.product_code && !l.product_exists && <span className="block text-[11px] text-amber-700">{tr("not in the catalog", "tidak ada di katalog")}</span>}
                  {l.note && <span className="block text-[11px] text-slate-500">{l.note}</span>}
                  <LineDesignNote l={l} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(l.qty)} {l.uom}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                  {l.lead_time_days == null ? <span className="text-slate-300">—</span> : tr(`${l.lead_time_days} d`, `${l.lead_time_days} hr`)}
                </td>
                {seeCost && (
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {l.unit_cost == null ? (
                      <span className="text-[12px] text-amber-700">
                        {l.cost_needs_rate
                          ? tr(`${l.cost_original == null ? "" : formatMoney(l.cost_original, l.cost_currency)} — needs the kurs`, `${l.cost_original == null ? "" : formatMoney(l.cost_original, l.cost_currency)} — perlu kurs`)
                          : l.product_code && l.product_exists ? tr("BOM not released / incomplete", "BOM belum dirilis / belum lengkap") : tr("record a factory price or a manual cost", "catat harga pabrik atau isi ongkos manual")}
                      </span>
                    ) : (
                      <>
                        <span className="text-slate-700">{formatMoney(l.unit_cost, q.currency)}</span>
                        <span className="block text-[11px] text-slate-400">
                          {l.cost_source === "manual" ? tr("manual", "manual")
                            : l.cost_source === "factory" ? tr(`factory · ${l.factory_vendor_name ?? l.factory_quote_no ?? ""}`, `pabrik · ${l.factory_vendor_name ?? l.factory_quote_no ?? ""}`)
                              : tr("from BOM", "dari BOM")}
                        </span>
                        {l.cost_original != null && l.cost_currency && l.cost_currency !== q.currency && (
                          <span className="block text-[11px] text-slate-400">{formatMoney(l.cost_original, l.cost_currency)}</span>
                        )}
                      </>
                    )}
                  </td>
                )}
                {seeCost && (
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", l.pct_overridden ? "text-brand-700" : "text-slate-500")}>
                    {[l.marketing_pct, l.overhead_pct, l.margin_pct].map((v) => formatNumber(v ?? 0)).join(" · ")}
                    {l.pct_overridden && <span className="block text-[11px]">{tr("this line only", "khusus baris ini")}</span>}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-800">
                  {l.unit_price == null ? <span className="text-slate-300">—</span> : formatMoney(l.unit_price, q.currency)}
                  {l.unit_price_override != null && seeCost && (
                    <span className="block text-[11px] text-slate-400">
                      {tr("fixed", "ditetapkan")}{l.computed_unit_price != null && tr(` · formula ${formatMoney(l.computed_unit_price, q.currency)}`, ` · rumus ${formatMoney(l.computed_unit_price, q.currency)}`)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-slate-800">
                  {l.unit_price == null ? <span className="text-slate-300">—</span> : formatMoney(l.unit_price * l.qty, q.currency)}
                </td>
                {editable && (
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button onClick={() => { setD(draftOf(l)); setEditing(l.id); }} disabled={busy || editing !== null} aria-label={tr("Edit", "Ubah")}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(l)} disabled={busy} aria-label={tr("Remove", "Hapus")}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                )}
              </tr>
            ))}
            {editing === "new" && editRow(null)}
            {rows.length === 0 && editing !== "new" && (
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">
                {tr("No items yet. Pick an item code from the catalog — its production cost is read from the released BOM.", "Belum ada item. Pilih item code dari katalog — ongkos produksinya terbaca dari BOM yang sudah dirilis.")}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && editing !== null && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          {tr(
            "Leave the cost empty to use the factory price chosen for the design item, else the released BOM; leave percentages empty to follow the quotation; fill in the selling price only to set a price outside the formula.",
            "Kosongkan ongkos untuk memakai harga pabrik yang dipilih untuk item desain, kalau tidak ada BOM yang dirilis; kosongkan persentase untuk ikut quotation; isi harga jual hanya bila ingin menetapkan harga di luar rumus.",
          )}
        </p>
      )}
    </Card>
  );
}

const draftCount = (q: QuotationView, tr: Tr) =>
  q.status === "DRAFT" ? <span className="text-amber-700">{tr(` · ${q.lines_without_cost} without a cost yet`, ` · ${q.lines_without_cost} belum punya ongkos`)}</span> : null;

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ── the bottom line ─────────────────────────────────────────────────────── */

function Totals({ q, seeCost }: { q: QuotationView; seeCost: boolean }) {
  const tr = useTr();
  const gross = q.subtotal != null && q.cost_total != null ? q.subtotal - q.cost_total : null;
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-6 px-4 py-3 text-[13px]">
        {seeCost ? (
          <div className="space-y-1 text-slate-600">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Internal — not printed", "Internal — tidak tercetak")}</p>
            <p>{tr("Total production cost", "Total ongkos produksi")} <strong className="tabular-nums text-slate-800">{q.cost_total == null ? "—" : formatMoney(q.cost_total, q.currency)}</strong></p>
            <p>
              {tr("Selling price − cost", "Selisih harga jual − ongkos")}{" "}
              <strong className="tabular-nums text-slate-800">{gross == null ? "—" : formatMoney(gross, q.currency)}</strong>
              {gross != null && q.subtotal ? <span className="text-slate-500">{tr(` (${formatNumber(Math.round((gross / q.subtotal) * 1000) / 10)}% of selling price — covers marketing, overhead and margin)`, ` (${formatNumber(Math.round((gross / q.subtotal) * 1000) / 10)}% dari harga jual — menutup marketing, overhead, dan margin)`)}</span> : null}
            </p>
          </div>
        ) : <span />}
        <table className="text-[13px]">
          <tbody>
            <tr><td className="pr-6 text-slate-500">{tr("Subtotal", "Subtotal")}</td><td className="text-right tabular-nums">{q.subtotal == null ? "—" : formatMoney(q.subtotal, q.currency)}</td></tr>
            {q.vat && (
              <tr><td className="pr-6 text-slate-500">{tr("VAT (PPN)", "PPN")} {formatNumber(q.vat_pct)}%</td><td className="text-right tabular-nums">{q.vat_amount == null ? "—" : formatMoney(q.vat_amount, q.currency)}</td></tr>
            )}
            <tr className="border-t border-slate-200">
              <td className="pr-6 pt-1 font-semibold text-slate-800">{tr("Total", "Total")}</td>
              <td className="pt-1 text-right text-base font-bold tabular-nums text-slate-900">{q.grand_total == null ? "—" : formatMoney(q.grand_total, q.currency)}</td>
            </tr>
            {q.currency === "USD" && (
              <tr>
                <td className="pr-6 text-[11px] text-slate-400">{tr("In rupiah", "Dalam rupiah")}</td>
                <td className="text-right text-[12px] tabular-nums text-slate-500">
                  {q.grand_total_idr == null ? tr("needs the kurs", "perlu kurs") : `≈ ${formatIDR(q.grand_total_idr)}`}
                  {q.fx_rate != null && <span className="block text-[11px] text-slate-400">{tr("kurs", "kurs")} Rp {formatNumber(q.fx_rate)}</span>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
