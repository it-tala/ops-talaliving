"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import type { ClientView } from "@/services/procurement/contracts";
import { useCanSell } from "@/lib/sell";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One client, created or corrected — used by the client master and, inline,
 *  by the project form's *Klien baru*. */
const inputCls = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50";

export function ClientDrawer({
  client, onClose, onSaved,
}: {
  client: ClientView | null;
  onClose: () => void;
  onSaved: (c: ClientView) => void;
}) {
  const tr = useTr();
  const canSell = useCanSell();
  const { toast } = useToast();
  const mayEdit = client ? canSell() : canSell("create");
  const [f, setF] = useState({
    name: client?.name ?? "", contact_name: client?.contact_name ?? "", phone: client?.phone ?? "",
    email: client?.email ?? "", address: client?.address ?? "", npwp: client?.npwp ?? "", note: client?.note ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await procurement.saveClient({ code: client?.code ?? null, ...f });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", client ? tr("Client updated", "Klien diperbarui") : tr("Client created", "Klien dibuat"), `${res.data.code} · ${res.data.name}`);
    onSaved(res.data);
  }
  async function archive(archived: boolean) {
    if (!client) return;
    setBusy(true);
    const res = await procurement.archiveClient({ code: client.code, archived });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success", archived ? tr("Client archived", "Klien diarsipkan") : tr("Client restored", "Klien dipulihkan"), client.name);
    onSaved(res.data);
  }

  const field = (key: keyof typeof f, label: string, placeholder?: string) => (
    <label className="block text-xs text-slate-500">{label}
      <input
        value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}
        placeholder={placeholder} disabled={!mayEdit} className={inputCls}
      />
    </label>
  );

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={client ? client.name : tr("New client", "Klien baru")}
      subtitle={client ? tr(`${client.code} · ${client.project_count} projects`, `${client.code} · ${client.project_count} proyek`) : tr("The code is generated automatically.", "Kodenya dibuat otomatis.")}
      footer={mayEdit ? (
        <div className="flex items-center gap-2">
          {client && (
            <Button variant="ghost" icon={client.archived_at ? ArchiveRestore : Archive} disabled={busy}
              onClick={() => archive(!client.archived_at)}>
              {client.archived_at ? tr("Restore", "Pulihkan") : tr("Archive", "Arsipkan")}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !f.name.trim()}>{tr("Save", "Simpan")}</Button>
        </div>
      ) : undefined}
    >
      <div className={cn("space-y-3", !mayEdit && "opacity-90")}>
        {field("name", tr("Client name", "Nama klien"), tr("e.g. PT Baby Island Resort", "mis. PT Baby Island Resort"))}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("contact_name", tr("Contact", "Kontak"), tr("name of the person to contact", "nama orang yang dihubungi"))}
          {field("phone", tr("Phone / WA", "Telepon / WA"))}
        </div>
        {field("email", "Email")}
        {field("address", tr("Address", "Alamat"))}
        {field("npwp", "NPWP")}
        {field("note", tr("Note", "Catatan"))}
        {client?.archived_at && (
          <p className="text-[12px] text-slate-500">
            {tr("Archived — no longer offered when creating a project, but its old projects still name this client.", "Diarsipkan — tidak ditawarkan lagi saat membuat proyek, tapi proyek lamanya tetap menyebut klien ini.")}
          </p>
        )}
      </div>
    </Drawer>
  );
}
