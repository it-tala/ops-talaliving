"use client";

import { ArrowDownRight, ArrowUpRight, TrendingDown, Link2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";

/** One month, opened up.
 *
 *  The month view says what a month costs. It cannot say **when**, and so it
 *  quietly assumes the money in arrives before the money out. A month can end
 *  at Rp 50 juta and still be unable to pay on the 15th.
 *
 *  So this is a timeline, not a calendar grid: the dated movements in order,
 *  the balance running down beside them, and the **lowest point named with its
 *  date** (D115). That figure is the whole reason the expansion exists — when
 *  a month runs short, *which day* it runs short decides what you do about it:
 *  move the transfer earlier, or change what is being bought.
 *
 *  The obligations that carry no date sit at the bottom, stated rather than
 *  spread evenly across the days to make the line look tidy (F30).
 */
/** Negatives read as "− Rp 17.961.000", never "Rp -17.961.000" — the minus
 *  belongs in front of the number, not inside the currency. */
const money = (n: number) => (n < 0 ? `− ${formatIDR(Math.abs(n))}` : formatIDR(n));

export function MonthDrawer({ month, onClose }: { month: string; onClose: () => void }) {
  const [detail, reload] = useLoad(() => accounting.getMonthDetail(month), [month]);

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={month} subtitle="Day by day, and the lowest the cash gets">
      <Loaded state={detail} onRetry={reload}>
        {(d) => (
          <div className="space-y-4">
            <div className={cn(
              "rounded-xl border px-4 py-3",
              d.low_point < 0 ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-slate-50/60",
            )}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[12px] text-slate-500">
                  Opens at <strong className="tabular-nums text-slate-700">{money(d.opening)}</strong>
                </span>
                <span className="text-[12px] text-slate-500">
                  Ends at <strong className={cn("tabular-nums", d.closing < 0 ? "text-rose-700" : "text-slate-700")}>
                    {money(d.closing)}
                  </strong>
                </span>
              </div>
              <p className={cn(
                "mt-1.5 flex items-center gap-1.5 text-[13px]",
                d.low_point < 0 ? "text-rose-900" : "text-slate-700",
              )}>
                <TrendingDown className="h-4 w-4 shrink-0" />
                {d.low_date ? (
                  <span>
                    {d.opening < 0 && (
                      <>The month opens already under, carrying what the month before it left behind. </>
                    )}
                    {d.first_negative_date ? (
                      <>
                        Runs out on <strong>{d.first_negative_date}</strong> — that is the first
                        payment that cannot be made, and everything after it follows from that one.
                        Lowest on <strong>{d.low_date}</strong> at{" "}
                        <strong className="tabular-nums">{money(d.low_point)}</strong>.
                      </>
                    ) : (
                      <>
                        Lowest on <strong>{d.low_date}</strong> at{" "}
                        <strong className="tabular-nums">{money(d.low_point)}</strong> — the month
                        never goes under, but that is how close it comes.
                      </>
                    )}
                  </span>
                ) : (
                  <span>Nothing moves the balance in this month.</span>
                )}
              </p>
            </div>

            <ul className="divide-y divide-slate-100">
              {d.rows.map((r) => (
                <li
                  key={`${r.component_id}:${r.date}`}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 py-2",
                    r.is_past && "opacity-60",
                    r.date === d.first_negative_date && "bg-rose-50/70",
                    r.date === d.low_date && r.date !== d.first_negative_date && "bg-amber-50/60",
                  )}
                >
                  <span className="w-[30px] shrink-0 text-right font-mono text-[13px] text-slate-500">
                    {r.date.slice(8, 10)}
                  </span>
                  {r.direction === "IN"
                    ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    : <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <span className="min-w-[160px] flex-1 text-[13px] text-slate-800">
                    {r.name}
                    {r.frequency === "once" && (
                      <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">one-off</span>
                    )}
                    {r.amount_kind === "estimate" && (
                      <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700" title="An estimate — any matched payment settles it">estimate</span>
                    )}
                    {r.carries_override && r.reason && (
                      <span className="block text-[11px] text-violet-700">{r.reason}</span>
                    )}
                    {r.actual > 0 && (
                      <span className="block text-[11px] text-slate-500">
                        {r.matched_by === "category" ? "≈ " : <Link2 className="mr-1 inline h-3 w-3" />}
                        {formatIDR(r.actual)} actually went out · {r.trx_nos.join(", ")}
                        {r.amount_kind === "estimate" && r.state === "PAID" && r.actual !== r.planned && (
                          <> · {r.actual > r.planned ? "+" : "−"}{formatIDR(Math.abs(r.actual - r.planned))} against the estimate</>
                        )}
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    "w-[128px] whitespace-nowrap text-right text-[13px] tabular-nums",
                    r.direction === "IN" ? "text-emerald-700" : "text-slate-700",
                  )}>
                    {r.direction === "IN" ? "+ " : "− "}{formatIDR(r.planned)}
                  </span>
                  {r.is_past ? (
                    <Badge tone="slate">already gone</Badge>
                  ) : (
                    <span className={cn(
                      "w-[128px] whitespace-nowrap text-right text-[13px] font-medium tabular-nums",
                      r.balance < 0 ? "text-rose-700" : "text-slate-800",
                    )}>
                      {money(r.balance)}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {d.undated_obligations > 0 && (
              /* The honest footnote. Bigger than most months of planned
                 spending, and no day here can hold it (F30). */
              <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[12px] text-amber-900">
                Plus <strong className="tabular-nums">{formatIDR(d.undated_obligations)}</strong> owed to
                suppliers on terms that fire on an event — on issue, on delivery — rather than
                on a date. Any of it could land on any of these days. It is not in the balance
                above, and spreading it evenly across the month would only make this line look
                tidier than the truth.
              </p>
            )}
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}
