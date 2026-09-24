"use client";

import { BellRing } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { ActivityRow } from "@/components/crm/activity-log";
import { crm } from "@/demo/api";
import type { ClientActivityView, FollowUpState } from "@/services/crm/contracts";
import { useSession } from "@/store/session";

/** Who to contact, and when (0134).
 *
 *  Every open follow-up across every client, the late ones first. A quotation
 *  that nobody chases is a quotation the competitor answers; this is the list
 *  somebody opens in the morning.
 */
export default function FollowUpPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => crm.listActivities({ open_follow_ups: true }), []);

  const groups: { state: FollowUpState; title: string; empty: string }[] = [
    { state: "overdue", title: "Terlambat", empty: "Tidak ada yang terlambat." },
    { state: "today", title: "Hari ini", empty: "Tidak ada untuk hari ini." },
    { state: "upcoming", title: "Berikutnya", empty: "Belum ada yang terjadwal." },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Follow-up klien"
        description="Siapa yang harus dihubungi dan kapan. Catat follow-up dari halaman klien atau dari quotation; tutup di sini dengan hasilnya."
        actions={<SourceBadge state={rows} />}
      />
      <Loaded state={rows} onRetry={reload}>
        {(all) => (
          <div className="space-y-4">
            {groups.map((g) => {
              const list = all.filter((a: ClientActivityView) => a.follow_up_state === g.state);
              return (
                <Card key={g.state}>
                  <CardHeader title={`${g.title} · ${list.length}`} icon={BellRing} />
                  {list.length === 0 ? (
                    <p className="px-4 py-5 text-center text-[13px] text-slate-500">{g.empty}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {list.map((a) => (
                        <ActivityRow key={a.id} a={a} mayWrite={can("project.update")} onChanged={reload} showClient />
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Loaded>
    </div>
  );
}
