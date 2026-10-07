"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus, EyeOff, CalendarDays, TrendingUp } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { useT, useTr } from "@/lib/i18n";
import type { Cashflow, CashflowCell, CashflowRow, Direction } from "@/services/accounting/contracts";
import { CASHFLOW_IN_CATEGORIES, CASHFLOW_OUT_CATEGORIES } from "@/services/accounting/contracts";
import { CATEGORY_LABEL, STATE_TONE, dayLabel, monthLabel, scheduleLabel, signed, weekLabel } from "./shared";
import { SectionHead } from "./SectionHead";

type Mode = "week" | "month";

/** Sections 2 and 3: every line of cash in (or out), grouped, with its due
 *  date, projected against actual and the difference.
 *
 *  Weekly for the month picked above — the four weeks of it and the month's
 *  total — or the twelve months side by side. A difference is coloured by
 *  what it means on this side: money in short of the plan is bad, money out
 *  over the plan is bad (*over budget*). */
export function FlowSection({
  cf, direction, month, onMonth, onRow, onCell, onAdd, onShowHidden,
}: {
  cf: Cashflow; direction: Direction; month: string; onMonth: (m: string) => void;
  onRow: (r: CashflowRow) => void; onCell: (r: CashflowRow, weekIndex: number) => void;
  onAdd: () => void; onShowHidden?: (key: string) => void;
}) {
  const tr = useTr();
  const t = useT();
  const today = officeToday();
  const [mode, setMode] = useState<Mode>("week");
  const rows = direction === "IN" ? cf.in_rows : cf.out_rows;
  const unplanned = direction === "IN" ? cf.unplanned_in : cf.unplanned_out;
  const cats = direction === "IN" ? CASHFLOW_IN_CATEGORIES : CASHFLOW_OUT_CATEGORIES;

  /* Columns: the month's four weeks plus its total, or twelve months. Each
     column is a set of week indices the cell adds up. */
  const weekIdx = cf.weeks.map((w, i) => ({ w, i })).filter(({ w }) => w.month === month);
  const columns: { key: string; label: string; sub?: string; idx: number[]; started: boolean; current: boolean; total?: boolean }[] =
    mode === "week"
      ? [
        ...weekIdx.map(({ w, i }) => ({
          key: w.start, label: tr(`Week ${w.n}`, `Minggu ${w.n}`), sub: weekLabel(w.start, w.end),
          idx: [i], started: w.start <= today, current: w.is_current,
        })),
        { key: "total", label: tr("Month total", "Total bulan"), sub: monthLabel(month), idx: weekIdx.map((x) => x.i), started: `${month}-01` <= today, current: false, total: true },
      ]
      : cf.months.map((m) => ({
        key: m.month, label: monthLabel(m.month), idx: cf.weeks.map((w, i) => (w.month === m.month ? i : -1)).filter((i) => i >= 0),
        started: m.is_past || m.is_current, current: m.is_current,
      }));

  const sumCells = (cells: CashflowCell[], idx: number[]) => idx.reduce(
    (a, i) => ({ planned: a.planned + cells[i].planned, actual: a.actual + cells[i].actual }), { planned: 0, actual: 0 });
  const sumRows = (list: CashflowRow[], idx: number[]) => list.reduce((a, r) => {
    const s = sumCells(r.cells, idx);
    return { planned: a.planned + s.planned, actual: a.actual + s.actual };
  }, { planned: 0, actual: 0 });
  const unplannedOf = (idx: number[]) => idx.reduce((s, i) => s + unplanned[i].amount, 0);
  /* A difference is only ever against what was due by now: a month half over
     is not under budget by its second half. */
  const startedIdx = (idx: number[]) => idx.filter((i) => cf.weeks[i].start <= today);

  const monthTotals = sumRows(rows, weekIdx.map((x) => x.i));
  const monthToDate = sumRows(rows, startedIdx(weekIdx.map((x) => x.i)));
  const monthUnplanned = unplannedOf(weekIdx.map((x) => x.i));
  const monthDiff = monthTotals.actual + monthUnplanned - monthToDate.planned;
  /* Under the plan because a bill is late is a bill still owed, not money
     saved — so it is not painted green. */
  const owed = rows.reduce((s, r) => s + startedIdx(weekIdx.map((x) => x.i)).reduce((t, i) => {
    const c = r.cells[i];
    return t + (["OVERDUE", "PARTIAL", "DUE"].includes(c.state) ? Math.max(c.planned - c.actual, 0) : 0);
  }, 0), 0);
  const head = direction === "IN"
    ? { n: 2, title: "Cash in", icon: ArrowDownLeft, tone: "text-emerald-700 bg-emerald-50" }
    : { n: 3, title: "Cash out", icon: ArrowUpRight, tone: "text-rose-700 bg-rose-50" };
  const Icon = head.icon;

  const diffTone = (diff: number) => {
    if (diff === 0) return "text-slate-400";
    const bad = direction === "OUT" ? diff > 0 : diff < 0;
    return bad ? "text-rose-600" : "text-emerald-600";
  };

  const valueCell = (planned: number, actual: number, started: boolean, state?: CashflowCell["state"], strong = false, toDate = planned) => {
    if (planned === 0 && actual === 0) return <span className="text-[12px] text-slate-300">—</span>;
    const diff = actual - toDate;
    return (
      <>
        <span className={cn("block tabular-nums", strong ? "text-[13px] font-semibold text-slate-800" : "text-[13px]", !strong && state ? STATE_TONE[state] : !strong && "text-slate-700")}>
          {formatIDRCompact(planned)}
        </span>
        {(started || actual > 0) && (
          <span className="block text-[11px] tabular-nums text-slate-500">
            {tr("act.", "akt.")} {formatIDRCompact(actual)}
          </span>
        )}
        {started && diff !== 0 && (
          <span className={cn("block text-[10px] font-medium tabular-nums", diffTone(diff))}
            title={toDate !== planned ? tr(`against ${formatIDRCompact(toDate)} due by today`, `dibanding ${formatIDRCompact(toDate)} yang jatuh tempo s.d. hari ini`) : undefined}>
            {signed(diff, formatIDRCompact)}{toDate !== planned && <span className="font-normal text-slate-400"> {tr("to date", "s.d. kini")}</span>}
          </span>
        )}
      </>
    );
  };

  return (
    <section id={direction === "IN" ? "cash-in" : "cash-out"} className="mb-6 scroll-mt-20">
      <SectionHead
        n={head.n}
        title={head.title}
        action={<Button size="sm" icon={Plus} onClick={onAdd}>{direction === "IN" ? tr("Expected income", "Estimasi pemasukan") : tr("Expected spending", "Estimasi pengeluaran")}</Button>}
      />

      <Card>
        {/* The month's answer for this side, before the grid. */}
        <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
          {([
            [tr(`Projected · ${monthLabel(month)}`, `Proyeksi · ${monthLabel(month)}`), formatIDRCompact(monthTotals.planned), "text-slate-800"],
            [tr("Actual", "Aktual"), formatIDRCompact(monthTotals.actual + monthUnplanned), "text-slate-800"],
            [tr("Difference to date", "Selisih s.d. kini"), signed(monthDiff, formatIDRCompact), owed > 0 && monthDiff < 0 ? "text-amber-700" : diffTone(monthDiff)],
            [direction === "IN" ? tr("Unplanned in", "Masuk di luar rencana") : tr("Unplanned out", "Keluar di luar rencana"), formatIDRCompact(monthUnplanned), monthUnplanned > 0 ? "text-amber-700" : "text-slate-400"],
          ] as [string, string, string][]).map(([k, v, c]) => (
            <div key={k} className="bg-white px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                {k === tr("Actual", "Aktual") && <span className={cn("flex h-4 w-4 items-center justify-center rounded", head.tone)}><Icon className="h-3 w-3" /></span>}
                {k}
              </p>
              <p className={cn("mt-0.5 whitespace-nowrap text-base font-bold tabular-nums sm:text-lg", c)}>{v}</p>
              {k === tr("Difference to date", "Selisih s.d. kini") && owed > 0 && (
                <p className="text-[11px] text-amber-700">
                  {direction === "IN"
                    ? tr(`${formatIDRCompact(owed)} due, not yet received`, `${formatIDRCompact(owed)} jatuh tempo, belum diterima`)
                    : tr(`${formatIDRCompact(owed)} due, not yet paid`, `${formatIDRCompact(owed)} jatuh tempo, belum dibayar`)}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "week", label: tr("Weekly", "Mingguan") },
              { value: "month", label: tr("12 months", "12 bulan") },
            ]}
          />
          {mode === "week" && (
            <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 no-scrollbar">
              {cf.months.map((m) => (
                <button
                  key={m.month}
                  onClick={() => onMonth(m.month)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-2.5 py-1 text-[12px]",
                    m.month === month ? "bg-brand-600 font-medium text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {monthLabel(m.month)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className={cn("w-full border-collapse", mode === "week" ? "min-w-[720px] sm:min-w-[860px]" : "min-w-[1500px]")}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="sticky left-0 z-10 w-[150px] bg-slate-50 px-3 py-2 text-left sm:w-[240px] sm:px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {tr("Line", "Baris")}
                </th>
                <th className="hidden whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">
                  {tr("Due", "Jatuh tempo")}
                </th>
                {columns.map((c) => (
                  <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-right", c.total && "border-l border-slate-200 bg-slate-100/60")}>
                    <span className={cn("block text-[11px] font-semibold uppercase tracking-wide", c.current ? "text-brand-700" : "text-slate-500")}>{c.label}</span>
                    {c.sub && <span className="block text-[10px] font-normal text-slate-400">{c.sub}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => {
                const group = rows.filter((r) => r.line.category === cat);
                if (group.length === 0) return null;
                return [
                  <tr key={cat} className="border-b border-slate-100 bg-slate-50/40">
                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 sm:px-4">
                      {t(CATEGORY_LABEL[cat])} <span className="font-normal text-slate-400">· {group.length}</span>
                    </th>
                    <td className="hidden bg-slate-50 sm:table-cell" />
                    {columns.map((c) => {
                      const s = sumRows(group, c.idx);
                      return (
                        <td key={c.key} className={cn("px-3 py-1.5 text-right text-[12px] font-medium tabular-nums text-slate-600", c.total && "border-l border-slate-200 bg-slate-100/40")}>
                          {s.planned || s.actual ? formatIDRCompact(s.planned) : ""}
                        </td>
                      );
                    })}
                  </tr>,
                  ...group.map((r) => (
                    <tr key={r.key} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                      <th scope="row" className="sticky left-0 z-10 cursor-pointer bg-white px-3 py-2 text-left hover:bg-slate-50 sm:px-4" onClick={() => onRow(r)}>
                        <span className="block text-[13px] font-medium leading-snug text-slate-800 underline-offset-2 hover:underline">{r.line.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {r.source === "calendar" && <Chip tone="sky">{tr("monthly bill", "tagihan bulanan")}</Chip>}
                          {r.source === "subscription" && <Chip tone="violet">{tr("subscription", "langganan")}</Chip>}
                          {r.project_code && <Chip tone="slate">{r.project_code}</Chip>}
                          {r.line.growth_pct !== 0 && (
                            <Chip tone="emerald"><TrendingUp className="mr-0.5 inline h-2.5 w-2.5" />{r.line.growth_pct > 0 ? "+" : ""}{r.line.growth_pct}%/{tr("mo", "bln")}</Chip>
                          )}
                          {r.source !== "own" && r.line.amount !== null && <Chip tone="amber">{tr("amount changed", "nominal diubah")}</Chip>}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-500 sm:hidden">{scheduleLabel(r, tr)}</span>
                      </th>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-[12px] text-slate-600 sm:table-cell">
                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 text-slate-400" />{scheduleLabel(r, tr)}</span>
                        {r.next_due && <span className="block text-[10px] text-slate-400">{tr("next", "berikut")} {dayLabel(r.next_due)}</span>}
                      </td>
                      {columns.map((c) => {
                        const s = sumCells(r.cells, c.idx);
                        const toDate = sumCells(r.cells, startedIdx(c.idx)).planned;
                        const cell = c.idx.length === 1 ? r.cells[c.idx[0]] : null;
                        const clickable = mode === "week" && !c.total && cell;
                        return (
                          <td
                            key={c.key}
                            onClick={clickable ? () => onCell(r, c.idx[0]) : undefined}
                            title={cell ? [
                              cell.dates.length ? tr(`due ${cell.dates.map(dayLabel).join(", ")}`, `jatuh tempo ${cell.dates.map(dayLabel).join(", ")}`) : "",
                              cell.reason ? `${tr("changed", "diubah")}: ${cell.reason}` : "",
                              cell.trx_nos.length ? cell.trx_nos.join(", ") : "",
                            ].filter(Boolean).join("\n") : undefined}
                            className={cn(
                              "whitespace-nowrap px-3 py-2 text-right align-top",
                              clickable && "cursor-pointer hover:bg-brand-50/60",
                              c.total && "border-l border-slate-200 bg-slate-50/60",
                            )}
                          >
                            {cell?.state === "SKIPPED"
                              ? <span className="text-[11px] text-slate-400" title={cell.reason ?? undefined}>{tr("skipped", "dilewati")}</span>
                              : valueCell(s.planned, s.actual, c.started, cell?.state, c.total, toDate)}
                            {cell?.overridden && cell.state !== "SKIPPED" && <span className="block text-[10px] text-violet-600">{tr("changed", "diubah")}</span>}
                            {cell && cell.dates.length > 0 && mode === "week" && (
                              <span className="block text-[10px] text-slate-400">{tr("day", "tgl")} {cell.dates.map((d) => Number(d.slice(8, 10))).join(", ")}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ];
              })}

              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 2} className="px-4 py-6 text-center text-sm text-slate-500">
                  {direction === "IN"
                    ? tr("No expected income yet. Add a client's termin, a DP, or any money you expect.", "Belum ada estimasi pemasukan. Tambahkan termin klien, DP, atau uang lain yang diharapkan.")
                    : tr("No spending planned.", "Belum ada pengeluaran direncanakan.")}
                </td></tr>
              )}

              {/* The row that keeps the plan honest (D111): actual money no
                  line claimed. */}
              <tr className="border-b border-slate-100 bg-amber-50/40">
                <th className="sticky left-0 z-10 bg-amber-50 px-3 py-2 text-left sm:px-4">
                  <span className="block text-[13px] font-medium text-amber-900">{direction === "IN" ? tr("In, not in the plan", "Masuk di luar rencana") : tr("Out, not in the plan", "Keluar di luar rencana")}</span>
                  <span className="block text-[11px] text-amber-700">{tr("ledger rows no line claimed (transfers between our own accounts excluded)", "baris ledger yang tidak diklaim baris mana pun (transfer antar rekening sendiri tidak dihitung)")}</span>
                </th>
                <td className="hidden sm:table-cell" />
                {columns.map((c) => {
                  const u = unplannedOf(c.idx);
                  const types = direction === "OUT" ? c.idx.flatMap((i) => cf.unplanned_out[i].top_types) : [];
                  return (
                    <td key={c.key} className={cn("px-3 py-2 text-right text-[13px] tabular-nums text-amber-800", c.total && "border-l border-slate-200")}
                      title={types.map((x) => `${x.type_code}: ${formatIDRCompact(x.amount)}`).join("\n") || undefined}>
                      {u > 0 ? formatIDRCompact(u) : <span className="text-[12px] text-slate-300">—</span>}
                    </td>
                  );
                })}
              </tr>

              <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-[12px] font-semibold text-slate-800 sm:px-4">
                  {direction === "IN" ? tr("Total cash in", "Total cash in") : tr("Total cash out", "Total cash out")}
                  <span className="block text-[10px] font-normal text-slate-500">{tr("projected · actual · difference", "proyeksi · aktual · selisih")}</span>
                </th>
                <td className="hidden sm:table-cell" />
                {columns.map((c) => {
                  const s = sumRows(rows, c.idx);
                  const toDate = sumRows(rows, startedIdx(c.idx)).planned;
                  return (
                    <td key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-right align-top", c.total && "border-l border-slate-200 bg-slate-100/60")}>
                      {valueCell(s.planned, s.actual + unplannedOf(c.idx), c.started, undefined, true, toDate)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          <span>{tr("Top: projected. Under it: actual and the difference.", "Atas: proyeksi. Di bawahnya: aktual dan selisihnya.")}</span>
          <span><span className="text-rose-600">●</span> {direction === "OUT" ? tr("over budget / late", "melebihi budget / terlambat") : tr("short / late", "kurang / terlambat")}</span>
          <span><span className="text-emerald-600">●</span> {direction === "OUT" ? tr("under budget / paid", "di bawah budget / lunas") : tr("received", "diterima")}</span>
          {mode === "week" && <span>{tr("Tap a week to change just that week.", "Ketuk satu minggu untuk mengubah minggu itu saja.")}</span>}
        </div>

        {direction === "OUT" && cf.hidden.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
            <EyeOff className="h-3.5 w-3.5" />
            {tr("Left out of the cashflow:", "Tidak dihitung di cashflow:")}
            {cf.hidden.map((h) => (
              <button key={h.key} onClick={() => onShowHidden?.(h.key)} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200" title={tr("Put it back", "Kembalikan")}>
                {h.name} ↺
              </button>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function Chip({ tone, children }: { tone: "sky" | "violet" | "slate" | "emerald" | "amber"; children: React.ReactNode }) {
  return (
    <span className={cn(
      "rounded px-1.5 py-0.5 text-[10px] font-normal",
      tone === "sky" && "bg-sky-50 text-sky-700",
      tone === "violet" && "bg-violet-50 text-violet-700",
      tone === "slate" && "bg-slate-100 text-slate-600",
      tone === "emerald" && "bg-emerald-50 text-emerald-700",
      tone === "amber" && "bg-amber-50 text-amber-700",
    )}>
      {children}
    </span>
  );
}
