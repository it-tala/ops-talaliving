"use client";

import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { Combobox } from "@/components/ui/combobox";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { STAGE_NAME, type DailyTargetView } from "@/services/production/contracts";
import { stagePosition } from "@/services/production/work-slots-view";
import { officeToday } from "@/lib/office";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Who may set a target (D356): leadership, HRD or production — the same
 *  question the seam asks, so the button is never offered to be refused. */
export function useMaySetTargets(): boolean {
  const { can, hasAuthority } = useSession();
  return can("production.update") || can("hrd.update")
    || hasAuthority("approve_funds") || hasAuthority("approve_goods");
}

/** Target against what was done, one row per Job Order, day and stage. */
export function TargetsTab({ from, to, day }: { from: string; to: string; day: string }) {
  const tr = useTr();
  const may = useMaySetTargets();
  const [rows, reload] = useLoad(() => production.listDailyTargets({ from, to }), [from, to]);
  const [setting, setSetting] = useState(false);
  return (
    <div>
      {may && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <p className="text-[11px] text-slate-500">
            {tr(
              "Set per Job Order, per day, per stage. A change says why; a day that has ended keeps its target.",
              "Diisi per Job Order, per hari, per tahap. Perubahan menyebut alasannya; hari yang sudah lewat tidak diubah targetnya.",
            )}
          </p>
          <Button size="sm" variant={setting ? "ghost" : "outline"} icon={Target} className="ml-auto" onClick={() => setSetting(!setting)}>
            {setting ? tr("Close", "Tutup") : tr("Set a target", "Isi target")}
          </Button>
        </div>
      )}
      {setting && <TargetForm day={day} onDone={reload} />}
      <Loaded state={rows} onRetry={reload} skeletonRows={3}>
        {(all) => <TargetTable rows={all} multiDay={from !== to} />}
      </Loaded>
    </div>
  );
}

function TargetTable({ rows, multiDay }: { rows: DailyTargetView[]; multiDay: boolean }) {
  const tr = useTr();
  if (rows.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-slate-500">{tr("No target set for this period.", "Belum ada target pada periode ini.")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-[12px]">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            {multiDay && <th className="px-3 py-1.5 font-medium">{tr("Date", "Tanggal")}</th>}
            <th className="px-3 py-1.5 font-medium">Job Order</th>
            <th className="px-2 py-1.5 font-medium">{tr("Stage", "Tahap")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr("Target", "Target")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr("Done", "Tercapai")}</th>
            <th className="w-32 px-2 py-1.5 font-medium" />
            <th className="px-3 py-1.5 font-medium">{tr("Set by", "Diisi")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((t) => {
            const pct = t.target > 0 ? Math.round((t.actual / t.target) * 100) : null;
            return (
              <tr key={`${t.work_date}|${t.wo_no}|${t.stage}`} className="align-top">
                {multiDay && <td className="px-3 py-1.5 tabular-nums text-slate-500">{t.work_date}</td>}
                <td className="px-3 py-1.5">
                  <span className="block text-slate-800">{t.item_name}</span>
                  <span className="font-mono text-[10px] text-slate-400">{t.wo_no}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-600">{t.stage_name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{formatNumber(t.target)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{formatNumber(t.actual)}</td>
                <td className="px-2 py-1.5">
                  {pct === null ? (
                    <span className="text-[11px] text-slate-400">{tr("nothing planned", "tidak direncanakan")}</span>
                  ) : (
                    <>
                      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-rose-400")}
                          style={{ width: `${Math.min(pct, 100)}%` }} />
                      </span>
                      <span className={cn("text-[10px] tabular-nums", pct >= 100 ? "text-emerald-700" : "text-slate-500")}>{pct}%</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  {t.set_by_name ?? "—"}
                  {t.revisions > 1 && (
                    <span className="block text-[10px] text-amber-700" title={t.reason ?? undefined}>
                      {tr(`changed ${t.revisions - 1}×`, `diubah ${t.revisions - 1}×`)}{t.reason ? ` — ${t.reason}` : ""}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetForm({ day, onDone }: { day: string; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [orders] = useLoad(() => production.listWorkOrders(), []);
  const [woNo, setWoNo] = useState("");
  const [date, setDate] = useState(day < officeToday() ? officeToday() : day);
  const [stage, setStage] = useState("");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = useMemo(() => (orders.status === "ready" ? orders.data.filter((w) => w.status === "OPEN") : []), [orders]);
  const wo = open.find((w) => w.wo_no === woNo);
  const input = "h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  async function save() {
    setBusy(true);
    const res = await production.setDailyTarget({ wo_no: woNo, work_date: date, stage, qty, reason: reason || null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr("Target set", "Target tersimpan"),
      `${res.data.wo_no} · ${res.data.stage_name} · ${res.data.work_date}: ${formatNumber(res.data.target)}`);
    setReason(""); setQty(0);
    onDone();
  }

  return (
    <div className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <Combobox
        value={woNo}
        onChange={(v) => { setWoNo(v); setStage(""); }}
        options={open.map((w) => {
          const p = stagePosition(w);
          return { value: w.wo_no, label: `${w.wo_no} · ${w.item_name}`,
            sublabel: `${formatNumber(p.complete)}/${formatNumber(p.qty)} ${tr("complete", "selesai")}${w.project_code ? ` · ${w.project_code}` : ""}` };
        })}
        placeholder={tr("Which Job Order", "Job Order yang mana")}
      />
      <div className="grid gap-2 sm:grid-cols-[150px_1fr_100px]">
        <input type="date" value={date} min={officeToday()} onChange={(e) => setDate(e.target.value)}
          aria-label={tr("Date", "Tanggal")} className={input} />
        <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={!wo}
          aria-label={tr("Stage", "Tahap")} className={input}>
          <option value="">{tr("Stage…", "Tahap…")}</option>
          {(wo?.stages ?? []).map((s) => <option key={s.stage} value={s.stage}>{STAGE_NAME(s.stage)}</option>)}
        </select>
        <NumberInput value={qty} min={0} max={wo?.qty ?? 9999} onChange={setQty} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={cn(input, "min-w-[240px] flex-1")}
          placeholder={tr("Reason — required when changing a target already set", "Alasan — wajib kalau mengubah target yang sudah ada")} />
        <Button size="sm" icon={Target} onClick={save} disabled={busy || !wo || !stage || !date}>
          {tr("Save target", "Simpan target")}
        </Button>
      </div>
      {wo && (
        <p className="text-[11px] text-slate-500">
          {tr("Order", "Order")} {formatNumber(wo.qty)} {wo.uom} · {tr("0 means nothing is planned at this stage that day.", "0 berarti tidak ada yang direncanakan di tahap ini hari itu.")}
        </p>
      )}
    </div>
  );
}

/** Today's targets for one Job Order, for its drawer: *Amplas 15 · 12 done*. */
export function TodayTargets({ woNo }: { woNo: string }) {
  const tr = useTr();
  const today = officeToday();
  const [rows] = useLoad(() => production.listDailyTargets({ from: today, to: today, wo_no: woNo }), [woNo, today]);
  if (rows.status !== "ready" || rows.data.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
      <Target className="h-3.5 w-3.5 text-slate-400" />
      {tr("Today's target:", "Target hari ini:")}
      {rows.data.map((t) => (
        <Badge key={t.stage} tone={t.target > 0 && t.actual >= t.target ? "green" : "slate"}>
          {t.stage_name} {formatNumber(t.actual)}/{formatNumber(t.target)}
        </Badge>
      ))}
    </p>
  );
}
