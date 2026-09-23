"use client";

import { useState } from "react";
import { FolderKanban, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import { PROJECT_STATUSES, type ProjectStatus } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { ProjectDrawer } from "./ProjectDrawer";

/** The customer's orders (0111).
 *
 *  A project is the dimension everything else hangs on — procurement buys
 *  **for** it, production makes **for** it, the ledger spends **on** it. This
 *  screen is where it starts: who the client is, where the order stands, what
 *  they ordered and when it ships. The order's lines are where item codes are
 *  born, and a BOM is written per item code.
 *
 *  The code is the part that must never move: it is written on request lines,
 *  work orders and ledger rows, all of which reference it as text at the seam.
 */
export default function ProjectsPage() {
  const { can } = useSession();
  const [projects, reload] = useLoad(() => procurement.listProjectViews(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<ProjectStatus | "OPEN" | "ALL">("OPEN");
  const [q, setQ] = useState("");

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Proyek & pesanan"
        description="Siapa kliennya, di mana statusnya, apa saja yang dipesan dan kapan dikirim. Tiap item pesanan bisa dijadikan item code untuk disusun BOM-nya."
        actions={can("project.create") ? (
          <Button icon={Plus} onClick={() => { setCreating(true); setOpen(null); }}>Proyek baru</Button>
        ) : undefined}
      />

      <Loaded state={projects} onRetry={reload}>
        {(all) => {
          const statusOf = (p: (typeof all)[number]) => p.status ?? (p.is_active ? "IN_PRODUCTION" : "DONE");
          const count = (s: ProjectStatus) => all.filter((p) => statusOf(p) === s).length;
          const rows = all
            .filter((p) => status === "ALL" ? true
              : status === "OPEN" ? !["DONE", "CANCELLED"].includes(statusOf(p))
                : statusOf(p) === status)
            .filter((p) => `${p.code} ${p.name} ${p.client_display ?? ""} ${p.location ?? ""}`
              .toLowerCase().includes(q.toLowerCase()));

          return (
            <Card>
              <CardHeader
                title={`${rows.length} proyek`}
                subtitle="Klik untuk membuka pesanan, mengubah status, dan menambah item."
                icon={FolderKanban}
                action={<SourceBadge state={projects} />}
              />
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
                {([
                  ["OPEN", "Berjalan", all.filter((p) => !["DONE", "CANCELLED"].includes(statusOf(p))).length],
                  ...PROJECT_STATUSES.map((s) => [s.code, s.label, count(s.code)] as const),
                  ["ALL", "Semua", all.length],
                ] as [ProjectStatus | "OPEN" | "ALL", string, number][]).map(([k, label, n]) => (
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
                    value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, nama, klien…"
                    aria-label="Cari proyek" className="h-8 w-full text-sm focus:outline-none"
                  />
                </label>
              </div>
              <Paged rows={rows} pageSize={20} unit="proyek">
                {(shown) => (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">Proyek</th>
                          <th className="px-4 py-2 text-left">Klien</th>
                          <th className="px-4 py-2 text-left">Status</th>
                          <th className="px-4 py-2 text-right">Item</th>
                          <th className="px-4 py-2 text-left">Kirim</th>
                          <th className="px-4 py-2 text-right">Nilai</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p) => {
                          const st = PROJECT_STATUSES.find((s) => s.code === statusOf(p))!;
                          const value = p.order_value ?? p.contract_value;
                          return (
                            <tr
                              key={p.id}
                              onClick={() => { setOpen(p.code); setCreating(false); }}
                              className={cn(
                                "cursor-pointer border-b border-slate-100 hover:bg-slate-50",
                                !p.is_active && "opacity-60",
                              )}
                            >
                              <td className="px-4 py-2">
                                <span className="block font-medium text-slate-800">{p.name}</span>
                                <span className="block font-mono text-[10px] text-slate-400">
                                  {p.code}{p.location && ` · ${p.location}`}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-slate-600">
                                {p.client_display ?? <span className="text-slate-400">internal</span>}
                              </td>
                              <td className="px-4 py-2"><Badge tone={st.tone}>{st.label}</Badge></td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {p.line_count || <span className="text-slate-300">—</span>}
                                {p.lines_without_item_code > 0 && (
                                  <span className="block text-[11px] text-amber-700">{p.lines_without_item_code} tanpa item code</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-slate-600">{p.next_delivery ?? p.target_date ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                                {value == null ? <span className="text-slate-300">—</span> : formatIDR(value)}
                                {p.order_value == null && p.contract_value != null && (
                                  <span className="block text-[11px] text-slate-400">nilai kontrak</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {rows.length === 0 && (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Tidak ada proyek di sini.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paged>
              <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
                Nilai = jumlah item × harga jual per unit; bila item belum berharga, nilai kontrak yang
                disepakati. Bukan faktur. Belanja terhadap proyek dibaca dari ledger, di halaman likuidasi.
              </p>
            </Card>
          );
        }}
      </Loaded>

      {(open || creating) && (
        <ProjectDrawer
          code={open}
          onClose={() => { setOpen(null); setCreating(false); }}
          onChanged={reload}
        />
      )}
    </div>
  );
}
