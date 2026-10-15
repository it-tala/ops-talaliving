"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, TrendingUp, Landmark, ArrowLeftRight, Building2, Store, CalendarRange } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { ExcelTable } from "@/components/ui/excel-export";
import { Tabs } from "@/components/ui/tabs";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type {
  Category, CategoryMonthRow, CategorySummary, ProjectSpendRow, TransferMonthRow, VendorSpendRow,
} from "@/services/accounting/contracts";
import { BURN_CATEGORIES, CATEGORIES, CATEGORY_NOTES } from "@/services/accounting/categories";
import { CategoryBadge, categoryLabel } from "@/components/accounting/category";
import { LiquidationReport } from "../liquidation/Report";
import { useSession } from "@/store/session";
import { useTr, type Tr } from "@/lib/i18n";
import { monthLabel } from "../cashflow/shared";

/** Leadership's reading of the ledger (L9; D433, D435; kajian §6.8).
 *
 *  Five questions, one tab each: how much went where, month by month; what
 *  each project cost against its contract; who was paid most; what moved
 *  between our own accounts; and — the liquidation report (D106) — where
 *  each transfer of operating money went before the next one arrived.
 *
 *  Everything is the ledger counted by **category** (`0274`): the type's,
 *  unless the row carries its own; a fee line counts to bank and a tax line
 *  to tax whatever the row says. Nothing here is a budget or a plan. A cell
 *  opens the ledger on exactly those rows, so a figure is never the end of
 *  the question. Every table downloads as Excel (D427).
 */
const OUT_CATEGORIES: Category[] = CATEGORIES.filter((c) => c !== "income");
const IN_CATEGORIES: Category[] = ["income", "transfer"];
const TABS = ["bulan", "proyek", "vendor", "transfer", "bank", "likuidasi"] as const;

const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
const ledgerHref = (category: Category, month?: string) =>
  `/accounting/ledger?category=${category}${month ? `&month=${month}` : ""}`;

