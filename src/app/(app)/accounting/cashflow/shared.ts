import { getActiveLocale } from "@/lib/format";
import type { CashflowCategory, CashflowCellState, CashflowRow } from "@/services/accounting/contracts";
import type { Message } from "@/lib/i18n";

/** Labels and small formatters the cashflow's pieces share. */

export const CATEGORY_LABEL: Record<CashflowCategory, Message> = {
  client: { en: "Client payments", id: "Pembayaran klien" },
  capital: { en: "Capital & loans in", id: "Modal & pinjaman masuk" },
  other_in: { en: "Other income", id: "Pemasukan lain" },
  payroll: { en: "Payroll", id: "Gaji & upah" },
  bills: { en: "Monthly bills", id: "Tagihan bulanan" },
  subscription: { en: "Subscriptions", id: "Langganan" },
  vendor: { en: "Vendors & materials", id: "Vendor & material" },
  tax: { en: "Tax", id: "Pajak" },
  loan: { en: "Instalments & cards", id: "Cicilan & kartu kredit" },
  other_out: { en: "Other spending", id: "Pengeluaran lain" },
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(getActiveLocale(), long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });
}

/** `1–7 Okt` */
export function weekLabel(start: string, end: string): string {
  const d = new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1);
  const mon = d.toLocaleDateString(getActiveLocale(), { month: "short" });
  return `${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))} ${mon}`;
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(getActiveLocale(), { day: "numeric", month: "short" });
}

/** The week a date falls in: 1–7, 8–14, 15–21, 22–end (D392). */
export function weekStartOf(date: string): string {
  const day = Number(date.slice(8, 10));
  const start = day >= 22 ? 22 : day >= 15 ? 15 : day >= 8 ? 8 : 1;
  return `${date.slice(0, 8)}${String(start).padStart(2, "0")}`;
}

export const STATE_TONE: Record<CashflowCellState, string> = {
  PAID: "text-emerald-700",
  PARTIAL: "text-amber-700",
  OVERDUE: "text-rose-700",
  DUE: "text-amber-700",
  PLANNED: "text-slate-700",
  SKIPPED: "text-slate-300",
  NONE: "text-slate-300",
};

/** When it falls due, in words: *tgl 10*, *setiap Jumat*, *20 Okt*. */
export function scheduleLabel(r: CashflowRow, tr: (en: string, id: string) => string): string {
  if (r.frequency === "weekly") {
    const wd = r.due_weekday ?? 5;
    return tr(`every ${WEEKDAYS[wd]}`, `setiap ${WEEKDAYS_ID[wd]}`);
  }
  if (r.frequency === "once") return r.due_date ? dayLabel(r.due_date) : tr("once", "sekali");
  if (r.frequency === "monthly") return tr(`day ${r.due_day}`, `tgl ${r.due_day}`);
  return "—";
}

/** `+ 1,2 jt` / `− 800 rb` — a difference reads with its sign. */
export function signed(n: number, fmt: (v: number) => string): string {
  if (n === 0) return fmt(0);
  return `${n > 0 ? "+" : "−"} ${fmt(Math.abs(n))}`;
}
