import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import {
  uploadToDrive, driveOf, findOrCreateAppFolder, findOrCreatePath, driveConfigured,
  fetchDriveFile,
} from "@/lib/drive";
import { driveFileId } from "@/lib/drive-links";
import { explainDriveFailure } from "@/lib/drive-errors";

/** `POST /api/procurement/receiving/archive` `{rr_no}` — file a matched Chat
 *  message's photos into PROCUREMENT / ops-talaliving / RECEIVING REPORT /
 *  <YYYY-MM> / <YYYY-MM-DD> (0204, D360).
 *
 *  The photos were captured by John Lau into its own Drive folder; ops only
 *  linked them (F208). The owner's rule is one folder, `ops-talaliving`, and
 *  inside it the month tree accounting uses (D359). So, per file the database
 *  says to copy (`receiving_archive_plan`, as this person):
 *
 *    1. read the capture with `drive.readonly` (the app did not make it),
 *    2. write the copy with `drive.file` into the day's folder,
 *    3. record it (`receiving_file_archived`), which moves every record that
 *       showed the capture — the ledger row, the receipt, the asset — to it.
 *
 *  The capture itself is left where it is. A file that fails is named and the
 *  rest carry on; the plan only ever lists what is not filed yet, so running
 *  this again finishes the job. Not `runtime = "edge"` (see the upload route).
 */

const MAX_BYTES = 25 * 1024 * 1024;

interface Envelope {
  error?: { code: string; message: string; status: number; detail?: unknown };
  data?: unknown;
  outcome?: string;
}

function answer(status: number, body: { data?: unknown; error?: unknown }): Response {
  const outcome = body.error ? "refused" : "ok";
  return Response.json({ ...body, meta: { request_id: "", service: "procurement", version: "1", outcome } }, { status });
}

function refuse(status: number, code: string, message: string, detail?: unknown): Response {
  return answer(status, { error: { code, message, outcome: "refused", status, detail } });
}

export async function POST(request: Request): Promise<Response> {
  if (!driveConfigured()) {
    return refuse(501, "drive_not_configured",
      "This deployment cannot file documents yet: the Drive service account is not set.");
  }
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Please sign in first.");

  let rrNo = "";
  try {
    rrNo = String(((await request.json()) as { rr_no?: string }).rr_no ?? "").trim();
  } catch {
    return refuse(400, "bad_request", "Expected {rr_no}.");
  }
  if (!rrNo) return refuse(400, "rr_no_required", "Say which receiving report.", { field: "rr_no" });

  /* What to copy, and where: the database's answer, as this person. */
  const { data: planRaw, error: planErr } = await sb.schema("ops_procure")
    .rpc("receiving_archive_plan", { p_rr_no: rrNo });
  if (planErr) return refuse(500, "database_error", planErr.message);
  const plan = planRaw as Envelope;
  if (plan.outcome !== "ok") return answer(plan.error?.status ?? 422, { error: plan.error });
  const files = (plan.data as {
    files: { attachment_id: string; url: string; filename: string; mime: string | null; kind: string; path: string }[];
  }).files;
  if (files.length === 0) return answer(200, { data: { rr_no: rrNo, archived: [], failed: [] } });

  /* The procurement drive's own folder — the same road as an upload (D320). */
  const { data: whereRaw, error: whereErr } = await sb.schema("ops_core")
    .rpc("drive_folder_for", { p_kind: "goods_photo", p_entity: null });
  if (whereErr) return refuse(500, "database_error", whereErr.message);
  const where = whereRaw as Envelope;
  if (where.outcome !== "ok") return answer(where.error?.status ?? 422, { error: where.error });
  const folder = where.data as {
    folder_id?: string | null; drive_id?: string | null; parent_folder_id?: string | null;
    label: string; slug: string;
  };

  let appFolderId = folder.folder_id ?? null;
  if (!appFolderId) {
    try {
      let driveId = folder.drive_id ?? null;
      if (!driveId) {
        if (!folder.parent_folder_id) {
          return refuse(501, "drive_not_configured",
            `Nothing records which shared drive is ${folder.label}. IT records it in ops_core.drive_folders.`);
        }
        driveId = (await driveOf(folder.parent_folder_id)).driveId;
      }
      appFolderId = (await findOrCreateAppFolder(driveId)).id;
      await sb.schema("ops_core").rpc("record_ops_folder", {
        p_slug: folder.slug, p_folder_id: appFolderId, p_drive_id: driveId,
      });
    } catch (e) {
      const x = explainDriveFailure(e, "app_folder", { label: folder.label, path: "RECEIVING REPORT", folderId: null });
      return refuse(x.status, x.code, x.message);
    }
  }

  const archived: { attachment_id: string; path: string; filename: string }[] = [];
  const failed: { attachment_id: string; filename: string; message: string }[] = [];

  for (const f of files) {
    const sourceId = driveFileId({ url: f.url });
    if (!sourceId) {
      failed.push({ attachment_id: f.attachment_id, filename: f.filename, message: "The Chat file has no Drive id to copy from." });
      continue;
    }
    try {
      const src = await fetchDriveFile(sourceId, MAX_BYTES);
      if (!src || !src.bytes) {
        failed.push({
          attachment_id: f.attachment_id, filename: f.filename,
          message: src ? `Over ${MAX_BYTES / 1048576} MB, left in the Chat folder.` : "The Chat file could not be read from Drive.",
        });
        continue;
      }
      const targetId = await findOrCreatePath(appFolderId, f.path);
      const uploaded = await uploadToDrive(
        { name: `${rrNo} ${f.filename}`, type: f.mime || src.mime, bytes: src.bytes }, targetId,
      );
      if (!uploaded.parents.includes(targetId)) {
        failed.push({ attachment_id: f.attachment_id, filename: f.filename,
          message: `Reached Drive but not ${f.path}; IT can find it by its id, ${uploaded.id}.` });
        continue;
      }
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", src.bytes)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: recRaw, error: recErr } = await sb.schema("ops_procure").rpc("receiving_file_archived", {
        p_rr_no: rrNo, p_attachment_id: f.attachment_id, p_drive_file_id: uploaded.id,
        p_web_view_link: uploaded.webViewLink, p_folder_id: targetId, p_path: f.path,
        p_bytes: src.bytes.byteLength, p_sha256: sha256,
      });
      const rec = recRaw as Envelope;
      if (recErr || (rec.outcome !== "ok" && rec.outcome !== "noop")) {
        failed.push({ attachment_id: f.attachment_id, filename: f.filename,
          message: `Copied to Drive (${uploaded.id}) but not recorded: ${recErr?.message ?? rec.error?.message ?? "unknown"}` });
        continue;
      }
      archived.push({ attachment_id: f.attachment_id, path: f.path, filename: f.filename });
    } catch (e) {
      const x = explainDriveFailure(e, "upload", { label: folder.label, path: f.path, folderId: appFolderId });
      failed.push({ attachment_id: f.attachment_id, filename: f.filename, message: x.message });
    }
  }

  return answer(200, { data: { rr_no: rrNo, archived, failed } });
}
