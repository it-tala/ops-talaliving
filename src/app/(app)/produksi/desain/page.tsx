"use client";

import { useState } from "react";
import { PencilRuler, AlertTriangle, MessageCircleQuestion, Plus, FileStack } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import {
  DESIGN_KIND_LABEL, DESIGN_STATUS_LABEL,
  type DesignKind, type DesignTaskView,
} from "@/services/production/contracts";
import { DesignDrawer } from "./DesignDrawer";
import { useSession } from "@/store/session";
import { useCanDesign } from "@/lib/sell";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Desain — the drafting queue, built for the people doing the drawing (D179).
 *
 *  What a drafter could not see before, in the order it hurts:
 *
 *  1. **What is blocked.** A question asked nine days ago and never answered is
 *     somebody else's decision holding up a saw, and only the drafter knows.
 *  2. **What the workshop is actually cutting from.** Revision C exists;
 *     revision B is what was released. Nothing looks wrong — there is a recent
 *     upload, there is a drawing — which is exactly why it needs saying.
 *  3. **What is not drawn at all.** Computed from the orders and the work
 *     orders, so putting a product on a job makes its missing drawings appear
 *     the same day without anybody raising a task.
 *  4. **When each one is needed**, from the job's own deadline. A drafter
 *     cannot prioritise a list of products; they can prioritise dates.
 */
