"use client";

import { useState } from "react";
import { Bell, Link2, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/drawer";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { CashDue } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";

/** The reminder half of the calendar.
 *
 *  A budget nobody looks at on the 24th is a document; the same list, sorted
 *  by the day each bill falls due, is the thing that gets the electricity
 *  paid. Overdue first, because that is the one that costs money.
 */
export function DuePanel({ onChanged }: { onChanged: () => void }) {
  const [due, reload] = useLoad(() => accounting.listDue(), []);
  const [linking, setLinking] = useState<CashDue | null>(null);

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          title="Due next"
          subtitle="The next three weeks, and anything already late — the same movements the month expansion shows, sorted by date."
          icon={Bell}
        />
        <Loaded state={due} onRetry={reload}>
          {(rows) => rows.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-slate-500">Nothing falls due in the next three weeks.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((d) => (
                <li key={`${d.component_id}:${d.date}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <span className="w-[86px] shrink-0 font-mono text-[12px] text-slate-500">{d.date}</span>
                  <span className="min-w-[180px] flex-1 text-[13px] font-medium text-slate-800">
                    {d.name}
                    {d.vendor_name && <span className="font-normal text-slate-500"> · {d.vendor_name}</span>}
                    {d.frequency === "once" && (
                      <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-normal text-violet-700">
                        one-off
                      </span>
                    )}
                    {d.amount_kind === "estimate" && (
                      <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-normal text-sky-700" title="An estimate — any matched payment settles it">
                        estimate
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    "w-[120px] text-right text-[13px] tabular-nums",
                    d.direction === "IN" ? "text-emerald-700" : "text-slate-800",
                  )}>
                    {d.direction === "IN" ? "+ " : ""}{formatIDR(d.planned)}
                  </span>
                  <DueBadge d={d} />
                  {d.direction === "OUT" && (
                    <Button variant="ghost" size="sm" icon={Link2} onClick={() => setLinking(d)}>
                      Link a payment
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      {linking && (
        <LinkPayment
          due={linking}
          onClose={() => setLinking(null)}
          onLinked={() => { setLinking(null); reload(); onChanged(); }}
        />
      )}
    </>
  );
}

function DueBadge({ d }: { d: CashDue }) {
  if (d.state === "OVERDUE") {
    return <Badge tone="red">{d.days_away === 0 ? "due today" : `${Math.abs(d.days_away)} day(s) late`}</Badge>;
  }
  if (d.state === "PARTIAL") {
    return <Badge tone="amber">part paid — {formatIDR(d.actual)} so far</Badge>;
  }
  if (d.days_away === 0) return <Badge tone="amber">due today</Badge>;
  return <Badge tone={d.days_away <= 7 ? "amber" : "slate"}>in {d.days_away} day(s)</Badge>;
}

const LINK_PAGE_SIZE = 10;

/** Pointing at the ledger row that paid a bill.
 *
 *  The calendar guesses by category, and says when it is guessing. This is how
 *  somebody replaces the guess with a fact — and the ledger stays the only
 *  place a payment is recorded, because a calendar that could post its own
 *  transactions would be a second books nobody reconciles. */
function LinkPayment({ due, onClose, onLinked }: { due: CashDue; onClose: () => void; onLinked: () => void }) {
  const { toast } = useToast();
  const [rows] = useLoad(() => accounting.listTransactions({ limit: 200 }), []);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  async function link(trxNo: string) {
    setBusy(true);
    const res = await accounting.linkPayment({
      component_id: due.component_id, month: due.month, trx_no: trxNo,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not linked", res.error.message);
      return;
    }
    toast("success", "Linked", `${trxNo} now counts against ${due.name}.`);
    onLinked();
  }

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`Which row paid ${due.name}?`}>
      <p className="mb-3 text-[13px] text-slate-600">
        {due.month} · planned {formatIDR(due.planned)}. Only rows already in the
        ledger appear here — a payment is recorded there, with its evidence,
        and named here afterwards.
      </p>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="Cari deskripsi, nomor, tipe, akun, atau nominal…"
          className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm focus:border-brand-400 focus:outline-none"
        />
      </label>
      <Loaded state={rows} onRetry={() => {}}>
        {(all) => {
          const inMonth = all.filter(
            (t) => t.direction === "OUT" && t.trx_date.startsWith(due.month),
          );
          /* The row that paid a bill is almost always the one whose amount is
           * nearest the plan, so that one goes first; the date breaks ties,
           * newest first, the way the ledger reads. */
          const needle = q.trim().toLowerCase();
          const digits = needle.replace(/[^0-9]/g, "");
          const candidates = inMonth
            .filter((t) => !needle
              || [t.description, t.trx_no, t.type_code, t.account_code]
                .some((f) => f?.toLowerCase().includes(needle))
              || (digits !== "" && /^(rp\s*)?[\d.,\s]+$/.test(needle) && String(Math.round(t.amount_idr)).includes(digits)))
            .sort((a, b) =>
              Math.abs(a.amount_idr - due.planned) - Math.abs(b.amount_idr - due.planned)
              || b.trx_date.localeCompare(a.trx_date));
          if (inMonth.length === 0) {
            return (
              <p className="text-[13px] text-amber-700">
                Nothing left an account in {due.month} yet. Post the payment in the
                ledger first, then come back and name it here.
              </p>
            );
          }
          return candidates.length === 0 ? (
            <p className="text-[13px] text-slate-500">Tidak ada transaksi yang cocok dengan &ldquo;{q}&rdquo;.</p>
          ) : (
            /* Ten at a time, at a fixed height: a month of ledger rows is a
             * hundred-odd lines, and a modal that grows with it pushes its own
             * title and close button off the screen. */
            <Paged rows={candidates} pageSize={LINK_PAGE_SIZE} unit="transaksi">
              {(shown) => (
                <ul className="-mx-5 h-[480px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-5">
                  {shown.map((t) => (
                    <li key={t.trx_no} className="flex h-12 items-center gap-3">
                      <span className="w-[76px] shrink-0 font-mono text-[11px] text-slate-500">{t.trx_date}</span>
                      <span className="min-w-0 flex-1 text-[13px] text-slate-700">
                        <span className="block truncate" title={t.description}>{t.description}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {t.type_code} · {t.account_code}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums text-[13px] text-slate-800">{formatIDR(t.amount_idr)}</span>
                        <AmountGap amount={t.amount_idr} planned={due.planned} />
                      </span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => link(t.trx_no)}>
                        This one
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          );
        }}
      </Loaded>
    </Modal>
  );
}

/** How far a ledger row sits from the plan — the reason it is where it is in
 *  the list. */
function AmountGap({ amount, planned }: { amount: number; planned: number }) {
  const gap = amount - planned;
  if (Math.abs(gap) < 1) {
    return <span className="block text-[11px] font-medium text-emerald-700">sama persis</span>;
  }
  return (
    <span className="block text-[11px] tabular-nums text-slate-400">
      {gap > 0 ? "+" : "−"}{formatIDR(Math.abs(gap))}
    </span>
  );
}
