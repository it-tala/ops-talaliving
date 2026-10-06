import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** IT's tasks on the organisation's GitHub Projects board (D382).
 *
 *  ## Direction and shape
 *
 *  ops → GitHub only. The board is a window onto the task list, not a second
 *  place to run it: every item is a **draft issue** written by this file, and
 *  a change made to it on GitHub is overwritten the next time the task
 *  changes. Moving a task is done in ops (or by a PR, which comes back
 *  through the webhook), so there is one source of truth and the board
 *  cannot disagree with HRD's numbers.
 *
 *  ## State, not events
 *
 *  `ops_hr.github_project_due` returns the IT tasks whose content differs
 *  from what was last written (a fingerprint), and `github_project_synced`
 *  records what was written. A missed run, a token that expired for a day,
 *  an item somebody deleted on GitHub — each heals on the next run with
 *  nothing to replay. A task that fails five times on the same content waits
 *  until it changes, and IT sees the error on `/it/github`.
 *
 *  ## Configuration (all runtime Secrets on the Worker, never in the repo)
 *
 *    GITHUB_PROJECTS_TOKEN   a token that may write the board (see
 *                            docs/plan/phase-2/github.md)
 *    GITHUB_PROJECT_OWNER    the organisation, `it-tala`
 *    GITHUB_PROJECT_NUMBER   the number in the board's URL
 *                            (github.com/orgs/it-tala/projects/<number>)
 *    OPS_BASE_URL            optional, the link printed on each item
 *
 *  Without the first three the sync does nothing and says so.
 */

const API = "https://api.github.com/graphql";

export interface SyncReport {
  configured: boolean;
  project?: string;
  due: number;
  written: number;
  failed: { task_no: string; error: string }[];
  note?: string;
}

interface DueTask {
  task_no: string;
  title: string;
  detail: string | null;
  deliverable: string | null;
  due_date: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  started: boolean;
  blocked_reason: string | null;
  assignee_name: string;
  github_login: string | null;
  goal_title: string | null;
  goal_rank: number | null;
  item_id: string | null;
  draft_id: string | null;
  archived: boolean;
  fingerprint: string;
}

interface Field {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
}

interface Board {
  id: string;
  title: string;
  url: string;
  status?: Field;
  due?: Field;
}

class GithubError extends Error {
  constructor(message: string, readonly type: string | null) { super(message); }
}

export function projectsConfigured(): boolean {
  return Boolean(process.env.GITHUB_PROJECTS_TOKEN && process.env.GITHUB_PROJECT_OWNER
    && Number(process.env.GITHUB_PROJECT_NUMBER) > 0);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GITHUB_PROJECTS_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "ops-talaliving",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null) as { data?: T; errors?: { type?: string; message: string }[] } | null;
  if (!res.ok || !json || (json.errors && json.errors.length)) {
    const e = json?.errors?.[0];
    throw new GithubError(
      e?.message ?? `GitHub menjawab ${res.status}${res.status === 401 ? " — token salah atau kedaluwarsa" : ""}`,
      e?.type ?? (res.status === 401 ? "UNAUTHORIZED" : null),
    );
  }
  return json.data as T;
}

const FIELDS = `fields(first: 50) { nodes {
  ... on ProjectV2Field { id name dataType }
  ... on ProjectV2SingleSelectField { id name dataType options { id name } }
  ... on ProjectV2IterationField { id name dataType } } }`;

