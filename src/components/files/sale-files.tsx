"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, FolderOpen, Image as ImageIcon, Upload, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { documents } from "@/demo/api";
import {
  DOC_KINDS_FOR, FILE_ORIGINS, PROJECT_DOC_KINDS, USUAL_ORIGIN,
  type AttachmentView, type DocKind, type FileOrigin, type FilingPreview, type LinkEntity,
} from "@/services/documents/contracts";
import { driveOpenUrl, isImageFile } from "@/lib/drive-links";
import { useToast } from "@/store/toast";
import { useTr, useLang } from "@/lib/i18n";

/** A record a sale's files can be filed against: the project, one of its
 *  quotations, or the client (P1). */
export interface FileTarget {
  entity: Extract<LinkEntity, "project" | "quotation" | "client" | "design_item" | "design_collection">;
  entity_no: string;
  label: string;
}

type OriginFilter = "all" | "tala" | "outside" | "unstated";

/** The files of a sale, from every record it is made of, in one place (P1).
 *
 *  A brief arrives from the client, a render is drawn here, a proposal goes
 *  with a quotation, the signed contract comes back — and each is filed
 *  against the record it belongs to. This reads all of them together, says
 *  who made each one, and files a new one **showing the folder first**: the
 *  database decides where it goes (`drive_folder_for`), and the person sees
 *  that answer before anything is sent.
 */
