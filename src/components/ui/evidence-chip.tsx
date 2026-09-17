"use client";

import { useState } from "react";
import { FileText, ImageOff } from "lucide-react";
import { Modal } from "./drawer";
import { DocumentPreview, type PreviewDoc } from "./doc-preview";
import { Loaded, useLoad } from "./loaded";
import { cn } from "@/lib/cn";
import { documents } from "@/demo/api";

/** A named piece of evidence that opens (D268).
 *
 *  It replaces three chips that read *photo of the goods*, *tanda terima* and
 *  *on file* and could not be clicked — labels **about** evidence rather than
 *  ways **to** it (B2). That is the same failure B3 found on the verification
 *  queue, and the same answer: the thing a person has to look at is one tap
 *  away from the row that mentions it.
 *
 *  Presence is derived from `attachmentId` here, at the point of render, so a
 *  chip claiming there is a file and a link that opens nothing cannot get out
 *  of step — the two facts are one fact.
 */
export function EvidenceChip({
  attachmentId,
  present,
  missing,
  title,
}: {
  attachmentId: string | null;
  /** What to say when the document is there. */
  present: string;
  /** What to say when it is not — never the same sentence with a cross. */
  missing: string;
  /** Heading for the panel that opens. */
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!attachmentId) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
        <ImageOff className="h-3 w-3" /> {missing}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800",
          "underline-offset-2 transition-colors hover:bg-violet-100 hover:underline",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
        )}
      >
        <FileText className="h-3 w-3" /> {present}
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={title ?? present} width="max-w-xl">
          <EvidenceBody id={attachmentId} />
        </Modal>
      )}
    </>
  );
}

function EvidenceBody({ id }: { id: string }) {
  const [doc, reload] = useLoad(() => documents.getAttachment(id), [id]);
  return (
    <Loaded state={doc} onRetry={reload}>
      {(a) => (
        <DocumentPreview
          doc={{
            id: a.id,
            filename: a.filename,
            mime: a.mime,
            bytes: a.bytes,
            url: a.url,
            uploaded_at: a.uploaded_at,
            kind: a.links[0]?.kind ?? null,
          } as PreviewDoc}
        />
      )}
    </Loaded>
  );
}
