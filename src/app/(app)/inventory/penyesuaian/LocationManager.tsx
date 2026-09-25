"use client";

import { useState } from "react";
import { MapPin, Plus, X, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { useToast } from "@/store/toast";

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
 *  be, until somebody reloaded the page by hand. */
export function LocationManager({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [locs, reload] = useLoad(() => inventory.listStockLocations({ all: true }), []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { reload(); onChanged?.(); };

  async function add() {
    setBusy("new");
    const res = await inventory.createStockLocation({ code, name });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Tidak tersimpan", res.error.message);
      return;
    }
    toast("success", `Lokasi ${res.data.code}`, `${res.data.name} bisa dipilih mulai sekarang.`);
    setCode(""); setName("");
    refresh();
  }

  async function toggle(loc: { code: string; is_active: boolean }) {
    setBusy(loc.code);
    const res = await inventory.updateStockLocation(loc.code, { is_active: !loc.is_active });
    setBusy(null);
    if (res.error) { toast("critical", "Tidak tersimpan", res.error.message); return; }
    refresh();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Kelola lokasi"
        subtitle="Area yang bisa dipilih saat opname. Menonaktifkan sebuah lokasi tidak menghapus riwayat hitungannya."
        icon={MapPin}
      />
      <Loaded state={locs} skeletonRows={2} onRetry={reload}>
        {(all) => (
          <>
            <ul className="divide-y divide-slate-100">
              {all.map((l) => (
                <li key={l.code} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-[90px] font-mono text-[11px] text-slate-400">{l.code}</span>
                  <span className="flex-1 text-[13px] text-slate-800">{l.name}</span>
                  <Badge tone={l.is_active ? "green" : "slate"}>{l.is_active ? "aktif" : "nonaktif"}</Badge>
                  <Button
                    size="sm" variant="ghost" icon={l.is_active ? X : Undo2}
                    disabled={busy === l.code}
                    onClick={() => toggle(l)}
                  >
                    {l.is_active ? "Nonaktifkan" : "Aktifkan lagi"}
                  </Button>
                </li>
              ))}
              {all.length === 0 && (
                <li className="px-5 py-6 text-[13px] text-slate-500">Belum ada lokasi.</li>
              )}
            </ul>
            <div className="grid gap-2 border-t border-slate-100 px-5 py-3 sm:grid-cols-[140px_1fr_auto]">
              <input
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Kode, mis. AREA-A"
                className="h-9 rounded-lg border border-slate-200 px-2 font-mono text-sm uppercase focus:border-brand-400 focus:outline-none"
              />
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Nama, mis. Area A — rak amplas"
                className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
              <Button
                size="sm" icon={Plus}
                disabled={busy === "new" || !code.trim() || !name.trim()}
                onClick={add}
              >
                {busy === "new" ? "Menyimpan…" : "Tambah lokasi"}
              </Button>
            </div>
          </>
        )}
      </Loaded>
    </Card>
  );
}
