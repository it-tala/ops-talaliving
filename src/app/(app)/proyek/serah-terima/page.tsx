"use client";

import { useState } from "react";
import { Stamp, AlertTriangle, Check, Paperclip } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { delivery } from "@/demo/api";
import { FULFILMENT_STAGE_LABEL, type FulfilmentView } from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { officeToday } from "@/lib/office";

/** Where every job actually stands, and the signature that ends one.
 *
 *  The board is the point. Four numbers per project — ordered, made,
 *  delivered, installed — which today are one guess, and the gaps between them
 *  are where a job quietly stops moving.
 *
 *  Two rules on the signature itself:
 *
 *  - it **refuses without the signed BAST** (D211). Every other refusal in
 *    this system is about money; this one is about a claim, because it says
 *    the client accepted the work and the client cannot correct our record;
 *  - handing over with open snags is **allowed and ordinary** — the client
 *    wants their house back — but the count and the list are frozen onto the
 *    record, so it can never read as though the list had been empty (D212).
 */
export default function HandoverPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => delivery.listFulfilment(), []);
  const [open, setOpen] = useState<FulfilmentView | null>(null);
  const mayHandover = can("project.handover");

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Serah terima"
        description="Dipesan, dibuat, dikirim, terpasang — empat angka per proyek, dan jarak di antaranya. Serah terima tanpa BAST yang ditandatangani ditolak."
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => (
          <div className="space-y-4">
            {all.map((f) => (
              <Card key={f.project_code}>
                <CardHeader
                  title={f.project_name}
                  subtitle={`${f.client_name ?? "—"} · ${f.location ?? "lokasi belum dicatat"}${
                    f.target_date ? ` · janji ${f.target_date}` : ""}`}
                  icon={Stamp}
                  action={
                    <div className="flex items-center gap-2">
                      <Badge tone={
                        f.stage === "handed_over" ? "green"
                          : f.stage === "installed" ? "brand"
                            : f.stage === "in_production" ? "slate" : "amber"
                      }>
                        {FULFILMENT_STAGE_LABEL[f.stage]}
                      </Badge>
                      {f.days_to_target != null && f.stage !== "handed_over" && (
                        <Badge tone={f.days_to_target < 0 ? "red" : f.days_to_target < 14 ? "amber" : "slate"}>
                          {f.days_to_target < 0 ? `lewat ${-f.days_to_target} hari` : `${f.days_to_target} hari lagi`}
                        </Badge>
                      )}
                    </div>
                  }
                />

                {/* Below `sm` the five columns live in a horizontal scroller,
                    which technically works and loses the entire argument: the
                    point of this screen is the **gaps between** ordered, made,
                    despatched, arrived and installed, and a phone showed only
                    the first of them (F65). So narrow screens get a stacked
                    card where all five sit in one row of their own. */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {f.lines.map((l) => (
                    <li key={l.project_line_id} className="px-4 py-3">
                      <p className="text-[13px] text-slate-800">{l.description}</p>
                      {l.is_service ? (
                        <p className="text-[11px] text-slate-400">
                          jasa — tidak ada barang yang dibuat atau dikirim
                        </p>
                      ) : (
                        <dl className="mt-1.5 grid grid-cols-5 gap-1 text-center">
                          {([
                            ["Pesan", String(l.ordered)],
                            ["Buat", l.made == null ? "?" : String(l.made)],
                            ["Jalan", String(l.delivered)],
                            ["Sampai", String(l.arrived)],
                            ["Pasang", String(l.installed)],
                          ] as [string, string][]).map(([k, v], i) => (
                            <div key={k} className={cn(
                              "rounded-lg py-1",
                              i === 4 && l.installed >= l.ordered ? "bg-emerald-50" : "bg-slate-50",
                            )}>
                              <dt className="text-[9px] uppercase tracking-wide text-slate-400">{k}</dt>
                              <dd className={cn(
                                "text-[13px] font-semibold tabular-nums",
                                v === "?" ? "text-slate-300"
                                  : i === 4 && l.installed >= l.ordered ? "text-emerald-700" : "text-slate-800",
                              )}>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[720px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 text-left">Yang dipesan klien</th>
                        <th className="px-4 py-2 text-right">Dipesan</th>
                        <th className="px-4 py-2 text-right">Dibuat</th>
                        <th className="px-4 py-2 text-right">Berangkat</th>
                        <th className="px-4 py-2 text-right">Sampai</th>
                        <th className="px-4 py-2 text-right">Terpasang</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.lines.map((l) => (
                        <tr key={l.project_line_id} className="border-b border-slate-100">
                          <td className="px-4 py-2">
                            <span className="block text-slate-800">{l.description}</span>
                            {l.is_service && (
                              <span className="block text-[11px] text-slate-400">
                                jasa — tidak ada barang yang dibuat atau dikirim
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {l.ordered} <span className="text-[11px] text-slate-400">{l.uom}</span>
                          </td>
                          <td className={cn("px-4 py-2 text-right tabular-nums",
                            l.made == null ? "text-slate-300" : l.made > l.ordered ? "font-medium text-amber-700" : "text-slate-700")}>
                            {l.is_service ? "—" : l.made == null ? "?" : l.made}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {l.is_service ? "—" : l.delivered}
                          </td>
                          <td className={cn("px-4 py-2 text-right tabular-nums",
                            !l.is_service && l.arrived < l.delivered ? "text-amber-700" : "text-slate-700")}>
                            {l.is_service ? "—" : l.arrived}
                          </td>
                          <td className={cn("px-4 py-2 text-right tabular-nums",
                            !l.is_service && l.installed >= l.ordered ? "font-semibold text-emerald-700" : "text-slate-700")}>
                            {l.is_service ? "—" : l.installed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-[12px]">
                  <span className="text-slate-600">
                    {f.installed_percent == null ? "belum ada yang bisa dihitung" : `${f.installed_percent}% terpasang`}
                  </span>
                  {f.open_snags > 0 && (
                    <span className={f.major_snags > 0 ? "text-rose-700" : "text-amber-800"}>
                      {f.open_snags} temuan terbuka{f.major_snags > 0 && `, ${f.major_snags} berat`}
                    </span>
                  )}
                  {f.in_transit > 0 && <span className="text-amber-800">{f.in_transit} kiriman masih di jalan</span>}

                  {f.handover ? (
                    <span className="ml-auto flex flex-wrap items-center gap-2 text-slate-700">
                      <Check className="h-4 w-4 text-emerald-600" />
                      <span className="font-mono text-[11px]">{f.handover.handover_no}</span>
                      <span>{f.handover.handed_on} · {f.handover.client_rep}</span>
                      <Paperclip className="h-3 w-3 text-slate-400" />
                      {f.handover.open_snags_at_handover > 0 && (
                        <Badge tone="amber">
                          ditandatangani dengan {f.handover.open_snags_at_handover} catatan
                        </Badge>
                      )}
                    </span>
                  ) : mayHandover ? (
                    <Button size="sm" className="ml-auto" icon={Stamp} onClick={() => setOpen(f)}>
                      Serah terima
                    </Button>
                  ) : null}
                </div>

                {f.warnings.length > 0 && (
                  <ul className="border-t border-slate-100 bg-amber-50/60 px-4 py-2">
                    {f.warnings.map((w) => (
                      <li key={w} className="flex items-start gap-1.5 text-[11px] text-amber-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}
                      </li>
                    ))}
                  </ul>
                )}

                {f.handover?.open_snag_nos.length ? (
                  <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                    Catatan yang terbuka saat ditandatangani:{" "}
                    <span className="font-mono">{f.handover.open_snag_nos.join(" · ")}</span>. Dibekukan
                    pada tanggal itu — kalau sekarang sudah beres, yang berubah adalah temuannya, bukan
                    berita acaranya.
                  </p>
                ) : null}
              </Card>
            ))}
            {all.length === 0 && (
              <Card><div className="px-5 py-8 text-[13px] text-slate-500">Belum ada proyek klien yang aktif.</div></Card>
            )}
          </div>
        )}
      </Loaded>

      {open && <HandoverDrawer project={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function HandoverDrawer({ project, onClose, onDone }: {
  project: FulfilmentView; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [clientRep, setClientRep] = useState("");
  const [ourRep, setOurRep] = useState("");
  const [attached, setAttached] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await delivery.recordHandover({
      project_code: project.project_code,
      handed_on: officeToday(),
      client_rep: clientRep, our_rep: ourRep,
      /* The demo's stand-in file. What is being demonstrated is that the call
         refuses without one at all (D211). */
      bast_attachment_id: attached ? "att_68" : "",
      note: note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", "Tidak dicatat", res.error.message); return; }
    toast("success", "Serah terima tercatat", `${project.project_name} · ${project.open_snags} catatan terbuka dibekukan`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-slate-900">Serah terima — {project.project_name}</h2>
        <p className="mb-4 text-[12px] text-slate-500">
          {project.installed_qty} dari {project.ordered_qty} unit terpasang
        </p>

        {project.open_snags > 0 && (
          <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{project.open_snags} temuan masih terbuka</strong>
              {project.major_snags > 0 && `, ${project.major_snags} di antaranya berat`}. Menyerahkan
              dengan catatan terbuka itu wajar — klien ingin rumahnya kembali. Yang dicatat adalah
              jumlah dan nomornya, supaya berita acara ini tidak pernah bisa dibaca seolah daftarnya
              kosong.
            </span>
          </p>
        )}

        <div className="space-y-3">
          <label className="block text-[12px] text-slate-500">
            Yang tanda tangan dari klien
            <input value={clientRep} onChange={(e) => setClientRep(e.target.value)}
              placeholder="Nama dan jabatan, seperti di kertasnya"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </label>
          <label className="block text-[12px] text-slate-500">
            Yang tanda tangan dari kita
            <input value={ourRep} onChange={(e) => setOurRep(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-700">
            <input type="checkbox" checked={attached} onChange={(e) => setAttached(e.target.checked)} className="mt-0.5" />
            <span>
              BAST yang sudah ditandatangani dilampirkan
              <span className="block text-[11px] text-slate-500">
                Tanpa ini permintaannya ditolak. Serah terima tanpa dokumennya adalah klaim bahwa
                klien menerima pekerjaan — dan klien satu-satunya pihak yang tidak bisa mengoreksi
                catatan kita.
              </span>
            </span>
          </label>

          <label className="block text-[12px] text-slate-500">
            Catatan
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </label>

          <div className="flex gap-2 pt-1">
            <Button disabled={busy || !clientRep.trim() || !ourRep.trim()} onClick={submit}>
              {busy ? "Menyimpan…" : "Catat serah terima"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Batal</Button>
          </div>
          <p className="text-[11px] text-slate-500">
            Tombolnya tetap aktif tanpa centang BAST, dan permintaannya akan ditolak. Penolakan yang
            terlihat lebih berguna daripada tombol mati yang tidak menjelaskan apa-apa.
          </p>
        </div>
      </div>
    </div>
  );
}
