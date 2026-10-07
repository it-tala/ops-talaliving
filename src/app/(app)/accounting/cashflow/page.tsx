"use client";

import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, ShieldAlert, Wallet, ArrowDownLeft, ArrowUpRight, Landmark, Settings2, Lock,
  ChevronRight, ChevronDown,
} from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { BalanceChart } from "@/components/charts/charts";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { Cashflow, CashflowMonth, CashflowRow, Direction } from "@/services/accounting/contracts";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { addMonths } from "@/services/accounting/cashflow";
import { monthLabel, signed, weekLabel } from "./shared";
import { FlowSection } from "./FlowSection";
import { LineDrawer } from "./LineDrawer";
import { BillDrawer } from "./BillDrawer";
import { WeekDialog } from "./WeekDialog";
import { OpeningDrawer } from "./OpeningDrawer";
import { SettingsDrawer } from "./SettingsDrawer";
import { SectionHead } from "./SectionHead";

/** Leadership's cashflow (D392) — *kapan kita kehabisan dana, dan apakah kita
 *  underbudget atau aman*.
 *
 *  One page, three sections, in the owner's order: the whole picture (cash in,
 *  cash out, balance), then cash in, then cash out. The walk is the owner's
 *  scheme: this month's starting balance, plus the cash expected in, minus the
 *  cash going out, is next month's starting balance — week by week, so the
 *  week it breaks is named, not just the month.
 *
 *  The monthly bills come from the payment calendar and the subscription
 *  register as they are; what this screen changes about them (a bigger amount,
 *  growth per month, a week that differs) is the projection's alone and never
 *  reaches accounting's calendar.
 */
export default function CashflowPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const today = officeToday();
  const thisMonth = today.slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [month, setMonth] = useState(thisMonth);
  const [cf, reload] = useLoad(() => accounting.getCashflow(from), [from]);
  const [line, setLine] = useState<CashflowRow | { new: Direction } | null>(null);
  const [bill, setBill] = useState<CashflowRow | null>(null);
  const [week, setWeek] = useState<{ row: CashflowRow; index: number } | null>(null);
  const [opening, setOpening] = useState(false);
  const [settings, setSettings] = useState(false);

  /* The door is the authority, not a module level: accounting holds
     `accounting: admin` and leadership holds `accounting: read`, so a level
     would let the wrong people in and keep the right one out (D392). */
  if (!hasAuthority("approve_funds")) {
    return (
      <div>
        <PageHeader breadcrumb={tr("Accounting", "Akuntansi")} title="Cashflow" />
        <Card className="flex items-start gap-3 p-5 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          {tr("The cashflow is leadership's: it adds up the leadership accounts and the money expected from clients. Only people who approve funds open it.",
            "Cashflow milik pimpinan: ia menjumlahkan rekening pimpinan dan uang yang diharapkan dari klien. Hanya pemegang persetujuan dana yang bisa membukanya.")}
        </Card>
      </div>
    );
  }

  const openRow = (r: CashflowRow) => (r.source === "own" ? setLine(r) : setBill(r));
  const fromOptions = [0, 1, 2, 3].map((n) => addMonths(thisMonth, -n));

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting · leadership", "Akuntansi · pimpinan")}
        title="Cashflow"
        description={tr(
          "Every estimate of money in and out, week by week for twelve months — projected against actual — and the week the money runs out, if it does.",
          "Semua estimasi pemasukan dan pengeluaran, per minggu selama dua belas bulan — proyeksi dibanding aktual — dan minggu dananya habis, kalau habis.",
        )}
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              {tr("Start from", "Mulai dari")}
              <select
                value={from}
                onChange={(e) => { setFrom(e.target.value); setMonth(e.target.value); }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
              >
                {fromOptions.map((m) => <option key={m} value={m}>{monthLabel(m, true)}</option>)}
              </select>
            </label>
            <Button variant="outline" icon={Settings2} onClick={() => setSettings(true)}>{tr("Settings", "Pengaturan")}</Button>
          </>
        }
      />

      <Loaded state={cf} onRetry={reload}>
        {(c) => (
          <>
            <Overview
              cf={c} month={month} onMonth={setMonth} onOpening={() => setOpening(true)}
              badge={<SourceBadge state={cf} />}
            />
            <FlowSection
              cf={c} direction="IN" month={month} onMonth={setMonth}
              onRow={openRow} onCell={(row, index) => setWeek({ row, index })}
              onAdd={() => setLine({ new: "IN" })}
            />
            <FlowSection
              cf={c} direction="OUT" month={month} onMonth={setMonth}
              onRow={openRow} onCell={(row, index) => setWeek({ row, index })}
              onAdd={() => setLine({ new: "OUT" })}
              onShowHidden={(key) => {
                const h = c.hidden.find((x) => x.key === key);
                if (h) void accounting.saveCashflowBill({
                  source_ref: h.key, name: h.name, category: h.source === "subscription" ? "subscription" : "bills",
                  amount: null, growth_pct: 0, growth_from: null, hidden: false,
                }).then(reload);
              }}
            />

            {line && (
              <LineDrawer
                row={"new" in line ? null : line}
                direction={"new" in line ? line.new : line.line.direction}
                receipts={"new" in line ? [] : c.receipts.filter((r) => r.line_id === line.line.id)}
                onClose={() => setLine(null)}
                onSaved={() => { setLine(null); reload(); }}
                onChanged={reload}
              />
            )}
            {bill && <BillDrawer row={bill} onClose={() => setBill(null)} onSaved={() => { setBill(null); reload(); }} />}
            {week && (
              <WeekDialog
                row={week.row} week={c.weeks[week.index]} cell={week.row.cells[week.index]}
                onClose={() => setWeek(null)} onSaved={() => { setWeek(null); reload(); }}
              />
            )}
            {opening && <OpeningDrawer cf={c} onClose={() => setOpening(false)} onSaved={() => { setOpening(false); reload(); }} />}
            {settings && <SettingsDrawer settings={c.settings} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reload(); }} />}
          </>
        )}
      </Loaded>
    </div>
  );
}

