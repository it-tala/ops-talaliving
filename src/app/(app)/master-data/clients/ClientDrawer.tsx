"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import type { ClientView } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

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
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = client ? can("project.update") : can("project.create");
  const [f, setF] = useState({
    name: client?.name ?? "", contact_name: client?.contact_name ?? "", phone: client?.phone ?? "",
    email: client?.email ?? "", address: client?.address ?? "", npwp: client?.npwp ?? "", note: client?.note ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await procurement.saveClient({ code: client?.code ?? null, ...f });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", client ? "Klien diperbarui" : "Klien dibuat", `${res.data.code} · ${res.data.name}`);
    onSaved(res.data);
  }
  async function archive(archived: boolean) {
    if (!client) return;
    setBusy(true);
    const res = await procurement.archiveClient({ code: client.code, archived });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", archived ? "Klien diarsipkan" : "Klien dipulihkan", client.name);
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
      title={client ? client.name : "Klien baru"}
      subtitle={client ? `${client.code} · ${client.project_count} proyek` : "Kodenya dibuat otomatis."}
      footer={mayEdit ? (
        <div className="flex items-center gap-2">
          {client && (
            <Button variant="ghost" icon={client.archived_at ? ArchiveRestore : Archive} disabled={busy}
              onClick={() => archive(!client.archived_at)}>
              {client.archived_at ? "Pulihkan" : "Arsipkan"}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button icon={Save} onClick={save} disabled={busy || !f.name.trim()}>Simpan</Button>
        </div>
      ) : undefined}
    >
      <div className={cn("space-y-3", !mayEdit && "opacity-90")}>
        {field("name", "Nama klien", "mis. PT Baby Island Resort")}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("contact_name", "Kontak", "nama orang yang dihubungi")}
          {field("phone", "Telepon / WA")}
        </div>
        {field("email", "Email")}
        {field("address", "Alamat")}
        {field("npwp", "NPWP")}
        {field("note", "Catatan")}
        {client?.archived_at && (
          <p className="text-[12px] text-slate-500">
            Diarsipkan — tidak ditawarkan lagi saat membuat proyek, tapi proyek lamanya tetap menyebut klien ini.
          </p>
        )}
      </div>
    </Drawer>
  );
}
