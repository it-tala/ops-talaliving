"use client";

import { useState } from "react";
import { CalendarDays, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { CashCell, CashPlan, CashRow } from "@/services/accounting/contracts";
import { useSession } from "@/store/session";
import { ComponentDrawer } from "./ComponentDrawer";
import { MonthOverride } from "./MonthOverride";
import { MonthDrawer } from "./MonthDrawer";
import { DuePanel } from "./DuePanel";

/** Will the money last, and what is due next.
 *
 *  Twelve months across, every recurring thing down the side, planned above
 *  and actual below (D109). Two screens' worth of job in one grid on purpose:
 *  the list of monthly bills with the day each falls due is the budget *and*
 *  the reminder, and keeping them apart is how one of them goes stale.
 *
 *  The row that makes it honest is **Not in the plan** — everything that
 *  actually left in a month with nothing on the calendar claiming it. A plan
 *  that does not reconcile to the ledger is a wish (D111).
 */
export default function CalendarPage() {
  const { can } = useSession();
  const [plan, reload] = useLoad(() => accounting.getCashPlan(), []);
  const [editing, setEditing] = useState<CashRow["component"] | null>(null);
  const [adding, setAdding] = useState(false);
  const [cell, setCell] = useState<{ row: CashRow; cell: CashCell } | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  /* Q24 (D233): the estimate belongs to leadership. Accounting reads this
     screen in full and books real payments against it; the plan figure itself
     is `plan_cash`, which only `accounting: admin` carries. */
  const mayEdit = can("accounting.plan_cash");

  return (
    <div>
      <PageHeader
        breadcrumb="Accounting"
        title="Payment calendar"
        description="Every recurring payment with the day it falls due, twelve months forward — planned against what actually happened."
        actions={mayEdit ? (
          <Button icon={Plus} onClick={() => setAdding(true)}>Add a line</Button>
        ) : undefined}
      />

      <Loaded state={plan} onRetry={reload}>
        {(p) => (
          <>
            <Verdict plan={p} />
            <DuePanel onChanged={reload} />
            <Card className="mb-4">
              <CardHeader
                title="Twelve months"
                subtitle={mayEdit
                  ? "Planned on top, what actually happened underneath. Click a month to open it day by day, a line to change the estimate, a cell to change one month."
                  : "Planned on top, what actually happened underneath. Click a month to open it day by day. The estimates themselves are set by leadership (Q24) — everything else on this screen is yours to read."}
                icon={CalendarDays}
                action={<SourceBadge state={plan} />}
              />
              <Grid
                plan={p}
                onPick={(c) => mayEdit && setEditing(c)}
                onPickCell={(row, cell) => mayEdit && setCell({ row, cell })}
                onOpenMonth={setOpenMonth}
              />
            </Card>
          </>
        )}
      </Loaded>

      {cell && (
        <MonthOverride
          row={cell.row}
          cell={cell.cell}
          onClose={() => setCell(null)}
          onSaved={() => { setCell(null); reload(); }}
        />
      )}

      {openMonth && <MonthDrawer month={openMonth} onClose={() => setOpenMonth(null)} />}

      {(adding || editing) && (
        <ComponentDrawer
          component={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function Verdict({ plan }: { plan: CashPlan }) {
  const short = plan.short_month !== null;
  const plannedOut = plan.months.reduce((s, m) => s + m.planned_out, 0);
  const plannedIn = plan.months.reduce((s, m) => s + m.planned_in, 0);

  return (
    <div className={cn(
      "mb-4 rounded-xl border bg-white shadow-card",
      short ? "border-rose-200" : "border-slate-200",
    )}>
      <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {([
          ["Cash today", formatIDR(plan.opening_cash), "across the accounts that pay people"],
          ["Planned out", formatIDR(plannedOut), "twelve months of bills"],
          ["Planned in", formatIDR(plannedIn), "transfers from leadership"],
          [short ? "Runs out" : "Ends at",
            short
              ? plan.months.find((m) => m.month === plan.short_month)?.label ?? "—"
              : formatIDR(plan.months[plan.months.length - 1].closing),
            short ? `short ${formatIDR(plan.short_by)}` : "on this plan"],
        ] as [string, string, string][]).map(([k, v, note]) => (
          <div key={k} className="px-4 py-3.5">
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
            <dd className={cn(
              "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
              (k === "Runs out") ? "text-rose-700" : "text-slate-800",
            )}>
              {v}
            </dd>
            <p className="text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </dl>
      <p className={cn(
        "flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-[13px]",
        short ? "border-rose-100 bg-rose-50/60 text-rose-900" : "border-slate-100 text-slate-600",
      )}>
        {short
          ? <AlertTriangle className="h-4 w-4 shrink-0" />
          : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
        <span>{plan.verdict}</span>
        {plan.undated_obligations > 0 && (
          <span className="text-slate-500">
            Not counted: <strong className="tabular-nums">{formatIDR(plan.undated_obligations)}</strong>{" "}
            owed to suppliers whose terms carry no date, so no month holds them.
          </span>
        )}
      </p>
    </div>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const CELL_TONE: Record<CashCell["state"], string> = {
  PAID: "text-emerald-700",
  PARTIAL: "text-amber-700",
  OVERDUE: "text-rose-700",
  DUE: "text-amber-700",
  PLANNED: "text-slate-600",
  SKIPPED: "text-slate-300",
};

function Grid({
  plan, onPick, onPickCell, onOpenMonth,
}: {
  plan: CashPlan;
  onPick: (c: CashRow["component"]) => void;
  onPickCell: (row: CashRow, cell: CashCell) => void;
  onOpenMonth: (month: string) => void;
}) {
  const money = plan.rows.filter((r) => r.component.direction === "IN");
  const bills = plan.rows.filter((r) => r.component.direction === "OUT");

  const head = (
    <tr className="border-b border-slate-200 bg-slate-50/70">
      <th className="sticky left-0 z-10 bg-slate-50/70 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Line
      </th>
      {plan.months.map((m) => (
        <th key={m.month} className="whitespace-nowrap px-3 py-2.5 text-right">
          <button
            onClick={() => onOpenMonth(m.month)}
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide underline decoration-dotted underline-offset-4 hover:text-brand-700",
              m.is_current ? "text-brand-700" : "text-slate-500",
            )}
            title="Open this month day by day"
          >
            {m.label}
          </button>
        </th>
      ))}
    </tr>
  );

  const bodyRow = (r: CashRow) => (
    <tr key={r.component.id} className="border-b border-slate-100 hover:bg-slate-50/70">
      <th
        scope="row"
        className="sticky left-0 z-10 cursor-pointer bg-white px-4 py-2 text-left align-top hover:bg-slate-50"
        onClick={() => onPick(r.component)}
      >
        <span className="block text-[13px] font-medium text-slate-800">{r.component.name}</span>
        <span className="block text-[11px] text-slate-500">
          {r.component.frequency === "weekly"
            ? `every ${WEEKDAYS[r.component.due_weekday ?? 5]}`
            : r.component.frequency === "once"
              ? `once · ${r.component.due_date}`
              : `day ${r.component.due_day}`}
          {r.account_code && <> · {r.account_code}</>}
        </span>
      </th>
      {r.cells.map((c) => (
        <td
          key={c.month}
          className="cursor-pointer whitespace-nowrap px-3 py-2 text-right align-top hover:bg-brand-50/60"
          title="Change just this month"
          onClick={() => onPickCell(r, c)}
        >
          {c.state === "SKIPPED" ? (
            <span className="text-[12px] text-slate-300" title={c.reason ?? undefined}>—</span>
          ) : (
            <>
              <span className={cn("block text-[13px] tabular-nums", CELL_TONE[c.state])}>
                {formatIDRCompact(c.planned)}
                {c.events.length > 1 && (
                  <span className="ml-1 text-[10px] text-slate-400">{c.events.length}×</span>
                )}
              </span>
              {c.actual > 0 && (
                <span
                  className={cn(
                    "block text-[11px] tabular-nums",
                    c.matched_by === "category" ? "text-slate-400" : "text-slate-500",
                  )}
                  title={c.matched_by === "category"
                    ? `Matched by category: ${c.trx_nos.join(", ")}`
                    : `Linked: ${c.trx_nos.join(", ")}`}
                >
                  {c.matched_by === "category" ? "≈ " : ""}{formatIDRCompact(c.actual)}
                </span>
              )}
              {c.overridden && (
                <span className="block text-[10px] text-violet-600" title={c.reason ?? undefined}>changed</span>
              )}
            </>
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1520px] border-collapse">
        <thead>{head}</thead>
        <tbody>
          <tr className="bg-emerald-50/40">
            <th className="sticky left-0 z-10 bg-emerald-50/60 px-4 py-1.5 text-left text-[11px] uppercase tracking-wide text-emerald-800">
              Money in
            </th>
            <td colSpan={plan.months.length} />
          </tr>
          {money.map(bodyRow)}

          <tr className="bg-slate-50">
            <th className="sticky left-0 z-10 bg-slate-100 px-4 py-1.5 text-left text-[11px] uppercase tracking-wide text-slate-600">
              Money out
            </th>
            <td colSpan={plan.months.length} />
          </tr>
          {bills.map(bodyRow)}

          {/* The row that keeps the plan honest. */}
          <tr className="border-b border-slate-100 bg-amber-50/40">
            <th className="sticky left-0 z-10 bg-amber-50/60 px-4 py-2 text-left align-top">
              <span className="block text-[13px] font-medium text-amber-900">Not in the plan</span>
              <span className="block text-[11px] text-amber-700">money that left with no line for it</span>
            </th>
            {plan.unplanned.map((u) => (
              <td key={u.month} className="px-3 py-2 text-right align-top">
                {u.amount > 0 ? (
                  <span
                    className="text-[13px] tabular-nums text-amber-800"
                    title={u.top_types.map((t) => `${t.type_code}: ${formatIDR(t.amount)}`).join("\n")}
                  >
                    {formatIDRCompact(u.amount)}
                  </span>
                ) : <span className="text-[12px] text-slate-300">—</span>}
              </td>
            ))}
          </tr>

          <tr className="border-t-2 border-slate-200">
            <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left text-[12px] font-semibold text-slate-700">
              Net for the month
            </th>
            {plan.months.map((m) => {
              const net = m.planned_in - m.planned_out;
              return (
                <td key={m.month} className={cn(
                  "px-3 py-2 text-right text-[13px] tabular-nums",
                  net < 0 ? "text-rose-700" : "text-emerald-700",
                )}>
                  {net < 0 ? `− ${formatIDRCompact(Math.abs(net))}` : formatIDRCompact(net)}
                </td>
              );
            })}
          </tr>
          <tr className="bg-slate-50/70">
            <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left text-[12px] font-semibold text-slate-800">
              Cash at month end
            </th>
            {plan.months.map((m) => (
              <td
                key={m.month}
                className={cn(
                  "cursor-pointer px-3 py-2 text-right text-[13px] font-semibold tabular-nums hover:bg-brand-50/60",
                  m.closing < 0 ? "text-rose-700" : "text-slate-800",
                )}
                title="Open this month day by day"
                onClick={() => onOpenMonth(m.month)}
              >
                {m.closing < 0 ? `− ${formatIDRCompact(Math.abs(m.closing))}` : formatIDRCompact(m.closing)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