async function findBoard(): Promise<Board> {
  const owner = process.env.GITHUB_PROJECT_OWNER!;
  const number = Number(process.env.GITHUB_PROJECT_NUMBER);
  type P = { projectV2: { id: string; title: string; url: string; fields: { nodes: Field[] } } | null } | null;
  const q = (who: "organization" | "user") =>
    `query($o: String!, $n: Int!) { ${who}(login: $o) { projectV2(number: $n) { id title url ${FIELDS} } } }`;
  let project: NonNullable<P>["projectV2"] = null;
  try {
    project = (await gql<{ organization: P }>(q("organization"), { o: owner, n: number })).organization?.projectV2 ?? null;
  } catch (e) {
    if (!(e instanceof GithubError) || e.type !== "NOT_FOUND") throw e;
  }
  if (!project) {
    project = (await gql<{ user: P }>(q("user"), { o: owner, n: number }).catch(() => ({ user: null }))).user?.projectV2 ?? null;
  }
  if (!project) {
    throw new GithubError(`Papan ${owner} #${number} tidak ditemukan, atau token tidak punya akses Projects ke sana.`, "NOT_FOUND");
  }
  const fields = project.fields.nodes.filter((f) => f && f.id);
  const named = (names: string[], type: string) =>
    fields.find((f) => f.dataType === type && names.includes(f.name.trim().toLowerCase()));
  return {
    id: project.id, title: project.title, url: project.url,
    status: named(["status"], "SINGLE_SELECT"),
    due: named(["jatuh tempo", "due", "due date", "target date", "deadline"], "DATE"),
  };
}

/** The Status column the task belongs in, by the option names GitHub's
 *  default board has, or their Indonesian names if IT renamed them. */
function statusOption(board: Board, t: DueTask): string | null {
  const want: string[][] =
    t.status === "DONE" ? [["done", "selesai"]]
    : t.blocked_reason ? [["blocked", "tertahan"], ["in progress", "sedang dikerjakan", "dikerjakan"]]
    : t.started ? [["in progress", "sedang dikerjakan", "dikerjakan"]]
    : [["todo", "to do", "belum mulai"]];
  const options = board.status?.options ?? [];
  for (const names of want) {
    const hit = options.find((o) => names.includes(o.name.trim().toLowerCase()));
    if (hit) return hit.id;
  }
  return null;
}

function baseUrl(): string {
  return (process.env.OPS_BASE_URL || "https://ops.talaliving.com").replace(/\/+$/, "");
}

function itemTitle(t: DueTask): string {
  return `${t.title} · ${t.task_no}`;
}

function itemBody(t: DueTask): string {
  const lines = [
    `**Tugas ops:** \`${t.task_no}\` · [buka di ops](${baseUrl()}/hrd/tugas?tab=all)`,
    `**Pemegang:** ${t.assignee_name}${t.github_login ? ` (@${t.github_login})` : ""} · **Jatuh tempo:** ${t.due_date}`,
  ];
  if (t.deliverable) lines.push(`**Yang diserahkan:** ${t.deliverable}`);
  if (t.goal_title) lines.push(`**Sasaran:** ${t.goal_rank ? `#${t.goal_rank} ` : ""}${t.goal_title}`);
  if (t.blocked_reason) lines.push(`**Tertahan:** ${t.blocked_reason}`);
  if (t.detail) lines.push("", t.detail);
  lines.push("", "---",
    `Selesai otomatis: sebut \`${t.task_no}\` di judul atau badan PR. PR dari pemegang tugas yang di-merge ke branch default menyerahkan tugas ini.`,
    "_Item ini ditulis oleh ops.talaliving — perubahan di sini ditimpa saat tugasnya berubah di ops._");
  return lines.join("\n");
}

async function userIds(logins: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const login of logins) {
    try {
      const r = await gql<{ user: { id: string } | null }>(`query($l: String!) { user(login: $l) { id } }`, { l: login });
      if (r.user) out.set(login, r.user.id);
    } catch { /* an unknown login is written without an assignee */ }
  }
  return out;
}

