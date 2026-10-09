"use client";

import { useState } from "react";
import { Copy, ExternalLink, Images, Pencil } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { design } from "@/demo/api";
import type { DesignCollection } from "@/services/design/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** The collection's gallery: a link to a shared Google Photos album of the
 *  whole set's renders, which the team opens here and the client opens from
 *  the link (0251, D407). Nothing is copied into ops; the album is the album. */
export function CollectionGallery({
  projectCode, collection, canEdit, onChanged, className,
}: {
  projectCode: string; collection: Pick<DesignCollection, "code" | "name" | "gallery_url">;
  canEdit: boolean; onChanged: () => void; className?: string;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(collection.gallery_url ?? "");
  const [busy, setBusy] = useState(false);
  const link = collection.gallery_url;

  async function save() {
    setBusy(true);
    const r = await design.setDesignCollectionGallery({ project_code: projectCode, code: collection.code, url: url.trim() || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", url.trim() ? tr("Gallery link saved", "Link galeri tersimpan") : tr("Gallery link removed", "Link galeri dihapus"));
    setEditing(false);
    onChanged();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast("success", tr("Link copied — send it to the client", "Link tersalin — kirim ke klien"));
    } catch {
      toast("info", tr("Copy it from the address", "Salin dari alamatnya"), link);
    }
  }

  if (editing) {
    return (
      <div className={cn("w-full space-y-1.5", className)}>
        <label className="block text-[11px] text-slate-500">
          {tr(`Gallery of collection ${collection.code} — a shared Google Photos album link`, `Galeri koleksi ${collection.code} — link album Google Photos yang dibagikan`)}
          <input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://photos.app.goo.gl/…"
            className={cn(inputCls, "mt-1")} />
        </label>
        <p className="text-[11px] text-slate-400">
          {tr("In Google Photos: album › Share › Create link. Leave empty to remove.",
            "Di Google Photos: album › Bagikan › Buat link. Kosongkan untuk menghapus.")}
        </p>
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setUrl(collection.gallery_url ?? ""); }} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button size="sm" onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]", className)}>
      <Images className="h-3.5 w-3.5 text-slate-400" />
      {link ? (
        <>
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            {tr(`Gallery ${collection.code}`, `Galeri ${collection.code}`)} <ExternalLink className="h-3 w-3" />
          </a>
          <button onClick={copy} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">
            <Copy className="h-3 w-3" /> {tr("Copy for the client", "Salin untuk klien")}
          </button>
        </>
      ) : (
        <span className="text-slate-400">{tr("No gallery link yet", "Belum ada link galeri")}</span>
      )}
      {canEdit && (
        <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-brand-700 hover:bg-brand-50">
          <Pencil className="h-3 w-3" /> {link ? tr("Change", "Ubah") : tr("Add link", "Tambah link")}
        </button>
      )}
    </div>
  );
}
