"use client";

import { Badge } from "@/components/ui/primitives";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import {
  LINE_KINDS, LINE_KIND_LABELS, effectiveRate, type LineKind,
} from "@/services/accounting/lines";

/** The kind of a ledger line, picked (`0271`). Six words, the same six the
 *  seam knows; the screen never invents a seventh. */
export function LineKindSelect({
  id, value, onChange, size = "md", className,
}: {
  id: string; value: LineKind; onChange: (k: LineKind) => void;
  size?: "sm" | "md"; className?: string;
}) {
  const tr = useTr();
  return (
    <select
      id={id} value={value}
      onChange={(e) => onChange(e.target.value as LineKind)}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white focus:border-brand-400 focus:outline-none",
        size === "sm" ? "h-8 px-1.5 text-[13px]" : "h-9 px-2 text-sm",
        className,
      )}
    >
      {LINE_KINDS.map((k) => (
        <option key={k} value={k}>{tr(LINE_KIND_LABELS[k].en, LINE_KIND_LABELS[k].id)}</option>
      ))}
    </select>
  );
}

const TONE: Record<LineKind, "slate" | "amber" | "red" | "brand" | "green" | "violet"> = {
  item: "slate", fee: "amber", tax: "red", shipping: "brand", discount: "green", other: "slate",
};

/** The kind as a small label beside a line — read, not picked. An `item`
 *  line shows nothing: it is the ordinary case, and a label on every row is
 *  a label nobody reads (F270). */
export function LineKindBadge({ kind }: { kind: LineKind }) {
  const tr = useTr();
  if (kind === "item") return null;
  return <Badge tone={TONE[kind]}>{tr(LINE_KIND_LABELS[kind].en, LINE_KIND_LABELS[kind].id)}</Badge>;
}

/** The bill in another currency, paid in rupiah (`0271`, D435): a currency
 *  code and the bill's own amount. The rate is shown from the two amounts,
 *  never typed — the invoice says USD 26.64, the bank says Rp 491.500, and
 *  the rate is whatever those two make. */
export function BilledFields({
  idPrefix, currency, amount, amountIdr, onCurrency, onAmount, size = "md",
}: {
  idPrefix: string;
  currency: string; amount: number;
  /** What was paid, for the rate beside the inputs. */
  amountIdr: number;
  onCurrency: (c: string) => void; onAmount: (n: number) => void;
  size?: "sm" | "md";
}) {
  const tr = useTr();
  const rate = effectiveRate(amountIdr, amount);
  const inputCls = cn(
    "mt-1 w-full rounded-lg border border-slate-200 bg-white uppercase focus:border-brand-400 focus:outline-none",
    size === "sm" ? "h-8 px-2 text-[13px]" : "h-9 px-2 text-sm",
  );
  return (
    <div className="grid gap-2 sm:grid-cols-12">
      <div className="sm:col-span-3">
        <label htmlFor={`${idPrefix}-ccy`} className="block text-[11px] text-slate-500">{tr("Currency", "Mata uang")}</label>
        <input
          id={`${idPrefix}-ccy`} value={currency} maxLength={3}
          onChange={(e) => onCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          placeholder="USD" className={inputCls}
        />
      </div>
      <div className="sm:col-span-4">
        <label htmlFor={`${idPrefix}-amt`} className="block text-[11px] text-slate-500">{tr("Billed amount", "Nilai tagihan")}</label>
        <NumberInput id={`${idPrefix}-amt`} size={size} value={amount} min={0} step={0.01}
          onChange={onAmount} className="mt-1" />
      </div>
      <div className="flex items-end sm:col-span-5">
        <p className="text-[12px] text-slate-500">
          {rate !== null && currency.length === 3
            ? tr(`Rate ${formatNumber(rate, 0)} per ${currency} — ${formatIDR(amountIdr)} ÷ ${formatNumber(amount, 2)}`,
                `Kurs ${formatNumber(rate, 0)} per ${currency} — ${formatIDR(amountIdr)} ÷ ${formatNumber(amount, 2)}`)
            : tr("The rate is worked out from the rupiah paid, never typed.", "Kurs dihitung dari rupiah yang dibayar, tidak diketik.")}
        </p>
      </div>
    </div>
  );
}

/** `USD 26,64 · kurs 18.451` for a drawer's summary row. */
export function billedSummary(currency: string | null | undefined, amount: number | null | undefined, amountIdr: number): string | null {
  if (!currency || !amount) return null;
  const rate = effectiveRate(amountIdr, amount);
  return `${currency} ${formatNumber(amount, 2)}${rate !== null ? ` · ${formatNumber(rate, 0)}/${currency}` : ""}`;
}