/* ── Section 1 ─────────────────────────────────────────────────────────── */

function Overview({
  cf, month, onMonth, onOpening, badge,
}: { cf: Cashflow; month: string; onMonth: (m: string) => void; onOpening: () => void; badge: React.ReactNode }) {
  const tr = useTr();
  const v = cf.verdict;
  const cur = cf.months.find((m) => m.is_current) ?? cf.months[0];
  const weekOf = (start: string | null) => {
    const w = cf.weeks.find((x) => x.start === start);
    return w ? weekLabel(w.start, w.end) + " " + w.start.slice(0, 4) : "—";
  };
  const outDiff = cf.budget.out_actual - cf.budget.out_planned;
  /* Spending under the plan because a bill is late is not being under
     budget — it is a bill still owed. Said as that. */
  const curWeeks = cf.weeks.map((w, i) => (w.month === cf.budget.month && w.start <= cf.generated_for ? i : -1)).filter((i) => i >= 0);
  const owedNow = cf.out_rows.reduce((s, r) => s + curWeeks.reduce((t, i) => {
    const c = r.cells[i];
    return t + (c.state === "OVERDUE" || c.state === "PARTIAL" || c.state === "DUE" ? Math.max(c.planned - c.actual, 0) : 0);
  }, 0), 0);
  const inDiff = cf.budget.in_actual - cf.budget.in_planned;

  const tone = v.state === "short" ? "rose" : v.state === "thin" ? "amber" : "emerald";
  const Icon = v.state === "short" ? AlertTriangle : v.state === "thin" ? ShieldAlert : CheckCircle2;
  const last = cf.months[cf.months.length - 1];

  return (
    <section id="ringkasan" className="mb-6 scroll-mt-20">
      <SectionHead n={1} title={tr("Overview — cash in, cash out, balance", "Ringkasan — cash in, cash out, saldo")} />

      {/* The answer first. */}
      <div className={cn(
        "mb-4 flex items-start gap-3 rounded-xl border px-4 py-3.5",
        tone === "rose" && "border-rose-200 bg-rose-50 text-rose-900",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "emerald" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">
            {v.state === "short"
              ? tr(`The money runs out in the week of ${weekOf(v.runs_out_week)} — ${formatIDR(v.short_by)} short.`,
                `Dana habis di minggu ${weekOf(v.runs_out_week)} — kurang ${formatIDR(v.short_by)}.`)
              : v.state === "thin"
                ? tr(`Safe, but under the minimum of ${formatIDRCompact(cf.settings.min_balance)} from the week of ${weekOf(v.thin_week)}.`,
                  `Masih ada dana, tapi di bawah batas aman ${formatIDRCompact(cf.settings.min_balance)} mulai minggu ${weekOf(v.thin_week)}.`)
                : tr(`Safe through ${monthLabel(last.month, true)} — ending at ${formatIDR(last.closing)}.`,
                  `Aman sampai ${monthLabel(last.month, true)} — saldo akhir ${formatIDR(last.closing)}.`)}
          </p>
          <p className="mt-0.5 text-[13px] opacity-90">
            {v.runway_weeks !== null && tr(`${v.runway_weeks} weeks of runway. `, `Sisa napas ${v.runway_weeks} minggu. `)}
            {tr(`Lowest point ${formatIDRCompact(v.lowest)} in the week of ${weekOf(v.lowest_week)}.`,
              `Titik terendah ${formatIDRCompact(v.lowest)} di minggu ${weekOf(v.lowest_week)}.`)}
            {v.carried_out > 0 && tr(` ${formatIDRCompact(v.carried_out)} of unpaid bills from earlier weeks is counted in this week.`,
              ` ${formatIDRCompact(v.carried_out)} tagihan belum dibayar dari minggu sebelumnya dihitung di minggu ini.`)}
            {v.missed_in > 0 && tr(` ${formatIDRCompact(v.missed_in)} expected in has not arrived and is not assumed to.`,
              ` ${formatIDRCompact(v.missed_in)} pemasukan yang diharapkan belum masuk dan tidak dianggap akan masuk.`)}
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={Landmark} label={tr(`Starting balance · ${monthLabel(cf.from_month)}`, `Saldo awal · ${monthLabel(cf.from_month)}`)}
          value={formatIDR(cf.opening.used)}
          note={cf.opening.typed
            ? tr(`typed by leadership · ledger ${formatIDRCompact(cf.opening.ledger)}`, `diketik pimpinan · ledger ${formatIDRCompact(cf.opening.ledger)}`)
            : tr(`all ${cf.opening.accounts.length} accounts, from the ledger · tap to check`, `${cf.opening.accounts.length} rekening, dari ledger · ketuk untuk cek`)}
          onClick={onOpening}
        />
        <Tile
          icon={ArrowDownLeft} tone="in"
          label={tr(`Cash in · ${monthLabel(cur.month)}`, `Cash in · ${monthLabel(cur.month)}`)}
          value={formatIDR(cur.in_planned)}
          note={tr(`so far ${formatIDRCompact(cf.budget.in_actual)} of ${formatIDRCompact(cf.budget.in_planned)} due`,
            `sejauh ini ${formatIDRCompact(cf.budget.in_actual)} dari ${formatIDRCompact(cf.budget.in_planned)} yang jatuh tempo`)}
          flag={cf.budget.in_planned > 0 || cf.budget.in_actual > 0
            ? { text: inDiff >= 0 ? tr("on track", "sesuai") : tr(`${formatIDRCompact(-inDiff)} behind`, `kurang ${formatIDRCompact(-inDiff)}`), good: inDiff >= 0 }
            : undefined}
        />
        <Tile
          icon={ArrowUpRight} tone="out"
          label={tr(`Cash out · ${monthLabel(cur.month)}`, `Cash out · ${monthLabel(cur.month)}`)}
          value={formatIDR(cur.out_planned)}
          note={tr(`so far ${formatIDRCompact(cf.budget.out_actual)} against ${formatIDRCompact(cf.budget.out_planned)} planned`,
            `sejauh ini ${formatIDRCompact(cf.budget.out_actual)} dari rencana ${formatIDRCompact(cf.budget.out_planned)}`)}
          flag={outDiff > 0
            ? { text: tr(`over budget ${formatIDRCompact(outDiff)}`, `melebihi budget ${formatIDRCompact(outDiff)}`), good: false }
            : owedNow > 0
              ? { text: tr(`${formatIDRCompact(owedNow)} due, not yet paid`, `${formatIDRCompact(owedNow)} jatuh tempo, belum dibayar`), good: false, warn: true }
              : cf.budget.out_planned > 0 || cf.budget.out_actual > 0
                ? { text: tr(`under budget ${formatIDRCompact(-outDiff)}`, `di bawah budget ${formatIDRCompact(-outDiff)}`), good: true }
                : undefined}
        />
        <Tile
          icon={Wallet} label={tr(`Ending balance · ${monthLabel(cur.month)}`, `Saldo akhir · ${monthLabel(cur.month)}`)}
          value={formatIDR(cur.closing)}
          note={tr(`becomes ${monthLabel(addMonths(cur.month, 1))}'s starting balance`, `menjadi saldo awal ${monthLabel(addMonths(cur.month, 1))}`)}
          negative={cur.closing < 0}
        />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={tr("Balance, week by week", "Saldo per minggu")}
          subtitle={tr("Green: expected balance — actual for weeks that are over, plan for weeks ahead. Grey dashes: the plan alone.",
            "Hijau: saldo yang diharapkan — aktual untuk minggu yang sudah lewat, rencana untuk minggu ke depan. Abu putus-putus: rencana saja.")}
          icon={Wallet}
          action={badge}
        />
        <div className="px-2 pb-3 pt-2">
          <BalanceChart
            data={cf.weeks.map((w) => ({
              label: weekLabel(w.start, w.end), saldo: w.closing, rencana: w.planned_closing, current: w.is_current,
            }))}
            minBalance={cf.settings.min_balance}
            labels={{
              saldo: tr("Expected balance", "Saldo diharapkan"), rencana: tr("Plan alone", "Rencana saja"),
              zero: tr("Runs out", "Habis"), min: tr("Safe minimum", "Batas aman"),
            }}
          />
          <div className="flex flex-wrap gap-4 px-3 pt-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-brand-600" />{tr("Expected balance", "Saldo diharapkan")}</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-slate-400" />{tr("Plan alone", "Rencana saja")}</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-amber-500" />{tr("Safe minimum", "Batas aman")}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-rose-600" />{tr("Zero — runs out", "Nol — habis")}</span>
          </div>
        </div>
      </Card>

      <MonthChain cf={cf} month={month} onMonth={onMonth} />
    </section>
  );
}

function Tile({
  icon: Icon, label, value, note, onClick, tone, flag, negative,
}: {
  icon: typeof Wallet; label: string; value: string; note: string; onClick?: () => void;
  tone?: "in" | "out"; flag?: { text: string; good: boolean; warn?: boolean }; negative?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          tone === "in" ? "bg-emerald-50 text-emerald-600" : tone === "out" ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600",
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className={cn("mt-2 text-xl font-bold tabular-nums tracking-tight", negative ? "text-rose-700" : "text-slate-800")}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>
      {flag && (
        <span className={cn(
          "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
          flag.good ? "bg-emerald-50 text-emerald-700" : flag.warn ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700",
        )}>
          {flag.good ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {flag.text}
        </span>
      )}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card hover:border-brand-300">{body}</button>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">{body}</div>
  );
}

/** The owner's chain, month after month: starting balance, in, out, ending
 *  balance — and the ending balance is the next row's start. A month opens
 *  into its four weeks. */
function MonthChain({ cf, month, onMonth }: { cf: Cashflow; month: string; onMonth: (m: string) => void }) {
  const tr = useTr();
  const [open, setOpen] = useState<string | null>(month);

  /* Against what was due by today: the current month is not under budget by
     the weeks it has not reached yet. */
  const today = cf.generated_for;
  const toDate = (m: string, dir: Direction) => cf.weeks
    .filter((w) => w.month === m && w.start <= today)
    .reduce((s, w) => s + (dir === "IN" ? w.in_planned : w.out_planned), 0);
  const flow = (m: string, planned: number, actual: number, used: number, started: boolean, dir: Direction) => {
    const due = toDate(m, dir);
    const diff = actual - due;
    const bad = dir === "OUT" ? diff > 0 : diff < 0;
    return (
      <>
        <span className="block text-[13px] tabular-nums text-slate-800">{formatIDRCompact(used)}</span>
        {started && (
          <span className="block text-[10px] tabular-nums text-slate-500">
            {due !== planned ? tr("due to date", "rencana s.d. kini") : tr("plan", "rencana")} {formatIDRCompact(due)} · {tr("actual", "aktual")} {formatIDRCompact(actual)}
            {diff !== 0 && <span className={cn("ml-1 font-medium", bad ? "text-rose-600" : "text-emerald-600")}>({signed(diff, formatIDRCompact)})</span>}
          </span>
        )}
      </>
    );
  };

  const status = (m: CashflowMonth) => {
    if (m.closing < 0) return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">{tr("runs out", "habis")}</span>;
    if (m.low_point < cf.settings.min_balance) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{tr("thin", "menipis")}</span>;
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{tr("safe", "aman")}</span>;
  };

  return (
    <Card>
      <CardHeader
        title={tr("Month by month", "Bulan ke bulan")}
        subtitle={tr("Each month's ending balance is the next month's starting balance. Tap a month for its weeks — the sections below follow it.",
          "Saldo akhir tiap bulan menjadi saldo awal bulan berikutnya. Ketuk bulan untuk melihat minggunya — section di bawah ikut bulan itu.")}
        icon={Landmark}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">{tr("Month", "Bulan")}</th>
              <th className="px-3 py-2.5 text-right">{tr("Starting", "Saldo awal")}</th>
              <th className="px-3 py-2.5 text-right">Cash in</th>
              <th className="px-3 py-2.5 text-right">Cash out</th>
              <th className="px-3 py-2.5 text-right">{tr("Net", "Neto")}</th>
              <th className="px-3 py-2.5 text-right">{tr("Ending", "Saldo akhir")}</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {cf.months.map((m) => {
              const started = m.is_past || m.is_current;
              const isOpen = open === m.month;
              const net = m.in_used - m.out_used;
              return [
                <tr
                  key={m.month}
                  onClick={() => { setOpen(isOpen ? null : m.month); onMonth(m.month); }}
                  className={cn(
                    "cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50",
                    month === m.month && "bg-brand-50/50",
                  )}
                >
                  <th className={cn("sticky left-0 z-10 px-4 py-2", month === m.month ? "bg-brand-50" : "bg-white")}>
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-slate-800">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                      {monthLabel(m.month, true)}
                      {m.is_current && <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">{tr("now", "kini")}</span>}
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] tabular-nums text-slate-600">{formatIDRCompact(m.opening)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{flow(m.month, m.in_planned, m.in_actual, m.in_used, started, "IN")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{flow(m.month, m.out_planned, m.out_actual, m.out_used, started, "OUT")}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right text-[13px] tabular-nums", net < 0 ? "text-rose-700" : "text-emerald-700")}>{signed(net, formatIDRCompact)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right text-[13px] font-semibold tabular-nums", m.closing < 0 ? "text-rose-700" : "text-slate-800")}>{formatIDRCompact(m.closing)}</td>
                  <td className="px-3 py-2 text-right">{status(m)}</td>
                </tr>,
                ...(isOpen ? cf.weeks.filter((w) => w.month === m.month).map((w) => (
                  <tr key={w.start} className="border-b border-slate-100 bg-slate-50/50 text-[12px]">
                    <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 py-1.5 pl-10 pr-4 font-normal text-slate-600">
                      {tr(`Week ${w.n}`, `Minggu ${w.n}`)} · {weekLabel(w.start, w.end)}
                      {w.is_current && <span className="ml-1.5 text-[10px] font-semibold text-brand-700">{tr("this week", "minggu ini")}</span>}
                    </th>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">{formatIDRCompact(w.opening)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-emerald-700">
                      + {formatIDRCompact(w.in_used)}
                      {(w.is_past || w.is_current) && <span className="block text-[10px] text-slate-400">{tr("plan", "rencana")} {formatIDRCompact(w.in_planned)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-rose-700">
                      − {formatIDRCompact(w.out_used)}
                      {(w.is_past || w.is_current) && <span className="block text-[10px] text-slate-400">{tr("plan", "rencana")} {formatIDRCompact(w.out_planned)}</span>}
                      {w.carried_out > 0 && <span className="block text-[10px] text-amber-700">{tr("incl. overdue", "termasuk tunggakan")} {formatIDRCompact(w.carried_out)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">{signed(w.in_used - w.out_used, formatIDRCompact)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums", w.closing < 0 ? "text-rose-700" : w.closing < cf.settings.min_balance ? "text-amber-700" : "text-slate-700")}>{formatIDRCompact(w.closing)}</td>
                    <td />
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      {cf.undated_obligations > 0 && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
          {tr("Not counted:", "Tidak dihitung:")} <strong className="tabular-nums">{formatIDR(cf.undated_obligations)}</strong>{" "}
          {tr("owed to suppliers whose terms carry no date, so no week holds them.", "utang ke pemasok yang terminnya tidak bertanggal, jadi tidak ada minggu yang menampungnya.")}
        </p>
      )}
    </Card>
  );
}
