"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { useLoad } from "@/components/ui/loaded";
import { procurement } from "@/demo/api";
import type { Item, UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Which catalogue entry an `item` line bought (`0272`, L5).
 *
 *  The line keeps its free-text description — that is what the nota says —
 *  and this names the catalogue entry beside it, so the price paid becomes
 *  the item's *terakhir dibayar* (D86). A line without one is still a line:
 *  *tidak di katalog* is an honest answer, and the picker offers *tambahkan
 *  ke katalog* only where the transaction type says purchases of this kind
 *  create items (`creates_catalog_item`).
 *
 *  `hint` is the line's description. The extraction already read it from the
 *  nota, so the picker proposes the catalogue entry whose name shares the
 *  most words with it — a suggestion the person confirms with one click,
 *  never a choice made for them (A13).
 */
export function ItemPicker({
  id, value, hint, allowCreate = false, uom, onChange,
}: {
  id: string;
  value: string | null;
  /** The line's description, for the suggestion. */
  hint?: string;
  /** Offer *add to catalogue* for a name the catalogue lacks. */
  allowCreate?: boolean;
  /** The line's unit — what a created item is filed under. */
  uom?: UomCode;
  onChange: (item: Item | null) => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [items, reload] = useLoad(() => procurement.listItems(), []);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => (items.status === "ready" ? items.data : []), [items]);

  const options = useMemo(() => list.map((i) => ({
    value: i.id, label: i.name, sublabel: `${i.code} · ${i.base_uom}`,
  })), [list]);

  /* The suggestion: the entry sharing the most words (3+ letters) with the
     description. Ties go to the shorter name — the more specific match. */
  const suggestion = useMemo(() => {
    if (value || !hint) return null;
    const words = hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (words.length === 0) return null;
    let best: { item: Item; score: number } | null = null;
    for (const item of list) {
      const n = `${item.name} ${(item.aka ?? []).join(" ")}`.toLowerCase();
      const score = words.filter((w) => n.includes(w)).length;
      if (score === 0) continue;
      if (!best || score > best.score || (score === best.score && item.name.length < best.item.name.length)) {
        best = { item, score };
      }
    }
    return best?.item ?? null;
  }, [hint, list, value]);

  /* A picked item that has since left the list (archived, merged) still shows. */
  const [picked, setPicked] = useState<Item | null>(null);
  useEffect(() => { if (!value) setPicked(null); }, [value]);
  const current = value ? list.find((i) => i.id === value) ?? picked : null;

  async function create(name: string) {
    setCreating(true);
    const res = await procurement.createItem({ name: name.trim(), base_uom: uom ?? "pcs" }, `item-${name.trim()}`);
    setCreating(false);
    if (res.error) { toast("warning", tr("Not added", "Tidak ditambahkan"), res.error.message); return; }
    reload();
    setPicked(res.data);
    onChange(res.data);
  }

  return (
    <div className="space-y-1">
      <Combobox
        value={current?.id ?? ""}
        onChange={(v) => {
          const item = list.find((i) => i.id === v) ?? null;
          setPicked(item);
          onChange(item);
        }}
        options={current && !list.some((i) => i.id === current.id)
          ? [{ value: current.id, label: current.name, sublabel: `${current.code} · ${current.base_uom}` }, ...options]
          : options}
        placeholder={items.status === "ready"
          ? tr("Not in the catalogue", "Tidak di katalog")
          : tr("Loading catalogue…", "Memuat katalog…")}
        emptyOptionLabel={tr("— not in the catalogue —", "— tidak di katalog —")}
        onCreate={allowCreate && !creating ? create : undefined}
        createLabel={(q) => tr(`Add “${q}” to the catalogue`, `Tambahkan “${q}” ke katalog`)}
      />
      {suggestion && (
        <button
          type="button" id={`${id}-suggest`}
          onClick={() => { setPicked(suggestion); onChange(suggestion); }}
          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
        >
          <Sparkles className="h-3 w-3" />
          {tr(`Looks like ${suggestion.name} (${suggestion.code}) — use it`, `Mirip ${suggestion.name} (${suggestion.code}) — pakai`)}
        </button>
      )}
    </div>
  );
}
