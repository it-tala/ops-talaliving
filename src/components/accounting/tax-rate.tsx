"use client";

import { useState } from "react";
import { NumberInput } from "@/components/ui/number-input";

/** The nota's tax as a rate (D441): type 11 and the screen works the amount
 *  out, so nobody divides by 1,11 on a calculator. The amount stays what is
 *  stored (D435) — this field only writes it.
 *
 *  It shows the rate that was typed while the amount is still the one that
 *  rate produced; once the amount is typed by hand, or the lines move, it
 *  shows the rate the amount actually is of the goods. */
export function TaxRateInput({
  id, taxAmount, rate, onRate, size = "md",
}: {
  id: string;
  /** The tax amount as it stands now. */
  taxAmount: number;
  /** The rate `taxAmount` is of the goods (`taxRateOf`). */
  rate: number;
  /** Apply a typed rate; returns the tax amount it produced. */
  onRate: (pct: number) => number;
  size?: "sm" | "md";
}) {
  const [typed, setTyped] = useState<{ pct: number; tax: number } | null>(null);
  const shown = typed && typed.tax === taxAmount ? typed.pct : rate;
  return (
    <div className="relative">
      <NumberInput id={id} size={size} value={shown} min={0} max={100} step={0.01}
        onChange={(v) => { const pct = Math.min(100, Math.max(0, v)); setTyped({ pct, tax: onRate(pct) }); }}
        className="pr-6 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-slate-400">%</span>
    </div>
  );
}
