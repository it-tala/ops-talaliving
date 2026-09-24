"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CopyPlus, FileSignature, Pencil, Plus, Printer, Save, Send, ThumbsDown, ThumbsUp, Trash2, X,
} from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { UomOptions } from "@/components/ui/uom-options";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production, quotation } from "@/demo/api";
import {
  QUOTATION_STATUSES, QUOTATION_STATUS_LABEL,
  type QuotationDetail, type QuotationLineView, type QuotationView,
} from "@/services/quotation/contracts";
import { pctOk, quotePrice } from "@/services/quotation/pricing";
import { ActivityLog } from "@/components/crm/activity-log";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

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
  const quoteNo = decodeURIComponent(no);
  const [detail, reload] = useLoad(() => quotation.getQuotation(quoteNo), [quoteNo]);

  return (
    <div>
      <Link href="/proyek/quotation" className="mb-3 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Semua quotation
      </Link>
      <Loaded state={detail} onRetry={reload}>
        {(d) => <Editor d={d} reload={reload} source={<SourceBadge state={detail} />} />}
      </Loaded>
    </div>
  );
}

const inputCls = "h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50";

function Editor({ d, reload, source }: { d: QuotationDetail; reload: () => void; source: React.ReactNode }) {
  const { can } = useSession();
  const { toast } = useToast();
  const q = d.quotation;
  const mayEdit = can("project.update");
  const draft = q.status === "DRAFT";
  const editable = mayEdit && draft;
  const seeCost = d.lines.some((l) => l.cost_visible) || (d.lines.length === 0 && mayEdit);
  const st = QUOTATION_STATUSES.find((s) => s.code === q.status)!;
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function run<T>(label: string, fn: () => Promise<{ error?: { status: number; message: string } | null; data?: T }>, done?: (data: T) => void) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", `${label} gagal`, res.error.message); return; }
    done?.(res.data as T);
    reload();
  }

  const send = () => {
    if (!window.confirm(`Kirim ${q.quote_no} ke klien? Setelah dikirim, harga dikunci — perubahan lewat revisi.`)) return;
    return run("Kirim", () => quotation.sendQuotation(q.quote_no),
      () => toast("success", "Quotation terkirim", `${q.quote_no} — harga dikunci. Cetak untuk dikirim ke klien.`));
  };
  const revise = () => run("Revisi", () => quotation.reviseQuotation(q.quote_no), (v: QuotationView) => {
    toast("success", "Revisi dibuat", `${v.quote_no} · Rev ${v.rev}`);
    window.location.assign(`/proyek/quotation/${encodeURIComponent(v.quote_no)}`);
  });
  const accept = () => {
    if (!window.confirm(`Klien menyetujui ${q.quote_no}? Semua item masuk ke pesanan proyek ${q.project_code} dengan harga ini.`)) return;
    return run("Persetujuan", () => quotation.decideQuotation(q.quote_no, true),
      (r: { order_lines_added: number }) => toast("success", "Disetujui — jadi pesanan",
        `${r.order_lines_added} item masuk ke pesanan ${q.project_code}. Proyek pindah ke Deal.`));
  };
  const reject = () => run("Penolakan", () => quotation.decideQuotation(q.quote_no, false, reason),
    () => { setRejecting(false); setReason(""); toast("info", "Dicatat ditolak", q.quote_no); });

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
            {q.expired && <Badge tone="red">Kedaluwarsa</Badge>}
            <Link href={`/proyek/quotation/${encodeURIComponent(q.quote_no)}/print`} target="_blank">
              <Button variant="outline" icon={Printer}>{draft ? "Pratinjau" : "Cetak"}</Button>
            </Link>
            {editable && <Button icon={Send} disabled={busy} onClick={send}>Kirim ke klien</Button>}
            {mayEdit && (q.status === "SENT" || q.status === "REJECTED") && q.is_current !== false && (
              <Button variant="outline" icon={CopyPlus} disabled={busy} onClick={revise}>Revisi</Button>
            )}
            {mayEdit && q.status === "SENT" && (
              <>
                <Button icon={ThumbsUp} disabled={busy} onClick={accept}>Disetujui</Button>
                <Button variant="outline" icon={ThumbsDown} disabled={busy} onClick={() => setRejecting((v) => !v)}>Ditolak</Button>
              </>
            )}
          </div>
        )}
      />

      {rejecting && (
        <Card className="mb-4 border-rose-200">
          <div className="flex flex-wrap items-end gap-2 px-4 py-3">
            <label className="block flex-1 text-xs text-slate-500">Kenapa ditolak?
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="harga, waktu, desain — pertanyaan ini akan datang lagi"
                className={cn(inputCls, "mt-1 h-9")} />
            </label>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={reject}>Catat ditolak</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Batal</Button>
          </div>
        </Card>
      )}

      {q.status === "REJECTED" && q.decision_reason && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-[13px] text-rose-800">
          Ditolak klien: “{q.decision_reason}”. Buat revisi untuk menawarkan ulang.
        </p>
      )}
      {q.status === "ACCEPTED" && (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800">
          Disetujui{q.decided_at ? ` ${q.decided_at.slice(0, 10)}` : ""} — itemnya sudah masuk ke{" "}
          <Link href="/proyek/order" className="font-medium underline">pesanan {q.project_code}</Link>.
          Dari sana tiap item bisa dibuatkan Job Order.
        </p>
      )}
      {q.status === "SUPERSEDED" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          Sudah diganti revisi yang lebih baru — lihat riwayat revisi di bawah.
        </p>
      )}

      <Terms q={q} editable={editable} seeCost={seeCost} onSaved={reload} />
      <Lines q={q} rows={d.lines} editable={editable} seeCost={seeCost} onChanged={reload} />
      <Totals q={q} seeCost={seeCost} />

      {/* What the client said about this quotation, and when to ask again —
          the nudge a sent quotation needs (0134). A project with no master
          client has nobody to log against, so it is not offered. */}
      {q.client_code && (
        <div className="mt-4">
          <ActivityLog
            title="Komunikasi dengan klien"
            filter={{ quote_no: q.quote_no }}
            fixed={{ client_code: q.client_code, project_code: q.project_code, quote_no: q.quote_no }}
          />
        </div>
      )}

      {d.revisions.length > 1 && (
        <Card className="mt-4">
          <div className="px-4 py-3 text-[13px]">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Riwayat revisi</p>
            <ul className="space-y-1">
              {d.revisions.map((r) => (
                <li key={r.quote_no} className="flex flex-wrap items-center gap-2">
                  <Link href={`/proyek/quotation/${encodeURIComponent(r.quote_no)}`}
                    className={cn("font-mono text-[12px] hover:underline", r.quote_no === q.quote_no ? "font-bold text-slate-900" : "text-brand-700")}>
                    {r.quote_no}
                  </Link>
                  <span className="text-slate-500">Rev {r.rev}</span>
                  <span className="text-slate-500">· {QUOTATION_STATUS_LABEL(r.status)}</span>
                  {r.sent_at && <span className="text-slate-400">· dikirim {r.sent_at.slice(0, 10)}</span>}
                  <span className="ml-auto tabular-nums text-slate-700">{r.grand_total == null ? "—" : formatIDR(r.grand_total)}</span>
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
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", "Ketentuan disimpan", "Harga semua baris dihitung ulang.");
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
          {pct("margin_pct", "Margin % (dari harga jual)")}
          <label className="block text-xs text-slate-500">Berlaku sampai
            <input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })}
              className={cn(inputCls, "mt-1 h-10")} />
          </label>
          <div className="text-xs text-slate-500">PPN
            <div className="mt-1 flex h-10 items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
                <input type="checkbox" checked={f.vat} onChange={(e) => setF({ ...f, vat: e.target.checked })} /> Kenakan
              </label>
              {f.vat && <NumberInput size="sm" value={f.vat_pct} min={0} max={99} step={1} onChange={(v) => setF({ ...f, vat_pct: v })} className="!w-16" />}
              {f.vat && <span>%</span>}
            </div>
          </div>
          <div className="text-[11px] text-slate-500 lg:col-span-1">
            Contoh ongkos 1.000.000 →{" "}
            <strong className="tabular-nums text-slate-800">
              {ok ? formatIDR(quotePrice(1_000_000, f.marketing_pct, f.overhead_pct, f.margin_pct) ?? 0) : "—"}
            </strong>
          </div>
          <label className="block text-xs text-slate-500 sm:col-span-3">Syarat &amp; ketentuan (tampil di cetakan)
            <textarea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} rows={3}
              placeholder="mis. DP 50%, pelunasan sebelum kirim. Harga belum termasuk instalasi."
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]" />
          </label>
          <label className="block text-xs text-slate-500 sm:col-span-3">Catatan untuk klien
            <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Batal</Button>
          <Button size="sm" icon={Save} disabled={busy || !ok} onClick={save}>Simpan</Button>
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
            ["Margin", `${formatNumber(q.margin_pct)}% dari harga jual`],
          ] : []),
          ["PPN", q.vat ? `${formatNumber(q.vat_pct)}%` : "tidak dikenakan"],
          ["Berlaku sampai", q.valid_until ?? "—"],
          ["Estimasi produksi", q.max_lead_time_days == null ? "—" : `${q.max_lead_time_days} hari kerja`],
          ["Dikirim", q.sent_at ? q.sent_at.slice(0, 10) : "belum"],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k}>
            <span className="block text-[11px] uppercase tracking-wide text-slate-400">{k}</span>
            <span className="text-slate-800">{v}</span>
          </div>
        ))}
        {editable && (
          <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto" onClick={() => { setF(termsOf(q)); setEditing(true); }}>
            Ubah
          </Button>
        )}
        {(q.terms || q.note) && (
          <div className="w-full space-y-1 text-[12px] text-slate-600">
            {q.terms && <p className="whitespace-pre-line"><span className="text-slate-400">Syarat: </span>{q.terms}</p>}
            {q.note && <p className="whitespace-pre-line"><span className="text-slate-400">Catatan: </span>{q.note}</p>}
          </div>
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
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

const draftOf = (l: QuotationLineView | null): LineDraft => ({
  product_code: l?.product_code ?? "", description: l?.description ?? "", qty: l?.qty ?? 1, uom: l?.uom ?? "unit",
  lead: str(l?.line_lead_time_days), manual_cost: str(l?.manual_unit_cost),
  mkt: str(l?.line_marketing_pct), ovh: str(l?.line_overhead_pct), mrg: str(l?.line_margin_pct),
  price: str(l?.unit_price_override), note: l?.note ?? "",
});

function Lines({
  q, rows, editable, seeCost, onChanged,
}: {
  q: QuotationView; rows: QuotationLineView[]; editable: boolean; seeCost: boolean; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [products] = useLoad(() => production.listProducts({}), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [d, setD] = useState<LineDraft>(draftOf(null));
  const [busy, setBusy] = useState(false);
  const known = products.status === "ready" ? products.data : [];

  async function save(id: string | null) {
    setBusy(true);
    const res = await quotation.saveQuotationLine(q.quote_no, {
      id, product_code: d.product_code || null, description: d.description || null, qty: d.qty, uom: d.uom,
      lead_time_days: num(d.lead), manual_unit_cost: num(d.manual_cost),
      marketing_pct: num(d.mkt), overhead_pct: num(d.ovh), margin_pct: num(d.mrg),
      unit_price_override: num(d.price), note: d.note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", id ? "Baris diperbarui" : "Item ditambahkan",
      `${res.data.description} · ${res.data.unit_price == null ? "belum berharga" : formatIDR(res.data.unit_price)}`);
    setEditing(null);
    onChanged();
  }

  async function remove(l: QuotationLineView) {
    if (!window.confirm(`Hapus “${l.description}” dari quotation?`)) return;
    setBusy(true);
    const res = await quotation.removeQuotationLine(q.quote_no, l.id);
    setBusy(false);
    if (res.error) { toast("warning", "Tidak dihapus", res.error.message); return; }
    onChanged();
  }

  /* What the row being edited would come to, before it is saved — the same
     function the database runs. */
  const picked = known.find((p) => p.product_code === d.product_code.trim().toUpperCase());
  /* The released cost is only known for a saved line (the catalogue's own
     figure may be the open draft's); a new line shows its price on save. */
  const saved = editing && editing !== "new" ? rows.find((l) => l.id === editing) : undefined;
  const liveCost = num(d.manual_cost)
    ?? (saved && !saved.cost_is_manual && saved.product_code === d.product_code.trim().toUpperCase() ? saved.unit_cost : null);
  const preview = num(d.price) ?? quotePrice(liveCost,
    num(d.mkt) ?? q.marketing_pct, num(d.ovh) ?? q.overhead_pct, num(d.mrg) ?? q.margin_pct);

  const pctCell = (key: "mkt" | "ovh" | "mrg", inherit: number, label: string) => (
    <input value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} inputMode="decimal"
      placeholder={formatNumber(inherit)} aria-label={label} title={`${label} — kosong: ikut quotation (${formatNumber(inherit)}%)`}
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
          list="qt-products" placeholder="item code (dari katalog)" aria-label="Item code"
          className={cn(inputCls, "font-mono text-[12px]")} autoFocus />
        <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
          placeholder={picked ? picked.name : "nama item untuk klien"} aria-label="Deskripsi" className={cn(inputCls, "mt-1")} />
        <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })}
          placeholder="keterangan (opsional) — ukuran, finishing" aria-label="Keterangan" className={cn(inputCls, "mt-1 h-7 text-[12px]")} />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <NumberInput size="sm" value={d.qty} min={0} max={999_999} step={1} onChange={(v) => setD({ ...d, qty: v })} className="!w-16" />
          <select value={d.uom} onChange={(e) => setD({ ...d, uom: e.target.value })} aria-label="Satuan"
            className="h-8 rounded-lg border border-slate-200 bg-white px-1 text-[12px]">
            <UomOptions current={d.uom} />
          </select>
        </div>
      </td>
      <td className="px-3 py-2">
        <input value={d.lead} onChange={(e) => setD({ ...d, lead: e.target.value })} inputMode="numeric"
          placeholder={picked?.lead_time_days != null ? String(picked.lead_time_days) : "hari"} aria-label="Estimasi produksi (hari)"
          className={cn(inputCls, "w-16 text-right")} />
      </td>
      {seeCost && (
        <td className="px-3 py-2 text-right">
          <input value={d.manual_cost} onChange={(e) => setD({ ...d, manual_cost: e.target.value })} inputMode="numeric"
            placeholder={saved?.unit_cost != null && !saved.cost_is_manual ? formatNumber(saved.unit_cost) : "dari BOM"}
            aria-label="Ongkos manual per unit" title="Kosong: dari BOM yang dirilis"
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
          placeholder={preview == null ? "harga jual" : formatNumber(preview)} aria-label="Harga jual per unit (tetapkan)"
          title="Kosong: dihitung dari rumus" className={cn(inputCls, "w-28 text-right")} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
        {preview == null ? "—" : formatIDR(preview * d.qty)}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        <button onClick={() => save(id)} disabled={busy || (!d.description.trim() && !d.product_code.trim()) || d.qty <= 0}
          aria-label="Simpan" className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => setEditing(null)} aria-label="Batal" className="rounded p-1 text-slate-400 hover:bg-slate-100">
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
        <p className="text-[13px] font-semibold text-slate-800">Item ditawarkan</p>
        <span className="text-[12px] text-slate-400">
          {rows.length} baris
          {q.lines_without_cost > 0 && draftCount(q)}
        </span>
        {editable && editing === null && (
          <Button size="sm" icon={Plus} className="ml-auto" onClick={() => { setD(draftOf(null)); setEditing("new"); }}>
            Tambah item
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Jumlah</th>
              <th className="px-3 py-2 text-right">Produksi</th>
              {seeCost && <th className="px-3 py-2 text-right">Ongkos / unit</th>}
              {seeCost && <th className="px-3 py-2 text-right">Mkt · Ovh · Margin %</th>}
              <th className="px-3 py-2 text-right">Harga jual / unit</th>
              <th className="px-3 py-2 text-right">Jumlah harga</th>
              {editable && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => editing === l.id ? <Frag key={l.id}>{editRow(l.id)}</Frag> : (
              <tr key={l.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-3 py-2">
                  <span className="block text-slate-800">{l.line_no}. {l.description}</span>
                  {l.product_code && (
                    <Link href={`/produksi/bom?open=${encodeURIComponent(l.product_code)}`}
                      className="font-mono text-[11px] text-brand-700 hover:underline">
                      {l.product_code}{l.bom_rev != null && ` · BOM rev ${l.bom_rev}`}
                    </Link>
                  )}
                  {l.product_code && !l.product_exists && <span className="block text-[11px] text-amber-700">tidak ada di katalog</span>}
                  {l.note && <span className="block text-[11px] text-slate-500">{l.note}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(l.qty)} {l.uom}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                  {l.lead_time_days == null ? <span className="text-slate-300">—</span> : `${l.lead_time_days} hr`}
                </td>
                {seeCost && (
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {l.unit_cost == null ? (
                      <span className="text-[12px] text-amber-700">
                        {l.product_code && l.product_exists ? "BOM belum dirilis / belum lengkap" : "isi ongkos manual"}
                      </span>
                    ) : (
                      <>
                        <span className="text-slate-700">{formatIDR(l.unit_cost)}</span>
                        <span className="block text-[11px] text-slate-400">{l.cost_source === "manual" ? "manual" : "dari BOM"}</span>
                      </>
                    )}
                  </td>
                )}
                {seeCost && (
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", l.pct_overridden ? "text-brand-700" : "text-slate-500")}>
                    {[l.marketing_pct, l.overhead_pct, l.margin_pct].map((v) => formatNumber(v ?? 0)).join(" · ")}
                    {l.pct_overridden && <span className="block text-[11px]">khusus baris ini</span>}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-800">
                  {l.unit_price == null ? <span className="text-slate-300">—</span> : formatIDR(l.unit_price)}
                  {l.unit_price_override != null && seeCost && (
                    <span className="block text-[11px] text-slate-400">
                      ditetapkan{l.computed_unit_price != null && ` · rumus ${formatIDR(l.computed_unit_price)}`}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-slate-800">
                  {l.unit_price == null ? <span className="text-slate-300">—</span> : formatIDR(l.unit_price * l.qty)}
                </td>
                {editable && (
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button onClick={() => { setD(draftOf(l)); setEditing(l.id); }} disabled={busy || editing !== null} aria-label="Ubah"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(l)} disabled={busy} aria-label="Hapus"
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                )}
              </tr>
            ))}
            {editing === "new" && editRow(null)}
            {rows.length === 0 && editing !== "new" && (
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-slate-500">
                Belum ada item. Pilih item code dari katalog — ongkos produksinya terbaca dari BOM yang sudah dirilis.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && editing !== null && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          Kosongkan ongkos untuk memakai BOM yang dirilis; kosongkan persentase untuk ikut quotation; isi harga jual
          hanya bila ingin menetapkan harga di luar rumus.
        </p>
      )}
    </Card>
  );
}

const draftCount = (q: QuotationView) =>
  q.status === "DRAFT" ? <span className="text-amber-700"> · {q.lines_without_cost} belum punya ongkos</span> : null;

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ── the bottom line ─────────────────────────────────────────────────────── */

function Totals({ q, seeCost }: { q: QuotationView; seeCost: boolean }) {
  const gross = q.subtotal != null && q.cost_total != null ? q.subtotal - q.cost_total : null;
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-6 px-4 py-3 text-[13px]">
        {seeCost ? (
          <div className="space-y-1 text-slate-600">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Internal — tidak tercetak</p>
            <p>Total ongkos produksi <strong className="tabular-nums text-slate-800">{q.cost_total == null ? "—" : formatIDR(q.cost_total)}</strong></p>
            <p>
              Selisih harga jual − ongkos{" "}
              <strong className="tabular-nums text-slate-800">{gross == null ? "—" : formatIDR(gross)}</strong>
              {gross != null && q.subtotal ? <span className="text-slate-500"> ({formatNumber(Math.round((gross / q.subtotal) * 1000) / 10)}% dari harga jual — menutup marketing, overhead, dan margin)</span> : null}
            </p>
          </div>
        ) : <span />}
        <table className="text-[13px]">
          <tbody>
            <tr><td className="pr-6 text-slate-500">Subtotal</td><td className="text-right tabular-nums">{q.subtotal == null ? "—" : formatIDR(q.subtotal)}</td></tr>
            {q.vat && (
              <tr><td className="pr-6 text-slate-500">PPN {formatNumber(q.vat_pct)}%</td><td className="text-right tabular-nums">{q.vat_amount == null ? "—" : formatIDR(q.vat_amount)}</td></tr>
            )}
            <tr className="border-t border-slate-200">
              <td className="pr-6 pt-1 font-semibold text-slate-800">Total</td>
              <td className="pt-1 text-right text-base font-bold tabular-nums text-slate-900">{q.grand_total == null ? "—" : formatIDR(q.grand_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
