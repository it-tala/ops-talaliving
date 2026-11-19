"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CircleEllipsis, Columns3, Disc3, Drill, Gauge, Layers, PanelTop, Router, Scissors, SprayCan, Wrench,
  type LucideIcon,
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
  ASSET_CONDITION_LABELS, FOUND_ASSET_TYPES, composeName,
  type AssetCondition, type CodeFamily, type FoundAssetType,
} from "@/services/inventory/contracts";
import { NO_ZONE, PhotoSlots, uploadSlotPhotos, usePhotoSlots } from "../shared";

/** Asset verification — something nobody had on record, registered where it
 *  stands (`register_found_asset`, 0292, 0293, D448, D451).
 *
 *  Photo first; then **what it is**, as a family of the one code system
 *  (the tiles are shortcuts, *Other…* is the whole list and can add a family);
 *  then a name in the 2013 register's own format, built from the family's
 *  type word, a descriptor and a size so it cannot drift
 *  (`SAW, RADIAL ARM (LARGE)`); one sentence on what it is for; and where —
 *  the zone being worked. The code is the family's next number and is shown
 *  before saving. Saving records a first, matching check, so the find counts
 *  as verified and shows as *New*.
 *
 *  Counted things — materials, consumables, hand tools in bulk — are counted
 *  in the zone's *Count stock* tab instead (D348).
 */
