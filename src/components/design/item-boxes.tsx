"use client";

import { cn } from "@/lib/cn";
import { DESIGN_BOXES, type DesignBox } from "@/services/design/contracts";
import { useTr } from "@/lib/i18n";

/* The six boxes of a design item (0248, Studio Desain S1) as a list reads
   them. The boxes themselves are worked in the item's drawer
   (`item-studio.tsx`, D421), beside the BOM. */

/** The six boxes as six small squares, for a row in a list. */
export function BoxChips({ boxes }: { boxes: DesignBox[] }) {
  const tr = useTr();
  return (
    <span className="inline-flex gap-[3px]">
      {DESIGN_BOXES.map((def) => {
        const b = boxes.find((x) => x.box === def.key);
        const st = b?.state ?? "kosong";
        return (
          <span key={def.key}
            title={`${def.label}: ${st === "terisi" ? tr("filled", "terisi") : st === "tidak_perlu" ? tr("not needed", "tidak perlu") : tr("empty", "kosong")}`}
            className={cn(
              "inline-grid h-5 min-w-[22px] place-items-center rounded px-0.5 text-[9.5px] font-bold",
              st === "terisi" && "bg-brand-700 text-white",
              st === "tidak_perlu" && "border border-dashed border-slate-300 text-slate-400",
              st === "kosong" && "border border-slate-200 bg-slate-50 text-slate-400",
            )}>
            {def.short}
          </span>
        );
      })}
    </span>
  );
}

/** Filled over all, as a bar and a count. */
export function BoxBar({ filled, total, className }: { filled: number; total: number; className?: string }) {
  const tr = useTr();
  return (
    <span className={cn("inline-grid min-w-[110px] gap-0.5", className)}>
      <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100" role="img"
        aria-label={tr(`${filled} of ${total} boxes filled`, `${filled} dari ${total} kotak terisi`)}>
        <span className="block h-full rounded-full bg-brand-700" style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
      </span>
      <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-500">
        {tr(`${filled} / ${total} filled`, `${filled} / ${total} terisi`)}
      </span>
    </span>
  );
}
