/** Implements `/api/v1/documents` against the database.
 *
 *  Same names and same signatures as `src/demo/api/documents.ts` — that is the
 *  swap — with the two upload functions still missing, on purpose.
 *
 *  **`upload` and `uploadToInbox` are not here yet.** They are the only two
 *  that need somewhere to put bytes, and the bucket, its policy and the
 *  signed-URL road are B6: decisions about where a photograph of a tanda terima
 *  physically lives and who may open it. Writing them against an unconfigured
 *  bucket would produce rows pointing at objects that are not there — evidence
 *  that reads as filed and cannot be opened, which is worse than evidence
 *  nobody claimed to have. `check-live-routes.mjs` keeps every screen that
 *  calls them dark until they exist.
 *
 *  Everything else is here, because everything else is reading and writing rows.
 */
import type {
  AttachmentView, AttachmentLink, DocKind, LinkEntity,
} from "@/services/documents/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "documents" as const;

/** The row shape of `ops_core.v_attachment`, which is `Attachment` plus the
 *  one derived field. `links` and `covers_count` are assembled below rather
 *  than nested in the view: PostgREST can embed, but only across a declared
 *  foreign key, and `attachment_links` points at the attachment rather than
 *  the other way round. Two reads and a join here is honest; a view that
 *  aggregated links into json would be a second definition of what a live link
 *  is, and `v_attachment_link` is already the first. */
interface AttachmentRow {
  id: string;
  storage_path: string;
  url: string | null;
  filename: string;
  sha256: string;
  mime: string;
  bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  source: "web" | "chat" | "api" | "import";
  duplicate_suspect: boolean;
  covers_count: number;
}

interface LinkRow {
  id: string;
  attachment_id: string;
  entity: LinkEntity;
  entity_no: string;
  kind: DocKind;
  linked_by: string;
  linked_at: string;
}

function toView(a: AttachmentRow, links: AttachmentLink[]): AttachmentView {
  return {
    id: a.id,
    storage_path: a.storage_path,
    url: a.url,
    filename: a.filename,
    sha256: a.sha256,
    mime: a.mime,
    bytes: a.bytes,
    uploaded_by: a.uploaded_by,
    uploaded_at: a.uploaded_at,
    source: a.source,
    duplicate_suspect: a.duplicate_suspect,
    links,
    /* The view's count, not `links.length`. They agree today and would stop
       agreeing the moment a caller passed a filtered subset — and the number
       under a chip saying "covers 4 records" is the one somebody acts on. */
    covers_count: a.covers_count,
  };
}

function toLink(l: LinkRow): AttachmentLink {
  return {
    id: l.id,
    attachment_id: l.attachment_id,
    entity: l.entity,
    entity_no: l.entity_no,
    kind: l.kind,
    linked_by: l.linked_by,
    linked_at: l.linked_at,
  };
}

/** Attachments plus their live links, in two reads.
 *
 *  Never one read per attachment: the PR line drawer opens with a strip of
 *  five documents on it, and five round trips is a visible stutter on a phone
 *  in a workshop.
 */
async function withLinks(rows: AttachmentRow[]): Promise<Result<AttachmentView[]>> {
  if (rows.length === 0) return ok(SERVICE, []);
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("v_attachment_link")
    .select("*")
    .in("attachment_id", rows.map((r) => r.id));
  if (error) return fail(SERVICE, error);

  const byAttachment = new Map<string, AttachmentLink[]>();
  for (const l of (data ?? []) as LinkRow[]) {
    const list = byAttachment.get(l.attachment_id) ?? [];
    list.push(toLink(l));
    byAttachment.set(l.attachment_id, list);
  }
  return ok(SERVICE, rows.map((r) => toView(r, byAttachment.get(r.id) ?? [])));
}

/** What is attached to one record — the strip's whole question.
 *
 *  `entity` is the contract's name (`po`, `overtime`); the view answers in the
 *  same vocabulary, so this passes it through untranslated. The mapping to the
 *  enum lives in the database, in one place, for the reason written at the top
 *  of `0024`.
 */
