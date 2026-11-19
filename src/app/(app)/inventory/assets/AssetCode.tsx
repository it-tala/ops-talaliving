"use client";

import { useState } from "react";
import { Hash, Pencil } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { inventory } from "@/demo/api";
import type { AssetView, CodeFamily } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

/** A family as one option line: `S2 · Saw`. */
export function familyOption(f: CodeFamily, lang: (en: string, id: string) => string): string {
  return `${f.code} · ${lang(f.label_en, f.label_id ?? f.label_en)}`;
}

/** The families a thing counted one by one can be in, for a `<select>`. */
export function FamilySelect({
  id, value, families, onChange, placeholder,
}: {
  id: string; value: string; families: CodeFamily[]; onChange: (f: CodeFamily | null) => void; placeholder: string;
}) {
  const tr = useTr();
  return (
    <select id={id} value={value} onChange={(e) => onChange(families.find((f) => f.code === e.target.value) ?? null)}
      className={inputClass + " bg-white"}>
      <option value="">{placeholder}</option>
      {families.map((f) => <option key={f.code} value={f.code}>{familyOption(f, tr)}</option>)}
    </select>
  );
}

/** The code block at the top of an asset's drawer (0293, 0294, D451): the code
 *  people see, its family, the 2013 code kept for the old photos, the key the
 *  label's QR carries, and the sentence on what it is. The sentence is edited
 *  here; a wrong family is fixed by recoding, with a reason, the old code kept
 *  in the history so an old label still finds it. */
export function AssetCodePanel({
  asset, families, canEdit, onChanged,
}: {
  asset: AssetView; families: CodeFamily[]; canEdit: boolean; onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState<"" | "description" | "family">("");
  const [text, setText] = useState("");
  const [family, setFamily] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveDescription() {
    setSaving(true);
    const r = await inventory.describeRecord("asset", asset.asset_no, text);
    setSaving(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    setEditing("");
    onChanged();
  }

  async function recode() {
    setSaving(true);
    const r = await inventory.recodeAsset(asset.asset_no, family, reason);
    setSaving(false);
    if (r.error) { toast("warning", tr("Not changed", "Tidak berubah"), r.error.message); return; }
    toast("success", tr("Code changed", "Kode diubah"),
      tr(`${r.data.old_code ?? "—"} is now ${r.data.code}. The old code still finds it.`,
         `${r.data.old_code ?? "—"} sekarang ${r.data.code}. Kode lama tetap bisa dicari.`));
    setEditing(""); setFamily(""); setReason("");
    onChanged();
  }

  return (
    <section className="rounded-lg border border-slate-200 px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Hash className="h-4 w-4 self-center text-slate-400" />
        <span className="font-mono text-lg font-semibold text-slate-900">{asset.code ?? "—"}</span>
        {asset.family_label && (
          <span className="text-[13px] text-slate-600">{tr(asset.family_label, asset.family_label_id ?? asset.family_label)}</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-slate-400">
          {asset.legacy_code && <>{tr("2013", "2013")} {asset.legacy_code} · </>}{asset.asset_no}
        </span>
      </div>

      {editing === "description" ? (
        <div className="mt-2 space-y-2">
          <label htmlFor="ac-desc" className="block text-xs text-slate-600">
            {tr("What it is and what it is used for — one sentence", "Apa ini dan dipakai untuk apa — satu kalimat")}
          </label>
          <input id="ac-desc" value={text} onChange={(e) => setText(e.target.value)} className={inputClass}
            placeholder={tr("e.g. Cuts long boards across the grain in the machine room.", "mis. Memotong papan panjang melintang serat di ruang mesin.")} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing("")}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={saveDescription} disabled={saving}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      ) : (
        <p className={"mt-2 text-[13px] " + (asset.description ? "text-slate-700" : "italic text-slate-400")}>
          {asset.description ?? tr("No sentence yet on what it is.", "Belum ada kalimat tentang barang ini.")}
          {canEdit && (
            <button type="button" onClick={() => { setText(asset.description ?? ""); setEditing("description"); }}
              className="ml-2 inline-flex items-center gap-1 text-[12px] not-italic text-brand-700 hover:underline">
              <Pencil className="h-3 w-3" /> {asset.description ? tr("Edit", "Ubah") : tr("Add", "Tambah")}
            </button>
          )}
        </p>
      )}

      {canEdit && editing !== "family" && (
        <button type="button" onClick={() => setEditing("family")} className="mt-2 text-[12px] text-brand-700 hover:underline">
          {tr("Wrong family? Change it…", "Salah keluarga? Ganti…")}
        </button>
      )}
      {editing === "family" && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 px-3 py-3">
          <label htmlFor="ac-fam" className="block text-xs text-slate-600">{tr("New family", "Keluarga baru")}</label>
          <FamilySelect id="ac-fam" value={family} families={families.filter((f) => f.code !== asset.family_code)}
            onChange={(f) => setFamily(f?.code ?? "")} placeholder={tr("Pick…", "Pilih…")} />
          <label htmlFor="ac-reason" className="block text-xs text-slate-600">{tr("Why — required", "Alasannya — wajib")}</label>
          <input id="ac-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder={tr("e.g. it is a planer, not a sander", "mis. ini mesin serut, bukan amplas")} />
          <p className="text-[11px] text-slate-500">
            {tr("It takes the next number in the new family. The old code stays in its history, so an old label still finds it.",
                "Barang ini mendapat nomor berikutnya di keluarga baru. Kode lama tetap di riwayatnya, jadi label lama masih menemukannya.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing("")}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={recode} disabled={saving || !family || !reason.trim()}>{tr("Change code", "Ganti kode")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
