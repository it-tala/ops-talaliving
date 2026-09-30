"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Clock, Gauge, ListChecks, Plus, Timer, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { Combobox } from "@/components/ui/combobox";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr, production } from "@/demo/api";
import {
  STAGE_NAME, type ProgressEntry, type WorkOrderView, type WorkSlotView, type WorkSlotWorker,
} from "@/services/production/contracts";
import type { RosterEntry } from "@/services/hr/contracts";
import {
  durationLabel, jobLabour, labourRows, productivityByPerson, stagePosition, type LabourRow,
} from "@/services/production/work-slots-view";
import { spanLabel } from "@/services/production/progress-view";
import { officeClock, officeStamp, officeToday, OFFICE_TZ } from "@/lib/office";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { FloorHourly } from "./ProgressPanels";
import { TargetsTab } from "./Targets";

/* ── the project manager's line (D352) ────────────────────────────────── */

/** *AA-02 · 10/100 selesai · Amplas 1 · Finishing 2 · belum mulai 87.* Where
 *  the pieces are, read off the stage counts. */
export function PositionLine({ wo, className }: { wo: Pick<WorkOrderView, "qty" | "stages" | "uom">; className?: string }) {
  const tr = useTr();
  const p = stagePosition(wo);
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums", className)}>
      <strong className="font-semibold text-slate-800">
        {formatNumber(p.complete)}/{formatNumber(p.qty)} {tr("complete", "selesai")}
      </strong>
      {p.at.map((a) => (
        <span key={a.stage} className={a.count > 0 ? "text-slate-700" : "text-slate-400"}
          title={tr(`Past ${a.name}, not yet past the next stage`, `Sudah lewat ${a.name}, belum lewat tahap berikutnya`)}>
          · {a.name} {formatNumber(a.count)}
        </span>
      ))}
      <span className="text-slate-400">· {tr("not started", "belum mulai")} {formatNumber(p.not_started)}</span>
    </span>
  );
}

/* ── recording a timeslot ─────────────────────────────────────────────── */

