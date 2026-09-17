"use client";

import { Factory, AlertTriangle, PackageCheck, Clock } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import type { VendorLegView } from "@/services/production/contracts";

/** Where our things are, vendor by vendor (W6, D280).
 *
 *  The owner's answer to Q48 redefined the question: the business has **several
 *  vendors each doing one process** — barang mentah, jok, amplas, packing — and
 *  a piece can visit more than one of them. The work order used to hold four
 *  columns for one trip, which could not say that at all.
 *
 *  This screen answers one question — *where is my chair* — and the answer is
 *  usually *at the upholsterer since Tuesday*. Two rules keep it honest:
 *
 *  - **Late is measured against a promise, never against silence.** A leg with
 *    no agreed return date cannot be overdue, only absent, and it sits in its
 *    own group rather than at the top of the late list (D134).
 *  - **What came back is a number, not a tick.** Twenty frames out and
 *    eighteen back is the ordinary case, and the two that stayed are a
 *    question for the vendor that a checkbox would have swallowed.
 */
export default function VendorTrackingPage() {
  const [open, reloadOpen] = useLoad(() => production.listVendorLegs({ open_only: true }), []);
  const [all, reloadAll] = useLoad(() => production.listVendorLegs(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="Production"
        title="Barang di vendor"
        description="Siapa memegang apa, sejak kapan, dan apa yang dijanjikan. Satu baris per pengiriman — satu barang bisa mampir ke tukang jok lalu ke tukang amplas, dan masing-masing punya tanggalnya sendiri."
      />

      <Loaded state={open} onRetry={reloadOpen}>
        {(rows) => {
          const overdue = rows.filter((l) => l.overdue_days !== null);
          const noPromise = rows.filter((l) => l.expected_back === null);
          const byVendor = new Map<string, VendorLegView[]>();
          for (const l of rows) byVendor.set(l.vendor_name, [...(byVendor.get(l.vendor_name) ?? []), l]);

          return (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Pengiriman terbuka" value={String(rows.length)} icon={Factory} />
                <StatCard
                  label="Unit di luar"
                  value={formatNumber(rows.reduce((t, l) => t + l.outstanding, 0))}
                  icon={PackageCheck}
                />
                <StatCard
                  label="Lewat janji" value={String(overdue.length)} icon={AlertTriangle}
                  tone={overdue.length > 0 ? "red" : "slate"}
                />
                <StatCard
                  label="Tanpa janji tanggal" value={String(noPromise.length)} icon={Clock}
                  tone={noPromise.length > 0 ? "amber" : "slate"}
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  icon={Factory}
                  title="Tidak ada barang di vendor"
                  description="Semua pengiriman sudah tercatat kembali."
                />
              ) : (
                [...byVendor.entries()].map(([vendor, legs]) => (
                  <Card key={vendor} className="mb-4">
                    <CardHeader
                      title={vendor}
                      subtitle={`${legs.length} pengiriman · ${formatNumber(legs.reduce((t, l) => t + l.outstanding, 0))} unit masih di sana`}
                      icon={Factory}
                      action={<SourceBadge state={open} />}
                    />
                    <ul className="divide-y divide-slate-100">
                      {legs.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
                          <span className="min-w-[200px] flex-1">
                            <span className="block font-medium text-slate-800">
                              {l.process_name} · {formatNumber(l.qty)}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              <Link href="/produksi/jadwal" className="hover:underline">{l.wo_no}</Link>
                              {" · "}{l.product_name}
                            </span>
                          </span>
                          <span className="text-[12px] text-slate-500">
                            dikirim {l.sent_on} · {l.days_out} hari
                          </span>
                          {/* Late only against a date somebody agreed. */}
                          {l.overdue_days !== null ? (
                            <Badge tone="red" dot>lewat {l.overdue_days} hari</Badge>
                          ) : l.expected_back ? (
                            <Badge tone="amber">± {l.expected_back}</Badge>
                          ) : (
                            <Badge tone="slate">tanpa janji tanggal</Badge>
                          )}
                          {l.note && (
                            <span className="w-full text-[11px] text-slate-500">{l.note}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))
              )}
            </>
          );
        }}
      </Loaded>

      <Loaded state={all} onRetry={reloadAll}>
        {(rows) => {
          const closed = rows.filter((l) => l.returned_on !== null);
          if (closed.length === 0) return <></>;
          return (
            <Card>
              <CardHeader
                title="Sudah kembali"
                subtitle="Tetap disimpan: berapa lama vendor memegangnya, dan apakah semuanya kembali, adalah dua hal yang hanya kelihatan kalau riwayatnya ada."
                icon={PackageCheck}
              />
              <ul className="divide-y divide-slate-100">
                {closed.slice(0, 12).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                    <span className="min-w-[200px] flex-1">
                      <span className="block text-slate-800">{l.process_name} · {l.vendor_name}</span>
                      <span className="block text-[11px] text-slate-400">{l.wo_no} · {l.product_name}</span>
                    </span>
                    <span className="text-[12px] text-slate-500">
                      {l.sent_on} → {l.returned_on} · {l.days_out} hari
                    </span>
                    <span className={cn("text-[12px] tabular-nums",
                      l.short_by !== null ? "text-amber-800" : "text-slate-600")}>
                      {formatNumber(l.returned_qty ?? 0)} dari {formatNumber(l.qty)}
                    </span>
                    {/* A number, not a tick: the two that never came back are
                        a question for the vendor. */}
                    {l.short_by !== null && (
                      <Badge tone="amber">kurang {formatNumber(l.short_by)}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        }}
      </Loaded>
    </div>
  );
}
