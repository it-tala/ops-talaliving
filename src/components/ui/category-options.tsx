"use client";

import type { ItemCategory } from "@/services/procurement/contracts";

/** The category tree as a flat, ordered list: each top-level category
 *  followed by its item types, read as "Packing › Foam Sheet". "Not yet
 *  curated" goes last — it is where things wait, not where they belong. */
export function categoryTree(categories: ItemCategory[]): { top: ItemCategory; types: ItemCategory[] }[] {
  const byName = (a: ItemCategory, b: ItemCategory) => a.name.localeCompare(b.name);
  return categories
    .filter((c) => !c.parent_code)
    .sort((a, b) => (a.code === "uncurated" ? 1 : b.code === "uncurated" ? -1 : byName(a, b)))
    .map((top) => ({ top, types: categories.filter((c) => c.parent_code === top.code).sort(byName) }));
}

/** `<option>`s for a category `<select>`. With `typesOnlyWhereAvailable`, a
 *  category that has item types offers only those — filing an item directly
 *  under "Packing" when "Packing › Foam Sheet" exists is how the tree stays
 *  half-used. */
export function CategoryOptions({
  categories, typesOnlyWhereAvailable = false, current,
}: {
  categories: ItemCategory[];
  typesOnlyWhereAvailable?: boolean;
  /** Always offered, so an item filed somewhere now discouraged still shows
   *  where it is. */
  current?: string;
}) {
  return (
    <>
      {categoryTree(categories).map(({ top, types }) => (
        types.length === 0 ? (
          <option key={top.code} value={top.code}>{top.name}</option>
        ) : (
          <optgroup key={top.code} label={top.name}>
            {(!typesOnlyWhereAvailable || current === top.code) && (
              <option value={top.code}>{top.name} (category only)</option>
            )}
            {types.map((t) => (
              <option key={t.code} value={t.code}>{top.name} › {t.name}</option>
            ))}
          </optgroup>
        )
      ))}
    </>
  );
}
