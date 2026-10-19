"use client";

import { Landmark, Lock } from "lucide-react";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useLoad } from "@/components/ui/loaded";
import { accounting } from "@/demo/api";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import type { LedgerDraft } from "@/services/accounting/contracts";

/** Where the money is, before anything else on the page.
 *
 *  Five accounts, and the one that matters for who sees what: BCA 064 is
 *  leadership's. Its balance is shown to whoever holds `approve_funds` and to
 *  nobody else (D87) — accounting works out of the paying accounts and has no
 *  business reading the leadership balance to do it. The row is not hidden
 *  silently either: it says it is there and locked, because a blank where an
 *  account should be reads as a bug.
 *
 *  **Drafts are not in the balance** (D445). Under each account it says
 *  what the balance would be if that account's drafts were ticked as they
 *  stand — a forecast, printed apart, never added in.
 */
export function CashPosition({ onPick, active, drafts = [], version = 0 }: {
  onPick: (accountId: string) => void;
  active: string;
  drafts?: LedgerDraft[];
  /** Bumped when a draft is booked, so the balances are read again. */
  version?: number;
}) {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const [accounts] = useLoad(() => accounting.listAccounts(), [version], { keepPrevious: true });
  const mayReadLeadership = hasAuthority("approve_funds");

  if (accounts.status !== "ready") {
    return <div className="mb-4 h-[86px] animate-pulse rounded-xl border border-slate-200 bg-white" />;
  }

  const rows = accounts.data.filter((a) => a.currency === "IDR");
  /* What the drafts would move, per account code. */
  const waiting = new Map<string, number>();
  for (const d of drafts) {
    if (d.road === "link" || d.amount === null || !d.account_code) continue;
    const signed = d.direction === "IN" ? d.amount : -d.amount;
    waiting.set(d.account_code, (waiting.get(d.account_code) ?? 0) + signed - (d.road === "transfer" ? d.fee ?? 0 : 0));
    if (d.road === "transfer" && d.to_account_code) waiting.set(d.to_account_code, (waiting.get(d.to_account_code) ?? 0) + d.amount);
  }
  const total = rows
    .filter((a) => a.custody === "accounting")
    .reduce((s, a) => s + a.balance, 0);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {rows.map((a) => {
          const locked = a.custody === "leadership" && !mayReadLeadership;
          const on = active === a.account_id;
          return (
            <button
              key={a.account_id}
              disabled={locked}
              onClick={() => onPick(on ? "" : a.account_id)}
              className={cn(
                "px-4 py-3 text-left transition-colors",
                on && "bg-brand-50",
                !locked && "hover:bg-slate-50",
                locked && "cursor-not-allowed",
              )}
            >
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                {a.custody === "leadership" ? <Lock className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
                {a.code}
              </p>
              <p className={cn(
                "mt-0.5 text-lg font-bold tabular-nums tracking-tight",
                locked ? "text-slate-300" : a.balance < 0 ? "text-rose-700" : "text-slate-800",
              )}>
                {locked ? "—" : formatIDR(a.balance)}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {locked ? tr("leadership only", "khusus pimpinan") : a.name}
              </p>
              {!locked && waiting.get(a.code) ? (
                <p className="truncate text-[11px] text-amber-700" title={tr("Not in the balance until the drafts are ticked", "Belum masuk saldo sampai draft dicentang")}>
                  {tr(`if drafts confirmed: ${formatIDR(a.balance + waiting.get(a.code)!)}`, `kalau draft dikonfirmasi: ${formatIDR(a.balance + waiting.get(a.code)!)}`)}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
        <span className="font-medium text-slate-700">{formatIDR(total)}</span>{" "}
        {tr("across the accounts that pay suppliers. Click one to filter the ledger to it.",
          "di rekening-rekening yang membayar pemasok. Klik salah satu untuk menyaring buku besar ke rekening itu.")}
      </p>
    </div>
  );
}
