"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, FileText, Upload, Camera, Link2, Plus, CheckCircle2, Circle, X } from "lucide-react";
import { Badge, Button } from "./primitives";
import { cn } from "@/lib/cn";
import { documents } from "@/demo/api";
import {
  DOC_KINDS, DOC_KINDS_FOR, PRIMARY_DOC_KINDS,
  type DocKind, type LinkEntity, type AttachmentView,
} from "@/services/documents/contracts";
import { useToast } from "@/store/toast";

/** Attaching a document, from the record it belongs to.
 *
 *  One component, used on a request line and on a ledger row, because it is
 *  the same road (ADR-010). The parent is known — you navigated from it — so
 *  the form asks only what kind of document this is. Nothing here matches a
 *  file to a record afterwards; that is the exception inbox, and it exists for
 *  the case where the parent genuinely is not known yet.
 *
 *  **One document can cover several records.** A single invoice for three
 *  deliveries, a transfer receipt paying two lines: the file is attached once
 *  and pointed at each of them, and every link records who said so and when.
 *  Uploading the same photo three times would leave three files that nobody
 *  can tell apart later.
 */
export interface CoverTarget {
  entity: LinkEntity;
  entity_no: string;
  label: string;
}

/** A document a record is expected to carry, named so the screen can say
 *  which ones are there and which are still missing. */
export interface EvidenceSlot {
  kind: DocKind;
  label: string;
  optional?: boolean;
}

