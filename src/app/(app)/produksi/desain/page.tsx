"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useSession } from "@/store/session";
import { useCanDesign } from "@/lib/sell";
import { useTr } from "@/lib/i18n";
import { Workspace, type RoomRef } from "./Workspace";
import { Progress } from "./Progress";

/** Design — the drafters' workspace (Studio Desain S1, D399–D405).
 *
 *  Every design item has six boxes: working drawing (PDF), DWG, render, item
 *  photo, specification, BOM. A box is filled by doing the work — an upload, a
 *  saved specification, a BOM — and progress is the count of filled boxes,
 *  never a percentage somebody typed. Uploading again is the next version and
 *  the latest is the one that counts; nothing is reviewed and nothing is
 *  required (D399, D401). It replaces the drawing queue (M30, P6), which waited
 *  for design items the drafters had no way to create (F247).
 *
 *  `?item=26003-A-LR-01` opens on an item, `?room=26003-A-LR` on a room (the
 *  link an HRD design task carries); `?tab=progress` on the progress. */
export default function DesignPage() {
  const tr = useTr();
  const { can } = useSession();
  const canDesign = useCanDesign();
  const [tab, setTab] = useState<"work" | "progress">("work");
  const [start, setStart] = useState<{ room?: RoomRef; item?: string }>({});
  const [ready, setReady] = useState(false);

  /* Read once on mount, as /produksi/bom reads `?open=`, rather than through
     `useSearchParams`, which would need a Suspense boundary. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const item = q.get("item");
    if (item) {
      const [project, collection, room] = item.split("-");
      setStart({ item, room: project && collection && room ? { project, collection, room } : undefined });
    }
    const room = q.get("room");
    if (!item && room) {
      const [project, collection, code] = room.split("-");
      if (project && collection && code) setStart({ room: { project, collection, room: code } });
    }
    if (q.get("tab") === "progress") setTab("progress");
    setReady(true);
  }, []);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Production", "Produksi")}
        title={tr("Design", "Desain")}
        description={tr(
          "Every design item has six boxes: working drawing, DWG, render, item photo, specification and BOM. Upload to fill a box; uploading again is the next version, and the latest is the one that counts. Progress is the count of filled boxes.",
          "Setiap item desain punya enam kotak: gambar kerja, DWG, render, foto item, spesifikasi, dan BOM. Unggah untuk mengisi kotak; unggah lagi menjadi versi berikutnya, dan yang berlaku versi terbaru. Progres adalah jumlah kotak yang terisi.",
        )}
      />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[13px]" role="tablist">
        {([["work", tr("Workspace", "Ruang kerja")], ["progress", tr("Progress", "Progres")]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-md px-3 py-1.5", tab === k ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100")}>
            {l}
          </button>
        ))}
      </div>

      {ready && !canDesign("read") ? (
        <Card className="px-5 py-10 text-center text-[13px] text-slate-500">
          {tr("Design is read by whoever sells (projects or marketing) and by the drafters (production). Ask IT for one of those.",
            "Desain dibaca oleh yang menjual (proyek atau marketing) dan oleh drafter (produksi). Minta salah satu akses itu ke IT.")}
        </Card>
      ) : ready && (tab === "work" ? (
        <Workspace start={start}
          canEdit={canDesign("update")}
          canMakeProduct={can("production.create")}
          canOpenProject={can("project.read") || can("marketing.read")} />
      ) : (
        <Progress onOpenRoom={(room) => { setStart({ room }); setTab("work"); }} />
      ))}
    </div>
  );
}
