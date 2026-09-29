"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import {
  OVERTIME_DECIDER_LABEL, OVERTIME_STAGE_LABEL,
  type OvertimeDecider, type OvertimeSheetView, type OvertimeStage,
} from "@/services/hr/contracts";
import { officeClock, officeDay } from "@/lib/office";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { useDayLabel } from "./shared";

type Tone = "green" | "red" | "slate" | "amber";

/** What an overtime sheet's state reads as to the person it belongs to.
 *
 *  An ask (`via: "self"`, D333) is waiting for **HRD or leadership**, and once
 *  decided it says in which capacity — *Disetujui pimpinan* and *Disetujui HRD*
 *  are different sentences, and the stage enum alone cannot tell them apart.
 *  A sheet HRD keyed keeps D146's words. */
export function useOvertimeStatus() {
  const tr = useTr();
  return (s: {
    via?: OvertimeSheetView["via"]; stage: OvertimeStage; payable: boolean;
    decided_as: OvertimeDecider | null;
  }): { label: string; tone: Tone } => {
    if (s.via === "self" || s.decided_as) {
      if (s.stage === "declined") return { label: tr("Declined", "Ditolak"), tone: "red" };
      if (s.stage === "waiting_hrd") {
        return { label: tr("Waiting for HRD or leadership", "Menunggu HRD atau pimpinan"), tone: "amber" };
      }
      return s.decided_as === "leader"
        ? { label: tr("Approved by leadership", "Disetujui pimpinan"), tone: "green" }
        : { label: tr("Approved by HRD", "Disetujui HRD"), tone: "green" };
    }
    return {
      label: OVERTIME_STAGE_LABEL[s.stage],
      tone: s.payable ? "green" : s.stage === "declined" ? "red" : "slate",
    };
  };
}

/** *Evin Jonathan · Pimpinan · Kam, 25 Sep 08:10* — who decided, in which
 *  capacity, on the office clock. */
export function useDecisionLine() {
  const day = useDayLabel();
  return (d: { decided_by_name: string | null; decided_as: OvertimeDecider | null; decided_at: string | null }) =>
    d.decided_at
      ? [
          d.decided_by_name ?? "—",
          d.decided_as ? OVERTIME_DECIDER_LABEL[d.decided_as] : null,
          `${day(officeDay(new Date(d.decided_at)))} ${officeClock(new Date(d.decided_at))}`,
        ].filter(Boolean).join(" · ")
      : null;
}

/** Under an overtime row in the person's own history: what it was for, what
 *  came of it, who decided and why — and, while an ask is undecided and has no
 *  result yet, the place to write one (approval waits for it). */
export function OvertimeAskDetails({ sheet, onChanged }: { sheet: OvertimeSheetView; onChanged: () => void }) {
  const tr = useTr();
  const decision = useDecisionLine();
  const line = sheet.lines[0];
  const waiting = sheet.via === "self" && sheet.stage === "waiting_hrd";
  const who = decision(sheet);
  return (
    <div className="mt-1 space-y-1 text-[13px]">
      {line?.deliverable && (
        <p className="text-slate-700">
          <span className="text-slate-500">{tr("For", "Untuk")}: </span>{line.deliverable}
        </p>
      )}
      {line?.result_note ? (
        <p className="text-slate-700">
          <span className="text-slate-500">{tr("Result", "Hasil")}: </span>{line.result_note}
        </p>
      ) : waiting ? (
        <AddResult sheetNo={sheet.sheet_no} onDone={onChanged} />
      ) : null}
      {who && (
        <p className="text-[12px] text-slate-500">
          {who}{sheet.decision_note ? ` — ${sheet.decision_note}` : ""}
        </p>
      )}
      {!sheet.evidence && (
        <p className="flex items-center gap-1 text-[12px] text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {tr("No photo attached.", "Belum ada foto.")}
        </p>
      )}
    </div>
  );
}

function AddResult({ sheetNo, onDone }: { sheetNo: string; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await hr.addOvertimeResultSelf({ sheet_no: sheetNo, result_note: text });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Result saved", "Hasil tersimpan"), sheetNo);
    setText("");
    onDone();
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-2">
      <p className="text-[12px] text-amber-800">
        {tr("Result not written yet — it cannot be approved without one.", "Hasil belum ditulis — belum bisa disetujui tanpa hasil.")}
      </p>
      <div className="mt-1.5 flex gap-2">
        <input
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={tr("What was finished", "Apa yang selesai")}
          aria-label={tr("What was finished", "Apa yang selesai")}
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-base focus:border-brand-500 focus:outline-none"
        />
        <Button size="sm" disabled={busy || !text.trim()} onClick={save}>
          {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
        </Button>
      </div>
    </div>
  );
}
