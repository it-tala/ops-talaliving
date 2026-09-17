"use client";

import { useState } from "react";
import { Wrench, AlertTriangle, ClipboardList, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { NumberInput } from "@/components/ui/number-input";
import { delivery } from "@/demo/api";
import {
  INSTALLATION_STATUS_LABEL, SNAG_SEVERITY_LABEL,
  type FulfilmentView, type SnagSeverity,
} from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { officeToday } from "@/lib/office";

/** Fitting on site, and what fitting it found.
 *
 *  Two records, deliberately apart. A **visit** is a day and a crew; a **snag**
 *  outlives the visit that found it — raised on one day, fixed on another, and
 *  the gap between those dates is what a client remembers about us (D209).
 *
 *  The refusal here is the expensive one to get wrong: you cannot fit more than
 *  arrived (D210). A crew standing in a house with nothing to fit costs a day;
 *  a record saying they fitted it costs the handover.
 */
export default function InstallationPage() {
  const { can } = useSession();
  const [ful, reloadFul] = useLoad(() => delivery.listFulfilment(), []);
  const [visits, reloadVisits] = useLoad(() => delivery.listInstallations(), []);
  const [snags, reloadSnags] = useLoad(() => delivery.listSnags(), []);
  const [open, setOpen] = useState<FulfilmentView | null>(null);
  const mayEdit = can("project.update");

  function refresh() { reloadFul(); reloadVisits(); reloadSnags(); }

  return (
    <div>
      <PageHeader
        breadcrumb="Projects"
        title="Instalasi"
        description="Yang sudah sampai di lokasi tapi belum terpasang, kunjungan yang sudah dikerjakan, dan temuan yang masih terbuka. Memasang lebih banyak dari yang terkirim ditolak."
      />

      <Loaded state={ful} onRetry={reloadFul}>
        {(all) => {
          const waiting = all.filter((f) => f.lines.some((l) => l.on_site > 0));
          if (waiting.length === 0) return <></>;
          return (
            <Card className="mb-4">
              <CardHeader
                title="Di lokasi, belum terpasang"
                subtitle="Barang yang sudah diterima di site dan masih berdiri di sana. Ini angka yang biasanya cuma ada di kepala mandor."
                icon={ClipboardList}
                action={<SourceBadge state={ful} />}
              />
              <ul className="divide-y divide-slate-100">
                {waiting.map((f) => (
                  <li key={f.project_code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <span className="min-w-[180px] flex-1">
                      <span className="block text-[13px] font-medium text-slate-800">{f.project_name}</span>
                      <span className="block text-[11px] text-slate-400">{f.location ?? "lokasi belum dicatat"}</span>
                    </span>
                    <span className="text-[12px] text-slate-600">
                      {f.lines.filter((l) => l.on_site > 0).map((l) => (
                        <span key={l.project_line_id} className="mr-3 whitespace-nowrap">
                          {l.on_site} {l.uom} · {l.description.slice(0, 30)}
                        </span>
                      ))}
                    </span>
                    {mayEdit && (
                      <Button size="sm" variant="outline" icon={Wrench} onClick={() => setOpen(f)}>
                        Catat pemasangan
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        }}
      </Loaded>

      <div className="grid gap-4 lg:grid-cols-2">
        <Loaded state={visits} onRetry={reloadVisits}>
          {(all) => (
            <Card>
              <CardHeader
                title={`${all.length} kunjungan`}
                subtitle="Satu hari, satu tim, dan apa yang terpasang hari itu."
                icon={Wrench}
                action={<SourceBadge state={visits} />}
              />
              <Paged rows={all} pageSize={10} unit="kunjungan">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((v) => (
                      <li key={v.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge tone={v.status === "DONE" ? "green" : v.status === "SCHEDULED" ? "amber" : "red"}>
                            {INSTALLATION_STATUS_LABEL[v.status]}
                          </Badge>
                          <span className="text-[13px] font-medium text-slate-800">{v.project_name}</span>
                          <span className="font-mono text-[10px] text-slate-400">{v.install_no} · {v.visit_date}</span>
                          {v.crew && <span className="text-[11px] text-slate-500">{v.crew}</span>}
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {v.lines.map((l) => (
                            <li key={l.id} className="text-[12px] text-slate-600">
                              {l.qty} {l.uom} · {l.description}
                              {l.note && <span className="text-slate-400"> — {l.note}</span>}
                            </li>
                          ))}
                          {v.lines.length === 0 && (
                            <li className="text-[12px] text-slate-400">Belum ada barang tercatat terpasang.</li>
                          )}
                        </ul>
                        {v.note && <p className="mt-0.5 text-[11px] text-slate-500">{v.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Paged>
            </Card>
          )}
        </Loaded>

        <Loaded state={snags} onRetry={reloadSnags}>
          {(all) => {
            const open_ = all.filter((s) => s.status === "OPEN");
            const major = open_.filter((s) => s.severity === "major");
            return (
              <Card>
                <CardHeader
                  title={`${open_.length} temuan terbuka`}
                  subtitle={major.length > 0
                    ? `${major.length} di antaranya berat — itu yang menahan serah terima.`
                    : "Temuan hidup lebih lama dari kunjungan yang menemukannya; umurnya dihitung di sini."}
                  icon={AlertTriangle}
                  action={<SourceBadge state={snags} />}
                />
                <Paged rows={all} pageSize={12} unit="temuan">
                  {(page) => (
                    <ul className="divide-y divide-slate-100">
                      {page.map((s) => (
                        <li key={s.id} className="px-5 py-2.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge tone={s.status === "FIXED" ? "green" : s.severity === "major" ? "red" : "amber"}>
                              {s.status === "FIXED" ? "Selesai" : SNAG_SEVERITY_LABEL[s.severity]}
                            </Badge>
                            <span className="font-mono text-[10px] text-slate-400">{s.snag_no}</span>
                            <span className="text-[11px] text-slate-500">{s.project_name}</span>
                            <span className="ml-auto text-[11px] text-slate-400">
                              {s.status === "FIXED"
                                ? `ditutup dalam ${s.age_days} hari`
                                : `terbuka ${s.age_days} hari`}
                            </span>
                          </div>
                          <p className="text-[12px] text-slate-700">{s.description}</p>
                          <p className="text-[11px] text-slate-400">
                            dilaporkan {s.raised_by}, {s.raised_on}
                            {s.line_description && ` · ${s.line_description}`}
                          </p>
                          {s.fix_note && <p className="text-[11px] text-emerald-700">{s.fix_note}</p>}
                          {mayEdit && s.status === "OPEN" && (
                            <CloseSnag snagNo={s.snag_no} onDone={refresh} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Paged>
              </Card>
            );
          }}
        </Loaded>
      </div>

      {open && <VisitDrawer project={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
    </div>
  );
}

function CloseSnag({ snagNo, onDone }: { snagNo: string; onDone: () => void }) {
  const { toast } = useToast();
  const [on, setOn] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await delivery.closeSnag({ snag_no: snagNo, fixed_by: "", fix_note: note });
    setBusy(false);
    if (res.error) { toast("warning", "Belum ditutup", res.error.message); return; }
    toast("success", "Temuan ditutup", snagNo);
    setOn(false); onDone();
  }

  if (!on) return <Button size="sm" variant="ghost" icon={Check} onClick={() => setOn(true)}>Tutup</Button>;
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <input
        value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Apa yang dikerjakan?" aria-label="Keterangan perbaikan"
        className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none"
      />
      <Button size="sm" disabled={busy || !note.trim()} onClick={submit}>Simpan</Button>
      <Button size="sm" variant="ghost" onClick={() => setOn(false)}>Batal</Button>
    </span>
  );
}

function VisitDrawer({ project, onClose, onDone }: {
  project: FulfilmentView; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [crew, setCrew] = useState("");
  const [snagText, setSnagText] = useState("");
  const [severity, setSeverity] = useState<SnagSeverity>("minor");
  const [raisedBy, setRaisedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const fittable = project.lines.filter((l) => l.on_site > 0);

  async function submit() {
    const lines = Object.entries(qty).filter(([, n]) => n > 0)
      .map(([project_line_id, n]) => ({ project_line_id, qty: n }));
    setBusy(true);
    const res = await delivery.recordInstallation({
      project_code: project.project_code,
      visit_date: officeToday(),
      crew: crew || null, lines,
    });
    if (res.error) {
      setBusy(false);
      toast(res.error.status === 409 ? "critical" : "warning", "Tidak dicatat", res.error.message);
      return;
    }
    if (snagText.trim()) {
      await delivery.raiseSnag({
        project_code: project.project_code,
        raised_by: raisedBy || crew || "Tim pemasangan",
        description: snagText, severity,
      });
    }
    setBusy(false);
    toast("success", `Kunjungan ${res.data.install_no}`, `${res.data.total_qty} unit terpasang`);
    onDone();
  }

  const total = Object.values(qty).reduce((a, n) => a + n, 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-slate-900">{project.project_name}</h2>
        <p className="mb-4 text-[12px] text-slate-500">{project.location ?? "lokasi belum dicatat"}</p>

        <ul className="mb-4 space-y-2">
          {fittable.map((l) => (
            <li key={l.project_line_id} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-[13px] text-slate-800">{l.description}</p>
              <p className="text-[11px] text-slate-500">
                berangkat {l.delivered} · sampai {l.arrived} · terpasang {l.installed} ·{" "}
                <strong className="text-slate-700">di lokasi {l.on_site}</strong>
              </p>
              <div className="mt-1 w-28">
                <NumberInput
                  value={qty[l.project_line_id] ?? 0}
                  onChange={(n) => setQty({ ...qty, [l.project_line_id]: n })}
                  max={l.on_site}
                />
              </div>
            </li>
          ))}
          {fittable.length === 0 && (
            <li className="text-[13px] text-slate-500">Tidak ada barang di lokasi yang menunggu dipasang.</li>
          )}
        </ul>

        <label className="block text-[11px] text-slate-500">
          Tim yang datang
          <input value={crew} onChange={(e) => setCrew(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <p className="text-[12px] font-medium text-slate-700">Ada temuan? (boleh dikosongkan)</p>
          <input
            value={snagText} onChange={(e) => setSnagText(e.target.value)}
            placeholder="Apa yang salah, sedetail yang bisa diperbaiki orang lain"
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {(["minor", "major"] as SnagSeverity[]).map((sv) => (
              <Button key={sv} size="sm" variant={severity === sv ? "primary" : "outline"} onClick={() => setSeverity(sv)}>
                {SNAG_SEVERITY_LABEL[sv]}
              </Button>
            ))}
            <input
              value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)}
              placeholder="Ditemukan siapa"
              className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Temuan tercatat terpisah dari kunjungannya: ia ditutup di hari yang lain, dan jarak
            antara dua tanggal itu yang diingat klien.
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <Button disabled={busy || total === 0} onClick={submit}>
            {busy ? "Menyimpan…" : `Catat ${total} unit terpasang`}
          </Button>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </div>
  );
}
