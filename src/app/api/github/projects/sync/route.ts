import { syncProjects } from "@/lib/github/projects";
import { timingSafeEqual } from "@/lib/github/signature";

/** `POST /api/github/projects/sync` — write the IT tasks that changed onto
 *  the GitHub Projects board (D382).
 *
 *  Called by the Worker's own cron (`cf-worker.mjs`, every ten minutes), not
 *  by a person and not by a browser: it carries `Authorization: Bearer
 *  <GITHUB_WEBHOOK_SECRET>`, a value that exists only in the Worker's secrets
 *  and on GitHub's webhook. Anything else is 401. What it may write is decided
 *  by the database (`github_project_due`), never by the caller.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !timingSafeEqual(secret, given)) {
    return Response.json({ error: "not authorised" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." }, { status: 503 });
  }
  try {
    return Response.json(await syncProjects(20));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
