"use client";

import { useRef, useState } from "react";
import { AlertTriangle, BellRing, Camera, CheckCircle2, Factory, Flag, History, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { documents, procurement, qc } from "@/demo/api";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import {
  FACTORY_WORK_STATE_LABEL, type ClientVerdict, type FactoryOrderOutcome, type FactoryWorkState,
} from "@/services/procurement/contracts";
import {
  QC_FINDING_KIND_LABEL, QC_SEVERITY_LABEL, type QcFindingKind, type QcSeverity,
} from "@/services/qc/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** What became of each factory order after it arrived (0265, O8, kajian §5.8,
 *  D412, D422).
 *
 *  The state is read — in production, shipped, arrived — and then a person
 *  says what the client said: accepted, or rejected and why. The day the last
 *  container arrived + 3 months is a reminder, not a money clock: past it with
 *  nothing chosen, the order is *perlu dikonfirmasi*. The client's claims are
 *  QC findings after arrival, beside the findings before shipping, so the
 *  evaluation (O9) reads the two together. */

const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
const STATE_TONE: Record<FactoryWorkState, "slate" | "brand" | "violet" | "amber" | "green" | "red"> = {
  ORDER_DRAFT: "slate", IN_PRODUCTION: "violet", SHIPPED: "brand", ARRIVED: "amber", ACCEPTED: "green", REJECTED: "red",
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID() : `fo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The factory orders past their reminder with no decision, across projects. */
export function NeedsConfirmation({ onPick }: { onPick: (projectCode: string) => void }) {
  const tr = useTr();
  const [state] = useLoad(() => procurement.listFactoryOutcomes(), []);
  if (state.status !== "ready") return null;
  const due = state.data.filter((o) => o.needs_confirmation);
  if (due.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[13px]">
      <p className="flex items-center gap-1.5 font-medium text-amber-800">
        <BellRing className="h-4 w-4" />
        {tr(`${due.length} factory order(s) to confirm with the client`, `${due.length} order pabrik perlu dikonfirmasi ke klien`)}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-700">
        {tr("Three months since the last container arrived, and nobody has said whether the client accepted the work.",
          "Sudah tiga bulan sejak kontainer terakhir sampai, dan belum ada yang mencatat apakah klien menerima hasilnya.")}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {due.map((o) => (
          <li key={o.po_no}>
            <button type="button" onClick={() => onPick(o.project_code)} className="text-left text-amber-900 hover:underline">
              {o.project_code} · {o.project_name} — {o.vendor_name} <span className="font-mono text-[11px]">{o.po_no}</span>
              <span className="text-[11px] text-amber-700"> · {tr(`arrived ${o.last_arrived_on}, reminder ${o.reminder_on}`, `sampai ${o.last_arrived_on}, pengingat ${o.reminder_on}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The project's factory orders and what became of them. */
export function FactoryOutcomes({ code }: { code: string }) {
  const tr = useTr();
  const { can } = useSession();
  const mayDecide = can("project.update");
  const [state, reload] = useLoad(() => procurement.listFactoryOutcomes({ project_code: code }), [code]);

  if (state.status === "ready" && state.data.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("What became of the factory orders", "Hasil kerja pabrik")}
        subtitle={tr("After arrival the client accepts or rejects the work. Three months after the last container arrived, an undecided order is flagged.",
          "Setelah sampai, klien menerima atau menolak hasilnya. Tiga bulan sejak kontainer terakhir sampai, order yang belum diputuskan ditandai.")}
        icon={Factory}
        action={<SourceBadge state={state} />}
      />
      <Loaded state={state} onRetry={reload}>
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.map((o) => <OutcomeRow key={o.po_no} o={o} mayDecide={mayDecide} onChanged={reload} />)}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}

