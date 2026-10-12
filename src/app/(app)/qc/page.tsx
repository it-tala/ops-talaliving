"use client";

import { useMemo, useRef, useState } from "react";
import { Ban, CalendarCheck, ChevronDown, ChevronRight, ClipboardCheck, FileText, Plus, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { qc } from "@/demo/api";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import {
  QC_ASSIGNMENT_STATE_LABEL, type QcAssignment, type QcAssignmentState,
} from "@/services/qc/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Field QC › Assignments (0261, O6, kajian §5.7, Q88).
 *
 *  Who watches which factory order, from when until when. A QC opens this from
 *  their phone and sees only what they were sent to watch: the order, its
 *  factory and project, its lines and the working drawing of each — never a
 *  price. The coordinator sends people here; leadership and procurement read
 *  every assignment. Daily reports, findings and progress come with O7. */

const TONE: Record<QcAssignmentState, "slate" | "green" | "amber" | "red"> = {
  PLANNED: "amber", ACTIVE: "green", ENDED: "slate", CANCELLED: "red",
};
const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";

export default function QcAssignmentsPage() {
  const tr = useTr();
  const { can } = useSession();
  const coordinator = can("qc.coordinate");
  const [showCancelled, setShowCancelled] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [state, reload] = useLoad(() => qc.listQcAssignments({ include_cancelled: showCancelled }), [showCancelled]);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Field QC", "QC lapangan")}
        title={tr("QC assignments", "Penugasan QC")}
        description={tr(
          "Who watches which factory order, from when until when. A QC sees only their own assignments — the order, its lines and drawings, never a price.",
          "Siapa memantau order pabrik mana, dari kapan sampai kapan. QC hanya melihat penugasannya sendiri — order, baris dan gambar kerjanya, tanpa harga.")}
        actions={coordinator && !assigning && (
          <Button icon={Plus} onClick={() => setAssigning(true)}>{tr("Assign a QC", "Tugaskan QC")}</Button>
        )}
      />

      {assigning && <AssignForm onDone={() => { setAssigning(false); reload(); }} onCancel={() => setAssigning(false)} />}

      <Card>
        <CardHeader
          title={tr("Assignments", "Penugasan")}
          subtitle={tr("Active first, then planned, then ended.", "Yang berjalan di atas, lalu terjadwal, lalu selesai.")}
          icon={ClipboardCheck}
          action={(
            <div className="flex items-center gap-2">
              <SourceBadge state={state} />
              {coordinator && (
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                  {tr("Show cancelled", "Tampilkan yang dibatalkan")}
                </label>
              )}
            </div>
          )}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => {
            const order: QcAssignmentState[] = ["ACTIVE", "PLANNED", "ENDED", "CANCELLED"];
            const sorted = [...rows].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.starts_on.localeCompare(a.starts_on));
            return sorted.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">
                {coordinator
                  ? tr("Nobody has been sent anywhere yet. Assign a QC to a factory order.", "Belum ada yang ditugaskan. Tugaskan QC ke order pabrik.")
                  : tr("You have no assignments yet. The QC coordinator will send you one.", "Belum ada penugasan untuk Anda. Koordinator QC yang akan menugaskan.")}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {sorted.map((a) => <AssignmentRow key={a.id} a={a} coordinator={coordinator} onChanged={reload} />)}
              </ul>
            );
          }}
        </Loaded>
      </Card>
    </div>
  );
}

