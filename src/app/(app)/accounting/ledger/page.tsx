"use client";

import { useEffect, useState } from "react";
import { BookOpen, Paperclip, AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { StatusPill } from "@/components/ui/status-pill";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import { TRANSACTION_TYPE_CODES, type TransactionView } from "@/services/accounting/contracts";
import { TrxDrawer } from "./TrxDrawer";
import { CashPosition } from "./CashPosition";
import { NewEntry } from "./NewEntry";
import { useSession } from "@/store/session";

/** The ledger: every row of money, and what each one is attached to.
 *
 *  It is a record of money that actually moved — never a budget, never a
 *  plan. So there is no "allocated" figure on a row (D88): the amount left the
 *  account, and the only question left is what it was for. A purchase that
 *  names no request line says so in one word, because that is the row worth
 *  asking about.
 *
 *  **Evidence** is the other column that earns its place: whether there is a
 *  document at all, on the row rather than in a folder somebody has to go and
 *  check. Since D85 a row cannot be posted without one, so this column is now
 *  mostly a record of history — the old rows that arrived before the rule.
 *
 *  Nothing is deleted from here. A wrong row is voided with a reason and stays
 *  visible (A5), because a row that is gone cannot be asked about — and the
 *  question always arrives later.
 */
const PAGE_SIZE = 25;

export default function LedgerPage() {
  const { hasAuthority } = useSession();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /* `?trx=` opens that row — the item catalogue's purchase history links
     here. Read once from the address, like the items page's `?category=`. */
  useEffect(() => {
    const trx = new URLSearchParams(window.location.search).get("trx");
    if (trx) setSelected(trx);
  }, []);

  /* Paged at the service, not sliced in the browser: the real ledger is tens
     of thousands of rows and a screen that fetches them all to show 25 is a
     screen that will stop working on a phone. */
  const [rows, reload] = useLoad(
    () => accounting.listTransactions({
      account_id: accountId || undefined,
      type_code: typeCode || undefined,
      q: q || undefined,
      include_void: showVoid,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [accountId, typeCode, q, page, showVoid],
  );
  const mayPost = hasAuthority("post_ledger");

  function filter(next: () => void) {
    /* Any change of filter is a new first page — staying on page 4 of a list
       that no longer has four pages shows an empty table and no reason. */
    setPage(0);
    next();
  }

  const columns: Column<TransactionView>[] = [
    {
      key: "when",
      header: "Date",
      render: (t) => (
        <div className="whitespace-nowrap">
          <p className="text-[13px] text-slate-700">{t.trx_date}</p>
          <p className="font-mono text-[10px] text-slate-400">{t.trx_no}</p>
        </div>
      ),
    },
    {
      key: "what",
      header: "Description",
      className: "whitespace-normal",
      render: (t) => (
        <div className="max-w-[380px] whitespace-normal break-words">
          <p className={cn("font-medium leading-snug text-slate-800", t.status === "VOID" && "line-through text-slate-400")}>
            {t.description}
          </p>
          <p className="text-[11px] text-slate-400">
            {t.account_code} · {t.type_code}
            {t.vendor_name && ` · ${t.vendor_name}`}
          </p>
          {t.void_reason && (
            <p className="mt-0.5 text-[11px] text-rose-700">{t.void_reason}</p>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (t) => (
        <div className="whitespace-nowrap">
          <p className={cn(
            "tabular-nums font-medium",
            t.direction === "IN" ? "text-emerald-700" : "text-slate-800",
          )}>
            {t.direction === "IN" ? "+" : "−"}{formatIDR(t.amount_idr)}
          </p>
          {/* A purchase that names no request, on the row rather than in a
              report nobody runs (D88). Not a budget figure — the money is
              gone either way; the question is what it was for. */}
          {t.unallocated > 0 && t.status !== "VOID" && t.expects_allocation && (
            <p className="text-[11px] text-amber-700">no request behind it</p>
          )}
        </div>
      ),
    },
    {
      key: "evidence",
      header: "Evidence",
      align: "center",
      render: (t) => t.evidence_count > 0
        ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-slate-600">
            <Paperclip className="h-3.5 w-3.5 text-slate-400" />
            {t.evidence_count}
          </span>
        )
        : t.status === "VOID"
          ? <span className="text-slate-300">—</span>
          : <span className="inline-flex items-center gap-1 text-[12px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> none
            </span>,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <div className="space-y-0.5">
          <StatusPill kind="trx" status={t.status} />
          {t.pr_line_nos.length > 0 && (
            <p className="font-mono text-[10px] text-slate-400">{t.pr_line_nos[0]}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Accounting"
        title="Ledger"
        description="Money that actually moved, in and out, with what it was for and what proves it. Nothing is deleted here — a wrong row is voided with a reason and stays visible."
        actions={mayPost ? (
          <Button icon={Plus} onClick={() => setCreating(true)}>New entry</Button>
        ) : undefined}
      />

      <CashPosition active={accountId} onPick={(id) => filter(() => setAccountId(id))} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          id="f-type"
          value={typeCode}
          onChange={(e) => filter(() => setTypeCode(e.target.value))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <option value="">All types</option>
          {TRANSACTION_TYPE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            id="f-void"
            type="checkbox"
            checked={showVoid}
            onChange={(e) => filter(() => setShowVoid(e.target.checked))}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Include voided
        </label>
        <input
          id="f-q"
          value={q}
          onChange={(e) => filter(() => setQ(e.target.value))}
          placeholder="Description or number…"
          className="ml-auto h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
        />
      </div>

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const visible = all;
          const out = visible.filter((t) => t.direction === "OUT").reduce((s, t) => s + t.amount_idr, 0);
          const inn = visible.filter((t) => t.direction === "IN").reduce((s, t) => s + t.amount_idr, 0);
          /* A purchase with no request behind it is the row worth finding.
             Payroll and the electricity bill are not that row (D83). */
          const unlinked = visible.filter((t) => t.expects_allocation && t.unallocated > 0 && t.status !== "VOID");
          const total = rows.status === "ready" ? rows.page?.total ?? visible.length : visible.length;
          const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

          return (
            <Card>
              <CardHeader
                title={`Page ${page + 1} of ${lastPage + 1}`}
                subtitle={`${formatIDR(inn)} in · ${formatIDR(out)} out on this page${unlinked.length ? ` · ${unlinked.length} purchase(s) with no request behind them` : ""}`}
                icon={BookOpen}
                action={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{total} row(s)</span>
                    <SourceBadge state={rows} />
                  </div>
                }
              />
              <DataTable
                dense
                columns={columns}
                rows={visible}
                rowKey={(t) => t.id}
                onRowClick={(t) => setSelected(t.trx_no)}
                empty={q || accountId || typeCode ? "Nothing matches those filters." : "The ledger is empty."}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
                <p className="text-[12px] text-slate-500">
                  Showing {visible.length} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm" icon={ChevronLeft}
                    disabled={page === 0}
                    onClick={() => setPage((n) => Math.max(n - 1, 0))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setPage((n) => Math.min(n + 1, lastPage))}
                  >
                    Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        }}
      </Loaded>

      {creating && (
        <NewEntry
          onClose={() => setCreating(false)}
          onPosted={() => { setCreating(false); setPage(0); reload(); }}
        />
      )}

      <TrxDrawer
        trxNo={selected}
        onClose={() => setSelected(null)}
        onChanged={reload}
      />
    </div>
  );
}
