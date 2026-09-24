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

/** Every object this module reads or calls lives in `ops_core`, and PostgREST
 *  has to be told so on **every request**.
 *
 *  `.from("x")` and `.rpc("y")` resolve against the schema the request names —
 *  its `Accept-Profile` / `Content-Profile` header. With none, PostgREST uses
 *  the first of its exposed schemas, which is `public`, and ours holds nothing.
 *  The symptom is exact, and was seen in production: *Could not find the table
 *  'public.v_my_access' in the schema cache*.
 *
 *  **Supabase's "Extra search path" does not fix this, and believing it did cost
 *  a deploy.** That setting adds schemas to the search_path so objects *inside*
 *  an exposed schema can reference them unqualified; PostgREST is explicit that
 *  those schemas get no API endpoints of their own. Exposing a schema says it
 *  may be addressed; naming it on the request is what addresses it.
 *
 *  `.schema()` rather than a second client: a client per schema is an auth
 *  listener and a token-refresh timer per schema, and those racing is how a
 *  session appears to end halfway through a form. This is a query builder bound
 *  to one schema, from the one client.
 *
 *  Called `db` and not `q` because several functions here already open with
 *  `let q = …` to build a filter chain, and a helper of the same name would be
 *  shadowed by it — silently, in exactly the branches that filter.
 */
const db = () => supabaseBrowser().schema("ops_core");

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
  const { data, error } = await db()
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
  const { data, error } = await db()
    .from("v_attachment_link")
    .select("attachment_id")
    .eq("entity", entity)
    .eq("entity_no", entityNo);
  if (error) return fail(SERVICE, error);

  const ids = [...new Set((data ?? []).map((l) => (l as { attachment_id: string }).attachment_id))];
  if (ids.length === 0) return ok(SERVICE, []);

  const { data: atts, error: attErr } = await db()
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
  const { data, error } = await db().from("v_attachment").select("*").eq("id", id).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) {
    return notFound(SERVICE, "attachment_not_found",
      "Dokumen itu tidak ada — mungkin sudah dilepas dari catatan ini.");
  }
  const res = await withLinks([data as AttachmentRow]);
  if (res.error) return res;
  return ok(SERVICE, res.data[0]!);
}

/** Just these attachments — the ones a screen is actually drawing. A queue
 *  of twelve rows needs twelve files, not the latest three hundred of
 *  everything ever uploaded (and an older row's file was never in those). */
export async function getAttachments(ids: string[]): Promise<Result<AttachmentView[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return ok(SERVICE, []);
  const { data, error } = await db().from("v_attachment").select("*").in("id", unique);
  if (error) return fail(SERVICE, error);
  return withLinks((data ?? []) as AttachmentRow[]);
}

export async function listAttachments(): Promise<Result<AttachmentView[]>> {
  const sb = supabaseBrowser();
  const { data, error } = await db()
    .from("v_attachment").select("*").order("uploaded_at", { ascending: false }).limit(300);
  if (error) return fail(SERVICE, error);
  return withLinks((data ?? []) as AttachmentRow[]);
}

/** File a document: the bytes to Drive, the record to the database.
 *
 *  **The one call in this client that is not a PostgREST call.** Everything
 *  else here talks to the database directly, which is the whole design — the
 *  database decides and a server layer between would be a second place for
 *  rules to live (ADR-002). This one goes through `/api/documents/upload`
 *  because the raw file belongs in a Google shared drive (owner, 2026-09-21),
 *  the service account key is what writes it, and a key in a browser is a key
 *  in everybody's browser.
 *
 *  The route decides nothing: it asks `ops_core.drive_folder_for(kind)` which
 *  drive, uploads, and calls `attach_file` **as the signed-in person**, so
 *  every policy applies exactly as it would from here.
 *
 *  `kind` is required because it is what picks the drive. It used to be
 *  declared afterwards, on the link, which meant the file was already
 *  somewhere by the time anybody said what it was — and *somewhere* would have
 *  had to be a default, which is a rule about where personal data goes written
 *  in the least visible place in the system.
 */
export async function upload(
  input: { file: File; kind: DocKind; sha256?: string },
  idempotencyKey?: string,
): Promise<Result<AttachmentView>> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("kind", input.kind);

  let res: Response;
  try {
    res = await fetch("/api/documents/upload", {
      method: "POST",
      body,
      /* The session cookie is what makes the route act as this person. */
      credentials: "same-origin",
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    });
  } catch (e) {
    /* A dropped connection mid-upload, which on a workshop's network is not
       rare. Said as itself rather than as a refusal: nothing decided, nothing
       wrong with the file, try again. */
    return {
      error: {
        code: "upload_interrupted",
        message: `Unggahan terputus sebelum selesai. Coba lagi. (${String((e as Error).message)})`,
        outcome: "refused", status: 500,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }

  const envelope = await res.json() as
    { data?: { attachment_id: string }; error?: Result<never>["error"] };
  if (!res.ok || envelope.error) {
    /* The route's refusal, relayed whole. It is the database's wording in the
       cases that matter — *the HRD shared drive has no `ops` folder recorded
       yet* names the thing to do, and a sentence invented here would not. */
    return {
      error: envelope.error ?? {
        code: "upload_failed", message: `Upload failed (${res.status}).`,
        outcome: "refused", status: res.status as never,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    } as Result<never>;
  }

  /* Read back rather than building the view from what went up: `uploaded_at`,
     `duplicate_suspect` and `covers_count` are the database's answers, and two
     of the three are things only it can know. */
  return getAttachment(envelope.data!.attachment_id);
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
  const { data, error } = await db().rpc("attach_url", {
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
  const { data, error } = await db().rpc("attach_link", {
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
  const { data: row, error: readErr } = await db()
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
  const { data, error } = await db().rpc("attach_unlink", {
    p_link_id: linkId,
    p_key: null,
  });
  const res = fromSeam<{ link_id: string }>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { removed: res.data.link_id });
}
