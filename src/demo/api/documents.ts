/** Implements `/api/v1/documents` from `03-api.md`.
 *
 *  The main road (ADR-010): a document is attached FROM the record it belongs
 *  to, so the link is declared rather than inferred, and every link carries
 *  who declared it.
 */
import { ok, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type {
  Attachment, AttachmentLink, AttachmentView, DocKind, LinkEntity,
} from "@/services/documents/contracts";
import { getState, apply, newId, writeAudit, writeOutbox } from "../store";
import { latency, actingUser, conflict, replayed, remember } from "./_kit";
import { settingNumber } from "../settings";

const SERVICE = "documents" as const;

/** Below the framework's own body limit on purpose, so an oversized file gets
 *  an error that names the limit instead of a connection that dies. */
/** Default 15 MB, and a setting (D216) — how big a scan this office needs to
 *  file is not a thing code should decide. */
export const MAX_BYTES = 15 * 1024 * 1024;

function maxBytes(): number {
  return settingNumber(getState(), "ops.max_upload_mb", 15) * 1024 * 1024;
}

function view(att: Attachment): AttachmentView {
  const links = getState().attachment_links.filter((l) => l.attachment_id === att.id);
  return { ...att, links, covers_count: links.length };
}

export async function upload(
  input: { filename: string; mime: string; bytes: number; sha256?: string },
  idempotencyKey?: string,
): Promise<Result<AttachmentView>> {
  await latency();
  const cached = replayed<AttachmentView>(SERVICE, "upload", idempotencyKey);
  if (cached) return cached;

  if (input.bytes > maxBytes()) {
    return invalid(
      SERVICE, "file_too_large",
      `File is ${(input.bytes / 1024 / 1024).toFixed(1)} MB, over the ${(maxBytes() / 1024 / 1024).toFixed(0)} MB limit.`,
      { field: "bytes", limit: maxBytes() },
    );
  }

  const sha = input.sha256 ?? newId("sha").slice(4, 16);
  /* Identical bytes seen before is a warning, never a block: the same receipt
   * really can be photographed twice, and refusing it hides the second one. */
  const duplicate = getState().attachments.some((a) => a.sha256 === sha);

  const user = actingUser();
  const att: Attachment = {
    id: newId("att"),
    storage_path: `demo/${new Date().toISOString().slice(0, 7)}/${input.filename}`,
    url: null,
    filename: input.filename, sha256: sha, mime: input.mime, bytes: input.bytes,
    uploaded_by: user.id, uploaded_at: new Date().toISOString(),
    source: "web", duplicate_suspect: duplicate,
  };
  apply((draft) => {
    draft.attachments.push(att);
    writeAudit(draft, { service: SERVICE, entity: "attachment", entity_no: att.filename, action: "upload", outcome: "ok", reason: duplicate ? "identical bytes seen before" : null });
  });
  const result = view(att);
  remember(SERVICE, "upload", idempotencyKey, result);
  return ok(SERVICE, result);
}

/** A document arriving with no record to attach it to — the exception road.
 *
 *  Somebody photographs a transfer receipt in chat before anything about it
 *  exists in the system. There is nothing to link it to yet, so it goes to the
 *  inbox and waits for a person to say what it is (ADR-010, D81). Uploading
 *  here books nothing and settles nothing; it puts the file where somebody
 *  will see it.
 */
export async function uploadToInbox(
  input: {
    filename: string;
    mime: string;
    bytes: number;
    origin: "chat" | "web";
    money_direction?: "IN" | "OUT" | null;
    amount_idr?: number | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<AttachmentView>> {
  const uploaded = await upload(
    { filename: input.filename, mime: input.mime, bytes: input.bytes },
    idempotencyKey,
  );
  if (uploaded.error) return uploaded;

  const user = actingUser();
  const now = new Date();
  apply((draft) => {
    const att = draft.attachments.find((a) => a.id === uploaded.data.id);
    if (att) att.source = input.origin;
    draft.evidence_inbox.unshift({
      id: newId("inb"),
      ref_id: `upl_${now.toISOString().slice(2, 10)}_${draft.evidence_inbox.length + 1}~x0`,
      origin: input.origin, status: "PENDING",
      attachment_id: uploaded.data.id,
      reported_by: user.id, reported_at: now.toISOString(),
      /* Whatever the sender typed is an extraction like any other: a reading,
         never a posting. Somebody still has to agree with the number (A13). */
      extracted: {
        vendor_name: null,
        document_date: now.toISOString().slice(0, 10),
        amount_idr: input.amount_idr ?? null,
        doc_type: "Payment Proof",
        confidence: null,
        note: input.note ?? null,
      },
      produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
      money_direction: input.money_direction ?? null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "attachment", entity_no: input.filename,
      action: "upload_to_inbox", outcome: "ok", reason: input.origin,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "documents.inbox.received",
      payload: { filename: input.filename, origin: input.origin, direction: input.money_direction ?? null },
    });
  });

  return ok(SERVICE, uploaded.data);
}

/** Attach from the record. The parent is already known, so this asks only for
 *  the document kind — vendor, amount and line come from where you were
 *  standing when you tapped. */
export async function link(
  input: { attachment_id: string; entity: LinkEntity; entity_no: string; kind: DocKind },
  idempotencyKey?: string,
): Promise<Result<AttachmentLink>> {
  await latency();
  const endpoint = `link:${input.attachment_id}:${input.entity_no}`;
  const cached = replayed<AttachmentLink>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  if (!state.attachments.some((a) => a.id === input.attachment_id)) {
    return notFound(SERVICE, "attachment_not_found", "File not found.");
  }
  const already = state.attachment_links.find(
    (l) => l.attachment_id === input.attachment_id && l.entity === input.entity
      && l.entity_no === input.entity_no && l.kind === input.kind,
  );
  if (already) {
    return conflict(SERVICE, "already_linked", "This document is already linked there — nothing changed.");
  }

  const user = actingUser();
  const row: AttachmentLink = {
    id: newId("lnk"), attachment_id: input.attachment_id,
    entity: input.entity, entity_no: input.entity_no, kind: input.kind,
    linked_by: user.id, linked_at: new Date().toISOString(),
  };
  apply((draft) => {
    draft.attachment_links.push(row);
    writeAudit(draft, { service: SERVICE, entity: input.entity, entity_no: input.entity_no, action: "link", outcome: "ok", reason: null });
    writeOutbox(draft, { service: SERVICE, event_type: "documents.link.created", payload: { ...input } });
  });
  remember(SERVICE, endpoint, idempotencyKey, row);
  return ok(SERVICE, row);
}

/** Removing a link is not deleting a file. The file stays, both actions are in
 *  the audit log, and a wrong link is corrected by removing and adding rather
 *  than by moving. */
export async function unlink(linkId: string): Promise<Result<{ removed: string }>> {
  await latency();
  const existing = getState().attachment_links.find((l) => l.id === linkId);
  if (!existing) return notFound(SERVICE, "link_not_found", "Link not found.");
  apply((draft) => {
    draft.attachment_links = draft.attachment_links.filter((l) => l.id !== linkId);
    writeAudit(draft, { service: SERVICE, entity: existing.entity, entity_no: existing.entity_no, action: "unlink", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { removed: linkId });
}

export async function byEntity(entity: LinkEntity, entityNo: string): Promise<Result<AttachmentView[]>> {
  await latency();
  const state = getState();
  const ids = state.attachment_links
    .filter((l) => l.entity === entity && l.entity_no === entityNo)
    .map((l) => l.attachment_id);
  return ok(SERVICE, state.attachments.filter((a) => ids.includes(a.id)).map(view));
}

/** One document, by id. Exists because a screen that *names* evidence should
 *  be able to *show* it: a chip reading "photo of the goods" that nobody can
 *  open is a label about evidence rather than a way to the evidence (B2, B3,
 *  D268). */
export async function getAttachment(id: string): Promise<Result<AttachmentView>> {
  await latency();
  const found = getState().attachments.find((a) => a.id === id);
  if (!found) {
    return notFound(SERVICE, "attachment_not_found", "Dokumen itu tidak ada — mungkin sudah dilepas dari catatan ini.");
  }
  return ok(SERVICE, view(found));
}

export async function listAttachments(): Promise<Result<AttachmentView[]>> {
  await latency();
  return ok(SERVICE, getState().attachments.map(view));
}

/** Filing a link as evidence.
 *
 *  A marketplace listing, a quotation somebody sent a URL to, an invoice that
 *  lives in a portal. Photographing the screen would make it a file and lose
 *  the only thing that made it useful — the address somebody else can open to
 *  check the price themselves (D125).
 *
 *  It is an attachment like any other: same table, same link road, same strip.
 *  What it is not is a *primary* document: a shop page does not say money
 *  moved, so it can support a request and never stands as proof of payment.
 */
export async function addLink(
  input: { url: string; title?: string | null },
  idempotencyKey?: string,
): Promise<Result<AttachmentView>> {
  await latency();
  const cached = replayed<AttachmentView>(SERVICE, "addLink", idempotencyKey);
  if (cached) return cached;

  const raw = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid(
      SERVICE, "url_invalid",
      "That is not an address. Paste the whole link, starting with https://.",
      { field: "url" },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalid(SERVICE, "url_scheme", "Only http and https links can be filed.", { field: "url" });
  }

  const state = getState();
  const already = state.attachments.find((a) => a.url === raw);
  const user = actingUser();
  const att: Attachment = {
    id: newId("att"),
    storage_path: "",
    url: raw,
    filename: input.title?.trim() || parsed.hostname.replace(/^www\./, "") + parsed.pathname.slice(0, 40),
    sha256: "",
    mime: "text/uri-list",
    bytes: 0,
    uploaded_by: user.id,
    uploaded_at: new Date().toISOString(),
    source: "web",
    /* The same shop page filed twice is worth saying and never worth
       refusing — two lines can legitimately point at one listing. */
    duplicate_suspect: already !== undefined,
  };
  apply((draft) => {
    draft.attachments.push(att);
    writeAudit(draft, {
      service: SERVICE, entity: "attachment", entity_no: att.filename,
      action: "link", outcome: "ok",
      reason: already ? "the same address is already on file" : null,
      detail: { url: raw },
    });
  });
  const result = view(att);
  remember(SERVICE, "addLink", idempotencyKey, result);
  return ok(SERVICE, result);
}
