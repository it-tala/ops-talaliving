"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, PlayCircle } from "lucide-react";
import { Button, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { hr } from "@/demo/api";
import {
  ADJUSTMENT_LABEL, PAY_GROUP_LABELS, PAY_WEEK_STARTS_DEFAULT,
  type PayGroup, type PayrollAdjustInput, type PayrollHold, type PayrollLine,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { officeToday } from "@/lib/office";
import { PayrollSheet, type SheetAside } from "../PayrollSheet";
import type { AdjustEditor } from "../SheetEditors";

/** Generating a payroll, as one sheet (0213, D373).
 *
 *  The order is the owner's: attendance complete first, then the rates, then
 *  every person's breakdown one click away, and the totals of what is added
 *  and what is taken — all on this page, before anything is opened. Each
 *  person has a box. Ticked is paid by the run this generates; unticked is
 *  held, with a sentence, and can be generated later by a second run over the
 *  same days — which is how *only one or two of the weekly people* works.
 *
 *  Two kinds of row cannot be ticked. A person with a day the machine left
 *  unread is held until somebody reads it: the run could not be approved over
 *  it anyway (D139). A person another run already pays for these days is
 *  shown with that run's number: the same day is never paid twice (D370).
 */

const GROUPS: PayGroup[] = ["weekly", "monthly", "all"];

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The pay week a day falls in, for a week that starts on ISO weekday `dow`. */
function payWeekOf(key: string, dow: number): [string, string] {
  const start = addDays(key, -((weekdayOf(key) - dow + 7) % 7));
  return [start, addDays(start, 6)];
}

/** The month a number of months from the one `key` is in. */
function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Days from `a` to `b`, both counted. */
function spanOf(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

function monthOf(key: string): [string, string] {
  const [y, m] = key.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [`${key.slice(0, 7)}-01`, end];
}

export default function GeneratePayrollPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const lang = useLang();
  const mayRun = can("payroll.run");

  const today = officeToday();
  const [group, setGroup] = useState<PayGroup>("weekly");
  const [[from, to], setPeriod] = useState<[string, string]>(() => payWeekOf(today, PAY_WEEK_STARTS_DEFAULT));
  const span = spanOf(from, to);
  const [holdReason, setHoldReason] = useState("");
  const [busy, setBusy] = useState(false);

  /* Picking a group moves the period to that group's own: the pay week for
     day wages, the month for salaries. Either can still be typed. */
  function pickGroup(g: PayGroup) {
    setGroup(g);
    setPeriod(g === "monthly" ? monthOf(today) : payWeekOf(today, PAY_WEEK_STARTS_DEFAULT));
  }

  const [view, reload] = useLoad(
    () => hr.previewPayroll({ period_start: from, period_end: to, pay_group: group, fresh: true }),
    [from, to, group],
  );

  /* Bonus, retensi and lain-lain typed in the drawer before the run exists
     (D388). Kept here, shown on the lines, and written with the run by
     `generate_payroll` — for a different period they are a different
     decision, so moving the period clears them. */
  const [pending, setPending] = useState<Record<string, PayrollAdjustInput[]>>({});
  /* 0236 (D389): the sheet starts every salaried person with the monthly
     defaults due in this period — retensi, BPJS TK, BPJS Kesehatan, or a
     person's own amount — as deductions HRD can still take off here. */
  const [due] = useLoad(() => hr.dueDeductions({ from, to }), [from, to]);
  useEffect(() => {
    const seed: Record<string, PayrollAdjustInput[]> = {};
    if (due.status === "ready") {
      for (const d of due.data) {
        (seed[d.employee_no] ??= []).push({ employee_no: d.employee_no, kind: d.kind, amount: -d.amount, reason: d.reason });
      }
    }
    setPending(seed);
  }, [due, group]);
  const adjust: AdjustEditor = {
    list: (no) => (pending[no] ?? []).map((a, i) => ({ key: String(i), kind: a.kind, amount: a.amount, reason: a.reason })),
    add: async (no, a) => {
      if (!a.reason) return tr("A reason is printed on the payslip.", "Alasannya tercetak di slip.");
      if (a.amount === 0) return tr("Nought is not an adjustment.", "Nol bukan penyesuaian.");
      setPending((p) => ({ ...p, [no]: [...(p[no] ?? []), { employee_no: no, ...a }] }));
      return null;
    },
    remove: async (no, key) => {
      setPending((p) => ({ ...p, [no]: (p[no] ?? []).filter((_, i) => String(i) !== key) }));
      return null;
    },
  };
  const mayEditDays = can("hrd.create");
  const [paid, reloadPaid] = useLoad(
    () => hr.paidElsewhere({ period_start: from, period_end: to }),
    [from, to],
  );

  const paidBy = useMemo(() => {
    const m = new Map<string, string>();
    if (paid.status === "ready") for (const p of paid.data) m.set(p.employee_no, p.run_no);
    return m;
  }, [paid]);

  /* The line as it will be once the run carries what was typed: the two
     columns and take-home move by exactly those amounts, which the database
     will add the same way (`additions_total`, `deductions_total`). */
  const withPending = (l: PayrollLine): PayrollLine => {
    const extra = pending[l.employee_no] ?? [];
    if (extra.length === 0) return l;
    const plus = extra.filter((a) => a.amount > 0).reduce((t, a) => t + a.amount, 0);
    const minus = extra.filter((a) => a.amount < 0).reduce((t, a) => t - a.amount, 0);
    return {
      ...l,
      adjustments: [...l.adjustments, ...extra.map((a) => ({ kind: a.kind, label: ADJUSTMENT_LABEL[a.kind], amount: a.amount, reason: a.reason }))],
      adjustment_total: l.adjustment_total + plus - minus,
      additions_total: l.additions_total + plus,
      deductions_total: l.deductions_total + minus,
      take_home: l.take_home + plus - minus,
    };
  };
  const lines: PayrollLine[] = view.status === "ready"
    ? view.data.lines.filter((l) => !paidBy.has(l.employee_no)).map(withPending) : [];
  const asides: SheetAside[] = view.status === "ready"
    ? view.data.lines.filter((l) => paidBy.has(l.employee_no)).map((l) => ({
      employee_no: l.employee_no, full_name: l.full_name, pay_basis: l.pay_basis, locked: true,
      reason: tr(`Already paid for these days by ${paidBy.get(l.employee_no)}`, `Sudah dibayar untuk hari-hari ini di ${paidBy.get(l.employee_no)}`),
    })) : [];

  /* 0242 (D394): a salaried working day with no tap and no mark holds the
     person too, said apart from the unread ones. */
  const holdNote = (l: PayrollLine, en: boolean): string => {
    const unc = l.days_unconfirmed ?? 0;
    const unread = l.days_open - unc;
    const parts = [
      unread > 0 ? (en ? `${unread} day(s) unread` : `${unread} hari belum dibaca`) : null,
      unc > 0 ? (en ? `${unc} day(s) with no tap not confirmed` : `${unc} hari tanpa tap belum dikonfirmasi`) : null,
    ].filter(Boolean).join(", ");
    return en ? `Attendance not complete — ${parts}` : `Absensi belum lengkap — ${parts}`;
  };
  const blocked = (l: PayrollLine): string | null => l.days_open > 0
    ? tr(holdNote(l, true), holdNote(l, false))
    : null;

  /* Somebody with nothing to be paid — no day worked, no salary — is left
     unticked: a line of Rp 0 is not a payment. It can still be ticked. */
  const empty = (l: PayrollLine) => l.additions_total === 0;

  /* Everybody who can be paid is ticked when the sheet loads. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const linesKey = lines.map((l) => `${l.employee_no}:${l.days_open}`).join(",");
  useEffect(() => {
    setSelected(new Set(lines.filter((l) => blocked(l) === null && !empty(l)).map((l) => l.employee_no)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  function toggle(no: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(no); else next.delete(no);
      return next;
    });
  }
  function toggleAll(on: boolean) {
    setSelected(on ? new Set(lines.filter((l) => blocked(l) === null).map((l) => l.employee_no)) : new Set());
  }

  const chosen = lines.filter((l) => selected.has(l.employee_no));
  const pendingCount = chosen.reduce((t, l) => t + (pending[l.employee_no]?.length ?? 0), 0);
  const manuallyHeld = lines.filter((l) => !selected.has(l.employee_no) && blocked(l) === null && !empty(l));

  async function generate() {
    const hold: PayrollHold[] = lines
      .filter((l) => !selected.has(l.employee_no))
      .map((l) => ({
        employee_no: l.employee_no,
        note: blocked(l) !== null
          ? holdNote(l, false)
          : empty(l) ? "Tidak ada yang dibayar di periode ini"
            : holdReason.trim() || "Ditahan HRD saat generate",
      }));
    const adjustments = chosen.flatMap((l) => pending[l.employee_no] ?? []);
    setBusy(true);
    const res = await hr.generatePayroll({ period_start: from, period_end: to, pay_group: group, hold, adjust: adjustments });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not generated", "Tidak digenerate"), res.error.message);
      reloadPaid(); reload();
      return;
    }
    toast("success", tr(`${res.data.run_no} generated`, `${res.data.run_no} digenerate`),
      tr(`${res.data.lines.length} people · ${formatIDR(res.data.take_home_total)} take-home`,
        `${res.data.lines.length} orang · ${formatIDR(res.data.take_home_total)} diterima`));
    window.location.href = `/hrd/payroll/${encodeURIComponent(res.data.run_no)}`;
  }

  return (
    <div>
      <Link href="/hrd/payroll" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {tr("All runs", "Semua periode gaji")}
      </Link>
      <PageHeader
        breadcrumb={tr("HRD · Payroll", "HRD · Penggajian")}
        title={tr("Generate payroll", "Buat payroll")}
        description={tr(
          "Check attendance, read every rate and breakdown, tick who is paid — then generate. Nothing is opened until you press the button.",
          "Periksa absensi, baca setiap rate dan rinciannya, centang siapa yang dibayar — lalu generate. Belum ada yang dibuka sampai tombolnya ditekan.",
        )}
        actions={<SourceBadge state={view} />}
      />

      {/* The period and who it is for. */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
        <div>
          <label htmlFor="g-group" className="block text-xs text-slate-500">{tr("For", "Untuk")}</label>
          <select
            id="g-group" value={group} onChange={(e) => pickGroup(e.target.value as PayGroup)}
            className="mt-1 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            {GROUPS.map((g) => <option key={g} value={g}>{PAY_GROUP_LABELS[g][lang]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="g-from" className="block text-xs text-slate-500">{tr("Period from", "Periode dari")}</label>
          <input id="g-from" type="date" value={from} onChange={(e) => setPeriod([e.target.value, to])}
            className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="g-to" className="block text-xs text-slate-500">{tr("to", "sampai")}</label>
          <input id="g-to" type="date" value={to} onChange={(e) => setPeriod([from, e.target.value])}
            className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        {/* Walking the period: by the pay week for wages, by the month for
            salaries — a salary is compared month by month (D386). A wage
            period HRD typed walks by its own length, so a run of seven or
            ten days is followed by the next seven or ten (D406). */}
        <div className="flex gap-1.5">
          {group === "monthly" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setPeriod(monthOf(shiftMonth(from, -1)))}>
                {tr("‹ Month", "‹ Bulan")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPeriod(monthOf(shiftMonth(from, 1)))}>
                {tr("Month ›", "Bulan ›")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={span < 1} onClick={() => setPeriod([addDays(from, -span), addDays(to, -span)])}>
                {tr(`‹ ${span} days`, `‹ ${span} hari`)}
              </Button>
              <Button size="sm" variant="outline" disabled={span < 1} onClick={() => setPeriod([addDays(from, span), addDays(to, span)])}>
                {tr(`${span} days ›`, `${span} hari ›`)}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPeriod(payWeekOf(from, PAY_WEEK_STARTS_DEFAULT))}>
                {tr("Pay week", "Minggu bayar")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPeriod(monthOf(from))}>
                {tr("Whole month", "Sebulan")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Loaded state={view} onRetry={reload}>
        {() => (
          <>
            <PayrollSheet
              lines={lines} asides={asides}
              selectable selected={selected} onToggle={toggle} onToggleAll={toggleAll}
              blocked={blocked}
              adjust={mayRun ? adjust : undefined}
              period={{ from, to }}
              editDays={mayEditDays}
              onChanged={() => { reload(); reloadPaid(); }}
              title={tr(`${PAY_GROUP_LABELS[group].en} · ${from} → ${to}`, `${PAY_GROUP_LABELS[group].id} · ${from} → ${to}`)}
            />

            {/* ── 4. generate ── */}
            <div className="sticky bottom-3 z-10 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
              <div className="min-w-[260px] flex-1">
                <label htmlFor="g-hold" className="block text-xs text-slate-500">
                  {tr(
                    `Reason for the ${manuallyHeld.length} unticked (printed on the run)`,
                    `Alasan ${manuallyHeld.length} orang yang tidak dicentang (tercetak di run)`,
                  )}
                </label>
                <input
                  id="g-hold" value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
                  disabled={manuallyHeld.length === 0}
                  placeholder={tr("e.g. paid next week, account not yet open", "mis. dibayar minggu depan, rekening belum ada")}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
                />
              </div>
              <div className="text-right text-[12px] text-slate-500">
                <p>{tr(`${chosen.length} paid · ${lines.length - chosen.length} held`, `${chosen.length} dibayar · ${lines.length - chosen.length} ditahan`)}</p>
                {pendingCount > 0 && (
                  <p>{tr(`${pendingCount} adjustment(s) go with the run`, `${pendingCount} penyesuaian ikut dibuat`)}</p>
                )}
              </div>
              <Button icon={PlayCircle} disabled={busy || !mayRun || chosen.length === 0} onClick={generate}>
                {busy ? tr("Generating…", "Membuat…") : tr(`Generate for ${chosen.length}`, `Generate ${chosen.length} orang`)}
              </Button>
            </div>
          </>
        )}
      </Loaded>
    </div>
  );
}
