"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSignature, FolderKanban, Pencil } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { ActivityLog } from "@/components/crm/activity-log";
import { SalesSummaryStrip } from "@/components/crm/sales-summary";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, quotation } from "@/demo/api";
import { PROJECT_STATUSES, type ClientView } from "@/services/procurement/contracts";
import { QUOTATION_STATUSES } from "@/services/quotation/contracts";
import { useSession } from "@/store/session";
import { ClientDrawer } from "../ClientDrawer";

/** One client, whole: who they are, every project and quotation, what was said
 *  to them and what is due next (0134).
 *
 *  Read from the same rows the order and quotation screens read — the page
 *  owns nothing of its own but the log.
 */
export default function ClientPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = decodeURIComponent(raw);
  const { can } = useSession();
  const [clients, reloadClients] = useLoad(() => procurement.listClients({ include_archived: true }), []);
  const [projects] = useLoad(() => procurement.listProjectViews(), []);
  const [quotes, reloadQuotes] = useLoad(() => quotation.listQuotations(), []);
  const [editing, setEditing] = useState<ClientView | null>(null);

  return (
    <div>
      <Link href="/master-data/clients" className="mb-3 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Semua klien
      </Link>
      <Loaded state={clients} onRetry={reloadClients}>
        {(all) => {
          const c = all.find((x) => x.code === code);
          if (!c) return <p className="py-10 text-center text-slate-500">Tidak ada klien {code}.</p>;
          const mine = projects.status === "ready" ? projects.data.filter((p) => p.client_code === code) : [];
          const offers = quotes.status === "ready" ? quotes.data.filter((q) => q.client_code === code) : [];
          return (
            <>
              <PageHeader
                breadcrumb={`Klien · ${c.code}`}
                title={c.name}
                description={[c.contact_name, c.phone, c.email].filter(Boolean).join(" · ") || "Belum ada kontak."}
                actions={(
                  <div className="flex items-center gap-2">
                    <SourceBadge state={clients} />
                    {c.archived_at && <Badge tone="slate">Diarsipkan</Badge>}
                    {can("project.update") && <Button variant="outline" icon={Pencil} onClick={() => setEditing(c)}>Ubah kontak</Button>}
                  </div>
                )}
              />

              {(c.address || c.npwp || c.note) && (
                <Card className="mb-4">
                  <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-[13px]">
                    {c.address && <Fact k="Alamat" v={c.address} />}
                    {c.npwp && <Fact k="NPWP" v={c.npwp} />}
                    {c.note && <Fact k="Catatan" v={c.note} />}
                  </div>
                </Card>
              )}

              <SalesSummaryStrip rows={offers} />

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title={`${mine.length} proyek`} icon={FolderKanban}
                    subtitle={`${mine.filter((p) => p.is_active).length} berjalan`} />
                  <ul className="divide-y divide-slate-100 text-[13px]">
                    {mine.map((p) => {
                      const st = PROJECT_STATUSES.find((s) => s.code === p.status);
                      const value = p.order_value ?? p.contract_value;
                      return (
                        <li key={p.code} className="flex items-center gap-2 px-4 py-2">
                          <Link href={`/proyek/order?open=${encodeURIComponent(p.code)}`} className="min-w-0 flex-1 hover:underline">
                            <span className="block truncate font-medium text-slate-800">{p.name}</span>
                            <span className="block font-mono text-[10px] text-slate-400">{p.code}{p.location && ` · ${p.location}`}</span>
                          </Link>
                          {st && <Badge tone={st.tone}>{st.label}</Badge>}
                          <span className="w-32 text-right tabular-nums text-slate-700">{value == null ? "—" : formatIDR(value)}</span>
                        </li>
                      );
                    })}
                    {mine.length === 0 && <li className="px-4 py-6 text-center text-slate-500">Belum ada proyek.</li>}
                  </ul>
                </Card>

                <Card>
                  <CardHeader title={`${offers.length} quotation`} icon={FileSignature}
                    subtitle="Semua revisi, terbaru di atas" />
                  <ul className="divide-y divide-slate-100 text-[13px]">
                    {offers.map((q) => {
                      const st = QUOTATION_STATUSES.find((s) => s.code === q.status)!;
                      return (
                        <li key={q.quote_no} className={cn("flex items-center gap-2 px-4 py-2", !q.is_current && q.status !== "ACCEPTED" && "opacity-60")}>
                          <Link href={`/proyek/quotation/${encodeURIComponent(q.quote_no)}`} className="min-w-0 flex-1 hover:underline">
                            <span className="block font-mono text-[12px] text-slate-800">{q.quote_no} · Rev {q.rev}</span>
                            <span className="block truncate text-[11px] text-slate-500">{q.project_name}</span>
                          </Link>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <span className="w-32 text-right tabular-nums text-slate-700">{q.grand_total == null ? "—" : formatIDR(q.grand_total)}</span>
                        </li>
                      );
                    })}
                    {offers.length === 0 && <li className="px-4 py-6 text-center text-slate-500">Belum ada quotation.</li>}
                  </ul>
                </Card>
              </div>

              <div className="mt-4">
                <ActivityLog
                  filter={{ client_code: c.code }}
                  fixed={{ client_code: c.code }}
                  projects={mine.map((p) => ({ code: p.code, name: p.name }))}
                  onChanged={reloadQuotes}
                />
              </div>

              {editing && (
                <ClientDrawer client={editing} onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); reloadClients(); }} />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wide text-slate-400">{k}</span>
      <span className="whitespace-pre-line text-slate-800">{v}</span>
    </div>
  );
}
