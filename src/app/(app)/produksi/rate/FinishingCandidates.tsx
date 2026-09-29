"use client";

import { useState } from "react";
import { ChevronRight, Paintbrush, Plus, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import type { BomRateView, FinishingSystem } from "@/services/production/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Each finishing system in the business's recipes (`finishing_recipes`),
 *  totalled per m², offered as a `finishing` rate (0193, D338).
 *
 *  **Offered, never added for anyone.** The owner decides the list (D324
 *  default 2), so a system becomes a rate only when somebody with
 *  `production.update` presses *Add to rate list*, through the same
 *  `saveBomRate` as a rate typed by hand. Once it is on the list, a recipe that
 *  has since changed shows both figures and an *Update* button, pressed or
 *  not; the list keeps whatever figure the person chose.
 */
export function FinishingCandidates({
  rates, mayEdit, version, onChanged,
}: {
  /** The rate list as the page has it, to update an existing rate in full. */
  rates: BomRateView[];
  mayEdit: boolean;
  /** Bumped by the page whenever the list changes, so a match re-reads. */
  version: number;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [systems, reload] = useLoad(() => production.listFinishingSystems(), [version]);
  const [busy, setBusy] = useState<string | null>(null);

  async function add(f: FinishingSystem) {
    setBusy(f.system);
    const res = await production.saveBomRate({
      name: f.rate_name, rate_group: "finishing", uom: "m2", rate: f.cost_per_m2,
      note: `Resep finishing ${f.system}: ${f.steps} langkah${f.effective_on ? `, berlaku ${f.effective_on}` : ""}`,
    });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Rate not added", "Rate tidak ditambahkan"), res.error.message);
      return;
    }
    toast("success", tr("Rate added to the list", "Rate masuk daftar"),
      `${res.data.code} · ${res.data.name} · ${formatIDR(res.data.rate)}/${res.data.uom}`);
    onChanged();
    reload();
  }

  async function update(f: FinishingSystem, r: BomRateView) {
    setBusy(f.system);
    const res = await production.saveBomRate({
      code: r.code, name: r.name, rate_group: r.rate_group, uom: r.uom, rate: f.cost_per_m2,
      item_code: r.item_code, note: r.note, active: r.active,
    });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Rate not saved", "Rate tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr("Rate updated to the recipe total", "Rate diperbarui ke total resep"),
      tr(`${r.code}: ${formatIDR(r.rate)} → ${formatIDR(f.cost_per_m2)} per m². Draft BOMs that follow it move with it.`,
        `${r.code}: ${formatIDR(r.rate)} → ${formatIDR(f.cost_per_m2)} per m². Draft BOM yang mengikutinya ikut berubah.`));
    onChanged();
    reload();
  }

  /* Nothing to offer, or nothing this person may read: say nothing. */
  if (systems.status === "ready" && systems.data.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader
        title={tr("Suggested from finishing recipes", "Usulan dari resep finishing")}
        subtitle={tr(
          "Each finishing system's cost per m², totalled from its recipe steps. Nothing is on the rate list until you add it.",
          "Biaya per m² tiap sistem finishing, dijumlah dari langkah resepnya. Tidak ada yang masuk daftar rate sampai Anda menambahkannya.",
        )}
        icon={Paintbrush}
        action={<SourceBadge state={systems} />}
      />
      <Loaded state={systems} onRetry={reload}>
        {(list) => (
          <ul className="divide-y divide-slate-100">
            {list.map((f) => {
              const listed = f.rate_code ? rates.find((r) => r.code === f.rate_code) ?? null : null;
              const same = f.listed_rate != null && Math.round(f.listed_rate) === f.cost_per_m2;
              const perM2 = !listed || listed.uom.toLowerCase().replace(/²/g, "2").replace(/\s+/g, "") === "m2";
              /* `Bleach (optional)` → `Bleach`: the sentence already says optional. */
              const optional = f.breakdown.filter((s) => s.optional)
                .map((s) => s.step.replace(/\s*\((optional|opsional)\)\s*/i, " ").trim());
              return (
                <li key={f.system} className="px-4 py-3">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    {/* Its own line on a phone; the total and the action beneath it. */}
                    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <p className="text-[13px] font-medium text-slate-800">{f.rate_name}</p>
                      <p className="text-[11px] text-slate-500">
                        {tr(`${f.steps} steps`, `${f.steps} langkah`)}
                        {f.effective_on && <> · {tr(`recipe of ${f.effective_on}`, `resep ${f.effective_on}`)}</>}
                      </p>
                      {f.optional_cost_per_m2 > 0 && (
                        <p className="text-[11px] text-slate-500">
                          {tr(
                            `Includes ${formatIDR(f.optional_cost_per_m2)} of optional steps (${optional.join(", ")}) — ${formatIDR(f.cost_per_m2 - f.optional_cost_per_m2)} without them.`,
                            `Termasuk ${formatIDR(f.optional_cost_per_m2)} langkah opsional (${optional.join(", ")}) — ${formatIDR(f.cost_per_m2 - f.optional_cost_per_m2)} tanpa itu.`,
                          )}
                        </p>
                      )}
                      {f.unpriced_steps > 0 && (
                        <p className="text-[11px] text-amber-700">
                          {tr(`${f.unpriced_steps} steps have no price in the recipe and are not in the total.`,
                            `${f.unpriced_steps} langkah belum punya harga di resep dan tidak ikut dijumlah.`)}
                        </p>
                      )}
                    </div>
                    <div className="sm:text-right">
                      <span className="block tabular-nums text-[13px] font-semibold text-slate-800">{formatIDR(f.cost_per_m2)}</span>
                      <span className="block text-[11px] text-slate-400">per m2</span>
                    </div>
                    <div className="ml-auto flex max-w-[260px] flex-col items-end gap-1">
                      {!f.rate_code && (mayEdit ? (
                        <Button size="sm" icon={Plus} disabled={busy !== null} onClick={() => add(f)}>
                          {tr("Add to rate list", "Tambahkan ke daftar rate")}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-slate-400">{tr("Not on the rate list", "Belum di daftar rate")}</span>
                      ))}
                      {f.rate_code && same && (
                        <Badge tone="green" dot>{tr(`On the list · ${f.rate_code}`, `Di daftar · ${f.rate_code}`)}</Badge>
                      )}
                      {f.rate_code && !same && (
                        <>
                          <span className="text-right text-[11px] text-amber-700">
                            {tr(`On the list at ${formatIDR(f.listed_rate ?? 0)} (${f.rate_code}) — the recipe now totals ${formatIDR(f.cost_per_m2)}.`,
                              `Di daftar ${formatIDR(f.listed_rate ?? 0)} (${f.rate_code}) — resepnya kini ${formatIDR(f.cost_per_m2)}.`)}
                          </span>
                          {!perM2 && (
                            <span className="text-right text-[11px] text-amber-700">
                              {tr(`That rate is per ${listed?.uom}, not per m2 — change it by hand.`,
                                `Rate itu per ${listed?.uom}, bukan per m2 — ubah sendiri.`)}
                            </span>
                          )}
                          {mayEdit && listed && perM2 && (
                            <Button size="sm" variant="outline" icon={RefreshCw} disabled={busy !== null} onClick={() => update(f, listed)}>
                              {tr(`Update to ${formatIDR(f.cost_per_m2)}`, `Perbarui ke ${formatIDR(f.cost_per_m2)}`)}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <details className="group mt-1.5">
                    <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      {tr("Recipe steps", "Langkah resep")}
                    </summary>
                    <div className="mt-1.5 overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-[12px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                            <th className="px-2 py-1 text-left">{tr("Step", "Langkah")}</th>
                            <th className="px-2 py-1 text-left">{tr("Product", "Produk")}</th>
                            <th className="px-2 py-1 text-right">{tr("Price", "Harga")}</th>
                            <th className="px-2 py-1 text-right">{tr("Coverage × coats", "Cakupan × lapis")}</th>
                            <th className="px-2 py-1 text-right">{tr("Per m2", "Per m2")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.breakdown.map((s) => (
                            <tr key={s.step} className={cn("border-b border-slate-100", s.optional && "text-slate-500")}>
                              <td className="px-2 py-1">
                                {s.step}
                                {s.remarks && <span className="block text-[10px] text-slate-400">{s.remarks}</span>}
                              </td>
                              <td className="px-2 py-1 text-slate-600">{s.product ?? "—"}</td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                                {s.unit_price != null ? `${formatIDR(s.unit_price)}/${s.uom ?? "—"}` : "—"}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-slate-600">
                                {s.coverage_m2_per_unit != null ? `${s.coverage_m2_per_unit} m2` : "—"}{s.coats != null ? ` × ${s.coats}` : ""}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                                {s.cost_per_m2 != null ? formatIDR(s.cost_per_m2) : <span className="text-amber-700">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}
