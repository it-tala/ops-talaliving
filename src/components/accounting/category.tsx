"use client";

import { Badge, type Tone } from "@/components/ui/primitives";
import { useTr } from "@/lib/i18n";
import type { Category } from "@/services/accounting/contracts";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_NOTES } from "@/services/accounting/categories";

/** One tone per family of category, so a month's columns and a drawer's
 *  badge read the same way: money moving (slate), money in (green), the
 *  business's running costs (amber), the household (violet), vendors (brand). */
const TONE: Record<Category, Tone> = {
  transfer: "slate", income: "green", vendor: "brand", payroll: "amber", fixed: "amber",
  overhead: "amber", bank: "amber", tax: "red", ejo: "violet", saripan: "violet",
};

export function categoryLabel(c: Category, tr: (en: string, id: string) => string): string {
  return tr(CATEGORY_LABELS[c].en, CATEGORY_LABELS[c].id);
}

export function CategoryBadge({ category, overridden }: { category: Category; overridden?: boolean }) {
  const tr = useTr();
  return (
    <span title={overridden ? tr("set on this row, not by its type", "ditetapkan di baris ini, bukan dari jenisnya") : undefined}>
      <Badge tone={TONE[category]}>{categoryLabel(category, tr)}{overridden ? " ·" : ""}</Badge>
    </span>
  );
}

/** The ten, as `<option>`s. `allowEmpty` adds a first option — *All* on a
 *  filter, *the type decides* on a row's override. */
export function CategoryOptions({ emptyLabel }: { emptyLabel?: string }) {
  const tr = useTr();
  return (
    <>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {CATEGORIES.map((c) => (
        <option key={c} value={c} title={tr(CATEGORY_NOTES[c].en, CATEGORY_NOTES[c].id)}>
          {categoryLabel(c, tr)}
        </option>
      ))}
    </>
  );
}
