"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { LocatedTap, type TapAction } from "@/components/attendance/located-tap";
import {
  SLOT_LABEL, TAP_KINDS, TAP_KIND_LABEL, isAwayTap, type TapKind, type TimesheetDay,
} from "@/services/hr/contracts";
import { OFFICE_TZ, officeClock, officeDay, officeToday, shiftDay } from "@/lib/office";
import { formatNumber } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useDayLabel } from "./shared";

/** A moment from the database as `HH:MM` on the office clock (F183). */
function at(v: string | undefined): string | null {
  return v ? officeClock(new Date(v)) : null;
}

/** A day's masuk and pulang, for the list of the last fourteen days.
 *
 *  Read off the reading's slots. Where the reading has not placed a tap in a
 *  slot, the first tap stands for *masuk*, which is what the reader at the
 *  door would show too (D307). Keluar / kembali kantor are neither (D367). */
export function readToday(day: TimesheetDay | undefined) {
  const scans = (day?.scans ?? []).filter((s) => !isAwayTap(s.kind));
  const inAt = at(day?.slots.in) ?? (scans[0] ? at(scans[0].at) : null);
  const outAt = at(day?.slots.out) ?? (scans.length >= 2 && !day?.slots.in ? at(scans[scans.length - 1]!.at) : null);
  return { inAt, outAt, taps: scans.length };
}

/** Where somebody is in their day, from today's taps in order (D367).
 *
 *  Each tap is what it said it was, or — for the reader's taps and old phone
 *  taps, which say only when — the slot the reading put it in. A tap the
 *  reading could not place changes nothing, except that the first tap of the
 *  day stands for masuk (D307). */
export type DayStage = "none" | "working" | "break" | "away" | "out" | "overtime" | "ot_done";

export function stageOf(day: TimesheetDay | undefined): { stage: DayStage; since: string | null } {
  let stage: DayStage = "none";
  let since: string | null = null;
  for (const s of day?.scans ?? []) {
    const k: TapKind | null = s.kind ?? s.slot ?? null;
    const was: DayStage = stage;
    switch (k) {
      case "in": stage = "working"; break;
      case "break_out": stage = "break"; break;
      case "break_in": stage = "working"; break;
      case "away_out": stage = "away"; break;
      case "away_back": stage = stage === "away" || stage === "none" ? "working" : stage; break;
      case "out": stage = "out"; break;
      case "ot_start": stage = "overtime"; break;
      case "ot_end": stage = "ot_done"; break;
      default: if (stage === "none") stage = "working";
    }
    if (stage !== was) since = s.at;
  }
  return { stage, since };
}

/** The taps that make sense next: one large, the rest under it. */
const NEXT: Record<DayStage, { primary: TapAction | null; secondary: TapAction[] }> = {
  none: { primary: { kind: "in" }, secondary: [] },
  working: {
    primary: { kind: "out", tone: "amber" },
    secondary: [{ kind: "break_out" }, { kind: "away_out" }],
  },
  break: { primary: { kind: "break_in" }, secondary: [] },
  away: { primary: { kind: "away_back" }, secondary: [{ kind: "out" }] },
  out: { primary: { kind: "ot_start", tone: "slate" }, secondary: [] },
  overtime: { primary: { kind: "ot_end", tone: "slate" }, secondary: [] },
  ot_done: { primary: null, secondary: [] },
};

/** The buttons for a day: what is due next, and every other kind behind
 *  *Tap lain*. One answer for `/saya` and `/profil`. */
export function tapActionsFor(day: TimesheetDay | undefined) {
  const { stage, since } = stageOf(day);
  const next = NEXT[stage];
  const offered = new Set<TapKind>([...(next.primary ? [next.primary.kind] : []), ...next.secondary.map((a) => a.kind)]);
  const more: TapAction[] = TAP_KINDS.filter((k) => !offered.has(k)).map((kind) => ({ kind }));
  return { stage, since, primary: next.primary, secondary: next.secondary, more };
}

