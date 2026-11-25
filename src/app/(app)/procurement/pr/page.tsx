"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ClipboardList, Plus, CheckCircle2, Clock, AlertTriangle, Circle, FileText,
  Scale, MessageSquareQuote, Users, RefreshCw,
} from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { StatusPill } from "@/components/ui/status-pill";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import { procurement } from "@/demo/api";
import {
  MEETING_STATE_LABEL, VARIANCE_REASON_LABEL,
  type PrLineView, type MeetingState, type VarianceReason,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { LineDrawer } from "./LineDrawer";

/** The requests board — and the approval queue, which is the same board.
 *
 *  A purchase request is a collection of items somebody wants to buy, from as
 *  many suppliers as it takes, and the ITEM is what everyone tracks (D48). A
 *  line stays here until it is settled or no longer needed, so "it comes back
 *  at the next leadership meeting" needs no machinery.
 *
 *  **This board is the working surface**: asking for something, correcting it,
 *  attaching the receipt, recording the payment. Deciding happens in a room
 *  once a week and has its own screen — `/procurement/meeting` — reading the
 *  same lines through the questions a meeting asks (D74). One list, two
 *  readings; the approval controls do not belong in the middle of somebody's
 *  working day.
 */

const STATE_META: Record<MeetingState, { icon: typeof Circle; tone: string; chip: string }> = {
  neither: { icon: Circle, tone: "text-amber-600", chip: "data-[on=true]:border-amber-300 data-[on=true]:bg-amber-50" },
  approved_unpaid: { icon: Clock, tone: "text-brand-600", chip: "data-[on=true]:border-brand-300 data-[on=true]:bg-brand-50" },
  paid_unapproved: { icon: AlertTriangle, tone: "text-rose-600", chip: "data-[on=true]:border-rose-300 data-[on=true]:bg-rose-50" },
  settled: { icon: CheckCircle2, tone: "text-emerald-600", chip: "data-[on=true]:border-emerald-300 data-[on=true]:bg-emerald-50" },
};

const STATE_ORDER: MeetingState[] = ["neither", "approved_unpaid", "paid_unapproved", "settled"];


export default function RequestsBoardPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState<MeetingState | "">("");
  const [showSettled, setShowSettled] = useState(false);
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [selected, setSelected] = useState<PrLineView | null>(null);

  const [lines, reload] = useLoad(
    () => (showSettled ? procurement.listAllLines() : procurement.listOpenLines()),
    [showSettled],
  );
  /* Loaded apart from the board because a difference outlives the line: the
     plywood that closed Rp 180.000 cheaper is off the open board and still
     part of the answer to "does this keep happening". */
  const [variances, reloadVariances] = useLoad(() => procurement.listVariances(), []);
  const mayEdit = can("procurement.create");
  const maySync = can("procurement.update");
  const [syncing, setSyncing] = useState(false);

  /* The office still types requests into the PR recap sheet; this reads it
     now instead of waiting for tonight's run (D454). The answer is counted,
     not listed: the sheet itself now carries every LINE ID and TRX ID. */
  async function syncSheet() {
    setSyncing(true);
    const res = await procurement.syncPrSheet();
    setSyncing(false);
    if (res.error) { toast("warning", tr("Sheet not synced", "Sheet tidak tersinkron"), res.error.message); return; }
    const said = res.data.tabs.map((t) => {
      if (!t.counts) return `${t.tab.trim()}: ${t.message ?? t.outcome}`;
      const c = t.counts;
      return tr(
        `${t.tab.trim()}: ${c.created} new, ${c.updated} updated from the sheet, ${c.approved} approved, ${c.matched} paid from the ledger, ${c.unmatched} paid but unmatched`,
        `${t.tab.trim()}: ${c.created} baru, ${c.updated} diperbarui dari sheet, ${c.approved} disetujui, ${c.matched} terhubung ke ledger, ${c.unmatched} dibayar tapi belum cocok`,
      ) + (t.message ? ` — ${t.message}` : "");
    }).join(" · ");
    toast("success", tr("Sheet synced", "Sheet tersinkron"), said);
    refresh();
  }

  function refresh() {
    reload();
    reloadVariances();
  }

  function matches(l: PrLineView) {
    if (stateFilter && l.meeting_state !== stateFilter) return false;
    if (varianceOnly && !l.variance.material) return false;
    if (!q) return true;
    const n = q.toLowerCase();
    return l.description.toLowerCase().includes(n)
      || (l.purpose ?? "").toLowerCase().includes(n)
      || (l.vendor_name ?? "").toLowerCase().includes(n)
      || l.line_no_full.toLowerCase().includes(n)
      || l.requested_by_name.toLowerCase().includes(n);
  }

  async function removeLine(l: PrLineView) {
    const res = await procurement.removeLine({ line_no: l.line_no_full });
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    toast("success", tr("Removed", "Dihapus"), tr(`${l.line_no_full} is no longer needed.`, `${l.line_no_full} tidak diperlukan lagi.`));
    setSelected(null);
    refresh();
  }

  const columns: Column<PrLineView>[] = [
    {
      key: "item",
      header: tr("Item", "Barang"),
      className: "whitespace-normal",
      render: (l) => {
        const meta = [l.line_no_full, l.requested_by_name, l.project_code]
          .filter(Boolean).join(" · ");
        return (
        /* The wrap constraint lives here, not on the <td>: Tailwind emits
           `whitespace-nowrap` after `whitespace-normal`, so the cell class
           wins and a long line runs under the next column. */
        <div className="max-w-[420px] whitespace-normal break-words">
          <p className="font-medium leading-snug text-slate-800">{l.description}</p>
          {/* The purpose is the reason this board is scannable at all. Without
              it, forty lines are forty prices and no decisions. */}
          {l.purpose && <p className="text-[12px] leading-snug text-slate-500">{l.purpose}</p>}
          {/* One line, truncated, with the whole string on hover: the
              provenance is worth having on the row and not worth two lines
              of it on every row. */}
          <p
            className="truncate font-mono text-[10px] text-slate-400"
            title={meta}
          >
            {meta}
          </p>
          {/* Leadership's own words, on the row rather than a click away —
              an instruction nobody sees is not an instruction. */}
          {l.note?.instructions && (
            <p className="mt-1 flex gap-1.5 rounded bg-brand-50 px-2 py-1 text-[12px] leading-snug text-brand-900">
              <MessageSquareQuote className="mt-0.5 h-3 w-3 shrink-0" />
              {l.note.instructions}
            </p>
          )}
          {l.note?.remark && !l.note.instructions && (
            <p className="mt-1 text-[12px] italic leading-snug text-slate-500">{l.note.remark}</p>
          )}
          </div>
        );
      },
    },
    {
      key: "vendor",
      header: "Vendor",
      className: "whitespace-normal",
      render: (l) => (
        <div className="max-w-[150px] whitespace-normal break-words text-[12px] text-slate-600">
          {l.vendor_name ?? <span className="text-slate-300">{tr("not decided", "belum ditentukan")}</span>}
        </div>
      ),
    },
    {
      key: "qty",
      header: tr("Qty", "Jml"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap text-[12px] text-slate-600">
          {l.qty != null ? `${formatNumber(l.qty)} ${l.uom ?? ""}` : "—"}
          {l.approval?.approved && l.approval.approved_qty != null && l.approval.approved_qty !== l.qty && (
            <span className="block text-[11px] text-brand-700">{tr("approved", "disetujui")} {formatNumber(l.approval.approved_qty)}</span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: tr("Amount", "Jumlah"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-medium text-slate-800">{formatIDR(l.item_total)}</p>
          {l.approval?.approved && l.approval.approved_amount !== l.item_total && (
            <p className="text-[11px] text-brand-700">{tr("approved", "disetujui")} {formatIDR(l.approval.approved_amount ?? 0)}</p>
          )}
          {/* Not what we asked — what actually left the bank. */}
          {l.variance.material && (
            <p className={cn(
              "text-[11px] font-medium",
              l.variance.kind === "over" ? "text-rose-600" : "text-amber-700",
            )}>
              {tr("paid", "dibayar")} {formatIDR(l.variance.paid)} · {l.variance.kind === "over" ? "+" : "−"}
              {formatIDR(Math.abs(l.variance.delta))}
              {!l.variance.explanation && tr(" · unexplained", " · belum dijelaskan")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "whitespace-normal",
      render: (l) => (
        <div className="space-y-0.5">
          <StatusPill kind="line" status={l.status} />
          {l.coverage.covered > 0 && !l.coverage.settled && (
            <p className="text-[11px] text-slate-500">{tr(`${formatIDR(l.coverage.remaining)} still owed`, `${formatIDR(l.coverage.remaining)} masih terutang`)}</p>
          )}
          {l.variance.material && !l.variance.explanation && (
            <p className="text-[11px] font-medium text-rose-600">{tr("needs an explanation", "perlu penjelasan")}</p>
          )}
          {/* Waiting on a named person is a different kind of waiting from
              "nobody has looked at it yet", so the row says which. */}
          {l.pending_request && !l.approval?.approved && (
            <p className="text-[11px] text-slate-500">
              {tr(
                `asked ${l.pending_request.sent_to_email.split("@")[0]} on chat`,
                `ditanyakan ke ${l.pending_request.sent_to_email.split("@")[0]} lewat chat`,
              )}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Pengadaan")}
        title={tr("Requests", "Permintaan")}
        description={tr(
          "Everything anyone has asked to buy that is not finished yet — asked for, corrected, documented and paid from here. An item stays on this board until it is settled or no longer needed.",
          "Semua yang diminta untuk dibeli dan belum selesai — diminta, dikoreksi, didokumentasikan, dan dibayar dari sini. Barang tetap di papan ini sampai lunas atau tidak diperlukan lagi.",
        )}
        actions={
          <>
            <Link href="/procurement/meeting">
              <Button variant="outline" icon={Users}>{tr("Meeting board", "Papan rapat")}</Button>
            </Link>
            <Link href="/procurement/pr/documents">
              <Button variant="outline" icon={FileText}>{tr("Submissions", "Pengajuan")}</Button>
            </Link>
            {maySync && (
              <Button variant="outline" icon={RefreshCw} onClick={syncSheet} disabled={syncing}>
                {syncing ? tr("Syncing…", "Menyinkron…") : tr("Sync sheet", "Sinkron sheet")}
              </Button>
            )}
            {mayEdit && (
              <Link href="/procurement/pr/new">
                <Button icon={Plus}>{tr("New request", "Permintaan baru")}</Button>
              </Link>
            )}
          </>
        }
      />

      <Loaded state={lines} onRetry={reload}>
        {(all) => {
          const counts = STATE_ORDER.map((s) => ({
            state: s,
            rows: all.filter((l) => l.meeting_state === s),
          }));
          const source = varianceOnly && variances.status === "ready" ? variances.data : all;
          const rows = source.filter(matches);
          const paidUnapproved = counts.find((c) => c.state === "paid_unapproved")!.rows.length;

          return (
            <>
              {/* The four questions a leadership meeting asks, as filters
                  rather than as four large cards — the board itself is what
                  people came to read. */}
              <div className="mb-4 flex flex-wrap gap-2">
                {counts.map(({ state, rows: r }) => {
                  const meta = STATE_META[state];
                  const Icon = meta.icon;
                  const on = stateFilter === state;
                  return (
                    <button
                      key={state}
                      data-on={on}
                      onClick={() => setStateFilter(on ? "" : state)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] shadow-card transition-colors hover:border-slate-300",
                        meta.chip,
                      )}
                    >
                      <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
                      <span className="font-semibold text-slate-800">{r.length}</span>
                      <span className="text-slate-600">{MEETING_STATE_LABEL[state]}</span>
                      <span className="tabular-nums text-[11px] text-slate-400">
                        {/* Approved lines count at what was approved, not at
                            what was asked — now that a decision can cut both
                            the quantity and the price, the asked figure is the
                            wrong total to put beside "approved". */}
                        {formatIDR(r.reduce((s, l) => s + (
                          l.approval?.approved ? l.approval.approved_amount ?? l.item_total : l.item_total
                        ), 0))}
                      </span>
                    </button>
                  );
                })}
                <VarianceChip
                  rows={variances.status === "ready" ? variances.data : []}
                  active={varianceOnly}
                  onToggle={() => setVarianceOnly((v) => !v)}
                />
              </div>

              {paidUnapproved > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>
                    <strong>{tr("Money moved before anyone approved it", "Uang keluar sebelum ada yang menyetujui")}</strong>{" "}
                    {tr(
                      `on ${paidUnapproved} item(s). They are still in the list below, still waiting for a yes — paying something is not deciding it. The decision itself is taken on the`,
                      `pada ${paidUnapproved} barang. Barang itu masih ada di daftar di bawah, masih menunggu persetujuan — membayar bukan berarti memutuskan. Keputusannya sendiri diambil di`,
                    )}{" "}
                    <Link href="/procurement/meeting" className="font-medium underline">{tr("meeting board", "papan rapat")}</Link>.
                  </span>
                </p>
              )}

              {/* Search and the "include finished" switch, above the table. */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <SourceBadge state={lines} />
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input
                    id="show-settled"
                    type="checkbox"
                    checked={showSettled}
                    onChange={(e) => setShowSettled(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  {tr("Include finished", "Termasuk yang selesai")}
                </label>
                <input
                  id="line-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={tr("Item, purpose, vendor…", "Barang, keperluan, vendor…")}
                  className="ml-auto h-9 w-52 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                />
              </div>

              <Card>
                <CardHeader
                  title={
                    varianceOnly ? tr("Paid ≠ approved", "Dibayar ≠ disetujui")
                      : stateFilter ? MEETING_STATE_LABEL[stateFilter]
                        : tr("All open items", "Semua barang terbuka")
                  }
                  subtitle={tr(
                    "One row per item, not per document — across every submission and every supplier. Open one to edit it, attach a document, or record the payment.",
                    "Satu baris per barang, bukan per dokumen — di semua pengajuan dan semua pemasok. Buka salah satu untuk mengubahnya, melampirkan dokumen, atau mencatat pembayaran.",
                  )}
                  icon={ClipboardList}
                />
                <DataTable
                  dense
                  columns={columns}
                  rows={rows}
                  rowKey={(l) => l.id}
                  onRowClick={setSelected}
                  empty={q || stateFilter || varianceOnly
                    ? tr("Nothing matches those filters.", "Tidak ada yang cocok dengan filter itu.")
                    : tr("Nothing outstanding.", "Tidak ada yang tertunda.")}
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <LineDrawer
        line={selected}
        others={lines.status === "ready" ? lines.data : undefined}
        onClose={() => setSelected(null)}
        onChanged={(l) => { setSelected(l); refresh(); }}
        onRemove={removeLine}
      />
    </div>
  );
}

/** Differences between approved and paid, counted by kind.
 *
 *  The application will not say whether one gap was an input error or a staff
 *  error — it cannot know, and a field that guesses gets believed. It counts
 *  the kinds instead: one Rp 200.000 gap is noise, twelve tagged "vendor price
 *  differed" against one supplier is a supplier who quotes badly.
 */
function VarianceChip({
  rows, active, onToggle,
}: {
  rows: PrLineView[];
  active: boolean;
  onToggle: () => void;
}) {
  const tr = useTr();
  if (rows.length === 0) return null;
  const unexplained = rows.filter((l) => !l.variance.explanation);
  const total = rows.reduce((s, l) => s + Math.abs(l.variance.delta), 0);

  const byReason = new Map<VarianceReason, number>();
  for (const l of rows) {
    const r = l.variance.explanation?.reason;
    if (r) byReason.set(r, (byReason.get(r) ?? 0) + 1);
  }
  const kinds = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${VARIANCE_REASON_LABEL[r]} ×${n}`)
    .join(" · ");

  return (
    <button
      data-on={active}
      onClick={onToggle}
      title={kinds || tr("None explained yet", "Belum ada yang dijelaskan")}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] shadow-card transition-colors hover:border-slate-300",
        "data-[on=true]:border-amber-300 data-[on=true]:bg-amber-50",
      )}
    >
      <Scale className="h-3.5 w-3.5 text-slate-500" />
      <span className="font-semibold text-slate-800">{rows.length}</span>
      <span className="text-slate-600">{tr("paid ≠ approved", "dibayar ≠ disetujui")}</span>
      <span className="tabular-nums text-[11px] text-slate-400">{formatIDR(total)}</span>
      {unexplained.length > 0 && (
        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
          {tr(`${unexplained.length} unexplained`, `${unexplained.length} belum dijelaskan`)}
        </span>
      )}
    </button>
  );
}
