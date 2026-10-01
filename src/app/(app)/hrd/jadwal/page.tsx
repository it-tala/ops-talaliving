"use client";

import { useState } from "react";
import { CalendarClock, AlertTriangle, Users, Link2, Moon, Pencil, Plus, CalendarDays, Repeat, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Combobox } from "@/components/ui/combobox";
import { formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { officeToday } from "@/lib/office";
import { NumberInput } from "@/components/ui/number-input";
import {
  dayBoundaryMinutes, isOvernight, scheduleHoursOf, scheduleWeek, scheduleProblem, shiftMinutes, WEEKDAY_NAMES,
  SATPAM_SHIFTS, type ScheduleDay, type ScheduleShift,
} from "@/services/hr/schedule-rules";
import type { WorkSchedule } from "@/services/hr/contracts";

/** Working patterns, and who is on them (Q53, D279).
 *
 *  HR asked for two things and the second is what keeps the first honest:
 *  set the patterns up, and **see the total hours per week and per month**.
 *
 *  Every figure on this screen is derived from the times in the rule book —
 *  a schedule holds a start, an end and a break, and the week and the month
 *  are arithmetic over them, printed with their working so a person can check
 *  it rather than believe it. Where a pattern is missing a piece the figures
 *  are **blank with the reason**, never zero: the guard's twelve hours begin
 *  at a time nobody has fixed, and a zero there would be a number HR could
 *  plan against about a person nobody has written the hours down for.
 *
 *  The unlinked list exists for the same reason. A person with no pattern has
 *  no clock to be judged against, and quietly putting them on the office one
 *  is the mistake this whole line of questions started from (F70).
 */
export default function SchedulePage() {
  const tr = useTr();
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [data, reload] = useLoad(() => hr.listSchedules(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingDays, setEditingDays] = useState<string | null>(null);
  const [editingShifts, setEditingShifts] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Work schedules", "Jadwal kerja")}
        description={tr(
          "The working patterns this company actually runs, who is on each, and how many hours a week and a month they make. The figures are computed from start time, end time and break — nothing is stored twice.",
          "Pola kerja yang benar-benar dijalankan perusahaan ini, siapa yang ada di masing-masing, dan berapa jam seminggu serta sebulannya. Angkanya dihitung dari jam masuk, jam pulang dan istirahat — tidak ada yang disimpan dua kali.",
        )}
      />

      <Loaded state={data} onRetry={reload}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={tr("Work patterns", "Pola kerja")} value={String(d.schedules.length)} icon={CalendarClock} />
              <StatCard
                label={tr("Set by HR", "Ditetapkan HR")}
                value={String(d.schedules.reduce((t, sc) => t + sc.assigned, 0))}
                icon={Link2}
              />
              {/* Not amber any more. The owner ruled that a unit's default **is**
                  the decision (D281), so following it is an ordinary state and
                  not a gap somebody has to close. What stays worth flagging is
                  a person on no pattern at all, and that is the tile below. */}
              <StatCard
                label={tr("Following unit default", "Ikut bawaan unit")}
                value={String(d.inherited.length)}
                icon={Users}
              />
              <StatCard
                label={tr("Incomplete patterns", "Pola belum lengkap")}
                value={String(d.schedules.filter((sc) => sc.hours.blocked_by).length)}
                icon={AlertTriangle}
                tone={d.schedules.some((sc) => sc.hours.blocked_by) ? "amber" : "slate"}
              />
            </div>

            <Card className="mb-4">
              <CardHeader
                title={tr("Work patterns", "Pola kerja")}
                subtitle={tr(
                  `A ${d.week_pattern === "5day" ? "five" : "six"}-day working week. Weekly hours count Friday at its own length when its break differs — half an hour on one day in six is nearly an hour a week.`,
                  `Pola ${d.week_pattern === "5day" ? "lima" : "enam"} hari kerja seminggu. Jam seminggu menghitung Jumat dengan panjangnya sendiri kalau istirahatnya beda — selisih setengah jam pada satu hari dari enam hampir satu jam seminggu.`,
                )}
                icon={CalendarClock}
                action={
                  <div className="flex items-center gap-2">
                    {/* HRD adds a pattern here rather than asking IT to
                        republish the whole rule book (D335). */}
                    {mayEdit && (
                      <Button size="sm" variant="outline" icon={Plus}
                        onClick={() => { setAdding(true); setEditing(null); }}>
                        {tr("Add pattern", "Tambah pola")}
                      </Button>
                    )}
                    <SourceBadge state={data} />
                  </div>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2 font-medium">{tr("Pattern", "Pola")}</th>
                      <th className="px-3 py-2 font-medium">{tr("Hours", "Jam")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Per day", "Sehari")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Friday", "Jumat")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Per week", "Seminggu")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Per month", "Sebulan")}</th>
                      <th className="px-5 py-2 text-right font-medium">{tr("People", "Orang")}</th>
                      {mayEdit && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.schedules.map((sc) => (
                      <tr key={sc.code} className="align-top">
                        <td className="px-5 py-2.5">
                          <span className="block font-medium text-slate-800">{sc.name}</span>
                          <span className="block text-[11px] text-slate-400">
                            {sc.units.length > 0 ? sc.units.join(", ") : tr("not assigned to any unit", "tidak dipasang ke unit mana pun")}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">
                          {clock(sc.start_minutes)} – {clock(sc.end_minutes)}
                          {/* A default nobody has confirmed must not look like an
                              answer (D288): the guard's 19.00–07.00 is D330's
                              assumption until HRD saves it. */}
                          {sc.hours_unconfirmed && (
                            <Badge tone="amber" className="ml-1.5">{tr("unconfirmed", "belum dikonfirmasi")}</Badge>
                          )}
                          {sc.overnight && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-indigo-700">
                              <Moon className="h-3 w-3" />
                              {tr(
                                `across midnight · the next day begins ${clock(sc.day_boundary_minutes)}`,
                                `lewat tengah malam · hari berikutnya mulai ${clock(sc.day_boundary_minutes)}`,
                              )}
                            </span>
                          )}
                          <span className="block text-[11px] text-slate-400">
                            {tr("break", "istirahat")} {sc.break_minutes == null ? "—" : `${sc.break_minutes} m`}
                            {/* Jumat disebut hanya kalau ia memang berbeda, dan
                                disebut lengkap: jam pulangnya lebih dulu, karena
                                itu yang orang rasakan, lalu istirahatnya. */}
                            {(sc.friday_end_minutes != null || sc.friday_break_minutes != null) && (
                              <> · {tr("Friday", "Jumat")}
                                {sc.friday_end_minutes != null && tr(` until ${clock(sc.friday_end_minutes)}`, ` s/d ${clock(sc.friday_end_minutes)}`)}
                                {sc.friday_break_minutes != null && tr(` break ${sc.friday_break_minutes} m`, ` istirahat ${sc.friday_break_minutes} m`)}
                              </>
                            )}
                          </span>
                          {/* The seven days as the reading sees them (D340). */}
                          <WeekStrip week={sc.week ?? scheduleWeek(sc)} />
                          {/* D364: the shifts read off the taps. */}
                          {(sc.shifts ?? []).length > 0 && (
                            <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                              <Repeat className="h-3 w-3 text-slate-400" />
                              {(sc.shifts ?? []).map((x) => (
                                <Badge key={x.code} tone="violet">
                                  {x.code} · {clock(x.start_minutes)}–{clock(x.end_minutes)}
                                </Badge>
                              ))}
                              <span className="text-slate-400">{tr("read from taps", "dibaca dari tap")}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{hours(sc.hours.daily_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{hours(sc.hours.friday_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{hours(sc.hours.weekly_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{hours(sc.hours.monthly_hours)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">
                          {sc.assigned + sc.inherited}
                          {sc.inherited > 0 && (
                            <span className="block text-[11px] text-slate-400">{tr(`${sc.inherited} via unit`, `${sc.inherited} ikut unit`)}</span>
                          )}
                        </td>
                        {mayEdit && (
                          <td className="px-3 py-2.5 text-right">
                            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setEditing(editing === sc.code ? null : sc.code); setEditingDays(null); setEditingShifts(null); setAdding(false); }}>
                              {tr("Hours", "Jam")}
                            </Button>
                            <Button size="sm" variant="ghost" icon={CalendarDays} onClick={() => { setEditingDays(editingDays === sc.code ? null : sc.code); setEditing(null); setEditingShifts(null); setAdding(false); }}>
                              {tr("Per day", "Per hari")}
                            </Button>
                            <Button size="sm" variant="ghost" icon={Repeat} onClick={() => { setEditingShifts(editingShifts === sc.code ? null : sc.code); setEditing(null); setEditingDays(null); setAdding(false); }}>
                              {tr("Shifts", "Shift")}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.schedules.filter((sc) => sc.hours_unconfirmed).map((sc) => (
                <p key={`u-${sc.code}`} className="border-t border-slate-100 px-5 py-2 text-[12px] text-amber-800">
                  <strong>{sc.name}:</strong>{" "}
                  {tr(
                    `${clock(sc.start_minutes)}–${clock(sc.end_minutes)} is a default nobody has confirmed. The owner said twelve hours across midnight, not from when — and whether guards rotate between day and night weeks has not been said either, so each person is on one pattern. Saving the hours here confirms them.`,
                    `${clock(sc.start_minutes)}–${clock(sc.end_minutes)} adalah default yang belum dikonfirmasi siapa pun. Pemilik menyebut dua belas jam lewat tengah malam, bukan mulai jam berapa — dan apakah satpam bergilir minggu siang dan malam juga belum disebut, jadi setiap orang ada di satu pola. Menyimpan jamnya di sini berarti mengonfirmasinya.`,
                  )}
                </p>
              ))}
              {d.schedules.filter((sc) => sc.hours.blocked_by).map((sc) => (
                <p key={sc.code} className="border-t border-slate-100 px-5 py-2 text-[12px] text-amber-800">
                  <strong>{sc.name}:</strong> {sc.hours.blocked_by}{" "}
                  {sc.note && <span className="text-amber-700">{sc.note}</span>}
                </p>
              ))}
              <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                {tr(
                  "Per month = per week × 52 ÷ 12. Not stored anywhere — two figures that must agree are the easiest way to make them disagree.",
                  "Sebulan = seminggu × 52 ÷ 12. Tidak disimpan di mana pun — dua angka yang harus cocok adalah cara paling mudah membuatnya tidak cocok.",
                )}
              </p>
            </Card>

            {mayEdit && adding && (
              <AddSchedule
                existing={d.schedules.map((sc) => sc.code)}
                daysPerWeek={d.week_pattern === "5day" ? 5 : 6}
                onClose={() => setAdding(false)}
                onDone={() => { setAdding(false); reload(); }}
              />
            )}

            {mayEdit && editing && d.schedules.find((sc) => sc.code === editing) && (
              <EditHours
                key={editing}
                schedule={d.schedules.find((sc) => sc.code === editing)!}
                daysPerWeek={d.week_pattern === "5day" ? 5 : 6}
                onClose={() => setEditing(null)}
                onDone={() => { setEditing(null); reload(); }}
              />
            )}

            {mayEdit && editingDays && d.schedules.find((sc) => sc.code === editingDays) && (
              <EditDays
                key={`days-${editingDays}`}
                schedule={d.schedules.find((sc) => sc.code === editingDays)!}
                onClose={() => setEditingDays(null)}
                onDone={() => { setEditingDays(null); reload(); }}
              />
            )}

            {mayEdit && editingShifts && d.schedules.find((sc) => sc.code === editingShifts) && (
              <EditShifts
                key={`shifts-${editingShifts}`}
                schedule={d.schedules.find((sc) => sc.code === editingShifts)!}
                others={d.schedules.filter((sc) => sc.code !== editingShifts)}
                onClose={() => setEditingShifts(null)}
                onDone={() => { setEditingShifts(null); reload(); }}
              />
            )}

            {d.unlinked.length > 0 ? (
              <Card>
                <CardHeader
                  title={tr(`${d.unlinked.length} employees have no schedule yet`, `${d.unlinked.length} karyawan belum punya jadwal`)}
                  subtitle={tr(
                    "Their unit has no default pattern either, so there are no hours to judge their punctuality against. It does not mean they are never late — it means nobody has written the hours down yet.",
                    "Unitnya juga tidak punya pola bawaan, jadi tidak ada jam yang bisa dipakai menilai ketepatan waktu mereka. Bukan berarti mereka tidak pernah terlambat — berarti belum ada yang menuliskan jamnya.",
                  )}
                  icon={AlertTriangle}
                />
                <ul className="divide-y divide-slate-100">
                  {d.unlinked.map((e) => (
                    <AssignRow
                      key={e.employee_no} row={e} mayEdit={mayEdit}
                      options={d.schedules.map((sc) => ({ value: sc.code, label: sc.name, sublabel: tr(`${hours(sc.hours.weekly_hours)} h/week`, `${hours(sc.hours.weekly_hours)} jam/minggu`) }))}
                      onDone={reload}
                    />
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState
                icon={Users}
                title={tr("Every active employee has a schedule", "Semua karyawan aktif sudah punya jadwal")}
                description={tr(
                  "Every person is linked to one work pattern, through their unit or through their own schedule.",
                  "Setiap orang tertaut ke satu pola kerja, lewat unitnya atau lewat jadwalnya sendiri.",
                )}
              />
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}

/** Minutes from midnight as a clock face, and an **honest blank** where the
 *  business has not stated one — never 00.00, which reads as midnight. */
function clock(minutes: number | null): string {
  if (minutes == null) return "—";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
}

/** Null propagates all the way to the cell: a pattern missing a piece has no
 *  week, and the reason is printed under the table rather than as a zero. */
function hours(n: number | null): string {
  return n == null ? "—" : formatNumber(n);
}

function AssignRow({
  row, options, mayEdit, suggestion, onDone,
}: {
  row: { employee_no: string; full_name: string; unit: string };
  options: { value: string; label: string; sublabel: string }[];
  mayEdit: boolean;
  /** What their unit already implies. Pre-selected so confirming is one click,
   *  and still a choice — the software proposes, a person decides (D264). */
  suggestion?: string;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [picked, setPicked] = useState(suggestion ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await hr.setEmployeeSchedule({ employee_no: row.employee_no, schedule_code: picked });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved yet", "Belum tersimpan"), res.error.message);
      return;
    }
    toast("success", row.full_name, tr(`Assigned to schedule ${picked}.`, `Dipasang ke jadwal ${picked}.`));
    onDone();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <span className="min-w-[180px] flex-1">
        <span className="block text-[13px] font-medium text-slate-800">{row.full_name}</span>
        <span className="block text-[11px] text-slate-400">{row.employee_no} · {row.unit}</span>
      </span>
      <Badge tone="amber">{suggestion ? tr("via unit", "ikut unit") : tr("no schedule", "tanpa jadwal")}</Badge>
      {mayEdit && (
        <>
          <div className="w-[240px]">
            <Combobox options={options} value={picked} onChange={setPicked} placeholder={tr("Choose work pattern…", "Pilih pola kerja…")} />
          </div>
          <Button size="sm" icon={Link2} disabled={busy || !picked} onClick={save}>{tr("Assign", "Pasang")}</Button>
        </>
      )}
    </li>
  );
}

/** "HH:MM" from an `<input type="time">`, as minutes from midnight — or null
 *  when the field is empty, which is an answer (*belum ditetapkan*), not 00.00. */
function minutesOfClock(v: string): number | null {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

function clockInput(minutes: number | null): string {
  return minutes == null ? "" : clock(minutes).replace(".", ":");
}

/** HRD sets one pattern's start, end and break (D330).
 *
 *  Saved as a new dated version of the rule book with everything else copied,
 *  so the book's own history is *when did the guard's hours change and who
 *  changed them*. The date defaults to today and cannot silently reach back
 *  past money already paid — the seam refuses that, with the sentence.
 *
 *  What the form works out before saving is only what the reading will do
 *  with it: whether the pattern crosses midnight, where the next day begins,
 *  and the hours a day — the same pure functions the demo and `/it/aturan-gaji`
 *  use, so this is a preview of the rule and not a second copy of it.
 */
function EditHours({
  schedule, daysPerWeek, onClose, onDone,
}: {
  schedule: WorkSchedule;
  daysPerWeek: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [start, setStart] = useState(clockInput(schedule.start_minutes));
  const [end, setEnd] = useState(clockInput(schedule.end_minutes));
  const [breakMin, setBreakMin] = useState<number>(schedule.break_minutes ?? 0);
  const [from, setFrom] = useState(officeToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const draft: WorkSchedule = {
    ...schedule,
    start_minutes: minutesOfClock(start),
    end_minutes: minutesOfClock(end),
    break_minutes: breakMin,
  };
  const night = isOvernight(draft);
  const hoursADay = scheduleHoursOf(draft, daysPerWeek).daily_hours;

  async function save() {
    setBusy(true);
    const res = await hr.setScheduleHours({
      code: schedule.code,
      start_minutes: draft.start_minutes,
      end_minutes: draft.end_minutes,
      break_minutes: draft.break_minutes,
      effective_from: from,
      note,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved yet", "Belum tersimpan"), res.error.message);
      return;
    }
    toast("success", schedule.name, tr(
      `Hours saved as rule book v${res.data.version}, in force from ${res.data.effective_from}.`,
      `Jam tersimpan sebagai buku aturan v${res.data.version}, berlaku mulai ${res.data.effective_from}.`,
    ));
    onDone();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr(`Hours for ${schedule.name}`, `Jam untuk ${schedule.name}`)}
        subtitle={tr(
          "Saved as a new dated version of the rule book; every other rule is copied unchanged. An end earlier than the start is a night shift.",
          "Disimpan sebagai versi buku aturan baru yang bertanggal; aturan lain disalin tanpa berubah. Jam pulang yang lebih awal dari jam masuk berarti shift malam.",
        )}
        icon={Pencil}
      />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
        <label className="text-[12px] text-slate-600">
          {tr("Start", "Masuk")}
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("End", "Pulang")}
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("Break (minutes)", "Istirahat (menit)")}
          <NumberInput value={breakMin} onChange={setBreakMin} min={0} max={1440} className="mt-1" />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("In force from", "Berlaku mulai")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2">
          {tr("Why", "Alasan")}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("Who said so — head of security, the owner…", "Siapa yang menetapkan — kepala keamanan, pemilik…")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
      </div>
      <div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-600">
        {hoursADay != null && (
          <p>{tr(`${formatNumber(hoursADay)} working hours a day.`, `${formatNumber(hoursADay)} jam kerja sehari.`)}</p>
        )}
        {night && (
          <p className="mt-0.5 flex items-center gap-1 text-indigo-700">
            <Moon className="h-3 w-3" />
            {tr(
              `Night shift: taps before ${clock(dayBoundaryMinutes(draft))} are read into the night before, so the morning pulang counts on the day the shift started.`,
              `Shift malam: tap sebelum ${clock(dayBoundaryMinutes(draft))} dibaca ke malam sebelumnya, jadi pulang pagi dihitung pada hari shift dimulai.`,
            )}
          </p>
        )}
        {schedule.hours_unconfirmed && (
          <p className="mt-0.5 text-amber-800">
            {tr("Saving confirms these hours — the unconfirmed mark goes.", "Menyimpan berarti mengonfirmasi jam ini — tanda belum dikonfirmasi hilang.")}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" onClick={save} disabled={busy || !note.trim()}>{tr("Save hours", "Simpan jam")}</Button>
      </div>
    </Card>
  );
}

/** An optional minutes field: empty is null — *nobody has said* (D274), or
 *  for Friday *same as any other day* (D289) — never zero. */
function optionalMinutes(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** HRD adds a working pattern (D335).
 *
 *  A new dated version of the rule book with this pattern appended and every
 *  other rule copied, refused on the same terms as the database — a night
 *  such as 19.00–07.00 is fine, an equal start and end is not. What the form
 *  shows before saving is the rule the reading will apply, from the same pure
 *  functions the demo and `/it/aturan-gaji` use. Removing a pattern and a
 *  unit's default stay with IT: people can be on a pattern, and a unit default
 *  changes what a whole unit is measured against.
 */
function AddSchedule({
  existing, daysPerWeek, onClose, onDone,
}: {
  existing: string[];
  daysPerWeek: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [breakMin, setBreakMin] = useState("");
  const [fridayBreak, setFridayBreak] = useState("");
  const [fridayEnd, setFridayEnd] = useState("");
  const [patternNote, setPatternNote] = useState("");
  const [from, setFrom] = useState(officeToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const draft: WorkSchedule = {
    code, name,
    start_minutes: minutesOfClock(start),
    end_minutes: minutesOfClock(end),
    break_minutes: optionalMinutes(breakMin),
    friday_break_minutes: optionalMinutes(fridayBreak),
    friday_end_minutes: minutesOfClock(fridayEnd),
    note: patternNote.trim() || null,
  };
  const night = isOvernight(draft);
  const hours = scheduleHoursOf(draft, daysPerWeek);
  const taken = existing.includes(code.trim());

  async function save() {
    setBusy(true);
    const res = await hr.addSchedule({
      code: code.trim(),
      name,
      start_minutes: draft.start_minutes,
      end_minutes: draft.end_minutes,
      break_minutes: draft.break_minutes,
      friday_break_minutes: draft.friday_break_minutes,
      friday_end_minutes: draft.friday_end_minutes,
      pattern_note: draft.note,
      effective_from: from,
      note,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved yet", "Belum tersimpan"), res.error.message);
      return;
    }
    toast("success", name || res.data.code, tr(
      `Pattern added as rule book v${res.data.version}, in force from ${res.data.effective_from}. Assign people to it from the list below or from their employee record.`,
      `Pola ditambahkan sebagai buku aturan v${res.data.version}, berlaku mulai ${res.data.effective_from}. Pasang orangnya dari daftar di bawah atau dari data karyawannya.`,
    ));
    onDone();
  }

  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Add a work pattern", "Tambah pola kerja")}
        subtitle={tr(
          "Saved as a new dated version of the rule book with this pattern added; every other rule is copied unchanged. An end earlier than the start is a night shift. Leave a time empty if nobody has said it yet — it stays blank, never 00.00.",
          "Disimpan sebagai versi buku aturan baru yang bertanggal dengan pola ini ditambahkan; aturan lain disalin tanpa berubah. Jam pulang yang lebih awal dari jam masuk berarti shift malam. Kosongkan jam yang belum pernah disebut — tetap kosong, bukan 00.00.",
        )}
        icon={Plus}
      />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
        <label className="text-[12px] text-slate-600">
          {tr("Code", "Kode")}
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
            placeholder="SATPAM" className={`${field} font-mono`} />
          {taken && (
            <span className="mt-0.5 block text-[11px] text-amber-800">
              {tr("Already a pattern — change its hours with the Hours button on its row.", "Sudah ada — ubah jamnya dengan tombol Jam di barisnya.")}
            </span>
          )}
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2">
          {tr("Name", "Nama")}
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={tr("Security — 12 hours", "Satpam — 12 jam")} className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("Start", "Masuk")}
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("End", "Pulang")}
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("Break (minutes)", "Istirahat (menit)")}
          <input inputMode="numeric" value={breakMin} onChange={(e) => setBreakMin(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="60" className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("Friday break (minutes, optional)", "Istirahat Jumat (menit, opsional)")}
          <input inputMode="numeric" value={fridayBreak} onChange={(e) => setFridayBreak(e.target.value.replace(/[^0-9]/g, ""))}
            className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("Friday end (optional)", "Pulang Jumat (opsional)")}
          <input type="time" value={fridayEnd} onChange={(e) => setFridayEnd(e.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          {tr("In force from", "Berlaku mulai")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-3">
          {tr("About this pattern (optional)", "Keterangan pola (opsional)")}
          <input value={patternNote} onChange={(e) => setPatternNote(e.target.value)}
            placeholder={tr("Warehouse guard post, rotates…", "Pos jaga gudang, bergilir…")} className={field} />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-3">
          {tr("Why", "Alasan")}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("Who decided — the owner, head of security…", "Siapa yang memutuskan — pemilik, kepala keamanan…")}
            className={field} />
        </label>
      </div>
      <div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-600">
        {hours.daily_hours != null ? (
          <p>{tr(
            `${formatNumber(hours.daily_hours)} working hours a day · ${formatNumber(hours.weekly_hours as number)} a week.`,
            `${formatNumber(hours.daily_hours)} jam kerja sehari · ${formatNumber(hours.weekly_hours as number)} seminggu.`,
          )}</p>
        ) : (
          <p className="text-slate-500">{hours.blocked_by}</p>
        )}
        {night && (
          <p className="mt-0.5 flex items-center gap-1 text-indigo-700">
            <Moon className="h-3 w-3" />
            {tr(
              `Night shift: taps before ${clock(dayBoundaryMinutes(draft))} are read into the night before, so the morning pulang counts on the day the shift started.`,
              `Shift malam: tap sebelum ${clock(dayBoundaryMinutes(draft))} dibaca ke malam sebelumnya, jadi pulang pagi dihitung pada hari shift dimulai.`,
            )}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Plus} onClick={save}
          disabled={busy || !code.trim() || !name.trim() || !note.trim() || taken}>
          {tr("Add pattern", "Tambah pola")}
        </Button>
      </div>
    </Card>
  );
}

/** The seven days of a pattern in one line: what each weekday reads as, and
 *  the ones worth more than a day marked (D340). */
function WeekStrip({ week }: { week: ReturnType<typeof scheduleWeek> }) {
  const tr = useTr();
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {week.map((w) => (
        <span
          key={w.isodow}
          title={w.off ? tr("day off", "libur")
            : `${clock(w.start_minutes)}–${clock(w.end_minutes)} · ${tr("break", "istirahat")} ${w.break_minutes ?? 0} m${w.pay_multiplier !== 1 ? ` · ${w.pay_multiplier}×` : ""}`}
          className={
            "rounded px-1 py-0.5 text-[10px] tabular-nums " +
            (w.off ? "bg-slate-100 text-slate-400"
              : w.pay_multiplier > 1 ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                : w.own ? "bg-brand-50 text-brand-800" : "bg-slate-50 text-slate-600")
          }
        >
          {WEEKDAY_NAMES[w.isodow - 1].slice(0, 3)} {w.off ? "—" : hours(w.hours)}
          {!w.off && w.pay_multiplier !== 1 && ` ×${w.pay_multiplier}`}
        </span>
      ))}
    </span>
  );
}

interface DayDraft {
  /** Follows the pattern's ordinary hours (Friday its Friday ones). */
  inherit: boolean;
  start: string;
  end: string;
  breakMin: number;
  multiplier: number;
  off: boolean;
}

/** HRD sets a pattern's weekdays (D340) — *di jadwal harusnya bisa di-setting
 *  per harinya* (owner). Each weekday either follows the pattern's ordinary
 *  hours or carries its own start, end, break and what a day of it is worth;
 *  Saturday and Sunday at the workshop are 08.00–16.00 without a break, paid
 *  2×. Saved through `set_schedule_days` as a new dated version of the book. */
function EditDays({
  schedule, onClose, onDone,
}: {
  schedule: WorkSchedule;
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const week = scheduleWeek(schedule);
  const [rows, setRows] = useState<DayDraft[]>(() => week.map((w) => ({
    inherit: !w.own,
    start: clockInput(w.start_minutes),
    end: clockInput(w.end_minutes),
    breakMin: w.break_minutes ?? 0,
    multiplier: w.pay_multiplier,
    off: w.off,
  })));
  const [from, setFrom] = useState(officeToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, p: Partial<DayDraft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const days: Record<string, ScheduleDay> = {};
  rows.forEach((r, i) => {
    if (r.inherit) return;
    days[String(i + 1)] = r.off
      ? { off: true }
      : {
          start_minutes: minutesOfClock(r.start),
          end_minutes: minutesOfClock(r.end),
          break_minutes: r.breakMin,
          pay_multiplier: r.multiplier,
        };
  });
  const preview = scheduleWeek({ ...schedule, days });

  async function save() {
    setBusy(true);
    const res = await hr.setScheduleDays({ code: schedule.code, days, effective_from: from, note });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved yet", "Belum tersimpan"), res.error.message);
      return;
    }
    toast("success", schedule.name, tr(
      `Days saved as rule book v${res.data.version}, in force from ${res.data.effective_from}.`,
      `Jadwal per hari tersimpan sebagai buku aturan v${res.data.version}, berlaku mulai ${res.data.effective_from}.`,
    ));
    onDone();
  }

  const inputCls = "h-8 w-full rounded-md border border-slate-200 px-1.5 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr(`Days of ${schedule.name}`, `Jadwal per hari ${schedule.name}`)}
        subtitle={tr(
          "Each weekday follows the pattern's hours or has its own. The multiplier is what a day worked is worth in days of pay — 2× for Saturday and Sunday. The attendance reads hours against the day's own schedule.",
          "Setiap hari ikut jam pola atau punya jamnya sendiri. Pengali adalah nilai sehari kerja dalam hari upah — 2× untuk Sabtu dan Minggu. Absensi membaca jam terhadap jadwal hari itu sendiri.",
        )}
        icon={CalendarDays}
      />
      <div className="overflow-x-auto px-5">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-2 font-medium">{tr("Day", "Hari")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Own hours", "Jam sendiri")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Start", "Masuk")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("End", "Pulang")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Break (min)", "Istirahat (mnt)")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Pay ×", "Upah ×")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Off", "Libur")}</th>
              <th className="py-1.5 text-right font-medium">{tr("Hours", "Jam")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const locked = r.inherit || r.off;
              return (
                <tr key={i}>
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{WEEKDAY_NAMES[i]}</td>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" checked={!r.inherit} onChange={(e) => patch(i, { inherit: !e.target.checked })}
                      aria-label={tr(`${WEEKDAY_NAMES[i]} has its own hours`, `${WEEKDAY_NAMES[i]} punya jam sendiri`)} />
                  </td>
                  <td className="py-1.5 pr-2"><input type="time" value={r.start} disabled={locked} onChange={(e) => patch(i, { start: e.target.value })} className={inputCls} /></td>
                  <td className="py-1.5 pr-2"><input type="time" value={r.end} disabled={locked} onChange={(e) => patch(i, { end: e.target.value })} className={inputCls} /></td>
                  <td className="py-1.5 pr-2 w-24"><NumberInput size="sm" value={r.breakMin} onChange={(v) => patch(i, { breakMin: v })} min={0} max={1440} disabled={locked} /></td>
                  <td className="py-1.5 pr-2 w-20"><NumberInput size="sm" value={r.multiplier} onChange={(v) => patch(i, { multiplier: v })} min={0} max={5} step={0.5} disabled={locked} /></td>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" checked={r.off} disabled={r.inherit} onChange={(e) => patch(i, { off: e.target.checked })}
                      aria-label={tr(`${WEEKDAY_NAMES[i]} is a day off`, `${WEEKDAY_NAMES[i]} libur`)} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {preview[i].off ? "—" : hours(preview[i].hours)}
                    {!preview[i].off && preview[i].pay_multiplier !== 1 && <span className="ml-1 text-amber-700">×{preview[i].pay_multiplier}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 px-5 py-3 sm:grid-cols-3">
        <label className="text-[12px] text-slate-600">
          {tr("In force from", "Berlaku mulai")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2">
          {tr("Why", "Alasan")}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("Who decided — the owner, the production head…", "Siapa yang menetapkan — pemilik, kepala produksi…")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" onClick={save} disabled={busy || !note.trim()}>{tr("Save days", "Simpan jadwal per hari")}</Button>
      </div>
    </Card>
  );
}

interface ShiftDraft { code: string; name: string; start: string; end: string; breakMin: number }

/** HRD sets the shifts somebody on a pattern may work (D364).
 *
 *  Owner: *Satpam ada 2 shift — Shift 1 07.00–17.00, Shift 2 17.00–07.00*,
 *  given out in no fixed order. Nobody writes a roster: each day is read as
 *  whichever shift its taps fit, and where they fit none, HRD picks it in the
 *  day's drawer on /hrd/absensi. One shift is one day of pay, whichever it is.
 *  Saved as a new dated version of the rule book, like the days. */
function EditShifts({
  schedule, others, onClose, onDone,
}: {
  schedule: WorkSchedule;
  others: WorkSchedule[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const toDraft = (x: ScheduleShift): ShiftDraft => ({
    code: x.code, name: x.name, start: clockInput(x.start_minutes), end: clockInput(x.end_minutes),
    breakMin: x.break_minutes ?? 0,
  });
  const [rows, setRows] = useState<ShiftDraft[]>(() => (schedule.shifts ?? []).map(toDraft));
  const [from, setFrom] = useState(officeToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, p: Partial<ShiftDraft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const shifts: ScheduleShift[] = rows.map((r) => ({
    code: r.code.trim().toUpperCase(),
    name: r.name.trim(),
    start_minutes: minutesOfClock(r.start) as number,
    end_minutes: minutesOfClock(r.end) as number,
    break_minutes: r.breakMin,
  }));
  /* The same rule the seam applies, before anybody presses save. */
  const problem = scheduleProblem([...others, { ...schedule, shifts }], {});

  async function save() {
    setBusy(true);
    const res = await hr.setScheduleShifts({ code: schedule.code, shifts, effective_from: from, note });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not saved yet", "Belum tersimpan"), res.error.message);
      return;
    }
    toast("success", schedule.name, tr(
      `Shifts saved as rule book v${res.data.version}, in force from ${res.data.effective_from}.`,
      `Shift tersimpan sebagai buku aturan v${res.data.version}, berlaku mulai ${res.data.effective_from}.`,
    ));
    onDone();
  }

  const inputCls = "h-8 w-full rounded-md border border-slate-200 px-1.5 text-[13px] focus:border-brand-400 focus:outline-none";

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr(`Shifts of ${schedule.name}`, `Shift ${schedule.name}`)}
        subtitle={tr(
          "Each day is read as whichever shift its taps fit — arriving near a shift's start and leaving near its end. A shift ending at or before its start ends the next morning. Where the taps fit none, HRD picks the shift in the day's drawer. One shift is one day of pay. No shifts: the pattern is one working day, as before.",
          "Setiap hari dibaca sebagai shift yang cocok dengan tapnya — datang dekat jam masuk shift dan pulang dekat jam pulangnya. Shift yang pulangnya tidak sesudah jam masuk berakhir esok paginya. Kalau tapnya tidak cocok dengan shift mana pun, HRD memilih shift-nya di laci hari. Satu shift = satu hari upah. Tanpa shift: pola ini satu hari kerja seperti biasa.",
        )}
        icon={Repeat}
        action={rows.length === 0 ? (
          <Button size="sm" variant="outline" onClick={() => setRows(SATPAM_SHIFTS.map(toDraft))}>
            {tr("Use Satpam's two shifts", "Pakai 2 shift Satpam")}
          </Button>
        ) : undefined}
      />
      <div className="overflow-x-auto px-5">
        <table className="w-full min-w-[600px] text-[13px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-2 font-medium">{tr("Code", "Kode")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Name", "Nama")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Start", "Masuk")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("End", "Pulang")}</th>
              <th className="py-1.5 pr-2 font-medium">{tr("Break (min)", "Istirahat (mnt)")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{tr("Hours", "Jam")}</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-[12px] text-slate-500">
                {tr("No shifts — this pattern is read as one working day.", "Belum ada shift — pola ini dibaca sebagai satu hari kerja.")}
              </td></tr>
            )}
            {rows.map((r, i) => {
              const st = minutesOfClock(r.start), en = minutesOfClock(r.end);
              const span = st != null && en != null && st !== en ? shiftMinutes(st, en) : null;
              return (
                <tr key={i}>
                  <td className="w-20 py-1.5 pr-2"><input value={r.code} onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })} className={inputCls} aria-label={tr("Shift code", "Kode shift")} /></td>
                  <td className="py-1.5 pr-2"><input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className={inputCls} aria-label={tr("Shift name", "Nama shift")} /></td>
                  <td className="py-1.5 pr-2"><input type="time" value={r.start} onChange={(e) => patch(i, { start: e.target.value })} className={inputCls} aria-label={tr("Start", "Masuk")} /></td>
                  <td className="py-1.5 pr-2"><input type="time" value={r.end} onChange={(e) => patch(i, { end: e.target.value })} className={inputCls} aria-label={tr("End", "Pulang")} /></td>
                  <td className="w-24 py-1.5 pr-2"><NumberInput size="sm" value={r.breakMin} onChange={(v) => patch(i, { breakMin: v })} min={0} max={1440} /></td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
                    {span == null ? "—" : hours(Math.max(span - r.breakMin, 0) / 60)}
                    {st != null && en != null && en < st && <Moon className="ml-1 inline h-3 w-3 text-indigo-600" aria-label={tr("ends next morning", "berakhir esok pagi")} />}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label={tr(`Remove ${r.code || "shift"}`, `Hapus ${r.code || "shift"}`)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length < 6 && (
          <Button size="sm" variant="ghost" icon={Plus} className="mt-1"
            onClick={() => setRows((rs) => [...rs, { code: `S${rs.length + 1}`, name: `Shift ${rs.length + 1}`, start: "", end: "", breakMin: 0 }])}>
            {tr("Add shift", "Tambah shift")}
          </Button>
        )}
        {problem && rows.length > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{problem.message}</p>
        )}
      </div>
      <div className="grid gap-3 px-5 py-3 sm:grid-cols-3">
        <label className="text-[12px] text-slate-600">
          {tr("In force from", "Berlaku mulai")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2">
          {tr("Why", "Alasan")}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("Who decided — the owner, the head of security…", "Siapa yang menetapkan — pemilik, kepala keamanan…")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" onClick={save} disabled={busy || !note.trim() || (problem != null && rows.length > 0)}>
          {tr("Save shifts", "Simpan shift")}
        </Button>
      </div>
    </Card>
  );
}
