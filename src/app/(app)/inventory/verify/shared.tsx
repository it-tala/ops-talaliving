"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageOff, TriangleAlert, X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { pick, useLang, useTr, type Message } from "@/lib/i18n";
import { documents } from "@/demo/api";
import { shrinkImage } from "../log/notaFile";
import {
  VERIFICATION_STATUS_LABELS, VERIFY_FIELDS, VERIFY_FIELD_LABELS,
  type AssetVerificationRow, type VerificationChecks, type VerificationStatus,
} from "@/services/inventory/contracts";
import { decodeLegacyArea, decodeLegacyCode, legacyDepartment } from "@/services/inventory/legacy";

/** Pieces the three verify screens share (D447): the status pill, the record
 *  photo, and how a row's zone is read. */

export const STATUS_TONE: Record<VerificationStatus, Tone> = {
  unverified: "slate", match: "green", mismatch: "amber", not_found: "red", new: "brand",
};

/** The statuses in the order the tabs show them. */
export const STATUS_ORDER: VerificationStatus[] = ["unverified", "match", "mismatch", "not_found", "new"];

/** `?zone=` value for assets with no location yet — where the imported
 *  register starts. */
export const NO_ZONE = "_none";

export function zoneOf(row: AssetVerificationRow): string {
  return row.location ?? NO_ZONE;
}

export function StatusBadge({ status, className }: { status: VerificationStatus; className?: string }) {
  const lang = useLang();
  return <Badge tone={STATUS_TONE[status]} dot className={className}>{pick(VERIFICATION_STATUS_LABELS[status], lang)}</Badge>;
}

/** The fields marked different, by their label: *Brand, Model*. */
export function differentFields(checks: VerificationChecks | null, lang: "en" | "id"): string[] {
  if (!checks) return [];
  return VERIFY_FIELDS.filter((f) => checks[f]?.ok === false).map((f) => pick(VERIFY_FIELD_LABELS[f], lang));
}

/** The asset's own photo, through the app (`/api/documents/thumb`, F175), or
 *  an empty face when there is none or Drive cannot answer. */
