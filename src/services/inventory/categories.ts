/** The categories an item registered at the rack may go into, as the picker
 *  shows them: each group, then its types, by name (`0197`, D346). Shared by
 *  both API layers so the real and demo dropdowns read the same. */
import type { StockedCategory } from "./contracts";

export function stockedCategoryTree(
  stocked: string[],
  categories: { code: string; name: string; parent_code: string | null }[],
): StockedCategory[] {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const rows: StockedCategory[] = stocked
    .map((code) => byCode.get(code))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      code: c.code, name: c.name, parent_code: c.parent_code,
      parent_name: c.parent_code ? byCode.get(c.parent_code)?.name ?? c.parent_code : null,
    }));
  const group = (r: StockedCategory) => r.parent_name ?? r.name;
  return rows.sort((a, b) =>
    group(a).localeCompare(group(b))
    || Number(a.parent_code != null) - Number(b.parent_code != null)
    || a.name.localeCompare(b.name));
}
