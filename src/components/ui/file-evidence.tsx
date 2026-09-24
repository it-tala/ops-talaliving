"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { documents } from "@/demo/api";
import type { DocKind } from "@/services/documents/contracts";
import { useToast } from "@/store/toast";
import { cn } from "@/lib/cn";

/** One file, uploaded the moment it is picked, and its id handed back.
 *
 *  The upload goes to the drive the kind decides (0035) — the screen never
 *  chooses a folder. What the caller gets is the attachment id, which is what
 *  every seam that demands evidence asks for: a surat jalan to mark a lorry
 *  arrived, a BAST to hand a project over.
 */
export function FileEvidence({
  kind, label, value, onChange, accept = "image/*,application/pdf", className,
}: {
  kind: DocKind;
  label: string;
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  accept?: string;
  className?: string;
}) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    const up = await documents.upload({ file: f, kind });
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (up.error) { toast("critical", "Upload gagal", up.error.message); return; }
    onChange({ id: up.data.id, name: f.name });
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px]", className)}>
      <input ref={ref} type="file" accept={accept} className="hidden" aria-label={label}
        onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
          <Paperclip className="h-3 w-3" />
          <span className="max-w-[180px] truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Hapus ${label}`}><X className="h-3 w-3" /></button>
        </span>
      ) : (
        <button type="button" disabled={busy} onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
          <Paperclip className="h-3 w-3" />
          {busy ? "Mengunggah…" : label}
        </button>
      )}
    </span>
  );
}
