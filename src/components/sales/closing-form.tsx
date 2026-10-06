"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import {
  CLOSING_REASONS, PIPELINE_STATUSES,
  type ClosingReason, type ProjectStatus, type ProjectView,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";

/** Closing a project that will not go on (P2, D377).
 *
 *  Before the deal it is **LOST** — the sale did not happen; after it,
 *  **CANCELLED** — the order was called off. The form picks which from where
 *  the project stands, and asks for both a category (how many lose on price)
 *  and a sentence (why this one). The database refuses either missing, so
 *  this form cannot be the only place the rule lives.
 */
export function ClosingForm({
  p, onDone, onCancel, compact,
}: {
  p: Pick<ProjectView, "code" | "name" | "status">;
  onDone: (p: ProjectView) => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const status = (p.status ?? "INQUIRY") as ProjectStatus;
  const to: ProjectStatus = PIPELINE_STATUSES.includes(status) ? "LOST" : "CANCELLED";
  const [code, setCode] = useState<ClosingReason | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setRefusal(null);
    const res = await procurement.setProjectStatus({
      code: p.code, status: to, reason: reason.trim() || null, reason_code: code || null,
    });
    setBusy(false);
    if (res.error) { setRefusal(res.error.message); return; }
    toast("success",
      to === "LOST" ? tr(`${p.code} marked lost`, `${p.code} ditandai tidak jadi`) : tr(`${p.code} cancelled`, `${p.code} dibatalkan`),
      code || undefined);
    onDone(res.data);
  }

  return (
    <div className={cn("space-y-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3", compact && "p-2.5")}>
      <p className="text-[12px] text-slate-700">
        {to === "LOST"
          ? tr("Not deal yet, so it becomes LOST — the sale did not happen.", "Belum deal, jadi statusnya LOST — penjualannya tidak jadi.")
          : tr("Already a deal, so it becomes CANCELLED — the order was called off.", "Sudah deal, jadi statusnya CANCELLED — pesanannya dibatalkan.")}
      </p>
      <label className="block text-xs text-slate-500">{tr("Reason", "Alasan")}
        <select
          value={code} onChange={(e) => setCode(e.target.value as ClosingReason | "")}
          className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
        >
          <option value="">{tr("Pick a reason…", "Pilih alasan…")}</option>
          {CLOSING_REASONS.map((r) => (
            <option key={r.code} value={r.code}>{r.code} — {lang === "id" ? r.hint_id : r.hint}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-slate-500">{tr("In one sentence", "Dalam satu kalimat")}
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder={tr("What the client said, and who said it", "Apa yang dikatakan klien, dan siapa yang mengatakannya")}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        />
        <span className="text-[11px] text-slate-500">
          {tr("Required. The category says how many; the sentence says why this one.", "Wajib. Kategori menjawab berapa banyak; kalimat menjawab kenapa yang ini.")}
        </span>
      </label>
      {refusal && <p className="rounded-md bg-rose-100 px-2.5 py-1.5 text-[12px] text-rose-800">{refusal}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Back", "Kembali")}</Button>
        <Button size="sm" variant="danger" icon={XCircle} onClick={close} disabled={busy}>
          {to === "LOST" ? tr("Mark as lost", "Tandai tidak jadi") : tr("Cancel project", "Batalkan proyek")}
        </Button>
      </div>
    </div>
  );
}
