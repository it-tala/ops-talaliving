"use client";

import { useState } from "react";
import { Receipt, AlertTriangle, ChevronLeft, ChevronRight, ShieldCheck, TrendingUp, TrendingDown, Link2 } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { CashCellState, MonthlyBill } from "@/services/accounting/contracts";
import { SCHEME_LABEL } from "@/services/hr/contracts";

const STATE_TONE: Record<CashCellState, "red" | "amber" | "green" | "slate" | "brand"> = {
  OVERDUE: "red", DUE: "amber", PAID: "green", PARTIAL: "amber", PLANNED: "slate", SKIPPED: "slate",
};

const STATE_LABEL: Record<CashCellState, string> = {
  OVERDUE: "Lewat tempo", DUE: "Jatuh tempo minggu ini", PAID: "Lunas",
  PARTIAL: "Sebagian", PLANNED: "Belum jatuh tempo", SKIPPED: "Dilewati",
};

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** What accounting has to pay this month.
 *
 *  The cash calendar next door is twelve months wide and answers *when does
 *  the money run out* — leadership's question. Accounting opening it had to
 *  walk the whole grid to find the only one they have: **what do I pay this
 *  month, and what have I already paid** (owner, D227).
 *
 *  Every figure here comes from the same `cashPlan` the calendar draws. Nothing
 *  is recomputed: a second arithmetic for the same obligation is one that
 *  disagrees with the first within a month.
 *
 *  The comparison column carries the rule worth stating. A line that did not
 *  exist last month reads **—**, never *+100%* (D228): a first occurrence is
 *  not an increase, and an anomaly list that says it is, is an anomaly list
 *  people learn to scroll past.
 */
