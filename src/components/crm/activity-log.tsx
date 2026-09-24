"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Check, MessageSquarePlus, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { crm } from "@/demo/api";
import {
  ACTIVITY_KINDS, ACTIVITY_KIND_LABEL,
  type ActivityFilter, type ActivityKind, type ClientActivityView, type FollowUpState,
} from "@/services/crm/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The client log, wherever it is shown: on a client's page, on a quotation,
 *  in a project. `filter` picks what is listed; `fixed` is what a new entry is
 *  about and cannot be changed from here; `projects` offers a project picker
 *  when the entry could be about any of the client's projects.
 */
export function ActivityLog({
  filter, fixed, projects, title = "Aktivitas & follow-up", onChanged,
}: {
  filter: ActivityFilter;
  fixed: { client_code?: string | null; project_code?: string | null; quote_no?: string | null };
  projects?: { code: string; name: string }[];
  title?: string;
  onChanged?: () => void;
}) {
  const { can } = useSession();
  const mayWrite = can("project.update");
  const [rows, reload] = useLoad(() => crm.listActivities(filter), [JSON.stringify(filter)]);
  const [adding, setAdding] = useState(false);
  const changed = () => { reload(); onChanged?.(); };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <MessageSquarePlus className="h-4 w-4 text-slate-400" />
        <p className="text-[13px] font-semibold text-slate-800">{title}</p>
        {rows.status === "ready" && (
          <span className="text-[12px] text-slate-400">
            {rows.data.length} catatan
            {openCount(rows.data) > 0 && <> · <span className="text-amber-700">{openCount(rows.data)} follow-up terbuka</span></>}
          </span>
        )}
        {mayWrite && !adding && (
          <Button size="sm" className="ml-auto" icon={MessageSquarePlus} onClick={() => setAdding(true)}>Catat</Button>
        )}
      </div>
      {adding && (
        <NewActivity fixed={fixed} projects={projects} onDone={(saved) => { setAdding(false); if (saved) changed(); }} />
      )}
      <Loaded state={rows} onRetry={reload} skeletonRows={2}>
        {(list) => list.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">
            Belum ada catatan. Catat setiap telepon, WhatsApp, atau meeting — dan kapan harus dihubungi lagi.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((a) => <ActivityRow key={a.id} a={a} mayWrite={mayWrite} onChanged={changed} showClient={!filter.client_code} />)}
          </ul>
        )}
      </Loaded>
    </div>
  );
}

const openCount = (xs: ClientActivityView[]) =>
  xs.filter((a) => a.follow_up_state === "overdue" || a.follow_up_state === "today" || a.follow_up_state === "upcoming").length;

export const FOLLOW_UP_TONE: Record<FollowUpState, { label: string; tone: "red" | "amber" | "brand" | "green" | "slate" }> = {
  overdue: { label: "Terlambat", tone: "red" },
  today: { label: "Hari ini", tone: "amber" },
  upcoming: { label: "Terjadwal", tone: "brand" },
  done: { label: "Selesai", tone: "green" },
  none: { label: "", tone: "slate" },
};