export function SaleFiles({
  targets, canEdit, onChanged,
}: {
  /** The first is where a new file goes unless the person picks another. */
  targets: FileTarget[];
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [rows, setRows] = useState<AttachmentView[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState<OriginFilter>("all");
  const [adding, setAdding] = useState(false);
  const key = targets.map((t) => `${t.entity}:${t.entity_no}`).join("|");

  async function load() {
    const answers = await Promise.all(targets.map((t) => documents.byEntity(t.entity, t.entity_no)));
    const bad = answers.find((a) => a.error);
    if (bad?.error) { setFailed(bad.error.message); return; }
    const seen = new Map<string, AttachmentView>();
    for (const a of answers) for (const f of a.data ?? []) if (!seen.has(f.id)) seen.set(f.id, f);
    setFailed(null);
    setRows([...seen.values()].sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at)));
  }
  /* Keyed on the records, not on `targets` itself: a parent re-rendering with
     the same records in a new array is not a reason to read again. */
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown = (rows ?? []).filter((f) =>
    filter === "all" ? true
      : filter === "tala" ? f.origin === "tala"
        : filter === "outside" ? f.origin === "client" || f.origin === "third_party"
          : !f.origin);

  /* Grouped by what the file is, in the order a sale produces them. */
  const groups = useMemo(() => {
    const byKind = new Map<string, AttachmentView[]>();
    for (const f of shown) {
      const k = kindHere(f, targets) ?? "Others";
      byKind.set(k, [...(byKind.get(k) ?? []), f]);
    }
    const order = [...PROJECT_DOC_KINDS] as string[];
    return [...byKind.entries()].sort(([a], [b]) => rank(order, a) - rank(order, b));
  }, [shown, targets]);

  async function unlinkHere(f: AttachmentView) {
    const here = f.links.filter((l) => targets.some((t) => t.entity === l.entity && t.entity_no === l.entity_no));
    for (const l of here) {
      const r = await documents.unlink(l.id);
      if (r.error) { toast("warning", tr("Not removed", "Tidak dilepas"), r.error.message); return; }
    }
    toast("success", tr("Removed from this project", "Dilepas dari proyek ini"),
      tr("The file stays in Drive.", "File tetap ada di Drive."));
    await load(); onChanged?.();
  }

  const count = (o: OriginFilter) => (rows ?? []).filter((f) =>
    o === "all" ? true : o === "tala" ? f.origin === "tala"
      : o === "outside" ? f.origin === "client" || f.origin === "third_party" : !f.origin).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <FolderOpen className="h-4 w-4 text-slate-400" />
        <p className="text-[13px] font-semibold text-slate-800">{tr("Files", "File")}</p>
        {rows && <span className="text-[12px] text-slate-400">{tr(`${rows.length} ${rows.length === 1 ? "file" : "files"}`, `${rows.length} file`)}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {([
            ["all", tr("All", "Semua")],
            ["tala", "TALA"],
            ["outside", tr("Client & third party", "Klien & pihak ketiga")],
            ["unstated", tr("Not stated", "Tidak disebut")],
          ] as [OriginFilter, string][]).map(([k, label]) => (
            <button
              key={k} onClick={() => setFilter(k)}
              className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium",
                filter === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {label} <span className="tabular-nums opacity-70">{count(k)}</span>
            </button>
          ))}
          {canEdit && !adding && (
            <Button size="sm" icon={Upload} onClick={() => setAdding(true)}>{tr("Upload file", "Unggah file")}</Button>
          )}
        </div>
      </div>

      {adding && (
        <UploadForm
          targets={targets}
          onCancel={() => setAdding(false)}
          onDone={async () => { setAdding(false); await load(); onChanged?.(); }}
        />
      )}

      {failed ? (
        <p className="px-4 py-6 text-center text-[13px] text-rose-700">{failed}</p>
      ) : rows === null ? (
        <p className="px-4 py-6 text-center text-[13px] text-slate-400">{tr("Loading…", "Memuat…")}</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-slate-500">
          {rows.length === 0
            ? tr("No files yet. Upload the client's brief, their drawings and references, our renders and the proposal here.",
                "Belum ada file. Unggah brief klien, gambar dan referensi dari klien, render kita, dan proposal di sini.")
            : tr("No files from this source.", "Tidak ada file dari sumber ini.")}
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map(([kind, files]) => (
            <section key={kind} className="px-4 py-3">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {kind} <span className="font-normal tabular-nums text-slate-400">· {files.length}</span>
              </h4>
              <ul className="space-y-1.5">
                {files.map((f) => <FileRow key={f.id} f={f} targets={targets} canEdit={canEdit} onUnlink={() => unlinkHere(f)} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  f, targets, canEdit, onUnlink,
}: {
  f: AttachmentView; targets: FileTarget[]; canEdit: boolean; onUnlink: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const open = driveOpenUrl(f);
  const on = f.links
    .filter((l) => targets.some((t) => t.entity === l.entity && t.entity_no === l.entity_no))
    .map((l) => targets.find((t) => t.entity === l.entity && t.entity_no === l.entity_no)!.label);
  const origin = FILE_ORIGINS.find((o) => o.code === f.origin);
  const Icon = isImageFile(f) ? ImageIcon : FileText;
  return (
    <li className="flex items-start gap-2.5 text-[13px]">
      <Icon className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {open ? (
            <a href={open} target="_blank" rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-medium text-slate-800 hover:text-brand-700 hover:underline">
              <span className="truncate">{f.filename}</span>
              <ExternalLink className="h-3 w-3 flex-none text-slate-400" />
            </a>
          ) : (
            <span className="truncate font-medium text-slate-800">{f.filename}</span>
          )}
          {origin
            ? <Badge tone={origin.code === "tala" ? "brand" : origin.code === "client" ? "amber" : "violet"}>{lang === "id" ? origin.label_id : origin.label}</Badge>
            : <Badge tone="slate">{tr("origin not stated", "asal tidak disebut")}</Badge>}
        </div>
        <p className="text-[12px] text-slate-500">
          {[on.join(", "), f.uploaded_by, f.uploaded_at.slice(0, 10)].filter(Boolean).join(" · ")}
        </p>
        {f.filed_in && <p className="truncate font-mono text-[11px] text-slate-400" title={f.filed_in}>{f.filed_in}</p>}
      </div>
      {canEdit && (
        <button
          onClick={onUnlink} title={tr("Remove from this project (the file stays in Drive)", "Lepas dari proyek ini (file tetap di Drive)")}
          aria-label={tr("Remove from this project", "Lepas dari proyek ini")}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";

function UploadForm({
  targets, onCancel, onDone,
}: {
  targets: FileTarget[]; onCancel: () => void; onDone: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState(0);
  const t = targets[target] ?? targets[0];
  const kinds = (DOC_KINDS_FOR[t.entity] ?? PROJECT_DOC_KINDS) as readonly DocKind[];
  const [kind, setKind] = useState<DocKind>(kinds[0] ?? "Others");
  const [origin, setOrigin] = useState<FileOrigin | null>(USUAL_ORIGIN[kinds[0] ?? "Others"] ?? null);
  const [where, setWhere] = useState<{ ok: FilingPreview } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* A kind the new target does not offer falls back to its first. */
  useEffect(() => {
    if (!kinds.includes(kind)) pickKind(kinds[0] ?? "Others");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  /* The database's answer to *where would this go*, asked again whenever the
     kind or the record changes. */
  useEffect(() => {
    let alive = true;
    setWhere(null);
    void documents.filingPreview({ kind, entity: t.entity, entity_no: t.entity_no }).then((r) => {
      if (!alive) return;
      setWhere(r.error ? { error: r.error.message } : { ok: r.data });
    });
    return () => { alive = false; };
  }, [kind, t.entity, t.entity_no]);

  function pickKind(k: DocKind) {
    setKind(k);
    setOrigin(USUAL_ORIGIN[k] ?? null);
  }

  async function send() {
    if (files.length === 0) return;
    setBusy(true);
    let filed = 0;
    for (const file of files) {
      const up = await documents.upload({ file, kind, entity: t.entity, entity_no: t.entity_no, origin });
      if (up.error) {
        toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message);
        continue;
      }
      const link = await documents.link({ attachment_id: up.data.id, entity: t.entity, entity_no: t.entity_no, kind });
      if (link.error) {
        toast("warning", tr(`${file.name} is in Drive but not on this record`, `${file.name} ada di Drive tetapi belum tertaut`), link.error.message);
        continue;
      }
      filed++;
    }
    setBusy(false);
    if (filed > 0) {
      toast("success", tr(`${filed} file(s) filed`, `${filed} file tersimpan`),
        where && "ok" in where ? where.ok.filed_in : undefined);
      onDone();
    }
  }

  return (
    <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("Files", "File")}
          <div className="mt-1 flex items-center gap-2">
            <Button size="sm" variant="outline" icon={Upload} onClick={() => fileRef.current?.click()}>
              {tr("Choose files", "Pilih file")}
            </Button>
            <span className="truncate text-[12px] text-slate-600">
              {files.length === 0 ? tr("none chosen", "belum dipilih") : files.map((f) => f.name).join(", ")}
            </span>
          </div>
          <input
            ref={fileRef} type="file" multiple className="hidden" aria-label={tr("Files", "File")}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {targets.length > 1 && (
          <label className="block text-xs text-slate-500">{tr("Filed against", "Ditempel ke")}
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))} className={cn(inputCls, "mt-1")}>
              {targets.map((x, i) => <option key={`${x.entity}:${x.entity_no}`} value={i}>{x.label}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs text-slate-500">{tr("What it is", "Jenis")}
          <select value={kind} onChange={(e) => pickKind(e.target.value as DocKind)} className={cn(inputCls, "mt-1")}>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <fieldset className="text-xs text-slate-500">
          <legend>{tr("Who made it", "Asal file")}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {FILE_ORIGINS.map((o) => (
              <label key={o.code}
                className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px]",
                  origin === o.code ? "border-brand-400 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700")}>
                <input type="radio" name="sale-file-origin" checked={origin === o.code} onChange={() => setOrigin(o.code)} className="sr-only" />
                {lang === "id" ? o.label_id : o.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]">
        <span className="text-slate-500">{tr("Will be filed in", "Akan disimpan di")} </span>
        {where === null ? <span className="text-slate-400">…</span>
          : "ok" in where ? <span className="break-all font-mono text-slate-800">{where.ok.filed_in}</span>
            : <span className="text-rose-700">{where.error}</span>}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Upload} onClick={send}
          disabled={busy || files.length === 0 || !origin || (where !== null && "error" in where)}>
          {busy ? tr("Uploading…", "Mengunggah…") : tr("Upload", "Unggah")}
        </Button>
      </div>
      {!origin && <p className="text-[12px] text-amber-700">{tr("Say who made the file.", "Pilih asal file.")}</p>}
    </div>
  );
}

/** The kind a file carries on the records shown here (its first such link). */
function kindHere(f: AttachmentView, targets: FileTarget[]): string | null {
  const l = f.links.find((x) => targets.some((t) => t.entity === x.entity && t.entity_no === x.entity_no));
  return l?.kind ?? null;
}

function rank(order: string[], k: string): number {
  const i = order.indexOf(k);
  return i === -1 ? order.length : i;
}