function OutcomeRow({ o, mayDecide, onChanged }: { o: FactoryOrderOutcome; mayDecide: boolean; onChanged: () => void }) {
  const tr = useTr();
  const [form, setForm] = useState<ClientVerdict | "claim" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showClaims, setShowClaims] = useState(false);
  const arrivedSome = o.containers_arrived > 0;

  return (
    <li className="px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-slate-800">{o.vendor_name}</span>
        <span className="font-mono text-[11px] text-slate-400">{o.po_no}</span>
        <Badge tone={STATE_TONE[o.work_state]}>{FACTORY_WORK_STATE_LABEL[o.work_state]}</Badge>
        {o.needs_confirmation && <Badge tone="amber">{tr("to confirm", "perlu dikonfirmasi")}</Badge>}
        {o.claims_open > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />{tr(`${o.claims_open} open client claim(s)`, `${o.claims_open} klaim klien terbuka`)}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {[
          o.container_count > 0 && tr(`${o.containers_arrived} of ${o.container_count} container(s) arrived`, `${o.containers_arrived} dari ${o.container_count} kontainer sampai`),
          o.last_arrived_on && tr(`last arrived ${o.last_arrived_on}`, `terakhir sampai ${o.last_arrived_on}`),
          o.reminder_on && (o.days_to_reminder != null && o.days_to_reminder < 0
            ? tr(`reminder ${o.reminder_on}, ${-o.days_to_reminder} day(s) ago`, `pengingat ${o.reminder_on}, lewat ${-o.days_to_reminder} hari`)
            : tr(`reminder ${o.reminder_on} (in ${o.days_to_reminder} day(s))`, `pengingat ${o.reminder_on} (${o.days_to_reminder} hari lagi)`)),
          o.qc_names && `QC: ${o.qc_names}`,
          tr(`${o.findings_before} finding(s) before shipping`, `${o.findings_before} temuan sebelum kirim`),
          tr(`${o.claims_total} client claim(s)`, `${o.claims_total} klaim klien`),
        ].filter(Boolean).join(" · ")}
      </p>
      {o.verdict && (
        <p className={cn("mt-0.5 text-[12px]", o.verdict === "ACCEPTED" ? "text-emerald-700" : "text-rose-700")}>
          {o.verdict === "ACCEPTED" ? tr("Accepted", "Diterima") : tr("Rejected", "Ditolak")} {o.verdict_on} · {o.verdict_client_person}
          {o.verdict_reason && ` — ${o.verdict_reason}`}
          {o.verdict_recorded_by && <span className="text-slate-400"> · {tr("recorded by", "dicatat")} {o.verdict_recorded_by}</span>}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {mayDecide && form === null && arrivedSome && (
          <>
            <Button size="sm" variant="outline" icon={ThumbsUp} onClick={() => setForm("ACCEPTED")}>{tr("Accepted by client", "Diterima klien")}</Button>
            <Button size="sm" variant="outline" icon={ThumbsDown} onClick={() => setForm("REJECTED")}>{tr("Rejected by client", "Ditolak klien")}</Button>
            <Button size="sm" variant="ghost" icon={Flag} onClick={() => setForm("claim")}>{tr("Record a client claim", "Catat klaim klien")}</Button>
          </>
        )}
        {o.claims_total > 0 && (
          <button type="button" onClick={() => setShowClaims((v) => !v)} className="text-[12px] text-slate-500 hover:text-brand-700">
            {showClaims ? tr("Hide claims", "Sembunyikan klaim") : tr("Show claims", "Lihat klaim")}
          </button>
        )}
        {o.verdict && (
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-brand-700">
            <History className="h-3.5 w-3.5" />{tr("History", "Riwayat")}
          </button>
        )}
      </div>

      {(form === "ACCEPTED" || form === "REJECTED") && (
        <VerdictForm o={o} verdict={form} onDone={() => { setForm(null); onChanged(); }} onCancel={() => setForm(null)} />
      )}
      {form === "claim" && (
        <ClaimForm o={o} onDone={() => { setForm(null); setShowClaims(true); onChanged(); }} onCancel={() => setForm(null)} />
      )}
      {showClaims && <ClaimList poNo={o.po_no} mayResolve={mayDecide} refresh={o.claims_total + o.claims_open} onChanged={onChanged} />}
      {showHistory && <VerdictHistory poNo={o.po_no} refresh={o.verdict_recorded_at ?? ""} />}
    </li>
  );
}

function VerdictForm({ o, verdict, onDone, onCancel }: {
  o: FactoryOrderOutcome; verdict: ClientVerdict; onDone: () => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(newKey());
  const [day, setDay] = useState(officeToday());
  const [person, setPerson] = useState(o.verdict_client_person ?? "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rejected = verdict === "REJECTED";

  async function save() {
    setBusy(true);
    const res = await procurement.recordClientVerdict({
      po_no: o.po_no, verdict, decided_on: day, client_person: person.trim(),
      reason: reason.trim() || null, note: note.trim() || null,
    }, key.current);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast(res.data.warnings.length ? "warning" : "success",
      rejected ? tr(`${o.po_no} rejected by the client`, `${o.po_no} ditolak klien`) : tr(`${o.po_no} accepted by the client`, `${o.po_no} diterima klien`),
      res.data.warnings.join(" "));
    onDone();
  }

  return (
    <div className={cn("mt-2 rounded-lg border p-3", rejected ? "border-rose-200 bg-rose-50/30" : "border-emerald-200 bg-emerald-50/30")}>
      <p className="mb-2 font-medium text-slate-800">{rejected ? tr("Rejected by the client", "Ditolak klien") : tr("Accepted by the client", "Diterima klien")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("Decided on", "Tanggal keputusan")}
          <input type="date" value={day} max={officeToday()} min={o.first_arrived_on ?? undefined} onChange={(e) => setDay(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500">{tr("Who said it, on the client's side", "Siapa di pihak klien")}
          <input value={person} onChange={(e) => setPerson(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        {rejected && (
          <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Why", "Alasan")}
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={cn(inputCls, "mt-1")}
              placeholder={tr("e.g. finish dull on 3 sofas", "mis. finishing kusam di 3 sofa")} />
          </label>
        )}
        <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Note (optional)", "Catatan (opsional)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button icon={CheckCircle2} onClick={save} disabled={busy || !person.trim() || (rejected && !reason.trim())}>{tr("Save", "Simpan")}</Button>
      </div>
    </div>
  );
}

const KINDS: QcFindingKind[] = ["defect", "spec_mismatch", "damaged", "packing", "late", "other"];
const SEVERITIES: QcSeverity[] = ["minor", "major", "critical"];

/** A client's claim after arrival: a QC finding with phase `after_arrival`.
 *  Photos are filed with the project's QC folder by day (D313). */
function ClaimForm({ o, onDone, onCancel }: { o: FactoryOrderOutcome; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(newKey());
  const ref = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<QcFindingKind>("defect");
  const [severity, setSeverity] = useState<QcSeverity>("major");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const got: { id: string; name: string }[] = [];
    setUploading(files.length);
    for (const file of Array.from(files)) {
      const up = await documents.upload({ file, kind: "Foto QC", entity: "project", entity_no: o.project_code });
      setUploading((n) => n - 1);
      if (up.error) { toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); continue; }
      got.push({ id: up.data.id, name: file.name });
    }
    if (ref.current) ref.current.value = "";
    setPhotos((p) => [...p, ...got]);
  }

  async function save() {
    setBusy(true);
    const res = await qc.raiseQcFinding({
      po_no: o.po_no, phase: "after_arrival", kind, severity, description: description.trim(),
      photo_ids: photos.map((p) => p.id),
    }, key.current);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", tr(`Claim recorded · ${res.data.finding_no}`, `Klaim tercatat · ${res.data.finding_no}`), description.trim());
    onDone();
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/30 p-3">
      <p className="mb-2 font-medium text-slate-800">{tr("A client's claim after arrival", "Klaim klien setelah sampai")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
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
        <label className="block text-xs text-slate-500 sm:col-span-2">{tr("What the client says", "Kata klien")}
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={cn(inputCls, "mt-1")}
            placeholder={tr("e.g. two tables scratched on arrival", "mis. dua meja tergores saat sampai")} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" aria-label={tr("Claim photos", "Foto klaim")}
          onChange={(e) => pick(e.target.files)} />
        <button type="button" disabled={uploading > 0} onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-[12px] text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
          <Camera className="h-3.5 w-3.5" />{uploading > 0 ? tr(`Uploading ${uploading}…`, `Mengunggah ${uploading}…`) : tr("Add photos", "Tambah foto")}
        </button>
        {photos.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
            {p.name}
            <button type="button" aria-label={tr(`Remove ${p.name}`, `Lepas ${p.name}`)} onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button icon={Flag} onClick={save} disabled={busy || !description.trim()}>{tr("Record claim", "Catat klaim")}</Button>
      </div>
    </div>
  );
}

/** The client's claims on an order, closed with what was done. */
function ClaimList({ poNo, mayResolve, refresh, onChanged }: { poNo: string; mayResolve: boolean; refresh: number; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [state, reload] = useLoad(() => qc.listQcFindings({ po_no: poNo }), [poNo, refresh]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");

  async function resolve(no: string) {
    const res = await qc.resolveQcFinding({ finding_no: no, resolution: resolution.trim() });
    if (res.error) { toast("warning", tr("Not closed", "Tidak ditutup"), res.error.message); return; }
    toast("success", tr("Claim resolved", "Klaim selesai"), no);
    setResolving(null); setResolution(""); reload(); onChanged();
  }

  return (
    <Loaded state={state} onRetry={reload} skeletonRows={1}>
      {(rows) => {
        const claims = rows.filter((f) => f.phase === "after_arrival");
        if (claims.length === 0) {
          return <p className="mt-2 text-[12px] text-slate-500">{tr("You cannot read the claims on this order.", "Klaim di order ini tidak bisa dibaca dengan akses Anda.")}</p>;
        }
        return (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {claims.map((f) => (
              <li key={f.id} className="px-3 py-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {f.status === "OPEN" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                  <Badge tone={f.severity === "critical" ? "red" : f.severity === "major" ? "amber" : "slate"}>{QC_SEVERITY_LABEL[f.severity]}</Badge>
                  <span className="font-medium text-slate-800">{QC_FINDING_KIND_LABEL[f.finding_kind]}</span>
                  <span className="text-slate-700">{f.description}</span>
                  <span className="ml-auto text-[11px] text-slate-400">{f.raised_by_name ?? "—"} · {f.created_at.slice(0, 10)} · {f.finding_no}</span>
                </div>
                {f.resolution && <p className="mt-0.5 pl-5 text-emerald-700">{tr("Done", "Tindakan")}: {f.resolution}</p>}
                {mayResolve && f.status === "OPEN" && (resolving === f.finding_no ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-5">
                    <input value={resolution} onChange={(e) => setResolution(e.target.value)} autoFocus
                      placeholder={tr("what was done — repaired, replaced, discounted", "tindakannya — diperbaiki, diganti, diskon")}
                      className="h-8 min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2 text-[12px]" />
                    <Button size="sm" disabled={!resolution.trim()} onClick={() => resolve(f.finding_no)}>{tr("Resolve", "Selesai")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setResolving(null)}>{tr("Back", "Kembali")}</Button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setResolving(f.finding_no); setResolution(""); }}
                    className="mt-1 inline-flex items-center gap-1 pl-5 text-[11px] text-slate-500 hover:text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />{tr("Mark resolved", "Tandai selesai")}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        );
      }}
    </Loaded>
  );
}

function VerdictHistory({ poNo, refresh }: { poNo: string; refresh: string }) {
  const tr = useTr();
  const [state] = useLoad(() => procurement.listFactoryVerdictHistory(poNo), [poNo, refresh]);
  if (state.status !== "ready") return null;
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]">
      {state.data.map((v, i) => (
        <li key={v.recorded_at + i} className={cn(i > 0 && "text-slate-400 line-through decoration-slate-300")}>
          {v.verdict === "ACCEPTED" ? tr("Accepted", "Diterima") : tr("Rejected", "Ditolak")} {v.decided_on} · {v.client_person}
          {v.reason && ` — ${v.reason}`}{v.note && ` (${v.note})`}
          <span className="text-slate-400"> · {v.recorded_by ?? "—"} {v.recorded_at.slice(0, 10)}</span>
        </li>
      ))}
    </ul>
  );
}
