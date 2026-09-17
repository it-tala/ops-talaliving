"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, Printer, QrCode as QrIcon, AlertTriangle, Plus, Truck } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Drawer } from "@/components/ui/drawer";
import { NumberInput } from "@/components/ui/number-input";
import { QrCode } from "@/components/ui/qr";
import { cn } from "@/lib/cn";
import { delivery } from "@/demo/api";
import type { BoxStatus, BoxView } from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

const TONE: Record<BoxStatus, "slate" | "amber" | "green" | "red" | "violet"> = {
  PACKED: "slate", IN_TRANSIT: "amber", ON_SITE: "violet", INSTALLED: "green", PROBLEM: "red",
};

/** Peti, not lines (D262).
 *
 *  A delivery note says *2 set meja makan*; a lorry arrives with nine crates.
 *  Nobody on site can hold those two sentences together, so today the crew
 *  opens crates until it finds the one it needs, and a missing handle is
 *  discovered on the fitting day with a client standing there.
 *
 *  What this screen adds is one fact per crate that the delivery note cannot
 *  carry: **which room it is for**. Everything else — the code, the QR, the
 *  contents — exists to get that fact onto the outside of the box and back
 *  into the record when somebody scans it.
 */
export default function BoxesPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => delivery.listBoxes(), []);
  const [packing, setPacking] = useState(false);
  const mayEdit = can("project.update");

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Peti & label"
        description="Satu peti, satu kode, satu ruangan tujuan. Label dicetak dari sini, dan QR-nya langsung membuka peti itu — yang scan di lokasi adalah tim kita sendiri yang sudah punya login."
        actions={mayEdit ? (
          <Button icon={Plus} onClick={() => setPacking(true)}>Kemas peti</Button>
        ) : undefined}
      />

      <Loaded state={rows} onRetry={reload}>
        {(boxes) => {
          const problem = boxes.filter((b) => b.status === "PROBLEM");
          const waiting = boxes.filter((b) => b.delivery_id === null);
          const onDelivery = boxes.filter((b) => b.delivery_id !== null);
          const groups = new Map<string, BoxView[]>();
          for (const b of onDelivery) {
            const key = b.delivery_no ?? "—";
            groups.set(key, [...(groups.get(key) ?? []), b]);
          }

          return (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Peti tercatat" value={String(boxes.length)} icon={Package} />
                <StatCard label="Belum naik truk" value={String(waiting.length)} icon={Truck} />
                <StatCard
                  label="Belum di-scan"
                  value={String(boxes.filter((b) => b.scanned_at == null).length)}
                  icon={QrIcon}
                />
                <StatCard
                  label="Bermasalah"
                  value={String(problem.length)}
                  icon={AlertTriangle}
                  tone={problem.length > 0 ? "red" : "slate"}
                />
              </div>

              {problem.length > 0 && (
                <Card className="mb-4 border-rose-200">
                  <CardHeader
                    title="Peti bermasalah"
                    subtitle="Ditandai oleh orang yang memegang petinya di lokasi. Ini biasanya alasan satu hari pemasangan hilang."
                    icon={AlertTriangle}
                  />
                  <ul className="divide-y divide-slate-100">
                    {problem.map((b) => (
                      <li key={b.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/box/${encodeURIComponent(b.box_no)}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
                            {b.box_no}
                          </Link>
                          <span className="text-[12px] text-slate-500">{b.project_name} · {b.destination}</span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-rose-700">{b.problem_note}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {waiting.length > 0 && (
                <BoxGroup
                  title="Dikemas, belum ada truknya"
                  subtitle="Sudah berlabel dan tinggal diangkat. Ini yang biasanya ketinggalan di sudut workshop."
                  boxes={waiting}
                  state={rows}
                  printHref={`/proyek/peti/label?kode=${waiting.map((b) => b.box_no).join(",")}`}
                />
              )}

              {[...groups.entries()].map(([deliveryNo, list]) => (
                <BoxGroup
                  key={deliveryNo}
                  title={`Pengiriman ${deliveryNo}`}
                  subtitle={`${list.length} peti · ${list[0].project_name}`}
                  boxes={list}
                  state={rows}
                  printHref={`/proyek/peti/label?krm=${encodeURIComponent(deliveryNo)}`}
                />
              ))}

              {boxes.length === 0 && (
                <EmptyState
                  icon={Package}
                  title="Belum ada peti tercatat"
                  description="Pengiriman lama tidak punya peti — labelnya belum ada waktu itu. Itu celah di catatan, bukan truk kosong."
                />
              )}
            </>
          );
        }}
      </Loaded>

      {packing && <PackDrawer onClose={() => setPacking(false)} onDone={() => { setPacking(false); reload(); }} />}
    </div>
  );
}

function BoxGroup({
  title, subtitle, boxes, state, printHref,
}: {
  title: string; subtitle: string; boxes: BoxView[];
  state: Parameters<typeof SourceBadge>[0]["state"];
  printHref: string;
}) {
  return (
    <Card className="mb-4">
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={Package}
        action={
          <span className="flex items-center gap-2">
            <SourceBadge state={state} />
            <Link href={printHref}>
              <Button size="sm" variant="outline" icon={Printer}>Cetak label</Button>
            </Link>
          </span>
        }
      />
      <ul className="divide-y divide-slate-100">
        {boxes.map((b) => (
          <li key={b.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
            <QrCode path={`/box/${encodeURIComponent(b.box_no)}`} title={b.box_no} size={44} className="shrink-0 rounded ring-1 ring-slate-200" />
            <span className="min-w-[200px] flex-1">
              <Link href={`/box/${encodeURIComponent(b.box_no)}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
                {b.box_no}
              </Link>
              <span className="ml-2 text-[12px] text-slate-500">{b.position ?? "belum naik truk"}</span>
              <span className="block text-[13px] text-slate-800">{b.destination}</span>
              <span className="block text-[11px] text-slate-400">
                {b.lines.map((l) => `${l.qty} ${l.uom} ${l.description}`).join(" · ")}
              </span>
              {b.warnings.map((w) => (
                <span key={w} className="mt-0.5 block text-[11px] text-amber-700">{w}</span>
              ))}
            </span>
            <Badge tone={TONE[b.status]} dot>{b.status_label}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Packing one box ──────────────────────────────────────────────────── */

function PackDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [ful] = useLoad(() => delivery.listFulfilment(), []);
  const [projectCode, setProjectCode] = useState("");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => `pack-${Date.now()}`, []);

  const project = ful.status === "ready" ? ful.data.find((f) => f.project_code === projectCode) : undefined;

  async function submit() {
    const lines = (project?.lines ?? [])
      .filter((l) => (qty[l.project_line_id] ?? 0) > 0)
      .map((l) => ({
        project_line_id: l.project_line_id,
        description: l.description,
        qty: qty[l.project_line_id],
        uom: l.uom,
      }));
    setBusy(true);
    const res = await delivery.packBox({
      project_code: projectCode, destination, lines,
      note: note || null, idempotency_key: key,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", "Belum dikemas", res.error.message);
      return;
    }
    toast("success", `Peti ${res.data.box_no}`, `${res.data.piece_count} barang · ${res.data.destination}`);
    onDone();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Kemas satu peti"
      subtitle="Tujuannya di dalam gedung, bukan alamat proyek — itulah satu-satunya hal yang tidak bisa dibaca dari surat jalan."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : "Kemas & beri label"}</Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">Proyek</span>
          <select
            value={projectCode}
            onChange={(e) => { setProjectCode(e.target.value); setQty({}); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— pilih proyek —</option>
            {ful.status === "ready" && ful.data.map((f) => (
              <option key={f.project_code} value={f.project_code}>{f.project_code} · {f.project_name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">Tujuan di dalam gedung</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Lantai 2 — kamar tidur utama"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {project && (
          <div>
            <p className="mb-1 text-[12px] font-medium text-slate-600">Isi peti</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {project.lines.map((l) => (
                <li key={l.project_line_id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-[13px] text-slate-700">{l.description}</span>
                  <NumberInput
                    value={qty[l.project_line_id] ?? 0}
                    onChange={(n) => setQty((q) => ({ ...q, [l.project_line_id]: n }))}
                    className="w-20"
                  />
                  <span className="w-10 text-[11px] text-slate-400">{l.uom}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">Catatan di label (opsional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Jangan ditumpuk."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <p className={cn("rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500")}>
          Kode peti dibuat otomatis (<span className="font-mono">kol-…</span>). QR di label membuka halaman peti
          ini langsung dari kamera HP, dan kodenya tetap dicetak besar di bawahnya — kalau alamat sistem berubah,
          labelnya masih bisa diketik, tidak mati.
        </p>
      </div>
    </Drawer>
  );
}
