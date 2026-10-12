"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FolderOpen, Layers, Plus } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { design } from "@/demo/api";
import { boxProgress, itemCode, roomCode, type DesignProject } from "@/services/design/contracts";
import { AssignmentLine } from "@/components/design/assign-task";
import { CollectionForm, ItemForm, collectionItems } from "@/components/design/design-board";
import { BoxBar, BoxChips } from "@/components/design/item-boxes";
import { ItemStudioDrawer } from "@/components/design/item-studio";
import { useTr } from "@/lib/i18n";
import { CollectionGallery } from "@/components/design/collection-gallery";
import { useCanSell } from "@/lib/sell";
import { NewProject } from "../../proyek/order/ProjectDrawer";

/** A collection in the tree. `room` is the collection's one room, `00`, since
 *  rooms left the screens (D419); tasks given for the whole collection name it
 *  (`<project>-<collection>-00`). */
export interface RoomRef { project: string; collection: string; room: string }

/** Ruang kerja: client › project › collection on the left, the collection's
 *  items with their six boxes in the middle; an item opens in a drawer laid
 *  out like a product on Production → BOM, its files beside its BOM (D421)
 *  (Studio Desain S1, D405, D419). Every level can be added to from here, so the
 *  drafters can start from nothing without the Projects menu (F247). Whoever
 *  may open a sale opens the project here too, with the Projects form, and it
 *  is chosen at once (O1, F255). */
