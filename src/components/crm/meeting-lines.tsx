"use client";

import { useEffect, useState } from "react";
import { Check, ListPlus, Paperclip, Plus, Trash2, Users, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { SaleFiles } from "@/components/files/sale-files";
import { cn } from "@/lib/cn";
import { crm, design } from "@/demo/api";
import {
  MEETING_KINDS, MEETING_POINT_KINDS, MEETING_SIDE_LABELS,
  type ActivityKind, type ClientActivityView, type MeetingAttendeeInput, type MeetingPerson,
  type MeetingPointInput, type MeetingPointKind, type MeetingPointState, type MeetingPointView, type MeetingSide,
} from "@/services/crm/contracts";
import type { DesignItemView } from "@/services/design/contracts";
import { useCanDesign } from "@/lib/sell";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const cls = "h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px]";

const POINT_STATE: Record<MeetingPointState, { en: string; id: string; tone: "slate" | "amber" | "red" | "green" }> = {
  noted: { en: "", id: "", tone: "slate" },
  open: { en: "Open", id: "Terbuka", tone: "amber" },
  overdue: { en: "Overdue", id: "Terlambat", tone: "red" },
  done: { en: "Done", id: "Selesai", tone: "green" },
};

/** The people who can be named for TALA, and a project's design items to
 *  point a line at — read once by whichever form needs them. */
export function useMeetingPickers(projectCode: string | null | undefined) {
  const [people, setPeople] = useState<MeetingPerson[]>([]);
  const [items, setItems] = useState<DesignItemView[]>([]);
  useEffect(() => {
    let live = true;
    void crm.listMeetingPeople().then((r) => { if (live) setPeople(r.data ?? []); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    if (!projectCode) { setItems([]); return; }
    void design.getProjectDesign(projectCode).then((r) => {
      if (live) setItems((r.data?.items ?? []).filter((i) => i.status !== "DROPPED"));
    });
    return () => { live = false; };
  }, [projectCode]);
  return { people, items };
}

/* ── editing: who was there, and the minutes ──────────────────────────── */

export function AttendeesEditor({
  value, onChange, people,
}: { value: MeetingAttendeeInput[]; onChange: (v: MeetingAttendeeInput[]) => void; people: MeetingPerson[] }) {
  const tr = useTr();
  const set = (i: number, patch: Partial<MeetingAttendeeInput>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const taken = new Set(value.filter((x) => x.side === "tala").map((x) => x.user_id));
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
        <Users className="h-3.5 w-3.5" /> {tr("Attendees", "Peserta")}
      </p>
      {value.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select value={a.side} aria-label={tr("Side", "Pihak")} className={cls}
            onChange={(e) => set(i, { side: e.target.value as MeetingSide, user_id: null, name: "" })}>
            {(Object.keys(MEETING_SIDE_LABELS) as MeetingSide[]).map((s) => (
              <option key={s} value={s}>{tr(MEETING_SIDE_LABELS[s].en, MEETING_SIDE_LABELS[s].id)}</option>
            ))}
          </select>
          {a.side === "tala" ? (
            <select value={a.user_id ?? ""} onChange={(e) => set(i, { user_id: e.target.value || null })}
              aria-label={tr("Person", "Orang")} className={cn(cls, "min-w-[180px]")}>
              <option value="">{tr("— who —", "— siapa —")}</option>
              {people.filter((p) => p.id === a.user_id || !taken.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          ) : (
            <input value={a.name ?? ""} onChange={(e) => set(i, { name: e.target.value })} aria-label={tr("Name", "Nama")}
              placeholder={tr("name", "nama")} className={cn(cls, "min-w-[180px]")} />
          )}
          <input value={a.role ?? ""} onChange={(e) => set(i, { role: e.target.value })} aria-label={tr("Role", "Peran")}
            placeholder={tr("role (optional)", "peran (opsional)")} className={cn(cls, "w-40")} />
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={tr("Remove", "Hapus")}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <AddButton onClick={() => onChange([...value, { side: "tala", user_id: null }])}>{tr("TALA", "TALA")}</AddButton>
        <AddButton onClick={() => onChange([...value, { side: "client", name: "" }])}>{tr("Client", "Klien")}</AddButton>
        <AddButton onClick={() => onChange([...value, { side: "third_party", name: "" }])}>{tr("Third party", "Pihak ketiga")}</AddButton>
      </div>
    </div>
  );
}

export function PointsEditor({
  value, onChange, people, items,
}: {
  value: MeetingPointInput[]; onChange: (v: MeetingPointInput[]) => void;
  people: MeetingPerson[]; items: DesignItemView[];
}) {
  const tr = useTr();
  const set = (i: number, patch: Partial<MeetingPointInput>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
        <ListPlus className="h-3.5 w-3.5" /> {tr("Minutes", "Notulen")}
      </p>
      {value.map((p, i) => {
        const work = p.kind === "revision" || p.kind === "action";
        return (
          <div key={i} className="space-y-1 rounded-lg border border-slate-200 bg-white p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={p.kind} onChange={(e) => set(i, { kind: e.target.value as MeetingPointKind })}
                aria-label={tr("Kind of line", "Jenis butir")} className={cls}>
                {MEETING_POINT_KINDS.map((k) => <option key={k.code} value={k.code}>{tr(k.label.en, k.label.id)}</option>)}
              </select>
              <input value={p.body} onChange={(e) => set(i, { body: e.target.value })} aria-label={tr("What", "Isi")}
                placeholder={p.kind === "revision"
                  ? tr("what the client asked to change", "apa yang klien minta diubah")
                  : p.kind === "decision" ? tr("what was decided", "apa yang diputuskan")
                    : p.kind === "action" ? tr("what is to be done", "apa yang harus dikerjakan") : tr("note", "catatan")}
                className={cn(cls, "min-w-[220px] flex-1")} />
              <button onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={tr("Remove", "Hapus")}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {items.length > 0 && (
                <select value={p.item_no ?? ""} onChange={(e) => set(i, { item_no: e.target.value || null })}
                  aria-label={tr("Design item", "Item desain")} className={cn(cls, "min-w-[200px]")}>
                  <option value="">{tr("— no particular item —", "— bukan item tertentu —")}</option>
                  {items.map((it) => <option key={it.item_no} value={it.item_no}>{it.item_no} · {it.name}</option>)}
                </select>
              )}
              {work && (
                <>
                  <select value={p.owner_id ?? ""} onChange={(e) => set(i, { owner_id: e.target.value || null })}
                    aria-label={tr("Who does it", "Siapa yang mengerjakan")} className={cn(cls, "min-w-[160px]")}>
                    <option value="">{tr("— who does it —", "— siapa yang mengerjakan —")}</option>
                    {people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  <input type="date" value={p.due_on ?? ""} onChange={(e) => set(i, { due_on: e.target.value || null })}
                    aria-label={tr("Due", "Tenggat")} className={cls} />
                </>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1.5">
        {MEETING_POINT_KINDS.map((k) => (
          <AddButton key={k.code} onClick={() => onChange([...value, { kind: k.code, body: "" }])}>{tr(k.label.en, k.label.id)}</AddButton>
        ))}
      </div>
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-brand-400 hover:text-brand-700">
      <Plus className="h-3 w-3" /> {children}
    </button>
  );
}

export const takesAttendees = (k: ActivityKind) => MEETING_KINDS.includes(k);

/* ── reading: a line of the minutes ───────────────────────────────────── */

export function PointRow({
  p, onChanged, showMeeting,
}: { p: MeetingPointView; onChanged: () => void; showMeeting?: boolean }) {
  const tr = useTr();
  const { toast } = useToast();
  const canDesign = useCanDesign();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const k = MEETING_POINT_KINDS.find((x) => x.code === p.kind)!;
  const st = POINT_STATE[p.state];

  async function close() {
    setBusy(true);
    const r = await crm.closeMeetingPoint(p.id, note || null);
    setBusy(false);
    if (r.error) { toast("warning", tr("Not closed", "Belum ditutup"), r.error.message); return; }
    toast("success", tr("Done", "Selesai"), p.body);
    setClosing(false); setNote("");
    onChanged();
  }

  return (
    <li className={cn("px-3 py-1.5 text-[13px]", p.state === "done" && "text-slate-500")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge tone={k.tone}>{tr(k.label.en, k.label.id)}</Badge>
        {p.state !== "noted" && <Badge tone={st.tone}>{tr(st.en, st.id)}</Badge>}
        <span className={cn("text-slate-800", p.state === "done" && "line-through decoration-slate-300")}>{p.body}</span>
        {p.item_no && <span className="font-mono text-[11px] text-brand-700">{p.item_no}</span>}
        {(p.owner_name || p.due_on) && (
          <span className="text-[12px] text-slate-500">
            · {p.owner_name ?? tr("nobody named", "belum ada PIC")}{p.due_on ? `, ${tr("by", "sebelum")} ${p.due_on}` : ""}
          </span>
        )}
        {showMeeting && <span className="text-[11px] text-slate-400">· {tr("meeting", "meeting")} {p.happened_on}</span>}
        {(p.state === "open" || p.state === "overdue") && canDesign() && !closing && (
          <Button size="sm" variant="outline" icon={Check} className="ml-auto" onClick={() => setClosing(true)}>{tr("Done", "Selesai")}</Button>
        )}
      </div>
      {p.state === "done" && (
        <p className="mt-0.5 text-[12px] text-emerald-700">
          ✓ {p.closed_by_name}{p.closed_at ? ` · ${p.closed_at.slice(0, 10)}` : ""}{p.closed_note ? ` — ${p.closed_note}` : ""}
        </p>
      )}
      {closing && (
        <div className="mt-1 flex items-center gap-1">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} aria-label={tr("What came of it", "Hasilnya")}
            placeholder={p.kind === "revision" ? tr("e.g. render rev B, height 380", "mis. render rev B, tinggi 380") : tr("what came of it (optional)", "hasilnya (opsional)")}
            className={cn(cls, "min-w-[240px] flex-1")} />
          <Button size="sm" disabled={busy} onClick={close}>{tr("Close", "Tutup")}</Button>
          <button onClick={() => setClosing(false)} aria-label={tr("Cancel", "Batal")} className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
      )}
    </li>
  );
}

/* ── one entry of the log, opened ─────────────────────────────────────── */

/** Who was there, the minutes, and the files of one contact; more lines can
 *  be added after it (minutes are often written the next day). */
export function MeetingDetail({
  a, mayWrite, onChanged,
}: { a: ClientActivityView; mayWrite: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [attendees, reloadAttendees] = useLoad(() => crm.listMeetingAttendees(a.id), [a.id]);
  const [points, reloadPoints] = useLoad(() => crm.listMeetingPoints({ activity_id: a.id }), [a.id]);
  const [adding, setAdding] = useState(false);
  const [moreA, setMoreA] = useState<MeetingAttendeeInput[]>([]);
  const [moreP, setMoreP] = useState<MeetingPointInput[]>([]);
  const [busy, setBusy] = useState(false);
  const { people, items } = useMeetingPickers(adding ? a.project_code : null);
  const changed = () => { reloadAttendees(); reloadPoints(); onChanged(); };

  async function save() {
    setBusy(true);
    const r = await crm.addMeetingLines(a.id, { attendees: moreA, points: moreP });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not added", "Tidak ditambahkan"), r.error.message); return; }
    toast("success", tr("Minutes added", "Notulen ditambahkan"), a.client_name);
    setAdding(false); setMoreA([]); setMoreP([]);
    changed();
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
      <Loaded state={attendees} onRetry={reloadAttendees} skeletonRows={1}>
        {(xs) => xs.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-slate-600">
            <Users className="h-3.5 w-3.5 text-slate-400" />
            {xs.map((x, i) => (
              <span key={x.id}>
                <span className={x.side === "tala" ? "text-slate-800" : "text-amber-800"}>{x.name}</span>
                {x.role && <span className="text-slate-400"> ({x.role})</span>}
                {x.side === "third_party" && <span className="text-slate-400"> · {tr("third party", "pihak ketiga")}</span>}
                {i < xs.length - 1 && ","}
              </span>
            ))}
          </p>
        )}
      </Loaded>
      <Loaded state={points} onRetry={reloadPoints} skeletonRows={2}>
        {(ps) => ps.length === 0 ? (
          <p className="text-[12px] text-slate-400">{tr("No minutes recorded.", "Belum ada notulen.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {ps.map((p) => <PointRow key={p.id} p={p} onChanged={changed} />)}
          </ul>
        )}
      </Loaded>
      {adding ? (
        <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2">
          {takesAttendees(a.kind) && <AttendeesEditor value={moreA} onChange={setMoreA} people={people} />}
          <PointsEditor value={moreP} onChange={setMoreP} people={people} items={items} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setMoreA([]); setMoreP([]); }} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={save} disabled={busy || moreA.length + moreP.length === 0}>
              {tr("Add", "Tambahkan")}
            </Button>
          </div>
        </div>
      ) : mayWrite && (
        <Button size="sm" variant="outline" icon={ListPlus} onClick={() => setAdding(true)}>
          {tr("Add minutes", "Tambah notulen")}
        </Button>
      )}
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
          <Paperclip className="h-3.5 w-3.5" /> {tr("Files of this contact", "File dari kontak ini")}
        </p>
        <SaleFiles
          targets={[{ entity: "client_activity", entity_no: a.id, label: `${a.happened_on} · ${a.kind}` }]}
          canEdit={mayWrite} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** The revision requests and actions still to be done — of a project, or of
 *  one design item. */
export function OpenPoints({
  filter, title, empty, refresh = 0,
}: {
  filter: { project_code?: string; item_no?: string }; title: string; empty?: string;
  /** Bumped by the screen when the log beside it changed. */
  refresh?: number;
}) {
  const [state, reload] = useLoad(() => crm.listMeetingPoints(filter), [filter.project_code, filter.item_no, refresh]);
  const tr = useTr();
  return (
    <Loaded state={state} onRetry={reload} skeletonRows={1}>
      {(ps) => {
        const shown = filter.item_no ? ps : ps.filter((p) => p.state === "open" || p.state === "overdue");
        if (shown.length === 0 && !empty) return null;
        return (
          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              {title}{shown.length > 0 && <span className="ml-1 text-slate-400">· {shown.length}</span>}
            </h3>
            {shown.length === 0 ? (
              <p className="text-[12px] text-slate-400">{empty}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {shown.map((p) => <PointRow key={p.id} p={p} onChanged={reload} showMeeting />)}
              </ul>
            )}
            {!filter.item_no && shown.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-400">
                {tr("From the minutes below. Closed by whoever did it — the drafter, for a revision.",
                  "Dari notulen di bawah. Ditutup oleh yang mengerjakan — drafter, untuk revisi.")}
              </p>
            )}
          </section>
        );
      }}
    </Loaded>
  );
}
