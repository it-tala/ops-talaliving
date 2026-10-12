"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, ChevronRight, FileText, Flag, Send, Undo2, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { documents, qc } from "@/demo/api";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import type { AttachmentView } from "@/services/documents/contracts";
import {
  QC_FINDING_KIND_LABEL, QC_FINDING_PHASE_LABEL, QC_SEVERITY_LABEL, QC_STAGE_LABEL, QC_STAGES,
  type QcAssignment, type QcAssignmentLine, type QcFinding, type QcFindingKind, type QcFindingPhase,
  type QcLineProgress, type QcReport, type QcSeverity, type QcStage,
} from "@/services/qc/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Field QC from the factory (0263, O7, kajian §5.7, D419).
 *
 *  What a QC does on an assignment from their phone: count how many pieces
 *  have passed so far, photograph them, say what is wrong. The latest report
 *  is the factory's progress — on this screen and on the project board — and
 *  open findings are what the coordinator and logistics see before loading. */

const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
const SEVERITY_TONE: Record<QcSeverity, "slate" | "amber" | "red"> = { minor: "slate", major: "amber", critical: "red" };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID() : `qc-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/* ── lines and progress ─────────────────────────────────────────────────── */

/** The order's lines with their working drawing and how far QC says each is. */
export function ProgressLines({ lines, progress }: { lines: QcAssignmentLine[]; progress: QcLineProgress[] }) {
  const tr = useTr();
  if (lines.length === 0) return <p className="text-[12px] text-slate-500">{tr("No lines to show.", "Tidak ada baris.")}</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {lines.map((l) => {
        const g = progress.find((p) => p.line_no === l.line_no);
        const pct = g?.passed != null && l.qty > 0 ? Math.min(100, Math.round((g.passed / l.qty) * 100)) : 0;
        return (
          <li key={l.line_no} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-[180px] flex-1">
                <span className="block text-slate-800">{l.line_no}. {l.description}</span>
                <span className="block text-[11px] text-slate-400">
                  {[l.design_item_no, l.product_code, l.project_line_no != null && tr(`order line ${l.project_line_no}`, `baris order ${l.project_line_no}`)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="tabular-nums text-slate-700">{formatNumber(l.qty)} {l.uom}</span>
              {l.drawing_filename ? (
                l.drawing_url
                  ? <a href={l.drawing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:underline"><FileText className="h-3.5 w-3.5" />{l.drawing_filename}</a>
                  : <span className="inline-flex items-center gap-1 text-[12px] text-slate-600"><FileText className="h-3.5 w-3.5" />{l.drawing_filename}</span>
              ) : <span className="text-[11px] text-amber-700">{tr("no working drawing yet", "gambar kerja belum ada")}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-brand-500")} style={{ width: `${pct}%` }} />
              </span>
              {g?.passed != null ? (
                <span className="text-slate-700">
                  {tr(`passed ${formatNumber(g.passed)} of ${formatNumber(l.qty)}`, `lolos ${formatNumber(g.passed)} dari ${formatNumber(l.qty)}`)}
                  {g.qc_stage && ` · ${QC_STAGE_LABEL[g.qc_stage]}`}{g.reported_on && ` · ${g.reported_on}`}
                </span>
              ) : <span className="text-slate-400">{tr("not counted yet", "belum dihitung")}</span>}
              {(g?.rejected_total ?? 0) > 0 && <span className="text-rose-700">{tr(`${formatNumber(g!.rejected_total)} rejected so far`, `${formatNumber(g!.rejected_total)} ditolak sejauh ini`)}</span>}
              {(g?.open_findings ?? 0) > 0 && <Badge tone="amber">{tr(`${g!.open_findings} open finding(s)`, `${g!.open_findings} temuan terbuka`)}</Badge>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── photos ─────────────────────────────────────────────────────────────── */

/** Photos taken now, uploaded against the assignment so they land in
 *  `{CLIENT}/{PROJECT}/QC/{day}` (D313), and handed back as ids to link. */
function PhotoPicker({ assignNo, photos, onChange }: {
  assignNo: string; photos: { id: string; name: string }[]; onChange: (p: { id: string; name: string }[]) => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const got: { id: string; name: string }[] = [];
    setBusy(files.length);
    for (const file of Array.from(files)) {
      const up = await documents.upload({ file, kind: "Foto QC", entity: "qc_assignment", entity_no: assignNo });
      setBusy((n) => n - 1);
      if (up.error) { toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); continue; }
      got.push({ id: up.data.id, name: file.name });
    }
    if (ref.current) ref.current.value = "";
    onChange([...photos, ...got]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple className="hidden"
        aria-label={tr("Photos", "Foto")} onChange={(e) => pick(e.target.files)} />
      <button type="button" disabled={busy > 0} onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-[12px] text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
        <Camera className="h-3.5 w-3.5" />{busy > 0 ? tr(`Uploading ${busy}…`, `Mengunggah ${busy}…`) : tr("Add photos", "Tambah foto")}
      </button>
      {photos.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
          {p.name}
          <button type="button" aria-label={tr(`Remove ${p.name}`, `Lepas ${p.name}`)} onClick={() => onChange(photos.filter((x) => x.id !== p.id))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** The photos linked to a report or finding, as links to open. */
function PhotoLinks({ entity, no }: { entity: "qc_report" | "qc_finding"; no: string }) {
  const tr = useTr();
  const [state] = useLoad(() => documents.byEntity(entity, no), [entity, no]);
  if (state.status !== "ready") return null;
  const rows: AttachmentView[] = state.data;
  if (rows.length === 0) return <span className="text-[11px] text-slate-400">{tr("no photos", "tanpa foto")}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {rows.map((a) => {
        const href = a.web_view_link ?? a.url;
        return href
          ? <a key={a.id} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline"><Camera className="h-3 w-3" />{a.filename}</a>
          : <span key={a.id} className="inline-flex items-center gap-1 text-[11px] text-slate-600"><Camera className="h-3 w-3" />{a.filename}</span>;
      })}
    </span>
  );
}

/* ── the report ─────────────────────────────────────────────────────────── */

/** One visit's report, from the phone. Passed is how many have passed **so
 *  far** — prefilled with the last count — not today's increment (D419). */
export function ReportForm({ a, lines, progress, onDone, onCancel }: {
  a: QcAssignment; lines: QcAssignmentLine[]; progress: QcLineProgress[]; onDone: () => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(newKey());
  const [day, setDay] = useState(officeToday());
  const [stage, setStage] = useState<QcStage>(() => progress.find((p) => p.qc_stage)?.qc_stage ?? "material");
  const [counts, setCounts] = useState<Record<number, { passed: number; rejected: number; on: boolean }>>(() =>
    Object.fromEntries(lines.map((l) => [l.line_no, { passed: progress.find((p) => p.line_no === l.line_no)?.passed ?? 0, rejected: 0, on: false }])));
  const [note, setNote] = useState("");
  const [deliveryNo, setDeliveryNo] = useState("");
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [containers] = useLoad(() => (stage === "loading" ? qc.listOrderContainers(a.assign_no) : Promise.resolve({ data: [] })), [stage, a.assign_no]);

  function set(lineNo: number, patch: Partial<{ passed: number; rejected: number }>) {
    setCounts((c) => ({ ...c, [lineNo]: { ...c[lineNo], ...patch, on: true } }));
  }

  async function send() {
    setBusy(true);
    const res = await qc.submitQcReport({
      assign_no: a.assign_no, report_date: day, stage, note: note.trim() || null,
      delivery_no: stage === "loading" ? deliveryNo || null : null,
      lines: Object.entries(counts).filter(([, v]) => v.on).map(([k, v]) => ({ line_no: Number(k), passed: v.passed, rejected: v.rejected })),
      photo_ids: photos.map((p) => p.id),
    }, key.current);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    toast(res.data.warnings.length ? "warning" : "success", tr(`Report sent · ${res.data.report_no}`, `Laporan terkirim · ${res.data.report_no}`),
      res.data.warnings.join(" "));
    onDone();
  }

  return (
    <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/30 p-3 text-[13px]">
      <p className="mb-2 font-medium text-slate-800">{tr("Today's report", "Laporan hari ini")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("Day", "Tanggal")}
          <input type="date" value={day} max={officeToday()} onChange={(e) => setDay(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500">{tr("Stage", "Tahap")}
          <select value={stage} onChange={(e) => setStage(e.target.value as QcStage)} className={cn(inputCls, "mt-1")}>
            {QC_STAGES.map((s) => <option key={s} value={s}>{QC_STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        {stage === "loading" && (
          <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Container checked", "Kontainer yang dicek")}
            <select value={deliveryNo} onChange={(e) => setDeliveryNo(e.target.value)} className={cn(inputCls, "mt-1")}>
              <option value="">{tr("— not recorded by logistics yet —", "— belum dicatat logistik —")}</option>
              {containers.status === "ready" && (containers.data ?? []).map((c) => (
                <option key={c.delivery_no} value={c.delivery_no}>{c.container_no ?? c.delivery_no}{c.container_size ? ` · ${c.container_size}` : ""} · {c.loaded_on}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        {tr("Passed = how many have passed so far, not just today. Rejected = rejected on this visit. Leave a line untouched to leave it out.",
          "Lolos = jumlah yang sudah lolos sampai hari ini, bukan hanya hari ini. Ditolak = yang ditolak pada kunjungan ini. Baris yang tidak diubah tidak ikut dilaporkan.")}
      </p>
      <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {lines.map((l) => {
          const c = counts[l.line_no];
          return (
            <li key={l.line_no} className={cn("grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2", c?.on && "bg-brand-50/40")}>
              <span className="min-w-0 text-[12px] text-slate-700">
                <span className="block truncate">{l.line_no}. {l.description}</span>
                <span className="text-[11px] text-slate-400">{tr("ordered", "dipesan")} {formatNumber(l.qty)} {l.uom}</span>
              </span>
              <label className="w-20 text-[11px] text-slate-500">{tr("Passed", "Lolos")}
                <NumberInput size="sm" value={c?.passed ?? 0} min={0} max={l.qty} onChange={(v) => set(l.line_no, { passed: v })} />
              </label>
              <label className="w-20 text-[11px] text-slate-500">{tr("Rejected", "Ditolak")}
                <NumberInput size="sm" value={c?.rejected ?? 0} min={0} onChange={(v) => set(l.line_no, { rejected: v })} />
              </label>
            </li>
          );
        })}
      </ul>

      <label className="mt-2 block text-xs text-slate-500">{tr("Note", "Catatan")}
        <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")}
          placeholder={tr("what you saw, what the factory said", "yang dilihat, kata pabrik")} />
      </label>
      <div className="mt-2"><PhotoPicker assignNo={a.assign_no} photos={photos} onChange={setPhotos} /></div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button icon={Send} onClick={send} disabled={busy}>{tr("Send report", "Kirim laporan")}</Button>
      </div>
    </div>
  );
}

/** The reports on an assignment, newest first, each opening to its lines and
 *  photos; the QC who sent one (or the coordinator) can add photos or
 *  withdraw it with a reason. */
export function ReportList({ a, mayWrite, onChanged }: { a: QcAssignment; mayWrite: boolean; onChanged: () => void }) {
  const tr = useTr();
  const [state, reload] = useLoad(() => qc.listQcReports({ assign_no: a.assign_no, include_cancelled: true }), [a.assign_no, a.report_count]);
  return (
    <Loaded state={state} onRetry={reload} skeletonRows={1}>
      {(rows) => rows.length === 0 ? (
        <p className="text-[12px] text-slate-500">{tr("No reports yet.", "Belum ada laporan.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.map((r) => <ReportRow key={r.id} r={r} mayWrite={mayWrite} onChanged={() => { reload(); onChanged(); }} />)}
        </ul>
      )}
    </Loaded>
  );
}

function ReportRow({ r, mayWrite, onChanged }: { r: QcReport; mayWrite: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lines] = useLoad(() => (open ? qc.listReportLines(r.report_no) : Promise.resolve({ data: [] })), [open, r.report_no]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoTick, setPhotoTick] = useState(0);
  const live = !r.cancelled_at;

  async function withdraw() {
    setBusy(true);
    const res = await qc.cancelQcReport({ report_no: r.report_no, reason: reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not withdrawn", "Tidak ditarik"), res.error.message); return; }
    toast("success", tr("Report withdrawn", "Laporan ditarik"), r.report_no);
    setWithdrawing(false); onChanged();
  }
  useEffect(() => {
    if (adding.length === 0) return;
    (async () => {
      const res = await qc.addQcReportPhotos({ report_no: r.report_no, photo_ids: adding.map((p) => p.id) });
      if (res.error) toast("warning", tr("Photos not added", "Foto tidak ditambahkan"), res.error.message);
      else { toast("success", tr("Photos added", "Foto ditambahkan"), r.report_no); setPhotoTick((n) => n + 1); onChanged(); }
      setAdding([]);
    })();
  }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <li className={cn("px-3 py-2 text-[12px]", !live && "bg-slate-50/60 text-slate-500")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <span className="font-medium text-slate-800">{r.report_date}</span>
        <Badge tone={r.stage === "loading" ? "violet" : "brand"}>{QC_STAGE_LABEL[r.stage]}</Badge>
        {!live && <Badge tone="red">{tr("Withdrawn", "Ditarik")}</Badge>}
        {r.container_no && <span className="font-mono text-[11px] text-slate-600">{r.container_no}</span>}
        <span className="text-slate-600">
          {r.line_count > 0 && tr(`passed ${formatNumber(r.passed_total)}`, `lolos ${formatNumber(r.passed_total)}`)}
          {r.rejected_total > 0 && ` · ${tr(`rejected ${formatNumber(r.rejected_total)}`, `ditolak ${formatNumber(r.rejected_total)}`)}`}
        </span>
        <span className="inline-flex items-center gap-0.5 text-slate-500"><Camera className="h-3 w-3" />{r.photo_count}</span>
        <span className="ml-auto text-[11px] text-slate-400">{r.person_name} · {r.report_no}</span>
      </button>
      {r.note && <p className="mt-0.5 pl-5 text-slate-600">{r.note}</p>}
      {r.cancel_reason && <p className="mt-0.5 pl-5 text-rose-700">{tr("Withdrawn", "Ditarik")}: {r.cancel_reason}</p>}
      {open && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          {lines.status === "ready" && (lines.data ?? []).length > 0 && (
            <ul className="space-y-0.5">
              {(lines.data ?? []).map((l) => (
                <li key={l.line_no} className="text-slate-700">
                  {l.line_no}. {l.description ?? "—"} — {tr(`passed ${formatNumber(l.passed)}`, `lolos ${formatNumber(l.passed)}`)}
                  {l.qty != null && ` / ${formatNumber(l.qty)} ${l.uom ?? ""}`}
                  {l.rejected > 0 && <span className="text-rose-700"> · {tr(`rejected ${formatNumber(l.rejected)}`, `ditolak ${formatNumber(l.rejected)}`)}</span>}
                </li>
              ))}
            </ul>
          )}
          <PhotoLinks key={photoTick} entity="qc_report" no={r.report_no} />
          {mayWrite && live && (
            <div className="flex flex-wrap items-center gap-2">
              <PhotoPicker assignNo={r.assign_no} photos={[]} onChange={setAdding} />
              {withdrawing ? (
                <>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={tr("why — wrong count, wrong day", "kenapa — salah hitung, salah hari")}
                    className="h-8 min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2 text-[12px]" />
                  <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={withdraw}>{tr("Withdraw", "Tarik")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>{tr("Back", "Kembali")}</Button>
                </>
              ) : (
                <button type="button" onClick={() => setWithdrawing(true)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-700">
                  <Undo2 className="h-3 w-3" />{tr("Withdraw this report", "Tarik laporan ini")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ── findings ───────────────────────────────────────────────────────────── */

const KINDS: QcFindingKind[] = ["defect", "spec_mismatch", "late", "damaged", "packing", "other"];
const SEVERITIES: QcSeverity[] = ["minor", "major", "critical"];

/** A finding at the factory or at loading — what, how bad, which line,
 *  photos. A client's claim after arrival is O8's. */
export function FindingForm({ a, lines, onDone, onCancel }: {
  a: QcAssignment; lines: QcAssignmentLine[]; onDone: () => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(newKey());
  const [phase, setPhase] = useState<QcFindingPhase>("production");
  const [kind, setKind] = useState<QcFindingKind>("defect");
  const [severity, setSeverity] = useState<QcSeverity>("minor");
  const [lineNo, setLineNo] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryNo, setDeliveryNo] = useState("");
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [containers] = useLoad(() => (phase === "loading" ? qc.listOrderContainers(a.assign_no) : Promise.resolve({ data: [] })), [phase, a.assign_no]);

  async function save() {
    if (!a.po_no) return;
    setBusy(true);
    const res = await qc.raiseQcFinding({
      po_no: a.po_no, phase, kind, severity, description: description.trim(),
      line_no: lineNo ? Number(lineNo) : null, delivery_no: phase === "loading" ? deliveryNo || null : null,
      photo_ids: photos.map((p) => p.id),
    }, key.current);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", tr(`Finding recorded · ${res.data.finding_no}`, `Temuan tercatat · ${res.data.finding_no}`), description.trim());
    onDone();
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-[13px]">
      <p className="mb-2 font-medium text-slate-800">{tr("Record a finding", "Catat temuan")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("When", "Fase")}
          <select value={phase} onChange={(e) => setPhase(e.target.value as QcFindingPhase)} className={cn(inputCls, "mt-1")}>
            {(["production", "loading"] as const).map((p) => <option key={p} value={p}>{QC_FINDING_PHASE_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">{tr("What", "Jenis")}
          <select value={kind} onChange={(e) => setKind(e.target.value as QcFindingKind)} className={cn(inputCls, "mt-1")}>
            {KINDS.map((k) => <option key={k} value={k}>{QC_FINDING_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">{tr("How bad", "Tingkat")}
          <select value={severity} onChange={(e) => setSeverity(e.target.value as QcSeverity)} className={cn(inputCls, "mt-1")}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{QC_SEVERITY_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">{tr("Line (optional)", "Baris (opsional)")}
          <select value={lineNo} onChange={(e) => setLineNo(e.target.value)} className={cn(inputCls, "mt-1")}>
            <option value="">{tr("— the whole order —", "— seluruh order —")}</option>
            {lines.map((l) => <option key={l.line_no} value={l.line_no}>{l.line_no}. {l.description}</option>)}
          </select>
        </label>
        {phase === "loading" && (
          <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Container", "Kontainer")}
            <select value={deliveryNo} onChange={(e) => setDeliveryNo(e.target.value)} className={cn(inputCls, "mt-1")}>
              <option value="">{tr("— none —", "— tidak ada —")}</option>
              {containers.status === "ready" && (containers.data ?? []).map((c) => (
                <option key={c.delivery_no} value={c.delivery_no}>{c.container_no ?? c.delivery_no} · {c.loaded_on}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs text-slate-500 sm:col-span-2">{tr("What is wrong", "Apa temuannya")}
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={cn(inputCls, "mt-1")}
            placeholder={tr("e.g. crack in the sofa leg, 3 pieces", "mis. retak di kaki sofa, 3 unit")} />
        </label>
      </div>
      <div className="mt-2"><PhotoPicker assignNo={a.assign_no} photos={photos} onChange={setPhotos} /></div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button icon={Flag} onClick={save} disabled={busy || !description.trim()}>{tr("Record finding", "Catat temuan")}</Button>
      </div>
    </div>
  );
}

/** The findings on an order — open first — each closed with what was done. */
export function FindingList({ poNo, mayResolve, refresh, onChanged }: {
  poNo: string; mayResolve: boolean; refresh: number; onChanged: () => void;
}) {
  const tr = useTr();
  const [state, reload] = useLoad(() => qc.listQcFindings({ po_no: poNo }), [poNo, refresh]);
  return (
    <Loaded state={state} onRetry={reload} skeletonRows={1}>
      {(rows) => rows.length === 0 ? (
        <p className="text-[12px] text-slate-500">{tr("No findings on this order.", "Belum ada temuan di order ini.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.map((f) => <FindingRow key={f.id} f={f} mayResolve={mayResolve} onChanged={() => { reload(); onChanged(); }} />)}
        </ul>
      )}
    </Loaded>
  );
}

function FindingRow({ f, mayResolve, onChanged }: { f: QcFinding; mayResolve: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const open = f.status === "OPEN";

  async function resolve() {
    setBusy(true);
    const res = await qc.resolveQcFinding({ finding_no: f.finding_no, resolution: resolution.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not closed", "Tidak ditutup"), res.error.message); return; }
    toast("success", tr("Finding resolved", "Temuan selesai"), f.finding_no);
    setResolving(false); onChanged();
  }

  return (
    <li className={cn("px-3 py-2 text-[12px]", !open && "bg-slate-50/60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {open ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
        <Badge tone={SEVERITY_TONE[f.severity]}>{QC_SEVERITY_LABEL[f.severity]}</Badge>
        <span className="font-medium text-slate-800">{QC_FINDING_KIND_LABEL[f.finding_kind]}</span>
        <span className="text-slate-500">{QC_FINDING_PHASE_LABEL[f.phase]}</span>
        {f.line_no != null && <span className="text-slate-600">{tr("line", "baris")} {f.line_no}{f.line_description && ` · ${f.line_description}`}</span>}
        {f.container_no && <span className="font-mono text-[11px] text-slate-600">{f.container_no}</span>}
        <span className="ml-auto text-[11px] text-slate-400">{f.raised_by_name ?? "—"} · {f.created_at.slice(0, 10)} · {f.finding_no}</span>
      </div>
      <p className="mt-0.5 pl-5 text-slate-700">{f.description}</p>
      {f.resolution && <p className="mt-0.5 pl-5 text-emerald-700">{tr("Done", "Tindakan")}: {f.resolution}{f.resolved_by_name && ` — ${f.resolved_by_name}`}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-5">
        {f.photo_count > 0 && <PhotoLinks entity="qc_finding" no={f.finding_no} />}
        {mayResolve && open && (resolving ? (
          <>
            <input value={resolution} onChange={(e) => setResolution(e.target.value)} autoFocus
              placeholder={tr("what was done — reworked, replaced", "tindakannya — diperbaiki, diganti")}
              className="h-8 min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2 text-[12px]" />
            <Button size="sm" disabled={busy || !resolution.trim()} onClick={resolve}>{tr("Resolve", "Selesai")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setResolving(false)}>{tr("Back", "Kembali")}</Button>
          </>
        ) : (
          <button type="button" onClick={() => setResolving(true)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />{tr("Mark resolved", "Tandai selesai")}
          </button>
        ))}
      </div>
    </li>
  );
}

/** How long since the assignment last reported — said, never blocked. */
export function ReportingBadge({ a }: { a: QcAssignment }) {
  const tr = useTr();
  const d = a.days_without_report;
  if (d == null || d < 1) return null;
  return d === 1
    ? <Badge tone="amber">{tr("no report today yet", "belum lapor hari ini")}</Badge>
    : <Badge tone="red">{tr(`${d} days without a report`, `${d} hari tanpa laporan`)}</Badge>;
}

export const useProgress = (assignNo: string, open: boolean, tick: number) =>
  useLoad(() => (open ? qc.listAssignmentProgress(assignNo) : Promise.resolve({ data: [] })), [open, assignNo, tick]);