export default function BillsPage() {
  const [month, setMonth] = useState(() => officeToday().slice(0, 7));
  const [bills, reload] = useLoad(() => accounting.getMonthlyBills(month), [month]);
  const [audit, reloadAudit] = useLoad(() => accounting.getContributionAudit(month), [month]);
  const isCurrent = month === officeToday().slice(0, 7);

  return (
    <div>
      <PageHeader
        breadcrumb="Accounting"
        title={isCurrent ? "Tagihan bulan ini" : `Tagihan ${monthLabel(month)}`}
        description="Yang harus dibayar bulan ini, urut tanggal, beserta yang sudah dibayar. Angkanya sama persis dengan kalender kas — ini bentuk yang berbeda dari perhitungan yang sama, bukan perhitungan kedua."
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" icon={ChevronLeft} onClick={() => setMonth(shift(month, -1))}>
              Bulan lalu
            </Button>
            {!isCurrent && (
              <Button size="sm" variant="ghost" onClick={() => setMonth(officeToday().slice(0, 7))}>
                Bulan ini
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setMonth(shift(month, 1))}>
              Bulan depan <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
            <SourceBadge state={bills} />
          </div>
        }
      />

      <Loaded state={bills} onRetry={reload}>
        {(b) => {
          const out = b.bills.filter((x) => x.direction === "OUT");
          const incoming = b.bills.filter((x) => x.direction === "IN");
          /* The three lists **partition** the month. A partly-paid bill lives in
             *belum dibayar* and nowhere else: it still has money owing, and
             listing it under *sudah dibayar* as well made the same obligation
             appear twice on one screen — which is how a person double-pays
             (F69). What was already paid against it shows in its own column. */
          const overdue = out.filter((x) => x.state === "OVERDUE");
          const open = out.filter((x) => x.state !== "PAID" && x.state !== "SKIPPED" && x.state !== "OVERDUE");
          const done = out.filter((x) => x.state === "PAID");

          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label={`Harus keluar ${b.label}`} value={formatIDR(b.total_planned)}
                  note={b.last_month_total != null
                    ? `bulan lalu ${formatIDR(b.last_month_total)}`
                    : "tidak ada pembanding bulan lalu"} />
                <Tile label="Sudah dibayar" value={formatIDR(b.total_paid)} tone="green" />
                <Tile label="Masih harus dibayar" value={formatIDR(b.total_outstanding)}
                  note={`${open.length + overdue.length} baris`} />
                <Tile label="Lewat tempo" value={b.overdue_count === 0 ? "—" : formatIDR(b.overdue_amount)}
                  note={b.overdue_count === 0 ? "tidak ada" : `${b.overdue_count} baris`}
                  tone={b.overdue_count > 0 ? "red" : "slate"} />
              </div>

              {b.unusual_count > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{b.unusual_count} tagihan berbeda jauh dari bulan lalu.</strong> Ditandai, bukan
                    ditolak — kenaikan bisa saja benar. Perbandingannya <strong>total bulanan lawan total
                    bulanan</strong>, bukan baris lawan baris, dan yang bulan lalu belum ada tidak pernah
                    ditandai: kemunculan pertama bukan kenaikan.
                  </span>
                </p>
              )}

              {/* The owner's own audit, on the screen where *what must I pay*
                  already lives: names × rate against the money that left
                  (D259). */}
              <Loaded state={audit} onRetry={reloadAudit} skeletonRows={2}>
                {(rows) => {
                  const live = rows.filter((r) => r.headcount > 0 || r.paid > 0);
                  if (live.length === 0) return null;
                  const flagged = live.filter((r) => r.unusual);
                  return (
                    <Card className="mb-4">
                      <CardHeader
                        title="Iuran wajib — tagihan vs daftar nama"
                        subtitle="Yang seharusnya dihitung dari karyawan yang terdaftar × tarifnya, bukan dari angka bulan lalu. Angka “dibayar” berasal dari baris kalender kas yang sama dengan daftar di bawah."
                        icon={ShieldCheck}
                        action={flagged.length > 0
                          ? <Badge tone="red">{flagged.length} perlu dikejar</Badge>
                          : <Badge tone="green">cocok</Badge>}
                      />
                      <ul className="divide-y divide-slate-100">
                        {live.map((r) => (
                          <li key={r.schemes.join()} className="px-5 py-2.5 text-[13px]">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="min-w-[180px] flex-1">
                                <span className="block font-medium text-slate-800">
                                  {r.component_name ?? r.schemes.map((x) => SCHEME_LABEL[x]).join(", ")}
                                </span>
                                {/* One invoice can pay four schemes; naming them
                                    stops the total looking like it came from
                                    one (D259). */}
                                {r.component_name && r.schemes.length > 1 && (
                                  <span className="block text-[11px] text-slate-400">
                                    {r.schemes.map((x) => SCHEME_LABEL[x].replace("BPJS TK — ", "")).join(" · ")}
                                  </span>
                                )}
                              </span>
                              <span className="whitespace-nowrap text-[12px] text-slate-500">
                                {r.headcount} orang
                              </span>
                              <span className="whitespace-nowrap tabular-nums text-slate-700">
                                seharusnya {r.expected == null ? "—" : formatIDR(r.expected)}
                              </span>
                              <span className="whitespace-nowrap tabular-nums text-slate-700">
                                dibayar {formatIDR(r.paid)}
                              </span>
                              {r.difference != null && r.difference !== 0 && (
                                <Badge tone={r.unusual ? "red" : "slate"}>
                                  {r.difference > 0 ? "+" : "−"}{formatIDR(Math.abs(r.difference))}
                                </Badge>
                              )}
                            </div>
                            <p className={cn("mt-0.5 text-[12px]",
                              r.unusual ? "text-rose-800" : "text-slate-500")}>
                              {r.verdict}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                        Daftar namanya ada di{" "}
                        <Link href="/hrd/iuran" className="font-medium text-brand-700 hover:underline">
                          HRD · iuran wajib
                        </Link>
                        . PPh 21 tidak ada di sini: ia tercatat sebagai pendaftaran dan tidak pernah dihitung.
                      </p>
                    </Card>
                  );
                }}
              </Loaded>

              {overdue.length > 0 && (
                <Section title={`${overdue.length} lewat tempo`} icon={AlertTriangle} rows={overdue} tone="red" />
              )}
              <Section title={`${open.length} belum dibayar`} icon={Receipt} rows={open} />
              {done.length > 0 && (
                <Section title={`${done.length} sudah dibayar`} icon={Receipt} rows={done} muted />
              )}
              {incoming.length > 0 && (
                <Section
                  title={`${incoming.length} uang masuk yang direncanakan`}
                  subtitle="Ditampilkan supaya bulannya utuh, dan tidak ikut ke total di atas — pertanyaan *apa yang harus saya bayar* tidak dijawab oleh uang yang datang."
                  icon={TrendingUp} rows={incoming} muted
                />
              )}

              <p className="px-1 pb-2 text-[12px] text-slate-500">
                Angkanya dari komponen kas yang sama dengan{" "}
                <Link href="/accounting/calendar" className="font-medium text-brand-700 hover:underline">
                  kalender kas
                </Link>{" "}
                — layar ini bentuk lain dari perhitungan yang sama, bukan perhitungan kedua.
              </p>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Tile({ label, value, note, tone = "slate" }: {
  label: string; value: string; note?: string; tone?: "slate" | "green" | "red";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums",
        tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : "text-slate-900")}>
        {value}
      </p>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

function Section({ title, subtitle, icon, rows, tone, muted }: {
  title: string; subtitle?: string; icon: typeof Receipt;
  rows: MonthlyBill[]; tone?: "red"; muted?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader title={title} subtitle={subtitle} icon={icon} />
        <p className="px-5 py-6 text-[13px] text-slate-500">Tidak ada.</p>
      </Card>
    );
  }
  return (
    <Card className={cn("mb-4", tone === "red" && "border-rose-200")}>
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 text-left">Tanggal</th>
              <th className="px-4 py-2 text-left">Tagihan</th>
              <th className="px-4 py-2 text-right">Rencana</th>
              <th className="px-4 py-2 text-right">Dibayar</th>
              <th className="px-4 py-2 text-right">Baris ini · bulan lalu</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className={cn(muted && "opacity-80")}>
            {rows.map((r, i) => (
              <tr key={`${r.component_id}-${r.date}-${i}`} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                  {r.date.slice(8)}/{r.date.slice(5, 7)}
                  {r.days_away < 0 && r.state === "OVERDUE" && (
                    <span className="block text-[10px] text-rose-600">lewat {-r.days_away} hari</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="block text-slate-800">{r.name}</span>
                  <span className="block text-[11px] text-slate-400">
                    {[
                      r.vendor_name,
                      r.account_code,
                      r.matched_by === "category" ? "dicocokkan lewat kategori, bukan ditautkan orang" : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {r.reason && <span className="block text-[11px] text-slate-500">{r.reason}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatIDR(r.planned)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.actual === 0 ? <span className="text-slate-300">—</span> : (
                    <>
                      <span className="text-slate-800">{formatIDR(r.actual)}</span>
                      {r.trx_nos.length > 0 && (
                        <span className="block font-mono text-[10px] text-slate-400">
                          <Link2 className="mr-0.5 inline h-2.5 w-2.5" />{r.trx_nos.slice(0, 2).join(" · ")}
                        </span>
                      )}
                    </>
                  )}
                  {r.outstanding > 0 && r.actual > 0 && (
                    <span className="block text-[10px] text-amber-700">
                      sisa {formatIDR(r.outstanding)}
                    </span>
                  )}
                </td>
                {/* The comparison is **per line, per month** (F68). Where the
                    line runs more than once a month the cell says so, because a
                    figure sitting beside a single Rp 30 juta payday will
                    otherwise be read as that payday's own history. */}
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.last_month == null ? (
                    <span className="text-slate-300" title="Bulan lalu baris ini belum ada">—</span>
                  ) : (
                    <>
                      <span className="text-slate-500">{formatIDR(r.last_month)}</span>
                      {r.delta_percent != null && r.delta_percent !== 0 && (
                        <span className={cn("block text-[10px]",
                          r.unusual ? "font-medium text-amber-700" : "text-slate-400")}>
                          {r.delta_percent > 0 ? <TrendingUp className="mr-0.5 inline h-2.5 w-2.5" />
                            : <TrendingDown className="mr-0.5 inline h-2.5 w-2.5" />}
                          {r.delta_percent > 0 ? "+" : ""}{r.delta_percent}%
                        </span>
                      )}
                      {r.occurrences > 1 && (
                        <span
                          className="block text-[10px] text-slate-400"
                          title={`${r.occurrences}× sebulan — dibandingkan sebagai total bulanan, bukan per baris`}
                        >
                          total bulan: {formatIDR(r.month_total)}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
