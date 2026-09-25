"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, PackagePlus, X } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { documents, inventory, procurement } from "@/demo/api";
import { ITEM_PHOTO_MAX, ITEM_PHOTO_MIN } from "@/services/documents/contracts";
import { useToast } from "@/store/toast";
import { shrinkImage } from "../log/notaFile";

/** Registering an item at the rack (`0168`).
 *
 *  Built for the opname: somebody standing in front of a shelf with a phone.
 *  So the photo comes first and is compulsory — **one to four**, because a
 *  name typed by one person is a name another person cannot find, while a
 *  photo of the thing is recognisable by everybody. The catalogue name stays
 *  English and the floor's own word sits beside it; both are searched.
 *
 *  Counting is optional here and, when given, lands as an opname adjustment
 *  against a location (D171) — the same record the opname screen writes, not
 *  a second kind of number.
 */
export function RegisterItem({ mayCount, onCreated, onCancel }: {
  mayCount: boolean;
  onCreated: (itemCode: string) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [categories] = useLoad(() => inventory.listStockedCategories(), []);
  const [uoms] = useLoad(() => procurement.listUom(), []);
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [form, setForm] = useState({
    name: "", name_local: "", category_code: "", base_uom: "pcs", location: "", counted: 0, reason: "",
  });
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /* One key per form, so a double tap on a slow network registers one item. */
  const [key] = useState(() => `register-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  /* Blob previews are revoked when a photo is removed and when the form goes
     away — not on every change, which would blank the ones still showing. */
  const urls = useRef<string[]>([]);
  urls.current = photos.map((p) => p.url);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = ITEM_PHOTO_MAX - photos.length;
    const picked = Array.from(list).slice(0, room);
    if (list.length > room) {
      toast("warning", "Paling banyak empat foto", `${list.length - room} foto tidak diambil.`);
    }
    setPhotos([...photos, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    setBusy("Mengunggah foto…");
    const ids: string[] = [];
    for (const [i, p] of photos.entries()) {
      const up = await documents.upload({ file: await shrinkImage(p.file), kind: "Foto" });
      if (up.error) {
        setBusy(null);
        toast("warning", `Foto ${i + 1} tidak terunggah`, `${up.error.message} Barang belum didaftarkan — coba lagi.`);
        return;
      }
      ids.push(up.data.id);
    }
    setBusy("Menyimpan…");
    const counted = mayCount && form.counted > 0 ? form.counted : null;
    const res = await inventory.registerItem({
      name: form.name, name_local: form.name_local || null,
      category_code: form.category_code, base_uom: form.base_uom, photo_ids: ids,
      location: counted != null ? form.location : null, counted,
      reason: form.reason || null,
    }, key);
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Tidak terdaftar", res.error.message);
      return;
    }
    toast("success", `Terdaftar sebagai ${res.data.item_code}`,
      counted != null ? `Dengan ${photos.length} foto dan hitungan ${counted} ${res.data.uom}.` : `Dengan ${photos.length} foto.`);
    onCreated(res.data.item_code);
  }

  const countOk = !mayCount || form.counted <= 0 || !!form.location;
  const ready = form.name.trim() && form.category_code && form.base_uom
    && photos.length >= ITEM_PHOTO_MIN && photos.length <= ITEM_PHOTO_MAX && countOk;
  const field = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <Card className="mb-4">
      <CardHeader
        title="Daftarkan barang"
        subtitle="Untuk barang di rak yang belum ada di katalog. Foto wajib — minimal satu, paling banyak empat."
        icon={PackagePlus}
      />
      <div className="space-y-3 px-5 py-4">
        <div>
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, never optimised */}
                <img src={p.url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button" aria-label={`Buang foto ${i + 1}`}
                  onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((x) => x.url !== p.url)); }}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-slate-600 shadow hover:text-rose-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {photos.length < ITEM_PHOTO_MAX && (
              <button
                type="button" onClick={() => fileRef.current?.click()}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-500 hover:bg-slate-50"
              >
                <Camera className="h-5 w-5" />
                {photos.length === 0 ? "Foto barang" : "Tambah foto"}
              </button>
            )}
          </div>
          <p className={photos.length === 0 ? "mt-1 text-[11px] text-amber-700" : "mt-1 text-[11px] text-slate-500"}>
            {photos.length} dari {ITEM_PHOTO_MAX} foto{photos.length === 0 ? " — minimal satu" : ""}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-slate-500">
            Nama katalog (sistem)
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Sandpaper 240" className={`mt-1 ${field}`} />
          </label>
          <label className="text-[11px] text-slate-500">
            Nama lapangan (yang dipakai tim)
            <input value={form.name_local} onChange={(e) => setForm({ ...form, name_local: e.target.value })}
              placeholder="Amplas 240" className={`mt-1 ${field}`} />
          </label>
          <label className="text-[11px] text-slate-500">
            Kategori
            <Loaded state={categories} skeletonRows={1}>
              {(cats) => (
                <select value={form.category_code} onChange={(e) => setForm({ ...form, category_code: e.target.value })}
                  className={`mt-1 ${field}`}>
                  <option value="">— pilih —</option>
                  {cats.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              )}
            </Loaded>
          </label>
          <label className="text-[11px] text-slate-500">
            Satuan
            <Loaded state={uoms} skeletonRows={1}>
              {(list) => (
                <select value={form.base_uom} onChange={(e) => setForm({ ...form, base_uom: e.target.value })}
                  className={`mt-1 ${field}`}>
                  {list.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                </select>
              )}
            </Loaded>
          </label>
        </div>

        {mayCount && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <p className="text-[11px] text-slate-500">
              Sudah dihitung? Isi jumlah dan raknya — tercatat sebagai hasil opname. Kosongkan kalau belum.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px]">
              <Loaded state={locations} skeletonRows={1}>
                {(locs) => (
                  <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                    aria-label="Lokasi" className={field}>
                    <option value="">Pilih lokasi…</option>
                    {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                )}
              </Loaded>
              <NumberInput value={form.counted} onChange={(v) => setForm({ ...form, counted: v })} />
            </div>
            {form.counted > 0 && !form.location && (
              <p className="mt-1 text-[11px] text-amber-700">Pilih raknya — hitungan selalu milik satu lokasi.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={PackagePlus} disabled={!!busy || !ready} onClick={submit}>
            {busy ?? "Daftarkan"}
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={onCancel}>Batal</Button>
        </div>
      </div>
    </Card>
  );
}
