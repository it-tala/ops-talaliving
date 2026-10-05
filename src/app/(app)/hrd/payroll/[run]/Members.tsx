"use client";

import { useState } from "react";
import { SlidersHorizontal, UserMinus, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  DEDUCTION_COMPONENTS, PAY_COMPONENTS, PAY_COMPONENT_LABELS, PAY_GROUP_LABELS, inPayGroup,
  type PayComponent, type PayComponents, type PayrollRun, type PayrollRunMember,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";

/** Who this run pays, and what it pays them (0211, D369).
 *
 *  Owner: *saya ingin payroll nya lebih fleksibel, mana yang dibayar mana yang
 *  tidak, karyawan mana yang ikut payroll, komponen apa yang dikurangi*. Three
 *  levels, each one overriding the one before:
 *
 *  1. the run's **group** (weekly, monthly, everybody, picked by hand) decides
 *     who it is born with;
 *  2. the run's **switches** say which components it pays or deducts;
 *  3. a **person** can be taken off the run, or have their own switches.
 *
 *  Anything taken away needs a sentence, because it is printed on the slip:
 *  a figure missing with no reason beside it is the one people come to the
 *  counter about. The rows another run already pays are shown too, with that
 *  run named — the same day is never paid twice.
 */
export function Members({
  run, editable, onChanged,
}: {
  run: PayrollRun;
  editable: boolean;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const lang = useLang();
  const mayEdit = editable && can("payroll.run");
  const [rows, reload] = useLoad(() => hr.listRunMembers(run.run_no), [run.run_no]);
  const [people] = useLoad(() => hr.listEmployees(), []);
  const [busy, setBusy] = useState(false);

  /* The run's own switches, edited in place. */
  const [runComps, setRunComps] = useState<PayComponents>(run.components ?? {});
  const [runNote, setRunNote] = useState(run.components_note ?? "");
  const runDirty = JSON.stringify(runComps) !== JSON.stringify(run.components ?? {})
    || runNote.trim() !== (run.components_note ?? "");
  const runAnyOff = Object.values(runComps).some((v) => v === false);

  /* One person, in a drawer. */
  const [editing, setEditing] = useState<PayrollRunMember | null>(null);
  const [personComps, setPersonComps] = useState<PayComponents>({});
  const [personIncluded, setPersonIncluded] = useState(true);
  const [personNote, setPersonNote] = useState("");
  const [adding, setAdding] = useState("");
  /* Forty names is a page of scrolling before the lines; the first few and a
     way to see the rest. Anybody with something of their own is always shown. */
  const [showAll, setShowAll] = useState(false);

  function openPerson(m: PayrollRunMember) {
    setEditing(m);
    setPersonComps(m.components ?? {});
    setPersonIncluded(m.included);
    setPersonNote(m.auto ? "" : m.note ?? "");
  }

  async function saveRun() {
    setBusy(true);
    /* Only the keys switched off are sent: absent means paid. */
    const comps = Object.fromEntries(Object.entries(runComps).filter(([, v]) => v === false)) as PayComponents;
    const res = await hr.setRunComponents({ run_no: run.run_no, components: comps, note: runNote });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr("Run components saved", "Komponen run tersimpan"), run.run_no);
    onChanged();
  }

  async function savePerson(m: { employee_no: string; full_name: string }, included: boolean,
    comps: PayComponents, note: string) {
    setBusy(true);
    const res = await hr.setRunMember({
      run_no: run.run_no, employee_no: m.employee_no, included, components: comps, note,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return false;
    }
    toast("success", included ? tr("On the run", "Ikut run ini") : tr("Off the run", "Dikeluarkan dari run"), m.full_name);
    reload(); onChanged();
    return true;
  }

  /** What a component reads as, for one person: their own switch, else the
   *  run's, else paid. */
  const label = (c: PayComponent) => PAY_COMPONENT_LABELS[c][lang];
  const offWord = (c: PayComponent) => DEDUCTION_COMPONENTS.has(c)
    ? tr("not deducted", "tidak dipotong") : tr("not paid", "tidak dibayar");

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Who is paid, and what", "Peserta & komponen")}
        subtitle={tr(
          `Opened for: ${PAY_GROUP_LABELS[run.pay_group ?? "all"].en}. Take people off, add them, or switch a component off for the run or for one person — each with a reason printed on the slip.`,
          `Dibuka untuk: ${PAY_GROUP_LABELS[run.pay_group ?? "all"].id}. Keluarkan atau tambahkan orang, atau matikan satu komponen untuk seluruh run atau untuk satu orang — masing-masing dengan alasan yang tercetak di slip.`,
        )}
        icon={Users}
      />

      {/* ── the run's switches ── */}
      <div className="border-b border-slate-100 px-5 py-3">
        <p className="mb-2 text-[12px] font-medium text-slate-600">
          {tr("Components of this run", "Komponen run ini")}
        </p>
        <div className="flex flex-wrap gap-2">
          {PAY_COMPONENTS.map((c) => {
            const isOn = runComps[c] !== false;
            return (
              <label
                key={c}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px]",
                  isOn ? "border-slate-200 bg-white text-slate-700" : "border-amber-300 bg-amber-50 text-amber-900",
                  !mayEdit && "cursor-default opacity-80",
                )}
              >
                <input
                  type="checkbox" checked={isOn} disabled={!mayEdit || busy}
                  onChange={(e) => setRunComps({ ...runComps, [c]: e.target.checked ? undefined : false })}
                />
                {label(c)}
                {!isOn && <span className="text-[11px]">· {offWord(c)}</span>}
              </label>
            );
          })}
        </div>
        {(runAnyOff || runNote) && (
          <input
            value={runNote} disabled={!mayEdit || busy}
            onChange={(e) => setRunNote(e.target.value)}
            placeholder={tr("Why — printed on every slip in this run", "Alasan — tercetak di setiap slip run ini")}
            className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        )}
        {mayEdit && runDirty && (
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={saveRun} disabled={busy || (runAnyOff && !runNote.trim())}>
              {tr("Save components", "Simpan komponen")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => { setRunComps(run.components ?? {}); setRunNote(run.components_note ?? ""); }}>
              {tr("Undo", "Batal")}
            </Button>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-slate-500">
          {tr(
            "Something switched off is not moved to another run by itself — pay it later with an addition if it is owed.",
            "Yang dimatikan tidak pindah sendiri ke run lain — kalau masih terutang, bayar nanti lewat tambahan.",
          )}
        </p>
      </div>

      {/* ── the people ── */}
      <Loaded state={rows} onRetry={reload} skeletonRows={3}>
        {(all) => {
          const onRun = all.filter((m) => m.included);
          const offRun = all.filter((m) => !m.included);
          const listed = new Set(all.map((m) => m.employee_no));
          const Row = (m: PayrollRunMember) => {
            const own = PAY_COMPONENTS.filter((c) => m.components?.[c] !== undefined);
            return (
              <li key={m.employee_no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className={cn("min-w-[170px] text-[13px] font-medium", m.included ? "text-slate-800" : "text-slate-400 line-through")}>
                  {m.full_name}
                  <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{m.employee_no}</span>
                </span>
                <Badge tone={m.pay_basis === "monthly" ? "violet" : "slate"}>
                  {m.pay_basis === "monthly" ? tr("monthly", "bulanan") : m.pay_basis === "daily" ? tr("daily", "harian") : tr("hourly", "per jam")}
                </Badge>
                {own.map((c) => (
                  <Badge key={c} tone={m.components[c] === false ? "amber" : "green"}>
                    {label(c)}: {m.components[c] === false ? offWord(c) : tr("paid", "dibayar")}
                  </Badge>
                ))}
                <span className="min-w-[160px] flex-1 text-[12px] text-slate-500">{m.note ?? ""}</span>
                {mayEdit && (
                  <Button size="sm" variant="ghost" icon={SlidersHorizontal} disabled={busy} onClick={() => openPerson(m)}>
                    {tr("Change", "Ubah")}
                  </Button>
                )}
              </li>
            );
          };
          return (
            <>
              <p className="px-5 pt-3 text-[12px] font-medium text-slate-600">
                {tr(`On this run · ${onRun.length}`, `Ikut run ini · ${onRun.length}`)}
              </p>
              <ul className="divide-y divide-slate-100">
                {onRun.length === 0 && (
                  <li className="px-5 py-3 text-[13px] text-slate-500">
                    {tr("Nobody yet — add people below.", "Belum ada — tambahkan orang di bawah.")}
                  </li>
                )}
                {(showAll ? onRun : onRun.filter((m, i) => i < 8
                  || PAY_COMPONENTS.some((c) => m.components?.[c] !== undefined))).map(Row)}
              </ul>
              {onRun.length > 8 && (
                <button
                  type="button" onClick={() => setShowAll(!showAll)}
                  className="w-full border-t border-slate-100 px-5 py-2 text-left text-[12px] font-medium text-brand-700 hover:bg-slate-50"
                >
                  {showAll
                    ? tr("Show fewer", "Tampilkan lebih sedikit")
                    : tr(`Show all ${onRun.length}`, `Tampilkan semua ${onRun.length}`)}
                </button>
              )}
              {offRun.length > 0 && (
                <>
                  <p className="border-t border-slate-100 px-5 pt-3 text-[12px] font-medium text-slate-600">
                    {tr(`Not on this run · ${offRun.length}`, `Tidak ikut run ini · ${offRun.length}`)}
                  </p>
                  <ul className="divide-y divide-slate-100">{offRun.map(Row)}</ul>
                </>
              )}
              {mayEdit && (
                <Loaded state={people} skeletonRows={1}>
                  {(emps) => {
                    const candidates = emps.filter((e) => !listed.has(e.employee_no));
                    return candidates.length === 0 ? null : (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
                        <select
                          value={adding} onChange={(e) => setAdding(e.target.value)}
                          aria-label={tr("Add a person", "Tambah orang")}
                          className="h-9 min-w-[240px] flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          <option value="">{tr("Add somebody not on the list…", "Tambah orang yang belum ada di daftar…")}</option>
                          {candidates.map((e) => (
                            <option key={e.employee_no} value={e.employee_no}>
                              {e.full_name} · {e.employee_no}
                              {!inPayGroup(e.pay_basis, run.pay_group ?? "all") ? tr(" (other group)", " (kelompok lain)") : ""}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" icon={UserPlus} disabled={busy || !adding}
                          onClick={async () => {
                            const e = candidates.find((x) => x.employee_no === adding);
                            if (e && await savePerson(e, true, {}, "")) setAdding("");
                          }}>
                          {tr("Add to run", "Ikutkan")}
                        </Button>
                      </div>
                    );
                  }}
                </Loaded>
              )}
            </>
          );
        }}
      </Loaded>

      {editing && (
        <Drawer
          open onClose={() => setEditing(null)} width="max-w-md"
          title={editing.full_name}
          subtitle={`${editing.employee_no} · ${run.run_no}`}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
              <Button
                icon={personIncluded ? SlidersHorizontal : UserMinus}
                disabled={busy || ((!personIncluded || Object.values(personComps).some((v) => v === false)) && !personNote.trim())}
                onClick={async () => {
                  if (await savePerson(editing, personIncluded, personComps, personNote)) setEditing(null);
                }}
              >
                {tr("Save", "Simpan")}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={personIncluded} onChange={(e) => setPersonIncluded(e.target.checked)} />
              <span className="font-medium text-slate-800">{tr("Paid by this run", "Ikut dibayar di run ini")}</span>
            </label>
            {editing.auto && editing.note && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">{editing.note}</p>
            )}

            {personIncluded && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-slate-600">
                  {tr("Components for this person", "Komponen untuk orang ini")}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {PAY_COMPONENTS.map((c) => {
                    const v = personComps[c];
                    const runOn = run.components?.[c] !== false;
                    return (
                      <li key={c} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="text-slate-700">{label(c)}</span>
                        <select
                          value={v === undefined ? "run" : v ? "on" : "off"}
                          onChange={(e) => {
                            const next = { ...personComps };
                            if (e.target.value === "run") delete next[c];
                            else next[c] = e.target.value === "on";
                            setPersonComps(next);
                          }}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] focus:border-brand-400 focus:outline-none"
                        >
                          <option value="run">
                            {tr("as the run", "ikut run")} ({runOn ? tr("yes", "ya") : offWord(c)})
                          </option>
                          <option value="on">{DEDUCTION_COMPONENTS.has(c) ? tr("deduct", "potong") : tr("pay", "bayar")}</option>
                          <option value="off">{offWord(c)}</option>
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div>
              <label htmlFor="member-note" className="mb-1 block text-[12px] font-medium text-slate-600">
                {tr("Reason", "Alasan")}
              </label>
              <input
                id="member-note" value={personNote} onChange={(e) => setPersonNote(e.target.value)}
                placeholder={tr("Printed on the slip — required to take somebody off or switch something off",
                  "Tercetak di slip — wajib untuk mengeluarkan orang atau mematikan komponen")}
                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>
        </Drawer>
      )}
    </Card>
  );
}
