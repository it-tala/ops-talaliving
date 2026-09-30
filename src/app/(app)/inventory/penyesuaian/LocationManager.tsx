"use client";

import { useState } from "react";
import { MapPin, Plus, X, Undo2, Pencil, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Which racks opname can count against — addable from here since 2026-09-25
 *  (`0157`), so agreeing on areas with the floor does not wait on a deploy.
 *
 *  Still few on purpose (`0071`'s own reasoning stands): a location nobody
 *  walks to is a location nobody counts, and this panel is gated behind
 *  `inventory.update` for that reason — it is a curated list, not a free-text
 *  field every counter can grow on their own. There is no delete, only
 *  active/inactive: a rack once counted against stays in `stock_moves`'
 *  history whether or not it is still offered on the next count.
 *
 *  `onChanged` tells the page holding the opname form to reload **its own**
 *  location list — a separate `useLoad` call there, because that picker only
 *  wants active racks while this panel shows retired ones too. Without it, a
 *  location added here would say "selectable starting now" and not actually
 *  be, until somebody reloaded the page by hand.
 *
 *  A name can be changed; a code cannot (`0157`: the code is the key the
 *  history is filed under). *Rename* was in D308 and in both API layers but
 *  never on this panel — found by the inventory walk (F178).
 *
 *  One list for every place inventory keeps something (`0197`, D347): racks
 *  for material and finished goods, and where an asset stands — furniture,
 *  machines, vehicles. The asset form picks from it too. */
export function LocationManager({ onChanged }: { onChanged?: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [locs, reload] = useLoad(() => inventory.listStockLocations({ all: true }), []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ code: string; name: string } | null>(null);
  const refresh = () => { reload(); onChanged?.(); };

  async function add() {
    setBusy("new");
    const res = await inventory.createStockLocation({ code, name });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr(`Location ${res.data.code}`, `Lokasi ${res.data.code}`), tr(`${res.data.name} can be chosen starting now.`, `${res.data.name} bisa dipilih mulai sekarang.`));
    setCode(""); setName("");
    refresh();
  }

  async function toggle(loc: { code: string; is_active: boolean }) {
    setBusy(loc.code);
    const res = await inventory.updateStockLocation(loc.code, { is_active: !loc.is_active });
    setBusy(null);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    refresh();
  }

  async function rename() {
    if (!editing) return;
    setBusy(editing.code);
    const res = await inventory.updateStockLocation(editing.code, { name: editing.name });
    setBusy(null);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`Location ${res.data.code}`, `Lokasi ${res.data.code}`), tr(`Now called ${res.data.name}.`, `Sekarang bernama ${res.data.name}.`));
    setEditing(null);
    refresh();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Manage locations", "Kelola lokasi")}
        subtitle={tr("One list for material stock, finished goods and assets (furniture, machines, vehicles). Deactivating a location does not delete its history.", "Satu daftar untuk stok material, barang jadi dan aset (perabotan, mesin, kendaraan). Menonaktifkan sebuah lokasi tidak menghapus riwayatnya.")}
        icon={MapPin}
      />
      <Loaded state={locs} skeletonRows={2} onRetry={reload}>
        {(all) => (
          <>
            <ul className="divide-y divide-slate-100">
              {all.map((l) => (
                <li key={l.code} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-[90px] font-mono text-[11px] text-slate-400">{l.code}</span>
                  {editing?.code === l.code ? (
                    <>
                      <input
                        value={editing.name} autoFocus
                        onChange={(e) => setEditing({ code: l.code, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }}
                        aria-label={tr(`New name for ${l.code}`, `Nama baru untuk ${l.code}`)}
                        className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <Button size="sm" icon={Check} disabled={busy === l.code || !editing.name.trim()} onClick={rename}>
                        {tr("Save name", "Simpan nama")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr("Cancel", "Batal")}</Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-[13px] text-slate-800">{l.name}</span>
                      <Button size="sm" variant="ghost" icon={Pencil} disabled={busy === l.code}
                        onClick={() => setEditing({ code: l.code, name: l.name })}>
                        {tr("Rename", "Ganti nama")}
                      </Button>
                    </>
                  )}
                  <Badge tone={l.is_active ? "green" : "slate"}>{l.is_active ? tr("active", "aktif") : tr("inactive", "nonaktif")}</Badge>
                  <Button
                    size="sm" variant="ghost" icon={l.is_active ? X : Undo2}
                    disabled={busy === l.code}
                    onClick={() => toggle(l)}
                  >
                    {l.is_active ? tr("Deactivate", "Nonaktifkan") : tr("Reactivate", "Aktifkan lagi")}
                  </Button>
                </li>
              ))}
              {all.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No locations yet.", "Belum ada lokasi.")}</li>
              )}
            </ul>
            <div className="grid gap-2 border-t border-slate-100 px-5 py-3 sm:grid-cols-[140px_1fr_auto]">
              <input
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder={tr("Code, e.g. AREA-A", "Kode, mis. AREA-A")}
                className="h-9 rounded-lg border border-slate-200 px-2 font-mono text-sm uppercase focus:border-brand-400 focus:outline-none"
              />
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder={tr("Name, e.g. Area A — sanding rack", "Nama, mis. Area A — rak amplas")}
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
              <Button
                size="sm" icon={Plus}
                disabled={busy === "new" || !code.trim() || !name.trim()}
                onClick={add}
              >
                {busy === "new" ? tr("Saving…", "Menyimpan…") : tr("Add location", "Tambah lokasi")}
              </Button>
            </div>
          </>
        )}
      </Loaded>
    </Card>
  );
}
