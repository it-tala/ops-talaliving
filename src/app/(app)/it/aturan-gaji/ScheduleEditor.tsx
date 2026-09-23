"use client";

import { Plus, X } from "lucide-react";
import type { PayRules, WorkSchedule } from "@/services/hr/contracts";
import { scheduleProblems, scheduleHoursOf } from "@/services/hr/contracts";
import { formatNumber } from "@/lib/format";

/** The working patterns, editable (Q44, D274, D289, D291).
 *
 *  Until now this was a table you could read and not change, and changing an
 *  hour meant a migration — which is how the office's Friday spent a day
 *  wrong. The owner's answer was a sentence; getting it into the system took a
 *  deploy. That is the wrong shape for a fact that belongs to the business.
 *
 *  Three things it is careful about:
 *
 *  - **Empty is an answer, and it is not zero.** Clearing a time leaves
 *    *belum ditetapkan*, which is what the guard's twelve hours actually are
 *    (D274). A `<input type="time">` cleared to empty gives null, and the row
 *    then says it cannot compute its hours and why — never 00.00, never a
 *    week of nought.
 *  - **The consequence is shown while you type.** Every row prints its day,
 *    its Friday, its week and its month from the same function the demo uses,
 *    so *what does 16.00 do to the week* is answered before saving rather than
 *    after (D279: derived, printed with its working).
 *  - **It does not decide anything.** The problems listed here come from
 *    `scheduleProblems`, the same statement of the rule the database enforces
 *    in `ops_hr.schedule_problem()` — held level by `check-schedule-rules.mjs`.
 *    The screen is early warning; the refusal is still the seam's (ADR-002).
 */
