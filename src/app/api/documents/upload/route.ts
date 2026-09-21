import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { uploadToDrive, findOrCreateOpsFolder, driveConfigured } from "@/lib/drive";

/** `POST /api/documents/upload` — the one server route this application has.
 *
 *  ## Why it exists at all
 *
 *  Everything else here is a client component talking to PostgREST, and that is
 *  deliberate: the database decides, and a server layer in between would be a
 *  second place for rules to live (ADR-002). This is the exception, and the
 *  reason is not architecture, it is a secret. Raw files go to a Google shared
 *  drive (owner, 2026-09-21), the service account key is what writes them, and
 *  a key in a browser is a key in everybody's browser.
 *
 *  So the bytes make one hop through the Worker. Nothing is *decided* here —
 *  which drive a file belongs in comes from `ops_core.drive_folder_for`, and
 *  whether it may be filed at all comes from the policies on
 *  `ops_core.attachments`. This route carries.
 *
 *  ## Two identities, on purpose
 *
 *  **Drive is written as the service account**, because a shared drive is
 *  written by somebody who is a member of it and the people using this
 *  application are not necessarily Google users at all.
 *
 *  **The database is written as the person**, from their session cookie, so
 *  every row lands with `auth.uid()` as the uploader and every policy applies
 *  exactly as it would from the browser. Using the service role key here would
 *  make this route the thing that decides who may file a document, and the
 *  answer would be *anybody who can reach this URL*.
 *
 *  ## The order, which is the whole design
 *
 *  Ask the database where it goes → upload → record it. Not the other way
 *  round: a row written before the upload is a row pointing at a file that may
 *  never arrive, and *this document exists* is exactly the claim an attachment
 *  row makes. A file in Drive with no row is the harmless failure — it is
 *  visible, it is in the right folder, and somebody can attach it by hand.
 */

export const runtime = "edge";

interface Envelope {
  error?: { code: string; message: string; status: number; detail?: unknown };
  data?: unknown;
  outcome?: string;
}

function refuse(status: number, code: string, message: string, detail?: unknown): Response {
  return Response.json(
    { error: { code, message, outcome: "refused", status, detail },
      meta: { request_id: "", service: "documents", version: "1", outcome: "refused" } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  /* Asked before the body is read. An unconfigured deployment should say so in
     a sentence, not after somebody has watched a 12 MB progress bar finish. */
  if (!driveConfigured()) {
    return refuse(
      501, "drive_not_configured",
      "This deployment cannot file documents yet: the Drive service account is not set. "
      + "IT sets GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY on the Worker.",
    );
  }

  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) {
    return refuse(401, "not_signed_in", "Please sign in first.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, "bad_request", "Expected a file upload.");
  }

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "").trim();
  if (!(file instanceof File)) {
    return refuse(400, "file_required", "No file was sent.", { field: "file" });
  }
  if (!kind) {
    /* The kind is what decides the drive, so it is not optional and cannot be
       defaulted. A default here would be a rule about where personal data goes,
       written in the least visible place in the system. */
    return refuse(400, "kind_required",
      "Say what kind of document this is — it decides which shared drive it is filed in.",
      { field: "kind" });
  }

  /* **The database decides the folder**, and it decides as this person: a kind
     they may not file is refused by the same policies the rest of the app
     obeys. The refusal is relayed whole, because it names the thing to do —
     *the HRD shared drive has no `ops` folder recorded yet*. */
  const { data: where, error: whereErr } = await sb
    .schema("ops_core").rpc("drive_folder_for", { p_kind: kind });
  if (whereErr) {
    return refuse(500, "database_error", whereErr.message);
  }
  const resolved = where as Envelope;
  if (resolved.outcome !== "ok") {
    const e = resolved.error;
    return Response.json(
      { error: e, meta: { request_id: "", service: "documents", version: "1", outcome: "refused" } },
      { status: e?.status ?? 422 },
    );
  }
  const folder = resolved.data as {
    folder_id: string | null;
    parent_folder_id: string | null;
    label: string;
    slug: string;
  };

  /* **The `ops` folder, located once per drive.**
   *
   * The owner gave the module folders — what a person can read off a Drive URL
   * — and `ops` is the subfolder everything this application writes goes into,
   * so that people and the system can read the same drive side by side without
   * mixing what each of them filed.
   *
   * Resolved by name and then written down, rather than asked for as eight
   * more ids: a name is checkable, an id pasted into a column that redirects
   * every future upload is not.
   */
  let folderId = folder.folder_id;
  if (!folderId) {
    if (!folder.parent_folder_id) {
      return refuse(501, "drive_not_configured",
        `The ${folder.label} shared drive has no folder recorded yet.`);
    }
    try {
      folderId = await findOrCreateOpsFolder(folder.parent_folder_id);
    } catch (e) {
      return refuse(502, "drive_folder_failed",
        `Could not find or create the \`ops\` folder in ${folder.label}. `
        + String((e as Error).message),
        { slug: folder.slug });
    }
    /* Written back so the next upload does not search again. A failure here is
       not worth refusing an upload over — the folder exists, the file can go in
       it, and the only cost is one more search next time. */
    await sb.schema("ops_core").rpc("record_ops_folder", {
      p_slug: folder.slug, p_folder_id: folderId,
    });
  }

  const bytes = await file.arrayBuffer();

  /* Hashed here rather than in the browser: it is what makes *we have seen
     these exact bytes before* answerable, and a value the client computes is a
     value the client can get wrong. It is a warning and never a block — the
     same receipt really can be photographed twice, and refusing the second one
     hides it. */
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");

  let uploaded;
  try {
    uploaded = await uploadToDrive(
      { name: file.name, type: file.type, bytes }, folderId,
    );
  } catch (e) {
    /* Nothing has been written to the database, so there is nothing to undo.
       Google's own words are relayed because they distinguish a wrong key from
       a folder the service account was never added to, and those have different
       fixes. */
    return refuse(502, "drive_upload_failed",
      `The file did not reach the ${folder.label} shared drive. ${String((e as Error).message)}`,
      { slug: folder.slug });
  }

  /* `storage_path` holds the Drive file id — that is the file's identity, and
     the link is derivable from it (05-storage.md). Recorded as the person. */
  const { data: filed, error: fileErr } = await sb
    .schema("ops_core").rpc("attach_file", {
      p_storage_path: uploaded.id,
      p_filename: file.name,
      p_mime: file.type || null,
      p_bytes: file.size,
      p_sha256: sha256,
      p_source: "web",
      p_key: null,
    });
  if (fileErr) {
    return refuse(500, "database_error",
      `${uploaded.name} is in the ${folder.label} shared drive, but could not be recorded: `
      + fileErr.message,
      { drive_file_id: uploaded.id });
  }

  const envelope = filed as Envelope;
  if (envelope.outcome !== "ok") {
    const e = envelope.error;
    return Response.json(
      { error: e, meta: { request_id: "", service: "documents", version: "1", outcome: "refused" } },
      { status: e?.status ?? 422 },
    );
  }

  const attachmentId = (envelope.data as { attachment_id: string }).attachment_id;
  return Response.json({
    data: {
      attachment_id: attachmentId,
      drive_file_id: uploaded.id,
      web_view_link: uploaded.webViewLink,
      filed_in: folder.label,
      sha256,
    },
    meta: { request_id: "", service: "documents", version: "1", outcome: "ok" },
  });
}
