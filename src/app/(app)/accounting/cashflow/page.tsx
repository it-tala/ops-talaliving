"use client";

import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, ShieldAlert, Wallet, ArrowDownLeft, ArrowUpRight, Landmark, Settings2, Lock,
} from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { BalanceChart } from "@/components/charts/charts";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { Cashflow, CashflowRow, Direction } from "@/services/accounting/contracts";
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
import { ExcelTable } from "@/components/ui/excel-export";

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

/** The owner's chain, months side by side: starting balance, in, out,
 *  ending balance — and each month's ending balance is the next column's
 *  start. The month picked opens in place into its four weeks, still
 *  side by side, and the sections below follow it. */
function MonthChain({ cf, month, onMonth }: { cf: Cashflow; month: string; onMonth: (m: string) => void }) {
  const tr = useTr();
  const today = cf.generated_for;
  const [open, setOpen] = useState<string | null>(month);

  /* One column per month; the open month becomes its four weeks plus its
     total. Every column is read through the same fields. */
  type Col = {
    key: string; label: string; sub?: string; month: string; kind: "month" | "week" | "total";
    current: boolean; started: boolean; over: boolean;
    opening: number; closing: number; low: number;
    in_planned: number; in_actual: number; in_used: number; in_due: number;
    out_planned: number; out_actual: number; out_used: number; out_due: number; carried: number;
  };
  const dueOf = (m: string, dir: Direction) => cf.weeks
    .filter((w) => w.month === m && w.start <= today)
    .reduce((s, w) => s + (dir === "IN" ? w.in_planned : w.out_planned), 0);
  const cols: Col[] = cf.months.flatMap((m): Col[] => {
    const monthCol: Col = {
      key: m.month, label: monthLabel(m.month), month: m.month, kind: open === m.month ? "total" : "month",
      sub: open === m.month ? tr("month", "bulan") : undefined,
      current: m.is_current, started: m.is_past || m.is_current, over: m.is_past,
      opening: m.opening, closing: m.closing, low: m.low_point,
      in_planned: m.in_planned, in_actual: m.in_actual, in_used: m.in_used, in_due: dueOf(m.month, "IN"),
      out_planned: m.out_planned, out_actual: m.out_actual, out_used: m.out_used, out_due: dueOf(m.month, "OUT"),
      carried: cf.weeks.filter((w) => w.month === m.month).reduce((s, w) => s + w.carried_out, 0),
    };
    if (open !== m.month) return [monthCol];
    const weeks: Col[] = cf.weeks.filter((w) => w.month === m.month).map((w) => ({
      key: w.start, label: tr(`Wk ${w.n}`, `Mg ${w.n}`), sub: weekLabel(w.start, w.end), month: m.month, kind: "week",
      current: w.is_current, started: w.start <= today, over: w.is_past,
      opening: w.opening, closing: w.closing, low: w.closing,
      in_planned: w.in_planned, in_actual: w.in_actual, in_used: w.in_used, in_due: w.start <= today ? w.in_planned : 0,
      out_planned: w.out_planned, out_actual: w.out_actual, out_used: w.out_used, out_due: w.start <= today ? w.out_planned : 0,
      carried: w.carried_out,
    }));
    return [...weeks, monthCol];
  });

  const money = (n: number) => (n < 0 ? `− ${formatIDRCompact(-n)}` : formatIDRCompact(n));
  const diffCell = (c: Col, dir: Direction) => {
    if (!c.started) return <span className="text-slate-300">—</span>;
    const due = dir === "IN" ? c.in_due : c.out_due;
    const diff = (dir === "IN" ? c.in_actual : c.out_actual) - due;
    if (diff === 0) return <span className="text-slate-400">0</span>;
    const bad = dir === "OUT" ? diff > 0 : diff < 0;
    /* Out under the plan while the period is still running is a bill not yet
       paid, not money saved. */
    const pending = dir === "OUT" && diff < 0 && !c.over;
    return <span className={pending ? "text-amber-700" : bad ? "text-rose-600" : "text-emerald-600"}
      title={pending ? tr("not yet paid — the period is still running", "belum dibayar — periodenya masih berjalan") : undefined}>{signed(diff, formatIDRCompact)}</span>;
  };
  const status = (c: Col) => {
    if (c.closing < 0 || c.low < 0) return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">{tr("runs out", "habis")}</span>;
    if (c.low < cf.settings.min_balance) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{tr("thin", "menipis")}</span>;
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{tr("safe", "aman")}</span>;
  };

  const rows: { key: string; label: string; hint?: string; tone?: "in" | "out" | "total"; render: (c: Col) => React.ReactNode }[] = [
    { key: "open", label: tr("Starting balance", "Saldo awal"), render: (c) => <span className="text-slate-600">{money(c.opening)}</span> },
    { key: "in_p", label: tr("Cash in · projected", "Cash in · proyeksi"), tone: "in", render: (c) => <span className="text-emerald-700">{formatIDRCompact(c.in_planned)}</span> },
    { key: "in_a", label: tr("Cash in · actual", "Cash in · aktual"), tone: "in", render: (c) => c.started ? <span className="text-slate-700">{formatIDRCompact(c.in_actual)}</span> : <span className="text-slate-300">—</span> },
    { key: "in_d", label: tr("Cash in · difference", "Cash in · selisih"), hint: tr("actual against what was due by today", "aktual dibanding yang jatuh tempo s.d. hari ini"), tone: "in", render: (c) => diffCell(c, "IN") },
    { key: "out_p", label: tr("Cash out · projected", "Cash out · proyeksi"), tone: "out", render: (c) => <span className="text-rose-700">{formatIDRCompact(c.out_planned)}</span> },
    { key: "out_a", label: tr("Cash out · actual", "Cash out · aktual"), tone: "out", render: (c) => c.started ? <span className="text-slate-700">{formatIDRCompact(c.out_actual)}</span> : <span className="text-slate-300">—</span> },
    { key: "out_d", label: tr("Cash out · difference", "Cash out · selisih"), hint: tr("+ is over budget", "+ berarti melebihi budget"), tone: "out", render: (c) => diffCell(c, "OUT") },
    { key: "net", label: tr("Net", "Neto"), render: (c) => {
      const n = c.in_used - c.out_used;
      return <span className={n < 0 ? "text-rose-700" : "text-emerald-700"}>{signed(n, formatIDRCompact)}</span>;
    } },
    { key: "close", label: tr("Ending balance", "Saldo akhir"), hint: tr("= next starting balance", "= saldo awal berikutnya"), tone: "total", render: (c) => (
      <span className={cn("font-semibold", c.closing < 0 ? "text-rose-700" : c.closing < cf.settings.min_balance ? "text-amber-700" : "text-slate-900")}>
        {money(c.closing)}
        {c.carried > 0 && <span className="block text-[10px] font-normal text-amber-700">{tr("incl. overdue", "termasuk tunggakan")} {formatIDRCompact(c.carried)}</span>}
      </span>
    ) },
    { key: "status", label: tr("Status", "Status"), render: (c) => status(c) },
  ];

  return (
    <Card>
      <CardHeader
        title={tr("Month by month", "Bulan ke bulan")}
        subtitle={tr("Months side by side. Each month's ending balance is the next month's starting balance. Tap a month to open its four weeks — the sections below follow it.",
          "Bulan menyamping. Saldo akhir tiap bulan menjadi saldo awal bulan berikutnya. Ketuk bulan untuk membuka empat minggunya — section di bawah ikut bulan itu.")}
        icon={Landmark}
      />
      <div className="overflow-x-auto">
        <ExcelTable className="w-full border-collapse" style={{ minWidth: `${200 + cols.length * 104}px` }}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70">
              <th className="sticky left-0 z-10 w-[170px] bg-slate-50 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:w-[200px]">
                {tr("Line", "Baris")}
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => {
                    if (c.kind === "week") return;
                    setOpen(open === c.month ? null : c.month);
                    onMonth(c.month);
                  }}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-right",
                    c.kind !== "week" && "cursor-pointer hover:bg-brand-50",
                    c.kind === "week" && "bg-slate-100/70",
                    c.kind === "total" && "border-r-2 border-brand-200 bg-brand-50/60",
                    month === c.month && c.kind === "month" && "bg-brand-50/60",
                  )}
                  title={c.kind === "week" ? undefined : tr("Open this month's weeks", "Buka minggu-minggu bulan ini")}
                >
                  <span className={cn(
                    "block text-[11px] font-semibold uppercase tracking-wide",
                    c.current ? "text-brand-700" : "text-slate-500",
                    c.kind !== "week" && "underline decoration-dotted underline-offset-4",
                  )}>
                    {c.label}
                    {c.current && c.kind !== "total" && <span className="ml-1 rounded bg-brand-600 px-1 py-0.5 text-[9px] text-white">{tr("now", "kini")}</span>}
                  </span>
                  {c.sub && <span className="block text-[10px] font-normal normal-case text-slate-400">{c.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn(
                "border-b border-slate-100",
                r.tone === "total" && "border-t-2 border-slate-200 bg-slate-50/70",
                (r.key === "in_p" || r.key === "out_p") && "border-t border-slate-200",
              )}>
                <th className={cn(
                  "sticky left-0 z-10 px-4 py-2 text-left align-top",
                  r.tone === "total" ? "bg-slate-50" : "bg-white",
                )}>
                  <span className={cn(
                    "block text-[12px] font-medium",
                    r.tone === "in" ? "text-emerald-800" : r.tone === "out" ? "text-rose-800" : "text-slate-800",
                  )}>{r.label}</span>
                  {r.hint && <span className="block text-[10px] font-normal text-slate-400">{r.hint}</span>}
                </th>
                {cols.map((c) => (
                  <td key={c.key} className={cn(
                    "whitespace-nowrap px-3 py-2 text-right align-top text-[13px] tabular-nums",
                    c.kind === "week" && "bg-slate-50/60 text-[12px]",
                    c.kind === "total" && "border-r-2 border-brand-200 bg-brand-50/30",
                  )}>
                    {r.render(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </ExcelTable>
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