export function ScheduleEditor({
  rules, disabled, onChange,
}: {
  rules: PayRules;
  disabled: boolean;
  onChange: (patch: Partial<PayRules>) => void;
}) {
  const schedules = rules.schedules ?? [];
  const byUnit = rules.schedule_by_unit ?? {};
  const problems = scheduleProblems(schedules, byUnit);
  const daysPerWeek = rules.week_pattern === "5day" ? 5 : 6;

  const patchRow = (i: number, patch: Partial<WorkSchedule>) =>
    onChange({ schedules: schedules.map((s, n) => (n === i ? { ...s, ...patch } : s)) });

  /* Removing a row is the one action here that can strand a person, so the
     button says so rather than asking twice. The refusal itself is the seam's:
     it knows the roster, and this screen deliberately does not. */
  const removeRow = (i: number) => {
    const gone = schedules[i]?.code;
    onChange({
      schedules: schedules.filter((_, n) => n !== i),
      schedule_by_unit: Object.fromEntries(
        Object.entries(byUnit).filter(([, code]) => code !== gone),
      ),
    });
  };

  const addRow = () =>
    onChange({
      schedules: [...schedules, {
        code: "", name: "",
        start_minutes: null, end_minutes: null, break_minutes: null,
        friday_break_minutes: null, friday_end_minutes: null, note: null,
      }],
    });

  return (
    <div className="space-y-3">
      {problems.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {problems.map((p, i) => (
            <li key={`${p.code}-${i}`} className={i === 0 ? "font-medium" : "mt-0.5"}>
              {p.message}
              {i === 0 && problems.length > 1 && (
                <span className="font-normal text-amber-700"> — ini yang akan ditolak lebih dulu.</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {schedules.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-500">
          Belum ada pola kerja di buku ini. Semua unit memakai jam masuk perusahaan di atas, dan
          ketepatan waktu tidak bisa diukur terhadap apa pun yang tertulis.
        </p>
      )}

      {schedules.map((sc, i) => {
        const hours = scheduleHoursOf(sc, daysPerWeek);
        return (
          <div key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <Text
                label="Kode" width="w-32" mono
                value={sc.code} disabled={disabled}
                /* Upper-cased as you type rather than on save: the rule refuses
                   lower case, and silently rewriting a key somebody else's data
                   points at is worse than refusing it. */
                onChange={(v) => patchRow(i, { code: v.toUpperCase().replace(/\s+/g, "") })}
              />
              <Text
                label="Nama" width="min-w-[10rem] flex-1"
                value={sc.name} disabled={disabled}
                onChange={(v) => patchRow(i, { name: v })}
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  title="Hapus pola ini"
                  className="mb-0.5 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Clock label="Masuk" value={sc.start_minutes} disabled={disabled}
                onChange={(v) => patchRow(i, { start_minutes: v })} />
              <Clock label="Pulang" value={sc.end_minutes} disabled={disabled}
                onChange={(v) => patchRow(i, { end_minutes: v })} />
              <Minutes label="Istirahat" value={sc.break_minutes} disabled={disabled}
                onChange={(v) => patchRow(i, { break_minutes: v })} />
              <Clock label="Pulang Jumat" value={sc.friday_end_minutes} disabled={disabled}
                onChange={(v) => patchRow(i, { friday_end_minutes: v })} />
              <Minutes label="Istirahat Jumat" value={sc.friday_break_minutes} disabled={disabled}
                onChange={(v) => patchRow(i, { friday_break_minutes: v })} />
            </div>

            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
              {hours.blocked_by ? (
                <span className="text-amber-700">{hours.blocked_by}</span>
              ) : (
                <>
                  <Figure label="sehari" value={hours.daily_hours} />
                  <Figure
                    label="Jumat"
                    value={hours.friday_hours}
                    empty="sama dengan hari lain"
                  />
                  <Figure label={`seminggu (${daysPerWeek} hari)`} value={hours.weekly_hours} strong />
                  <Figure label="sebulan" value={hours.monthly_hours} />
                </>
              )}
            </div>

            <input
              type="text"
              value={sc.note ?? ""}
              disabled={disabled}
              placeholder="Catatan — yang diketahui tentang pola ini tapi tidak terbaca dari angkanya"
              onChange={(e) => patchRow(i, { note: e.target.value.trim() === "" ? null : e.target.value })}
              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 placeholder:text-slate-300 focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
            />
          </div>
        );
      })}

      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-[12px] text-brand-700 underline"
        >
          <Plus className="h-3.5 w-3.5" /> tambah pola kerja
        </button>
      )}

      <UnitMap
        schedules={schedules}
        byUnit={byUnit}
        disabled={disabled}
        onChange={(schedule_by_unit) => onChange({ schedule_by_unit })}
      />

      <p className="text-[11px] text-slate-500">
        Kosongkan sebuah jam untuk mengatakan <strong>belum ditetapkan</strong> — itu bukan pukul 00.00
        dan bukan nol jam, dan pola yang belum lengkap akan menuliskan alasannya, bukan angka. Jumat
        yang dikosongkan dua-duanya berarti Jumat sama seperti hari lain; mengisi salah satunya saja
        pun boleh, yang tidak diisi ikut hari biasa.
      </p>
    </div>
  );
}

/** Unit → pattern. The fall-back, and **an assumption rather than a decision**
 *  (D281): somebody moved between units has their hours changed by this map
 *  with nobody choosing it, which is why `/hrd/jadwal` counts *ikut bawaan
 *  unit* apart from *ditetapkan HR*. */
function UnitMap({
  schedules, byUnit, disabled, onChange,
}: {
  schedules: WorkSchedule[];
  byUnit: Record<string, string>;
  disabled: boolean;
  onChange: (next: Record<string, string>) => void;
}) {
  const entries = Object.entries(byUnit).sort(([a], [b]) => a.localeCompare(b));

  const rename = (from: string, to: string) => {
    const next: Record<string, string> = {};
    for (const [u, c] of entries) next[u === from ? to : u] = c;
    delete next[""];
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[12px] font-medium text-slate-700">Unit memakai pola</p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Bawaan, bukan keputusan: seseorang yang pindah unit ikut berubah jamnya tanpa ada yang
        memilihkan. Jadwal yang dipasang HR ke orangnya menang atas daftar ini, dan unit yang tidak
        ada di sini jatuh ke jam masuk perusahaan.
      </p>

      <ul className="mt-2 space-y-1.5">
        {entries.map(([unit, code]) => (
          <li key={unit} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={unit}
              disabled={disabled}
              onChange={(e) => rename(unit, e.target.value)}
              className="h-8 w-40 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
            />
            <span className="text-[12px] text-slate-400">→</span>
            <select
              value={code}
              disabled={disabled}
              onChange={(e) => onChange({ ...byUnit, [unit]: e.target.value })}
              className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
            >
              {/* The current value stays selectable even when it names nothing,
                  so a dangling map is visible and fixable rather than silently
                  rewritten to the first pattern in the list. */}
              {!schedules.some((s) => s.code === code) && (
                <option value={code}>{code} — pola ini tidak ada</option>
              )}
              {schedules.map((s) => (
                <option key={s.code} value={s.code}>{s.code || "(tanpa kode)"}</option>
              ))}
            </select>
            {!disabled && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...byUnit };
                  delete next[unit];
                  onChange(next);
                }}
                title="Lepaskan unit ini"
                className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:border-rose-200 hover:text-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-[12px] text-slate-500">
            Belum ada unit yang dipasang — semuanya memakai jam masuk perusahaan.
          </li>
        )}
      </ul>

      {!disabled && schedules.length > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...byUnit, "": schedules[0].code })}
          disabled={Object.prototype.hasOwnProperty.call(byUnit, "")}
          className="mt-2 flex items-center gap-1 text-[12px] text-brand-700 underline disabled:text-slate-300 disabled:no-underline"
        >
          <Plus className="h-3.5 w-3.5" /> tambah unit
        </button>
      )}
    </div>
  );
}