export function ActivityRow({
  a, mayWrite, onChanged, showClient,
}: {
  a: ClientActivityView; mayWrite: boolean; onChanged: () => void; showClient?: boolean;
}) {
  const { toast } = useToast();
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const open = a.follow_up_state === "overdue" || a.follow_up_state === "today" || a.follow_up_state === "upcoming";

  async function close() {
    setBusy(true);
    const res = await crm.completeFollowUp(a.id, result || null);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Follow-up belum ditutup", res.error.message); return; }
    toast("success", "Follow-up selesai", a.next_action ?? a.client_name);
    setClosing(false); setResult("");
    onChanged();
  }

  return (
    <li className="px-4 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge tone="slate">{ACTIVITY_KIND_LABEL(a.kind)}</Badge>
        <span className="text-slate-500">{a.happened_on}</span>
        {showClient && (
          <Link href={`/master-data/clients/${encodeURIComponent(a.client_code)}`} className="font-medium text-brand-700 hover:underline">
            {a.client_name}
          </Link>
        )}
        {a.project_code && <span className="text-[12px] text-slate-500">· {a.project_name ?? a.project_code}</span>}
        {a.quote_no && (
          <Link href={`/proyek/quotation/${encodeURIComponent(a.quote_no)}`} className="font-mono text-[11px] text-brand-700 hover:underline">
            {a.quote_no}
          </Link>
        )}
        <span className="ml-auto text-[11px] text-slate-400">{a.created_by_name}</span>
      </div>
      <p className="mt-1 whitespace-pre-line text-slate-800">{a.summary}</p>
      {a.follow_up_on && (
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]",
          a.follow_up_state === "overdue" ? "bg-rose-50" : a.follow_up_state === "today" ? "bg-amber-50" : "bg-slate-50")}>
          <BellRing className="h-3.5 w-3.5 text-slate-400" />
          <Badge tone={FOLLOW_UP_TONE[a.follow_up_state].tone}>{FOLLOW_UP_TONE[a.follow_up_state].label}</Badge>
          <span className="text-slate-600">{a.follow_up_on}</span>
          {a.next_action && <span className="text-slate-800">— {a.next_action}</span>}
          {a.follow_up_state === "done" && (
            <span className="text-slate-500">
              {a.follow_up_result ? `→ ${a.follow_up_result}` : ""}{a.follow_up_done_by_name && ` (${a.follow_up_done_by_name})`}
            </span>
          )}
          {open && mayWrite && !closing && (
            <Button size="sm" variant="outline" icon={Check} className="ml-auto" onClick={() => setClosing(true)}>Selesai</Button>
          )}
          {closing && (
            <span className="ml-auto flex items-center gap-1">
              <input autoFocus value={result} onChange={(e) => setResult(e.target.value)} placeholder="hasilnya (opsional)"
                aria-label="Hasil follow-up" className="h-8 w-56 rounded-lg border border-slate-200 bg-white px-2 text-[12px]" />
              <Button size="sm" disabled={busy} onClick={close}>Tutup</Button>
              <button onClick={() => setClosing(false)} aria-label="Batal" className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function NewActivity({
  fixed, projects, onDone,
}: {
  fixed: { client_code?: string | null; project_code?: string | null; quote_no?: string | null };
  projects?: { code: string; name: string }[];
  onDone: (saved: boolean) => void;
}) {
  const { toast } = useToast();
  const today = officeToday();
  const [f, setF] = useState({
    kind: "call" as ActivityKind, happened_on: today, summary: "", project_code: fixed.project_code ?? "",
    follow_up_on: "", next_action: "",
  });
  const [key] = useState(() => `act:${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const [busy, setBusy] = useState(false);
  const cls = "h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px]";

  async function save() {
    setBusy(true);
    const res = await crm.logActivity({
      client_code: fixed.client_code ?? null, project_code: f.project_code || null, quote_no: fixed.quote_no ?? null,
      kind: f.kind, summary: f.summary, happened_on: f.happened_on,
      follow_up_on: f.follow_up_on || null, next_action: f.next_action || null,
    }, key);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message); return; }
    toast("success", "Tercatat", res.data.follow_up_on ? `Follow-up ${res.data.follow_up_on}` : res.data.client_name);
    onDone(true);
  }

  return (
    <div className="space-y-2 border-b border-slate-100 bg-brand-50/40 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ActivityKind })} aria-label="Jenis" className={cls}>
          {ACTIVITY_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select>
        <input type="date" value={f.happened_on} max={today} onChange={(e) => setF({ ...f, happened_on: e.target.value })}
          aria-label="Tanggal" className={cls} />
        {projects && !fixed.project_code && (
          <select value={f.project_code} onChange={(e) => setF({ ...f, project_code: e.target.value })} aria-label="Proyek" className={cn(cls, "min-w-[200px]")}>
            <option value="">— umum, bukan proyek tertentu —</option>
            {projects.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.code}</option>)}
          </select>
        )}
      </div>
      <textarea autoFocus value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} rows={2}
        placeholder="Apa yang dibicarakan? mis. klien minta revisi ukuran meja, harga masih dipertimbangkan"
        aria-label="Ringkasan" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-slate-500">Follow-up</span>
        <input type="date" value={f.follow_up_on} min={f.happened_on} onChange={(e) => setF({ ...f, follow_up_on: e.target.value })}
          aria-label="Tanggal follow-up" className={cls} />
        {f.follow_up_on && (
          <input value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })}
            placeholder="yang harus dilakukan, mis. telepon tanya keputusan" aria-label="Tindakan berikutnya"
            className={cn(cls, "min-w-[260px] flex-1")} />
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={busy}>Batal</Button>
        <Button size="sm" onClick={save} disabled={busy || !f.summary.trim()}>Simpan</Button>
      </div>
    </div>
  );
}