export default function RingkasanPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const [year, setYear] = useState(officeToday().slice(0, 4));
  const [tab, setTab] = useState<(typeof TABS)[number]>("bulan");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as readonly string[]).includes(t)) setTab(t as (typeof TABS)[number]);
  }, []);
  const [data, reload] = useLoad(() => accounting.getCategorySummary(year), [year], { keepPrevious: true });

  /* The door is the authority, as on the cashflow (D392): these are the
     leadership's sums, and `approve_funds` is who leadership is. */
  if (!hasAuthority("approve_funds")) {
    return (
      <div>
        <PageHeader breadcrumb={tr("Accounting", "Akuntansi")} title={tr("Summary", "Ringkasan")} />
        <Card className="flex items-start gap-3 p-5 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          {tr("The summary is leadership's reading of the ledger: how much went where, per project, per vendor, and where each transfer went. Only people who approve funds open it.",
            "Ringkasan adalah bacaan pimpinan atas buku besar: berapa pergi ke mana, per proyek, per vendor, dan ke mana tiap transfer pergi. Hanya pemegang persetujuan dana yang bisa membukanya.")}
        </Card>
      </div>
    );
  }

  const thisYear = Number(officeToday().slice(0, 4));
  const years = [thisYear, thisYear - 1, thisYear - 2].map(String);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Summary", "Ringkasan")}
        description={tr("The ledger counted by category — the type's, unless a row carries its own; admin fees to bank and tax lines to tax whatever the row says. Click a figure to open those rows in the ledger.",
          "Buku besar dihitung per kategori — dari jenisnya, kecuali barisnya punya sendiri; biaya admin ke bank dan baris pajak ke pajak apa pun jenis barisnya. Klik angka untuk membuka baris-barisnya di buku besar.")}
        actions={(
          <select
            id="rk-year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      />

      <Loaded state={data} onRetry={reload}>
        {(s) => (
          <Tabs
            key={tab}
            defaultId={tab}
            items={[
              { id: "bulan", label: tr("Month × category", "Bulan × kategori"), content: <MonthMatrix s={s} tr={tr} /> },
              { id: "proyek", label: tr("Per project", "Per proyek"), content: <ProjectTable s={s} tr={tr} /> },
              { id: "vendor", label: tr("Vendors", "Vendor"), content: <VendorTable s={s} tr={tr} /> },
              { id: "transfer", label: tr("Transfers", "Transfer"), content: <TransferTable s={s} tr={tr} /> },
              { id: "bank", label: tr("Bank fees", "Biaya bank"), content: <BankTable s={s} tr={tr} /> },
              { id: "likuidasi", label: tr("Liquidation", "Likuidasi"), content: <div className="pt-4"><LiquidationReport /></div> },
            ]}
          />
        )}
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month × category                                                    */
/* ------------------------------------------------------------------ */

function cellOf(rows: CategoryMonthRow[], month: string, direction: "IN" | "OUT", category: Category) {
  return rows.find((r) => r.month === month && r.direction === direction && r.category === category) ?? null;
}

const th = "whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const tdNum = "whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-[13px]";

function MonthMatrix({ s, tr }: { s: CategorySummary; tr: Tr }) {
  const months = monthsOf(s.year).filter((m) => s.months.some((r) => r.month === m));
  const totalOf = (direction: "IN" | "OUT", category: Category) =>
    s.months.filter((r) => r.direction === direction && r.category === category).reduce((x, r) => x + r.amount, 0);
  const rowTotal = (month: string, direction: "IN" | "OUT", cats: Category[]) =>
    cats.reduce((x, c) => x + (cellOf(s.months, month, direction, c)?.amount ?? 0), 0);
  const burn = BURN_CATEGORIES.reduce((x, c) => x + totalOf("OUT", c), 0);
  const outAll = OUT_CATEGORIES.reduce((x, c) => x + totalOf("OUT", c), 0);
  const inAll = IN_CATEGORIES.reduce((x, c) => x + totalOf("IN", c), 0);

  const Cell = ({ month, direction, category }: { month: string; direction: "IN" | "OUT"; category: Category }) => {
    const c = cellOf(s.months, month, direction, category);
    if (!c || c.amount === 0) return <td className={cn(tdNum, "text-slate-300")}>—</td>;
    return (
      <td className={cn(tdNum, "text-slate-700")}>
        <Link href={ledgerHref(category, month)} className="hover:text-brand-700 hover:underline" title={tr(`${c.n} row(s) — open them in the ledger`, `${c.n} baris — buka di buku besar`)}>
          {formatIDRCompact(c.amount)}
        </Link>
      </td>
    );
  };

  if (months.length === 0) {
    return <p className="px-1 py-6 text-sm text-slate-500">{tr(`Nothing booked in ${s.year}.`, `Tidak ada yang dibukukan pada ${s.year}.`)}</p>;
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          [tr("Money out", "Uang keluar"), outAll, tr("every category but income", "semua kategori kecuali pemasukan")],
          [tr("Running cost (burn)", "Biaya rutin (burn)"), burn, tr("payroll · fixed · overhead · bank · tax", "payroll · tetap · overhead · bank · pajak")],
          [tr("Money in", "Uang masuk"), inAll, tr("income and transfers in", "pemasukan dan transfer masuk")],
        ] as [string, number, string][]).map(([k, v, note]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-800">{formatIDR(v)}</p>
            <p className="text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title={tr("Money out, by month and category", "Uang keluar, per bulan dan kategori")} icon={CalendarRange}
          subtitle={tr("EJO and Saripan are counted apart and left out of the burn (D435).", "EJO dan Saripan dihitung terpisah dan tidak masuk burn (D435).")} />
        <div className="overflow-x-auto">
          <ExcelTable name={tr(`Summary ${s.year} out`, `Ringkasan ${s.year} keluar`)} className="w-full border-collapse" style={{ minWidth: `${160 + (OUT_CATEGORIES.length + 1) * 96}px` }}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Month", "Bulan")}</th>
                {OUT_CATEGORIES.map((c) => (
                  <th key={c} className={th} title={tr(CATEGORY_NOTES[c].en, CATEGORY_NOTES[c].id)}>{categoryLabel(c, tr)}</th>
                ))}
                <th className={cn(th, "border-l border-slate-200 bg-slate-100/60")}>{tr("Total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m} className="border-b border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700">{monthLabel(m)}</td>
                  {OUT_CATEGORIES.map((c) => <Cell key={c} month={m} direction="OUT" category={c} />)}
                  <td className={cn(tdNum, "border-l border-slate-200 bg-slate-50/60 font-semibold text-slate-800")}>{formatIDRCompact(rowTotal(m, "OUT", OUT_CATEGORIES))}</td>
                </tr>
              ))}
              <tr className="bg-slate-50/70 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-[12px] uppercase tracking-wide text-slate-600">{tr("Year", "Setahun")}</td>
                {OUT_CATEGORIES.map((c) => {
                  const v = totalOf("OUT", c);
                  return (
                    <td key={c} className={cn(tdNum, "text-slate-800")}>
                      {v ? <Link href={ledgerHref(c)} className="hover:text-brand-700 hover:underline">{formatIDRCompact(v)}</Link> : "—"}
                    </td>
                  );
                })}
                <td className={cn(tdNum, "border-l border-slate-200 text-slate-900")}>{formatIDRCompact(outAll)}</td>
              </tr>
            </tbody>
          </ExcelTable>
        </div>
      </Card>

      <Card>
        <CardHeader title={tr("Money in, by month", "Uang masuk, per bulan")} icon={Landmark}
          subtitle={tr("Income is money from outside; a transfer in is our own money arriving from another account.", "Pemasukan adalah uang dari luar; transfer masuk adalah uang sendiri yang datang dari rekening lain.")} />
        <div className="overflow-x-auto">
          <ExcelTable name={tr(`Summary ${s.year} in`, `Ringkasan ${s.year} masuk`)} className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Month", "Bulan")}</th>
                {IN_CATEGORIES.map((c) => <th key={c} className={th}>{c === "transfer" ? tr("Transfer in", "Transfer masuk") : categoryLabel(c, tr)}</th>)}
                <th className={cn(th, "border-l border-slate-200 bg-slate-100/60")}>{tr("Total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 text-[13px] font-medium text-slate-700">{monthLabel(m)}</td>
                  {IN_CATEGORIES.map((c) => <Cell key={c} month={m} direction="IN" category={c} />)}
                  <td className={cn(tdNum, "border-l border-slate-200 bg-slate-50/60 font-semibold text-slate-800")}>{formatIDRCompact(rowTotal(m, "IN", IN_CATEGORIES))}</td>
                </tr>
              ))}
              <tr className="bg-slate-50/70 font-semibold">
                <td className="px-3 py-2 text-[12px] uppercase tracking-wide text-slate-600">{tr("Year", "Setahun")}</td>
                {IN_CATEGORIES.map((c) => <td key={c} className={cn(tdNum, "text-slate-800")}>{formatIDRCompact(totalOf("IN", c))}</td>)}
                <td className={cn(tdNum, "border-l border-slate-200 text-slate-900")}>{formatIDRCompact(inAll)}</td>
              </tr>
            </tbody>
          </ExcelTable>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per project                                                         */
/* ------------------------------------------------------------------ */

interface ProjectLine {
  project_id: string; project_code: string; project_name: string; contract_value: number | null;
  amount: number; n: number; last_date: string; by: Partial<Record<Category, number>>;
}

function ProjectTable({ s, tr }: { s: CategorySummary; tr: Tr }) {
  const map = new Map<string, ProjectLine>();
  for (const r of s.projects) {
    const p = map.get(r.project_id) ?? {
      project_id: r.project_id, project_code: r.project_code, project_name: r.project_name,
      contract_value: r.contract_value, amount: 0, n: 0, last_date: "", by: {},
    };
    p.amount += r.amount; p.n += r.n;
    p.by[r.category] = (p.by[r.category] ?? 0) + r.amount;
    if (r.last_date > p.last_date) p.last_date = r.last_date;
    map.set(r.project_id, p);
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((x, r) => x + r.amount, 0);

  const columns: Column<ProjectLine>[] = [
    {
      key: "project", header: tr("Project", "Proyek"),
      render: (p) => (
        <div>
          <p className="font-medium text-slate-800">{p.project_name}</p>
          <p className="font-mono text-[10px] text-slate-400">{p.project_code}</p>
        </div>
      ),
    },
    { key: "spent", header: tr("Spent", "Terpakai"), align: "right", render: (p) => <span className="font-semibold tabular-nums text-slate-800">{formatIDR(p.amount)}</span> },
    {
      key: "contract", header: tr("Contract", "Kontrak"), align: "right",
      render: (p) => p.contract_value ? (
        <div>
          <p className="tabular-nums text-slate-700">{formatIDR(p.contract_value)}</p>
          <p className={cn("text-[11px] tabular-nums", p.amount > p.contract_value ? "text-rose-700" : "text-slate-400")}>
            {Math.round((p.amount / p.contract_value) * 100)}%
          </p>
        </div>
      ) : <span className="text-slate-300">—</span>,
    },
    {
      key: "by", header: tr("Of which", "Di antaranya"), className: "whitespace-normal",
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {(Object.entries(p.by) as [Category, number][]).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <span key={c} className="inline-flex items-center gap-1 text-[11px] text-slate-600">
              <CategoryBadge category={c} />{formatIDRCompact(v)}
            </span>
          ))}
        </div>
      ),
    },
    { key: "n", header: tr("Rows", "Baris"), align: "right", render: (p) => <span className="tabular-nums text-slate-500">{p.n}</span> },
    { key: "last", header: tr("Last", "Terakhir"), render: (p) => <span className="text-slate-500">{p.last_date}</span> },
  ];

  return (
    <Card className="mt-4">
      <CardHeader title={tr("Money out per project", "Uang keluar per proyek")} icon={Building2}
        subtitle={tr("Every project with a row on it this year, not only those with a work order; against the contract where one is recorded.", "Setiap proyek yang punya baris tahun ini, bukan hanya yang punya work order; dibandingkan kontraknya bila tercatat.")} />
      <DataTable dense columns={columns} rows={rows} rowKey={(p) => p.project_id}
        exportName={tr(`Projects ${s.year}`, `Proyek ${s.year}`)}
        footer={<tr><td colSpan={columns.length} className="px-4 py-2 text-sm text-slate-600">{tr("Total", "Total")}: <strong className="tabular-nums">{formatIDR(total)}</strong> {tr(`across ${rows.length} project(s)`, `pada ${rows.length} proyek`)}</td></tr>}
        empty={tr("No row named a project this year.", "Belum ada baris yang menyebut proyek tahun ini.")} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Vendors                                                             */
/* ------------------------------------------------------------------ */

interface VendorLine { vendor_id: string; vendor_name: string; amount: number; n: number; last_date: string; top: Category; months: number }

function VendorTable({ s, tr }: { s: CategorySummary; tr: Tr }) {
  const map = new Map<string, VendorLine & { by: Partial<Record<Category, number>>; monthSet: Set<string> }>();
  for (const r of s.vendors) {
    const v = map.get(r.vendor_id) ?? {
      vendor_id: r.vendor_id, vendor_name: r.vendor_name ?? "—", amount: 0, n: 0, last_date: "", top: r.category, months: 0, by: {}, monthSet: new Set<string>(),
    };
    v.amount += r.amount; v.n += r.n; v.monthSet.add(r.month);
    v.by[r.category] = (v.by[r.category] ?? 0) + r.amount;
    if (r.last_date > v.last_date) v.last_date = r.last_date;
    map.set(r.vendor_id, v);
  }
  const rows: VendorLine[] = [...map.values()].map((v) => ({
    ...v, months: v.monthSet.size,
    top: (Object.entries(v.by) as [Category, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? v.top,
  })).sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((x, r) => x + r.amount, 0);

  const columns: Column<VendorLine>[] = [
    { key: "vendor", header: tr("Vendor", "Vendor"), render: (v) => <span className="font-medium text-slate-800">{v.vendor_name}</span> },
    { key: "amount", header: tr("Paid", "Dibayar"), align: "right", render: (v) => <span className="font-semibold tabular-nums text-slate-800">{formatIDR(v.amount)}</span> },
    { key: "share", header: tr("Share", "Porsi"), align: "right", render: (v) => <span className="tabular-nums text-slate-500">{total ? Math.round((v.amount / total) * 100) : 0}%</span> },
    { key: "cat", header: tr("Mostly", "Terbanyak"), render: (v) => <CategoryBadge category={v.top} /> },
    { key: "n", header: tr("Rows", "Baris"), align: "right", render: (v) => <span className="tabular-nums text-slate-500">{v.n}</span> },
    { key: "months", header: tr("Months", "Bulan"), align: "right", render: (v) => <span className="tabular-nums text-slate-500">{v.months}</span> },
    { key: "last", header: tr("Last", "Terakhir"), render: (v) => <span className="text-slate-500">{v.last_date}</span> },
  ];

  return (
    <Card className="mt-4">
      <CardHeader title={tr("Who was paid most", "Siapa yang paling banyak dibayar")} icon={Store}
        subtitle={tr("Money out per vendor this year, largest first. Rows with no vendor named are not here.", "Uang keluar per vendor tahun ini, terbesar dulu. Baris tanpa vendor tidak masuk.")} />
      <DataTable dense columns={columns} rows={rows} rowKey={(v) => v.vendor_id} pageSize={25}
        exportName={tr(`Vendors ${s.year}`, `Vendor ${s.year}`)}
        footer={<tr><td colSpan={columns.length} className="px-4 py-2 text-sm text-slate-600">{tr("Total", "Total")}: <strong className="tabular-nums">{formatIDR(total)}</strong> {tr(`to ${rows.length} vendor(s)`, `ke ${rows.length} vendor`)}</td></tr>}
        empty={tr("No row named a vendor this year.", "Belum ada baris yang menyebut vendor tahun ini.")} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Transfers between our own accounts                                  */
/* ------------------------------------------------------------------ */

function TransferTable({ s, tr }: { s: CategorySummary; tr: Tr }) {
  const months = monthsOf(s.year).filter((m) => s.transfers.some((r) => r.month === m));
  const accounts = [...new Map(s.transfers.map((r) => [r.account_code, r])).values()]
    .sort((a, b) => (a.custody === b.custody ? a.account_code.localeCompare(b.account_code) : a.custody === "leadership" ? -1 : 1));
  const at = (m: string, code: string) => s.transfers.find((r) => r.month === m && r.account_code === code) ?? null;
  const sumOut = (m: string) => s.transfers.filter((r) => r.month === m).reduce((x, r) => x + (r.transfer_out ?? 0), 0);
  const sumIn = (m: string) => s.transfers.filter((r) => r.month === m).reduce((x, r) => x + (r.transfer_in ?? 0), 0);
  const yearOut = s.transfers.reduce((x, r) => x + (r.transfer_out ?? 0), 0);
  const yearIn = s.transfers.reduce((x, r) => x + (r.transfer_in ?? 0), 0);

  const Pair = ({ r }: { r: TransferMonthRow | null }) => (
    <>
      <td className={cn(tdNum, r?.transfer_out ? "text-rose-700" : "text-slate-300")}>{r?.transfer_out ? `−${formatIDRCompact(r.transfer_out)}` : "—"}</td>
      <td className={cn(tdNum, r?.transfer_in ? "text-emerald-700" : "text-slate-300")}>{r?.transfer_in ? `+${formatIDRCompact(r.transfer_in)}` : "—"}</td>
    </>
  );

  return (
    <Card className="mt-4">
      <CardHeader title={tr("Transfers between our own accounts", "Transfer antar rekening sendiri")} icon={ArrowLeftRight}
        subtitle={tr("What left each account and what landed on it, as transfers. Out and in should match across a month; the difference is money on the way or a leg never booked.", "Yang keluar dari tiap rekening dan yang masuk ke sana, sebagai transfer. Keluar dan masuk semestinya sama dalam sebulan; selisihnya uang di jalan atau satu sisi yang belum dibukukan.")} />
      {months.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{tr("No transfers this year.", "Tidak ada transfer tahun ini.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <ExcelTable name={tr(`Transfers ${s.year}`, `Transfer ${s.year}`)} className="w-full border-collapse" style={{ minWidth: `${160 + (accounts.length + 1) * 180}px` }}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th rowSpan={2} className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Month", "Bulan")}</th>
                {accounts.map((a) => (
                  <th key={a.account_code} colSpan={2} className={cn(th, "border-l border-slate-200 text-center")}>
                    {a.account_code}{a.custody === "leadership" && <Badge tone="violet" className="ml-1">{tr("leadership", "pimpinan")}</Badge>}
                  </th>
                ))}
                <th colSpan={3} className={cn(th, "border-l border-slate-200 bg-slate-100/60 text-center")}>{tr("All accounts", "Semua rekening")}</th>
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                {accounts.map((a) => (
                  <React.Fragment key={a.account_code}>
                    <th className={cn(th, "border-l border-slate-200 font-medium normal-case")}>{tr("out", "keluar")}</th>
                    <th className={cn(th, "font-medium normal-case")}>{tr("in", "masuk")}</th>
                  </React.Fragment>
                ))}
                <th className={cn(th, "border-l border-slate-200 bg-slate-100/60 font-medium normal-case")}>{tr("out", "keluar")}</th>
                <th className={cn(th, "bg-slate-100/60 font-medium normal-case")}>{tr("in", "masuk")}</th>
                <th className={cn(th, "bg-slate-100/60 font-medium normal-case")}>{tr("difference", "selisih")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const o = sumOut(m); const i = sumIn(m);
                return (
                  <tr key={m} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700">{monthLabel(m)}</td>
                    {accounts.map((a) => <Pair key={a.account_code} r={at(m, a.account_code)} />)}
                    <td className={cn(tdNum, "border-l border-slate-200 bg-slate-50/60 text-slate-700")}>{formatIDRCompact(o)}</td>
                    <td className={cn(tdNum, "bg-slate-50/60 text-slate-700")}>{formatIDRCompact(i)}</td>
                    <td className={cn(tdNum, "bg-slate-50/60 font-semibold", o === i ? "text-slate-400" : "text-amber-700")}>{o === i ? "0" : formatIDRCompact(o - i)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50/70 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-[12px] uppercase tracking-wide text-slate-600">{tr("Year", "Setahun")}</td>
                {accounts.map((a) => {
                  const o = s.transfers.filter((r) => r.account_code === a.account_code).reduce((x, r) => x + (r.transfer_out ?? 0), 0);
                  const i = s.transfers.filter((r) => r.account_code === a.account_code).reduce((x, r) => x + (r.transfer_in ?? 0), 0);
                  return <Pair key={a.account_code} r={{ ...a, transfer_out: o || null, transfer_in: i || null }} />;
                })}
                <td className={cn(tdNum, "border-l border-slate-200 text-slate-800")}>{formatIDRCompact(yearOut)}</td>
                <td className={cn(tdNum, "text-slate-800")}>{formatIDRCompact(yearIn)}</td>
                <td className={cn(tdNum, yearOut === yearIn ? "text-slate-400" : "text-amber-700")}>{formatIDRCompact(yearOut - yearIn)}</td>
              </tr>
            </tbody>
          </ExcelTable>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Bank fees                                                           */
/* ------------------------------------------------------------------ */

function BankTable({ s, tr }: { s: CategorySummary; tr: Tr }) {
  const rows = monthsOf(s.year)
    .map((m) => ({ month: m, cell: cellOf(s.months, m, "OUT", "bank") }))
    .filter((r) => r.cell && r.cell.amount > 0)
    .map((r) => ({ month: r.month, n: r.cell!.n, amount: r.cell!.amount }));
  const total = rows.reduce((x, r) => x + r.amount, 0);
  const n = rows.reduce((x, r) => x + r.n, 0);
  const columns: Column<{ month: string; n: number; amount: number }>[] = [
    { key: "month", header: tr("Month", "Bulan"), render: (r) => <Link href={ledgerHref("bank", r.month)} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">{monthLabel(r.month, true)}</Link> },
    { key: "n", header: tr("Rows", "Baris"), align: "right", render: (r) => <span className="tabular-nums text-slate-500">{r.n}</span> },
    { key: "amount", header: tr("Fees", "Biaya"), align: "right", render: (r) => <span className="font-semibold tabular-nums text-slate-800">{formatIDR(r.amount)}</span> },
    { key: "avg", header: tr("Per row", "Per baris"), align: "right", render: (r) => <span className="tabular-nums text-slate-500">{formatIDR(Math.round(r.amount / r.n))}</span> },
  ];
  return (
    <Card className="mt-4">
      <CardHeader title={tr("Bank fees", "Biaya bank")} icon={TrendingUp}
        subtitle={tr("Admin fees and card interest: the BANK CHARGES rows, and the admin-fee line of any other row.", "Biaya admin dan bunga kartu: baris BANK CHARGES, dan baris biaya admin pada transaksi apa pun.")} />
      <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.month}
        exportName={tr(`Bank fees ${s.year}`, `Biaya bank ${s.year}`)}
        footer={<tr><td colSpan={columns.length} className="px-4 py-2 text-sm text-slate-600">{tr("Total", "Total")}: <strong className="tabular-nums">{formatIDR(total)}</strong> {tr(`over ${n} row(s)`, `pada ${n} baris`)}</td></tr>}
        empty={tr("No bank fees this year.", "Tidak ada biaya bank tahun ini.")} />
    </Card>
  );
}