export function Workspace({
  canEdit, canMakeProduct, canOpenProject, start,
}: { canEdit: boolean; canMakeProduct: boolean; canOpenProject: boolean; start: { room?: RoomRef; item?: string } }) {
  const tr = useTr();
  const canSell = useCanSell();
  const [projects, reloadProjects] = useLoad(() => design.listDesignProjects(), []);
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<string | null>(start.room?.project ?? start.item?.split("-")[0] ?? null);
  const [room, setRoom] = useState<RoomRef | null>(start.room ?? null);
  const [item, setItem] = useState<string | null>(start.item ?? null);
  /* Bumped whenever a box changes, so the tree's room counts follow. */
  const [tick, setTick] = useState(0);

  const onRoom = useCallback((r: RoomRef) => { setRoom(r); setItem(null); }, []);

  /* Follow a jump from the Progress tab. */
  useEffect(() => {
    if (start.room) { setProject(start.room.project); setRoom(start.room); setItem(start.item ?? null); }
  }, [start.room, start.item]);

  /* Nothing chosen yet: the first project that has a design, else the first. */
  useEffect(() => {
    if (project || projects.status !== "ready" || projects.data.length === 0) return;
    setProject((projects.data.find((p) => p.item_count > 0) ?? projects.data[0]).project_code);
  }, [project, projects]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[13px] font-semibold text-slate-800">
          <span className="min-w-0 truncate">{tr("Clients & projects", "Klien & proyek")}</span>
          {canSell("create") && (
            <Button size="sm" variant="ghost" icon={Plus} className="shrink-0 whitespace-nowrap" onClick={() => setCreating(true)}>{tr("New project", "Proyek baru")}</Button>
          )}
        </div>
        <Loaded state={projects}>
          {(ps) => ps.length === 0 ? (
            <div className="px-4 py-4 text-[12px] text-slate-500">
              <p>{canSell("create")
                ? tr("No live project yet. Start with the client and the project, then its collections.",
                  "Belum ada proyek berjalan. Mulai dengan klien dan proyeknya, lalu koleksinya.")
                : tr("No live project yet. Projects are opened by leadership or marketing.",
                  "Belum ada proyek berjalan. Proyek dibuka oleh pimpinan atau marketing.")}</p>
              {canSell("create") && (
                <Button size="sm" icon={Plus} className="mt-2" onClick={() => setCreating(true)}>{tr("New project", "Proyek baru")}</Button>
              )}
            </div>
          ) : (
            <ProjectTree projects={ps} project={project} room={room} canEdit={canEdit} tick={tick}
              onProject={(code) => { setProject(code); if (room?.project !== code) { setRoom(null); setItem(null); } }}
              onRoom={onRoom} />
          )}
        </Loaded>
      </Card>
      {creating && (
        <NewProject onClose={() => setCreating(false)} onChanged={reloadProjects}
          onCreated={(code) => { setProject(code); setRoom(null); setItem(null); }} />
      )}

      <div className="min-w-0 space-y-4">
        {project && room ? (
          <RoomPanel key={`${room.project}-${room.collection}-${room.room}`} room={room} item={item} onItem={setItem}
            onChanged={() => setTick((t) => t + 1)}
            canEdit={canEdit} canMakeProduct={canMakeProduct} canOpenProject={canOpenProject} />
        ) : (
          <Card className="px-5 py-10 text-center text-[13px] text-slate-500">
            <FolderOpen className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            {tr("Choose a collection on the left. A project with no design yet starts with a collection.",
              "Pilih koleksi di kiri. Proyek yang belum punya desain dimulai dengan koleksi.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function ProjectTree({
  projects, project, room, canEdit, tick, onProject, onRoom,
}: {
  projects: DesignProject[]; project: string | null; room: RoomRef | null; canEdit: boolean; tick: number;
  onProject: (code: string) => void; onRoom: (r: RoomRef) => void;
}) {
  const tr = useTr();
  const byClient = new Map<string, DesignProject[]>();
  for (const p of projects) {
    const k = p.client_display ?? tr("No client yet", "Belum ada klien");
    byClient.set(k, [...(byClient.get(k) ?? []), p]);
  }
  return (
    <nav className="max-h-[45vh] overflow-y-auto py-1.5 text-[13px] lg:max-h-[70vh]">
      {[...byClient.entries()].map(([client, ps]) => (
        <div key={client} className="pb-1">
          <p className="px-4 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{client}</p>
          {ps.map((p) => (
            <div key={p.project_code}>
              <button onClick={() => onProject(p.project_code)}
                className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-slate-50",
                  project === p.project_code && "font-semibold text-slate-900")}>
                <span className="font-mono text-[11px] text-slate-400">{p.project_code}</span>
                <span className="min-w-0 flex-1 truncate">{p.project_name}</span>
                <span className="text-[11px] tabular-nums text-slate-400">{p.item_count || ""}</span>
              </button>
              {project === p.project_code && (
                <ProjectRooms projectCode={p.project_code} room={room} canEdit={canEdit} tick={tick} onRoom={onRoom} />
              )}
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}

function ProjectRooms({
  projectCode, room, canEdit, tick, onRoom,
}: { projectCode: string; room: RoomRef | null; canEdit: boolean; tick: number; onRoom: (r: RoomRef) => void }) {
  const tr = useTr();
  const [d, reload] = useLoad(() => design.getProjectDesign(projectCode), [projectCode, tick]);
  const [boxes] = useLoad(() => design.listDesignBoxes({ project_code: projectCode }), [projectCode, tick]);

  /* A project opened with no collection chosen opens its first collection
     that has items (else its first), so the screen is never empty for no reason. */
  useEffect(() => {
    if (d.status !== "ready" || (room && room.project === projectCode)) return;
    const pd = d.data;
    const first = pd.collections.find((c) => pd.items.some((i) => i.collection_code === c.code)) ?? pd.collections[0];
    if (first) onRoom({ project: projectCode, collection: first.code, room: "00" });
  }, [d, room, projectCode, onRoom]);
  const [adding, setAdding] = useState(false);
  const all = boxes.status === "ready" ? boxes.data : [];
  return (
    <div className="border-l-2 border-slate-100 pb-1 pl-3 ml-5">
      <Loaded state={d} onRetry={reload} skeletonRows={1}>
        {(pd) => (
          <>
            {pd.collections.map((c) => {
              const prog = boxProgress(all.filter((b) => b.collection_code === c.code));
              const active = room?.project === projectCode && room.collection === c.code;
              return (
                <button key={c.code} onClick={() => onRoom({ project: projectCode, collection: c.code, room: "00" })}
                  aria-current={active}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-50",
                    active && "bg-brand-50 font-semibold text-brand-800")}>
                  <Layers className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{c.code} · {c.name}</span>
                  <span className="text-[11px] tabular-nums text-slate-400">{prog.total ? `${prog.filled}/${prog.total}` : "—"}</span>
                </button>
              );
            })}
            {pd.collections.length === 0 && !adding && (
              <p className="px-2 py-1 text-[12px] text-slate-400">{tr("No design yet.", "Belum ada desain.")}</p>
            )}
            {canEdit && (adding ? (
              <div className="py-1.5 pr-2">
                <CollectionForm projectCode={projectCode} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="mt-1 rounded px-2 py-0.5 text-[12px] text-brand-700 hover:bg-brand-50">
                + {tr("collection", "koleksi")}
              </button>
            ))}
          </>
        )}
      </Loaded>
    </div>
  );
}

function RoomPanel({
  room, item, onItem, onChanged, canEdit, canMakeProduct, canOpenProject,
}: {
  room: RoomRef; item: string | null; onItem: (no: string | null) => void; onChanged: () => void;
  canEdit: boolean; canMakeProduct: boolean; canOpenProject: boolean;
}) {
  const tr = useTr();
  const [d, reloadDesign] = useLoad(() => design.getProjectDesign(room.project), [room.project]);
  const [boxes, reloadBoxes] = useLoad(() => design.listDesignBoxes({ project_code: room.project }), [room.project]);
  const [tasks, reloadTasks] = useLoad(() => design.listDesignAssignments(room.project), [room.project]);
  const [adding, setAdding] = useState(false);
  const reload = () => { reloadDesign(); reloadBoxes(); reloadTasks(); onChanged(); };
  /* A box filled can close a task (D403), so tasks follow the boxes. */
  const boxesChanged = () => { reloadBoxes(); reloadTasks(); onChanged(); };
  /* The open task for a scope, else its latest finished one. */
  const taskFor = (ref: string) => {
    const list = (tasks.status === "ready" ? tasks.data : []).filter((t) => t.ref_no === ref);
    return list.find((t) => t.status === "OPEN") ?? list[0];
  };
  const roomBoxes = useMemo(() => (boxes.status === "ready" ? boxes.data : [])
    .filter((b) => b.collection_code === room.collection), [boxes, room]);

  return (
    <Loaded state={d} onRetry={reload}>
      {(pd) => {
        const c = pd.collections.find((x) => x.code === room.collection);
        const items = collectionItems(pd, room.collection);
        const chosen = items.find((i) => i.item_no === item) ?? null;
        const prog = boxProgress(roomBoxes);
        const first = items[0];
        return (
          <>
            <Card>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-500">
                    {first?.client_display ?? ""}{first?.client_display ? " › " : ""}{room.project} {first?.project_name ?? ""}
                  </p>
                  <h3 className="text-[14px] font-semibold text-slate-800">
                    {c ? `${c.code} · ${c.name}` : room.collection}
                  </h3>
                  {c && <CollectionGallery projectCode={room.project} collection={c} canEdit={canEdit} onChanged={reloadDesign} className="mt-1" />}
                </div>
                {prog.total > 0 && <BoxBar filled={prog.filled} total={prog.total} />}
                {canEdit && !adding && (
                  <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>{tr("Item", "Item")}</Button>
                )}
                {items.length > 0 && (
                  <AssignmentLine scope="room" refNo={roomCode(room.project, room.collection, room.room)}
                    assignment={taskFor(roomCode(room.project, room.collection, room.room))}
                    complete={prog.total > 0 && prog.filled === prog.total}
                    canEdit={canEdit} onChanged={reloadTasks} />
                )}
              </div>
              {adding && (
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <ItemForm projectCode={room.project} collectionCode={room.collection}
                    onDone={(i) => { setAdding(false); reload(); onItem(i.item_no); }} onCancel={() => setAdding(false)} />
                </div>
              )}
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                  {tr("No items in this collection yet. Add the first with + Item — its six boxes appear empty, and none is required.",
                    "Belum ada item di koleksi ini. Tambah yang pertama dengan + Item — enam kotaknya muncul kosong, dan tidak ada yang wajib.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-1.5 text-left">{tr("Item", "Item")}</th>
                        <th className="px-2 py-1.5 text-left">{tr("Completeness", "Kelengkapan")}</th>
                        <th className="px-4 py-1.5 text-left">{tr("Progress", "Progres")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => {
                        const mine = roomBoxes.filter((b) => b.item_no === i.item_no);
                        const p = boxProgress(mine);
                        const dropped = i.status === "DROPPED";
                        return (
                          <tr key={i.item_no} onClick={() => onItem(i.item_no === item ? null : i.item_no)}
                            onKeyDown={(e) => { if (e.key === "Enter") onItem(i.item_no); }} tabIndex={0}
                            aria-selected={i.item_no === item}
                            className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50",
                              i.item_no === item && "bg-brand-50/70", dropped && "opacity-60")}>
                            <td className="px-4 py-2">
                              <span className="block text-slate-800">{i.name}</span>
                              <span className="font-mono text-[11px] text-slate-400">{itemCode(i)} · {i.qty} pcs</span>
                              {dropped && <Badge tone="red" className="ml-2">{tr("dropped", "dikeluarkan")}</Badge>}
                            </td>
                            <td className="px-2 py-2"><BoxChips boxes={mine} /></td>
                            <td className="px-4 py-2">{dropped ? <span className="text-[11px] text-slate-400">—</span> : <BoxBar filled={p.filled} total={p.total || 6} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {chosen && (
              <ItemStudioDrawer itemNo={chosen.item_no} canEdit={canEdit} canMakeProduct={canMakeProduct}
                showProject={canOpenProject}
                onClose={() => onItem(null)} onChanged={() => { reloadDesign(); boxesChanged(); }}
                header={(i, complete) => i.status !== "DROPPED" && (
                  <AssignmentLine scope="item" refNo={i.item_no} assignment={taskFor(i.item_no)}
                    complete={complete} canEdit={canEdit} onChanged={reloadTasks} compact />
                )} />
            )}
          </>
        );
      }}
    </Loaded>
  );
}

