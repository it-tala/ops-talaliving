"use client";

import { useState } from "react";
import { Truck, AlertTriangle, PackageCheck, Paperclip } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/cn";
import { delivery } from "@/demo/api";
import { DELIVERY_STATUS_LABEL, type DeliveryStatus, type FulfilmentView } from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { officeToday } from "@/lib/office";

const TONE: Record<DeliveryStatus, "slate" | "amber" | "green" | "red"> = {
  DRAFT: "slate", IN_TRANSIT: "amber", ARRIVED: "green", CANCELLED: "red",
};

/** What has left the yard, and what is ready to.
 *
 *  The screen opens with the half nobody can see from the production board:
 *  **made and still here**. A workshop knows what it has finished; what it
 *  loses is which finished thing is still standing in the corner three weeks
 *  after the client expected it.
 *
 *  A consignment refuses to promise more than exists (D210), and marking one
 *  arrived needs a name and the signed surat jalan — the same two halves
 *  receiving already requires (D101), for the same reason: three weeks later
 *  the argument is settled by whichever one exists.
 */
export default function DeliveryPage() {
  const { can } = useSession();
  const [ful, reloadFul] = useLoad(() => delivery.listFulfilment(), []);
  const [rows, reload] = useLoad(() => delivery.listDeliveries(), []);
  const [open, setOpen] = useState<FulfilmentView | null>(null);
  const mayEdit = can("project.update");

  function refresh() { reloadFul(); reload(); }

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Pengiriman"
        description="Yang sudah jadi dan masih di sini, yang sedang di jalan, dan yang sudah ditandatangani di lokasi. Surat jalan untuk barang yang belum jadi ditolak — janji seperti itu ketahuannya di lokasi."
      />

      <Loaded state={ful} onRetry={reloadFul}>
        {(all) => {
          const ready = all.filter((f) => f.lines.some((l) => (l.ready_to_ship ?? 0) > 0));
          if (ready.length === 0) return <></>;
          return (
            <Card className="mb-4">
              <CardHeader
                title="Siap kirim"
                subtitle="Sudah lewat gergaji sampai packing, belum naik truk. Angka ini tidak ada di papan produksi karena papan produksi berhenti di 'selesai'."
                icon={PackageCheck}
                action={<SourceBadge state={ful} />}
              />
              <ul className="divide-y divide-slate-100">
                {ready.map((f) => (
                  <li key={f.project_code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <span className="min-w-[180px] flex-1">
                      <span className="block text-[13px] font-medium text-slate-800">{f.project_name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {f.client_name} · {f.location ?? "lokasi belum dicatat"}
                      </span>
                    </span>
                    <span className="text-[12px] text-slate-600">
                      {f.lines.filter((l) => (l.ready_to_ship ?? 0) > 0).map((l) => (
                        <span key={l.project_line_id} className="mr-3 whitespace-nowrap">
                          {l.ready_to_ship} {l.uom} · {l.description.slice(0, 30)}
                        </span>
                      ))}
                    </span>
                    {mayEdit && (
                      <Button size="sm" variant="outline" icon={Truck} onClick={() => setOpen(f)}>
                        Buat surat jalan
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        }}
      </Loaded>

      <Loaded state={rows} onRetry={reload}>
        {(all) => (
          <Card>
            <CardHeader
              title={`${all.length} pengiriman`}
              subtitle="Terbaru di atas. Yang berangkat dan tidak pernah dicatat sampai ditandai — bukan karena truknya hilang, tapi karena tidak ada yang menulisnya."
              icon={Truck}
              action={<SourceBadge state={rows} />}
            />
            <Paged rows={all} pageSize={15} unit="pengiriman">
              {(page) => (
                <ul className="divide-y divide-slate-100">
                  {page.map((d) => (
                    <li key={d.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Badge tone={TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>
                        <span className="min-w-[180px] flex-1">
                          <span className="block text-[13px] font-medium text-slate-800">{d.project_name}</span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {d.delivery_no} · berangkat {d.dispatched_on}
                            {d.driver && ` · ${d.driver}`}
                            {d.vehicle && ` · ${d.vehicle}`}
                          </span>
                        </span>
                        <span className="text-[12px] text-slate-600">{d.lines.length} baris</span>
                        {d.received_by && (
                          <span className="text-[12px] text-slate-500">diterima {d.received_by}</span>
                        )}
                        {d.surat_jalan_attachment_id && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <Paperclip className="h-3 w-3" /> surat jalan
                          </span>
                        )}
                        {mayEdit && d.status === "IN_TRANSIT" && (
                          <ArriveButton deliveryNo={d.delivery_no} onDone={refresh} />
                        )}
                      </div>
                      <ul className="mt-1 space-y-0.5 pl-1">
                        {d.lines.map((l) => (
                          <li key={l.id} className="text-[12px] text-slate-600">
                            {l.qty} {l.uom} · {l.description}
                            {l.note && <span className="text-slate-400"> — {l.note}</span>}
                          </li>
                        ))}
                      </ul>
                      {d.warnings.map((w) => (
                        <p key={w} className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          </Card>
        )}
      </Loaded>

      {open && <DispatchDrawer project={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
    </div>
  );
}

function ArriveButton({ deliveryNo, onDone }: { deliveryNo: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [receiver, setReceiver] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await delivery.markArrived({
      delivery_no: deliveryNo,
      received_by: receiver,
      /* In Phase 1 the file is the demo's stand-in; the rule is that the call
         refuses without one, which is what is being demonstrated (D101). */
      surat_jalan_attachment_id: "att_60",
    });
    setBusy(false);
    if (res.error) { toast("warning", "Belum dicatat", res.error.message); return; }
    toast("success", "Tercatat sampai", `${deliveryNo} diterima ${receiver}`);
    setOpen(false); onDone();
  }

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Catat sampai</Button>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={receiver} onChange={(e) => setReceiver(e.target.value)}
        placeholder="Diterima siapa di lokasi?" aria-label="Penerima"
        className="h-8 w-56 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
      />
      <Button size="sm" disabled={busy || !receiver.trim()} onClick={submit}>Simpan</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
    </span>
  );
}

function DispatchDrawer({ project, onClose, onDone }: {
  project: FulfilmentView; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const shippable = project.lines.filter((l) => (l.ready_to_ship ?? 0) > 0 || l.made == null);

  async function submit() {
    const lines = Object.entries(qty)
      .filter(([, n]) => n > 0)
      .map(([project_line_id, n]) => ({ project_line_id, qty: n }));
    setBusy(true);
    const res = await delivery.createDelivery({
      project_code: project.project_code,
      dispatched_on: officeToday(),
      driver: driver || null, vehicle: vehicle || null, lines,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", "Tidak dibuat", res.error.message); return; }
    toast("success", `Surat jalan ${res.data.delivery_no}`, `${res.data.lines.length} baris berangkat`);
    onDone();
  }

  const total = Object.values(qty).reduce((a, n) => a + n, 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-slate-900">{project.project_name}</h2>
        <p className="mb-4 text-[12px] text-slate-500">{project.client_name} · {project.location ?? "lokasi belum dicatat"}</p>

        <ul className="mb-4 space-y-2">
          {shippable.map((l) => (
            <li key={l.project_line_id} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-[13px] text-slate-800">{l.description}</p>
              <p className="text-[11px] text-slate-500">
                dipesan {l.ordered} · {l.made == null
                  ? <span className="text-amber-700">tidak bisa dicocokkan ke SPK — jumlah siap kirim tidak diketahui</span>
                  : <>dibuat {l.made} · terkirim {l.delivered} · <strong className="text-slate-700">siap kirim {l.ready_to_ship}</strong></>}
              </p>
              <div className="mt-1 w-28">
                <NumberInput
                  value={qty[l.project_line_id] ?? 0}
                  onChange={(n) => setQty({ ...qty, [l.project_line_id]: n })}
                  max={l.ready_to_ship ?? undefined}
                />
              </div>
            </li>
          ))}
          {shippable.length === 0 && (
            <li className="text-[13px] text-slate-500">Tidak ada yang siap kirim di proyek ini.</li>
          )}
        </ul>

        <div className={cn("grid gap-2 sm:grid-cols-2")}>
          <label className="text-[11px] text-slate-500">
            Sopir
            <input value={driver} onChange={(e) => setDriver(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </label>
          <label className="text-[11px] text-slate-500">
            Kendaraan
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <Button disabled={busy || total === 0} onClick={submit}>
            {busy ? "Menyimpan…" : `Berangkatkan ${total}`}
          </Button>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </div>
  );
}
