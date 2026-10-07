"use client";

import { useState } from "react";
import { Save, Trash2, Plus, Receipt } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { accounting, procurement } from "@/demo/api";
import type {
  CashFrequency, CashflowCategory, CashflowReceipt, CashflowRow, Direction,
} from "@/services/accounting/contracts";
import { CASHFLOW_IN_CATEGORIES, CASHFLOW_OUT_CATEGORIES } from "@/services/accounting/contracts";
import { growthFactor, addMonths } from "@/services/accounting/cashflow";
import { useToast } from "@/store/toast";
import { useT, useTr } from "@/lib/i18n";
import { CATEGORY_LABEL, WEEKDAYS, WEEKDAYS_ID, dayLabel, monthLabel } from "./shared";

export const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
export const labelCls = "block text-xs text-slate-500";

/** One of the cashflow's own lines — a client's termin, tax, an instalment:
 *  what it is, how much, when, how it grows — and, once it exists, the money
 *  that actually came in (or went out) against it. */
export function LineDrawer({
  row, direction, receipts, onClose, onSaved, onChanged,
}: {
  row: CashflowRow | null; direction: Direction; receipts: CashflowReceipt[];
  onClose: () => void; onSaved: () => void; onChanged: () => void;
}) {
  const tr = useTr();
  const t = useT();
  const { toast } = useToast();
  const thisMonth = officeToday().slice(0, 7);
  const l = row?.line;
  const cats = direction === "IN" ? CASHFLOW_IN_CATEGORIES : CASHFLOW_OUT_CATEGORIES;
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const [types] = useLoad(() => accounting.listTypeRows(), []);

  const [name, setName] = useState(l?.name ?? "");
  const [category, setCategory] = useState<CashflowCategory>(l?.category ?? (direction === "IN" ? "client" : "other_out"));
  const [frequency, setFrequency] = useState<CashFrequency>(l?.frequency ?? (direction === "IN" ? "once" : "monthly"));
  const [amount, setAmount] = useState(l?.amount ?? 0);
  const [dueDay, setDueDay] = useState(l?.due_day ?? 10);
  const [weekday, setWeekday] = useState(l?.due_weekday ?? 5);
  const [dueDate, setDueDate] = useState(l?.due_date ?? "");
  const [startsOn, setStartsOn] = useState(l?.starts_on ?? thisMonth);
  const [endsOn, setEndsOn] = useState(l?.ends_on ?? "");
  const [growth, setGrowth] = useState(String(l?.growth_pct ?? 0));
  const [growthFrom, setGrowthFrom] = useState(l?.growth_from ?? l?.starts_on ?? thisMonth);
  const [projectId, setProjectId] = useState(l?.project_id ?? "");
  const [typeCode, setTypeCode] = useState(l?.type_code ?? "");
  const [note, setNote] = useState(l?.note ?? "");
  const [busy, setBusy] = useState(false);

  const g = Number(growth) || 0;
  const preview = frequency !== "once" && g !== 0 && amount > 0
    ? [0, 3, 6, 11].map((n) => {
      const m = addMonths(growthFrom || startsOn, n);
      return [m, Math.round(amount * growthFactor({ growth_pct: g, growth_from: growthFrom || startsOn, starts_on: startsOn }, m, startsOn))] as const;
    })
    : null;

  async function save() {
    setBusy(true);
    const res = await accounting.saveCashflowLine({
      name, direction, category, frequency, amount,
      due_day: dueDay, due_weekday: weekday, due_date: dueDate || null,
      starts_on: frequency === "once" ? dueDate.slice(0, 7) : startsOn,
      ends_on: endsOn || null,
      growth_pct: frequency === "once" ? 0 : g, growth_from: frequency === "once" ? null : growthFrom || startsOn,
      project_id: projectId || null, type_code: typeCode || null, note: note || null,
    }, l?.id ?? null);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", l ? tr("Updated", "Diperbarui") : tr("Added to the cashflow", "Ditambahkan ke cashflow"), `${name} · ${formatIDR(amount)}`);
    onSaved();
  }

  async function remove() {
    if (!l) return;
    setBusy(true);
    const res = await accounting.removeCashflowLine(l.id);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    toast("success", tr("Off the cashflow", "Dikeluarkan dari cashflow"), name);
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={l ? l.name : direction === "IN" ? tr("Expected income", "Estimasi pemasukan") : tr("Expected spending", "Estimasi pengeluaran")}
      subtitle={direction === "IN"
        ? tr("Money the company expects to receive — a client's termin, a DP, a pelunasan.", "Uang yang diharapkan masuk — termin klien, DP, pelunasan.")
        : tr("Spending the payment calendar does not hold — tax, an instalment, a large one-off.", "Pengeluaran yang tidak ada di kalender pembayaran — pajak, cicilan, pengeluaran besar sekali.")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {l && <Button variant="ghost" size="sm" icon={Trash2} onClick={remove} disabled={busy}>{tr("Remove", "Hapus")}</Button>}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Save} onClick={save} disabled={busy || !name.trim() || amount <= 0 || (frequency === "once" && !dueDate)}>
              {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="cf-name" className={labelCls}>{tr("What it is", "Apa ini")}</label>
          <input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} className={field}
            placeholder={direction === "IN" ? tr("e.g. Termin 2 — Hotel Ubud", "mis. Termin 2 — Hotel Ubud") : tr("e.g. PPh 21", "mis. PPh 21")} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cf-cat" className={labelCls}>{tr("Group", "Kelompok")}</label>
            <select id="cf-cat" value={category} onChange={(e) => setCategory(e.target.value as CashflowCategory)} className={field}>
              {cats.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cf-proj" className={labelCls}>{tr("Project (optional)", "Proyek (opsional)")}</label>
            <select id="cf-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
              <option value="">—</option>
              {projects.status === "ready" && projects.data.filter((p) => p.is_active || p.id === projectId).map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className={labelCls}>{tr("How often", "Seberapa sering")}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {([["once", tr("Once", "Sekali")], ["monthly", tr("Every month", "Setiap bulan")], ["weekly", tr("Every week", "Setiap minggu")]] as [CashFrequency, string][]).map(([f, lbl]) => (
              <Button key={f} size="sm" variant={frequency === f ? "primary" : "outline"} onClick={() => setFrequency(f)}>{lbl}</Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cf-amt" className={labelCls}>{frequency === "once" ? tr("Amount", "Nominal") : frequency === "weekly" ? tr("Amount each week", "Nominal per minggu") : tr("Amount each month", "Nominal per bulan")}</label>
            <MoneyInput id="cf-amt" value={amount} onChange={setAmount} className="mt-1" />
          </div>
          {frequency === "once" && (
            <div>
              <label htmlFor="cf-date" className={labelCls}>{direction === "IN" ? tr("Expected on", "Diharapkan tanggal") : tr("Due on (bill date)", "Tanggal tagihan")}</label>
              <input id="cf-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
            </div>
          )}
          {frequency === "monthly" && (
            <div>
              <label htmlFor="cf-day" className={labelCls}>{tr("Day of the month (bill date)", "Tanggal tagihan tiap bulan")}</label>
              <input id="cf-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))} className={field} />
            </div>
          )}
          {frequency === "weekly" && (
            <div>
              <label htmlFor="cf-wd" className={labelCls}>{tr("Day of the week", "Hari")}</label>
              <select id="cf-wd" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{tr(d, WEEKDAYS_ID[i])}</option>)}
              </select>
            </div>
          )}
        </div>

        {frequency !== "once" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="cf-start" className={labelCls}>{tr("From", "Mulai")}</label>
                <input id="cf-start" type="month" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="cf-end" className={labelCls}>{tr("Until (empty = keeps going)", "Sampai (kosong = terus)")}</label>
                <input id="cf-end" type="month" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={field} />
              </div>
            </div>
            <GrowthFields growth={growth} setGrowth={setGrowth} growthFrom={growthFrom} setGrowthFrom={setGrowthFrom} preview={preview} />
          </>
        )}

        <div>
          <label htmlFor="cf-type" className={labelCls}>{tr("Ledger category (optional)", "Kategori ledger (opsional)")}</label>
          <select id="cf-type" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className={field}>
            <option value="">{tr("none — realisations typed here only", "tidak ada — realisasi diketik di sini saja")}</option>
            {types.status === "ready" && types.data.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("With a category, ledger rows of it (and of the project, if one is set) count as this line's actual.",
              "Dengan kategori, baris ledger kategori itu (dan proyeknya, bila diisi) dihitung sebagai aktual baris ini.")}
          </p>
        </div>

        <div>
          <label htmlFor="cf-note" className={labelCls}>{tr("Note (optional)", "Catatan (opsional)")}</label>
          <input id="cf-note" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </div>

        {l && <Receipts lineId={l.id} receipts={receipts} direction={direction} onChanged={onChanged} />}
      </div>
    </Drawer>
  );
}

export function GrowthFields({
  growth, setGrowth, growthFrom, setGrowthFrom, preview,
}: {
  growth: string; setGrowth: (v: string) => void; growthFrom: string; setGrowthFrom: (v: string) => void;
  preview: (readonly [string, number])[] | null;
}) {
  const tr = useTr();
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="cf-g" className={labelCls}>{tr("Growth per month (%)", "Pertumbuhan per bulan (%)")}</label>
          <input id="cf-g" type="number" step="0.5" value={growth} onChange={(e) => setGrowth(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="cf-gf" className={labelCls}>{tr("Growing from", "Tumbuh mulai")}</label>
          <input id="cf-gf" type="month" value={growthFrom} onChange={(e) => setGrowthFrom(e.target.value)} className={field} />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-600">
        {tr("Compounding: 5% means each month is 5% more than the one before. Negative shrinks it.",
          "Majemuk: 5% berarti tiap bulan 5% lebih besar dari bulan sebelumnya. Negatif berarti menyusut.")}
      </p>
      {preview && (
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-emerald-800">
          {preview.map(([m, v]) => <span key={m}>{monthLabel(m)}: {formatIDRCompact(v)}</span>)}
        </p>
      )}
    </div>
  );
}

function Receipts({
  lineId, receipts, direction, onChanged,
}: { lineId: string; receipts: CashflowReceipt[]; direction: Direction; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [onDate, setOnDate] = useState(officeToday());
  const [amount, setAmount] = useState(0);
  const [trx, setTrx] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const res = await accounting.recordCashflowReceipt(lineId, { on_date: onDate, amount, trx_no: trx || null, note: note || null });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    setAmount(0); setTrx(""); setNote("");
    toast("success", tr("Recorded", "Tercatat"), formatIDR(amount));
    onChanged();
  }
  async function remove(id: string) {
    const res = await accounting.removeCashflowReceipt(id);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    onChanged();
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <p className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[12px] font-semibold text-slate-700">
        <Receipt className="h-3.5 w-3.5 text-slate-400" />
        {direction === "IN" ? tr("Money received (actual)", "Uang diterima (realisasi)") : tr("Money paid (actual)", "Uang dibayar (realisasi)")}
      </p>
      {receipts.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-slate-500">{tr("Nothing recorded yet.", "Belum ada yang dicatat.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {receipts.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <span className="w-16 text-slate-500">{dayLabel(r.on_date)}</span>
              <span className="font-medium tabular-nums text-slate-800">{formatIDR(r.amount)}</span>
              <span className="flex-1 truncate text-slate-500">{[r.trx_no, r.note].filter(Boolean).join(" · ")}</span>
              <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-rose-600" aria-label={tr("Remove", "Hapus")}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
        <input type="date" value={onDate} max={officeToday()} onChange={(e) => setOnDate(e.target.value)} className={field} aria-label={tr("Date", "Tanggal")} />
        <MoneyInput value={amount} onChange={setAmount} className="mt-1" />
        <input value={trx} onChange={(e) => setTrx(e.target.value)} placeholder={tr("Ledger no. (optional)", "No. ledger (opsional)")} className={field} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note", "Catatan")} className={field} />
        <div className="sm:col-span-2">
          <Button size="sm" icon={Plus} onClick={add} disabled={busy || amount <= 0}>{tr("Record", "Catat realisasi")}</Button>
        </div>
      </div>
    </div>
  );
}
