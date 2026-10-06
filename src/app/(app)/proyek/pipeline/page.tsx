"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Target, XCircle } from "lucide-react";
import { Badge, Button, PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { ClosingForm } from "@/components/sales/closing-form";
import { PipelineNumbers } from "@/components/sales/pipeline-numbers";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { crm, procurement } from "@/demo/api";
import {
  CLOSING_REASONS, type ClosingReason, type ProjectStatus, type ProjectView,
} from "@/services/procurement/contracts";
import type { ClientActivityView } from "@/services/crm/contracts";
import { useCanSell } from "@/lib/sell";
import { officeToday } from "@/lib/office";
import { useTr } from "@/lib/i18n";

/** The sales pipeline (P2): every sale from the first question to closing,
 *  one card per project.
 *
 *  The stages are the project's own status — INQUIRY, QUOTATION_SENT, DEAL —
 *  not a second ladder kept beside it; the lost sales of the last ninety days
 *  sit in their own lane with the reason they were lost (D377). What a card is
 *  worth is the quotation in play, or the salesperson's estimate before there
 *  is one, and it says which. Nothing here is a profit (D164).
 */
export default function PipelinePage() {
  const tr = useTr();
  const canSell = useCanSell();
  const [projects, reload] = useLoad(() => procurement.listProjectViews(), []);
  const [followUps] = useLoad(() => crm.listActivities({ open_follow_ups: true }), []);
  const [pic, setPic] = useState<string>("ALL");

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Projects › Pipeline", "Proyek › Pipeline")}
        title={tr("Sales pipeline", "Pipeline penjualan")}
        description={tr(
          "Every sale from the first question to closing. One card is one project; open it to see its files, quotations and contacts.",
          "Setiap penjualan dari pertanyaan pertama sampai closing. Satu kartu satu proyek; buka untuk melihat file, quotation, dan kontaknya.",
        )}
        actions={canSell("create") ? (
          <Link href="/proyek/order"><Button icon={Plus}>{tr("New inquiry", "Inquiry baru")}</Button></Link>
        ) : undefined}
      />
      <Loaded state={projects} onRetry={reload}>
        {(all) => (
          <Board
            all={all}
            followUps={followUps.status === "ready" ? followUps.data : []}
            pic={pic} setPic={setPic}
            canClose={canSell()}
            onChanged={reload}
          />
        )}
      </Loaded>
      <PipelineNumbers pic={pic} />
    </div>
  );
}

const DAY = 86_400_000;
const daysAgo = (iso: string | null, today: string) =>
  iso ? Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / DAY) : Infinity;

/** What a card is worth, and where the number comes from. */
function worth(p: ProjectView): { value: number | null; estimate: boolean } {
  if (p.current_quote_total != null) return { value: p.current_quote_total, estimate: false };
  if (p.order_value != null) return { value: p.order_value, estimate: false };
  return { value: p.expected_value ?? null, estimate: p.expected_value != null };
}