/* ── the small inputs ─────────────────────────────────────────────────── */

function Text({
  label, value, onChange, disabled, width, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  disabled: boolean; width: string; mono?: boolean;
}) {
  return (
    <label className={`block ${width}`}>
      <span className="block text-[11px] text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-0.5 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

/** A time, or nothing at all. Cleared means *belum ditetapkan*, which the
 *  browser's own empty state already expresses — no extra button needed, and
 *  no way to accidentally mean midnight. */
function Clock({
  label, value, onChange, disabled,
}: {
  label: string; value: number | null; onChange: (v: number | null) => void; disabled: boolean;
}) {
  const text = value == null
    ? ""
    : `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <label className="block">
      <span className="block text-[11px] text-slate-500">{label}</span>
      <input
        type="time"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") { onChange(null); return; }
          const [h, m] = v.split(":").map(Number);
          onChange(h * 60 + m);
        }}
        className="mt-0.5 h-8 rounded-lg border border-slate-200 px-2 text-[13px] tabular-nums focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
      />
    </label>
  );
}

function Minutes({
  label, value, onChange, disabled,
}: {
  label: string; value: number | null; onChange: (v: number | null) => void; disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-slate-500">{label}</span>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={1440}
          value={value ?? ""}
          disabled={disabled}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-[13px] tabular-nums focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
        />
        <span className="text-[11px] text-slate-400">menit</span>
      </div>
    </label>
  );
}

function Figure({
  label, value, strong, empty,
}: {
  label: string; value: number | null; strong?: boolean; empty?: string;
}) {
  return (
    <span className="text-slate-500">
      {label}{" "}
      {value == null ? (
        <span className="text-slate-400">{empty ?? "—"}</span>
      ) : (
        <span className={`tabular-nums ${strong ? "font-semibold text-slate-800" : "text-slate-700"}`}>
          {formatNumber(value)} jam
        </span>
      )}
    </span>
  );
}
