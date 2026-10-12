"use client";

import { useState } from "react";
import { Factory, FolderKanban, UserCheck } from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { procurement } from "@/demo/api";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** Projects › Evaluation (0266, O9, kajian F255 §5.9).
 *
 *  Three boards, nothing typed: every number is read from what the agent flow
 *  already records — factory orders, containers, QC reports and findings, the
 *  client's decisions, the logged moves of each project. A board answers only
 *  what its reader may see: prices for procurement and leadership, QC for
 *  those who see every assignment, durations for whoever reads projects. */

type Tab = "factories" | "qc" | "projects";
const th = "px-3 py-2 text-left font-medium";
const thr = "px-3 py-2 text-right font-medium";
const td = "px-3 py-2";
const tdr = "px-3 py-2 text-right tabular-nums";
const dash = <span className="text-slate-300">—</span>;
const n = (v: number | null | undefined, suffix = "") => (v == null ? dash : <>{formatNumber(v)}{suffix}</>);

export default function EvaluationPage() {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("factories");
  const tabs: { key: Tab; en: string; id: string }[] = [
    { key: "factories", en: "Partner factories", id: "Pabrik mitra" },
    { key: "qc", en: "QC people", id: "Personel QC" },
    { key: "projects", en: "Projects", id: "Proyek" },
  ];
  return (
    <div>
      <PageHeader
        breadcrumb={tr("Projects", "Proyek")}
        title={tr("Evaluation", "Evaluasi")}
        description={tr(
          "Factories, QC people and projects, read from what is already recorded — orders, containers, QC reports and findings, the client's decisions. Nothing here is typed.",
          "Pabrik, personel QC, dan proyek, dibaca dari yang sudah tercatat — order, kontainer, laporan dan temuan QC, keputusan klien. Tidak ada yang diketik di sini.")}
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((t) => (
          <Button key={t.key} size="sm" role="tab" aria-selected={tab === t.key}
            variant={tab === t.key ? "primary" : "outline"} onClick={() => setTab(t.key)}>
            {tr(t.en, t.id)}
          </Button>
        ))}
      </div>
      {tab === "factories" && <Factories />}
      {tab === "qc" && <QcPeople />}
      {tab === "projects" && <Projects />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-[13px] text-slate-500">{text}</p>;
}

function Factories() {
  const tr = useTr();
  const thisYear = Number(officeToday().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [state, reload] = useLoad(() => procurement.evalFactories({ year }), [year]);
  return (
    <Card>
      <CardHeader
        title={tr("Partner factories", "Pabrik mitra")}
        subtitle={tr("Price ordered against the factory's own quote, shipped against its promise, findings before shipping against claims after.",
          "Harga order dibanding penawaran pabrik itu sendiri, kirim dibanding janjinya, temuan sebelum kirim dibanding klaim setelah sampai.")}
        icon={Factory}
        action={(
          <div className="flex items-center gap-2">
            <SourceBadge state={state} />
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={tr("Year", "Tahun")}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px]">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      />
      <Loaded state={state} onRetry={reload}>
        {(rows) => rows.length === 0 ? (
          <Empty text={tr("Nothing to show — no factory orders yet, or prices are not yours to see (procurement and leadership).",
            "Belum ada yang bisa ditampilkan — belum ada order pabrik, atau harga bukan untuk akses Anda (procurement dan pimpinan).")} />
        ) : (
          <div className="overflow-x-auto">
            <ExcelTable className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className={th}>{tr("Factory", "Pabrik")}</th>
                  <th className={thr}>{tr(`Orders ${year}`, `Order ${year}`)}</th>
                  <th className={thr}>{tr("Ordered vs quoted", "Order vs penawaran")}</th>
                  <th className={thr}>{tr("On time", "Tepat waktu")}</th>
                  <th className={thr}>{tr("Avg. late", "Rata-rata telat")}</th>
                  <th className={thr}>{tr("Containers", "Kontainer")}</th>
                  <th className={thr}>{tr("Findings / container", "Temuan / kontainer")}</th>
                  <th className={thr}>{tr("Client claims", "Klaim klien")}</th>
                  <th className={thr}>{tr("Accepted · rejected", "Diterima · ditolak")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vendor_code} className="border-b border-slate-100 last:border-0">
                    <td className={td}>
                      <span className="text-slate-800">{r.vendor_name}</span>
                      <span className="block font-mono text-[11px] text-slate-400">{r.vendor_code} · {tr(`${r.orders} order(s) in all`, `${r.orders} order seluruhnya`)}</span>
                    </td>
                    <td className={tdr}>{formatNumber(r.orders_in_year)}</td>
                    <td className={cn(tdr, r.price_diff_pct != null && r.price_diff_pct > 0 && "text-amber-700")}>
                      {r.price_diff_pct == null ? dash : <>{r.price_diff_pct > 0 ? "+" : ""}{formatNumber(r.price_diff_pct)}%</>}
                      {r.priced_lines > 0 && <span className="block text-[11px] text-slate-400">{tr(`${r.priced_lines} line(s)`, `${r.priced_lines} baris`)}</span>}
                    </td>
                    <td className={tdr}>{r.promised_shipped ? `${r.shipped_on_time}/${r.promised_shipped}` : dash}</td>
                    <td className={cn(tdr, r.avg_days_late != null && "text-rose-700")}>{n(r.avg_days_late, tr(" d", " hr"))}</td>
                    <td className={tdr}>{formatNumber(r.containers)}</td>
                    <td className={tdr}>
                      {n(r.findings_per_container)}
                      {r.findings_before > 0 && <span className="block text-[11px] text-slate-400">{tr(`${r.findings_before} · ${r.findings_serious} serious`, `${r.findings_before} · ${r.findings_serious} serius`)}</span>}
                    </td>
                    <td className={cn(tdr, r.claims > 0 && "text-rose-700")}>{formatNumber(r.claims)}</td>
                    <td className={tdr}>{r.orders_accepted} · <span className={cn(r.orders_rejected > 0 && "text-rose-700")}>{r.orders_rejected}</span></td>
                  </tr>
                ))}
              </tbody>
            </ExcelTable>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function QcPeople() {
  const tr = useTr();
  const [state, reload] = useLoad(() => procurement.evalQcPeople(), []);
  return (
    <Card>
      <CardHeader
        title={tr("QC people", "Personel QC")}
        subtitle={tr("Days with a report out of days on the job, containers out while they watched, findings they raised, and claims that still reached the client.",
          "Hari dengan laporan dibanding hari bertugas, kontainer keluar selama dipantau, temuan yang dicatat, dan klaim yang tetap sampai ke klien.")}
        icon={UserCheck}
        action={<SourceBadge state={state} />}
      />
      <Loaded state={state} onRetry={reload}>
        {(rows) => rows.length === 0 ? (
          <Empty text={tr("Nothing to show — no QC team yet, or the QC board is for the coordinator, leadership and procurement.",
            "Belum ada yang bisa ditampilkan — belum ada tim QC, atau papan QC untuk koordinator, pimpinan, dan procurement.")} />
        ) : (
          <div className="overflow-x-auto">
            <ExcelTable className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className={th}>{tr("Person", "Personel")}</th>
                  <th className={thr}>{tr("Assignments", "Penugasan")}</th>
                  <th className={thr}>{tr("Days reported", "Hari lapor")}</th>
                  <th className={thr}>{tr("Last report", "Laporan terakhir")}</th>
                  <th className={thr}>{tr("Containers watched", "Kontainer dipantau")}</th>
                  <th className={thr}>{tr("Findings raised", "Temuan dicatat")}</th>
                  <th className={thr}>{tr("Claims that got through", "Klaim yang lolos")}</th>
                  <th className={thr}>{tr("Accepted · rejected", "Diterima · ditolak")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person_code} className={cn("border-b border-slate-100 last:border-0", !r.is_active && "text-slate-400")}>
                    <td className={td}>
                      <span className={cn(r.is_active ? "text-slate-800" : "text-slate-400")}>{r.person_name}</span>
                      <span className="block font-mono text-[11px] text-slate-400">{r.person_code}{!r.is_active && ` · ${tr("switched off", "nonaktif")}`}</span>
                    </td>
                    <td className={tdr}>{r.assignments}<span className="block text-[11px] text-slate-400">{tr(`${r.orders} order(s)`, `${r.orders} order`)}</span></td>
                    <td className={cn(tdr, r.report_rate != null && r.report_rate < 50 && "text-amber-700")}>
                      {r.active_days ? `${r.report_days}/${r.active_days}` : dash}
                      {r.report_rate != null && <span className="block text-[11px] text-slate-400">{r.report_rate}%</span>}
                    </td>
                    <td className={tdr}>{r.last_report_on ?? dash}</td>
                    <td className={tdr}>{formatNumber(r.containers_while_watching)}</td>
                    <td className={tdr}>{r.findings_raised}{r.findings_serious > 0 && <span className="block text-[11px] text-slate-400">{tr(`${r.findings_serious} serious`, `${r.findings_serious} serius`)}</span>}</td>
                    <td className={cn(tdr, r.claims_on_orders > 0 && "text-rose-700")}>{formatNumber(r.claims_on_orders)}</td>
                    <td className={tdr}>{r.orders_accepted} · <span className={cn(r.orders_rejected > 0 && "text-rose-700")}>{r.orders_rejected}</span></td>
                  </tr>
                ))}
              </tbody>
            </ExcelTable>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function Projects() {
  const tr = useTr();
  const [state, reload] = useLoad(() => procurement.evalProjects(), []);
  const days = (v: number | null) => (v == null ? dash : tr(`${v} d`, `${v} hr`));
  return (
    <Card>
      <CardHeader
        title={tr("Projects", "Proyek")}
        subtitle={tr("How long each stage took, from the logged moves and the deliveries — a stage not reached yet stays empty, never guessed.",
          "Lama setiap tahap, dari perpindahan status yang tercatat dan pengiriman — tahap yang belum dicapai dibiarkan kosong, tidak ditebak.")}
        icon={FolderKanban}
        action={<SourceBadge state={state} />}
      />
      <Loaded state={state} onRetry={reload}>
        {(rows) => rows.length === 0 ? (
          <Empty text={tr("No projects to show.", "Belum ada proyek untuk ditampilkan.")} />
        ) : (
          <div className="overflow-x-auto">
            <ExcelTable className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className={th}>{tr("Project", "Proyek")}</th>
                  <th className={thr}>{tr("Inquiry → deal", "Inquiry → deal")}</th>
                  <th className={thr}>{tr("Deal → production", "Deal → produksi")}</th>
                  <th className={thr}>{tr("Production → shipped", "Produksi → kirim")}</th>
                  <th className={thr}>{tr("Shipped → arrived", "Kirim → sampai")}</th>
                  <th className={thr}>{tr("Factory orders", "Order pabrik")}</th>
                  <th className={thr}>{tr("Accepted · rejected", "Diterima · ditolak")}</th>
                  <th className={thr}>{tr("Client claims", "Klaim klien")}</th>
                  <th className={thr}>{tr("Deal value · margin", "Nilai deal · margin")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.project_code} className="border-b border-slate-100 last:border-0">
                    <td className={td}>
                      <span className="text-slate-800">{r.project_code} · {r.project_name}</span>
                      <span className="block text-[11px] text-slate-400">{[r.client_name, r.status].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className={tdr}>{days(r.days_to_deal)}</td>
                    <td className={tdr}>{days(r.days_to_production)}</td>
                    <td className={tdr}>{days(r.days_to_ship)}</td>
                    <td className={tdr}>{days(r.days_to_arrive)}</td>
                    <td className={tdr}>{r.factory_orders || dash}</td>
                    <td className={tdr}>{r.factory_orders ? <>{r.orders_accepted} · <span className={cn(r.orders_rejected > 0 && "text-rose-700")}>{r.orders_rejected}</span></> : dash}</td>
                    <td className={cn(tdr, r.claims > 0 && "text-rose-700")}>{r.factory_orders ? formatNumber(r.claims) : dash}</td>
                    <td className={tdr}>
                      {r.deal_value == null ? dash : <>{r.deal_currency === "USD" ? "US$ " : "Rp "}{formatNumber(r.deal_value)}</>}
                      {r.margin_pct != null && <span className="block text-[11px] text-slate-500">{tr(`margin ${formatNumber(r.margin_pct)}%`, `margin ${formatNumber(r.margin_pct)}%`)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ExcelTable>
          </div>
        )}
      </Loaded>
    </Card>
  );
}
