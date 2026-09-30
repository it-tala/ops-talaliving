"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { inventory, procurement } from "@/demo/api";
import type { StockItemDetail } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** An item's own details, editable from the rack (`update_item_details`,
 *  `0198`, D348): the catalogue name, the floor's name, the category and the
 *  unit. The unit changes only while nothing is entered in another one — the
 *  database says so when it is not. Replaces the floor-name-only edit (0168);
 *  the Edit and Save buttons keep their names because the guide and the walk
 *  press them. */
export function ItemDetails({ d, mayEdit, onSaved }: {
  d: StockItemDetail;
  mayEdit: boolean;
  onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [draft, setDraft] = useState<null | { name: string; name_local: string; category_code: string; base_uom: string }>(null);
  const [busy, setBusy] = useState(false);
  const [cats] = useLoad(() => inventory.listStockedCategories(), []);
  const [uoms] = useLoad(() => procurement.listUom(), []);

  async function save() {
    if (!draft) return;
    setBusy(true);
    const res = await inventory.updateItemDetails(d.item_code, {
      name: draft.name !== d.item_name ? draft.name : undefined,
      name_local: draft.name_local.trim() ? draft.name_local : undefined,
      clear_local: !draft.name_local.trim() && !!d.item_name_local,
      category_code: draft.category_code !== d.category_code ? draft.category_code : undefined,
      base_uom: draft.base_uom !== d.uom ? draft.base_uom : undefined,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Saved", "Tersimpan"), res.data?.item_name ?? d.item_name);
    setDraft(null);
    onSaved();
  }

  if (!draft) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-slate-500">{tr("Floor name", "Nama lapangan")}</span>
        <span className="font-medium text-slate-800">{d.item_name_local ?? <span className="text-amber-700">{tr("not filled in", "belum diisi")}</span>}</span>
        {mayEdit && (
          <Button size="sm" variant="ghost" icon={Pencil}
            onClick={() => setDraft({ name: d.item_name, name_local: d.item_name_local ?? "", category_code: d.category_code, base_uom: d.uom })}>
            {tr("Edit", "Ubah")}
          </Button>
        )}
      </div>
    );
  }

  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 px-4 py-3">
      <p className="text-[12px] font-semibold text-slate-700">{tr("Edit item details", "Ubah data barang")}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-slate-500">
          {tr("Catalogue name", "Nama katalog")}
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
        </label>
        <label className="text-[11px] text-slate-500">
          {tr("Floor name", "Nama lapangan")}
          <input value={draft.name_local} onChange={(e) => setDraft({ ...draft, name_local: e.target.value })} autoFocus
            placeholder={tr("e.g. amplas 240", "mis. amplas 240")} className={field} />
        </label>
        <label className="text-[11px] text-slate-500">
          {tr("Category", "Kategori")}
          <Loaded state={cats} skeletonRows={1}>
            {(list) => (
              <select value={draft.category_code} onChange={(e) => setDraft({ ...draft, category_code: e.target.value })} className={field}>
                {!list.some((c) => c.code === draft.category_code) && <option value={draft.category_code}>{d.category_name}</option>}
                {[...new Set(list.map((c) => c.parent_name ?? c.name))].map((g) => (
                  <optgroup key={g} label={g}>
                    {list.filter((c) => (c.parent_name ?? c.name) === g).map((c) => (
                      <option key={c.code} value={c.code}>{c.parent_code ? c.name : tr(`${c.name} (general)`, `${c.name} (umum)`)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </Loaded>
        </label>
        <label className="text-[11px] text-slate-500">
          {tr("Unit", "Satuan")}
          <Loaded state={uoms} skeletonRows={1}>
            {(list) => (
              <select value={draft.base_uom} onChange={(e) => setDraft({ ...draft, base_uom: e.target.value })} className={field}>
                {list.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
              </select>
            )}
          </Loaded>
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy || !draft.name.trim()} onClick={save}>{tr("Save", "Simpan")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{tr("Cancel", "Batal")}</Button>
      </div>
    </div>
  );
}