function Board({
  all, followUps, pic, setPic, canClose, onChanged,
}: {
  all: ProjectView[];
  followUps: ClientActivityView[];
  pic: string;
  setPic: (v: string) => void;
  canClose: boolean;
  onChanged: () => void;
}) {
  const tr = useTr();
  const today = officeToday();
  const unassigned = tr("Unassigned", "Belum ada PIC");
  const people = useMemo(
    () => [...new Set(all.map((p) => p.sales_pic_name ?? unassigned))].sort(),
    [all, unassigned],
  );
  const mine = all.filter((p) => pic === "ALL" || (p.sales_pic_name ?? unassigned) === pic);
  const at = (s: ProjectStatus) => mine.filter((p) => (p.status ?? "INQUIRY") === s);
  const open = [...at("INQUIRY"), ...at("QUOTATION_SENT")];
  const lost = mine
    .filter((p) => p.status === "LOST" && daysAgo(p.closed_at, today) <= 90)
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));
  const sum = (xs: ProjectView[]) => xs.reduce((t, p) => t + (worth(p).value ?? 0), 0);

  /* The follow-up each card shows: its most pressing open one. */
  const rank = { overdue: 0, today: 1, upcoming: 2, done: 3, none: 4 } as const;
  const nextFollowUp = new Map<string, ClientActivityView>();
  for (const a of followUps) {
    if (!a.project_code) continue;
    const had = nextFollowUp.get(a.project_code);
    if (!had || rank[a.follow_up_state] < rank[had.follow_up_state]
        || (a.follow_up_state === had.follow_up_state && (a.follow_up_on ?? "") < (had.follow_up_on ?? ""))) {
      nextFollowUp.set(a.project_code, a);
    }
  }
  const overdue = open.filter((p) => nextFollowUp.get(p.code)?.follow_up_state === "overdue").length;

  /* Why sales were lost or orders cancelled, over the last twelve months. */
  const reasons = new Map<ClosingReason, number>();
  for (const p of all) {
    if ((p.status === "LOST" || p.status === "CANCELLED") && p.closing_reason_code && daysAgo(p.closed_at, today) <= 365) {
      reasons.set(p.closing_reason_code, (reasons.get(p.closing_reason_code) ?? 0) + 1);
    }
  }
  const most = Math.max(1, ...reasons.values());

  const lanes: { key: string; title: string; rows: ProjectView[]; closable: boolean }[] = [
    { key: "INQUIRY", title: tr("Inquiry", "Inquiry"), rows: at("INQUIRY"), closable: true },
    { key: "QUOTATION_SENT", title: tr("Quotation sent", "Quotation terkirim"), rows: at("QUOTATION_SENT"), closable: true },
    { key: "DEAL", title: tr("Deal", "Deal"), rows: at("DEAL"), closable: false },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={tr("Open pipeline", "Pipeline terbuka")} value={formatIDR(sum(open))}
          sub={tr(`${open.length} projects before the deal · ${open.filter((p) => worth(p).value == null).length} without a value`,
            `${open.length} proyek belum deal · ${open.filter((p) => worth(p).value == null).length} belum bernilai`)} />
        <Tile label={tr("Deal", "Deal")} value={formatIDR(sum(at("DEAL")))}
          sub={tr(`${at("DEAL").length} projects not yet in production`, `${at("DEAL").length} proyek belum diproduksi`)} />
        <Tile label={tr("Lost, last 90 days", "Tidak jadi, 90 hari")} value={String(lost.length)}
          sub={formatIDR(sum(lost))} />
        <Tile label={tr("Follow-ups overdue", "Follow-up terlambat")} value={String(overdue)}
          sub={tr("on open projects", "di proyek yang masih terbuka")} alert={overdue > 0} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-slate-500">{tr("Salesperson", "PIC sales")}</span>
        {["ALL", ...people].map((x) => (
          <button key={x} onClick={() => setPic(x)}
            className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium",
              pic === x ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>
            {x === "ALL" ? tr("All", "Semua") : x}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {lanes.map((lane) => (
          <section key={lane.key} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
            <h3 className="flex items-baseline justify-between px-1 text-[13px] font-semibold text-slate-800">
              {lane.title}
              <span className="text-[12px] font-normal tabular-nums text-slate-500">{lane.rows.length} · {formatIDR(sum(lane.rows))}</span>
            </h3>
            {lane.rows.length === 0 && <p className="px-1 py-3 text-[12px] text-slate-400">{tr("Nothing here.", "Tidak ada.")}</p>}
            {lane.rows
              .sort((a, b) => b.days_in_status - a.days_in_status)
              .map((p) => (
                <SaleCard key={p.code} p={p} f={nextFollowUp.get(p.code)} closable={lane.closable && canClose} onChanged={onChanged} />
              ))}
          </section>
        ))}
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
          <h3 className="flex items-baseline justify-between px-1 text-[13px] font-semibold text-slate-800">
            {tr("Lost", "Tidak jadi")} <span className="text-[12px] font-normal text-slate-500">{tr("last 90 days", "90 hari terakhir")}</span>
          </h3>
          {lost.length === 0 && <p className="px-1 py-3 text-[12px] text-slate-400">{tr("No lost sales in 90 days.", "Tidak ada yang tidak jadi dalam 90 hari.")}</p>}
          {lost.map((p) => (
            <Link key={p.code} href={`/proyek/order/${encodeURIComponent(p.code)}`}
              className="block rounded-lg border border-slate-200 bg-white p-2.5 text-[12px] hover:border-rose-300">
              <span className="block font-mono text-[10px] text-slate-400">{p.code} · {p.closed_at?.slice(0, 10)}</span>
              <span className="block text-[13px] font-medium text-slate-800">{p.name}</span>
              <span className="block text-slate-500">{p.client_display ?? "—"}</span>
              {p.closing_reason_code && <Badge tone="red">{p.closing_reason_code}</Badge>}
              {p.closing_reason && <span className="mt-1 block text-slate-600">“{p.closing_reason}”</span>}
            </Link>
          ))}
        </section>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="mb-2 text-[13px] font-semibold text-slate-800">
          {tr("Why sales were lost or orders cancelled", "Kenapa tidak jadi atau batal")}
          <span className="font-normal text-slate-400"> · {tr("last 12 months", "12 bulan terakhir")}</span>
        </p>
        <div className="space-y-1.5">
          {CLOSING_REASONS.map((r) => {
            const n = reasons.get(r.code) ?? 0;
            return (
              <div key={r.code} className="grid grid-cols-[130px_1fr_28px] items-center gap-2 text-[12px]">
                <span className="text-slate-600">{r.code}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-rose-400" style={{ width: `${(n / most) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-slate-700">{n}</span>
              </div>
            );
          })}
        </div>
        {reasons.size === 0 && (
          <p className="mt-2 text-[12px] text-slate-500">
            {tr("Nothing closed with a reason yet. Each LOST or CANCELLED project adds its category here.",
              "Belum ada yang ditutup dengan alasan. Setiap proyek LOST atau CANCELLED menambah kategorinya di sini.")}
          </p>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", alert ? "text-rose-700" : "text-slate-900")}>{value}</p>
      <p className="text-[12px] text-slate-500">{sub}</p>
    </div>
  );
}

function SaleCard({
  p, f, closable, onChanged,
}: {
  p: ProjectView; f: ClientActivityView | undefined; closable: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const [closing, setClosing] = useState(false);
  const w = worth(p);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[12px]">
      <Link href={`/proyek/order/${encodeURIComponent(p.code)}`} className="block hover:text-brand-700">
        <span className="block font-mono text-[10px] text-slate-400">{p.code}</span>
        <span className="block text-[13px] font-medium text-slate-800">{p.name}</span>
        <span className="block text-slate-500">{p.client_display ?? tr("no client yet", "belum ada klien")}</span>
      </Link>
      <p className="mt-1 text-slate-600">
        <span className="font-semibold tabular-nums text-slate-800">{w.value == null ? tr("no value yet", "belum bernilai") : formatIDR(w.value)}</span>
        {w.estimate && <span className="text-slate-400"> · {tr("estimate", "perkiraan")}</span>}
      </p>
      <p className="text-slate-500">
        {p.sales_pic_name ?? tr("no salesperson", "belum ada PIC")} · {tr(`${p.days_in_status} days here`, `${p.days_in_status} hari di sini`)}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {f?.follow_up_state === "overdue" && <Badge tone="red">{tr("Follow-up overdue", "Follow-up terlambat")}</Badge>}
        {f?.follow_up_state === "today" && <Badge tone="amber">{tr("Follow-up today", "Follow-up hari ini")}</Badge>}
        {f?.follow_up_state === "upcoming" && <Badge tone="slate">{tr(`Follow-up ${f.follow_up_on}`, `Follow-up ${f.follow_up_on}`)}</Badge>}
        {p.days_in_status > 14 && p.status !== "DEAL" && <Badge tone="amber">{tr("No movement for 2 weeks", "2 minggu tanpa gerak")}</Badge>}
        {p.source_note && <Badge tone="slate">{p.source_note}</Badge>}
      </div>
      {closable && !closing && (
        <button onClick={() => setClosing(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-700">
          <XCircle className="h-3 w-3" /> {tr("Mark as lost", "Tandai tidak jadi")}
        </button>
      )}
      {closing && (
        <div className="mt-2">
          <ClosingForm p={p} compact onCancel={() => setClosing(false)} onDone={() => { setClosing(false); onChanged(); }} />
        </div>
      )}
    </div>
  );
}