export async function byEntity(entity: LinkEntity, entityNo: string): Promise<Result<AttachmentView[]>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("v_attachment_link")
    .select("attachment_id")
    .eq("entity", entity)
    .eq("entity_no", entityNo);
  if (error) return fail(SERVICE, error);

  const ids = [...new Set((data ?? []).map((l) => (l as { attachment_id: string }).attachment_id))];
  if (ids.length === 0) return ok(SERVICE, []);

  const { data: atts, error: attErr } = await sb
    .from("v_attachment").select("*").in("id", ids).order("uploaded_at", { ascending: false });
  if (attErr) return fail(SERVICE, attErr);
  return withLinks((atts ?? []) as AttachmentRow[]);
}

/** One document, by id.
 *
 *  Exists because a screen that *names* evidence should be able to *show* it:
 *  a chip reading "photo of the goods" that nobody can open is a label about
 *  evidence rather than a way to the evidence (D268).
 */
export async function getAttachment(id: string): Promise<Result<AttachmentView>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("v_attachment").select("*").eq("id", id).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) {
    return notFound(SERVICE, "attachment_not_found",
      "Dokumen itu tidak ada — mungkin sudah dilepas dari catatan ini.");
  }
  const res = await withLinks([data as AttachmentRow]);
  if (res.error) return res;
  return ok(SERVICE, res.data[0]!);
}

export async function listAttachments(): Promise<Result<AttachmentView[]>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("v_attachment").select("*").order("uploaded_at", { ascending: false }).limit(300);
  if (error) return fail(SERVICE, error);
  return withLinks((data ?? []) as AttachmentRow[]);
}

/** Filing an address as evidence (D125).
 *
 *  A marketplace listing, a quotation in a portal. Photographing the screen
 *  would make it a file and lose the only thing that made it useful — the
 *  address somebody else can open to check the price themselves.
 */
export async function addLink(
  input: { url: string; title?: string | null },
  idempotencyKey?: string,
): Promise<Result<AttachmentView>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("attach_url", {
    p_url: input.url,
    p_title: input.title ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ attachment_id: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getAttachment(res.data.attachment_id);
}

/** Attaching a document to a record.
 *
 *  The refusals — an unknown kind, an entity nothing attaches to, a file that
 *  is not there — are all the seam's. This function cannot be where they live:
 *  a second caller would have to remember them, and the second caller is
 *  always the one that forgets.
 */
export async function link(
  input: { attachment_id: string; entity: LinkEntity; entity_no: string; kind: DocKind },
  idempotencyKey?: string,
): Promise<Result<AttachmentLink>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("attach_link", {
    p_attachment_id: input.attachment_id,
    p_entity: input.entity,
    p_entity_no: input.entity_no,
    p_kind: input.kind,
    p_note: null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ link_id: string }>(SERVICE, data, error);
  if (res.error) return res;

  /* Read the link back rather than building it from what went in. A no-op
     returns the id of the link that already existed — with the `linked_by` and
     `linked_at` of whoever filed it first, which is the answer to "why is this
     file on this row" and is not the caller. */
  const { data: row, error: readErr } = await sb
    .from("v_attachment_link").select("*").eq("id", res.data.link_id).maybeSingle();
  if (readErr) return fail(SERVICE, readErr);
  if (!row) return notFound(SERVICE, "link_not_found", "Link not found.");
  return ok(SERVICE, toLink(row as LinkRow));
}

/** Taking a document back off a record.
 *
 *  An update, never a DELETE (A2, A5) — the seam sees to that. The shape the
 *  demo returns is kept, so the screens that call it do not change.
 */
export async function unlink(linkId: string): Promise<Result<{ removed: string }>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("attach_unlink", {
    p_link_id: linkId,
    p_key: null,
  });
  const res = fromSeam<{ link_id: string }>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { removed: res.data.link_id });
}
