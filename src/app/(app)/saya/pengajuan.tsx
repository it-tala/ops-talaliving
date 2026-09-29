"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { type LeaveKind, type LeaveRequestView, type OvertimeSheetView } from "@/services/hr/contracts";
import { formatNumber } from "@/lib/format";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { attachPhoto, CameraButton, FIELD, useDayLabel } from "./shared";
import { OvertimeForm } from "./overtime-form";
import { OvertimeAskDetails, useOvertimeStatus } from "./overtime-ask";

type Kind = LeaveKind | "lembur";

/** Izin, sakit, cuti and lembur from a phone (D331).
 *
 *  Leave goes through `request_leave`'s self branch (0165). **Sakit carries
 *  the surat dokter** from the camera, because D144 pays a sick day only with
 *  the letter: the photo is filed against the request (0187), and approving
 *  carries it to each day. A sick request cannot be sent without one; if the
 *  photo fails after the request is saved, the history row keeps a button to
 *  attach it, and a late letter still turns the days paid. */
export function PengajuanTab() {
  const tr = useTr();
  const day = useDayLabel();
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("izin");
  const [balance, reloadBalance] = useLoad(() => hr.myLeaveBalance(), []);
  const [requests, reloadRequests] = useLoad(() => hr.myLeaveRequests(), []);
  const [sheets, reloadSheets] = useLoad(() => hr.myOvertimeSheets(), []);
  const [draft, setDraft] = useState({ from_date: "", to_date: "", reason: "" });
  const [letter, setLetter] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const KINDS: { id: Kind; label: string }[] = [
    { id: "izin", label: tr("Permit", "Izin") },
    { id: "sakit", label: tr("Sick", "Sakit") },
    { id: "cuti", label: tr("Leave", "Cuti") },
    { id: "lembur", label: tr("Overtime", "Lembur") },
  ];

  function reloadAll() { reloadRequests(); reloadBalance(); reloadSheets(); }

  async function send() {
    if (kind === "lembur") return;
    setBusy(true);
    const res = await hr.requestLeave({
      kind, from_date: draft.from_date, to_date: draft.to_date || draft.from_date, reason: draft.reason,
    });
    if (res.error) {
      setBusy(false);
      toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    let letterErr: string | null = null;
    if (kind === "sakit" && letter) {
      letterErr = (await attachPhoto(letter, "Surat Dokter", "leave_request", res.data.request_no))?.message ?? null;
    }
    setBusy(false);
    if (letterErr) {
      toast("warning",
        tr(`${res.data.request_no} recorded — the doctor's note did not attach`, `${res.data.request_no} tercatat — surat dokter belum terlampir`),
        `${letterErr} ${tr("Attach it again from the history below.", "Lampirkan lagi dari riwayat di bawah.")}`);
    } else {
      toast("success", tr(`${res.data.request_no} recorded`, `${res.data.request_no} tercatat`),
        tr(`${res.data.days} day(s), waiting for HRD.`, `${res.data.days} hari, menunggu keputusan HRD.`));
    }
    setDraft({ from_date: "", to_date: "", reason: "" });
    setLetter(null);
    reloadAll();
  }

  const canSend = !busy && !!draft.from_date && !!draft.reason.trim() && (kind !== "sakit" || !!letter);

  return (
    <div className="space-y-4">
      <Loaded state={balance} skeletonRows={1}>
        {(b) => b && (
          <Card className="grid grid-cols-3 divide-x divide-slate-100 text-center">
            <div className="px-2 py-3">
              <p className="text-[12px] text-slate-500">{tr("Leave left", "Sisa cuti")}</p>
              <p className={cn("text-2xl font-semibold", b.remaining === 0 ? "text-amber-700" : "text-slate-900")}>{b.remaining}</p>
            </div>
            <div className="px-2 py-3">
              <p className="text-[12px] text-slate-500">{tr("Allowance", "Jatah")}</p>
              <p className="text-2xl font-semibold text-slate-900">{b.entitlement}</p>
            </div>
            <div className="px-2 py-3">
              <p className="text-[12px] text-slate-500">{tr("Taken", "Terpakai")}</p>
              <p className="text-2xl font-semibold text-slate-900">{b.taken + b.booked}</p>
            </div>
          </Card>
        )}
      </Loaded>

      <Card className="p-4">
        <div role="tablist" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
          {KINDS.map((k) => (
            <button
              key={k.id} type="button" role="tab" aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cn(
                "h-11 rounded-lg text-[15px] font-medium",
                kind === k.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {kind === "lembur" ? (
            <OvertimeForm onDone={reloadAll} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[13px] text-slate-600">
                  {tr("From", "Dari")}
                  <input type="date" value={draft.from_date}
                    onChange={(e) => setDraft({ ...draft, from_date: e.target.value })} className={`mt-1 ${FIELD}`} />
                </label>
                <label className="block text-[13px] text-slate-600">
                  {tr("Until", "Sampai")}
                  <input type="date" value={draft.to_date} min={draft.from_date || undefined}
                    onChange={(e) => setDraft({ ...draft, to_date: e.target.value })} className={`mt-1 ${FIELD}`} />
                </label>
              </div>
              <label className="block text-[13px] text-slate-600">
                {tr("Reason", "Alasan")}
                <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} className={`mt-1 ${FIELD}`} />
              </label>
              {kind === "sakit" && (
                <>
                  <CameraButton
                    label={tr("Photograph the doctor's note", "Foto surat dokter")}
                    file={letter} onFile={setLetter} disabled={busy}
                  />
                  <p className="text-[12px] text-slate-500">
                    {tr("A sick day is paid only with the doctor's note.", "Hari sakit dibayar hanya dengan surat dokter.")}
                  </p>
                </>
              )}
              {kind === "izin" && (
                <p className="text-[12px] text-slate-500">{tr("A permit is recorded and not paid.", "Izin tercatat dan tidak dibayar.")}</p>
              )}
              <Button className="h-12 w-full text-base" disabled={!canSend} onClick={send}>
                {busy ? tr("Sending…", "Mengirim…") : tr("Send request", "Kirim pengajuan")}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <p className="border-b border-slate-100 px-5 py-3 text-[14px] font-semibold text-slate-800">
          {tr("My requests", "Pengajuan saya")}
        </p>
        <Loaded state={requests} onRetry={reloadRequests}>
          {(leave) => (
            <Loaded state={sheets} onRetry={reloadSheets}>
              {(ot) => <History leave={leave} overtime={ot} day={day} onChanged={reloadAll} />}
            </Loaded>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function History({
  leave, overtime, day, onChanged,
}: {
  leave: LeaveRequestView[];
  overtime: OvertimeSheetView[];
  day: (k: string) => string;
  onChanged: () => void;
}) {
  const tr = useTr();
  const otStatus = useOvertimeStatus();
  const KIND = { izin: tr("Permit", "Izin"), sakit: tr("Sick", "Sakit"), cuti: tr("Leave", "Cuti") };
  const STATUS = {
    PENDING: tr("Waiting", "Menunggu"), APPROVED: tr("Approved", "Disetujui"),
    REJECTED: tr("Rejected", "Ditolak"), CANCELLED: tr("Cancelled", "Dibatalkan"),
  };
  const rows = [
    ...leave.map((r) => ({ key: r.request_no, date: r.from_date, leave: r, ot: null as OvertimeSheetView | null })),
    ...overtime.map((s) => ({ key: s.sheet_no, date: s.work_date, leave: null as LeaveRequestView | null, ot: s })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  if (rows.length === 0) {
    return <p className="px-5 py-6 text-[14px] text-slate-500">{tr("No requests yet.", "Belum ada pengajuan.")}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(({ key, leave: r, ot: s }) => r ? (
        <li key={key} className="px-5 py-3 text-[14px]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">{KIND[r.kind]}</span>
            <span className="text-slate-600">
              {day(r.from_date)}{r.to_date !== r.from_date ? ` – ${day(r.to_date)}` : ""}
            </span>
            <Badge className="ml-auto shrink-0" tone={r.status === "APPROVED" ? "green" : r.status === "REJECTED" ? "red" : "slate"}>
              {STATUS[r.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-slate-600">{r.reason}</p>
          {r.decision_note && <p className="mt-0.5 text-[12px] text-slate-500">{r.decided_by_name}: {r.decision_note}</p>}
          {r.kind === "sakit" && (r.letter_attached ? (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-emerald-700">
              <Check className="h-3.5 w-3.5" /> {tr("Doctor's note attached", "Surat dokter terlampir")}
            </p>
          ) : r.status !== "REJECTED" && r.status !== "CANCELLED" && (
            <LateLetter requestNo={r.request_no} onDone={onChanged} />
          ))}
        </li>
      ) : s ? (
        <li key={key} className="px-5 py-3 text-[14px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-800">{tr("Overtime", "Lembur")}</span>
            <span className="whitespace-nowrap text-slate-600">
              {day(s.work_date)} · {formatNumber(s.lines[0]?.hours ?? 0)} {tr("h", "jam")}
            </span>
            <Badge className="ml-auto shrink-0" tone={otStatus(s).tone}>{otStatus(s).label}</Badge>
          </div>
          <OvertimeAskDetails sheet={s} onChanged={onChanged} />
        </li>
      ) : null)}
    </ul>
  );
}

/** The letter that came later — still worth sending: the day turns paid the
 *  moment it is attached (D144, 0187). */
function LateLetter({ requestNo, onDone }: { requestNo: string; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function pick(f: File | null) {
    if (!f) return;
    setBusy(true);
    const err = await attachPhoto(f, "Surat Dokter", "leave_request", requestNo);
    setBusy(false);
    if (err) { toast("warning", tr("Not attached", "Tidak terlampir"), err.message); return; }
    toast("success", tr("Doctor's note attached", "Surat dokter terlampir"), requestNo);
    onDone();
  }
  return (
    <CameraButton
      className="mt-2"
      label={busy ? tr("Sending…", "Mengirim…") : tr("No doctor's note yet — photograph it", "Belum ada surat dokter — foto sekarang")}
      onFile={(f) => void pick(f)} disabled={busy}
    />
  );
}
