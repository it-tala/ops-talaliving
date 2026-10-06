"use client";

import { useState } from "react";
import {
  BadgeCheck, CalendarClock, FileText, Flag, Hammer, Handshake, Layers, MessageSquare, PencilRuler, Send,
  Truck, Users, Wrench, XCircle,
} from "lucide-react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import { TIMELINE_LANES, type TimelineEvent, type TimelineKind } from "@/services/procurement/contracts";
import { useLang, useTr, type Message } from "@/lib/i18n";

const KIND: Record<TimelineKind, { icon: typeof Flag; tone: string; label: Message }> = {
  status: { icon: Flag, tone: "text-slate-600 bg-slate-100", label: { en: "Status", id: "Status" } },
  contact: { icon: MessageSquare, tone: "text-sky-700 bg-sky-50", label: { en: "Contact", id: "Kontak" } },
  meeting: { icon: Users, tone: "text-sky-700 bg-sky-50", label: { en: "Meeting", id: "Meeting" } },
  point_closed: { icon: BadgeCheck, tone: "text-emerald-700 bg-emerald-50", label: { en: "Done from a meeting", id: "Selesai dari meeting" } },
  quote_sent: { icon: Send, tone: "text-violet-700 bg-violet-50", label: { en: "Quotation sent", id: "Quotation dikirim" } },
  quote_accepted: { icon: Handshake, tone: "text-emerald-700 bg-emerald-50", label: { en: "Quotation accepted", id: "Quotation disetujui" } },
  quote_rejected: { icon: XCircle, tone: "text-rose-700 bg-rose-50", label: { en: "Quotation rejected", id: "Quotation ditolak" } },
  file: { icon: FileText, tone: "text-slate-600 bg-slate-100", label: { en: "File", id: "File" } },
  design_item: { icon: Layers, tone: "text-brand-700 bg-brand-50", label: { en: "Design item", id: "Item desain" } },
  design_dropped: { icon: XCircle, tone: "text-rose-700 bg-rose-50", label: { en: "Item dropped", id: "Item dikeluarkan" } },
  approval: { icon: BadgeCheck, tone: "text-emerald-700 bg-emerald-50", label: { en: "Client approval", id: "Persetujuan klien" } },
  drawing_released: { icon: PencilRuler, tone: "text-brand-700 bg-brand-50", label: { en: "Drawing released", id: "Gambar dirilis" } },
  job_order: { icon: Hammer, tone: "text-amber-700 bg-amber-50", label: { en: "Job Order", id: "Job Order" } },
  delivery: { icon: Truck, tone: "text-amber-700 bg-amber-50", label: { en: "Delivery", id: "Pengiriman" } },
  delivery_received: { icon: Truck, tone: "text-emerald-700 bg-emerald-50", label: { en: "Delivered", id: "Diterima" } },
  installation: { icon: Wrench, tone: "text-amber-700 bg-amber-50", label: { en: "Installation", id: "Pemasangan" } },
  handover: { icon: CalendarClock, tone: "text-emerald-700 bg-emerald-50", label: { en: "Handover (BAST)", id: "Serah terima (BAST)" } },
};

/* The kinds whose `ref` is a design item, worth showing beside the title. */
const ITEM_KINDS: TimelineKind[] = ["design_item", "design_dropped", "approval", "drawing_released", "point_closed"];

/** The time in the office's zone (Asia/Makassar, as `ops_core.office_day`). */
const officeTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Makassar", hour: "2-digit", minute: "2-digit" });

/** A project from its first contact to its handover, in one place (0229, P7):
 *  every record it is made of, side by side in time, with the day and the
 *  person. Nothing here is stored twice; each reader sees what their own
 *  access reads. */
export function ProjectTimeline({ projectCode }: { projectCode: string }) {
  const tr = useTr();
  const lang = useLang();
  const [state, reload] = useLoad(() => procurement.getProjectTimeline(projectCode), [projectCode]);
  const [lane, setLane] = useState<string>("all");
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
        {[{ code: "all", label: { en: "Everything", id: "Semua" } }, ...TIMELINE_LANES].map((l) => (
          <button key={l.code} onClick={() => setLane(l.code)}
            className={cn("rounded-full px-2.5 py-1 text-[12px]", lane === l.code ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            {tr(l.label.en, l.label.id)}
          </button>
        ))}
      </div>
      <Loaded state={state} onRetry={reload} skeletonRows={4}>
        {(all: TimelineEvent[]) => {
          const kinds = TIMELINE_LANES.find((l) => l.code === lane)?.kinds;
          const rows = kinds ? all.filter((e) => kinds.includes(e.kind)) : all;
          if (rows.length === 0) {
            return (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">
                {tr("Nothing recorded yet. Every call, quotation, file, approval, drawing and delivery appears here as it is recorded.",
                  "Belum ada catatan. Setiap telepon, quotation, file, persetujuan, gambar, dan pengiriman muncul di sini begitu dicatat.")}
              </p>
            );
          }
          const days = [...new Set(rows.map((e) => e.day))];
          return (
            <ol className="divide-y divide-slate-100">
              {days.map((d) => (
                <li key={d} className="px-4 py-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {new Date(`${d}T00:00:00`).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <ul className="space-y-1.5">
                    {rows.filter((e) => e.day === d).map((e, i) => {
                      const k = KIND[e.kind];
                      const Icon = k.icon;
                      return (
                        <li key={`${e.kind}-${e.ref}-${e.at}-${i}`} className="flex gap-2.5 text-[13px]">
                          <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", k.tone)}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-[11px] uppercase tracking-wide text-slate-400">{tr(k.label.en, k.label.id)}</span>
                            <span className="block text-slate-800">
                              {e.title}
                              {e.ref && ITEM_KINDS.includes(e.kind) && (
                                <span className="ml-1.5 font-mono text-[11px] text-slate-400">{e.ref}</span>
                              )}
                            </span>
                            {e.detail && <span className="block whitespace-pre-line text-[12px] text-slate-600">{e.detail}</span>}
                            {e.kind === "file" && e.ref && <span className="block font-mono text-[11px] text-slate-400">{e.ref}</span>}
                          </span>
                          <span className="shrink-0 text-right text-[11px] text-slate-400">
                            {e.actor_name ?? ""}
                            <span className="block">{officeTime(e.at)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          );
        }}
      </Loaded>
    </div>
  );
}
