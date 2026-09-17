"use client";

import { useState } from "react";
import { Target, ArrowRight, UserCheck, Check, ExternalLink } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { marketing } from "@/demo/api";
import {
  OUTREACH_STAGES, STAGE_LABEL,
  type OutreachStage, type PropertyView,
} from "@/services/marketing/contracts";
import { useToast } from "@/store/toast";

/** One property and its three agents, in the order they are approached.
 *
 *  The drawer is where the ladder is actually climbed, and it enforces the two
 *  rules that keep the programme honest: a DEAL cannot be recorded for an agent
 *  who has not been onboarded with a commission rate (D185), and moving on
 *  needs a sentence — the note is what somebody reads a year later when the
 *  same agent comes up again (D183).
 */
/** The time where the property is, not where the reader is. */
function localTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", weekday: "short",
    }).format(new Date());
  } catch {
    return "—";
  }
}

export function PropertyDrawer({
  propertyRef, mayEdit, onClose, onChanged,
}: {
  propertyRef: string;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [property, reload] = useLoad(() => marketing.getProperty(propertyRef), [propertyRef]);
  const [busy, setBusy] = useState(false);
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [rate, setRate] = useState(4);

  async function stage(agentId: string, next: OutreachStage) {
    setBusy(true);
    const res = await marketing.setAgentStage({ property_ref: propertyRef, agent_id: agentId, stage: next });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak jadi", res.error.message);
      return;
    }
    toast("success", STAGE_LABEL[next], "");
    reload(); onChanged();
  }

  async function moveOn(agentId: string, name: string) {
    const reason = window.prompt(`Lepas ${name} dan lanjut ke agen berikutnya. Alasannya:`, "Tujuh hari tanpa balasan.");
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await marketing.moveToNextAgent({ property_ref: propertyRef, agent_id: agentId, reason });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi", res.error.message); return; }
    toast("success", `${name} dilepas`, res.data.next_agent_name
      ? `Pesan ke ${res.data.next_agent_name} dicatat terkirim hari ini.`
      : "Tidak ada agen berikutnya.");
    reload(); onChanged();
  }

  async function onboard(agentId: string, name: string) {
    setBusy(true);
    const res = await marketing.onboardRep({
      property_ref: propertyRef, agent_id: agentId, commission_percent: rate,
    });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi", res.error.message); return; }
    toast("success", `${name} jadi representative`, `Komisi ${rate}% nilai kontrak · ${res.data.rep_no}`);
    setOnboarding(null);
    reload(); onChanged();
  }

  async function validate(p: PropertyView) {
    setBusy(true);
    const res = await marketing.validateProperty({ property_ref: p.ref, validated: !p.validated });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi", res.error.message); return; }
    toast("success", p.validated ? "Validasi dicabut" : "Divalidasi", "");
    reload(); onChanged();
  }

  return (
    <Loaded state={property} onRetry={reload}>
      {(p) => (
        <Drawer
          open onClose={onClose} width="max-w-2xl"
          title={p.name}
          subtitle={
            <span className="font-mono text-[11px]">
              {p.ref} · {p.market.full_path} · {p.status}
            </span>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              {([
                ["Skor", p.score ? String(p.score) : "—", p.validated ? "sudah divalidasi orang" : "belum divalidasi"],
                ["Kamar", p.rooms ? formatNumber(p.rooms) : "?", p.is_condo === false ? "bukan strata" : "strata"],
                /* The currency is the market's, never assumed (D187). */
                ["ADR", p.adr ? `${p.market.currency} ${formatNumber(p.adr)}` : "?",
                  p.adr_flag === "CHECK" ? "perlu dicek" : p.market.currency],
                ["Tahap terjauh", STAGE_LABEL[p.best_stage], `${p.agents.length} agen`],
              ] as [string, string, string][]).map(([k, v, note]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className="text-[15px] font-semibold text-slate-800">{v}</dd>
                  <p className="text-[11px] text-slate-500">{note}</p>
                </div>
              ))}
            </dl>

            {(p.reno_signal || p.notes) && (
              <div className="rounded-xl border border-slate-200 px-4 py-2.5 text-[12px] text-slate-600">
                {p.reno_signal && (
                  <p>
                    <span className="font-medium text-slate-700">Sinyal renovasi:</span> {p.reno_signal}
                    {p.reno_source && <span className="text-slate-400"> — {p.reno_source}</span>}
                  </p>
                )}
                {p.notes && <p className="mt-0.5">{p.notes}</p>}
              </div>
            )}

            {/* Ringing an agent at nine in the evening their time is the
                mistake a worldwide pipeline makes first (D187). */}
            <p className="text-[12px] text-slate-600">
              Sekarang <span className="font-medium">{localTime(p.market.timezone)}</span> di{" "}
              {p.market.city} — {p.market.country_name}, bahasa {p.market.language.toUpperCase()}.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {p.maps_url && (
                <a href={p.maps_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" icon={ExternalLink}>Buka di Maps</Button>
                </a>
              )}
              {mayEdit && (
                <Button size="sm" variant={p.validated ? "ghost" : "outline"} icon={Check} disabled={busy} onClick={() => validate(p)}>
                  {p.validated ? "Cabut validasi" : "Tandai tervalidasi"}
                </Button>
              )}
              {!p.validated && (
                <span className="text-[11px] text-amber-700">
                  Skornya masih pendapat mesin sampai ada yang memeriksanya.
                </span>
              )}
            </div>

            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {p.agents.length === 0 && (
                <li className="px-4 py-6 text-[13px] text-slate-500">Belum ada agen untuk properti ini.</li>
              )}
              {p.agents.map((a) => (
                <li key={a.id} className={cn("px-4 py-3", a.move_on && "bg-rose-50/40")}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 font-mono text-[11px] text-slate-600">
                      {a.slot}
                    </span>
                    <span className="text-[13px] font-medium text-slate-800">{a.name}</span>
                    <span className="text-[12px] text-slate-500">{a.agency}</span>
                    <span className="font-mono text-[11px] text-slate-400">{a.phone}</span>
                    <span className="flex-1" />
                    <Badge tone={
                      a.stage === "DEAL" ? "green"
                        : a.stage === "RECYCLED" || a.stage === "SKIP" ? "slate"
                          : a.move_on ? "red" : "brand"
                    }>
                      {STAGE_LABEL[a.stage]}
                    </Badge>
                    {a.rep_id && <Badge tone="green">representative</Badge>}
                  </div>

                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {a.sent_on ? `dikirim ${a.sent_on}` : "belum dikirimi"}
                    {a.replied_on && ` · balas ${a.replied_on}`}
                    {a.waiting_days != null && !a.replied_on && (
                      <span className={a.move_on ? "font-medium text-rose-700" : ""}>
                        {" · "}{a.waiting_days} hari menunggu
                        {a.move_on && " — lewat batas tujuh hari"}
                      </span>
                    )}
                    {a.remark && <span className="block text-slate-600">{a.remark}</span>}
                  </p>

                  {mayEdit && a.stage !== "RECYCLED" && a.stage !== "SKIP" && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {OUTREACH_STAGES.filter((s) => s !== a.stage).map((s) => (
                        <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => stage(a.id, s)}>
                          {STAGE_LABEL[s]}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" icon={ArrowRight} disabled={busy} onClick={() => moveOn(a.id, a.name)}>
                        Lepas & lanjut
                      </Button>
                      {!a.rep_id && (
                        onboarding === a.id ? (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-500">Komisi %</span>
                            <div className="w-[80px]"><NumberInput value={rate} onChange={setRate} /></div>
                            <Button size="sm" icon={UserCheck} disabled={busy} onClick={() => onboard(a.id, a.name)}>
                              Onboarding
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setOnboarding(null)}>Batal</Button>
                          </span>
                        ) : (
                          <Button size="sm" variant="ghost" icon={UserCheck} onClick={() => setOnboarding(a.id)}>
                            Jadikan representative
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <p className="flex items-start gap-2 text-[11px] text-slate-500">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              Deal hanya bisa dicatat setelah agennya di-onboarding beserta persen komisinya — tanpa
              itu tidak ada yang tahu berapa yang harus dibayar nanti.
            </p>
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}
