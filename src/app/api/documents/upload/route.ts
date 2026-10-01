import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import {
  uploadToDrive, driveOf, findOrCreateAppFolder, findOrCreatePath, driveConfigured,
  DriveError, serviceAccountEmail,
} from "@/lib/drive";
import { explainDriveFailure } from "@/lib/drive-errors";

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

/** **Not `runtime = "edge"`.** That line was here and it broke the deploy:
 *
 *      app/api/documents/upload/route cannot use the edge runtime.
 *      OpenNext requires edge runtime function to be defined in a separate
 *      function.
 *
 *  `next build` accepts it happily — the failure is in `opennextjs-cloudflare
 *  build`, which is a different command and the one that actually ships. So the
 *  local build said yes to something the deploy said no to, which is the whole
 *  reason `npm run cf:build` exists and the reason it now runs before a push
 *  rather than after.
 *
 *  The default runtime is the right one regardless: OpenNext bundles it into
 *  the Worker, `nodejs_compat` is already on, and everything this route needs —
 *  `fetch`, `crypto.subtle`, `FormData` — is a web API that workerd provides
 *  natively.
 */

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
  /* The record the file will be filed against, where the screen knows it: it
     picks the task folder under ops-talaliving (a photo of an item is not a photo of a
     finished product). Optional — without it the kind's own folder is used. */
  const entity = String(form.get("entity") ?? "").trim() || null;
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
     *nothing records which shared drive is HRD*. */
  const { data: where, error: whereErr } = await sb
    .schema("ops_core").rpc("drive_folder_for", { p_kind: kind, p_entity: entity });
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
    /** The app's own `ops-talaliving` folder, once made (D320). */
    folder_id?: string | null;
    /** The shared drive, once found. */
    drive_id?: string | null;
    /** A folder a person made in the drive, used only to find the drive. */
    parent_folder_id?: string | null;
    label: string;
    slug: string;
    /** The task folder under `ops-talaliving` (0172), e.g. `INVENTORY/ITEMS`. */
    path: string;
  };

  /* **A refusal from Drive, said so a person can act on it.** Google's JSON
     used to be the toast (F173). Now the toast says what happened and who
     fixes it; Google's own answer goes to the audit log's detail, and the
     failure is written there at all, which it was not before: the log's only
     row for a failed upload was the folder question, reading `ok`. */
  const failed = async (e: unknown, stage: DriveError["stage"]): Promise<Response> => {
    const x = explainDriveFailure(e, stage, {
      label: folder.label, path: folder.path,
      folderId: folder.folder_id ?? folder.parent_folder_id ?? null,
    });
    const detail = {
      slug: folder.slug, label: folder.label, path: folder.path,
      folder_id: folder.folder_id ?? folder.parent_folder_id,
      service_account: serviceAccountEmail(),
      google: e instanceof DriveError
        ? { status: e.status, message: e.googleMessage, reason: e.googleReason }
        : { message: String((e as Error)?.message ?? e) },
    };
    /* Best-effort: a log that cannot be written must not hide the refusal. */
    await sb.schema("ops_core").rpc("record_upload_failure", {
      p_filename: file.name, p_kind: kind, p_stage: x.stage,
      p_code: x.code, p_message: x.message, p_detail: detail,
    });
    return refuse(x.status, x.code, x.message, detail);
  };

  const bytes = await file.arrayBuffer();

  /* Hashed here rather than in the browser: it is what makes *we have seen
     these exact bytes before* answerable, and a value the client computes is a
     value the client can get wrong. */
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");

  /* **Already filed? Then nothing goes to Drive (D359).** A receipt sent to
     the accounting chat is filed by the capture worker the moment it arrives;
     downloading it and attaching it again here made a second copy in a second
     folder (F209). The database says whether these bytes are already where
     this kind goes, and if so that file is the answer. Different bytes of the
     same receipt — a second photograph — still upload and still warn. */
  const { data: same } = await sb
    .schema("ops_core").rpc("same_bytes", { p_sha256: sha256, p_kind: kind });
  const existing = (same as Envelope | null)?.data as
    { found?: boolean; attachment_id?: string; link?: string | null; source?: string } | undefined;
  if (existing?.found && existing.attachment_id) {
    return Response.json({
      data: {
        attachment_id: existing.attachment_id,
        web_view_link: existing.link ?? null,
        filed_in: existing.source === "chat" ? "Google Chat capture" : `${folder.label} / ops-talaliving`,
        sha256,
        reused: true,
      },
      meta: { request_id: "", service: "documents", version: "1", outcome: "ok" },
    });
  }

  /* **The app's own folder, made once per drive (D320).**
   *
   * `drive.file` cannot see a folder a person made, so the owner's hand-made
   * OPS folders answered *File not found* (F173). The app makes its own
   * `ops-talaliving` at the root of the shared drive instead, and files
   * everything under it. The recorded folder only says which drive that is.
   * Both ids are written back, so the next upload asks Google nothing. IT →
   * Google Drive does the same for every drive at once.
   */
  let folderId = folder.folder_id ?? null;
  if (!folderId) {
    let driveId = folder.drive_id ?? null;
    if (!driveId) {
      if (!folder.parent_folder_id) {
        return refuse(501, "drive_not_configured",
          `Nothing records which shared drive is ${folder.label}. IT records it in ops_core.drive_folders.`);
      }
      try {
        driveId = (await driveOf(folder.parent_folder_id)).driveId;
      } catch (e) {
        return failed(e, "drive");
      }
    }
    try {
      folderId = (await findOrCreateAppFolder(driveId)).id;
    } catch (e) {
      return failed(e, "app_folder");
    }
    /* Written back so the next upload does not search again. A failure here is
       not worth refusing an upload over — the folder exists, the file can go in
       it, and the only cost is one more search next time. */
    await sb.schema("ops_core").rpc("record_ops_folder", {
      p_slug: folder.slug, p_folder_id: folderId, p_drive_id: driveId,
    });
  }

  /* Never loose in ops-talaliving: every file goes in its task's folder. */
  let targetId: string;
  try {
    targetId = await findOrCreatePath(folderId, folder.path);
  } catch (e) {
    return failed(e, "folder");
  }

  let uploaded;
  try {
    uploaded = await uploadToDrive(
      { name: file.name, type: file.type, bytes }, targetId,
    );
  } catch (e) {
    /* Nothing has been written to the database, so there is nothing to undo. */
    return failed(e, "upload");
  }

  /* **Did it land where it was sent?** Drive says which folder the file is
     in; if that is not the folder asked for, the file is somewhere nobody
     decided, and recording it would put a wrong answer to *which drive* in
     the database. Refused with the id so IT can find it and move it. */
  if (!uploaded.parents.includes(targetId)) {
    const message = `${uploaded.name} reached Google Drive, but not the ${folder.label} / ops-talaliving / ${folder.path} `
      + `folder it was sent to, so it was not recorded. IT can find it by its Drive id, ${uploaded.id}.`;
    const detail = { drive_file_id: uploaded.id, expected_folder: targetId, parents: uploaded.parents };
    await sb.schema("ops_core").rpc("record_upload_failure", {
      p_filename: file.name, p_kind: kind, p_stage: "upload",
      p_code: "drive_misfiled", p_message: message, p_detail: detail,
    });
    return refuse(502, "drive_misfiled", message, detail);
  }

  /* `storage_path` holds the Drive file id — the file's identity. Beside it
     the link people open, and the kind and record, from which the database
     itself records which shared drive and task folder it is in (0175).
     Recorded as the person. */
  const { data: filed, error: fileErr } = await sb
    .schema("ops_core").rpc("attach_file", {
      p_storage_path: uploaded.id,
      p_filename: file.name,
      p_mime: file.type || null,
      p_bytes: file.size,
      p_sha256: sha256,
      p_source: "web",
      p_key: null,
      p_kind: kind,
      p_entity: entity,
      p_web_view_link: uploaded.webViewLink,
      p_folder_id: targetId,
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
      filed_in: `${folder.label} / ops-talaliving / ${folder.path}`,
      sha256,
    },
    meta: { request_id: "", service: "documents", version: "1", outcome: "ok" },
  });
}
