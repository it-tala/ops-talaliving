"use client";

import { useEffect, useState } from "react";
import { getActiveLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Rupiah in, rupiah out.
 *
 *  Whole rupiah only — there are no sen in this business, and allowing decimals
 *  invites a rounding argument nobody wants to have with a supplier.
 *
 *  **Grouped while you type.** It is not a `<input type="number">`, because
 *  that cannot show `4,275,000`: it shows `4275000`, which on a board of
 *  approvals is a number you have to count digits to read. Reading the amount
 *  is the entire job of this control, so it keeps the separators and parses
 *  the digits back out.
 *
 *  It carries no ceiling. Approval used to be capped at what was requested,
 *  which assumed the request was always the higher number — but prices move
 *  between the request and the meeting (D76). A screen that wants to point out
 *  a figure above what was asked says so in words beside the field, where it
 *  reads as information rather than as a wall.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  disabled,
  placeholder,
  className,
  size = "md",
}: {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const group = (n: number) => n.toLocaleString(getActiveLocale());
  const [text, setText] = useState(() => group(value ?? 0));

  /* Re-sync when the value is changed from outside — a form reset, or the
     quantity above recomputing the amount — but never while the text already
     parses to the same number, or every keystroke would be clobbered. */
  useEffect(() => {
    if (digitsToNumber(text) !== value) setText(group(value ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={className}>
      <div className="relative">
        <span className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400",
          size === "sm" ? "left-2 text-[11px]" : "left-3 text-sm",
        )}>
          Rp
        </span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            const n = digitsToNumber(e.target.value);
            setText(e.target.value === "" ? "" : group(n));
            onChange(n);
          }}
          onBlur={() => setText(group(value ?? 0))}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "w-full rounded-lg border border-slate-200 text-right tabular-nums focus:border-brand-400 focus:outline-none disabled:bg-slate-50",
            size === "sm" ? "h-8 pl-6 pr-2 text-[13px]" : "h-10 pl-9 pr-3 text-sm",
          )}
        />
      </div>
    </div>
  );
}

/** Everything that is not a digit is separator or slip of the finger. */
function digitsToNumber(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits === "" ? 0 : Number(digits);
}
