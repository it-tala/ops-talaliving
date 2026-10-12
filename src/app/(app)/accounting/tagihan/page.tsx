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
import { useTr, type Message, type Tr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

const STATE_TONE: Record<CashCellState, "red" | "amber" | "green" | "slate" | "brand"> = {
  OVERDUE: "red", DUE: "amber", PAID: "green", PARTIAL: "amber", PLANNED: "slate", SKIPPED: "slate",
};

const STATE_LABEL: Record<CashCellState, Message> = {
  OVERDUE: { en: "Overdue", id: "Lewat tempo" },
  DUE: { en: "Due this week", id: "Jatuh tempo minggu ini" },
  PAID: { en: "Paid", id: "Lunas" },
  PARTIAL: { en: "Partial", id: "Sebagian" },
  PLANNED: { en: "Not yet due", id: "Belum jatuh tempo" },
  SKIPPED: { en: "Skipped", id: "Dilewati" },
};

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function monthLabel(month: string, tr: Tr): string {
  const i = Number(month.slice(5, 7)) - 1;
  return `${tr(MONTHS_EN[i], MONTHS[i])} ${month.slice(0, 4)}`;
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
  const tr = useTr();
  const [month, setMonth] = useState(() => officeToday().slice(0, 7));
  const [bills, reload] = useLoad(() => accounting.getMonthlyBills(month), [month]);
  const [audit, reloadAudit] = useLoad(() => accounting.getContributionAudit(month), [month]);
  const isCurrent = month === officeToday().slice(0, 7);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={isCurrent ? tr("This month's bills", "Tagihan bulan ini") : tr(`Bills for ${monthLabel(month, tr)}`, `Tagihan ${monthLabel(month, tr)}`)}
        description={tr("What has to be paid this month, by date, with what has already been paid. The figures are exactly those of the cash calendar — a different shape of the same calculation, not a second one.", "Yang harus dibayar bulan ini, urut tanggal, beserta yang sudah dibayar. Angkanya sama persis dengan kalender kas — ini bentuk yang berbeda dari perhitungan yang sama, bukan perhitungan kedua.")}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" icon={ChevronLeft} onClick={() => setMonth(shift(month, -1))}>
              {tr("Last month", "Bulan lalu")}
            </Button>
            {!isCurrent && (
              <Button size="sm" variant="ghost" onClick={() => setMonth(officeToday().slice(0, 7))}>
                {tr("This month", "Bulan ini")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setMonth(shift(month, 1))}>
              {tr("Next month", "Bulan depan")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
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
                <Tile label={tr(`Going out ${b.label}`, `Harus keluar ${b.label}`)} value={formatIDR(b.total_planned)}
                  note={b.last_month_total != null
                    ? tr(`last month ${formatIDR(b.last_month_total)}`, `bulan lalu ${formatIDR(b.last_month_total)}`)
                    : tr("no last month to compare", "tidak ada pembanding bulan lalu")} />
                <Tile label={tr("Already paid", "Sudah dibayar")} value={formatIDR(b.total_paid)} tone="green" />
                <Tile label={tr("Still to pay", "Masih harus dibayar")} value={formatIDR(b.total_outstanding)}
                  note={tr(`${open.length + overdue.length} row(s)`, `${open.length + overdue.length} baris`)} />
                <Tile label={tr("Overdue", "Lewat tempo")} value={b.overdue_count === 0 ? "—" : formatIDR(b.overdue_amount)}
                  note={b.overdue_count === 0 ? tr("none", "tidak ada") : tr(`${b.overdue_count} row(s)`, `${b.overdue_count} baris`)}
                  tone={b.overdue_count > 0 ? "red" : "slate"} />
              </div>

              {b.unusual_count > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{tr(`${b.unusual_count} bill(s) differ sharply from last month.`, `${b.unusual_count} tagihan berbeda jauh dari bulan lalu.`)}</strong>{" "}
                    {tr("Flagged, not refused — a rise can be right. The comparison is", "Ditandai, bukan ditolak — kenaikan bisa saja benar. Perbandingannya")}{" "}
                    <strong>{tr("monthly total against monthly total", "total bulanan lawan total bulanan")}</strong>
                    {tr(", not row against row, and a line that did not exist last month is never flagged: a first occurrence is not an increase.",
                      ", bukan baris lawan baris, dan yang bulan lalu belum ada tidak pernah ditandai: kemunculan pertama bukan kenaikan.")}
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
                        title={tr("Mandatory contributions — bill vs list of names", "Iuran wajib — tagihan vs daftar nama")}
                        subtitle={tr("What it should be, computed from the enrolled employees × their rate, not from last month's figure. The “paid” figure comes from the same cash calendar lines as the list below.", "Yang seharusnya dihitung dari karyawan yang terdaftar × tarifnya, bukan dari angka bulan lalu. Angka “dibayar” berasal dari baris kalender kas yang sama dengan daftar di bawah.")}
                        icon={ShieldCheck}
                        action={flagged.length > 0
                          ? <Badge tone="red">{tr(`${flagged.length} to chase`, `${flagged.length} perlu dikejar`)}</Badge>
                          : <Badge tone="green">{tr("matches", "cocok")}</Badge>}
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
                                {tr(`${r.headcount} people`, `${r.headcount} orang`)}
                              </span>
                              <span className="whitespace-nowrap tabular-nums text-slate-700">
                                {tr("expected", "seharusnya")} {r.expected == null ? "—" : formatIDR(r.expected)}
                              </span>
                              <span className="whitespace-nowrap tabular-nums text-slate-700">
                                {tr("paid", "dibayar")} {formatIDR(r.paid)}
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
                        {tr("The list of names is in", "Daftar namanya ada di")}{" "}
                        <Link href="/hrd/iuran" className="font-medium text-brand-700 hover:underline">
                          {tr("HRD · mandatory contributions", "HRD · iuran wajib")}
                        </Link>
                        {tr(". PPh 21 is not here: it is recorded as an enrolment and never computed.", ". PPh 21 tidak ada di sini: ia tercatat sebagai pendaftaran dan tidak pernah dihitung.")}
                      </p>
                    </Card>
                  );
                }}
              </Loaded>

              {overdue.length > 0 && (
                <Section title={tr(`${overdue.length} overdue`, `${overdue.length} lewat tempo`)} icon={AlertTriangle} rows={overdue} tone="red" />
              )}
              <Section title={tr(`${open.length} not yet paid`, `${open.length} belum dibayar`)} icon={Receipt} rows={open} />
              {done.length > 0 && (
                <Section title={tr(`${done.length} already paid`, `${done.length} sudah dibayar`)} icon={Receipt} rows={done} muted />
              )}
              {incoming.length > 0 && (
                <Section
                  title={tr(`${incoming.length} planned money in`, `${incoming.length} uang masuk yang direncanakan`)}
                  subtitle={tr("Shown so the month is whole, and not counted in the totals above — the question *what do I have to pay* is not answered by money coming in.", "Ditampilkan supaya bulannya utuh, dan tidak ikut ke total di atas — pertanyaan *apa yang harus saya bayar* tidak dijawab oleh uang yang datang.")}
                  icon={TrendingUp} rows={incoming} muted
                />
              )}

              <p className="px-1 pb-2 text-[12px] text-slate-500">
                {tr("The figures come from the same cash components as the", "Angkanya dari komponen kas yang sama dengan")}{" "}
                <Link href="/accounting/calendar" className="font-medium text-brand-700 hover:underline">
                  {tr("cash calendar", "kalender kas")}
                </Link>{" "}
                {tr("— this screen is another shape of the same calculation, not a second one.", "— layar ini bentuk lain dari perhitungan yang sama, bukan perhitungan kedua.")}
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
  const tr = useTr();
  if (rows.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader title={title} subtitle={subtitle} icon={icon} />
        <p className="px-5 py-6 text-[13px] text-slate-500">{tr("None.", "Tidak ada.")}</p>
      </Card>
    );
  }
  return (
    <Card className={cn("mb-4", tone === "red" && "border-rose-200")}>
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="overflow-x-auto">
        <ExcelTable className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 text-left">{tr("Date", "Tanggal")}</th>
              <th className="px-4 py-2 text-left">{tr("Bill", "Tagihan")}</th>
              <th className="px-4 py-2 text-right">{tr("Planned", "Rencana")}</th>
              <th className="px-4 py-2 text-right">{tr("Paid", "Dibayar")}</th>
              <th className="px-4 py-2 text-right">{tr("This line · last month", "Baris ini · bulan lalu")}</th>
              <th className="px-4 py-2 text-left">{tr("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody className={cn(muted && "opacity-80")}>
            {rows.map((r, i) => (
              <tr key={`${r.component_id}-${r.date}-${i}`} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                  {r.date.slice(8)}/{r.date.slice(5, 7)}
                  {r.days_away < 0 && r.state === "OVERDUE" && (
                    <span className="block text-[10px] text-rose-600">{tr(`${-r.days_away} day(s) late`, `lewat ${-r.days_away} hari`)}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="block text-slate-800">{r.name}</span>
                  <span className="block text-[11px] text-slate-400">
                    {[
                      r.vendor_name,
                      r.account_code,
                      r.matched_by === "category" ? tr("matched by category, not linked by a person", "dicocokkan lewat kategori, bukan ditautkan orang") : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {r.reason && <span className="block text-[11px] text-slate-500">{r.reason}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {r.amount_kind === "estimate" && <span className="text-slate-400" title={tr("Estimate — the exact amount is known only when the bill arrives", "Estimasi — nominal pasti baru diketahui saat tagihan datang")}>≈ </span>}
                  {formatIDR(r.planned)}
                  {r.amount_kind === "estimate" && <span className="block text-[10px] text-slate-400">{tr("estimate", "estimasi")}</span>}
                </td>
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
                  {/* A paid estimate is settled; what it differs by is the news (`0114`). */}
                  {r.variance != null && r.variance !== 0 && (
                    <span className={cn("block text-[10px]", r.variance > 0 ? "text-amber-700" : "text-emerald-700")}>
                      {r.variance > 0 ? "+" : "−"}{formatIDR(Math.abs(r.variance))} {tr("against the estimate", "dari estimasi")}
                    </span>
                  )}
                  {r.outstanding > 0 && r.actual > 0 && (
                    <span className="block text-[10px] text-amber-700">
                      {tr("remaining", "sisa")} {formatIDR(r.outstanding)}
                    </span>
                  )}
                </td>
                {/* The comparison is **per line, per month** (F68). Where the
                    line runs more than once a month the cell says so, because a
                    figure sitting beside a single Rp 30 juta payday will
                    otherwise be read as that payday's own history. */}
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.last_month == null ? (
                    <span className="text-slate-300" title={tr("This line did not exist last month", "Bulan lalu baris ini belum ada")}>—</span>
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
                          title={tr(`${r.occurrences}× a month — compared as a monthly total, not per row`, `${r.occurrences}× sebulan — dibandingkan sebagai total bulanan, bukan per baris`)}
                        >
                          {tr("month total:", "total bulan:")} {formatIDR(r.month_total)}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATE_TONE[r.state]}>{tr(STATE_LABEL[r.state].en, STATE_LABEL[r.state].id)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </ExcelTable>
      </div>
    </Card>
  );
}
