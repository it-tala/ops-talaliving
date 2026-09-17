"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { PayrollLine, PayslipDay } from "@/services/hr/contracts";
import { useBrand } from "@/lib/brand";

/** Payslips, several to a sheet of A4.
 *
 *  One page per person wastes forty sheets on a workshop of forty, and nobody
 *  reads a payslip twice — so the slip is a card and A4 holds **six with the
 *  week on them, or eight without** (D156). The print road is unchanged: this
 *  is the app's own page, so there is no second renderer to drift from the
 *  figures on screen (D133).
 *
 *  For a daily worker the week is the payslip. The owner's own sketch —
 *
 *      senin    selasa
 *      07.30    07.30
 *      16.30    20.00
 *      8.15     8.15
 *               +2.30
 *
 *  — is exactly what the grid prints: in, out, hours, and the overtime under
 *  the day it happened. It answers *which days did I work* without anybody
 *  fetching the timesheet, which is the question that actually causes the
 *  arguments.
 *
 *  Under it: total days, total overtime, then what was taken off and what was
 *  added — **each with its sentence**, because a deduction an employee cannot
 *  read is one they cannot dispute (D155). Statutory deductions are still not
 *  computed, and the slip still says so (D140).
 */
const DAY_LABEL = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export default function PayslipsPage({ params }: { params: { run: string } }) {
  const runNo = decodeURIComponent(params.run);
  const [detail] = useLoad(() => hr.getPayroll(runNo), [runNo]);
  /* Four with the week, eight without. The dense one is for staff on a salary,
     whose slip is three numbers and a signature. */
  const [dense, setDense] = useState(false);

  useEffect(() => {
    if (detail.status === "ready") {
      const t = setTimeout(() => window.print(), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [detail.status]);

  return (
    <div className="mx-auto max-w-[820px] bg-white text-slate-900">
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          .no-print { display: none !important; }
          .sheet { break-after: page; }
          .sheet:last-child { break-after: auto; }
          .slip { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px]">
        <span className="text-slate-600">
          {dense ? "Delapan slip per lembar A4, tanpa rekap harian." : "Enam slip per lembar A4, dengan rekap per hari."}
        </span>
        <button
          onClick={() => setDense((d) => !d)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-slate-100"
        >
          {dense ? "Tampilkan rekap harian (6 per lembar)" : "Padatkan (8 per lembar)"}
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
        >
          Cetak
        </button>
      </div>

      <Loaded state={detail} onRetry={() => {}}>
        {(d) => <Sheets lines={d.lines} dense={dense} runNo={d.run_no} from={d.period_start} to={d.period_end} />}
      </Loaded>
    </div>
  );
}

/** How many slips actually fit, measured rather than assumed.
 *
 *  A fixed count is wrong in both directions: a workshop slip with a week grid
 *  and two hand-written deductions is half again the height of a salaried
 *  one, so "eight per sheet" either overflows the page — cutting a slip in
 *  half across two sheets — or wastes a third of the paper. So the slips are
 *  laid out once at the **printed** width, their real heights read off the
 *  page, and the sheets packed to fill A4 and no more (D156).
 */
const PRINT_WIDTH = 718;   // 210mm − 2×10mm margin, at 96dpi
const PRINT_HEIGHT = 1047; // 297mm − 2×10mm margin
const GAP = 12;            // gap-3

function Sheets({
  lines, dense, runNo, from, to,
}: {
  lines: PayrollLine[];
  dense: boolean;
  runNo: string;
  from: string;
  to: string;
}) {
  const measure = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<PayrollLine[][] | null>(null);

  /* Re-measured whenever the shape changes — the dense toggle changes every
     height at once. */
  useLayoutEffect(() => {
    setSheets(null);
  }, [dense, lines]);

  useLayoutEffect(() => {
    if (sheets !== null || !measure.current) return;
    const heights = [...measure.current.children].map((el) => (el as HTMLElement).offsetHeight);
    if (heights.length === 0) { setSheets([]); return; }

    /* Two columns: a row is as tall as the taller of its pair. */
    const packed: PayrollLine[][] = [];
    let page: PayrollLine[] = [];
    let used = 0;
    for (let i = 0; i < lines.length; i += 2) {
      const rowH = Math.max(heights[i] ?? 0, heights[i + 1] ?? 0) + GAP;
      if (page.length > 0 && used + rowH > PRINT_HEIGHT) { packed.push(page); page = []; used = 0; }
      page.push(lines[i]);
      if (lines[i + 1]) page.push(lines[i + 1]);
      used += rowH;
    }
    if (page.length > 0) packed.push(page);
    setSheets(packed);
  }, [sheets, lines, dense]);

  if (sheets === null) {
    return (
      <div
        ref={measure}
        aria-hidden
        className="pointer-events-none fixed left-[-20000px] top-0 grid grid-cols-2 gap-3"
        style={{ width: PRINT_WIDTH }}
      >
        {lines.map((l) => (
          <Slip key={l.employee_no} line={l} dense={dense} runNo={runNo} from={from} to={to} />
        ))}
      </div>
    );
  }

  return (
    <>
      {sheets.map((page, i) => (
        <div key={i} className="sheet grid grid-cols-2 gap-3">
          {page.map((l) => (
            <Slip key={l.employee_no} line={l} dense={dense} runNo={runNo} from={from} to={to} />
          ))}
        </div>
      ))}
    </>
  );
}

function Slip({
  line: l, dense, runNo, from, to,
}: {
  line: PayrollLine;
  dense: boolean;
  runNo: string;
  from: string;
  to: string;
}) {
  const brand = useBrand();
  const showDays = !dense && l.days.length > 0;
  const deductions = l.adjustments.filter((a) => a.amount < 0);
  const additions = l.adjustments.filter((a) => a.amount > 0);
  /* Days the machine left incomplete, and the hours it showed past the day.
     Both are read off the same rows the grid prints, so the note and the grid
     can never disagree. */
  const openDays = l.days.filter((d) => d.open).length;
  const shownOt = Math.round(l.days.reduce((s, d) => s + d.overtime_hours, 0) * 100) / 100;

  return (
    <section className="slip border border-slate-400 p-3 text-[10px] leading-tight">
      <div className="flex items-start justify-between border-b border-slate-400 pb-1.5">
        <div>
          <p className="text-[11px] font-bold tracking-tight">{brand.tagline}</p>
          <p className="text-[9px] text-slate-500">SLIP GAJI · {runNo}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold">{l.full_name}</p>
          <p className="font-mono text-[9px] text-slate-500">{l.employee_no} · {l.position}</p>
          <p className="text-[9px] text-slate-500">{from} → {to}</p>
        </div>
      </div>

      {showDays && <WeekGrid days={l.days} />}

      {/* The three totals a daily worker checks first. */}
      <div className="mt-2 grid grid-cols-3 gap-1 border-y border-slate-200 py-1 text-center">
        <div>
          <p className="text-[8px] uppercase tracking-wide text-slate-500">Hari dibayar</p>
          <p className="text-[12px] font-bold tabular-nums">{formatNumber(l.days_worked)}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase tracking-wide text-slate-500">Jam lembur</p>
          <p className="text-[12px] font-bold tabular-nums">{formatNumber(l.overtime_hours)}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase tracking-wide text-slate-500">Terlambat</p>
          <p className={cn("text-[12px] font-bold tabular-nums", l.late_minutes > 0 && "text-slate-900")}>
            {l.late_minutes > 0 ? `${l.late_minutes} mnt` : "—"}
          </p>
        </div>
      </div>

      {/* Where the grid and the totals disagree, the slip says why rather than
          leaving an employee to find it. A day with hours beside it that adds
          nothing to the total, and a night of overtime nobody has signed for,
          are the two arguments this paper exists to prevent (D156). */}
      {(openDays > 0 || shownOt > l.overtime_hours + 0.01) && (
        <ul className="mt-1 space-y-0.5 text-[8px] leading-snug text-slate-600">
          {openDays > 0 && (
            <li>
              {/* The mark only exists where the grid is printed; the dense slip
                  has to name the days in words instead. */}
              <span className="font-semibold">
                {showDays ? `${openDays} hari bertanda ?` : `${openDays} hari belum dibaca`}
              </span>{" "}
              — absensinya belum lengkap, jadi belum dihitung. Bukan hilang: minta HRD membacanya.
            </li>
          )}
          {shownOt > l.overtime_hours + 0.01 && (
            <li>
              Jam di baris <span className="font-semibold">lembur</span> adalah catatan mesin
              ({formatNumber(shownOt)} jam). Yang dibayar hanya yang sudah disetujui —
              {" "}{formatNumber(l.overtime_hours)} jam.
            </li>
          )}
        </ul>
      )}

      <table className="mt-1.5 w-full border-collapse">
        <tbody>
          <tr>
            <td className="py-0.5">
              {l.pay_basis === "monthly" ? "Gaji pokok" : `Upah ${formatNumber(l.days_worked)} hari`}
              {l.pay_basis !== "monthly" && (l.days_sick_paid > 0 || l.days_leave_paid > 0) && (
                <span className="block text-[8px] text-slate-500">
                  {[
                    `${formatNumber(l.days_present)} masuk`,
                    l.days_sick_paid > 0 ? `${formatNumber(l.days_sick_paid)} sakit (surat)` : null,
                    l.days_leave_paid > 0 ? `${formatNumber(l.days_leave_paid)} cuti berbayar` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </td>
            <td className="py-0.5 text-right tabular-nums">{formatIDR(l.base_pay)}</td>
          </tr>
          {/* Tunjangan is its own line, never folded into the pokok (D250). A
              person knows what they were told they earn; a single total that
              silently contains both is one they cannot check it against. */}
          {l.allowance_rate > 0 && (
            <tr>
              <td className="py-0.5">
                Tunjangan — {formatNumber(l.allowance_days)} hari × {formatIDR(l.allowance_rate)}
                {l.allowance_withheld_days > 0 && (
                  <span className="block text-[8px] leading-snug text-slate-500">
                    {formatNumber(l.allowance_withheld_days)} hari tidak dapat:{" "}
                    {l.allowance_withheld.map((w, i) => (
                      <span key={i}>{i > 0 ? " · " : ""}{w.work_date.slice(8)}/{w.work_date.slice(5, 7)} {w.reason}</span>
                    ))}
                  </span>
                )}
              </td>
              <td className="py-0.5 text-right tabular-nums">{formatIDR(l.allowance_pay)}</td>
            </tr>
          )}
          {l.overtime_pay > 0 && (
            <tr>
              <td className="py-0.5">
                Lembur — {formatNumber(l.overtime_hours)} jam
                {/* The ladder, not just the total: *3 jam = Rp 96.250* invites an
                    argument, *1 jam × 1,5 + 2 jam × 2* ends one (D173). */}
                {l.overtime_parts.length > 0 && (
                  <span className="block text-[8px] leading-snug text-slate-500">
                    {l.overtime_parts.map((p, i) => (
                      <span key={i}>
                        {i > 0 ? " · " : ""}
                        {p.multiplier > 0
                          ? `${formatNumber(p.hours)} jam × ${formatNumber(p.multiplier)}`
                          : "sesuai form"}
                      </span>
                    ))}
                    {l.overtime_parts[0]?.hourly > 0 && ` · jam biasa ${formatIDR(l.overtime_parts[0].hourly)}`}
                  </span>
                )}
              </td>
              <td className="py-0.5 text-right tabular-nums">{formatIDR(l.overtime_pay)}</td>
            </tr>
          )}
          {l.undertime_amount > 0 && (
            <tr>
              <td className="py-0.5">
                Kurang jam — {formatNumber(l.undertime_hours)} jam
                <span className="block text-[8px] text-slate-500">Sesuai aturan penggajian yang berlaku</span>
              </td>
              <td className="py-0.5 text-right tabular-nums">({formatIDR(l.undertime_amount)})</td>
            </tr>
          )}
          {l.late_deduction > 0 && (
            <tr>
              <td className="py-0.5">
                Terlambat — {formatNumber(l.late_minutes)} menit di {formatNumber(l.late_days)} hari
                <span className="block text-[8px] text-slate-500">
                  Di luar toleransi, dihitung per jam. Tunjangan hari itu tetap dibayar.
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums">({formatIDR(l.late_deduction)})</td>
            </tr>
          )}
          <tr className="border-t border-slate-300">
            <td className="py-0.5 font-medium">Bruto</td>
            <td className="py-0.5 text-right font-semibold tabular-nums">{formatIDR(l.gross)}</td>
          </tr>

          {/* Every adjustment, with the sentence behind it (D155). */}
          {[...deductions, ...additions].map((a, i) => (
            <tr key={i}>
              <td className="py-0.5">
                {a.label}
                <span className="block text-[8px] text-slate-500">{a.reason}</span>
                {/* The contradiction, said on the line that causes it. */}
                {a.kind === "late" && a.amount < 0 && l.late_minutes === 0 && (
                  <span className="block text-[8px] text-amber-700">
                    Absensi periode ini tidak mencatat keterlambatan di luar toleransi.
                  </span>
                )}
              </td>
              <td className={cn(
                "py-0.5 text-right tabular-nums",
                a.amount < 0 ? "text-slate-900" : "text-slate-900",
              )}>
                {a.amount < 0 ? `(${formatIDR(-a.amount)})` : formatIDR(a.amount)}
              </td>
            </tr>
          ))}

          {/* The statutory half, and **only** where HRD registered this person
              (D259). Nothing appears here because software was updated. */}
          {/* Only the schemes that actually take something out of this wage.
              JKK and JKM are paid entirely by the company, and printing them as
              a deduction of *(Rp 0)* reads as a deduction rather than as cover
              that costs the person nothing. They are named underneath instead. */}
          {l.contributions.filter((c) => c.employee > 0).map((c) => (
            <tr key={c.scheme}>
              <td className="py-0.5">
                {c.label}
                <span className="block text-[8px] text-slate-500">
                  Dari dasar upah {formatIDR(c.base)} · bagian perusahaan {formatIDR(c.employer)}
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums">({formatIDR(c.employee)})</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-900">
            <td className="py-1 text-[11px] font-bold">Diterima</td>
            <td className="py-1 text-right text-[12px] font-bold tabular-nums">{formatIDR(l.take_home)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-1 text-[8px] leading-snug text-slate-500">
        {l.contributions.length === 0
          ? "Belum ada potongan iuran wajib: orang ini belum terdaftar di register BPJS. Yang belum ada kelihatan di slip; yang salah ditemukan karyawan yang uangnya kurang."
          : "PPh 21 belum dihitung di sistem ini — tercatat sebagai pendaftaran saja."}
        {/* What the company pays on this person's behalf and never takes off
            their wage. Worth printing: it is part of what the job is worth, and
            most people have never been told it exists. */}
        {l.contributions.some((c) => c.employee === 0) && (
          ` Perusahaan juga membayar ${l.contributions.filter((c) => c.employee === 0)
            .map((c) => `${c.label.replace("BPJS TK — ", "")} ${formatIDR(c.employer)}`)
            .join(" dan ")} — tidak dipotong dari gaji.`
        )}
        {l.days_unpaid > 0 && ` ${formatNumber(l.days_unpaid)} hari tercatat tanpa dibayar.`}
        {" "}Satu jam biasa {formatIDR(l.hourly)} —{" "}
        {l.hourly_basis === "company"
          ? `${formatIDR(l.annual_pay)} setahun dibagi hari kerja efektif dan jam sehari`
          : "gaji sebulan dibagi 173, angka peraturan"}.
        {/* Lateness that costs nothing must still be visible as lateness that
            costs nothing — otherwise the slip reads as though there was none. */}
        {l.late_deduction === 0 && l.late_minutes > 0 && (
          ` Terlambat ${formatNumber(l.late_minutes)} menit di luar toleransi, tidak dipotong.`
        )}
      </p>

      <div className="mt-2 flex justify-between gap-2 text-[8px] text-slate-500">
        <span className="flex-1 border-t border-slate-400 pt-0.5 text-center">Dibuat</span>
        <span className="flex-1 border-t border-slate-400 pt-0.5 text-center">Diterima</span>
      </div>
    </section>
  );
}

/** The owner's own sketch: the week across, in · out · hours · overtime down.
 *
 *  Split into week blocks so a monthly period prints as four short rows rather
 *  than one that runs off the paper. */
function WeekGrid({ days }: { days: PayslipDay[] }) {
  const weeks: PayslipDay[][] = [];
  let current: PayslipDay[] = [];
  for (const d of days) {
    if (current.length > 0 && d.weekday === 1) { weeks.push(current); current = []; }
    current.push(d);
  }
  if (current.length > 0) weeks.push(current);

  return (
    <div className="mt-1.5 space-y-1">
      {weeks.map((week, i) => (
        <table key={i} className="w-full table-fixed border-collapse text-center text-[8px]">
          <thead>
            <tr>
              <th className="w-8" />
              {week.map((d) => (
                <th key={d.work_date} className="border border-slate-200 bg-slate-50 py-0.5 font-medium text-slate-600">
                  {DAY_LABEL[d.weekday]} {d.work_date.slice(8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <td className="pr-1 text-right text-[7px] uppercase text-slate-400">masuk</td>
              {week.map((d) => (
                <td key={d.work_date} className="border border-slate-200 py-0.5">
                  {d.mark ? <span className="text-slate-500">{d.mark}</span> : (d.in_at ?? "—")}
                </td>
              ))}
            </tr>
            <tr>
              <td className="pr-1 text-right text-[7px] uppercase text-slate-400">pulang</td>
              {week.map((d) => (
                <td key={d.work_date} className="border border-slate-200 py-0.5">
                  {d.mark ? "" : (d.out_at ?? "—")}
                </td>
              ))}
            </tr>
            <tr>
              <td className="pr-1 text-right text-[7px] uppercase text-slate-400">jam</td>
              {week.map((d) => (
                <td key={d.work_date} className={cn(
                  "border border-slate-200 py-0.5 font-medium",
                  d.open && "text-slate-500",
                )}>
                  {d.work_hours > 0 ? formatNumber(d.work_hours) : ""}
                  {/* A day that is on the paper but not in the total. Marking
                      it here is the whole point: the employee sees the hours,
                      so the slip has to say why they were not counted. */}
                  {d.open && <span className="font-bold">&nbsp;?</span>}
                </td>
              ))}
            </tr>
            <tr>
              <td className="pr-1 text-right text-[7px] uppercase text-slate-400">lembur</td>
              {week.map((d) => (
                <td key={d.work_date} className="border border-slate-200 py-0.5 font-medium">
                  {d.overtime_hours > 0 ? `+${formatNumber(d.overtime_hours)}` : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
