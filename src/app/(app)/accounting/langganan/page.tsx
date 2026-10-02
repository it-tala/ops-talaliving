"use client";

import { useState } from "react";
import { Repeat, Plus, Pencil, CircleDollarSign, Pause, Play, Ban, Check } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { SubscriptionStatus, SubscriptionView } from "@/services/accounting/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr, type Message } from "@/lib/i18n";
import { SubscriptionDrawer } from "./SubscriptionDrawer";
import { PayModal, usd } from "./PayModal";

const CYCLE: Record<SubscriptionView["cycle"], Message> = {
  monthly: { en: "Monthly", id: "Bulanan" },
  yearly: { en: "Yearly", id: "Tahunan" },
  biennial: { en: "Every 2 years", id: "Setiap 2 tahun" },
};

const STATUS: Record<SubscriptionStatus, { label: Message; tone: "green" | "amber" | "slate" }> = {
  active: { label: { en: "Active", id: "Aktif" }, tone: "green" },
  paused: { label: { en: "Paused", id: "Dijeda" }, tone: "amber" },
  cancelled: { label: { en: "Cancelled", id: "Berhenti" }, tone: "slate" },
};

function daysFrom(today: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** What the company subscribes to: how often it is billed, whether the price is
 *  fixed or pay as you go, in which currency, at what rate, and what has been
 *  paid.
 *
 *  Every subscription is also a row on the payment calendar — that is where
 *  *does the money last* is answered with these included. This screen is where
 *  they are kept. It posts nothing to the ledger, and the account on a row is
 *  only how it is paid. */
export default function SubscriptionsPage() {
  const tr = useTr();
  const { toast } = useToast();
  const { can } = useSession();
  const [register, reload] = useLoad(() => accounting.getSubscriptions(), []);
  const [editing, setEditing] = useState<SubscriptionView | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<{ id: string; period: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const mayEdit = can("accounting.update");
  const mayRate = can("accounting.plan_cash");
  const today = officeToday();

  async function setStatus(s: SubscriptionView, status: SubscriptionStatus) {
    const res = await accounting.setSubscriptionStatus(s.id, status);
    if (res.error) { toast("warning", tr("Not changed", "Tidak diubah"), res.error.message); return; }
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Subscriptions", "Langganan")}
        description={tr("Services billed every month, every year or every two years — fixed or pay as you go, in dollars or rupiah. Each one is a row on the payment calendar, so the plan shows whether the money lasts with them included.", "Layanan yang ditagih tiap bulan, tiap tahun atau tiap dua tahun — tetap atau sesuai pemakaian, dalam dolar atau rupiah. Masing-masing menjadi baris di kalender pembayaran, sehingga rencana menunjukkan apakah uangnya cukup dengan semuanya.")}
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={register} />
            {mayEdit && <Button icon={Plus} onClick={() => setAdding(true)}>{tr("Add a subscription", "Tambah langganan")}</Button>}
          </div>
        }
      />

      <Loaded state={register} onRetry={reload}>
        {(r) => {
          const active = r.subscriptions.filter((s) => s.status === "active");
          const order = (s: SubscriptionView) => (s.status === "active" ? 0 : s.status === "paused" ? 1 : 2);
          const rows = [...r.subscriptions].sort((a, b) =>
            order(a) - order(b) || (a.next_due ?? "9999").localeCompare(b.next_due ?? "9999") || a.name.localeCompare(b.name));

          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label={tr("Per month, on average", "Per bulan, rata-rata")} value={formatIDR(r.monthly_average)}
                  note={tr("a year's cost ÷ 12 — yearly ones included", "biaya setahun ÷ 12 — termasuk yang tahunan")} />
                <Tile label={tr("Per year", "Per tahun")} value={formatIDR(r.yearly_total)}
                  note={tr(`${active.length} active`, `${active.length} aktif`)} />
                <RateTile rate={r.usd_idr} mayRate={mayRate} onSaved={reload} />
              </div>

              <Card>
                <CardHeader
                  title={tr("Register", "Daftar")}
                  subtitle={tr("Planned figures use the rate above. Once a billing is paid, the rupiah that actually left replaces the estimate and the rate it really went at is shown.", "Angka rencana memakai kurs di atas. Setelah satu tagihan dibayar, rupiah yang benar-benar keluar menggantikan perkiraan dan kurs sebenarnya ditampilkan.")}
                  icon={Repeat}
                />
                {rows.length === 0 ? (
                  <p className="px-5 py-8 text-[13px] text-slate-500">{tr("No subscriptions yet.", "Belum ada langganan.")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">{tr("Service", "Layanan")}</th>
                          <th className="px-4 py-2 text-left">{tr("Billed", "Ditagih")}</th>
                          <th className="px-4 py-2 text-right">{tr("Price", "Harga")}</th>
                          <th className="px-4 py-2 text-right">{tr("Planned (Rp)", "Rencana (Rp)")}</th>
                          <th className="px-4 py-2 text-right">{tr("Per year", "Per tahun")}</th>
                          <th className="px-4 py-2 text-left">{tr("Paid with", "Dibayar dengan")}</th>
                          <th className="px-4 py-2 text-left">{tr("Next billing", "Tagihan berikutnya")}</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s) => {
                          const days = s.next_due ? daysFrom(today, s.next_due) : null;
                          const last = s.payments[0] ?? null;
                          return (
                            <FragmentRow key={s.id}>
                              <tr className={cn("border-b border-slate-100 align-top", s.status !== "active" && "opacity-60")}>
                                <td className="px-4 py-2">
                                  <button type="button" className="text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
                                    <span className="block font-medium text-slate-800">{s.name}</span>
                                  </button>
                                  <span className="block text-[11px] text-slate-400">
                                    {[s.sub_no, s.provider, s.login_email].filter(Boolean).join(" · ")}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  <Badge tone={s.cycle === "monthly" ? "slate" : "violet"}>{tr(CYCLE[s.cycle].en, CYCLE[s.cycle].id)}</Badge>
                                  {s.status !== "active" && (
                                    <Badge tone={STATUS[s.status].tone} className="ml-1">{tr(STATUS[s.status].label.en, STATUS[s.status].label.id)}</Badge>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                                  {s.amount_kind === "payg" && <span className="text-slate-400" title={tr("Pay as you go — an expectation", "Sesuai pemakaian — perkiraan")}>≈ </span>}
                                  {s.currency === "USD" ? usd(s.amount) : formatIDR(s.amount)}
                                  <span className="block text-[10px] text-slate-400">
                                    {s.amount_kind === "payg" ? tr("pay as you go", "sesuai pemakaian") : tr("fixed", "tetap")}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-800">
                                  {formatIDR(s.planned_idr)}
                                  {s.currency === "USD" && (
                                    <span className="block text-[10px] text-slate-400">× {r.usd_idr.toLocaleString("id-ID")}</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">{formatIDRCompact(s.per_year_idr)}</td>
                                <td className="px-4 py-2 text-slate-600">{s.account_code ?? <span className="text-slate-300">—</span>}</td>
                                <td className="px-4 py-2">
                                  {s.next_due && s.status === "active" ? (
                                    <>
                                      <span className="block font-mono text-[12px] text-slate-700">{s.next_due.slice(8)}/{s.next_due.slice(5, 7)}/{s.next_due.slice(0, 4)}</span>
                                      <Badge tone={days! < 0 ? "red" : days! <= 7 ? "amber" : "slate"}>
                                        {days! < 0 ? tr(`${-days!} day(s) late`, `terlambat ${-days!} hari`)
                                          : days === 0 ? tr("today", "hari ini") : tr(`in ${days} day(s)`, `dalam ${days} hari`)}
                                      </Badge>
                                    </>
                                  ) : <span className="text-slate-300">—</span>}
                                  {last && (
                                    <span className="mt-1 block text-[10px] text-slate-400">
                                      {tr("last paid", "terakhir dibayar")} {last.period} · {formatIDRCompact(last.amount_idr)}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  {mayEdit && (
                                    <div className="flex justify-end gap-1">
                                      {s.next_period && s.status === "active" && (
                                        <Button size="sm" variant="outline" icon={CircleDollarSign} className="whitespace-nowrap"
                                          onClick={() => setPaying({ id: s.id, period: s.next_period! })}>
                                          {tr("Record payment", "Catat bayar")}
                                        </Button>
                                      )}
                                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(s)} aria-label={tr("Edit", "Ubah")} />
                                      {s.status === "active" && <Button size="sm" variant="ghost" icon={Pause} onClick={() => setStatus(s, "paused")} aria-label={tr("Pause", "Jeda")} />}
                                      {s.status !== "active" && <Button size="sm" variant="ghost" icon={Play} onClick={() => setStatus(s, "active")} aria-label={tr("Resume", "Aktifkan")} />}
                                      {s.status !== "cancelled" && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setStatus(s, "cancelled")} aria-label={tr("Cancel it", "Hentikan")} />}
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {open === s.id && (
                                <tr className="border-b border-slate-100 bg-slate-50/50">
                                  <td colSpan={8} className="px-4 py-3">
                                    {s.payments.length === 0 ? (
                                      <p className="text-[12px] text-slate-500">{tr("No payment recorded yet.", "Belum ada pembayaran tercatat.")}</p>
                                    ) : (
                                      <table className="w-full max-w-2xl text-[12px]">
                                        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                                          <th className="py-1 pr-3">{tr("Billing", "Tagihan")}</th>
                                          <th className="py-1 pr-3">{tr("Charged", "Ditagih")}</th>
                                          <th className="py-1 pr-3 text-right">USD</th>
                                          <th className="py-1 pr-3 text-right">{tr("Rate", "Kurs")}</th>
                                          <th className="py-1 text-right">{tr("Rupiah", "Rupiah")}</th>
                                          <th />
                                        </tr></thead>
                                        <tbody>
                                          {s.payments.map((p) => (
                                            <tr key={p.id} className="border-t border-slate-100 text-slate-700">
                                              <td className="py-1 pr-3 font-mono">{p.period}</td>
                                              <td className="py-1 pr-3 font-mono">{p.paid_on}</td>
                                              <td className="py-1 pr-3 text-right tabular-nums">{p.amount_usd == null ? "—" : usd(p.amount_usd)}</td>
                                              <td className="py-1 pr-3 text-right tabular-nums">
                                                {p.fx_rate == null ? "—" : Math.round(p.fx_rate).toLocaleString("id-ID")}
                                              </td>
                                              <td className="py-1 text-right tabular-nums">{formatIDR(p.amount_idr)}</td>
                                              <td className="py-1 pl-2 text-right">
                                                {mayEdit && <button type="button" className="text-brand-700 hover:underline"
                                                  onClick={() => setPaying({ id: s.id, period: p.period })}>{tr("edit", "ubah")}</button>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                    {s.note && <p className="mt-2 text-[12px] text-slate-500">{s.note}</p>}
                                  </td>
                                </tr>
                              )}
                            </FragmentRow>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                  {tr("The same rows are on the", "Baris yang sama ada di")}{" "}
                  <Link href="/accounting/calendar" className="font-medium text-brand-700 hover:underline">{tr("payment calendar", "kalender pembayaran")}</Link>
                  {" "}{tr("and in", "dan di")}{" "}
                  <Link href="/accounting/tagihan" className="font-medium text-brand-700 hover:underline">{tr("monthly bills", "tagihan bulanan")}</Link>.
                  {" "}{tr("Accounts come from master data and are only a label — nothing is posted to the ledger.", "Rekening berasal dari master data dan hanya label — tidak ada yang diposting ke ledger.")}
                </p>
              </Card>

              {(adding || editing) && (
                <SubscriptionDrawer
                  sub={editing} usdIdr={r.usd_idr}
                  onClose={() => { setAdding(false); setEditing(null); }}
                  onSaved={() => { setAdding(false); setEditing(null); reload(); }}
                />
              )}
              {paying && (
                <PayModal
                  subscriptionId={paying.id} period={paying.period}
                  onClose={() => setPaying(null)}
                  onSaved={() => { setPaying(null); reload(); }}
                />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** A table body takes rows, not wrappers; a fragment keeps the key on both. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

/** The one rate the plan converts dollars at. Leadership's to change (D233):
 *  the figure is an estimate, and the estimates are theirs. */
function RateTile({ rate, mayRate, onSaved }: { rate: number; mayRate: boolean; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rate);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await accounting.setSubscriptionFx(value);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Rate updated", "Kurs diperbarui"), `USD 1 = Rp ${value.toLocaleString("id-ID")}`);
    setEditing(false);
    onSaved();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card sm:col-span-2 lg:col-span-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Plan rate, USD → IDR", "Kurs rencana, USD → IDR")}</p>
      {editing ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-slate-500">$1 = Rp</span>
          <MoneyInput value={value} onChange={setValue} className="w-40" size="sm" />
          <Button size="sm" icon={Check} onClick={save} disabled={busy || value <= 0}>{tr("Save", "Simpan")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(rate); }} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xl font-bold tabular-nums text-slate-900">Rp {rate.toLocaleString("id-ID")}</p>
          {mayRate && <Button size="sm" variant="outline" icon={Pencil} onClick={() => { setValue(rate); setEditing(true); }}>{tr("Change", "Ubah")}</Button>}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        {mayRate
          ? tr("Every dollar subscription is planned at this rate. Changing it re-plans all of them at once.", "Semua langganan dolar direncanakan dengan kurs ini. Mengubahnya merencanakan ulang semuanya sekaligus.")
          : tr("Set by leadership. Every dollar subscription is planned at this rate.", "Ditetapkan pimpinan. Semua langganan dolar direncanakan dengan kurs ini.")}
      </p>
    </div>
  );
}