/** The last full hour on the office clock: at 10.20 it is 09.00–10.00. */
export function lastFullHour(): { from: string; until: string } {
  const h = Number(officeClock().slice(0, 2));
  if (h < 1) return { from: "", until: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${pad(h - 1)}:00`, until: `${pad(h)}:00` };
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** *07.30–09.30 · rakit pintu · Karjo, Toha* — and, only if pieces finished a
 *  stage in it, which stage and how many (D352). */
export function SlotForm({
  wo, activities, onDone, initialDate,
}: {
  wo: WorkOrderView;
  /** What this order has been worked on before, offered as suggestions. */
  activities: string[];
  onDone: () => void;
  /** The day the form opens on — the floor card passes the day it shows. */
  initialDate?: string;
}) {
  const tr = useTr();
  const { toast } = useToast();
  /* The roster, not the employee record: a production admin can read the one
     and not the other, and the picker was empty for exactly them (D355). */
  const [people] = useLoad(() => hr.listWorkRoster(), []);
  const [date, setDate] = useState(initialDate ?? officeToday());
  const [span, setSpan] = useState(lastFullHour);
  const [hours, setHours] = useState(1);
  const [activity, setActivity] = useState("");
  const [workers, setWorkers] = useState<WorkSlotWorker[]>([]);
  const [stage, setStage] = useState("");
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const timed = !!(span.from || span.until);
  /* On the floor card the order is picked in the form and can change under
     it. The people and the hours carry over — the likeliest next slot is the
     same crew on another order — but a stage belongs to one order's list. */
  useEffect(() => { setStage(""); setQty(0); }, [wo.wo_no]);

  async function save() {
    setBusy(true);
    const res = await production.recordWorkSlot({
      wo_no: wo.wo_no, activity, workers, work_date: date,
      /* Half a span is passed as half so the API names it. A finish at or
         before the start is the overnight shift: it belongs to the morning. */
      started_at: span.from ? officeStamp(date, span.from) : null,
      finished_at: span.until ? officeStamp(span.from && span.until <= span.from ? nextDay(date) : date, span.until) : null,
      minutes: timed ? null : Math.round(hours * 60),
      stage: stage || null, qty: stage && qty > 0 ? qty : null, note: note || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Timeslot recorded", "Timeslot tercatat"),
      `${res.data.slot_no} · ${res.data.activity} · ${res.data.workers.map((w) => w.name).join(", ")}`);
    /* The next slot is most likely the same people, straight after. */
    if (span.from && span.until && span.until > span.from) {
      const [h, m] = span.until.split(":").map(Number);
      const len = (h * 60 + m) - (Number(span.from.slice(0, 2)) * 60 + Number(span.from.slice(3)));
      const end = h * 60 + m + len;
      const pad = (n: number) => String(n).padStart(2, "0");
      setSpan({ from: span.until, until: end < 24 * 60 ? `${pad(Math.floor(end / 60))}:${pad(end % 60)}` : "" });
    }
    setActivity(""); setQty(0); setStage(""); setNote("");
    onDone();
  }

  const input = "h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";
  const listId = `act-${wo.wo_no}`;
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
        <Timer className="h-4 w-4 text-slate-400" /> {tr("Record a timeslot", "Catat timeslot")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={tr("Date", "Tanggal")} className={input} />
        {timed ? (
          <>
            <input type="time" value={span.from} onChange={(e) => setSpan({ ...span, from: e.target.value })}
              aria-label={tr("Start time", "Jam mulai")} className={input} />
            <span>–</span>
            <input type="time" value={span.until} onChange={(e) => setSpan({ ...span, until: e.target.value })}
              aria-label={tr("Finish time", "Jam selesai")} className={input} />
            <span className="text-slate-400">{OFFICE_TZ.short}</span>
            <button type="button" onClick={() => setSpan({ from: "", until: "" })}
              className="text-[11px] text-slate-500 underline hover:text-slate-700">
              {tr("only the duration", "lamanya saja")}
            </button>
          </>
        ) : (
          <>
            <NumberInput value={hours} min={0.25} max={16} onChange={setHours} />
            <span>{tr("hours", "jam")}</span>
            <button type="button" onClick={() => setSpan(lastFullHour())} className="text-[11px] text-brand-700 underline">
              {tr("fill in the clock times", "isi jam mulai–selesai")}
            </button>
          </>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={activity} onChange={(e) => setActivity(e.target.value)} list={listId}
          placeholder={tr("What was done — e.g. assemble door, add hinges", "Apa yang dikerjakan — mis. rakit pintu, tambah engsel")}
          aria-label={tr("Activity", "Kegiatan")} className={input}
        />
        <datalist id={listId}>{activities.map((a) => <option key={a} value={a} />)}</datalist>
        {/* A crew is a list of people, never one name with a comma in it.
            Picking links the person; typing a name keeps it as written (D264). */}
        <Combobox
          value=""
          onChange={(v) => {
            const emp = people.status === "ready" ? people.data.find((e) => e.id === v) : undefined;
            if (emp && !workers.some((w) => w.employee_id === emp.id)) {
              setWorkers([...workers, { name: emp.full_name, employee_id: emp.id }]);
            }
          }}
          onCreate={(name) => {
            if (!workers.some((w) => w.name.toLowerCase() === name.trim().toLowerCase())) {
              setWorkers([...workers, { name: name.trim(), employee_id: null }]);
            }
          }}
          createLabel={(q) => tr(`Add “${q}” — not an employee`, `Tambah “${q}” — bukan karyawan`)}
          options={(people.status === "ready" ? people.data : [])
            .filter((e) => !workers.some((w) => w.employee_id === e.id))
            .map((e) => ({ value: e.id, label: e.full_name, sublabel: `${e.employee_no} · ${e.unit}` }))}
          placeholder={workers.length ? tr("Add another person", "Tambah orang") : tr("Who worked on it", "Siapa yang mengerjakan")}
        />
      </div>
      {workers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {workers.map((w) => (
            <Badge key={w.employee_id ?? w.name} tone={w.employee_id ? "slate" : "amber"}>
              {w.name}{!w.employee_id && ` · ${tr("not linked", "belum tertaut")}`}
              <button type="button" onClick={() => setWorkers(workers.filter((x) => x !== w))}
                aria-label={tr(`Remove ${w.name}`, `Hapus ${w.name}`)} className="ml-1"><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_100px_1fr]">
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={tr("Finished a stage", "Selesai tahap")} className={input}>
          <option value="">{tr("No piece finished a stage", "Tidak ada yang selesai tahap")}</option>
          {wo.stages.map((s) => <option key={s.stage} value={s.stage}>{tr(`Finished: ${s.name}`, `Selesai: ${s.name}`)}</option>)}
        </select>
        <NumberInput value={qty} min={0} max={9999} onChange={setQty} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note (optional)", "Catatan (opsional)")} className={input} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {tr(
            "Pieces are optional: most slots finish no stage. When given, they move the board in the same step.",
            "Jumlah boleh kosong: kebanyakan timeslot tidak menyelesaikan tahap. Kalau diisi, papan ikut bergerak sekaligus.",
          )}
        </p>
        <Button size="sm" icon={Plus} onClick={save}
          disabled={busy || !activity.trim() || workers.length === 0 || (!!stage && qty <= 0)}>
          {tr("Record", "Catat")}
        </Button>
      </div>
    </div>
  );
}

/* ── the slots on one order ───────────────────────────────────────────── */

export function SlotList({ slots, onChanged }: { slots: WorkSlotView[]; onChanged: () => void }) {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (slots.length === 0) return null;

  async function voidSlot(slotNo: string) {
    setBusy(true);
    const res = await production.voidWorkSlot({ slot_no: slotNo, reason });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not cancelled", "Tidak dibatalkan"), res.error.message); return; }
    toast("success", tr("Timeslot cancelled", "Timeslot dibatalkan"), slotNo);
    setVoiding(null); setReason("");
    onChanged();
  }

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        <ListChecks className="h-3.5 w-3.5" /> {tr(`Timeslots (${slots.length})`, `Timeslot (${slots.length})`)}
      </p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-[12px]">
        {[...slots].reverse().map((s) => (
          <li key={s.id} className={cn("px-3 py-2", s.voided_at && "bg-slate-50 text-slate-400")}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="w-24 tabular-nums text-slate-500">
                {s.work_date}
                <span className="block text-[11px]">{spanLabel(s) ?? durationLabel(s.minutes, tr("h", "j"), tr("min", "mnt"))}</span>
              </span>
              <span className={cn("flex-1", s.voided_at ? "line-through" : "text-slate-800")}>
                <span className="font-medium">{s.activity}</span>
                <span className="text-slate-500"> — {s.workers.map((w) => w.name).join(", ")}</span>
                {s.stage && s.qty && (
                  <Badge tone="green" className="ml-2">{STAGE_NAME(s.stage)} +{formatNumber(s.qty)}</Badge>
                )}
                {s.source === "overtime_sheet" && <Badge tone="brand" className="ml-2">{tr("overtime", "lembur")} {s.source_ref}</Badge>}
              </span>
              <span className="font-mono text-[10px] text-slate-400">{s.slot_no}</span>
              {!s.voided_at && can("production.update") && voiding !== s.slot_no && (
                <button onClick={() => { setVoiding(s.slot_no); setReason(""); }}
                  className="text-[11px] text-slate-500 underline hover:text-rose-700">{tr("Cancel", "Batalkan")}</button>
              )}
            </div>
            {s.voided_at && <p className="mt-0.5 text-[11px]">{tr("Cancelled", "Dibatalkan")}: {s.void_reason}</p>}
            {voiding === s.slot_no && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                  placeholder={tr("Why — the record stays, this sentence explains it", "Kenapa — catatannya tetap ada, kalimat ini yang menjelaskannya")}
                  className="h-8 min-w-[240px] flex-1 rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none" />
                <Button size="sm" variant="outline" icon={Ban} disabled={busy || !reason.trim()} onClick={() => voidSlot(s.slot_no)}>
                  {tr("Cancel timeslot", "Batalkan timeslot")}
                </Button>
                <button onClick={() => setVoiding(null)} className="text-[11px] text-slate-500 underline">{tr("keep", "jangan")}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── productivity ─────────────────────────────────────────────────────── */

function PeopleTable({ rows, present, stageOrder, roster }: {
  rows: LabourRow[];
  /** Hours present per employee id, where the viewer may read attendance. */
  present?: Map<string, number> | null;
  stageOrder?: string[];
  /** Everybody active, so a person nobody wrote down is a row and not an
   *  absence from the table (D355). */
  roster?: RosterEntry[];
}) {
  const tr = useTr();
  const people = useMemo(() => {
    const unitOf = new Map((roster ?? []).map((r) => [r.id, r.unit]));
    const worked = productivityByPerson(rows).map((p) => ({ ...p, unit: (p.employee_id && unitOf.get(p.employee_id)) || null }));
    if (!roster) return worked;
    const seen = new Set(worked.map((p) => p.employee_id).filter(Boolean));
    const idle = roster.filter((r) => !seen.has(r.id)).map((r) => ({
      key: r.id, name: r.full_name, employee_id: r.id, team: false, minutes: 0, untimed: 0, slots: 0,
      jobs: [] as string[], activities: [] as string[],
      pieces: {} as Record<string, number>, per_hour: {} as Record<string, number>, unit: r.unit as string | null,
    }));
    return [...worked, ...idle.sort((a, b) => a.name.localeCompare(b.name))];
  }, [rows, roster]);
  const h = tr("h", "j"), m = tr("min", "mnt");
  const stageSeq = (s: string) => { const i = stageOrder?.indexOf(s) ?? -1; return i < 0 ? 99 : i; };
  if (people.length === 0) return <p className="px-3 py-3 text-[13px] text-slate-500">{tr("Nobody has recorded work here yet.", "Belum ada yang mencatat pekerjaan di sini.")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-1.5 font-medium">{tr("Name", "Nama")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr("Hours worked", "Jam kerja")}</th>
            {present !== undefined && <th className="px-2 py-1.5 text-right font-medium">{tr("Present / used", "Hadir / terpakai")}</th>}
            <th className="px-2 py-1.5 font-medium">{tr("What", "Mengerjakan")}</th>
            <th className="px-2 py-1.5 font-medium">{tr("Finished (share)", "Selesai (bagian)")}</th>
            <th className="px-3 py-1.5 font-medium">{tr("Per hour", "Per jam")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {people.map((p) => {
            const stages = Object.keys(p.pieces).sort((a, b) => stageSeq(a) - stageSeq(b));
            const here = p.employee_id && present ? present.get(p.employee_id) : undefined;
            const used = here ? Math.round((p.minutes / 60 / here) * 100) : null;
            return (
              <tr key={p.key} className="align-top">
                <td className="px-3 py-1.5 text-slate-800">
                  {p.name}
                  {p.team
                    ? <span className="ml-1 text-[10px] text-slate-400">({tr("team / vendor", "tim / vendor")})</span>
                    : !p.employee_id && <span className="ml-1 text-[10px] text-amber-600">({tr("not linked", "belum tertaut")})</span>}
                  <span className="block text-[10px] text-slate-400">
                    {p.slots > 0
                      ? `${p.slots} ${tr("slots", "timeslot")} · ${p.jobs.length} Job Order`
                      : p.unit || tr("active employee", "karyawan aktif")}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                  {p.minutes > 0 ? durationLabel(p.minutes, h, m) : "—"}
                  {p.untimed > 0 && <span className="block text-[10px] text-slate-400">+{p.untimed} {tr("untimed", "tanpa jam")}</span>}
                </td>
                {present !== undefined && (
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {here === undefined ? <span className="text-slate-300">—</span> : here === 0 ? (
                      /* A day with no attendance reading is not a day at zero
                         hours: nothing to divide by, and said as such. */
                      <span className="text-[11px] text-amber-700">{tr("no attendance", "tanpa absensi")}</span>
                    ) : (
                      <>
                        <span className="text-slate-700">{formatNumber(here)} {h}</span>
                        <span className={cn("block text-[10px]",
                          used === null ? "text-slate-400" : used < 60 ? "text-amber-700" : "text-emerald-700")}>
                          {used === null ? "" : `${used}% ${tr("recorded", "tercatat")}`}
                        </span>
                      </>
                    )}
                  </td>
                )}
                <td className="px-2 py-1.5 text-slate-600">
                  {p.slots === 0
                    ? <span className="text-amber-700">{tr("no timeslot recorded", "belum ada timeslot")}</span>
                    : <>{p.activities.slice(0, 4).join(", ")}{p.activities.length > 4 && ` +${p.activities.length - 4}`}</>}
                </td>
                <td className="px-2 py-1.5 text-slate-700">
                  {stages.length === 0 ? <span className="text-slate-400">—</span>
                    : stages.map((s) => <span key={s} className="block">{STAGE_NAME(s)} {formatNumber(p.pieces[s])}</span>)}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-slate-700">
                  {Object.keys(p.per_hour).length === 0 ? <span className="text-slate-400">—</span>
                    : Object.entries(p.per_hour).map(([s, v]) => <span key={s} className="block">{formatNumber(v)} {STAGE_NAME(s).toLowerCase()}</span>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Who worked on this Job Order, for how long, and what one piece has cost in
 *  person-hours so far (D352). */
export function JobProductivity({ wo, slots, entries }: { wo: WorkOrderView; slots: WorkSlotView[]; entries: ProgressEntry[] }) {
  const tr = useTr();
  const rows = useMemo(() => labourRows(slots, entries, wo), [slots, entries, wo]);
  const sum = useMemo(() => jobLabour(rows, wo.completed), [rows, wo.completed]);
  const h = tr("h", "j"), m = tr("min", "mnt");
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        <Gauge className="h-3.5 w-3.5" /> {tr("Who worked on it, and how productively", "Siapa mengerjakan, dan seberapa produktif")}
      </p>
      <dl className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] sm:grid-cols-4">
        {([
          [tr("Person-hours", "Jam-orang"), sum.person_minutes > 0 ? durationLabel(sum.person_minutes, h, m) : "—",
            sum.untimed > 0 ? tr(`+${sum.untimed} rows untimed`, `+${sum.untimed} baris tanpa jam`) : tr("all timed", "semua berjam")],
          [tr("People", "Orang"), String(sum.people), tr(`${sum.slots} slots`, `${sum.slots} timeslot`)],
          [tr("Worked", "Dikerjakan"), sum.first_day ? (sum.first_day === sum.last_day ? sum.first_day : `${sum.first_day} – ${sum.last_day}`) : "—", ""],
          [tr("Per finished piece", "Per unit selesai"), sum.per_complete === null ? "—" : durationLabel(sum.per_complete, h, m),
            sum.per_complete === null
              ? tr("nothing finished yet", "belum ada yang selesai")
              : tr(`person-hours over ${formatNumber(wo.completed)} finished`, `jam-orang ÷ ${formatNumber(wo.completed)} selesai`)],
        ] as [string, string, string][]).map(([k, v, n]) => (
          <div key={k}>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{v}</dd>
            {n && <p className="text-[10px] text-slate-500">{n}</p>}
          </div>
        ))}
      </dl>
      <div className="rounded-xl border border-slate-200">
        <PeopleTable rows={rows} stageOrder={wo.stages.map((s) => s.stage)} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {tr(
          "A crew's pieces are shared equally between the people on the slot — pieces per person-hour, the usual labour measure, not a claim about whose hands did which piece. Rates are per stage and never added across stages.",
          "Hasil satu kru dibagi rata ke orang-orang di timeslot itu — ukuran unit per jam-orang yang lazim, bukan klaim tangan siapa yang mengerjakan unit mana. Laju dihitung per tahap dan tidak pernah dijumlah lintas tahap.",
        )}
      </p>
    </div>
  );
}

/* ── the floor ────────────────────────────────────────────────────────── */

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Recording a timeslot from the floor card, the Job Order picked in the form
 *  (D355). Walking the floor every two hours is twenty people across several
 *  orders; opening each order's drawer in turn was the slow part. The crew and
 *  the hours stay when the order changes, because the next slot is most often
 *  the same people on another order. */
function FloorRecorder({ day, activities, onDone }: { day: string; activities: string[]; onDone: () => void }) {
  const tr = useTr();
  const [orders] = useLoad(() => production.listWorkOrders(), []);
  const [woNo, setWoNo] = useState("");
  /* The same predicate the API refuses on (F75): open, and goods in the
     building. An order whose pieces are all at the vendor is not offered. */
  const open = orders.status === "ready" ? orders.data.filter((w) => w.status === "OPEN" && w.goods_on_site) : [];
  const wo = open.find((w) => w.wo_no === woNo);
  return (
    <div className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <Combobox
        value={woNo}
        onChange={setWoNo}
        options={open.map((w) => {
          const p = stagePosition(w);
          return {
            value: w.wo_no,
            label: `${w.wo_no} · ${w.item_name}`,
            sublabel: `${formatNumber(p.complete)}/${formatNumber(p.qty)} ${tr("complete", "selesai")}${w.project_code ? ` · ${w.project_code}` : ""}`,
          };
        })}
        placeholder={orders.status === "loading" ? tr("Loading Job Orders…", "Memuat Job Order…") : tr("Which Job Order", "Job Order yang mana")}
      />
      {wo ? (
        <SlotForm wo={wo} activities={activities} onDone={onDone} initialDate={day} />
      ) : (
        <p className="text-[12px] text-slate-500">
          {tr(
            "Pick the Job Order first; the people and the hours stay when you switch to the next one.",
            "Pilih Job Order dulu; orang dan jamnya tetap saat pindah ke Job Order berikutnya.",
          )}
        </p>
      )}
    </div>
  );
}

/** The whole floor over one day or a week: the timeslots as the floor wrote
 *  them, productivity per person (against their attendance, where the viewer
 *  may read it), and the pieces hour by hour (D351, D352). */
export function FloorPanel() {
  const tr = useTr();
  const { can } = useSession();
  const [day, setDay] = useState(officeToday());
  const [span, setSpan] = useState<1 | 7>(1);
  const [tab, setTab] = useState<"slots" | "people" | "hours" | "targets">("slots");
  const [recording, setRecording] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const from = span === 1 ? day : addDays(day, -6);
  const [slots, reload] = useLoad(() => production.listWorkSlots({ from, to: day }), [from, day]);
  /* Everybody active, so the per-person tab also shows who nobody wrote down —
     the owner's rule where attendance cannot be read (D355). */
  const [roster] = useLoad(() => hr.listWorkRoster(), []);
  /* Attendance is HR's (ADR-004) and not everybody reading production may
     read it. Refused is fine: the column says so rather than the page failing. */
  const [sheet] = useLoad(() => hr.getTimesheet({ from, to: day }), [from, day]);
  const present = useMemo(() => {
    if (sheet.status !== "ready") return null;
    const m = new Map<string, number>();
    for (const d of sheet.data.days) m.set(d.employee_id, (m.get(d.employee_id) ?? 0) + d.work_hours);
    return m;
  }, [sheet]);

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("The floor: who worked on what", "Lantai produksi: siapa mengerjakan apa")}
        subtitle={tr(
          "Timeslots as the floor recorded them, each person's hours and output, and the pieces hour by hour.",
          "Timeslot sebagaimana dicatat lantai, jam dan hasil tiap orang, dan hasil per jam.",
        )}
        icon={Clock}
        action={(
          <span className="flex flex-wrap items-center gap-2">
            {([[1, tr("Day", "Hari")], [7, tr("7 days", "7 hari")]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setSpan(k)}
                className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  span === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>{label}</button>
            ))}
            <input type="date" value={day} onChange={(e) => setDay(e.target.value || officeToday())}
              aria-label={tr("Day", "Hari")}
              className="h-8 rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none" />
            <SourceBadge state={slots} />
          </span>
        )}
      />
      <div className="flex flex-wrap gap-1 border-b border-slate-100 px-4 py-2">
        {([["slots", tr("Timeslots", "Timeslot")], ["people", tr("Per person", "Per orang")], ["hours", tr("Pieces per hour", "Hasil per jam")], ["targets", tr("Targets", "Target")]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium",
              tab === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>{label}</button>
        ))}
        <span className="ml-auto flex items-center gap-3 self-center">
          {span === 7 && <span className="text-[11px] text-slate-500">{from} – {day}</span>}
          {can("production.update") && (
            <Button size="sm" variant={recording ? "ghost" : "outline"} icon={recording ? X : Timer}
              onClick={() => setRecording(!recording)}>
              {recording ? tr("Close", "Tutup") : tr("Record a timeslot", "Catat timeslot")}
            </Button>
          )}
        </span>
      </div>
      {recording && (
        <FloorRecorder
          day={day}
          activities={slots.status === "ready" ? [...new Set(slots.data.map((x) => x.activity))] : []}
          onDone={reload}
        />
      )}
      {tab === "targets" ? (
        /* D356: target against what was done, per Job Order, day and stage. */
        <TargetsTab from={from} to={day} day={day} />
      ) : tab === "hours" ? (
        span === 1
          ? <FloorHourly day={day} />
          : <p className="px-5 py-4 text-[13px] text-slate-500">{tr("Pieces per hour is read one day at a time.", "Hasil per jam dibaca per hari.")}</p>
      ) : (
        <Loaded state={slots} onRetry={reload} skeletonRows={3}>
          {(all) => {
            const live = all.filter((s) => !s.voided_at);
            if (tab === "people") {
              const everyone = roster.status === "ready" ? roster.data : [];
              /* The unit the floor's own people are in, read off who was on a
                 slot; everyone else is one tap away. */
              const onSlots = new Set(live.flatMap((x) => x.workers.map((w) => w.employee_id)).filter(Boolean));
              const counts = new Map<string, number>();
              for (const r of everyone) if (r.unit && onSlots.has(r.id)) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
              const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
              const shown = unit === null ? usual : unit === "" ? null : unit;
              const units = [...new Set(everyone.map((r) => r.unit).filter((u): u is string => !!u))].sort();
              return (
                <>
                  {units.length > 1 && (
                    <div className="flex flex-wrap gap-1 border-b border-slate-100 px-4 py-2 text-[11px]">
                      {[["", tr("All units", "Semua unit")] as const, ...units.map((u) => [u, u] as const)].map(([k, label]) => (
                        <button key={k || "all"} onClick={() => setUnit(k)}
                          className={cn("rounded-full px-2 py-0.5 font-medium",
                            (shown ?? "") === k ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-100")}>{label}</button>
                      ))}
                    </div>
                  )}
                  <PeopleTable rows={labourRows(live)} present={present}
                    roster={everyone.filter((r) => !shown || r.unit === shown)} />
                  <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                    {present === null
                      ? tr(
                        "Attendance cannot be read with this access, so the list is every active employee instead: a row with no timeslot is somebody nobody wrote down.",
                        "Absensi tidak bisa dibaca dengan akses ini, jadi yang ditampilkan adalah semua karyawan aktif: baris tanpa timeslot berarti orang yang belum dicatat siapa pun.",
                      )
                      : tr(
                        "Present is the attendance reading (in the building, break subtracted). Recorded is the share of it written into timeslots — a low share is hours nobody wrote down, not necessarily idle hours.",
                        "Hadir adalah bacaan absensi (di dalam gedung, dikurangi istirahat). Tercatat adalah bagian yang ditulis ke timeslot — bagian yang rendah berarti jam yang tidak dicatat siapa pun, belum tentu jam menganggur.",
                      )}
                  </p>
                </>
              );
            }
            if (live.length === 0) {
              return <p className="px-5 py-4 text-[13px] text-slate-500">{tr("No timeslot recorded in this period.", "Belum ada timeslot pada periode ini.")}</p>;
            }
            return (
              <ul className="divide-y divide-slate-100 text-[12px]">
                {live.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2">
                    <span className="w-32 shrink-0 tabular-nums text-slate-500">
                      {span === 7 && <span className="mr-1">{s.work_date.slice(5)}</span>}
                      {spanLabel(s) ?? durationLabel(s.minutes, tr("h", "j"), tr("min", "mnt"))}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{s.wo_no}</span>
                    <span className="text-slate-500">{s.item_name}</span>
                    <span className="font-medium text-slate-800">{s.activity}</span>
                    <span className="text-slate-600">— {s.workers.map((w) => w.name).join(", ")}</span>
                    {s.stage && s.qty && <Badge tone="green">{STAGE_NAME(s.stage)} +{formatNumber(s.qty)} {s.uom}</Badge>}
                  </li>
                ))}
              </ul>
            );
          }}
        </Loaded>
      )}
    </Card>
  );
}
