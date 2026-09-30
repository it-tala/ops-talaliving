"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Factory, Hammer, Plus, Search, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { PROCESS_STAGES, ROUTES, STAGE_NAME, type WorkOrderView } from "@/services/production/contracts";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { NewWorkOrder } from "./NewWorkOrder";
import { WorkOrderDrawer } from "./WorkOrderDrawer";
import { FloorPanel, PositionLine } from "./WorkSlots";

/** The workshop floor: what is being made, how far it got, and when it is due.
 *
 *  The board exists because of the question the overtime sheet already asks —
 *  *item apa dikerjakan, proses sampai mana dan berapa, deadline kapan* — and
 *  because a workshop always knows what it is building and loses track of
 *  **which of the eleven things in front of it is the one that is late**
 *  (D148).
 *
 *  So the ordering is not by date created or by customer: late first, then by
 *  how soon it is due. And progress is counted as stages finished across the
 *  whole quantity rather than as the furthest stage reached — eleven doors cut
 *  and one packed is a tenth of the way through, not "packing".
 */
export default function ProductionSchedulePage() {
  const tr = useTr();
  const { can } = useSession();
  const [orders, reload] = useLoad(() => production.listWorkOrders({ include_done: true }), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [show, setShow] = useState<"OPEN" | "DONE" | "ALL">("OPEN");
  const [q, setQ] = useState("");
  const mayEdit = can("production.create");

  /* `?project=CODE` from an order line, `?open=NO` to a Job Order. Read once
     on mount, the same as the BOM page's `?open=`. */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("project")) { setProject(sp.get("project")); setShow("ALL"); }
    if (sp.get("open")) setOpen(sp.get("open"));
  }, []);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Production", "Produksi")}
        title="Job Order"
        description={tr(
          "What is being made, how far it got, how many, and when it is due. The late ones are on top.",
          "Apa yang sedang dibuat, sampai tahap mana, berapa, dan kapan jatuh temponya. Yang terlambat ada di atas.",
        )}
        actions={mayEdit ? (
          <Button icon={Plus} onClick={() => setCreating(true)}>{tr("New Job Order", "Job Order baru")}</Button>
        ) : undefined}
      />

      <Loaded state={orders} onRetry={reload}>
        {(all) => {
          const openOrders = all.filter((w) => w.status === "OPEN");
          const late = openOrders.filter((w) => w.late);
          const soon = openOrders.filter((w) => !w.late && w.days_left >= 0 && w.days_left <= 3);
          const flagged = openOrders.filter((w) => w.warnings.length > 0);
          const rows = all
            .filter((w) => show === "ALL" || (show === "OPEN" ? w.status === "OPEN" : w.status !== "OPEN"))
            .filter((w) => !project || w.project_code === project)
            .filter((w) => `${w.wo_no} ${w.item_name} ${w.product_code ?? ""} ${w.project_code ?? ""}`
              .toLowerCase().includes(q.toLowerCase()));

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("In progress", "Sedang dikerjakan"), String(openOrders.length), tr("open Job Orders", "Job Order terbuka")],
                    [tr("Past due", "Lewat tenggat"), String(late.length), late.length > 0 ? tr("to be discussed today", "harus dibicarakan hari ini") : tr("nothing is late", "tidak ada yang terlambat")],
                    [tr("Due in ≤ 3 days", "Jatuh tempo ≤ 3 hari"), String(soon.length), tr("little time left", "waktunya tinggal sedikit")],
                    [tr("Needs checking", "Perlu diperiksa"), String(flagged.length), tr("figures or stages that do not add up", "angka atau tahap yang tidak masuk akal")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        k === tr("Past due", "Lewat tenggat") && late.length > 0 ? "text-rose-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <FloorPanel />

              <Card>
                <CardHeader
                  title={tr("Job Order board", "Papan Job Order")}
                  subtitle={tr(
                    "Click a Job Order to see each stage, who is working on it, and to record output.",
                    "Klik satu Job Order untuk melihat tiap tahap, siapa yang mengerjakan, dan mencatat hasil.",
                  )}
                  icon={Hammer}
                  action={<SourceBadge state={orders} />}
                />
                <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
                  {([["OPEN", tr("In progress", "Berjalan")], ["DONE", tr("Done", "Selesai")], ["ALL", tr("All", "Semua")]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setShow(k)}
                      className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium",
                        show === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>
                      {label}
                    </button>
                  ))}
                  {project && (
                    <Badge tone="brand">
                      {tr("project", "proyek")} {project}
                      <button onClick={() => setProject(null)} aria-label={tr("Clear project filter", "Hapus filter proyek")} className="ml-1"><X className="h-3 w-3" /></button>
                    </Badge>
                  )}
                  <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-lg border border-slate-200 px-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search number, item, project…", "Cari nomor, item, proyek…")}
                      aria-label={tr("Search Job Orders", "Cari Job Order")} className="h-8 w-full text-sm focus:outline-none" />
                  </label>
                </div>
                {/* Job Order menumpuk sepanjang tahun — dipaginasi (D157). */}
                <Paged rows={rows} pageSize={15} unit="Job Order">
                  {(shown) => (
                    <ul className="divide-y divide-slate-100">
                      {shown.map((w) => <Row key={w.id} wo={w} onOpen={() => setOpen(w.wo_no)} />)}
                      {rows.length === 0 && (
                        <li className="px-5 py-8 text-[13px] text-slate-500">
                          {all.length === 0
                            ? tr("No Job Orders yet. Create one from an order line on the Projects page, or with the button above.", "Belum ada Job Order. Buat dari item pesanan di halaman Proyek, atau dengan tombol di atas.")
                            : tr("No Job Orders here.", "Tidak ada Job Order di sini.")}
                        </li>
                      )}
                    </ul>
                  )}
                </Paged>
                <div className="space-y-1 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                  <p className="flex flex-wrap items-center gap-3">
                    {tr("Stages:", "Tahap:")}
                    {PROCESS_STAGES.map((s) => (
                      <span key={s.code}>
                        {s.seq}. {s.name}{" "}
                        <span className="text-slate-400">({s.covers})</span>
                      </span>
                    ))}
                  </p>
                  <p className="flex flex-wrap items-center gap-3">
                    {tr("Routes:", "Rute:")}
                    {ROUTES.map((r) => (
                      <span key={r.code}>
                        <strong className="font-medium text-slate-600">{r.name}</strong>{" "}
                        {r.stages.map((c) => STAGE_NAME(c)).join(" → ")}
                      </span>
                    ))}
                  </p>
                </div>
              </Card>
            </>
          );
        }}
      </Loaded>

      {creating && (
        <NewWorkOrder onClose={() => setCreating(false)} onDone={(no) => { setCreating(false); reload(); setOpen(no); }} />
      )}
      {open && (
        <WorkOrderDrawer woNo={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  );
}

function Row({ wo, onOpen }: { wo: WorkOrderView; onOpen: () => void }) {
  const tr = useTr();
  return (
    <li>
      <button onClick={onOpen} className="w-full px-5 py-3 text-left hover:bg-slate-50">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-[200px] flex-1">
            <span className="block text-[13px] font-medium text-slate-800">{wo.item_name}</span>
            <span className="block font-mono text-[10px] text-slate-400">
              {wo.wo_no}
              {wo.project_code && ` · ${wo.project_code}`}
            </span>
          </span>
          {/* The project manager's line (D350): *10/100 selesai · Amplas 1 ·
              Finishing 2 · belum mulai 87*. */}
          <PositionLine wo={wo} />
          {wo.route === "SUBCON" && (
            <Badge tone={wo.at_vendor ? "violet" : "slate"}>
              <Factory className="mr-1 h-3 w-3" />
              {wo.at_vendor
                ? tr(`at the vendor ${wo.days_at_vendor} days`, `di vendor ${wo.days_at_vendor} hari`)
                : tr("via vendor", "lewat vendor")}
            </Badge>
          )}
          {wo.status === "DONE" ? (
            <Badge tone="slate">{tr("done", "selesai")}</Badge>
          ) : wo.subcon_overdue ? (
            /* The vendor is late, not the workshop. Two different sentences,
               and putting the workshop's badge on this row would blame the
               wrong people (D254). */
            <Badge tone="red" dot>{tr("vendor late", "vendor telat")}</Badge>
          ) : wo.late ? (
            <Badge tone="red" dot>{tr(`${Math.abs(wo.days_left)} days late`, `terlambat ${Math.abs(wo.days_left)} hari`)}</Badge>
          ) : wo.days_left <= 3 ? (
            <Badge tone="amber" dot>{tr(`${wo.days_left} days left`, `${wo.days_left} hari lagi`)}</Badge>
          ) : (
            <Badge tone="slate">{tr(`${wo.days_left} days left`, `${wo.days_left} hari lagi`)}</Badge>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" />
            {wo.due_date}
          </span>
        </div>

        {/* One cell per stage **on this order's route**. A subcontracted order
            has three cells, not four with an empty one: a stage the route does
            not contain is absent, never zero (D254). */}
        <div className="mt-2 flex gap-1">
          {wo.stages.map((s) => (
            <span
              key={s.stage}
              title={tr(`${s.name}: ${formatNumber(s.done)} of ${formatNumber(wo.qty)}`, `${s.name}: ${formatNumber(s.done)} dari ${formatNumber(wo.qty)}`)}
              className={cn(
                "flex-1 rounded px-1 py-0.5 text-center text-[10px] leading-tight",
                s.done >= wo.qty ? "bg-emerald-100 text-emerald-800"
                  : s.done > 0 ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-400",
              )}
            >
              {s.name}
              <span className="block font-semibold tabular-nums">{formatNumber(s.done)}</span>
            </span>
          ))}
        </div>

        {wo.warnings.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {wo.warnings[0]}
            {wo.warnings.length > 1 && <span className="text-slate-400"> {tr(`+${wo.warnings.length - 1} more`, `+${wo.warnings.length - 1} lagi`)}</span>}
          </p>
        )}
      </button>
    </li>
  );
}