export function EvidenceStrip({
  entity, entityNo, alsoCovers = [], reachedFrom = [], defaultKind = "Receipt / Invoice / Nota",
  canEdit, onChanged, note, slots = [],
}: {
  entity: LinkEntity;
  entityNo: string;
  /** Other records this document could also cover — sibling lines of the same
   *  request, other rows on the same day. Offered, never guessed. */
  alsoCovers?: CoverTarget[];
  /** Documents that belong to something else and are visible from here because
   *  the money connects them — a receiving photo on the line this row paid
   *  for. Shown, never editable from this end. */
  reachedFrom?: { label: string; attachments: AttachmentView[] }[];
  defaultKind?: DocKind;
  canEdit: boolean;
  onChanged?: () => void;
  note?: string;
  /** The documents this record should carry, each with its own upload and
   *  camera button. Anything else still goes through the type picker below. */
  slots?: EvidenceSlot[];
}) {
  const { toast } = useToast();
  /* With a checklist, each expected kind already has its own button, so the
     free picker below offers only what the checklist does not — otherwise a
     nota could be filed from two places on one screen, and the picker even
     defaulted to the checklist's first row. A shop link has its own button,
     so it is not a picker entry either. */
  const slotKinds = new Set<DocKind>(slots.map((sl) => sl.kind));
  const kindsHere = DOC_KINDS_FOR[entity] ?? DOC_KINDS;
  const otherKinds: readonly DocKind[] = slots.length > 0
    ? kindsHere.filter((k) => !slotKinds.has(k) && k !== "Reference Link")
    : kindsHere;
  const [rows, setRows] = useState<AttachmentView[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [kindSelected, setKind] = useState<DocKind>(
    otherKinds.includes(defaultKind) ? defaultKind : otherKinds[0] ?? defaultKind,
  );
  const [spreading, setSpreading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  /* The kind a slot button asked for, read when the picker comes back — the
     picker answers after a render, and a slot must not depend on the select
     below having caught up. */
  const slotKind = useRef<DocKind | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void documents.byEntity(entity, entityNo).then((r) => {
      if (alive && r.data) setRows(r.data);
    });
    return () => { alive = false; };
  }, [entity, entityNo]);

  async function refresh() {
    const r = await documents.byEntity(entity, entityNo);
    if (r.data) setRows(r.data);
    onChanged?.();
  }

  function pickFor(k: DocKind, camera: boolean) {
    slotKind.current = k;
    (camera ? cameraRef : fileRef).current?.click();
  }

  async function attach(file: File) {
    const kind = slotKind.current ?? kindSelected;
    slotKind.current = null;
    const up = await documents.upload({ file, kind });
    if (up.error) { toast("critical", "Upload failed", up.error.message); return; }
    const link = await documents.link({
      attachment_id: up.data.id, entity, entity_no: entityNo, kind,
    });
    if (link.error) { toast("warning", "Not attached", link.error.message); return; }
    if (up.data.duplicate_suspect) {
      /* Advisory, never a block: the same receipt really can be photographed
         twice, and refusing the second one hides the first (A6). */
      toast("warning", "Attached — identical bytes seen before", "Worth a look in case this is a duplicate.");
    } else {
      toast("success", "Attached", `${file.name} → ${kind}`);
    }
    await refresh();
  }

  /** Filing an address rather than a file. A marketplace listing is the thing
   *  a price came from, and photographing the screen loses the only part that
   *  is checkable by somebody else (D125). */
  async function attachLink() {
    const url = linkUrl.trim();
    if (!url) return;
    setLinking(true);
    const made = await documents.addLink({ url });
    if (made.error) { setLinking(false); toast("warning", "Not filed", made.error.message); return; }
    const link = await documents.link({
      attachment_id: made.data.id, entity, entity_no: entityNo,
      /* A shop page never proves a payment, whatever the kind selector says. */
      kind: "Reference Link",
    });
    setLinking(false);
    if (link.error) { toast("warning", "Not attached", link.error.message); return; }
    toast("success", "Link filed", made.data.filename);
    setLinkUrl("");
    setShowLink(false);
    await refresh();
  }

  async function alsoCover(att: AttachmentView, target: CoverTarget) {
    const res = await documents.link({
      attachment_id: att.id, entity: target.entity, entity_no: target.entity_no,
      kind: (att.links.find((l) => l.entity === entity && l.entity_no === entityNo)?.kind as DocKind | undefined) ?? kindSelected,
    });
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not linked", res.error.message);
      return;
    }
    toast("success", "Also covers", `${att.filename} → ${target.label}`);
    setSpreading(null);
    await refresh();
  }

  /** Taking a document off this record. The file stays and the link is
   *  marked removed, with who and when, in the audit log (A5). */
  async function remove(att: AttachmentView) {
    const here = att.links.find((l) => l.entity === entity && l.entity_no === entityNo);
    if (!here) return;
    const res = await documents.unlink(here.id);
    setRemoving(null);
    if (res.error) { toast("warning", "Not removed", res.error.message); return; }
    toast("success", "Removed", `${att.filename} is no longer on this record.`);
    await refresh();
  }

  /** What is attached here, by kind — the live links on this record only. */
  const hereKinds = new Map<string, number>();
  for (const a of rows) {
    for (const l of a.links) {
      if (l.entity === entity && l.entity_no === entityNo) {
        hereKinds.set(l.kind, (hereKinds.get(l.kind) ?? 0) + 1);
      }
    }
  }

  return (
    <section>
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Paperclip className="h-3.5 w-3.5" /> Documents
      </p>

      {slots.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Expected documents">
          {slots.map((slot) => {
            const n = hereKinds.get(slot.kind) ?? 0;
            return (
              <li key={slot.kind} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                {n > 0
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
                <span className="min-w-0 flex-1">
                  <span className={n > 0 ? "text-slate-800" : "text-slate-600"}>{slot.label}</span>
                  {slot.optional && <span className="ml-1 text-[11px] text-slate-400">(optional)</span>}
                  {n > 1 && <span className="ml-1 text-[11px] text-slate-400">× {n}</span>}
                </span>
                {canEdit && (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost" size="sm" icon={Camera}
                      aria-label={`Photograph ${slot.label}`}
                      onClick={() => pickFor(slot.kind, true)}
                    >
                      <span className="sr-only">Photograph</span>
                    </Button>
                    <Button
                      variant="ghost" size="sm" icon={Upload}
                      aria-label={`Upload ${slot.label}`}
                      onClick={() => pickFor(slot.kind, false)}
                    >
                      {n > 0 ? "Add" : "Upload"}
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 ? (
        <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((a) => {
            const kinds = [...new Set(a.links.map((l) => l.kind))];
            const here = a.links.find((l) => l.entity === entity && l.entity_no === entityNo);
            return (
              <li key={a.id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  {a.url
                    ? <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                    : <FileText className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="min-w-0 flex-1">
                    {/* A link is worth nothing filed if nobody can open it. */}
                    {a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block truncate text-[13px] text-brand-700 underline"
                        title={a.url}
                      >
                        {a.filename}
                      </a>
                    ) : (
                      <span className="block truncate text-[13px] text-slate-700">{a.filename}</span>
                    )}
                    <span className="block text-[11px] text-slate-400">
                      {kinds.join(", ")}
                      {a.url ? "" : ` · ${(a.bytes / 1024).toFixed(0)} KB`}
                      {here && ` · filed by ${here.linked_by.replace("usr_", "")}`}
                    </span>
                  </span>
                  {a.covers_count > 1 && (
                    <Badge tone="slate">covers {a.covers_count}</Badge>
                  )}
                  {canEdit && here && (
                    removing === a.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button variant="danger" size="sm" onClick={() => void remove(a)}>Remove</Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost" size="sm" icon={X}
                        aria-label={`Remove ${a.filename}`}
                        onClick={() => setRemoving(a.id)}
                      >
                        <span className="sr-only">Remove</span>
                      </Button>
                    )
                  )}
                  {canEdit && alsoCovers.length > 0 && (
                    <Button
                      variant="ghost" size="sm" icon={Link2}
                      onClick={() => setSpreading(spreading === a.id ? null : a.id)}
                    >
                      Also covers
                    </Button>
                  )}
                </div>

                {/* One file, several records — offered as a list of the
                    records it plausibly belongs to, never guessed. */}
                {spreading === a.id && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-2 py-2">
                    {alsoCovers.map((t) => {
                      const already = a.links.some(
                        (l) => l.entity === t.entity && l.entity_no === t.entity_no,
                      );
                      return (
                        <li key={`${t.entity}:${t.entity_no}`}>
                          <button
                            disabled={already}
                            onClick={() => alsoCover(a, t)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px]",
                              already ? "text-slate-400" : "text-slate-700 hover:bg-white",
                            )}
                          >
                            <Plus className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{t.label}</span>
                            {already && <span className="text-[11px]">already covered</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 text-[13px] text-slate-500">Nothing attached yet.</p>
      )}

      {/* Documents that live on another record and are visible from here
          because the money joins them: the photo of what arrived, read from
          the ledger row that paid for it. */}
      {reachedFrom.filter((r) => r.attachments.length > 0).map((group) => (
        <div key={group.label} className="mb-3 rounded-lg border border-dashed border-slate-200 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Through {group.label}
          </p>
          <ul className="mt-1 space-y-1">
            {group.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[13px] text-slate-600">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                <span className="text-[11px] text-slate-400">
                  {[...new Set(a.links.map((l) => l.kind))].join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* The pickers live outside the collapsible box: the checklist's own
          buttons open them, and must work while the box is folded away. */}
      {canEdit && (
        <>
          <input
            ref={fileRef} id={`ev-file-${entityNo}`} type="file" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attach(f);
              e.target.value = "";
            }}
          />
          {/* Half of these are photographed rather than filed, so the camera
              is its own button: `capture` opens it directly on a phone
              instead of a file browser nobody wants to navigate. */}
          <input
            ref={cameraRef} id={`ev-cam-${entityNo}`} type="file" accept="image/*" capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attach(f);
              e.target.value = "";
            }}
          />
        </>
      )}

      {canEdit && slots.length > 0 && !showOther && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setShowOther(true)}>
          Dokumen lain atau link
        </Button>
      )}

      {canEdit && (slots.length === 0 || showOther) && (
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3">
          <div className="flex items-center justify-between">
            <label htmlFor={`ev-kind-${entityNo}`} className="block text-xs text-slate-500">
              {slots.length > 0 ? "Dokumen lain — di luar daftar di atas" : "Document type"}
            </label>
            {slots.length > 0 && (
              <button
                type="button"
                onClick={() => { setShowOther(false); setShowLink(false); }}
                aria-label="Tutup"
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            id={`ev-kind-${entityNo}`}
            value={kindSelected}
            onChange={(e) => setKind(e.target.value as DocKind)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {otherKinds.map((k) => (
              <option key={k} value={k}>
                {k}{PRIMARY_DOC_KINDS.includes(k) ? "" : " (supporting)"}
              </option>
            ))}
          </select>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" icon={Camera} onClick={() => cameraRef.current?.click()}>
              Photograph
            </Button>
            <Button variant="outline" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
              Choose a file
            </Button>
            <Button variant="outline" size="sm" icon={Link2} onClick={() => setShowLink((v) => !v)}>
              Paste a link
            </Button>
          </div>

          {showLink && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id={`ev-link-${entityNo}`}
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void attachLink(); }}
                placeholder="https://tokopedia.com/… — the page the price came from"
                className="h-8 min-w-[240px] flex-1 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
              />
              <Button size="sm" disabled={linking || !linkUrl.trim()} onClick={() => void attachLink()}>
                {linking ? "Filing…" : "File it"}
              </Button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            {note ?? "Attached here, to this record — the system already knows what it belongs to, so it only asks what kind of document this is."}
          </p>
        </div>
      )}
    </section>
  );
}