export function RecordPhoto({ attachmentId, alt, width = 400, className }: {
  attachmentId: string | null; alt: string; width?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("flex items-center justify-center overflow-hidden bg-slate-100", className)}>
      {attachmentId && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/documents/thumb/${encodeURIComponent(attachmentId)}?w=${width}`}
          alt={alt} loading="lazy" onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImageOff className="h-6 w-6 text-slate-300" aria-hidden />
      )}
    </span>
  );
}

/* ── photo slots: the verify screen and the new-item screen ───────────── */

export type SlotPhoto = { file: File; url: string };

const SLOT_LABELS: Message[] = [
  { en: "Whole machine", id: "Seluruh mesin" },
  { en: "Name plate", id: "Plat nama" },
  { en: "Other", id: "Lainnya" },
  { en: "Other", id: "Lainnya" },
];

/** Four photo slots held in state, the first one required. Blob previews are
 *  revoked when a photo is replaced and when the screen goes away. */
export function usePhotoSlots() {
  const [photos, setPhotos] = useState<(SlotPhoto | null)[]>([null, null, null, null]);
  const urls = useRef<string[]>([]);
  urls.current = photos.flatMap((p) => (p ? [p.url] : []));
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  function setPhoto(i: number, file: File | null) {
    setPhotos((cur) => {
      const next = [...cur];
      if (next[i]) URL.revokeObjectURL(next[i]!.url);
      next[i] = file ? { file, url: URL.createObjectURL(file) } : null;
      return next;
    });
  }
  return { photos, setPhoto, hasWhole: !!photos[0], taken: photos.filter((p): p is SlotPhoto => !!p) };
}

/** Uploads the taken photos in order (shrunk first); null when one fails,
 *  after saying so — nothing is saved in that case. */
export async function uploadSlotPhotos(
  taken: SlotPhoto[],
  target: { entity: "asset" | "asset_verification"; entity_no?: string },
  tr: (en: string, id: string) => string,
  onProgress: (msg: string) => void,
  onError: (title: string, msg: string) => void,
): Promise<string[] | null> {
  const ids: string[] = [];
  for (const [i, p] of taken.entries()) {
    onProgress(tr(`Uploading photo ${i + 1} of ${taken.length}…`, `Mengunggah foto ${i + 1} dari ${taken.length}…`));
    const up = await documents.upload({ file: await shrinkImage(p.file), kind: "Foto", entity: target.entity, entity_no: target.entity_no });
    if (up.error) {
      onError(tr(`Photo ${i + 1} was not uploaded`, `Foto ${i + 1} tidak terunggah`),
        tr(`${up.error.message} Nothing was saved — try again.`, `${up.error.message} Belum ada yang tersimpan — coba lagi.`));
      return null;
    }
    ids.push(up.data.id);
  }
  return ids;
}

export function PhotoSlots({ photos, setPhoto, disabled, firstLabel }: {
  photos: (SlotPhoto | null)[]; setPhoto: (i: number, f: File | null) => void; disabled?: boolean; firstLabel?: Message;
}) {
  const tr = useTr();
  const lang = useLang();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <>
      <ul className="grid grid-cols-4 gap-2">
        {SLOT_LABELS.map((slotLabel, i) => {
          const label = i === 0 && firstLabel ? firstLabel : slotLabel;
          const p = photos[i];
          return (
            <li key={i}>
              <input
                ref={(el) => { refs.current[i] = el; }} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { setPhoto(i, e.target.files?.[0] ?? null); e.target.value = ""; }}
              />
              <div className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-slate-50",
                i === 0 && !p ? "border-dashed border-brand-400" : "border-slate-200",
              )}>
                {p ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={pick(label, lang)} className="h-full w-full object-cover" />
                    <button
                      type="button" onClick={() => setPhoto(i, null)} aria-label={tr("Remove photo", "Hapus foto")}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    ><X className="h-3 w-3" /></button>
                  </>
                ) : (
                  <button
                    type="button" onClick={() => refs.current[i]?.click()} disabled={disabled}
                    aria-label={pick(label, lang)}
                    className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500 hover:bg-slate-100"
                  >
                    <Camera className="h-5 w-5" />
                  </button>
                )}
              </div>
              <p className={cn("mt-1 truncate text-center text-[11px]", i === 0 ? "font-medium text-slate-700" : "text-slate-500")}>
                {pick(label, lang)}{i === 0 ? " *" : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {!photos[0] && (
        <p className="mt-2 text-xs text-brand-700">
          {firstLabel
            ? tr(`${firstLabel.en} photo required`, `Foto ${firstLabel.id.toLowerCase()} wajib`)
            : tr("Whole-machine photo required", "Foto seluruh mesin wajib")}
        </p>
      )}
    </>
  );
}

/* ── the 2013 record, decoded (D450) ─────────────────────────────────── */

type LegacyRow = Pick<AssetVerificationRow, "legacy_code" | "legacy_area" | "legacy_department" | "legacy_notes">;

/** One line for a card or a table row: `S2 Saw · 2013 M16 · ASM`, with a
 *  warning mark when the 2013 analysis flagged the row or the code breaks the
 *  pattern. */
export function LegacyLine({ row, className }: { row: LegacyRow; className?: string }) {
  const lang = useLang();
  const tr = useTr();
  const code = decodeLegacyCode(row.legacy_code);
  if (!code) return null;
  const dept = legacyDepartment(row.legacy_department);
  const flagged = !!row.legacy_notes || !!code.broken;
  return (
    <span className={cn("flex items-center gap-1 truncate text-[11px] text-slate-500", className)}
      title={[code.broken && pick(code.broken, lang), row.legacy_notes].filter(Boolean).join(" · ") || undefined}>
      {flagged && <TriangleAlert className="h-3 w-3 shrink-0 text-amber-500" aria-label={tr("Flagged in 2013", "Ditandai 2013")} />}
      <span className="truncate">
        {code.family}{code.familyLabel ? ` ${pick(code.familyLabel, lang)}` : ""}
        {row.legacy_area ? ` · 2013 ${row.legacy_area}` : ""}
        {dept ? ` · ${dept.short}` : row.legacy_department ? ` · ${row.legacy_department}` : ""}
      </span>
    </span>
  );
}

/** The verify screen's panel: each part of the 2013 record and what it means. */
export function LegacyPanel({ row, familySize }: { row: LegacyRow; familySize?: number }) {
  const lang = useLang();
  const tr = useTr();
  const code = decodeLegacyCode(row.legacy_code);
  if (!code) return null;
  const area = decodeLegacyArea(row.legacy_area);
  const dept = legacyDepartment(row.legacy_department);
  const item = (label: string, value: React.ReactNode, meaning: React.ReactNode) => (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="min-w-0 text-[13px] text-slate-700">
        <span className="font-mono font-semibold text-slate-800">{value}</span>
        <span className="ml-2 text-slate-500">{meaning}</span>
      </dd>
    </div>
  );
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
      {item(tr("2013 code", "Kode 2013"), code.code, <>
        {code.familyLabel ? pick(code.familyLabel, lang) : code.family}
        {" · "}{tr(`unit ${code.unit}`, `unit ${code.unit}`)}{familySize ? tr(` · ${familySize} in this family`, ` · ${familySize} dalam famili ini`) : ""}
        {code.broken && <span className="ml-1 text-amber-700">— {pick(code.broken, lang)}</span>}
      </>)}
      {row.legacy_area && item(tr("2013 area", "Area 2013"), row.legacy_area,
        area ? tr(`floor grid column ${area.column}, row ${area.row} (old layout)`, `grid lantai kolom ${area.column}, baris ${area.row} (tata letak lama)`) : "")}
      {row.legacy_department && item(tr("Department", "Departemen"), dept?.short ?? row.legacy_department,
        dept ? pick(dept.label, lang) : "")}
    </dl>
  );
}
