"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CircleEllipsis, Columns3, Disc3, Drill, Fan, Gauge, Layers, PanelTop, PlugZap, Router,
  Scissors, SprayCan, Wrench, type LucideIcon,
} from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { SegmentedControl } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { cn } from "@/lib/cn";
import { pick, useLang, useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import {
  ASSET_CONDITION_LABELS, FOUND_ASSET_TYPES, type AssetCondition, type FoundAssetType,
} from "@/services/inventory/contracts";
import { NO_ZONE, PhotoSlots, uploadSlotPhotos, usePhotoSlots } from "../shared";

/** Asset verification — something nobody had on record, registered where it
 *  stands (`register_found_asset`, 0292, D448).
 *
 *  The handoff's *Baru* screen: photo first, then what it is from big tiles a
 *  thumb can hit, then where — the zone being worked, already filled in. The
 *  type names it and decides its category (machine, tool, other); name, brand
 *  and model can be sharpened now or later on the asset itself. Saving creates
 *  the `AST-` number and a first, matching check, so it counts as verified in
 *  its zone and shows as *New* in the summary.
 *
 *  Counted things — materials, consumables, hand tools in bulk — are not
 *  registered here but counted in the zone's *Count stock* tab (D348).
 */
const TYPE_ICON: Record<FoundAssetType, LucideIcon> = {
  saw: Disc3, sander: Layers, planer: PanelTop, router: Router, drill: Drill, press: Columns3,
  compressor: Gauge, spray_booth: SprayCan, sewing: Scissors, power_tool: PlugZap, hand_tool: Wrench,
  other: CircleEllipsis,
};

export default function NewFoundAssetPage() {
  const tr = useTr();
  const lang = useLang();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const { toast } = useToast();
  const mayRegister = can("inventory.create");
  const zone = params.get("zone");
  const backHref = `/inventory/verify${zone ? `?zone=${encodeURIComponent(zone)}` : ""}`;

  const [locs] = useLoad(() => inventory.listStockLocations(), []);
  const locations = locs.status === "ready" ? locs.data : [];
  const { photos, setPhoto, hasWhole, taken } = usePhotoSlots();
  const [type, setType] = useState<FoundAssetType | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [condition, setCondition] = useState<AssetCondition | "">("");
  const [location, setLocation] = useState(zone && zone !== NO_ZONE ? zone : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState(() => `found-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  function pickType(t: FoundAssetType) {
    setType(t);
    /* The tile names it until the checker types a name of their own. */
    if (!nameTouched) setName(pick(FOUND_ASSET_TYPES.find((x) => x.type === t)!.label, "en"));
  }

  const category = type ? FOUND_ASSET_TYPES.find((x) => x.type === type)!.category : null;
  const ready = mayRegister && hasWhole && !!type && !!name.trim() && !!condition && !!location && !busy;

  async function save(another: boolean) {
    if (!ready || !category) return;
    const ids = await uploadSlotPhotos(taken, { entity: "asset" }, tr,
      (m) => setBusy(m), (title, msg) => { setBusy(null); toast("warning", title, msg); });
    if (!ids) return;
    setBusy(tr("Saving…", "Menyimpan…"));
    const res = await inventory.registerFoundAsset({
      name: name.trim(), category_code: category, location, condition: condition as AssetCondition,
      photo_ids: ids, brand: brand || null, model: model || null, note: note || null,
    }, key);
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr(`Registered as ${res.data.asset_no}`, `Terdaftar sebagai ${res.data.asset_no}`),
      tr(`${name.trim()} in ${location}, counted as verified.`, `${name.trim()} di ${location}, terhitung sudah dicek.`));
    if (another) {
      /* A fresh form, the place kept: a corner of a workshop is a run of finds. */
      for (let i = 0; i < 4; i++) setPhoto(i, null);
      setType(null); setName(""); setNameTouched(false); setBrand(""); setModel(""); setCondition(""); setNote("");
      setKey(`found-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    } else {
      router.push(`/inventory/verify?zone=${encodeURIComponent(location)}`);
    }
  }

  const field = "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" />{tr("Cancel", "Batal")}
          </Link>
          <h1 className="text-lg font-bold text-slate-800">{tr("Add a new item", "Tambah barang baru")}</h1>
        </div>
        <span className="text-xs text-slate-500">{tr("Gets the next AST number when saved", "Dapat nomor AST berikutnya saat disimpan")}</span>
      </div>

      {!mayRegister && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {tr("Registering an asset needs inventory write access.", "Mendaftarkan aset butuh akses tulis inventory.")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">{tr("1. Photo first", "1. Foto dulu")}</p>
            <PhotoSlots photos={photos} setPhoto={setPhoto} disabled={!mayRegister}
              firstLabel={{ en: "Whole item", id: "Seluruh barang" }} />
          </Card>
          <Card className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-700">{tr("3. Where and how", "3. Di mana dan bagaimana")}</p>
            <label className="block">
              <span className="text-sm text-slate-700">{tr("Location", "Lokasi")}</span>
              <select value={location} onChange={(e) => setLocation(e.target.value)} className={field} disabled={!mayRegister}>
                <option value="">{tr("Pick a location", "Pilih lokasi")}</option>
                {locations.map((l) => <option key={l.code} value={l.code}>{l.code} · {l.name}</option>)}
              </select>
              {zone && zone !== NO_ZONE && location === zone && (
                <span className="mt-1 block text-[11px] text-slate-500">{tr("Taken from the zone being checked", "Diambil dari zona yang sedang dicek")}</span>
              )}
            </label>
            <div>
              <p className="mb-1.5 text-sm text-slate-700">{tr("Condition", "Kondisi")}</p>
              <SegmentedControl<AssetCondition | "">
                value={condition} onChange={setCondition}
                options={(["working", "broken", "untested"] as AssetCondition[]).map((c) => ({ value: c, label: pick(ASSET_CONDITION_LABELS[c], lang) }))}
              />
            </div>
            <label className="block">
              <span className="text-sm text-slate-700">{tr("Note", "Catatan")}</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!mayRegister}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </label>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-700">{tr("2. What is it?", "2. Barang apa ini?")}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {FOUND_ASSET_TYPES.map((t) => {
                const Icon = TYPE_ICON[t.type];
                const on = type === t.type;
                return (
                  <button
                    key={t.type} type="button" onClick={() => pickType(t.type)} disabled={!mayRegister}
                    aria-pressed={on}
                    className={cn(
                      "flex min-h-[5.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center text-sm font-medium transition-colors",
                      on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                    )}
                  >
                    <Icon className="h-6 w-6" />
                    {pick(t.label, lang)}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className="text-sm text-slate-700">{tr("Name", "Nama")}</span>
                <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} disabled={!mayRegister}
                  placeholder={tr("e.g. Sander, Orbital", "mis. Sander, Orbital")} className={field} />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Brand", "Merek")}</span>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={!mayRegister} className={field} />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Model", "Model")}</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} disabled={!mayRegister} className={field} />
              </label>
              <p className="self-end pb-2 text-[11px] text-slate-500">{tr("Optional — can be added later.", "Opsional — bisa dilengkapi nanti.")}</p>
            </div>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {busy && <span className="text-xs text-slate-500">{busy}</span>}
          <Button variant="outline" disabled={!ready} onClick={() => save(true)}>{tr("Save & add another", "Simpan & tambah lagi")}</Button>
          <Button disabled={!ready} onClick={() => save(false)}>{tr("Save", "Simpan")}</Button>
        </div>
      </div>
    </div>
  );
}
