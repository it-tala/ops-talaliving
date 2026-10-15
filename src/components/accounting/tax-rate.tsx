"use client";

import { NumberInput } from "@/components/ui/number-input";

/** The nota's tax as a rate (D441): type 11 and the screen works the amount
 *  out, so nobody divides by 1,11 on a calculator. The amount stays what is
 *  stored (D435) — this field only writes it.
 *
 *  `pct` is the rate the person typed, kept by the screen for as long as it
 *  still holds (the screen re-applies it when the amount or the lines move);
 *  null once the amount was typed by hand, and the field then shows `rate`,
 *  what that amount actually is of the goods. */
export function TaxRateInput({
  id, pct, rate, onRate, size = "md",
}: {
  id: string;
  pct: number | null;
  /** The rate the current tax amount is of the goods (`taxRateOf`). */
  rate: number;
  onRate: (pct: number) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="relative">
      <NumberInput id={id} size={size} value={pct ?? rate} min={0} max={100} step={0.01}
        onChange={(v) => onRate(Math.min(100, Math.max(0, v)))}
        className="pr-6 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-slate-400">%</span>
    </div>
  );
}
