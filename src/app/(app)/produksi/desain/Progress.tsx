"use client";

import { ChevronRight } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { design } from "@/demo/api";
import { DESIGN_BOXES, boxProgress, roomCode, type DesignAssignment, type DesignBox, type DesignProject } from "@/services/design/contracts";
import { officeToday } from "@/lib/office";
import { BoxBar } from "@/components/design/item-boxes";
import { useTr } from "@/lib/i18n";
import type { RoomRef } from "./Workspace";
import { ExcelTable } from "@/components/ui/excel-export";

/** Progres: every project and collection, filled boxes over all, and what is still
 *  empty by kind of box — read from the boxes, never typed (A3, S1). Who is
 *  drawing each collection and by when comes from the HRD tasks given out here (S2). */
export function Progress({ onOpenRoom }: { onOpenRoom: (r: RoomRef) => void }) {
  const tr = useTr();
  const [projects, reloadProjects] = useLoad(() => design.listDesignProjects(), []);
  const [boxes, reloadBoxes] = useLoad(() => design.listDesignBoxes({}), []);
  const [tasks, reloadTasks] = useLoad(() => design.listDesignAssignments(null), []);
  const reload = () => { reloadProjects(); reloadBoxes(); reloadTasks(); };
  const assigned = tasks.status === "ready" ? tasks.data : [];

  return (
    <Loaded state={projects} onRetry={reload}>
      {(ps) => (
        <Loaded state={boxes} onRetry={reload}>
          {(all) => {
            const withDesign = ps.filter((p) => all.some((b) => b.project_code === p.project_code));
            if (withDesign.length === 0) {
              return (
                <Card className="px-5 py-10 text-center text-[13px] text-slate-500">
                  {tr("No design items yet. Add them in the Workspace tab: a collection, then its items.",
                    "Belum ada item desain. Tambahkan di tab Ruang kerja: koleksi, lalu itemnya.")}
                </Card>
              );
            }
            return (
              <div className="space-y-4">
                <DrafterCard tasks={assigned} />
                {withDesign.map((p) => (
                  <ProjectCard key={p.project_code} p={p} boxes={all.filter((b) => b.project_code === p.project_code)}
                    tasks={assigned.filter((t) => t.project_code === p.project_code)} onOpenRoom={onOpenRoom} />
                ))}
              </div>
            );
          }}
        </Loaded>
      )}
    </Loaded>
  );
}

/** Who holds what: each drafter's open tasks, their boxes, and what is late —
 *  read from the same HRD tasks HRD monitors (D402). */
function DrafterCard({ tasks }: { tasks: DesignAssignment[] }) {
  const tr = useTr();
  const today = officeToday();
  const open = tasks.filter((t) => t.status === "OPEN");
  if (open.length === 0) return null;
  const by = new Map<string, DesignAssignment[]>();
  for (const t of open) by.set(t.assignee_name, [...(by.get(t.assignee_name) ?? []), t]);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-slate-800">{tr("Per drafter", "Per drafter")}</h3>
        <p className="text-[12px] text-slate-500">{tr("Open tasks given from Design. Each closes itself when its boxes are all filled.", "Tugas terbuka dari Desain. Masing-masing selesai sendiri saat semua kotaknya terisi.")}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {[...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, ts]) => {
          const filled = ts.reduce((n, t) => n + t.filled, 0);
          const total = ts.reduce((n, t) => n + t.total, 0);
          const late = ts.filter((t) => t.due_date < today && !t.blocked_reason).length;
          const next = [...ts].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
          return (
            <li key={name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
              <span className="min-w-[140px] font-medium text-slate-800">{name}</span>
              <span className="text-[12px] text-slate-500">{tr(`${ts.length} task(s)`, `${ts.length} tugas`)}</span>
              <BoxBar filled={filled} total={total} />
              <span className="text-[12px] text-slate-500">{tr("next due", "tenggat terdekat")} {next.due_date} · {next.ref_no}</span>
              {late > 0 && <Badge tone="red">{tr(`${late} late`, `${late} lewat`)}</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ProjectCard({ p, boxes, tasks, onOpenRoom }: { p: DesignProject; boxes: DesignBox[]; tasks: DesignAssignment[]; onOpenRoom: (r: RoomRef) => void }) {
  const tr = useTr();
  const total = boxProgress(boxes);
  const cols = new Map<string, DesignBox[]>();
  for (const b of boxes) {
    const k = b.collection_code;
    cols.set(k, [...(cols.get(k) ?? []), b]);
  }
  const ordered = [...cols.entries()].sort(([, a], [, b]) =>
    a[0].collection_code.localeCompare(b[0].collection_code));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-slate-500">{p.client_display ?? tr("No client yet", "Belum ada klien")}</p>
          <h3 className="text-[14px] font-semibold text-slate-800">
            <span className="font-mono text-[12px] font-normal text-slate-500">{p.project_code}</span> {p.project_name}
          </h3>
        </div>
        <BoxBar filled={total.filled} total={total.total} />
      </div>
      <div className="overflow-x-auto">
        <ExcelTable className="w-full min-w-[680px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-1.5 text-left">{tr("Collection", "Koleksi")}</th>
              <th className="px-2 py-1.5 text-right">{tr("Items", "Item")}</th>
              <th className="px-2 py-1.5 text-left">{tr("Progress", "Progres")}</th>
              <th className="px-2 py-1.5 text-left">{tr("Drafter", "Drafter")}</th>
              <th className="px-2 py-1.5 text-left">{tr("Still empty", "Masih kosong")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {ordered.map(([k, bs]) => {
              const live = bs.filter((b) => !b.dropped);
              const prog = boxProgress(bs);
              const items = new Set(live.map((b) => b.item_no)).size;
              const empty = DESIGN_BOXES
                .map((d) => ({ d, n: live.filter((b) => b.box === d.key && b.state === "kosong").length }))
                .filter((x) => x.n > 0);
              const head = bs[0];
              /* A task for the whole collection names its one room, 00 (D419). */
              const code = roomCode(p.project_code, head.collection_code, "00");
              const mine = tasks.filter((t) => t.ref_no === code);
              const task = mine.find((t) => t.status === "OPEN") ?? mine[0];
              return (
                <tr key={k} tabIndex={0}
                  onClick={() => onOpenRoom({ project: p.project_code, collection: head.collection_code, room: "00" })}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenRoom({ project: p.project_code, collection: head.collection_code, room: "00" }); }}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className="block text-slate-800">{head.collection_name}</span>
                    <span className="font-mono text-[11px] text-slate-400">{head.collection_code}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{items}</td>
                  <td className="px-2 py-2">{prog.total ? <BoxBar filled={prog.filled} total={prog.total} /> : <span className="text-[11px] text-slate-400">—</span>}</td>
                  <td className="px-2 py-2 text-[12px]">
                    {!task ? <span className="text-slate-400">—</span> : (
                      <>
                        <span className="block text-slate-700">{task.assignee_name}</span>
                        <span className={task.status === "DONE" ? "text-emerald-700"
                          : task.due_date < officeToday() ? "font-semibold text-rose-700" : "text-slate-500"}>
                          {task.status === "DONE" ? tr(`done ${task.done_at?.slice(0, 10)}`, `selesai ${task.done_at?.slice(0, 10)}`) : task.due_date}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-slate-600">
                    {empty.length === 0
                      ? <span className="text-emerald-700">{tr("complete", "lengkap")}</span>
                      : empty.map(({ d, n }) => `${n} ${d.label}`).join(" · ")}
                  </td>
                  <td className="pr-3 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </ExcelTable>
      </div>
    </Card>
  );
}