async function writeOne(board: Board, t: DueTask, people: Map<string, string>): Promise<{ item: string | null; draft: string | null; archived: boolean }> {
  const cancelled = t.status === "CANCELLED";
  const assignees = t.github_login && people.get(t.github_login) ? [people.get(t.github_login)!] : [];
  let item = t.item_id;
  let draft = t.draft_id;

  // A cancelled task that never had an item needs none.
  if (cancelled && !item) return { item: null, draft: null, archived: false };

  if (item && draft) {
    try {
      await gql(`mutation($d: ID!, $t: String!, $b: String!, $a: [ID!]) {
        updateProjectV2DraftIssue(input: { draftIssueId: $d, title: $t, body: $b, assigneeIds: $a }) { draftIssue { id } } }`,
      { d: draft, t: itemTitle(t), b: itemBody(t), a: assignees });
    } catch (e) {
      // Deleted on GitHub: make it again rather than fail forever.
      if (e instanceof GithubError && e.type === "NOT_FOUND") { item = null; draft = null; }
      else throw e;
    }
  }
  let archived = t.archived;
  if (!item) {
    const r = await gql<{ addProjectV2DraftIssue: { projectItem: { id: string; content: { id: string } | null } } }>(
      `mutation($p: ID!, $t: String!, $b: String!, $a: [ID!]) {
        addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b, assigneeIds: $a }) {
          projectItem { id content { ... on DraftIssue { id } } } } }`,
      { p: board.id, t: itemTitle(t), b: itemBody(t), a: assignees });
    item = r.addProjectV2DraftIssue.projectItem.id;
    draft = r.addProjectV2DraftIssue.projectItem.content?.id ?? null;
    archived = false;
  }

  const option = statusOption(board, t);
  if (board.status && option) {
    await gql(`mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } } }`,
    { p: board.id, i: item, f: board.status.id, o: option });
  }
  if (board.due) {
    await gql(`mutation($p: ID!, $i: ID!, $f: ID!, $d: Date!) {
      updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { date: $d } }) { projectV2Item { id } } }`,
    { p: board.id, i: item, f: board.due.id, d: t.due_date });
  }

  if (cancelled && !archived) {
    await gql(`mutation($p: ID!, $i: ID!) { archiveProjectV2Item(input: { projectId: $p, itemId: $i }) { item { id } } }`,
      { p: board.id, i: item });
    archived = true;
  } else if (!cancelled && archived) {
    await gql(`mutation($p: ID!, $i: ID!) { unarchiveProjectV2Item(input: { projectId: $p, itemId: $i }) { item { id } } }`,
      { p: board.id, i: item });
    archived = false;
  }
  return { item, draft, archived };
}

/** One pass: read what is due, write it, record what happened. */
export async function syncProjects(limit = 20): Promise<SyncReport> {
  if (!projectsConfigured()) {
    return { configured: false, due: 0, written: 0, failed: [],
      note: "GITHUB_PROJECTS_TOKEN, GITHUB_PROJECT_OWNER dan GITHUB_PROJECT_NUMBER belum diisi — papan tidak disinkronkan." };
  }
  const db = supabaseAdmin().schema("ops_hr");
  const { data, error } = await db.rpc("github_project_due", { p_limit: limit });
  if (error) throw new Error(`github_project_due: ${error.message}`);
  const due = (data ?? []) as DueTask[];
  const report: SyncReport = { configured: true, due: due.length, written: 0, failed: [] };
  if (!due.length) return report;

  let board: Board;
  try {
    board = await findBoard();
  } catch (e) {
    // The board itself is unreachable: every task fails with the same reason,
    // which is what IT needs to read on /it/github.
    const message = e instanceof Error ? e.message : String(e);
    for (const t of due) {
      await db.rpc("github_project_synced", {
        p_task_no: t.task_no, p_item_id: t.item_id, p_draft_id: t.draft_id,
        p_archived: t.archived, p_fingerprint: t.fingerprint, p_error: message,
      });
      report.failed.push({ task_no: t.task_no, error: message });
    }
    return report;
  }
  report.project = board.url;

  const people = await userIds([...new Set(due.map((t) => t.github_login).filter((l): l is string => !!l))]);
  for (const t of due) {
    try {
      const w = await writeOne(board, t, people);
      await db.rpc("github_project_synced", {
        p_task_no: t.task_no, p_item_id: w.item, p_draft_id: w.draft,
        p_archived: w.archived, p_fingerprint: t.fingerprint, p_error: null,
      });
      report.written += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("github_project_synced", {
        p_task_no: t.task_no, p_item_id: t.item_id, p_draft_id: t.draft_id,
        p_archived: t.archived, p_fingerprint: t.fingerprint, p_error: message,
      });
      report.failed.push({ task_no: t.task_no, error: message });
    }
  }
  return report;
}
