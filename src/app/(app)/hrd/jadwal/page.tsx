"use client";

import { useState } from "react";
import { CalendarClock, AlertTriangle, Users, Link2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Combobox } from "@/components/ui/combobox";
import { formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

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
  const { can } = useSession();
  const mayEdit = can("hrd.update");
  const [data, reload] = useLoad(() => hr.listSchedules(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Jadwal kerja"
        description="Pola kerja yang benar-benar dijalankan perusahaan ini, siapa yang ada di masing-masing, dan berapa jam seminggu serta sebulannya. Angkanya dihitung dari jam masuk, jam pulang dan istirahat — tidak ada yang disimpan dua kali."
      />

      <Loaded state={data} onRetry={reload}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Pola kerja" value={String(d.schedules.length)} icon={CalendarClock} />
              <StatCard
                label="Ditetapkan HR"
                value={String(d.schedules.reduce((t, sc) => t + sc.assigned, 0))}
                icon={Link2}
              />
              {/* Not amber any more. The owner ruled that a unit's default **is**
                  the decision (D281), so following it is an ordinary state and
                  not a gap somebody has to close. What stays worth flagging is
                  a person on no pattern at all, and that is the tile below. */}
              <StatCard
                label="Ikut bawaan unit"
                value={String(d.inherited.length)}
                icon={Users}
              />
              <StatCard
                label="Pola belum lengkap"
                value={String(d.schedules.filter((sc) => sc.hours.blocked_by).length)}
                icon={AlertTriangle}
                tone={d.schedules.some((sc) => sc.hours.blocked_by) ? "amber" : "slate"}
              />
            </div>

            <Card className="mb-4">
              <CardHeader
                title="Pola kerja"
                subtitle={`Pola ${d.week_pattern === "5day" ? "lima" : "enam"} hari kerja seminggu. Jam seminggu menghitung Jumat dengan panjangnya sendiri kalau istirahatnya beda — selisih setengah jam pada satu hari dari enam hampir satu jam seminggu.`}
                icon={CalendarClock}
                action={<SourceBadge state={data} />}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2 font-medium">Pola</th>
                      <th className="px-3 py-2 font-medium">Jam</th>
                      <th className="px-3 py-2 text-right font-medium">Sehari</th>
                      <th className="px-3 py-2 text-right font-medium">Jumat</th>
                      <th className="px-3 py-2 text-right font-medium">Seminggu</th>
                      <th className="px-3 py-2 text-right font-medium">Sebulan</th>
                      <th className="px-5 py-2 text-right font-medium">Orang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.schedules.map((sc) => (
                      <tr key={sc.code} className="align-top">
                        <td className="px-5 py-2.5">
                          <span className="block font-medium text-slate-800">{sc.name}</span>
                          <span className="block text-[11px] text-slate-400">
                            {sc.units.length > 0 ? sc.units.join(", ") : "tidak dipasang ke unit mana pun"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-600">
                          {clock(sc.start_minutes)} – {clock(sc.end_minutes)}
                          <span className="block text-[11px] text-slate-400">
                            istirahat {sc.break_minutes == null ? "—" : `${sc.break_minutes} m`}
                            {/* Jumat disebut hanya kalau ia memang berbeda, dan
                                disebut lengkap: jam pulangnya lebih dulu, karena
                                itu yang orang rasakan, lalu istirahatnya. */}
                            {(sc.friday_end_minutes != null || sc.friday_break_minutes != null) && (
                              <> · Jumat
                                {sc.friday_end_minutes != null && ` s/d ${clock(sc.friday_end_minutes)}`}
                                {sc.friday_break_minutes != null && ` istirahat ${sc.friday_break_minutes} m`}
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{hours(sc.hours.daily_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{hours(sc.hours.friday_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{hours(sc.hours.weekly_hours)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{hours(sc.hours.monthly_hours)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">
                          {sc.assigned + sc.inherited}
                          {sc.inherited > 0 && (
                            <span className="block text-[11px] text-slate-400">{sc.inherited} ikut unit</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.schedules.filter((sc) => sc.hours.blocked_by).map((sc) => (
                <p key={sc.code} className="border-t border-slate-100 px-5 py-2 text-[12px] text-amber-800">
                  <strong>{sc.name}:</strong> {sc.hours.blocked_by}{" "}
                  {sc.note && <span className="text-amber-700">{sc.note}</span>}
                </p>
              ))}
              <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                Sebulan = seminggu × 52 ÷ 12. Tidak disimpan di mana pun — dua angka yang harus cocok
                adalah cara paling mudah membuatnya tidak cocok.
              </p>
            </Card>

            {d.unlinked.length > 0 ? (
              <Card>
                <CardHeader
                  title={`${d.unlinked.length} karyawan belum punya jadwal`}
                  subtitle="Unitnya juga tidak punya pola bawaan, jadi tidak ada jam yang bisa dipakai menilai ketepatan waktu mereka. Bukan berarti mereka tidak pernah terlambat — berarti belum ada yang menuliskan jamnya."
                  icon={AlertTriangle}
                />
                <ul className="divide-y divide-slate-100">
                  {d.unlinked.map((e) => (
                    <AssignRow
                      key={e.employee_no} row={e} mayEdit={mayEdit}
                      options={d.schedules.map((sc) => ({ value: sc.code, label: sc.name, sublabel: `${hours(sc.hours.weekly_hours)} jam/minggu` }))}
                      onDone={reload}
                    />
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState
                icon={Users}
                title="Semua karyawan aktif sudah punya jadwal"
                description="Setiap orang tertaut ke satu pola kerja, lewat unitnya atau lewat jadwalnya sendiri."
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
  const { toast } = useToast();
  const [picked, setPicked] = useState(suggestion ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await hr.setEmployeeSchedule({ employee_no: row.employee_no, schedule_code: picked });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", "Belum tersimpan", res.error.message);
      return;
    }
    toast("success", row.full_name, `Dipasang ke jadwal ${picked}.`);
    onDone();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <span className="min-w-[180px] flex-1">
        <span className="block text-[13px] font-medium text-slate-800">{row.full_name}</span>
        <span className="block text-[11px] text-slate-400">{row.employee_no} · {row.unit}</span>
      </span>
      <Badge tone="amber">{suggestion ? "ikut unit" : "tanpa jadwal"}</Badge>
      {mayEdit && (
        <>
          <div className="w-[240px]">
            <Combobox options={options} value={picked} onChange={setPicked} placeholder="Pilih pola kerja…" />
          </div>
          <Button size="sm" icon={Link2} disabled={busy || !picked} onClick={save}>Pasang</Button>
        </>
      )}
    </li>
  );
}