function AssignmentRow({ a, coordinator, onChanged }: { a: QcAssignment; coordinator: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [open, setOpen] = useState(a.is_mine && a.state === "ACTIVE");
  const [lines, reloadLines] = useLoad(
    () => (open ? qc.listAssignmentLines(a.assign_no) : Promise.resolve({ data: null })), [open, a.assign_no]);
  const [ending, setEnding] = useState(false);
  const [endsOn, setEndsOn] = useState(a.ends_on ?? officeToday());
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const live = a.state !== "CANCELLED";

  async function saveEnd() {
    setBusy(true);
    const res = await qc.endQcAssignment({ assign_no: a.assign_no, ends_on: endsOn || null });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("End date saved", "Tanggal selesai tersimpan"), `${a.person_name} · ${endsOn || "—"}`);
    setEnding(false); onChanged();
  }
  async function cancel() {
    setBusy(true);
    const res = await qc.cancelQcAssignment({ assign_no: a.assign_no, reason: reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not cancelled", "Tidak dibatalkan"), res.error.message); return; }
    toast("success", tr("Assignment cancelled", "Penugasan dibatalkan"), a.assign_no);
    setCancelling(false); onChanged();
  }

  return (
    <li className={cn("px-4 py-3 text-[13px]", a.state === "CANCELLED" && "bg-slate-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          <span className="font-medium text-slate-800">{a.vendor_name ?? "—"}</span>
        </button>
        <Badge tone={TONE[a.state]}>{QC_ASSIGNMENT_STATE_LABEL[a.state]}</Badge>
        {a.is_mine && <Badge tone="brand">{tr("Mine", "Tugas saya")}</Badge>}
        <span className="text-slate-600">{a.project_code} · {a.project_name}</span>
        <span className="font-mono text-[11px] text-slate-400">{a.po_no}</span>
        <span className="ml-auto text-[12px] text-slate-600">{a.person_name}{a.person_city && ` · ${a.person_city}`}</span>
      </div>
      <p className="mt-0.5 pl-5 text-[11px] text-slate-500">
        {[
          `${tr("from", "mulai")} ${a.starts_on}${a.ends_on ? ` ${tr("to", "s.d.")} ${a.ends_on}` : ""}`,
          a.expected_delivery && tr(`factory promised ${a.expected_delivery}`, `janji pabrik ${a.expected_delivery}`),
          tr(`${a.line_count} line(s)`, `${a.line_count} baris`),
          a.container_count > 0 && tr(`${a.container_count} container(s)`, `${a.container_count} kontainer`),
          a.client_name,
          a.note,
        ].filter(Boolean).join(" · ")}
        {a.vendor_address && <span className="block">{a.vendor_address}</span>}
        {a.cancel_reason && <span className="block text-rose-700">{tr("Cancelled", "Dibatalkan")}: {a.cancel_reason}</span>}
      </p>

      {open && (
        <div className="mt-2 pl-5">
          <Loaded state={lines} onRetry={reloadLines} skeletonRows={1}>
            {(rows) => (rows ?? []).length === 0 ? (
              <p className="text-[12px] text-slate-500">{tr("No lines to show.", "Tidak ada baris.")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {(rows ?? []).map((l) => (
                  <li key={l.line_no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
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
                  </li>
                ))}
              </ul>
            )}
          </Loaded>

          {coordinator && live && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {ending ? (
                <>
                  <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label={tr("Ends on", "Selesai tanggal")}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-[13px]" />
                  <Button size="sm" icon={Save} disabled={busy} onClick={saveEnd}>{tr("Save", "Simpan")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEnding(false)}>{tr("Cancel", "Batal")}</Button>
                </>
              ) : cancelling ? (
                <>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                    placeholder={tr("why — wrong person, wrong order", "kenapa — salah orang, salah order")}
                    className="h-8 min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 text-[13px]" />
                  <Button size="sm" variant="danger" icon={Ban} disabled={busy || !reason.trim()} onClick={cancel}>{tr("Cancel assignment", "Batalkan penugasan")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>{tr("Back", "Kembali")}</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" icon={CalendarCheck} onClick={() => setEnding(true)}>{a.ends_on ? tr("Change end date", "Ubah tanggal selesai") : tr("Set end date", "Isi tanggal selesai")}</Button>
                  <button type="button" onClick={() => setCancelling(true)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-rose-700">
                    <Ban className="h-3.5 w-3.5" /> {tr("Cancel this assignment", "Batalkan penugasan ini")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Send a person to a factory order. The coordinator picks from live factory
 *  orders and sees who already watches each — the ratio is theirs (D414). */
function AssignForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `qca-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [people] = useLoad(() => qc.listQcPeople(), []);
  const [orders] = useLoad(() => qc.listAssignableOrders(), []);
  const [person, setPerson] = useState("");
  const [po, setPo] = useState("");
  const [startsOn, setStartsOn] = useState(officeToday());
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const orderRows = useMemo(() => (orders.status === "ready" ? orders.data : []), [orders]);
  const picked = orderRows.find((o) => o.po_no === po);

  async function save() {
    setBusy(true);
    const res = await qc.assignQc({ person_code: person, po_no: po, starts_on: startsOn, ends_on: endsOn || null, note: note || null }, key.current);
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", tr("Not assigned", "Tidak ditugaskan"), res.error.message); return; }
    toast("success", tr(`Assigned · ${res.data.assign_no}`, `Ditugaskan · ${res.data.assign_no}`),
      [
        res.data.others_on_order ? tr(`Also on this order: ${res.data.others_on_order}.`, `Juga di order ini: ${res.data.others_on_order}.`) : "",
        res.data.account_linked ? "" : tr("This person has no account yet — they cannot see it until one is linked on QC team.", "Orang ini belum punya akun — penugasan belum terlihat olehnya sampai akun ditautkan di Tim QC."),
      ].filter(Boolean).join(" "));
    onDone();
  }

  return (
    <Card className="mb-4">
      <CardHeader title={tr("Assign a QC", "Tugaskan QC")} subtitle={tr("One person, one factory order.", "Satu orang, satu order pabrik.")} icon={Plus} />
      <div className="grid gap-2 px-4 pb-4 text-[13px] sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("QC", "QC")}
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={cn(inputCls, "mt-1")}>
            <option value="">{tr("— pick a person —", "— pilih orang —")}</option>
            {people.status === "ready" && people.data.map((p) => (
              <option key={p.code} value={p.code}>{p.name}{p.city ? ` · ${p.city}` : ""}{p.active_assignments ? tr(` · ${p.active_assignments} active`, ` · ${p.active_assignments} berjalan`) : ""}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">{tr("Factory order", "Order pabrik")}
          <select value={po} onChange={(e) => setPo(e.target.value)} className={cn(inputCls, "mt-1")}>
            <option value="">{tr("— pick a factory order —", "— pilih order pabrik —")}</option>
            {orderRows.map((o) => (
              <option key={o.po_no} value={o.po_no}>{o.po_no} · {o.vendor_name} · {o.project_code} {o.project_name}</option>
            ))}
          </select>
          {picked && (
            <span className="mt-1 block text-[11px] text-slate-500">
              {tr(`${picked.line_count} line(s)`, `${picked.line_count} baris`)}
              {picked.expected_delivery && ` · ${tr("promised", "janji")} ${picked.expected_delivery}`}
              {" · "}{picked.qc_names ? tr(`already watched by ${picked.qc_names}`, `sudah dipantau ${picked.qc_names}`) : tr("nobody on it yet", "belum ada QC")}
            </span>
          )}
          {orders.status === "ready" && orderRows.length === 0 && (
            <span className="mt-1 block text-[11px] text-amber-700">{tr("No live factory orders yet.", "Belum ada order pabrik yang berjalan.")}</span>
          )}
        </label>
        <label className="block text-xs text-slate-500">{tr("From", "Mulai")}
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500">{tr("Until (optional)", "Sampai (opsional)")}
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Note", "Catatan")}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. containers 1–5", "mis. kontainer 1–5")} className={cn(inputCls, "mt-1")} />
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !person || !po || !startsOn}>{tr("Assign", "Tugaskan")}</Button>
        </div>
      </div>
    </Card>
  );
}