const TYPE_ICON: Record<FoundAssetType, LucideIcon> = {
  saw: Disc3, sander: Layers, planer: PanelTop, router: Router, drill: Drill, press: Columns3,
  compressor: Gauge, spray_booth: SprayCan, sewing: Scissors, tool: Wrench, other: CircleEllipsis,
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
  const [fams, reloadFams] = useLoad(() => inventory.listCodeFamilies({ kind: "unit" }), []);
  const [list] = useLoad(() => inventory.listAssetVerification(), []);
  const locations = locs.status === "ready" ? locs.data : [];
  const families = fams.status === "ready" ? fams.data : [];
  const { photos, setPhoto, hasWhole, taken } = usePhotoSlots();

  const [tile, setTile] = useState<FoundAssetType | null>(null);
  const [familyCode, setFamilyCode] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [size, setSize] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [condition, setCondition] = useState<AssetCondition | "">("");
  const [location, setLocation] = useState(zone && zone !== NO_ZONE ? zone : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newFamily, setNewFamily] = useState<{ type: string; label: string } | null>(null);
  const [key, setKey] = useState(() => `found-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const family: CodeFamily | undefined = families.find((f) => f.code === familyCode);
  const name = family ? composeName(family.type_name, descriptor, size) : "";
  /* The code it will get: the family's next number. The database gives the
     final one; this is the preview. */
  const nextCode = useMemo(() => {
    if (!family || list.status !== "ready") return null;
    const max = list.data.filter((r) => r.family_code === family.code)
      .reduce((m, r) => Math.max(m, Number(r.code?.split("-")[1]) || 0), 0);
    return `${family.code}-${String(max + 1).padStart(2, "0")}`;
  }, [family, list]);

  function pickTile(t: FoundAssetType) {
    setTile(t);
    const typeWord = FOUND_ASSET_TYPES.find((x) => x.type === t)?.family_type;
    const f = typeWord ? families.find((x) => x.type_name === typeWord) : undefined;
    setFamilyCode(f?.code ?? "");
  }

  async function addFamily() {
    if (!newFamily) return;
    const res = await inventory.saveCodeFamily({ type_name: newFamily.type, label_en: newFamily.label || newFamily.type });
    if (res.error) { toast("warning", tr("Family not added", "Famili tidak ditambahkan"), res.error.message); return; }
    toast("success", tr(`Family ${res.data.code} added`, `Famili ${res.data.code} ditambahkan`), res.data.type_name);
    setNewFamily(null);
    reloadFams();
    setFamilyCode(res.data.code);
  }

  const ready = mayRegister && hasWhole && !!family && !!descriptor.trim() && !!description.trim() && !!condition && !!location && !busy;

  async function save(another: boolean) {
    if (!ready || !family) return;
    const ids = await uploadSlotPhotos(taken, { entity: "asset" }, tr,
      (m) => setBusy(m), (title, msg) => { setBusy(null); toast("warning", title, msg); });
    if (!ids) return;
    setBusy(tr("Saving…", "Menyimpan…"));
    const res = await inventory.registerFoundAsset({
      name, family_code: family.code, description: description.trim(), location,
      condition: condition as AssetCondition, photo_ids: ids, brand: brand || null, model: model || null, note: note || null,
    }, key);
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr(`Registered as ${res.data.code}`, `Terdaftar sebagai ${res.data.code}`),
      tr(`${name} in ${location}, counted as verified.`, `${name} di ${location}, terhitung sudah dicek.`));
    if (another) {
      for (let i = 0; i < 4; i++) setPhoto(i, null);
      setTile(null); setFamilyCode(""); setDescriptor(""); setSize(""); setDescription(""); setBrand(""); setModel("");
      setCondition(""); setNote("");
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
        <span className="text-xs text-slate-500">
          {nextCode ? tr(`Code on save: ${nextCode}`, `Kode saat disimpan: ${nextCode}`) : tr("Pick its family to see its code", "Pilih famili untuk melihat kodenya")}
        </span>
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
            <p className="text-sm font-semibold text-slate-700">{tr("4. Where and how", "4. Di mana dan bagaimana")}</p>
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
            <p className="mb-3 text-sm font-semibold text-slate-700">{tr("2. What is it? (its family)", "2. Barang apa ini? (famili)")}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {FOUND_ASSET_TYPES.map((t) => {
                const Icon = TYPE_ICON[t.type];
                const on = tile === t.type;
                const f = t.family_type ? families.find((x) => x.type_name === t.family_type) : undefined;
                return (
                  <button
                    key={t.type} type="button" onClick={() => pickTile(t.type)} disabled={!mayRegister} aria-pressed={on}
                    className={cn(
                      "flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-3 text-center text-sm font-medium transition-colors",
                      on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                    )}
                  >
                    <Icon className="h-6 w-6" />
                    {pick(t.label, lang)}
                    {f && <span className={cn("font-mono text-[10px]", on ? "text-white/80" : "text-slate-400")}>{f.code}</span>}
                  </button>
                );
              })}
            </div>
            {(tile === "other" || (tile && !family)) && (
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="text-sm text-slate-700">{tr("Family", "Famili")}</span>
                  <select value={familyCode} onChange={(e) => setFamilyCode(e.target.value)} className={field} disabled={!mayRegister}>
                    <option value="">{tr("Pick a family", "Pilih famili")}</option>
                    {families.map((f) => (
                      <option key={f.code} value={f.code}>{f.code} · {lang === "id" && f.label_id ? f.label_id : f.label_en} ({f.type_name})</option>
                    ))}
                  </select>
                </label>
                {newFamily ? (
                  <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <input value={newFamily.type} onChange={(e) => setNewFamily({ ...newFamily, type: e.target.value.toUpperCase() })}
                      placeholder={tr("TYPE WORD, e.g. TROLLEY", "KATA JENIS, mis. TROLLEY")} className={field} />
                    <input value={newFamily.label} onChange={(e) => setNewFamily({ ...newFamily, label: e.target.value })}
                      placeholder={tr("Name people read, e.g. Trolley", "Nama yang dibaca, mis. Troli")} className={field} />
                    <div className="flex items-end gap-1">
                      <Button size="sm" disabled={!newFamily.type.trim()} onClick={addFamily}>{tr("Add", "Tambah")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setNewFamily(null)}>{tr("Cancel", "Batal")}</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setNewFamily({ type: "", label: "" })}>
                    {tr("Not in the list? Add a family", "Tidak ada di daftar? Tambah famili")}
                  </button>
                )}
              </div>
            )}
            {family && (
              <p className="mt-3 text-xs text-slate-500">
                {tr(`Family ${family.code}: ${family.label_en}. Its code: the next number in it.`, `Famili ${family.code}: ${family.label_id ?? family.label_en}. Kodenya: nomor berikutnya di famili ini.`)}
              </p>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">{tr("3. Name it, and say what it is", "3. Beri nama, dan jelaskan barangnya")}</p>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Descriptor (what kind)", "Deskriptor (jenis apa)")}</span>
                <input value={descriptor} onChange={(e) => setDescriptor(e.target.value)} disabled={!mayRegister || !family}
                  placeholder={tr("e.g. RADIAL ARM", "mis. RADIAL ARM")} className={field} />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Size / variant", "Ukuran / varian")}</span>
                <input value={size} onChange={(e) => setSize(e.target.value)} disabled={!mayRegister || !family}
                  placeholder={tr("optional, e.g. LARGE", "opsional, mis. LARGE")} className={field} />
              </label>
            </div>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800" aria-live="polite">
              {name || <span className="text-slate-400">{tr("TYPE, DESCRIPTOR (SIZE)", "JENIS, DESKRIPTOR (UKURAN)")}</span>}
            </p>
            <label className="mt-3 block">
              <span className="text-sm text-slate-700">{tr("What it is and what it is used for", "Apa barang ini dan untuk apa")}</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!mayRegister}
                placeholder={tr("e.g. Cuts long boards to length across the grain", "mis. Memotong papan panjang melintang serat")} className={field} />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Brand", "Merek")}</span>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={!mayRegister} className={field} />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">{tr("Model", "Model")}</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} disabled={!mayRegister} className={field} />
              </label>
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
