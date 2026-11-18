"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { pick, useLang } from "@/lib/i18n";
import {
  VERIFICATION_STATUS_LABELS, VERIFY_FIELDS, VERIFY_FIELD_LABELS,
  type AssetVerificationRow, type VerificationChecks, type VerificationStatus,
} from "@/services/inventory/contracts";

/** Pieces the three verify screens share (D437): the status pill, the record
 *  photo, and how a row's zone is read. */

export const STATUS_TONE: Record<VerificationStatus, Tone> = {
  unverified: "slate", match: "green", mismatch: "amber", not_found: "red",
};

/** The statuses in the order the tabs show them. */
export const STATUS_ORDER: VerificationStatus[] = ["unverified", "match", "mismatch", "not_found"];

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
