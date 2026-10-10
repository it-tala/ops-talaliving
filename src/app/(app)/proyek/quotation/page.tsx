"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileSignature, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, quotation } from "@/demo/api";
import { QUOTATION_STATUSES, type QuotationStatus } from "@/services/quotation/contracts";
import { CLOSED_PROJECT_STATUSES } from "@/services/procurement/contracts";
import { SalesSummaryStrip } from "@/components/crm/sales-summary";
import { useCanSell } from "@/lib/sell";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Every quotation, newest first (0133).
 *
 *  A quotation belongs to a project and is priced from the released BOM of
 *  each item: ongkos produksi, plus marketing and overhead, divided by what is
 *  left after the margin. `?project=CODE` opens the "new" form for that
 *  project — it is where the order drawer sends you.
 */
export default function QuotationsPage() {
  const tr = useTr();
  const canSell = useCanSell();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [rows, reload] = useLoad(() => quotation.listQuotations(), []);
  const [projects] = useLoad(() => procurement.listProjectViews(), []);
  const [status, setStatus] = useState<QuotationStatus | "CURRENT" | "ALL">("CURRENT");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = params.get("project");
    if (p) { setProject(p); setCreating(true); }
  }, [params]);

  async function create() {
    setBusy(true);
    const res = await quotation.saveQuotation(
      { project_code: project, marketing_pct: 0, overhead_pct: 0, margin_pct: 0, vat: false },
      `qt:${project}:${Date.now()}`,
    );
    setBusy(false);
    if (res.error) {
      const open = (res.error.detail as { quote_no?: string } | undefined)?.quote_no;
      if (res.error.code === "draft_exists" && open) {
        toast("info", tr("A draft already exists", "Sudah ada draft"), tr(`Opening ${open}.`, `Membuka ${open}.`));
        router.push(`/proyek/quotation/${encodeURIComponent(open)}`);
        return;
      }
      toast(res.error.status === 403 ? "critical" : "warning", tr("Quotation not created", "Quotation tidak dibuat"), res.error.message);
      return;
    }
    router.push(`/proyek/quotation/${encodeURIComponent(res.data.quote_no)}`);
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Projects", "Proyek")}
        title={tr("Quotations", "Quotation")}
        description={tr("Price offers to clients. Production cost from the released BOM, plus marketing and overhead, then margin — that makes the selling price. Fill in items, quantities and the production estimate.", "Penawaran harga ke klien. Ongkos produksi dari BOM yang sudah dirilis, ditambah marketing dan overhead, lalu margin — jadilah harga jual. Isi item, jumlah, dan estimasi produksi.")}
        actions={canSell("create") ? (
          <Button icon={Plus} onClick={() => setCreating((v) => !v)}>{tr("New quotation", "Quotation baru")}</Button>
        ) : undefined}
      />

      {creating && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-2 px-4 py-3">
            <label className="block min-w-[320px] flex-1 text-xs text-slate-500">{tr("For project", "Untuk proyek")}
              <select
                value={project} onChange={(e) => setProject(e.target.value)} aria-label={tr("Project", "Proyek")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">{tr("— choose a project —", "— pilih proyek —")}</option>
                {(projects.status === "ready" ? projects.data : [])
                  .filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status ?? "INQUIRY"))
                  .map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} · {p.code}{p.client_display ? ` · ${p.client_display}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <Button disabled={busy || !project} onClick={create}>{tr("Create draft", "Buat draft")}</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>{tr("Cancel", "Batal")}</Button>
            <p className="w-full text-[11px] text-slate-500">
              {tr("One draft per project. No project yet? Create it first on the Projects & orders page.", "Satu proyek satu draft. Belum ada proyeknya? Buat dulu di halaman Proyek & pesanan.")}
            </p>
          </div>
        </Card>
      )}

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const shown = all
            .filter((x) => status === "ALL" ? true : status === "CURRENT" ? x.is_current : x.status === status)
            .filter((x) => `${x.quote_no} ${x.project_code} ${x.project_name} ${x.client_name ?? ""}`
              .toLowerCase().includes(q.toLowerCase()));
          return (
            <>
            <SalesSummaryStrip rows={all} />
            <Card>
              <CardHeader
                title={tr(`${shown.length} quotations`, `${shown.length} quotation`)}
                subtitle={tr("Click to open, price and send to the client.", "Klik untuk membuka, menghitung harga, dan mengirim ke klien.")}
                icon={FileSignature}
                action={<SourceBadge state={rows} />}
              />
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
                {([
                  ["CURRENT", tr("Ongoing", "Berjalan"), all.filter((x) => x.is_current).length],
                  ...QUOTATION_STATUSES.map((s) => [s.code, s.label, all.filter((x) => x.status === s.code).length] as const),
                  ["ALL", tr("All", "Semua"), all.length],
                ] as [QuotationStatus | "CURRENT" | "ALL", string, number][]).map(([k, label, n]) => (
                  <button
                    key={k} onClick={() => setStatus(k)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[12px] font-medium",
                      status === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {label} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
                <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-lg border border-slate-200 px-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search number, project, client…", "Cari nomor, proyek, klien…")}
                    aria-label={tr("Search quotations", "Cari quotation")} className="h-8 w-full text-sm focus:outline-none"
                  />
                </label>
              </div>
              <Paged rows={shown} pageSize={20} unit={tr("quotations", "quotation")}>
                {(page) => (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">{tr("Quotation", "Quotation")}</th>
                          <th className="px-4 py-2 text-left">{tr("Project & client", "Proyek & klien")}</th>
                          <th className="px-4 py-2 text-left">{tr("Status", "Status")}</th>
                          <th className="px-4 py-2 text-right">{tr("Items", "Item")}</th>
                          <th className="px-4 py-2 text-left">{tr("Valid until", "Berlaku s/d")}</th>
                          <th className="px-4 py-2 text-right">{tr("Total", "Total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.map((x) => {
                          const st = QUOTATION_STATUSES.find((s) => s.code === x.status)!;
                          return (
                            <tr
                              key={x.id}
                              onClick={() => router.push(`/proyek/quotation/${encodeURIComponent(x.quote_no)}`)}
                              className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", !x.is_current && "opacity-70")}
                            >
                              <td className="px-4 py-2">
                                <span className="block font-mono text-[12px] font-medium text-slate-800">{x.quote_no}</span>
                                <span className="block text-[11px] text-slate-400">Rev {x.rev}</span>
                              </td>
                              <td className="px-4 py-2">
                                <span className="block text-slate-800">{x.project_name}</span>
                                <span className="block text-[11px] text-slate-500">
                                  {x.project_code}{x.client_name && ` · ${x.client_name}`}
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                <Badge tone={st.tone}>{st.label}</Badge>
                                {x.expired && <span className="ml-1 text-[11px] text-rose-700">{tr("expired", "kedaluwarsa")}</span>}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {x.line_count || <span className="text-slate-300">—</span>}
                                {x.lines_without_cost > 0 && x.status === "DRAFT" && (
                                  <span className="block text-[11px] text-amber-700">{tr(`${x.lines_without_cost} without cost`, `${x.lines_without_cost} tanpa ongkos`)}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-slate-600">{x.valid_until ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                                {x.grand_total == null ? <span className="text-slate-300">—</span> : formatMoney(x.grand_total, x.currency)}
                                {x.vat && <span className="block text-[11px] text-slate-400">{tr("incl. VAT (PPN)", "termasuk PPN")}</span>}
                              </td>
                            </tr>
                          );
                        })}
                        {shown.length === 0 && (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            {tr("No quotations here yet. Create one from a project — its items' BOMs must be released for the cost to be read.", "Belum ada quotation di sini. Buat dari proyek — BOM item-nya perlu sudah dirilis agar ongkosnya terbaca.")}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paged>
            </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
