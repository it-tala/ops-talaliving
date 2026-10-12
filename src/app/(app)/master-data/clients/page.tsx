"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Phone, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { crm, procurement } from "@/demo/api";
import type { ClientView } from "@/services/procurement/contracts";
import { ClientDrawer } from "./ClientDrawer";
import { useCanSell } from "@/lib/sell";
import { useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** The client master (0111).
 *
 *  A client used to be a sentence typed on each project, which is how one
 *  hotel group becomes three spellings and its order history three lists. So
 *  it is master data: one live row per name, a code the database mints, and
 *  who to call. A project picks its client from here.
 */
export default function ClientsPage() {
  const tr = useTr();
  const canSell = useCanSell();
  const [showArchived, setShowArchived] = useState(false);
  const [clients, reload] = useLoad(() => procurement.listClients({ include_archived: showArchived }), [showArchived]);
  const [followUps] = useLoad(() => crm.listActivities({ open_follow_ups: true }), []);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ClientView | "new" | null>(null);
  const mayCreate = canSell("create");
  const fu = followUps.status === "ready" ? followUps.data : [];
  const due = (code: string) => fu.filter((a) => a.client_code === code).length;
  const late = (code: string) => fu.filter((a) => a.client_code === code && a.follow_up_state === "overdue").length;

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Clients", "Klien")}
        description={tr("Who orders: one row per client, with their contact. A project picks its client from this list.", "Siapa yang memesan: satu baris per klien, dengan kontaknya. Proyek memilih kliennya dari daftar ini.")}
        actions={mayCreate ? <Button icon={Plus} onClick={() => setOpen("new")}>{tr("New client", "Klien baru")}</Button> : undefined}
      />
      <Card>
        <CardHeader
          title={tr("Client list", "Daftar klien")} icon={Building2}
          subtitle={tr("Click to open a client: projects, quotations, communication log and follow-ups.", "Klik untuk membuka klien: proyek, quotation, catatan komunikasi, dan follow-up.")}
          action={<SourceBadge state={clients} />}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name, code, contact…", "Cari nama, kode, kontak…")}
              aria-label={tr("Search clients", "Cari klien")} className="h-8 w-full text-sm focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {tr("show archived", "tampilkan yang diarsipkan")}
          </label>
        </div>
        <Loaded state={clients} onRetry={reload}>
          {(all) => {
            const rows = all.filter((c) =>
              `${c.code} ${c.name} ${c.contact_name ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(q.toLowerCase()));
            return (
              <Paged rows={rows} pageSize={25} unit={tr("clients", "klien")}>
                {(shown, _offset, showAll) => (
                  <div className="overflow-x-auto">
                    <ExcelTable showAll={showAll} className="w-full min-w-[640px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">{tr("Client", "Klien")}</th>
                          <th className="px-4 py-2 text-left">{tr("Contact", "Kontak")}</th>
                          <th className="px-4 py-2 text-right">{tr("Projects", "Proyek")}</th>
                          <th className="px-4 py-2 text-right">{tr("Follow-up", "Follow-up")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((c) => (
                          <tr key={c.id} onClick={() => router.push(`/master-data/clients/${encodeURIComponent(c.code)}`)}
                            className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2">
                              <span className="block font-medium text-slate-800">
                                {c.name}
                                {c.archived_at && <Badge tone="slate" className="ml-2">{tr("archived", "diarsipkan")}</Badge>}
                              </span>
                              <span className="block font-mono text-[10px] text-slate-400">{c.code}</span>
                            </td>
                            <td className="px-4 py-2 text-slate-600">
                              {c.contact_name ?? <span className="text-slate-300">—</span>}
                              {c.phone && (
                                <span className="block text-[11px] text-slate-400">
                                  <Phone className="mr-1 inline h-3 w-3" />{c.phone}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                              {c.project_count}
                              {c.active_project_count > 0 && (
                                <span className="block text-[11px] text-slate-400">{tr(`${c.active_project_count} running`, `${c.active_project_count} berjalan`)}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-[12px]">
                              <FollowUpCount n={due(c.code)} late={late(c.code)} />
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                            {all.length === 0 ? tr("No clients yet.", "Belum ada klien.") : tr("Nothing matches.", "Tidak ada yang cocok.")}
                          </td></tr>
                        )}
                      </tbody>
                    </ExcelTable>
                  </div>
                )}
              </Paged>
            );
          }}
        </Loaded>
      </Card>

      {open && (
        <ClientDrawer
          client={open === "new" ? null : open}
          onClose={() => setOpen(null)}
          onSaved={() => { reload(); setOpen(null); }}
        />
      )}
    </div>
  );
}

function FollowUpCount({ n, late }: { n: number; late: number }) {
  const tr = useTr();
  if (n === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className={late > 0 ? "font-medium text-rose-700" : "text-slate-700"}>
      {tr(`${n} open`, `${n} terbuka`)}{late > 0 && <span className="block text-[11px]">{tr(`${late} overdue`, `${late} terlambat`)}</span>}
    </span>
  );
}
