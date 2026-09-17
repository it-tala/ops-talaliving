"use client";

import { FileText, Link2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Tabs } from "@/components/ui/tabs";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { FundingSpendGroup, FundingSpendRow } from "@/services/accounting/contracts";

/** One transfer, spent down to nothing in front of you.
 *
 *  The running column is the point of the screen: it starts at what was sent
 *  and counts down, and the row where it crosses zero is the answer to *kok
 *  sudah habis*. It keeps going negative afterwards rather than stopping at
 *  zero, because "we carried on spending out of what was already there" is a
 *  different fact from "the money ran out", and both matter.
 */
export function FundingDrawer({ trxNo, onClose }: { trxNo: string; onClose: () => void }) {
  const [detail, reload] = useLoad(() => accounting.getFunding(trxNo), [trxNo]);

  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={trxNo} subtitle="Where this transfer went">
      <Loaded state={detail} onRetry={reload}>
        {(f) => {
          const overLimit = f.rows.filter((r) => r.over_no_approval_limit);
          const rowColumns: Column<FundingSpendRow>[] = [
            {
              key: "when",
              header: "Date",
              render: (r) => (
                <div className="whitespace-nowrap">
                  <p className="text-[13px] text-slate-700">{r.trx_date}</p>
                  <p className="font-mono text-[10px] text-slate-400">{r.trx_no}</p>
                </div>
              ),
            },
            {
              key: "what",
              header: "What left",
              className: "whitespace-normal",
              render: (r) => (
                <div className="max-w-[240px]">
                  <p className="whitespace-normal break-words text-[13px] text-slate-700">{r.description}</p>
                  <p className="text-[11px] text-slate-500">
                    {r.type_code}
                    {r.vendor_name && <> · {r.vendor_name}</>}
                    {r.project_name && <> · {r.project_name}</>}
                  </p>
                </div>
              ),
            },
            {
              key: "decided",
              header: "Decided",
              align: "center",
              className: "whitespace-nowrap",
              render: (r) => r.decided
                ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                    <Link2 className="h-3 w-3" /> line or order
                  </span>
                )
                /* Payroll and the electricity bill are not loose ends (D83). */
                : r.expects_link
                  /* Above the limit the owner set, "no approval" stops being a
                   *  gap in the paperwork and becomes the thing to chase (D231).
                   *  Below it the row is still listed and still undecided — the
                   *  limit changes what is worth chasing, not what is true. */
                  ? r.over_no_approval_limit
                    ? <span className="text-[11px] font-medium text-rose-700">no approval · over limit</span>
                    : <span className="text-[11px] text-amber-700">no line or order</span>
                  : <span className="text-[11px] text-slate-400">not expected</span>,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              render: (r) => <span className="tabular-nums text-slate-800">{formatIDR(r.amount)}</span>,
            },
            {
              key: "left",
              header: "Left of the transfer",
              align: "right",
              render: (r) => (
                <span className={cn(
                  "tabular-nums font-medium",
                  r.left_of_transfer < 0 ? "text-rose-700" : "text-slate-600",
                )}>
                  {r.left_of_transfer < 0
                    ? `− ${formatIDR(Math.abs(r.left_of_transfer))}`
                    : formatIDR(r.left_of_transfer)}
                </span>
              ),
            },
          ];

          const groupTable = (groups: FundingSpendGroup[]) => (
            <DataTable
              dense
              columns={[
                { key: "label", header: "", className: "whitespace-normal", render: (g) => (
                  <span className="text-[13px] text-slate-700">{g.label}</span>
                ) },
                { key: "count", header: "Rows", align: "right", render: (g) => (
                  <span className="text-[12px] tabular-nums text-slate-500">{g.count}</span>
                ) },
                { key: "amount", header: "Amount", align: "right", render: (g) => (
                  <span className="tabular-nums text-slate-800">{formatIDR(g.amount)}</span>
                ) },
                { key: "share", header: "Share", align: "right", render: (g) => (
                  <div className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.round(g.share * 100)}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-[12px] tabular-nums text-slate-500">
                      {Math.round(g.share * 100)}%
                    </span>
                  </div>
                ) },
              ] as Column<FundingSpendGroup>[]}
              rows={groups}
              rowKey={(g) => g.key}
              empty="Nothing left the account in this window."
            />
          );

          return (
            <div className="space-y-4">
              {/* The sentence somebody asked for, in one place. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3.5">
                <p className="text-[13px] text-slate-700">
                  <strong className="tabular-nums">{formatIDR(f.amount)}</strong> landed in{" "}
                  <strong>{f.account_code}</strong> on {f.trx_date}
                  {f.from_account_code && <> from {f.from_account_code}</>}, on top of{" "}
                  <strong className="tabular-nums">{formatIDR(f.balance_before)}</strong> already there.
                </p>
                <p className="mt-1 text-[13px] text-slate-700">
                  {f.window_end
                    ? <>Until the next transfer on {f.window_end}, </>
                    : <>Since then, </>}
                  <strong className="tabular-nums">{formatIDR(f.spent)}</strong> left the account
                  across {f.rows.length} row(s).
                </p>
                <p className="mt-2 text-[13px]">
                  {f.consumed_on ? (
                    <span className="text-rose-800">
                      Spent through on <strong>{f.consumed_on}</strong>
                      {f.days_lasted === 0 ? " — the same day" : `, ${f.days_lasted} day(s) later`}.
                      {f.beyond > 0 && (
                        <> A further <strong className="tabular-nums">{formatIDR(f.beyond)}</strong> went
                        out after that, from the balance that was already in the account.</>
                      )}
                    </span>
                  ) : (
                    <span className="text-emerald-800">
                      <strong className="tabular-nums">{formatIDR(f.remaining)}</strong> of it
                      {f.is_open ? " is still unspent." : " was still unspent when the next transfer arrived."}
                    </span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={f.undecided > 0 ? "amber" : "green"}>
                    {formatIDR(f.decided)} against a line or an order
                  </Badge>
                  {f.undecided > 0 && (
                    <Badge tone="amber">{formatIDR(f.undecided)} of purchases with nothing behind them</Badge>
                  )}
                  {overLimit.length > 0 && (
                    <Badge tone="red">
                      {overLimit.length} of those above the no-approval limit
                    </Badge>
                  )}
                  {f.proof_filename && (
                    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">
                      <FileText className="h-3 w-3" /> {f.proof_filename}
                    </span>
                  )}
                </div>
              </div>

              <Tabs
                items={[
                  {
                    id: "rows",
                    label: `Every row (${f.rows.length})`,
                    content: (
                      <DataTable
                        dense
                        columns={rowColumns}
                        rows={f.rows}
                        rowKey={(r) => r.trx_no}
                        empty="Nothing left the account before the next transfer."
                      />
                    ),
                  },
                  { id: "type", label: "By type", content: groupTable(f.by_type) },
                  { id: "vendor", label: "By vendor", content: groupTable(f.by_vendor) },
                  { id: "project", label: "By project", content: groupTable(f.by_project) },
                ]}
              />
            </div>
          );
        }}
      </Loaded>
    </Drawer>
  );
}
