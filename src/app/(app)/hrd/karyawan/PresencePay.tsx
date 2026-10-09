"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** *Dibayar per kehadiran* (0252, D409).
 *
 *  Owner: *khusus mbak nuur ejo household tidak dihitung jam nya, dihitung
 *  asal ada bukti kehadiran saja, dibayar full sehari.* For somebody paid by
 *  the day: a day with any tap — the machine's, the phone's, or one HRD typed —
 *  is a whole day, and its hours, lateness and early leave are not counted. On
 *  with a reason, off with a reason from today on — the periods already read
 *  stay as they were. HRD's only. */
export function PresencePay({ employeeNo }: { employeeNo: string }) {
  const tr = useTr();
  const { toast } = useToast();
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [list, reload] = useLoad(() => hr.listPresencePay(), []);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (list.status !== "ready") return null;
  const mine = list.data.find((x) => x.employee_no === employeeNo) ?? null;

  async function set(on: boolean) {
    setBusy(true);
    const res = await hr.setPresencePay({ employee_no: employeeNo, on, reason: reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", on
      ? tr("Paid by presence from now", "Sekarang dibayar per kehadiran")
      : tr("Paid by the hours again", "Kembali dihitung menurut jam absensi"));
    setReason("");
    reload();
  }

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-600">{tr("How a day is paid", "Cara hari dibayar")}</p>
      <p className="mt-1 text-[12px] text-slate-700">
        {mine
          ? <>{tr("By presence — any tap is a full day; hours, lateness and early leave not counted", "Per kehadiran — ada tap = sehari penuh; jam, terlambat dan pulang cepat tidak dihitung")}
            {" — "}<span className="italic">{mine.reason}</span>{mine.starts_on ? ` (${tr("from", "sejak")} ${mine.starts_on})` : ""}{mine.by_name ? ` (${mine.by_name})` : ""}</>
          : tr("By the attendance hours — late and early leave are deducted.",
            "Menurut jam absensi — terlambat dan pulang cepat dipotong.")}
      </p>
      {mayEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason} onChange={(e) => setReason(e.target.value)}
            aria-label={tr("Reason", "Alasan")}
            placeholder={mine ? tr("Why it ends", "Alasan diakhiri") : tr("Why — e.g. household, hours not counted", "Alasan — mis. household, jam tidak dihitung")}
            className="h-8 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
          />
          <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => set(!mine)}>
            {mine ? tr("Pay by the hours", "Hitung menurut jam") : tr("Pay by presence", "Jadikan dibayar per kehadiran")}
          </Button>
        </div>
      )}
    </div>
  );
}
