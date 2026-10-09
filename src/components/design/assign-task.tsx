"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { design, hr } from "@/demo/api";
import type { DesignAssignment } from "@/services/design/contracts";
import type { RosterEntry } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b.slice(0, 10)}T00:00:00`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00`).getTime()) / 864e5);

function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString("en-CA");
}

/** Who holds a room or an item and by when — an ordinary HRD task given out
 *  from Design, closing itself when every box is filled (0250, D402, D403). */
export function AssignmentLine({
  scope, refNo, assignment, complete, canEdit, onChanged, compact,
}: {
  scope: "room" | "item"; refNo: string; assignment: DesignAssignment | undefined;
  /** Every box already filled: nothing to give out (the seam refuses it). */
  complete: boolean;
  canEdit: boolean; onChanged: () => void; compact?: boolean;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const today = officeToday();
  const a = assignment;
  return (
    <div className={cn("min-w-0", !compact && "w-full")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {!a ? (
          <span className="text-slate-400">
            {complete ? tr("Every box is filled", "Semua kotak terisi") : tr("Not given to anybody yet", "Belum ditugaskan")}
          </span>
        ) : a.status === "DONE" ? (
          <>
            <Badge tone="green">{tr("Done", "Selesai")} {a.done_at ? fmt(a.done_at) : ""}</Badge>
            <span className="text-slate-600">{a.assignee_name}</span>
            {a.done_at && (
              <span className="text-slate-400">
                {daysBetween(a.due_date, a.done_at) <= 0 ? tr("on time", "tepat waktu") : tr(`${daysBetween(a.due_date, a.done_at)} days late`, `telat ${daysBetween(a.due_date, a.done_at)} hari`)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-medium text-slate-700">{a.assignee_name}</span>
            <span className={cn("tabular-nums", a.due_date < today ? "font-semibold text-rose-700" : "text-slate-500")}>
              {a.due_date < today
                ? tr(`${daysBetween(a.due_date, today)} days past ${fmt(a.due_date)}`, `lewat ${daysBetween(a.due_date, today)} hari (${fmt(a.due_date)})`)
                : tr(`due ${fmt(a.due_date)}`, `tenggat ${fmt(a.due_date)}`)}
            </span>
            {a.blocked_reason && <Badge tone="amber">{tr("Blocked", "Tertahan")}</Badge>}
            <span className="font-mono text-[10px] text-slate-400">{a.task_no}</span>
          </>
        )}
        {canEdit && !open && (a?.status === "OPEN" || !complete) && (
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-brand-700 hover:bg-brand-50">
            <UserPlus className="h-3.5 w-3.5" />
            {!a ? tr(scope === "room" ? "Give this room" : "Give this item", scope === "room" ? "Tugaskan ruangan" : "Tugaskan item")
              : a.status === "OPEN" ? tr("Change", "Ubah") : tr("Give again", "Tugaskan lagi")}
          </button>
        )}
      </div>
      {a?.blocked_reason && a.status === "OPEN" && (
        <p className="mt-0.5 text-[11px] text-amber-700">{tr("Blocked:", "Tertahan:")} {a.blocked_reason}</p>
      )}
      {open && (
        <AssignForm scope={scope} refNo={refNo} current={a?.status === "OPEN" ? a : undefined}
          onCancel={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} />
      )}
    </div>
  );
}

function AssignForm({
  scope, refNo, current, onCancel, onDone,
}: { scope: "room" | "item"; refNo: string; current?: DesignAssignment; onCancel: () => void; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [who, setWho] = useState(current?.assignee_no ?? "");
  const [due, setDue] = useState(current?.due_date ?? addDays(officeToday(), 7));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void hr.listWorkRoster().then((r) => { if (live) setRoster(r.data ?? []); });
    return () => { live = false; };
  }, []);

  async function save() {
    setBusy(true);
    const r = await design.assignDesignTask({ scope, ref_no: refNo, assignee_no: who, due_date: due, note: note.trim() || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not given", "Tidak ditugaskan"), r.error.message); return; }
    if (r.meta.outcome === "noop") { toast("info", tr("No change", "Tidak ada perubahan")); onDone(); return; }
    const name = roster.find((x) => x.employee_no === who)?.full_name ?? who;
    toast("success", current ? tr(`Moved to ${name}`, `Dipindah ke ${name}`) : tr(`Given to ${name}`, `Ditugaskan ke ${name}`),
      tr("It is an HRD task now: the bell rings, and it closes itself when every box is filled.",
        "Sekarang jadi tugas HRD: loncengnya berbunyi, dan selesai sendiri saat semua kotak terisi."));
    onDone();
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <label className="text-xs text-slate-500">{tr("Drafter", "Drafter")}
          <select value={who} onChange={(e) => setWho(e.target.value)} className={cn(inputCls, "mt-1")}>
            <option value="">{roster.length ? tr("— choose —", "— pilih —") : tr("— no roster to read —", "— daftar karyawan tidak terbaca —")}</option>
            {roster.map((p) => <option key={p.employee_no} value={p.employee_no}>{p.full_name} · {p.employee_no}{p.position ? ` · ${p.position}` : ""}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">{tr("Due", "Tenggat")}
          <input type="date" value={due} min={officeToday()} onChange={(e) => setDue(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
        placeholder={tr("Note for the drafter (optional)", "Catatan untuk drafter (boleh kosong)")} />
      <p className="text-[11px] text-slate-500">
        {tr("One HRD task for the whole " + (scope === "room" ? "room" : "item") + ". HRD only monitors; it closes itself when every box is filled.",
          "Satu tugas HRD untuk " + (scope === "room" ? "seluruh ruangan" : "item ini") + ". HRD hanya memantau; selesai sendiri saat semua kotak terisi.")}
      </p>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={UserPlus} onClick={save} disabled={busy || !who || !due}>
          {current ? tr("Save", "Simpan") : tr("Give", "Tugaskan")}
        </Button>
      </div>
    </div>
  );
}
