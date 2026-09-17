"use client";

import { useState } from "react";
import { Target, AlertTriangle, Radar, ArrowRight, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { marketing } from "@/demo/api";
import { STAGE_LABEL, type MarketLevel, type PropertyView } from "@/services/marketing/contracts";
import { PropertyDrawer } from "./PropertyDrawer";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** Package — recruiting the agents who bring the owners (D183).
 *
 *  The funnel counts **properties by their furthest agent**, not agents: a
 *  building where one agent is at DEAL is not also a building at QUEUED, and
 *  counting it in both is how a funnel stops adding up.
 *
 *  The queue above it is the screen's real job. The rule the team already runs
 *  is seven days of silence and you move to the next of the three agents — and
 *  in a spreadsheet that is a column somebody has to remember to fill in, which
 *  means it is wrong by Friday. Here it is derived from the day the message went
 *  out, so nobody maintains it and nobody can forget it.
 */
export default function PipelinePage() {
  const { can } = useSession();
  const { toast } = useToast();
  /* One filter, three altitudes: the scope is a **prefix of the market code**,
     so `AU` is a country, `AU-QLD-GOLDCOAST` a city and the whole code one
     district (D187). The grouping of the scrape panel follows the depth
     somebody has drilled to, which is what makes the same screen work for one
     coast and for twelve countries. */
  const [scope, setScope] = useState<string>("");
  /* Nothing chosen → compare countries. A country chosen → compare its cities.
     A city or a district chosen → compare districts. */
  const level: MarketLevel = scope === "" ? "country" : scope.split("-").length === 1 ? "city" : "area";
  const [markets] = useLoad(() => marketing.listMarkets(), []);
  const [properties, reloadProps] = useLoad(() => marketing.listProperties(), []);
  const [metrics, reloadMetrics] = useLoad(() => marketing.getMetrics({ scope: scope || undefined, level }), [scope, level]);
  const [queue, reloadQueue] = useLoad(() => marketing.getQueue({ scope: scope || undefined }), [scope]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mayEdit = can("marketing.update");

  function reloadAll() { reloadProps(); reloadMetrics(); reloadQueue(); }

  async function moveOn(propertyRef: string, agentId: string, agentName: string) {
    const reason = window.prompt(`Lepas ${agentName} dan lanjut ke agen berikutnya. Alasannya:`, "Tujuh hari tanpa balasan.");
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await marketing.moveToNextAgent({ property_ref: propertyRef, agent_id: agentId, reason });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi", res.error.message); return; }
    toast(
      "success", `${agentName} dilepas`,
      res.data.next_agent_name
        ? `Pesan ke ${res.data.next_agent_name} dicatat terkirim hari ini.`
        : "Tidak ada agen berikutnya — properti ini kembali ke tumpukan.",
    );
    reloadAll();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="Marketing"
        title="Package — pipeline agen"
        description="Properti strata di-scrape dan diperkaya di luar sistem; yang di sini adalah apa yang terjadi sesudahnya. Tiga agen per properti, didekati berurutan sampai satu setuju."
        actions={<SourceBadge state={properties} />}
      />

      <Loaded state={metrics} onRetry={reloadMetrics}>
        {(m) => (
          <>
            <Loaded state={markets} skeletonRows={1}>
              {(all) => {
                /* Countries always; then the cities of the country in scope;
                   then its districts. Drilling down never hides the level
                   above it, because "back to all of Australia" is one click
                   somebody needs constantly. */
                /* Every prefix is taken **from the market code itself** rather
                   than rebuilt from the labels: `AU-QLD-GOLDCOAST-SPNORTH`
                   minus its last segment is the city, and its first segment is
                   the country. Deriving it from the words instead produced
                   `AU-QUE-GOLDCOAST` against a seed that says `QLD`, and the
                   filter silently matched nothing (F53). */
                const cityPrefix = (code: string) => code.split("-").slice(0, -1).join("-");
                const countries = [...new Map(all.map((x) => [x.country_code, x.country_name])).entries()];
                const country = scope.split("-")[0];
                const cities = scope
                  ? [...new Map(all.filter((x) => x.country_code === country)
                    .map((x) => [cityPrefix(x.code), x.city])).entries()]
                  : [];
                const areas = scope.split("-").length > 1
                  ? all.filter((x) => x.code.startsWith(`${scope}-`) || x.code === scope)
                    .map((x) => [x.code, x.area_label] as [string, string])
                  : [];
                return (
                  <div className="mb-4 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant={scope === "" ? "primary" : "outline"} onClick={() => setScope("")}>
                      Semua negara
                    </Button>
                    {countries.map(([code, name]) => (
                      <Button key={code} size="sm" variant={scope === code ? "primary" : "outline"} onClick={() => setScope(code)}>
                        {name}
                      </Button>
                    ))}
                    {cities.length > 0 && <span className="mx-1 text-slate-300">·</span>}
                    {cities.map(([code, name]) => (
                      <Button key={code} size="sm" variant={scope === code ? "primary" : "outline"} onClick={() => setScope(code)}>
                        {name}
                      </Button>
                    ))}
                    {areas.length > 0 && <span className="mx-1 text-slate-300">·</span>}
                    {areas.map(([code, name]) => (
                      <Button key={code} size="sm" variant={scope === code ? "primary" : "outline"} onClick={() => setScope(code)}>
                        {name}
                      </Button>
                    ))}
                  </div>
                );
              }}
            </Loaded>

            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6 lg:divide-x">
                {([
                  ["Properti", String(m.properties), `${m.qualified} qualified`],
                  ["Tervalidasi", `${m.validated}/${m.qualified}`, "diperiksa orang, bukan mesin"],
                  ["Dikirimi pesan", String(m.messaged), "agen"],
                  ["Membalas", String(m.replied), "agen"],
                  /* No rate over nothing — the same rule every other figure here
                     follows: missing, never a made-up zero. */
                  ["Tingkat balasan", m.reply_rate == null ? "—" : `${m.reply_rate}%`,
                    m.reply_rate == null ? "belum ada yang dikirimi" : "dari yang dikirimi"],
                  ["Deal", String(m.deals), `${m.forms_back} formulir kembali`],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-800">{v}</dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Loaded state={queue} onRetry={reloadQueue}>
                {(q) => (
                  <Card>
                    <CardHeader
                      title={q.length === 0 ? "Tidak ada yang perlu dikejar" : `${q.length} perlu tindakan`}
                      subtitle="Lewat tujuh hari tanpa balasan di atas, lalu yang jatuh tempo hari ini."
                      icon={AlertTriangle}
                    />
                    <ul className="divide-y divide-slate-100">
                      {q.length === 0 && (
                        <li className="px-5 py-6 text-[13px] text-slate-500">
                          Antrean bersih. Bukan berarti tidak ada kerjaan — berarti tidak ada yang lewat tenggat.
                        </li>
                      )}
                      {q.map((row) => (
                        <li key={row.agent_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            row.kind === "move_on" ? "bg-rose-500" : "bg-emerald-500",
                          )} />
                          <span className="text-[13px] font-medium text-slate-800">{row.agent_name}</span>
                          <span className="text-[12px] text-slate-500">
                            {row.property_name} · {row.market_label} · agen {row.slot}
                          </span>
                          {/* Whether to ring somebody depends on the time
                              THERE, which a list of names cannot say (D187). */}
                          <span className="text-[11px] text-slate-400">{localTime(row.timezone)}</span>
                          <Badge tone="slate">{STAGE_LABEL[row.stage]}</Badge>
                          <span className="flex-1" />
                          {row.kind === "move_on" ? (
                            <>
                              <span className="text-[11px] font-medium text-rose-700">
                                {row.waiting_days} hari tanpa balasan
                              </span>
                              {mayEdit && (
                                <Button
                                  size="sm" variant="outline" icon={ArrowRight} disabled={busy}
                                  onClick={() => moveOn(row.property_ref, row.agent_id, row.agent_name)}
                                >
                                  Agen berikutnya
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-emerald-700">jatuh tempo {row.next_action_on}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </Loaded>

              <div className="space-y-4">
                <Card>
                  <CardHeader
                    title="Corong — agen terjauh per properti"
                    subtitle="Satu properti dihitung sekali, di tahap agen yang paling jauh."
                    icon={Target}
                  />
                  <div className="space-y-1.5 px-5 py-3">
                    {(() => {
                      const max = Math.max(1, ...m.funnel.map((f) => f.properties));
                      return m.funnel.map((f) => (
                        <div key={f.stage} className="flex items-center gap-2 text-[12px]">
                          <span className="w-[110px] shrink-0 text-slate-600">{STAGE_LABEL[f.stage]}</span>
                          <span className="h-3 rounded bg-brand-500" style={{ width: `${(f.properties / max) * 100}%`, minWidth: f.properties ? 6 : 0 }} />
                          <span className="tabular-nums text-slate-500">{f.properties}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Scrape → enrichment"
                    subtitle={`Dikelompokkan per ${m.level === "country" ? "negara" : m.level === "city" ? "kota" : "area"} — ikut sedalam apa Anda menyaring.`}
                    icon={Radar}
                  />
                  <ul className="divide-y divide-slate-100">
                    {m.scrape.map((s) => (
                      <li key={s.key} className="flex flex-wrap items-center gap-x-3 px-5 py-2 text-[12px]">
                        <span className="min-w-[150px] font-medium text-slate-800">{s.label}</span>
                        <span className="text-slate-600">
                          {s.enriched}/{s.scraped} diperkaya
                          {s.enriched < s.scraped && (
                            <span className="text-amber-700"> · {s.scraped - s.enriched} menunggu</span>
                          )}
                        </span>
                        <span className="flex-1" />
                        <span className="text-slate-500">{s.converted} jadi properti</span>
                        {/* More than one currency in a group means no average
                            is offered: a mean across dollars and rupiah is not
                            a number (D187). */}
                        <span className={cn("text-[11px]", s.currencies.length > 1 ? "text-amber-700" : "text-slate-400")}>
                          {s.currencies.join(" · ") || "—"}
                        </span>
                      </li>
                    ))}
                    {m.scrape.length === 0 && (
                      <li className="px-5 py-4 text-[13px] text-slate-500">Belum ada hasil scrape.</li>
                    )}
                  </ul>
                </Card>
              </div>
            </div>
          </>
        )}
      </Loaded>

      <Loaded state={properties} onRetry={reloadProps}>
        {(all) => {
          const shown = all.filter((p) => !scope || p.market_code === scope || p.market_code.startsWith(`${scope}-`));
          return (
            <Card className="mt-4">
              <CardHeader
                title={`${shown.length} properti`}
                subtitle="Yang lewat tenggat dulu, lalu skor tertinggi. Klik untuk agennya."
                icon={Target}
              />
              <Paged rows={shown} pageSize={12} unit="properti">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((p) => <Row key={p.id} property={p} onOpen={() => setOpen(p.ref)} />)}
                  </ul>
                )}
              </Paged>
            </Card>
          );
        }}
      </Loaded>

      {open && (
        <PropertyDrawer
          propertyRef={open}
          mayEdit={mayEdit}
          onClose={() => setOpen(null)}
          onChanged={reloadAll}
        />
      )}
    </div>
  );
}

/** What time it is where the agent is. The only question a list of names
 *  cannot answer, and the one that decides whether to ring now (D187). */
function localTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit",
    }).format(new Date()) + " di sana";
  } catch {
    return "";
  }
}

function Row({ property: p, onOpen }: { property: PropertyView; onOpen: () => void }) {
  const flagged = p.agents.some((a) => a.move_on);
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50">
        <span className="min-w-[200px] flex-1">
          <span className="block text-[13px] font-medium text-slate-800">{p.name}</span>
          <span className="block font-mono text-[10px] text-slate-400">
            {p.ref} · {p.market.label} · {p.rooms ?? "?"} kamar · ADR{" "}
            {/* The currency belongs to the market, never assumed — 106 is not
                a number until you know what it is in (D187). */}
            {p.adr ? `${p.market.currency} ${formatNumber(p.adr)}` : "?"}
          </span>
        </span>
        <Badge tone={p.score >= 4 ? "green" : p.score === 3 ? "amber" : "slate"}>
          {p.score ? `skor ${p.score}` : "belum diskor"}
        </Badge>
        {!p.status.startsWith("QUALIFIED") ? (
          <Badge tone="red">{p.status.toLowerCase()}</Badge>
        ) : !p.validated ? (
          <Badge tone="amber">belum divalidasi</Badge>
        ) : null}
        <Badge tone={p.best_stage === "DEAL" ? "green" : "brand"}>{STAGE_LABEL[p.best_stage]}</Badge>
        <span className="text-[12px] text-slate-500">
          {p.agents.length} agen
          {p.next_agent && ` · sekarang ${p.next_agent.name}`}
        </span>
        {flagged && <span className="text-[11px] font-medium text-rose-700">lewat 7 hari</span>}
        {p.exhausted && <span className="text-[11px] text-slate-500">semua agen habis</span>}
      </button>
    </li>
  );
}
