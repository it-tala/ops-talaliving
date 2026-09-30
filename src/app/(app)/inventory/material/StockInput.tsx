"use client";

import { useMemo, useState } from "react";
import { ClipboardPlus } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { formatNumber } from "@/lib/format";
import { inventory } from "@/demo/api";
import type { StockItemView } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Entering stock from zero (`0198`, D348).
 *
 *  The owner: *biarkan user input stok dari awal … biarkan itu menjadi
 *  referensi nama saja setiap kali user input.* The catalogue is not the rack
 *  any more — it is the list of names a storeman picks from, typed to filter.
 *  A name it does not have is registered on the spot (`onNewItem`, the
 *  existing *Register an item* form with the typed name filled in).
 *
 *  The form stays open after a save, with the location kept, because entering
 *  a rack is a run of entries, not one.
 */
export function StockInput({ catalogue, onSaved, onNewItem, onClose }: {
  catalogue: StockItemView[];
  onSaved: (itemCode: string) => void;
  onNewItem: (name: string) => void;
  onClose: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [form, setForm] = useState({ item_code: "", location: "", qty: 0, note: "" });
  const [busy, setBusy] = useState(false);
  /* One key per entry, so a double tap on a slow network enters it once. */
  const [key, setKey] = useState(() => newKey());

  const options = useMemo(() => catalogue.map((r) => ({
    value: r.item_code,
    label: r.item_name_local ? `${r.item_name} — ${r.item_name_local}` : r.item_name,
    sublabel: `${r.item_code} · ${r.category_name} · ${r.uom}${r.moves_count > 0 ? ` · ${formatNumber(r.on_hand)} ${tr("on the rack", "di rak")}` : ""}`,
  })), [catalogue, tr]);
  const picked = catalogue.find((r) => r.item_code === form.item_code);

  async function save() {
    setBusy(true);
    const res = await inventory.inputStock({
      item_code: form.item_code, location: form.location, qty: form.qty, note: form.note || null,
    }, key);
    setBusy(false);
    if (res.error) {
      toast("warning", tr("Not entered", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Entered", "Tercatat"),
      tr(`${picked?.item_name ?? form.item_code}: +${formatNumber(form.qty)} ${picked?.uom ?? ""}, now ${formatNumber(res.data.on_hand)} in total.`,
        `${picked?.item_name ?? form.item_code}: +${formatNumber(form.qty)} ${picked?.uom ?? ""}, sekarang total ${formatNumber(res.data.on_hand)}.`));
    onSaved(form.item_code);
    setForm({ item_code: "", location: form.location, qty: 0, note: "" });
    setKey(newKey());
  }

  const ready = !!form.item_code && !!form.location && form.qty > 0;
  const field = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Input stock", "Input stok")}
        subtitle={tr(
          "Pick the item by name from the catalogue, the location and the quantity on it. A name that is not in the catalogue yet can be added from here.",
          "Pilih nama barang dari katalog, lokasinya, dan jumlah yang ada. Nama yang belum ada di katalog bisa ditambahkan dari sini.",
        )}
        icon={ClipboardPlus}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          {/* A div, not a label: a label re-focuses the combobox's input on any
              click inside it and reopens the list over the form. */}
          <div className="text-[11px] text-slate-500">
            {tr("Item", "Barang")}
            <div className="mt-1">
              <Combobox
                value={form.item_code}
                onChange={(v) => setForm({ ...form, item_code: v })}
                options={options}
                placeholder={tr("Type a name or code…", "Ketik nama atau kode…")}
                onCreate={(name) => onNewItem(name)}
                createLabel={(q) => tr(`New item: "${q}"`, `Barang baru: "${q}"`)}
              />
            </div>
          </div>
          <label className="text-[11px] text-slate-500">
            {tr("Location", "Lokasi")}
            <Loaded state={locations} skeletonRows={1}>
              {(locs) => (
                <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  aria-label={tr("Location", "Lokasi")} className={`mt-1 ${field}`}>
                  <option value="">{tr("Choose a location…", "Pilih lokasi…")}</option>
                  {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              )}
            </Loaded>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
          <label className="text-[11px] text-slate-500">
            {tr("Quantity", "Jumlah")}{picked ? ` (${picked.uom})` : ""}
            <div className="mt-1"><NumberInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></div>
          </label>
          <label className="text-[11px] text-slate-500">
            {tr("Note (optional)", "Catatan (opsional)")}
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={tr("e.g. counted on rack A, top shelf", "mis. dihitung di rak A, susun atas")}
              className={`mt-1 ${field}`} />
          </label>
        </div>
        {picked && picked.moves_count > 0 && (
          <p className="text-[11px] text-slate-500">
            {tr(
              `Already entered: ${formatNumber(picked.on_hand)} ${picked.uom}${picked.by_location.length ? ` (${picked.by_location.map((l) => `${l.location_name} ${formatNumber(l.qty)}`).join(" · ")})` : ""}. This entry adds to it — to correct an earlier one, edit it in the item's history.`,
              `Sudah tercatat: ${formatNumber(picked.on_hand)} ${picked.uom}${picked.by_location.length ? ` (${picked.by_location.map((l) => `${l.location_name} ${formatNumber(l.qty)}`).join(" · ")})` : ""}. Input ini menambahkannya — untuk membetulkan input sebelumnya, ubah di riwayat barangnya.`,
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={ClipboardPlus} disabled={busy || !ready} onClick={save}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Save entry", "Simpan input")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>{tr("Close", "Tutup")}</Button>
        </div>
      </div>
    </Card>
  );
}

function newKey() {
  return `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
