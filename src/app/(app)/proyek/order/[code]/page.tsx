"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Tabs } from "@/components/ui/tabs";
import { ActivityLog } from "@/components/crm/activity-log";
import { SaleFiles, type FileTarget } from "@/components/files/sale-files";
import { procurement, quotation } from "@/demo/api";
import { useCanSell } from "@/lib/sell";
import { useTr } from "@/lib/i18n";
import { ProjectOverview } from "../ProjectDrawer";

/** One project, from the client's first question to the handover (P1).
 *
 *  The drawer on `/proyek/order` stays the quick look. This page is where a
 *  sale's record grows: the order as before, **every file of the sale** —
 *  the client's brief, drawings and references, our moodboards and renders,
 *  the proposal, the signed contract — each saying who made it, and the
 *  contact log. P2 adds the pipeline, P4 the design items, P7 the timeline.
 */
export default function ProjectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = decodeURIComponent(raw);
  const tr = useTr();
  const canSell = useCanSell();
  const [project, reloadProject] = useLoad(() => procurement.getProject(code), [code]);
  const [quotes] = useLoad(() => quotation.listQuotations({ project_code: code }), [code]);

  return (
    <div>
      <Link href="/proyek/order" className="mb-3 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All projects", "Semua proyek")}
      </Link>
      <Loaded state={project} onRetry={reloadProject}>
        {(p) => {
          const targets: FileTarget[] = [
            { entity: "project", entity_no: p.code, label: tr(`Project ${p.code}`, `Proyek ${p.code}`) },
            ...(quotes.status === "ready" ? quotes.data : []).map((q) => ({
              entity: "quotation" as const, entity_no: q.quote_no,
              label: `Quotation ${q.quote_no} · rev ${q.rev}`,
            })),
            ...(p.client_code ? [{
              entity: "client" as const, entity_no: p.client_code,
              label: tr(`Client ${p.client_display ?? p.client_code} (all projects)`, `Klien ${p.client_display ?? p.client_code} (semua proyek)`),
            }] : []),
          ];
          return (
            <>
              <PageHeader
                breadcrumb={tr(`Projects › ${p.code}`, `Proyek › ${p.code}`)}
                title={`${p.code} · ${p.name}`}
                description={p.client_display ?? tr("Internal / stock — no client", "Internal / stok — tanpa klien")}
              />
              <Tabs
                defaultId="order"
                items={[
                  {
                    id: "order", label: tr("Order", "Pesanan"),
                    content: <ProjectOverview code={p.code} onChanged={reloadProject} />,
                  },
                  {
                    id: "files", label: tr("Files", "File"),
                    content: (
                      <div className="space-y-2">
                        <SaleFiles targets={targets} canEdit={canSell()} />
                        <p className="text-[11px] text-slate-500">
                          {tr(
                            "Files from the project, its quotations and the client, together. Each goes to the folder the database names for its kind and record — the client's drawings and our renders to DRAFTING, the brief, proposal, notes and contract to PROJECT MANAGER — under the client and project.",
                            "File dari proyek, quotation-nya, dan kliennya, sekaligus. Tiap file masuk ke folder yang ditentukan database menurut jenis dan catatannya — gambar klien dan render kita ke DRAFTING, brief, proposal, notulen, dan kontrak ke PROJECT MANAGER — di bawah folder klien dan proyek.",
                          )}
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: "contact", label: tr("Contact log", "Log kontak"),
                    content: p.client_code ? (
                      <ActivityLog
                        title={tr("Calls, messages, meetings and visits", "Telepon, pesan, meeting, dan kunjungan")}
                        filter={{ project_code: p.code }}
                        fixed={{ client_code: p.client_code, project_code: p.code }}
                      />
                    ) : (
                      <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
                        {tr("This project has no client in the client list, so there is nobody to log a contact against. Pick a client on the Order tab first.",
                          "Proyek ini belum punya klien dari daftar klien, jadi belum ada yang bisa dicatat kontaknya. Pilih klien dulu di tab Pesanan.")}
                      </p>
                    ),
                  },
                ]}
              />
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