export default function DesignPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [tasks, reload] = useLoad(() => production.listDesignTasks(), []);
  const [gaps, reloadGaps] = useLoad(() => production.listDesignGaps(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"queue" | "project">("queue");
  const [projectFilter, setProjectFilter] = useState("");
  const canDesign = useCanDesign();
  /* The drafters take a task on, upload and release; whoever works on a
     design raises a task and asks or answers (0226). */
  const mayEdit = can("production.update");
  const mayAsk = canDesign("update");

  async function raise(target: { item_no?: string | null; product_code?: string | null }, kind: DesignKind) {
    setBusy(true);
    const res = await production.createDesignTask({ ...target, kind });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not created", "Tidak dibuat"), res.error.message);
      return;
    }
    toast("success", tr(`${res.data.task_no} created`, `${res.data.task_no} dibuat`), `${res.data.product_name} · ${DESIGN_KIND_LABEL[kind]}`);
    reload(); reloadGaps();
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Production", "Produksi")}
        title={tr("Design", "Desain")}
        description={tr(
          "The drawing queue: what is held up by a question, what has an unreleased revision, what has not been drawn at all — ordered by the date the piece is needed.",
          "Antrean gambar: yang tertahan pertanyaan, yang revisinya belum dirilis, yang belum digambar sama sekali — diurutkan dari tanggal barang itu dibutuhkan.",
        )}
        actions={<SourceBadge state={tasks} />}
      />

      <Loaded state={tasks} onRetry={reload}>
        {(all) => {
          const blocked = all.filter((t) => t.blocked);
          const ahead = all.filter((t) => t.ahead_of_release);
          const undrawn = all.filter((t) => t.status === "BELUM");
          /* Done is done: a released, current, unanswered-question-free task is
             not "late" however old its deadline is. */
          const settled = (t: DesignTaskView) => t.status === "RILIS" && !t.ahead_of_release && !t.blocked;
          const late = all.filter((t) => (t.days_left ?? 99) < 0 && !settled(t));

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("Waiting for an answer", "Menunggu jawaban"), String(blocked.length),
                      blocked.length > 0 ? tr("held up by someone else", "tertahan orang lain") : tr("nothing is held up", "tidak ada yang tertahan")],
                    [tr("Unreleased revisions", "Revisi belum dirilis"), String(ahead.length),
                      ahead.length > 0 ? tr("the workshop still uses the old one", "bengkel masih pakai yang lama") : tr("every latest one is released", "semua yang terbaru sudah dirilis")],
                    [tr("Not drawn yet", "Belum digambar"), String(undrawn.length), tr("nobody has started", "belum ada yang mulai")],
                    [tr("Past the date", "Lewat tanggal"), String(late.length), late.length > 0 ? tr("needed before today", "dibutuhkan sebelum hari ini") : tr("nothing is past", "tidak ada yang lewat")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        (k === tr("Waiting for an answer", "Menunggu jawaban") && blocked.length > 0)
                          || (k === tr("Unreleased revisions", "Revisi belum dirilis") && ahead.length > 0)
                          || (k === tr("Past the date", "Lewat tanggal") && late.length > 0)
                          ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              {ahead.length > 0 && (
                <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{tr("The workshop is cutting from an old drawing.", "Bengkel memotong dari gambar lama.")}</strong>{" "}
                    {ahead.map((t) => tr(
                      `${t.product_name} — released ${t.released_rev}, latest ${t.latest_rev}`,
                      `${t.product_name} — rilis ${t.released_rev}, terbaru ${t.latest_rev}`,
                    )).join(" · ")}.{" "}
                    {tr(
                      "An uploaded revision is not a released one; the production floor only sees what is released.",
                      "Revisi yang diunggah bukan revisi yang dirilis; lantai produksi hanya melihat yang dirilis.",
                    )}
                  </span>
                </div>
              )}

              <Card className="mb-4">
                <CardHeader
                  title={tr(`${all.length} drawing tasks`, `${all.length} tugas gambar`)}
                  subtitle={tr(
                    "Held up first, then unreleased revisions, then by the date needed.",
                    "Tertahan dulu, lalu yang revisinya belum dirilis, lalu menurut tanggal dibutuhkan.",
                  )}
                  icon={PencilRuler}
                />
                <QueueControls all={all} view={view} setView={setView} project={projectFilter} setProject={setProjectFilter} />
                {view === "queue" ? (
                  <Paged rows={filterTasks(all, projectFilter)} pageSize={12} unit={tr("tasks", "tugas")}>
                    {(page) => (
                      <ul className="divide-y divide-slate-100">
                        {page.map((t) => <Row key={t.id} task={t} onOpen={() => setOpen(t.task_no)} />)}
                      </ul>
                    )}
                  </Paged>
                ) : (
                  <ByProject tasks={filterTasks(all, projectFilter)} onOpen={setOpen} />
                )}
              </Card>

              <Loaded state={gaps} onRetry={reloadGaps}>
                {(g) => g.length === 0 ? <></> : (
                  <Card>
                    <CardHeader
                      title={tr(`${g.length} drawings without a task`, `${g.length} gambar belum punya tugas`)}
                      subtitle={tr(
                        "Products ordered or in production, and design items the client approved or that were quoted or ordered, with no drawing task at all. Worked out from the orders and the design, not from anyone's memory.",
                        "Produk yang dipesan atau sedang dikerjakan, dan item desain yang disetujui klien, ditawarkan, atau dipesan, yang belum punya tugas gambar. Dihitung dari pesanan dan desain, bukan diingat orang.",
                      )}
                      icon={FileStack}
                    />
                    <ul className="divide-y divide-slate-100">
                      {g.map((row) => (
                        <li key={`${row.item_no ?? row.product_code}-${row.kind}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className="min-w-[200px] flex-1 text-[13px] text-slate-800">
                            {row.product_name}
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{row.item_no ?? row.product_code}</span>
                            {row.item_no && (
                              <span className="block text-[11px] text-slate-500">
                                {[row.project_code, row.collection_code, row.room_name].filter(Boolean).join(" › ")}
                              </span>
                            )}
                          </span>
                          <Badge tone="slate">{DESIGN_KIND_LABEL[row.kind]}</Badge>
                          <span className="text-[12px] text-slate-500">{row.why}</span>
                          {mayAsk && (
                            <Button size="sm" variant="outline" icon={Plus} disabled={busy}
                              onClick={() => raise(row.item_no ? { item_no: row.item_no } : { product_code: row.product_code }, row.kind)}>
                              {tr("Create task", "Buat tugas")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </Loaded>

              {open && (
                <DesignDrawer
                  taskNo={open}
                  mayEdit={mayEdit}
                  mayAsk={mayAsk}
                  onClose={() => setOpen(null)}
                  onChanged={() => { reload(); reloadGaps(); }}
                />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

const filterTasks = (xs: DesignTaskView[], project: string) =>
  !project ? xs : project === "__catalogue" ? xs.filter((t) => !t.project_code) : xs.filter((t) => t.project_code === project);

/** The queue's two readings: by priority (D179), or in the drafters' own
 *  order — client → project → collection → room → item (D379). */
function QueueControls({
  all, view, setView, project, setProject,
}: {
  all: DesignTaskView[]; view: "queue" | "project"; setView: (v: "queue" | "project") => void;
  project: string; setProject: (p: string) => void;
}) {
  const tr = useTr();
  const projects = [...new Map(all.filter((t) => t.project_code).map((t) => [t.project_code!, t])).values()]
    .sort((a, b) => (a.client_display ?? "").localeCompare(b.client_display ?? "") || a.project_code!.localeCompare(b.project_code!));
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2">
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[12px]">
        {([["queue", tr("By priority", "Menurut prioritas")], ["project", tr("By client & project", "Per klien & proyek")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={cn("rounded-md px-2.5 py-1", view === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</button>
        ))}
      </div>
      <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={tr("Project", "Proyek")}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px]">
        <option value="">{tr("All projects and products", "Semua proyek dan produk")}</option>
        {projects.map((t) => (
          <option key={t.project_code} value={t.project_code!}>{t.client_display ? `${t.client_display} › ` : ""}{t.project_code} {t.project_name}</option>
        ))}
        <option value="__catalogue">{tr("Catalogue products (no project)", "Produk katalog (tanpa proyek)")}</option>
      </select>
    </div>
  );
}

function ByProject({ tasks, onOpen }: { tasks: DesignTaskView[]; onOpen: (taskNo: string) => void }) {
  const tr = useTr();
  const groups = new Map<string, { head: string; sub: Map<string, DesignTaskView[]> }>();
  /* Projects first, by client; the catalogue's own products after. */
  const sorted = [...tasks].sort((a, b) =>
    (a.project_code ? 0 : 1) - (b.project_code ? 0 : 1)
    || (a.client_display ?? "").localeCompare(b.client_display ?? "") || (a.project_code ?? "").localeCompare(b.project_code ?? "")
    || (a.collection_code ?? "").localeCompare(b.collection_code ?? "") || (a.room_sort ?? 0) - (b.room_sort ?? 0)
    || (a.item_no ?? a.product_code ?? "").localeCompare(b.item_no ?? b.product_code ?? ""));
  for (const t of sorted) {
    const gk = t.project_code ?? "__catalogue";
    const head = t.project_code
      ? `${t.client_display ? `${t.client_display} › ` : ""}${t.project_code} ${t.project_name ?? ""}`
      : tr("Catalogue products — no project", "Produk katalog — tanpa proyek");
    if (!groups.has(gk)) groups.set(gk, { head, sub: new Map() });
    const sk = t.project_code ? `${t.collection_code ?? ""} · ${t.collection_name ?? ""} › ${t.room_name ?? ""}` : "";
    const g = groups.get(gk)!;
    g.sub.set(sk, [...(g.sub.get(sk) ?? []), t]);
  }
  if (groups.size === 0) return <p className="px-5 py-6 text-center text-[13px] text-slate-500">{tr("No tasks.", "Tidak ada tugas.")}</p>;
  return (
    <div>
      {[...groups.entries()].map(([k, g]) => (
        <section key={k} className="border-b border-slate-100 last:border-0">
          <h3 className="bg-slate-50/70 px-5 py-1.5 text-[12px] font-semibold text-slate-700">{g.head}</h3>
          {[...g.sub.entries()].map(([sk, ts]) => (
            <div key={sk}>
              {sk && <p className="px-5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{sk}</p>}
              <ul className="divide-y divide-slate-100">
                {ts.map((t) => <Row key={t.id} task={t} onOpen={() => onOpen(t.task_no)} />)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function Row({ task: t, onOpen }: { task: DesignTaskView; onOpen: () => void }) {
  const tr = useTr();
  const done = t.status === "RILIS" && !t.ahead_of_release && !t.blocked;
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-slate-50">
        <span className="min-w-[200px] flex-1">
          <span className="block text-[13px] font-medium text-slate-800">{t.product_name}</span>
          <span className="block font-mono text-[10px] text-slate-400">
            {t.task_no} · {t.item_no ?? t.product_code} · {DESIGN_KIND_LABEL[t.kind]}
          </span>
          {t.project_code && (
            <span className="block text-[11px] text-slate-500">
              {[t.client_display, t.project_code, t.collection_code, t.room_name].filter(Boolean).join(" › ")}
            </span>
          )}
        </span>

        <Badge tone={
          t.blocked ? "red"
            : t.status === "RILIS" ? "green"
              : t.status === "DIGAMBAR" ? "brand" : "slate"
        }>
          {t.blocked ? tr("Waiting for an answer", "Menunggu jawaban") : DESIGN_STATUS_LABEL[t.status]}
        </Badge>

        <span className="whitespace-nowrap text-[12px] text-slate-600">
          {t.released_rev ? tr(`released ${t.released_rev}`, `rilis ${t.released_rev}`) : tr("no release yet", "belum ada rilis")}
          {t.ahead_of_release && (
            <span className="ml-1 font-medium text-amber-700">· {tr(`${t.latest_rev} not released yet`, `ada ${t.latest_rev} belum dirilis`)}</span>
          )}
        </span>

        <span className="whitespace-nowrap text-[12px] text-slate-500">
          {t.assignee ?? <span className="text-slate-400">{tr("nobody assigned", "belum ada yang pegang")}</span>}
        </span>

        <span className={cn(
          "whitespace-nowrap text-[12px] tabular-nums",
          done ? "text-slate-400"
            : (t.days_left ?? 99) < 0 ? "font-medium text-rose-700"
              : (t.days_left ?? 99) <= 3 ? "font-medium text-amber-700" : "text-slate-500",
        )}>
          {done
            ? tr("done", "selesai")
            : t.needed_by
              ? t.days_left != null && t.days_left < 0
                ? tr(`${Math.abs(t.days_left)} days over`, `lewat ${Math.abs(t.days_left)} hari`)
                : tr(`${t.days_left} days left`, `${t.days_left} hari lagi`)
              : tr("nobody waiting yet", "belum ada yang menunggu")}
        </span>

        {t.blocked && (
          <span className="flex w-full items-center gap-1.5 text-[11px] text-amber-700">
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            {t.questions.find((q) => !q.answer)?.question}
            {" — "}
            {tr(
              `${t.questions.find((q) => !q.answer)?.waiting_days} days waiting for an answer from`,
              `${t.questions.find((q) => !q.answer)?.waiting_days} hari menunggu jawaban`,
            )}{" "}
            {t.questions.find((q) => !q.answer)?.asked_of}
          </span>
        )}
      </button>
    </li>
  );
}
