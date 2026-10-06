import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyGithubSignature } from "@/lib/github/signature";
import { projectsConfigured, syncProjects } from "@/lib/github/projects";

/** `POST /api/github/webhook` — GitHub tells ops about a pull request (D382).
 *
 *  ## Who decides
 *
 *  The database. This route only proves the request came from GitHub — an
 *  HMAC of the raw body with `GITHUB_WEBHOOK_SECRET`, the secret set on the
 *  organisation's webhook — and passes the PR's fields to
 *  `ops_hr.github_pull_request`, which finds the task numbers, checks whether
 *  the author is the task's holder, and starts, hands over, or holds the task
 *  for HRD. That seam is executable by the service role and nobody else, so
 *  the service key is the whole credential here and this is system work, not
 *  a request a person made (ADR-002, the same standing as the outbox worker).
 *
 *  ## What it answers
 *
 *  2xx for anything the seam answered — including *not a task PR* and *already
 *  processed* — so GitHub's delivery log stays green for deliveries that were
 *  fine. 401 for a bad signature, 503 when the secret or the key is not set,
 *  500 when the database could not be reached: those are the ones GitHub
 *  should show red, and the ones worth *Redeliver*.
 *
 *  After a PR moves a task the board sync runs once (best effort, after the
 *  answer), so the item moves without waiting for the cron.
 */

const json = (status: number, body: unknown) => Response.json(body, { status });

interface PullRequestEvent {
  action?: string;
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    body?: string | null;
    draft?: boolean;
    merged?: boolean;
    user?: { login?: string };
    base?: { ref?: string };
  };
  repository?: { full_name?: string; default_branch?: string };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "GITHUB_WEBHOOK_SECRET is not set on this deployment." });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." });
  }

  const raw = await request.arrayBuffer();
  if (!(await verifyGithubSignature(secret, raw, request.headers.get("x-hub-signature-256")))) {
    return json(401, { error: "Signature does not match. Check that the webhook's secret equals GITHUB_WEBHOOK_SECRET." });
  }

  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "";
  if (event === "ping") return json(200, { ok: true, pong: true });
  if (event !== "pull_request") return json(202, { ignored: event || "(no event)" });

  let text = new TextDecoder().decode(raw);
  // A webhook left on `application/x-www-form-urlencoded` sends `payload=<json>`.
  if ((request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    text = new URLSearchParams(text).get("payload") ?? "";
  }
  let body: PullRequestEvent;
  try { body = JSON.parse(text) as PullRequestEvent; }
  catch { return json(400, { error: "The body is not JSON." }); }

  const pr = body.pull_request ?? {};
  const { data, error } = await supabaseAdmin().schema("ops_hr").rpc("github_pull_request", {
    p_delivery: delivery,
    p_action: body.action ?? null,
    p_repo: body.repository?.full_name ?? null,
    p_number: pr.number ?? null,
    p_url: pr.html_url ?? null,
    p_title: pr.title ?? null,
    p_body: pr.body ?? null,
    p_author: pr.user?.login ?? null,
    p_draft: pr.draft ?? false,
    p_merged: pr.merged ?? false,
    p_base: pr.base?.ref ?? null,
    p_default_branch: body.repository?.default_branch ?? null,
  });
  if (error) return json(500, { error: error.message });

  const said = data as { status?: number; data?: { tasks?: { did: string }[] } } | null;
  const moved = said?.data?.tasks?.some((t) => t.did === "started" || t.did === "delivered");
  if (moved && projectsConfigured()) {
    after(async () => { try { await syncProjects(10); } catch { /* the cron retries */ } });
  }
  return json(said?.status && said.status >= 400 ? said.status : 200, said);
}
