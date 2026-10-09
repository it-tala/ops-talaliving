"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PencilRuler } from "lucide-react";
import { hr } from "@/demo/api";
import { isDesignTask, type DesignTaskProgress, type TaskRefKind } from "@/services/hr/contracts";
import { useTr } from "@/lib/i18n";

/** Filled / total boxes for every design task the viewer may see, read once
 *  per list (0250). HRD monitors (D402): the progress comes to the task list
 *  rather than HRD going to the design. */
export function useDesignProgress(refresh: unknown): Map<string, DesignTaskProgress> {
  const [map, setMap] = useState<Map<string, DesignTaskProgress>>(new Map());
  useEffect(() => {
    let live = true;
    void hr.listDesignTaskProgress().then((r) => {
      if (live) setMap(new Map((r.data ?? []).map((p) => [p.task_no, p])));
    });
    return () => { live = false; };
  }, [refresh]);
  return map;
}

/** A design task's line: its boxes, that it closes itself, and the way to it. */
export function DesignTaskNote({
  t, progress,
}: { t: { task_no: string; ref_kind: TaskRefKind; ref_no: string | null; status: string }; progress: Map<string, DesignTaskProgress> }) {
  const tr = useTr();
  if (!isDesignTask(t)) return null;
  const p = progress.get(t.task_no);
  const href = t.ref_kind === "design_room"
    ? `/produksi/desain?room=${encodeURIComponent(t.ref_no ?? "")}`
    : `/produksi/desain?item=${encodeURIComponent(t.ref_no ?? "")}`;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-slate-600">
      <PencilRuler className="h-3.5 w-3.5 text-slate-400" />
      {p && (
        <span className="tabular-nums">
          <b className="font-semibold text-slate-800">{p.filled}/{p.total}</b> {tr("boxes filled", "kotak terisi")}
        </span>
      )}
      {t.status === "OPEN" && <span className="text-slate-400">{tr("· closes itself when all are filled", "· selesai sendiri saat semua terisi")}</span>}
      <Link href={href} className="text-brand-700 hover:underline">{tr("Open in Design", "Buka di Desain")}</Link>
    </p>
  );
}
