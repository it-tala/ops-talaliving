"use client";

import { useMemo, useState } from "react";
import { GitPullRequest, Webhook, KanbanSquare, UserCog, FlaskConical, Trash2, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { identity } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { isLiveMode } from "@/lib/live";
import type { GithubDelivery, GithubPrOutcome } from "@/services/identity/contracts";

/** IT → GitHub (D382).
 *
 *  Three things on one page, because they are one question — *is GitHub
 *  moving our tasks?*:
 *
 *  - **who is who**: a GitHub login per ops account. A PR moves a task only
 *    when its author's login belongs to the task's holder. `it.read` looks,
 *    `it.manage_users` maps (the same grant that makes the account).
 *  - **the webhook**: the last deliveries GitHub sent and what each did.
 *  - **the board**: how many IT tasks are on GitHub Projects, and which ones
 *    the sync could not write, with GitHub's own sentence.
 *
 *  In the demo there is no GitHub, so a form sends a pretend `pull_request`
 *  through the same rules. The live client refuses it.
 */

const DID: Record<string, { tone: "green" | "brand" | "amber" | "slate" | "red"; en: string; id: string }> = {
  started: { tone: "brand", en: "started", id: "dimulai" },
  delivered: { tone: "green", en: "done & handed over", id: "selesai & diserahkan" },
  recorded: { tone: "slate", en: "recorded", id: "dicatat" },
  held_not_holder: { tone: "amber", en: "not the holder — HRD decides", id: "bukan pemegang — HRD memutuskan" },
  held_unmapped: { tone: "amber", en: "unmapped login — HRD decides", id: "login belum dipetakan — HRD memutuskan" },
  merged_not_default: { tone: "slate", en: "merged into another branch", id: "di-merge ke branch lain" },
  task_already_done: { tone: "slate", en: "task already done", id: "tugas sudah selesai" },
  task_already_cancelled: { tone: "slate", en: "task cancelled", id: "tugas dibatalkan" },
};

function stamp(at: string | null): string {
  if (!at) return "—";
  return new Date(at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function GithubPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const manage = can("it.manage_users");
  const [status, reloadStatus] = useLoad(() => identity.getGithubStatus(), []);
  const [accounts, reloadAccounts] = useLoad(() => identity.listGithubAccounts(), []);
  const [users] = useLoad(() => identity.listUsers(), []);
  const [userId, setUserId] = useState("");
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);

  const unmapped = useMemo(() => {
    if (users.status !== "ready" || accounts.status !== "ready") return [];
    const taken = new Set(accounts.data.map((a) => a.user_id));
    return users.data.filter((u) => u.user.is_active && !taken.has(u.user.id));
  }, [users, accounts]);

  async function save(uid: string, value: string | null) {
    setBusy(true);
    const res = await identity.saveGithubAccount({ user_id: uid, github_login: value });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", value ? tr("Mapped", "Dipetakan") : tr("Removed", "Dilepas"), value ?? "");
    setUserId(""); setLogin("");
    reloadAccounts(); reloadStatus();
  }

  const input = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="GitHub"
        description={tr(
          "A pull request that names a task moves it: started when opened, done and handed over when merged into the default branch — when its author is the task's holder. IT tasks also appear on the GitHub Projects board.",
          "Pull request yang menyebut nomor tugas menggerakkan tugasnya: mulai saat dibuka, selesai & diserahkan saat di-merge ke branch default — bila penulisnya pemegang tugas. Tugas IT juga muncul di papan GitHub Projects.",
        )}
        actions={<Button variant="secondary" size="sm" onClick={() => { reloadStatus(); reloadAccounts(); }}>{tr("Refresh", "Muat ulang")}</Button>}
      />

      <Card className="mb-4">
        <CardHeader icon={GitPullRequest} title={tr("How a PR finishes a task", "Cara PR menyelesaikan tugas")} />
        <ul className="list-disc space-y-1 px-9 py-3 text-[13px] text-slate-700">
          <li>{tr("Write the task number in the PR title or description, e.g.", "Tulis nomor tugas di judul atau deskripsi PR, mis.")} <code className="rounded bg-slate-100 px-1">Tugas: tgs-26-10-06_02</code>.</li>
          <li>{tr("Opened by the task's holder → the task is marked started. Merged into the repository's default branch → done and handed over, with the PR's title and link as the hand-over note. HRD and the assigner are notified as for any hand-over.", "Dibuka oleh pemegang tugas → tugas ditandai mulai. Di-merge ke branch default repo → selesai & diserahkan, catatan serah = judul dan link PR. HRD dan pemberi tugas diberi tahu seperti serah tugas lainnya.")}</li>
          <li>{tr("A PR from anybody else, or from a login not mapped below, leaves the task open, is recorded on it, and HRD is notified to decide.", "PR dari orang lain, atau dari login yang belum dipetakan di bawah, tidak menutup tugas: PR-nya dicatat pada tugas dan HRD diberi tahu untuk memutuskan.")}</li>
        </ul>
      </Card>

      <Loaded state={status} onRetry={reloadStatus}>
        {(s) => (
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader icon={Webhook} title={tr("Webhook", "Webhook")}
                subtitle={tr("Organisation webhook → /api/github/webhook", "Webhook organisasi → /api/github/webhook")} />
              <dl className="grid grid-cols-2 gap-y-1 px-5 py-3 text-[13px]">
                <dt className="text-slate-500">{tr("Last delivery", "Kiriman terakhir")}</dt>
                <dd>{s.last_delivery_at ? stamp(s.last_delivery_at) : <Badge tone="amber">{tr("none yet", "belum ada")}</Badge>}</dd>
                <dt className="text-slate-500">{tr("PRs on tasks", "PR tercatat pada tugas")}</dt>
                <dd>{s.linked_prs}</dd>
                <dt className="text-slate-500">{tr("Mapped accounts", "Akun terpetakan")}</dt>
                <dd>{s.accounts}</dd>
              </dl>
            </Card>
            <Card>
              <CardHeader icon={KanbanSquare} title="GitHub Projects"
                subtitle={tr("IT tasks = tasks whose holder has a GitHub login below", "Tugas IT = tugas yang pemegangnya punya login GitHub di bawah")} />
              <dl className="grid grid-cols-2 gap-y-1 px-5 py-3 text-[13px]">
                <dt className="text-slate-500">{tr("Items written", "Item tertulis")}</dt>
                <dd>{s.items_synced}</dd>
                <dt className="text-slate-500">{tr("Last sync", "Sinkron terakhir")}</dt>
                <dd>{s.last_synced_at ? stamp(s.last_synced_at) : <Badge tone="slate">{tr("never", "belum pernah")}</Badge>}</dd>
              </dl>
              {s.sync_errors.length > 0 && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {s.sync_errors.map((e) => (
                    <li key={e.task_no} className="px-5 py-2 text-[12px]">
                      <span className="font-mono">{e.task_no}</span> {e.title}
                      <span className="block text-rose-700">{e.error} · {tr("tries", "percobaan")} {e.attempts}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Loaded>

      <Card className="mb-4">
        <CardHeader icon={UserCog} title={tr("GitHub accounts", "Akun GitHub")}
          subtitle={tr("One login per ops account. Only a mapped holder's PR moves a task.", "Satu login per akun ops. Hanya PR pemegang tugas yang terpetakan yang menggerakkan tugas.")} />
        <Loaded state={accounts} onRetry={reloadAccounts}>
          {(rows) => (
            <ul className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <li className="px-5 py-3 text-[13px] text-slate-500">{tr("No account mapped yet.", "Belum ada akun yang dipetakan.")}</li>
              )}
              {rows.map((a) => (
                <li key={a.github_login} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                  <a href={`https://github.com/${a.github_login}`} target="_blank" rel="noreferrer"
                     className="w-40 font-mono text-brand-700 hover:underline">@{a.github_login}</a>
                  <span className="font-medium text-slate-800">{a.full_name}</span>
                  <span className="text-slate-500">{a.email}{a.employee_no ? ` · ${a.employee_no}` : ""}</span>
                  <span className="flex-1" />
                  {manage && (
                    <Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={() => save(a.user_id, null)}>
                      {tr("Remove", "Lepas")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Loaded>
        {manage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-5 py-3">
            <label className="text-[12px] text-slate-600">
              {tr("Ops account", "Akun ops")}
              <select className={`${input} mt-1 block w-64`} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">{tr("— choose —", "— pilih —")}</option>
                {unmapped.map((u) => (
                  <option key={u.user.id} value={u.user.id}>{u.user.full_name} · {u.user.email}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("GitHub login", "Login GitHub")}
              <input className={`${input} mt-1 block w-48 font-mono`} placeholder="budi-dev" value={login}
                     onChange={(e) => setLogin(e.target.value)} />
            </label>
            <Button size="sm" icon={Plus} disabled={busy || !userId || !login.trim()} onClick={() => save(userId, login)}>
              {tr("Map", "Petakan")}
            </Button>
          </div>
        )}
      </Card>

      {!isLiveMode() && <Simulator onDone={() => { reloadStatus(); }} />}

      <Loaded state={status} onRetry={reloadStatus}>
        {(s) => (
          <Card>
            <CardHeader icon={Webhook} title={tr("Recent deliveries", "Kiriman terakhir")} />
            <ul className="divide-y divide-slate-100">
              {s.deliveries.length === 0 && (
                <li className="px-5 py-3 text-[13px] text-slate-500">
                  {tr("GitHub has not sent anything yet.", "GitHub belum mengirim apa pun.")}
                </li>
              )}
              {s.deliveries.map((d) => <DeliveryRow key={d.delivery_id} d={d} />)}
            </ul>
          </Card>
        )}
      </Loaded>
    </div>
  );
}

function DeliveryRow({ d }: { d: GithubDelivery }) {
  const tr = useTr();
  const tasks = d.result.tasks ?? [];
  return (
    <li className="px-5 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-40 text-[12px] text-slate-500">{stamp(d.received_at)}</span>
        <span className="font-mono text-[12px]">{d.repo}#{d.pr_number}</span>
        <Badge tone="slate">{d.action ?? d.event}</Badge>
        {d.result.author && <span className="text-[12px] text-slate-500">@{d.result.author}{d.result.mapped === false ? ` (${tr("unmapped", "belum dipetakan")})` : ""}</span>}
      </div>
      <p className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-slate-600">
        {d.result.ignored && <span>{tr("Ignored action", "Aksi diabaikan")}: {d.result.ignored}</span>}
        {!d.result.ignored && tasks.length === 0 && <span>{tr("No task number in this PR.", "PR ini tidak menyebut nomor tugas.")}</span>}
        {tasks.map((t) => {
          const v = DID[t.did] ?? { tone: "slate" as const, en: t.did, id: t.did };
          return <Badge key={t.task_no} tone={v.tone}>{t.task_no}: {tr(v.en, v.id)}</Badge>;
        })}
        {(d.result.unknown ?? []).map((n) => <Badge key={n} tone="red">{n}: {tr("no such task", "tugas tidak ada")}</Badge>)}
      </p>
    </li>
  );
}

/** Demo only: a pretend `pull_request` delivery through the seam's rules. */
function Simulator({ onDone }: { onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [author, setAuthor] = useState("");
  const [taskNo, setTaskNo] = useState("");
  const [title, setTitle] = useState("Perbaikan");
  const [kind, setKind] = useState<"opened" | "merged" | "merged_other" | "closed">("opened");
  const [num, setNum] = useState(101);
  const [result, setResult] = useState<GithubPrOutcome | null>(null);
  const input = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";

  async function send() {
    const res = await identity.simulateGithubPullRequest({
      action: kind === "opened" ? "opened" : "closed",
      merged: kind === "merged" || kind === "merged_other",
      repo: "it-tala/ops-talaliving", number: num, title,
      body: `Tugas: ${taskNo}`, author,
      base: kind === "merged_other" ? "staging" : "main", default_branch: "main",
    });
    if (res.error) { toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    setResult(res.data);
    onDone();
  }

  return (
    <Card className="mb-4 border-dashed">
      <CardHeader icon={FlaskConical} title={tr("Simulate a PR (demo)", "Simulasi PR (demo)")}
        subtitle={tr("There is no GitHub in the demo: this sends a pretend webhook through the same rules.", "Di demo tidak ada GitHub: ini mengirim webhook pura-pura lewat aturan yang sama.")} />
      <div className="flex flex-wrap items-end gap-2 px-5 py-3 text-[12px] text-slate-600">
        <label>{tr("Author login", "Login penulis")}
          <input className={`${input} mt-1 block w-36 font-mono`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="budi-dev" /></label>
        <label>{tr("Task number", "Nomor tugas")}
          <input className={`${input} mt-1 block w-44 font-mono`} value={taskNo} onChange={(e) => setTaskNo(e.target.value)} placeholder="tgs-26-10-06_01" /></label>
        <label>{tr("PR title", "Judul PR")}
          <input className={`${input} mt-1 block w-48`} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>PR #
          <input type="number" className={`${input} mt-1 block w-20`} value={num} onChange={(e) => setNum(Number(e.target.value) || 1)} /></label>
        <label>{tr("Event", "Kejadian")}
          <select className={`${input} mt-1 block w-52`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="opened">{tr("opened", "dibuka")}</option>
            <option value="merged">{tr("merged into main (default)", "di-merge ke main (default)")}</option>
            <option value="merged_other">{tr("merged into staging", "di-merge ke staging")}</option>
            <option value="closed">{tr("closed without merge", "ditutup tanpa merge")}</option>
          </select></label>
        <Button size="sm" disabled={!author.trim() || !taskNo.trim()} onClick={send}>{tr("Send", "Kirim")}</Button>
      </div>
      {result && (
        <p className="flex flex-wrap gap-1.5 px-5 pb-3 text-[12px]">
          {result.tasks.length === 0 && result.unknown.length === 0 && tr("No task number in this PR.", "PR ini tidak menyebut nomor tugas.")}
          {result.tasks.map((t) => {
            const v = DID[t.did] ?? { tone: "slate" as const, en: t.did, id: t.did };
            return <Badge key={t.task_no} tone={v.tone}>{t.task_no}: {tr(v.en, v.id)}</Badge>;
          })}
          {result.unknown.map((n) => <Badge key={n} tone="red">{n}: {tr("no such task", "tugas tidak ada")}</Badge>)}
        </p>
      )}
    </Card>
  );
}
