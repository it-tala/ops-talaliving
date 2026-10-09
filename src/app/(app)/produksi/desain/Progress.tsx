"use client";

import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { design } from "@/demo/api";
import { DESIGN_BOXES, boxProgress, type DesignBox, type DesignProject } from "@/services/design/contracts";
import { BoxBar } from "@/components/design/item-boxes";
import { useTr } from "@/lib/i18n";
import type { RoomRef } from "./Workspace";

/** Progres: every project and room, filled boxes over all, and what is still
 *  empty by kind of box — read from the boxes, never typed (A3, S1). Who is
 *  drawing each room and by when arrives with S2's tasks. */
export function Progress({ onOpenRoom }: { onOpenRoom: (r: RoomRef) => void }) {
  const tr = useTr();
  const [projects, reloadProjects] = useLoad(() => design.listDesignProjects(), []);
  const [boxes, reloadBoxes] = useLoad(() => design.listDesignBoxes({}), []);
  const reload = () => { reloadProjects(); reloadBoxes(); };

  return (
    <Loaded state={projects} onRetry={reload}>
      {(ps) => (
        <Loaded state={boxes} onRetry={reload}>
          {(all) => {
            const withDesign = ps.filter((p) => all.some((b) => b.project_code === p.project_code));
            if (withDesign.length === 0) {
              return (
                <Card className="px-5 py-10 text-center text-[13px] text-slate-500">
                  {tr("No design items yet. Add them in the Workspace tab: a collection, its rooms, then the items.",
                    "Belum ada item desain. Tambahkan di tab Ruang kerja: koleksi, ruangannya, lalu itemnya.")}
                </Card>
              );
            }
            return (
              <div className="space-y-4">
                {withDesign.map((p) => (
                  <ProjectCard key={p.project_code} p={p} boxes={all.filter((b) => b.project_code === p.project_code)} onOpenRoom={onOpenRoom} />
                ))}
              </div>
            );
          }}
        </Loaded>
      )}
    </Loaded>
  );
}

function ProjectCard({ p, boxes, onOpenRoom }: { p: DesignProject; boxes: DesignBox[]; onOpenRoom: (r: RoomRef) => void }) {
  const tr = useTr();
  const total = boxProgress(boxes);
  const rooms = new Map<string, DesignBox[]>();
  for (const b of boxes) {
    const k = `${b.collection_code}|${b.room_code}`;
    rooms.set(k, [...(rooms.get(k) ?? []), b]);
  }
  const ordered = [...rooms.entries()].sort(([, a], [, b]) =>
    a[0].collection_code.localeCompare(b[0].collection_code) || a[0].room_sort - b[0].room_sort || a[0].room_code.localeCompare(b[0].room_code));

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
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-1.5 text-left">{tr("Room", "Ruangan")}</th>
              <th className="px-2 py-1.5 text-right">{tr("Items", "Item")}</th>
              <th className="px-2 py-1.5 text-left">{tr("Progress", "Progres")}</th>
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
              return (
                <tr key={k} tabIndex={0}
                  onClick={() => onOpenRoom({ project: p.project_code, collection: head.collection_code, room: head.room_code })}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenRoom({ project: p.project_code, collection: head.collection_code, room: head.room_code }); }}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className="block text-slate-800">{head.room_name}</span>
                    <span className="text-[11px] text-slate-400">{head.collection_code} · {head.collection_name}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{items}</td>
                  <td className="px-2 py-2">{prog.total ? <BoxBar filled={prog.filled} total={prog.total} /> : <span className="text-[11px] text-slate-400">—</span>}</td>
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
        </table>
      </div>
    </Card>
  );
}
