"use client";

import { useState } from "react";
import { Pencil, Plus, Power, Save, UserCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { qc } from "@/demo/api";
import { cn } from "@/lib/cn";
import type { QcPerson } from "@/services/qc/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Field QC › Team (0261, O6).
 *
 *  The outsourced QC people: not staff, so not in HR. The coordinator keeps the
 *  list, links each person to the ops account they sign in with — which gives
 *  that account `qc: write` if it had nothing in QC — and switches people off
 *  with a reason rather than deleting them, so the evaluation (O9) still reads
 *  who was sent where. */

const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
interface Draft { code: string | null; name: string; phone: string; city: string; note: string; email: string }
const blank: Draft = { code: null, name: "", phone: "", city: "", note: "", email: "" };

export default function QcTeamPage() {
  const tr = useTr();
  const { can } = useSession();
  const coordinator = can("qc.coordinate");
  const [showInactive, setShowInactive] = useState(false);
  const [state, reload] = useLoad(() => qc.listQcPeople({ include_inactive: showInactive }), [showInactive]);
  const [editing, setEditing] = useState<Draft | null>(null);

  if (!coordinator) {
    return (
      <div>
        <PageHeader breadcrumb={tr("Field QC", "QC lapangan")} title={tr("QC team", "Tim QC")} />
        <Card><p className="px-4 py-6 text-[13px] text-slate-600">{tr("The QC team is kept by the QC coordinator.", "Tim QC dikelola koordinator QC.")}</p></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Field QC", "QC lapangan")}
        title={tr("QC team", "Tim QC")}
        description={tr(
          "The outsourced QC people. Link each to the ops account they sign in with from their phone — it then opens their assignments, and nothing else.",
          "Personel QC outsource. Tautkan masing-masing ke akun ops yang dipakainya dari HP — akun itu lalu membuka penugasannya, tidak lebih.")}
        actions={!editing && <Button icon={Plus} onClick={() => setEditing({ ...blank })}>{tr("Add a person", "Tambah personel")}</Button>}
      />

      {editing && <PersonForm draft={editing} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}

      <Card>
        <CardHeader
          title={tr("Team", "Tim")}
          icon={UserCheck}
          action={(
            <div className="flex items-center gap-2">
              <SourceBadge state={state} />
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                {tr("Show switched off", "Tampilkan yang nonaktif")}
              </label>
            </div>
          )}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-slate-500">{tr("Nobody on the team yet.", "Belum ada personel.")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => (
                <PersonRow key={p.id} p={p} onEdit={() => setEditing({
                  code: p.code, name: p.name, phone: p.phone ?? "", city: p.city ?? "", note: p.note ?? "", email: p.account_email ?? "",
                })} onChanged={reload} />
              ))}
            </ul>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function PersonRow({ p, onEdit, onChanged }: { p: QcPerson; onEdit: () => void; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [off, setOff] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function setActive(active: boolean) {
    setBusy(true);
    const res = await qc.setQcPersonActive({ code: p.code, active, reason: active ? null : reason.trim() });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast(res.data.warnings.length ? "warning" : "success", active ? tr(`${p.name} is back on`, `${p.name} aktif lagi`) : tr(`${p.name} switched off`, `${p.name} dinonaktifkan`),
      res.data.warnings.join(" "));
    setOff(false); setReason(""); onChanged();
  }

  return (
    <li className={cn("px-4 py-3 text-[13px]", !p.is_active && "bg-slate-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-slate-800">{p.name}</span>
        <span className="font-mono text-[11px] text-slate-400">{p.code}</span>
        {!p.is_active && <Badge tone="red">{tr("Switched off", "Nonaktif")}</Badge>}
        {p.active_assignments > 0 && <Badge tone="green">{tr(`${p.active_assignments} active`, `${p.active_assignments} berjalan`)}</Badge>}
        <span className="text-slate-600">{[p.city, p.phone].filter(Boolean).join(" · ")}</span>
        <span className="ml-auto text-[12px]">
          {p.account_email
            ? <span className="text-slate-600">{p.account_email}{p.account_qc_level && <span className="text-slate-400"> · qc {p.account_qc_level}</span>}</span>
            : <span className="text-amber-700">{tr("no account — cannot see assignments yet", "belum ada akun — belum bisa melihat penugasan")}</span>}
        </span>
      </div>
      {(p.note || p.inactive_reason) && (
        <p className="mt-0.5 text-[11px] text-slate-500">{[p.note, p.inactive_reason && `${tr("switched off", "nonaktif")}: ${p.inactive_reason}`].filter(Boolean).join(" · ")}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-brand-700">
          <Pencil className="h-3.5 w-3.5" /> {tr("Edit", "Ubah")}
        </button>
        {p.is_active ? (off ? (
          <>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={tr("why", "kenapa")}
              className="h-8 min-w-[12rem] rounded-lg border border-slate-200 px-2 text-[13px]" />
            <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => setActive(false)}>{tr("Switch off", "Nonaktifkan")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOff(false)}>{tr("Cancel", "Batal")}</Button>
          </>
        ) : (
          <button type="button" onClick={() => setOff(true)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-rose-700">
            <Power className="h-3.5 w-3.5" /> {tr("Switch off", "Nonaktifkan")}
          </button>
        )) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setActive(true)}>{tr("Switch back on", "Aktifkan lagi")}</Button>
        )}
      </div>
    </li>
  );
}

function PersonForm({ draft, onDone, onCancel }: { draft: Draft; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await qc.saveQcPerson({
      code: d.code, name: d.name, phone: d.phone || null, city: d.city || null, note: d.note || null, user_email: d.email.trim() || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", d.code ? tr("Saved", "Tersimpan") : tr(`${res.data.code} added`, `${res.data.code} ditambahkan`),
      res.data.granted_qc_write ? tr(`${res.data.account_email} can now open its QC assignments.`, `${res.data.account_email} sekarang bisa membuka penugasan QC-nya.`) : res.data.name);
    onDone();
  }

  return (
    <Card className="mb-4">
      <CardHeader title={d.code ? tr(`Edit ${d.code}`, `Ubah ${d.code}`) : tr("Add a person", "Tambah personel")} icon={UserCheck} />
      <div className="grid gap-2 px-4 pb-4 text-[13px] sm:grid-cols-2">
        {([
          ["name", tr("Name", "Nama")], ["phone", tr("Phone", "HP")], ["city", tr("City", "Kota")],
          ["email", tr("Ops account email (optional)", "Email akun ops (opsional)")],
        ] as const).map(([k, l]) => (
          <label key={k} className="block text-xs text-slate-500">{l}
            <input value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={cn(inputCls, "mt-1")}
              type={k === "email" ? "email" : "text"} />
          </label>
        ))}
        <label className="block text-xs text-slate-500 sm:col-span-2">{tr("Note", "Catatan")}
          <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} className={cn(inputCls, "mt-1")} />
        </label>
        <p className="text-[11px] text-slate-400 sm:col-span-2">
          {tr("The account must exist already — IT makes it. Linking it gives it QC access to its own assignments only.",
            "Akunnya harus sudah ada — dibuat IT. Menautkannya memberi akses QC ke penugasannya sendiri saja.")}
        </p>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !d.name.trim()}>{tr("Save", "Simpan")}</Button>
        </div>
      </div>
    </Card>
  );
}
