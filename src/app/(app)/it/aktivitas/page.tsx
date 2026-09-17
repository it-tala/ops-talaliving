"use client";

import { useState } from "react";
import { Activity, Timer, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The activity log — what each person did, and for how long we keep it.
 *
 *  This is the screen that was deliberately not built until somebody answered
 *  the question behind it (Q22), because logging who looked at whose salary is
 *  surveillance of your own staff, and picking a retention rule quietly is how
 *  that decision gets made by accident. The owner's answer (D188):
 *
 *  - **detail for 30 days** — screen by screen, so a specific question about a
 *    specific day can be answered;
 *  - **a daily recap per person, kept 6 months** — what somebody did all day,
 *    long after the individual rows are gone.
 *
 *  Two consequences the screen makes visible rather than hiding. The recap is
 *  **stored**, which nothing else in this system is, because it has to outlive
 *  its own source. And the sweep **deletes** — the only deletion here, and it
 *  is a rule rather than a correction (A2).
 */
export default function ActivityPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [tab, setTab] = useState<"detail" | "recap">("detail");
  const [events, reloadEvents] = useLoad(() => identity.listActivity(), []);
  const [daily, reloadDaily] = useLoad(() => identity.listActivityDaily(), []);
  const [retention, reloadRetention] = useLoad(() => identity.getRetention(), []);
  const [busy, setBusy] = useState(false);
  /* Two different rights, deliberately not one. Leadership may read this log
     (owner, Q22 — *baca*); rolling a day up is a write, and purging it is the
     only deletion the system performs, so it sits at IT's admin level (D190). */
  const mayRollUp = can("it.update");
  const mayPurge = can("it.purge_activity");

  function reloadAll() { reloadEvents(); reloadDaily(); reloadRetention(); }

  async function rollUp() {
    setBusy(true);
    const res = await identity.rollUpActivity({});
    setBusy(false);
    if (res.error) { toast("info", "Tidak ada yang direkap", res.error.message); return; }
    toast("success", `Rekap ${res.data.day}`, `${res.data.written} orang ditulis${res.data.skipped ? `, ${res.data.skipped} sudah ada` : ""}`);
    reloadAll();
  }

  async function purge() {
    if (!window.confirm("Hapus detail yang lewat 30 hari dan rekap yang lewat 6 bulan? Ini penghapusan, bukan koreksi — dan tidak bisa dibatalkan.")) return;
    setBusy(true);
    const res = await identity.purgeActivity();
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi", res.error.message); return; }
    toast(
      res.data.events_removed + res.data.recaps_removed > 0 ? "success" : "info",
      "Retensi dijalankan",
      `${res.data.events_removed} detail dan ${res.data.recaps_removed} rekap dihapus${
        res.data.blocked_days.length ? ` · ${res.data.blocked_days.length} hari dilewati karena belum direkap` : ""}`,
    );
    reloadAll();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="Activity log"
        description="Siapa membuka apa. Detailnya disimpan 30 hari; rekap harian per orang disimpan 6 bulan. Setelah itu hilang — memang begitu aturannya."
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={events} />
            {mayRollUp && (
              <Button size="sm" variant="outline" icon={RefreshCw} disabled={busy} onClick={rollUp}>
                Rekap kemarin
              </Button>
            )}
            {mayPurge && (
              <Button size="sm" variant="outline" icon={Trash2} disabled={busy} onClick={purge}>
                Jalankan retensi
              </Button>
            )}
            {can("it.read") && !mayRollUp && !mayPurge && (
              <span className="text-xs text-slate-500">Baca saja — retensi dijalankan IT</span>
            )}
          </div>
        }
      />

      <Loaded state={retention} onRetry={reloadRetention}>
        {(r) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  ["Detail tersimpan", String(r.events_total), `aturan: ${r.detail_days} hari`],
                  ["Detail lewat batas", String(r.events_expiring),
                    r.events_expiring > 0 ? "akan dihapus saat retensi dijalankan" : "tidak ada"],
                  ["Rekap harian", String(r.recaps_total), `aturan: ${r.recap_months} bulan`],
                  ["Rekap lewat batas", String(r.recaps_expiring),
                    r.recaps_expiring > 0 ? "akan dihapus" : "tidak ada"],
                ] as [string, string, string][]).map(([k, v, note]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      k.includes("lewat batas") && Number(v) > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                <strong className="text-slate-700">Rekap harian disimpan, bukan dihitung ulang.</strong>{" "}
                Satu-satunya angka di sistem ini yang begitu — karena ia harus hidup lebih lama
                daripada baris yang membentuknya.
              </p>
            </div>

            {r.days_unrolled > 0 && (
              <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {r.days_unrolled} hari punya detail tapi belum punya rekap. Kalau detailnya keburu
                  lewat 30 hari, harinya hilang seluruhnya — retensi menolak menghapus hari seperti itu
                  sampai direkap dulu.
                </span>
              </div>
            )}
          </>
        )}
      </Loaded>

      <div className="mb-3 flex gap-1.5">
        <Button size="sm" variant={tab === "detail" ? "primary" : "outline"} onClick={() => setTab("detail")}>
          Detail 30 hari
        </Button>
        <Button size="sm" variant={tab === "recap" ? "primary" : "outline"} onClick={() => setTab("recap")}>
          Rekap harian 6 bulan
        </Button>
      </div>

      {tab === "detail" ? (
        <Loaded state={events} onRetry={reloadEvents}>
          {(all) => (
            <Card>
              <CardHeader
                title={`${all.length} kejadian`}
                subtitle="Kasar dengan sengaja: layar yang dibuka, yang dicetak, yang diekspor. Bukan apa yang diketik."
                icon={Activity}
              />
              <Paged rows={all} pageSize={20} unit="kejadian">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[12px]">
                        <span className="w-[110px] shrink-0 font-mono text-[10px] text-slate-400">
                          {e.at.slice(5, 16).replace("T", " ")}
                        </span>
                        <Badge tone={e.kind === "export" || e.kind === "print" ? "amber" : "slate"}>{e.kind}</Badge>
                        <span className="text-[13px] text-slate-800">{e.label}</span>
                        <span className="font-mono text-[10px] text-slate-400">{e.target}</span>
                        <span className="flex-1" />
                        <span className="text-slate-500">{e.actor_email}</span>
                      </li>
                    ))}
                    {all.length === 0 && (
                      <li className="px-5 py-8 text-[13px] text-slate-500">Belum ada aktivitas tercatat.</li>
                    )}
                  </ul>
                )}
              </Paged>
            </Card>
          )}
        </Loaded>
      ) : (
        <Loaded state={daily} onRetry={reloadDaily}>
          {(all) => (
            <Card>
              <CardHeader
                title={`${all.length} rekap harian`}
                subtitle="Satu baris per orang per hari: berapa banyak, dari jam berapa sampai jam berapa, layar apa saja, berapa yang mengubah sesuatu."
                icon={Timer}
              />
              <Paged rows={all} pageSize={15} unit="rekap">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((d) => (
                      <li key={d.id} className="px-5 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="w-[86px] shrink-0 font-mono text-[11px] text-slate-500">{d.day}</span>
                          <span className="text-[13px] font-medium text-slate-800">{d.full_name}</span>
                          <span className="text-[12px] text-slate-500">
                            {d.events} kejadian
                            {d.first_at && ` · ${d.first_at.slice(11, 16)}–${d.last_at?.slice(11, 16)}`}
                          </span>
                          <span className="flex-1" />
                          <Badge tone={d.changes > 0 ? "brand" : "slate"}>{d.changes} mengubah</Badge>
                          {d.refusals > 0 && <Badge tone="red">{d.refusals} ditolak</Badge>}
                          {/* Counted apart from `mengubah`: a reveal changes
                              nothing, and it is the figure worth reading on its
                              own (D197). */}
                          {d.reveals > 0 && <Badge tone="violet">{d.reveals} buka nomor</Badge>}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {d.top_screens.map((s) => `${s.label} (${s.count})`).join(" · ")}
                        </p>
                      </li>
                    ))}
                    {all.length === 0 && (
                      <li className="px-5 py-8 text-[13px] text-slate-500">Belum ada rekap.</li>
                    )}
                  </ul>
                )}
              </Paged>
            </Card>
          )}
        </Loaded>
      )}
    </div>
  );
}