export function PresensiTab({ employeeNo }: { employeeNo: string }) {
  const tr = useTr();
  const day = useDayLabel();
  const [now, setNow] = useState(() => Date.now());

  /* One tick a second, so the minute flips when the office clock does. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const today = officeToday();
  const from = shiftDay(today, -13);
  const [days, reload] = useLoad(
    () => hr.attendanceFor({ employee_no: employeeNo, from, to: today }),
    [employeeNo, from, today],
  );
  const todayRow = days.status === "ready" ? days.data.find((d) => d.work_date === today) : undefined;
  const { stage, since, primary, secondary, more } = tapActionsFor(todayRow);
  const sinceAt = at(since ?? undefined);
  const todayTaps = todayRow?.scans ?? [];

  const secs = String(new Date(now).getUTCSeconds()).padStart(2, "0");
  const stageLine: Record<DayStage, string> = {
    none: tr("Not in yet", "Belum masuk"),
    working: tr(`Working since ${sinceAt}`, `Bekerja sejak ${sinceAt}`),
    break: tr(`On a break since ${sinceAt}`, `Istirahat sejak ${sinceAt}`),
    away: tr(`Out of the office since ${sinceAt}`, `Di luar kantor sejak ${sinceAt}`),
    out: tr(`Clocked out ${sinceAt}`, `Pulang ${sinceAt}`),
    overtime: tr(`On overtime since ${sinceAt}`, `Lembur sejak ${sinceAt}`),
    ot_done: tr(`Overtime ended ${sinceAt}`, `Lembur selesai ${sinceAt}`),
  };

  return (
    <div className="space-y-4">
      <Card className="px-5 pb-5 pt-6 text-center">
        <p className="text-[14px] text-slate-500">{day(officeDay(now), true)}</p>
        <p className="mt-1 font-mono text-[64px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
          {officeClock(now)}<span className="text-[28px] text-slate-400">:{secs}</span>
        </p>
        <p className="mt-1 text-[12px] text-slate-400">{OFFICE_TZ.short}</p>

        <p className="mt-4 text-[17px] font-medium text-slate-800" data-testid="today-state">
          {days.status === "loading" ? "…" : stageLine[stage]}
        </p>

        {/* D332: the tap reads where the phone is, once, at the press, and is
            judged against the warehouse. D367: each button says what the tap
            is — the next one large, the others that make sense now under it,
            and every other kind behind *Tap lain* for the one somebody forgot.
            Nothing is refused for its order; the reading says what is missing. */}
        <LocatedTap
          className="mt-5"
          size="lg"
          primary={primary}
          secondary={secondary}
          more={more}
          idle={
            <p className="rounded-2xl bg-slate-50 px-4 py-5 text-[15px] font-medium text-slate-600">
              {tr("Done for today.", "Selesai untuk hari ini.")}
            </p>
          }
          disabled={days.status === "loading"}
          onTapped={() => reload()}
        />
        {(stage === "out" || stage === "overtime") && (
          <p className="mt-2 text-[12px] text-slate-500">
            {tr(
              "Overtime taps show the hours; pay comes from an approved overtime request (Requests → Overtime).",
              "Tap lembur mencatat jamnya; bayarannya dari pengajuan lembur yang disetujui (Pengajuan → Lembur).",
            )}
          </p>
        )}

        {todayTaps.length > 0 && (
          <ol className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-left" data-testid="today-taps">
            {todayTaps.map((t) => {
              const k = t.kind ?? null;
              const what = k ? TAP_KIND_LABEL[k] : t.slot ? SLOT_LABEL[t.slot] : tr("Tap", "Tap");
              return (
                <li key={t.at} className="flex items-baseline gap-3 text-[14px]">
                  <span className="w-12 shrink-0 font-mono tabular-nums text-slate-800">{at(t.at)}</span>
                  <span className="flex-1 text-slate-700">{what}</span>
                  {!k && <span className="text-[11px] text-slate-400">{t.source === "self" ? tr("phone", "HP") : tr("reader", "mesin")}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {todayRow && todayRow.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-left text-[12px] text-slate-500" data-testid="today-notes">
            {todayRow.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}

      </Card>

      <Card>
        <p className="border-b border-slate-100 px-5 py-3 text-[14px] font-semibold text-slate-800">
          {tr("Last 14 days", "14 hari terakhir")}
        </p>
        <Loaded state={days} onRetry={reload}>
          {(rows) => {
            const list = rows.slice().sort((a, b) => b.work_date.localeCompare(a.work_date));
            return (
              <ul className="divide-y divide-slate-100">
                {list.length === 0 && (
                  <li className="px-5 py-6 text-[14px] text-slate-500">{tr("No attendance in the last 14 days.", "Belum ada presensi 14 hari terakhir.")}</li>
                )}
                {list.map((d) => {
                  const r = readToday(d);
                  return (
                    <li key={d.work_date} className="flex items-center gap-3 px-5 py-3 text-[14px]">
                      <span className="w-[92px] shrink-0 font-medium text-slate-800">{day(d.work_date)}</span>
                      <span className="flex-1 text-slate-600">
                        {d.mark
                          ? d.pay.why
                          : r.inAt
                            ? `${r.inAt} – ${r.outAt ?? "…"}`
                            : tr("no taps", "tidak ada tap")}
                        {d.overtime_hours > 0 && (
                          <span className="ml-1 text-brand-700">+{formatNumber(d.overtime_hours)} {tr("h OT", "j lembur")}</span>
                        )}
                      </span>
                      {/* Today is not over: one tap is a day in progress, not a day to check. */}
                      {d.state === "review" && d.work_date !== today && <Badge tone="amber">{tr("check", "dicek")}</Badge>}
                    </li>
                  );
                })}
              </ul>
            );
          }}
        </Loaded>
      </Card>
    </div>
  );
}
