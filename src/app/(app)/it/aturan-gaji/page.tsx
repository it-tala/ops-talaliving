"use client";

import { stripRefs } from "@/lib/refs";
import { useState } from "react";
import { Scale, History, Play, AlertTriangle, Clock, CalendarDays } from "lucide-react";
import { ScheduleEditor } from "./ScheduleEditor";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { officeToday } from "@/lib/office";
import { NumberInput } from "@/components/ui/number-input";
import { Paged } from "@/components/ui/pager";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { PayRules, UndertimeMode, OvertimeMode, HourlyBasis, LateMode } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr, type Message } from "@/lib/i18n";

/** The pay rule book — the policy, visible and editable (D168).
 *
 *  Four situations exist in this workshop and every one of them is a policy
 *  that changes without the software changing: a day's wage, an hour's wage,
 *  what an overtime hour multiplies by, and what a short day costs. This screen
 *  is the list of them, with the number beside each one and a worked example
 *  underneath, because a rule nobody can read is a rule nobody can check.
 *
 *  Three things it refuses to do:
 *
 *  - **Edit a version.** A change writes the next one, from a date forward. A
 *    payslip already handed to somebody must stay recomputable under the rule
 *    it was computed under (D173).
 *  - **Backdate.** Into an approved run, especially: that would change a figure
 *    somebody signed.
 *  - **Save blind.** Every change is previewed against a real period first —
 *    a multiplier is an abstraction until you see it move one person's wage
 *    (D175).
 */
const OVERTIME_MODE_LABEL: Record<OvertimeMode, Message> = {
  statutory: { en: "Tiered, per national regulation", id: "Bertingkat sesuai ketentuan nasional" },
  flat: { en: "Flat rate", id: "Tarif rata" },
  form_only: { en: "Only what is written on the form", id: "Hanya yang tertulis di form" },
};

const HOURLY_BASIS_LABEL: Record<HourlyBasis, Message> = {
  company: {
    en: "A year's pay ÷ effective working days ÷ hours per day (company calculation)",
    id: "Setahun gaji ÷ hari kerja efektif ÷ jam sehari (hitungan perusahaan)",
  },
  statutory: { en: "Monthly pay ÷ 173 (regulation figure)", id: "Gaji sebulan ÷ 173 (angka peraturan)" },
};

const LATE_MODE_LABEL: Record<LateMode, Message> = {
  manual: { en: "Recorded only — the rupiah amount is typed by a person", id: "Dicatat saja — rupiahnya diketik orang" },
  pro_rata: { en: "Deducted per hour late, beyond the tolerance", id: "Dipotong per jam terlambat, di luar toleransi" },
};

const UNDERTIME_MODE_LABEL: Record<UndertimeMode, Message> = {
  off: { en: "Not deducted", id: "Tidak dipotong" },
  pro_rata: { en: "Deducted per hour short", id: "Dipotong per jam kurang" },
  half_day_step: { en: "Short by more than half a day → deduct ½ day", id: "Kurang lebih dari setengah hari → potong ½ hari" },
};

export default function PayRulesPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [sets, reload] = useLoad(() => hr.listPayRules(), []);
  const [draft, setDraft] = useState<PayRules | null>(null);
  const [effective, setEffective] = useState("2026-10-01");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof hr.previewPayRules>>["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  /* HRD reads, IT changes (owner, D193). Two different rights on one screen:
     the people whose payslips these rules compute are not the people who can
     change them alone. HRD proposes; IT writes the version, with the note. */
  const mayEdit = can("it.update");

  async function runPreview() {
    if (!draft) return;
    setBusy(true);
    const res = await hr.previewPayRules({
      rules: draft, period_start: "2026-08-31", period_end: "2026-09-06",
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Cannot be calculated", "Tidak bisa dihitung"), res.error.message); return; }
    setPreview(res.data);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const res = await hr.savePayRules({ effective_from: effective, note, rules: draft });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`Version ${res.data.version} saved`, `Versi ${res.data.version} tersimpan`),
      tr(`Effective from ${res.data.effective_from}`, `Berlaku mulai ${res.data.effective_from}`),
    );
    setDraft(null); setPreview(null); setNote("");
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Payroll", "Penggajian")}
        title={tr("Pay rules", "Aturan penggajian")}
        description={tr(
          "Wage, overtime and undertime schemes — the figures are policy, not code. Changing them writes a new version from a given date; old versions stay so old payslips can still be recomputed.",
          "Skema upah, lembur dan undertime — angkanya kebijakan, bukan kode. Mengubahnya menulis versi baru mulai tanggal tertentu; versi lama tetap ada supaya slip lama masih bisa dihitung ulang.",
        )}
        actions={<SourceBadge state={sets} />}
      />

      <Loaded state={sets} onRetry={reload}>
        {(all) => {
          const current = all.find((r) => r.is_current) ?? all[0];
          const rules = draft ?? current.rules;
          const set = (patch: Partial<PayRules>) => { setDraft({ ...rules, ...patch }); setPreview(null); };

          return (
            <>
              {!mayEdit && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                  <strong className="font-medium">{tr("View only.", "Lihat saja.")}</strong>{" "}
                  {tr(
                    "Pay rules are changed by IT, not from this screen — not because the figures are beyond you, but because one rule here changes every payslip at once. If something needs changing, tell IT: the change is written as a new version with its reason, and old versions can still be recomputed.",
                    "Aturan gaji diubah oleh IT, bukan dari layar ini — bukan karena angkanya tidak Anda kuasai, tapi karena satu aturan di sini mengubah semua slip sekaligus. Kalau ada yang perlu diganti, sampaikan ke IT: perubahan ditulis sebagai versi baru dengan alasannya, dan versi lama tetap bisa dihitung ulang.",
                  )}
                </div>
              )}

              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] shadow-card">
                <Badge tone="brand">v{current.version}</Badge>
                <span className="text-slate-700">
                  {tr("In force since", "Berlaku sejak")} <span className="font-mono">{current.effective_from}</span> — {stripRefs(current.note)}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {tr("written by", "ditulis")} {current.created_by_name}, {current.created_at.slice(0, 10)}
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader
                      title={tr("Situations 1 & 2 — wage make-up and the price of an hour", "Situasi 1 & 2 — komposisi upah dan harga satu jam")}
                      subtitle={tr(
                        "The wage is read as base + allowance. The rates live in the employee data, one per person; what is set here is how a wage becomes the price of an hour, because overtime and deductions are computed from it.",
                        "Upah dibaca sebagai pokok + tunjangan. Tarifnya ada di data karyawan, satu per orang; yang diatur di sini adalah cara mengubah upah menjadi harga satu jam, karena lembur dan potongan dihitung dari sana.",
                      )}
                      icon={Scale}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">{tr("The price of an hour is computed from", "Harga satu jam dihitung dari")}</span>
                        <select
                          value={rules.hourly_basis}
                          onChange={(e) => set({ hourly_basis: e.target.value as HourlyBasis })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(HOURLY_BASIS_LABEL) as HourlyBasis[]).map((m) => (
                            <option key={m} value={m}>{tr(HOURLY_BASIS_LABEL[m].en, HOURLY_BASIS_LABEL[m].id)}</option>
                          ))}
                        </select>
                      </label>

                      <Field
                        label={tr("Effective working days per year", "Hari kerja efektif setahun")}
                        hint={tr(
                          `The figure belongs to the company, not to this screen's arithmetic — IT fills it in, HRD and payroll read it. What is new below is the evidence: the company's own calendar, spelled out, so this figure is checked rather than inherited. Monthly average: ${(rules.effective_days_per_year / 12).toFixed(1)} days, derived from the yearly figure and never stored separately.`,
                          `Angkanya milik perusahaan, bukan hitungan layar ini — IT yang mengisi, HRD dan payroll membacanya. Yang baru di bawah adalah buktinya: kalender perusahaan sendiri, diuraikan, supaya angka ini diperiksa dan bukan diwarisi. Rata-rata per bulan: ${(rules.effective_days_per_year / 12).toFixed(1)} hari, diturunkan dari angka setahun dan tidak pernah disimpan terpisah.`,
                        )}
                        value={rules.effective_days_per_year}
                        onChange={(v) => set({ effective_days_per_year: v })}
                        disabled={!mayEdit}
                      />

                      <EffectiveDaysNote rules={rules} />

                      <Field
                        label={tr("Monthly pay divisor (regulation)", "Pembagi gaji bulanan (peraturan)")}
                        hint={tr(
                          "173 = 40 hours × 52 weeks ÷ 12. The Kepmenaker figure, used by the national overtime ladder. Kept even when it is not the chosen basis, so the difference stays visible.",
                          "173 = 40 jam × 52 minggu ÷ 12. Angka Kepmenaker, dipakai tangga lembur nasional. Tetap disimpan walau bukan dasar yang dipilih, supaya selisihnya kelihatan.",
                        )}
                        value={rules.monthly_divisor}
                        onChange={(v) => set({ monthly_divisor: v })}
                        disabled={!mayEdit}
                      />

                      <label className="flex items-start gap-2 text-[12px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={rules.hourly_includes_allowance}
                          onChange={(e) => set({ hourly_includes_allowance: e.target.checked })}
                          disabled={!mayEdit}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium text-slate-700">
                            {tr("Allowance counts toward the price of an hour", "Tunjangan ikut dihitung ke harga satu jam")}
                          </span>
                          {tr(
                            "Per the owner's instruction: base + allowance for every calculation.",
                            "Sesuai instruksi pemilik: pokok + tunjangan untuk perhitungan semua.",
                          )}
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {tr(
                              "A note, not a decision: the company may later use base only for overtime and basic calculations. If that happens, untick this box — do not change people's rates.",
                              "Catatan, bukan keputusan: perusahaan mungkin nanti memakai pokok saja untuk lembur dan perhitungan dasar. Kalau itu terjadi, matikan kotak ini — jangan ubah tarif orangnya.",
                            )}
                          </span>
                        </span>
                      </label>

                      <HourlyExample rules={rules} />

                      <p className="text-[12px] text-slate-500">
                        {tr(
                          "Daily: the day rate ÷ that person's contract hours. Hourly: the rate is already per hour. Neither is set here — that is the person's data, not policy.",
                          "Harian: tarif per hari ÷ jam kerja kontrak orang itu. Per jam: tarifnya memang sudah per jam. Keduanya tidak diatur di sini — itu data orang, bukan kebijakan.",
                        )}
                      </p>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title={tr("Situation 3 — overtime", "Situasi 3 — lembur")}
                      subtitle={tr("Applies per evening, not per period: “the first hour” is the first hour of that evening.", "Berlaku per malam, bukan per periode: “jam pertama” adalah jam pertama malam itu.")}
                      icon={Clock}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">{tr("Calculation method", "Cara menghitung")}</span>
                        <select
                          value={rules.overtime_mode}
                          onChange={(e) => set({ overtime_mode: e.target.value as OvertimeMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(OVERTIME_MODE_LABEL) as OvertimeMode[]).map((m) => (
                            <option key={m} value={m}>{tr(OVERTIME_MODE_LABEL[m].en, OVERTIME_MODE_LABEL[m].id)}</option>
                          ))}
                        </select>
                      </label>

                      {rules.overtime_mode === "statutory" && (
                        <>
                          <Tiers
                            title={tr("Normal working day", "Hari kerja biasa")}
                            tiers={rules.workday_tiers}
                            onChange={(workday_tiers) => set({ workday_tiers })}
                            disabled={!mayEdit}
                          />
                          <Tiers
                            title={tr("Rest days & public holidays", "Hari libur & tanggal merah")}
                            tiers={rules.restday_tiers}
                            onChange={(restday_tiers) => set({ restday_tiers })}
                            disabled={!mayEdit}
                          />
                          <label className="block">
                            <span className="block text-[12px] text-slate-500">{tr("Weekly rest days", "Hari istirahat mingguan")}</span>
                            <select
                              value={rules.week_pattern}
                              onChange={(e) => set({ week_pattern: e.target.value as "6day" | "5day" })}
                              disabled={!mayEdit}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            >
                              <option value="6day">{tr("Six working days — Sunday only", "Enam hari kerja — Minggu saja")}</option>
                              <option value="5day">{tr("Five working days — Saturday & Sunday", "Lima hari kerja — Sabtu & Minggu")}</option>
                            </select>
                          </label>
                        </>
                      )}

                      {rules.overtime_mode === "flat" && (
                        <Field
                          label={tr("Fixed multiplier", "Pengali tetap")}
                          hint={tr("One figure for every overtime hour, any day. 1 means paid the same as a normal hour.", "Satu angka untuk semua jam lembur, hari apa pun. 1 berarti dibayar sama dengan jam biasa.")}
                          value={rules.flat_multiplier}
                          onChange={(v) => set({ flat_multiplier: v })}
                          disabled={!mayEdit}
                        />
                      )}

                      <Field
                        label={tr("Overtime rounding (minutes)", "Pembulatan jam lembur (menit)")}
                        hint={tr("0 = as-is from the attendance machine. 15 or 30 if the company rounds.", "0 = apa adanya dari mesin absensi. 15 atau 30 kalau perusahaan membulatkan.")}
                        value={rules.overtime_rounding_minutes}
                        onChange={(v) => set({ overtime_rounding_minutes: v })}
                        disabled={!mayEdit}
                      />

                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        <strong className="text-slate-700">{tr("What always wins:", "Yang selalu menang:")}</strong>{" "}
                        {tr(
                          "the GAJI figure written on the overtime form. If the paper states an amount, that is what is paid — the multiplier ladder is not used for that row.",
                          "angka GAJI yang tertulis di form lembur. Kalau kertasnya menyebut nominal, itu yang dibayar — tangga pengali tidak dipakai untuk baris itu.",
                        )}
                      </p>
                      <Example rules={rules} />
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title={tr("Situation 4 — undertime & lateness", "Situasi 4 — undertime & keterlambatan")}
                      subtitle={tr(
                        "A lateness rule now exists — 15 minutes tolerance, deduction per hour — and stays off until someone turns it on after seeing its effect per person. Undertime has still never had its value set.",
                        "Aturan keterlambatan sekarang ada — toleransi 15 menit, potongan per jam — dan tetap mati sampai seseorang menyalakannya setelah melihat dampaknya per orang. Undertime masih belum pernah ditetapkan nilainya.",
                      )}
                      icon={AlertTriangle}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">{tr("Hours short (undertime) — daily wages only", "Kurang jam (undertime) — hanya untuk upah harian")}</span>
                        <select
                          value={rules.undertime_mode}
                          onChange={(e) => set({ undertime_mode: e.target.value as UndertimeMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(UNDERTIME_MODE_LABEL) as UndertimeMode[]).map((m) => (
                            <option key={m} value={m}>{tr(UNDERTIME_MODE_LABEL[m].en, UNDERTIME_MODE_LABEL[m].id)}</option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label={tr("Undertime tolerance (minutes)", "Toleransi kurang jam (menit)")}
                        hint={tr(
                          "Below this is not counted as short. Marked days — sick, leave, public holidays — are never counted as undertime.",
                          "Di bawah ini tidak dihitung kurang. Hari yang ditandai — sakit, cuti, tanggal merah — tidak pernah dihitung undertime.",
                        )}
                        value={rules.undertime_grace_minutes}
                        onChange={(v) => set({ undertime_grace_minutes: v })}
                        disabled={!mayEdit}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label={tr("Company start time (minutes from midnight)", "Jam masuk perusahaan (menit dari tengah malam)")}
                          hint={tr("480 = 08.00. Used only for units without their own work schedule below.", "480 = jam 08.00. Dipakai hanya untuk unit yang tidak punya jadwal kerja sendiri di bawah.")}
                          value={rules.day_starts_minutes}
                          onChange={(v) => set({ day_starts_minutes: v })}
                          disabled={!mayEdit}
                        />

                        <Field
                          label={tr("Lateness tolerance (minutes)", "Toleransi terlambat (menit)")}
                          hint={tr("The owner set 15. Below this is not counted as late at all.", "Pemilik menetapkan 15. Di bawah ini tidak dihitung terlambat sama sekali.")}
                          value={rules.late_grace_minutes}
                          onChange={(v) => set({ late_grace_minutes: v })}
                          disabled={!mayEdit}
                        />
                      </div>

                      {/* Patterns, not a start time per unit (Q44, D274) — and
                          editable since D291, because the office's Friday was
                          wrong for a day while the fix waited on a deploy. What
                          a schedule does not say stays blank and named as
                          unstated: a number invented here becomes a lateness
                          figure that looks measured. */}
                      <div>
                        <p className="mb-1 text-[12px] font-medium text-slate-700">{tr("Work schedules", "Jadwal kerja")}</p>
                        <ScheduleEditor rules={rules} disabled={!mayEdit} onChange={set} />
                        <p className="mt-1 text-[11px] text-slate-500">
                          {tr(
                            "A schedule with no start time set cannot be used to judge punctuality — people on it read as",
                            "Jadwal yang jam masuknya belum ditetapkan tidak bisa dipakai menilai ketepatan waktu — orang di jadwal itu terbaca",
                          )}{" "}
                          <strong>{tr("not measured", "tidak terukur")}</strong>
                          {tr(
                            ", not on time. Breaks are compared with taps and reported when exceeded, never deducted.",
                            ", bukan tepat waktu. Istirahat dibandingkan dengan tap dan dilaporkan kalau lewat, tidak pernah dipotong.",
                          )}
                        </p>
                      </div>
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        {tr("Two figures, not one. Before, both were one column called", "Dua angka, bukan satu. Sebelumnya keduanya satu kolom bernama")}
                        <em> {tr("late after 480 minutes", "terlambat setelah 480 menit")}</em>
                        {tr(", which really meant", ", yang sebenarnya berarti")}
                        <em> {tr("late after 08.00", "terlambat setelah jam 08.00")}</em>{" "}
                        {tr(
                          "— and the tolerance the owner set had nowhere to be written.",
                          "— dan toleransi yang pemilik tetapkan tidak punya tempat untuk ditulis.",
                        )}
                      </p>
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">{tr("Lateness deduction", "Potongan keterlambatan")}</span>
                        <select
                          value={rules.late_mode}
                          onChange={(e) => set({ late_mode: e.target.value as LateMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(LATE_MODE_LABEL) as LateMode[]).map((m) => (
                            <option key={m} value={m}>{tr(LATE_MODE_LABEL[m].en, LATE_MODE_LABEL[m].id)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-start gap-2 text-[12px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={rules.late_forfeits_allowance}
                          onChange={(e) => set({ late_forfeits_allowance: e.target.checked })}
                          disabled={!mayEdit}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium text-slate-700">
                            {tr("Lateness also forfeits that day's allowance", "Terlambat juga menghanguskan tunjangan hari itu")}
                          </span>
                          {tr("Off, and the owner turned it off personally:", "Mati, dan pemilik yang mematikannya sendiri:")}{" "}
                          <em>{tr(
                            "deduct the hours only, the allowance is still given if present",
                            "potongannya jam saja, allowance masih diberikan jika hadir",
                          )}</em>.{" "}
                          {tr(
                            "An allowance is lost by an HRD decision with its own reason — WFH, half a day — not as a second penalty for the same event.",
                            "Tunjangan hilang karena keputusan HRD dengan alasannya sendiri — WFH, setengah hari — bukan sebagai hukuman kedua atas kejadian yang sama.",
                          )}
                        </span>
                      </label>
                      <p className="text-[12px] text-slate-500">
                        {tr(
                          "The rule now exists; turning it on is a separate decision. While it is still",
                          "Aturannya sekarang ada; menyalakannya keputusan terpisah. Selama masih",
                        )}
                        <em> {tr("recorded only", "dicatat saja")}</em>
                        {tr(", the payslip still prints the minutes", ", slip tetap mencetak menitnya")}{" "}
                        <strong>{tr("and", "dan")}</strong>{" "}
                        {tr(
                          "how many rupiah were not deducted — so lateness does not read as free.",
                          "berapa rupiah yang tidak dipotong — supaya keterlambatan tidak terbaca gratis.",
                        )}
                      </p>
                    </div>
                  </Card>

                  {/* D340 — how a day is read and what it is worth. Every key
                      here is optional in the book; unset reads as before. */}
                  <Card>
                    <CardHeader
                      title={tr("Situation 5 — reading attendance, and days worth more", "Situasi 5 — cara membaca absensi, dan hari yang bernilai lebih")}
                      subtitle={tr(
                        "What a Saturday, Sunday or public holiday is worth is set per weekday on each work schedule (HRD → Work schedules → Per day). A pattern that works Monday–Saturday has Sunday ×2; production, Monday–Friday, has Saturday and Sunday ×2.",
                        "Nilai Sabtu, Minggu atau tanggal merah diatur per hari di tiap jadwal kerja (HRD → Jadwal kerja → Per hari). Pola yang bekerja Senin–Sabtu punya Minggu ×2; produksi, Senin–Jumat, punya Sabtu dan Minggu ×2.",
                      )}
                      icon={CalendarDays}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">{tr("How a day is read", "Cara membaca satu hari")}</span>
                        <select
                          value={rules.day_reading ?? "slots"}
                          onChange={(e) => set({ day_reading: e.target.value as "slots" | "schedule" })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          <option value="slots">{tr("Six taps in slots — a day the rule cannot fit waits for HRD", "Enam tap per slot — hari yang tidak cocok menunggu HRD")}</option>
                          <option value="schedule">{tr("By the schedule — any tap is a day present, hours against that weekday's schedule", "Sesuai jadwal — ada tap berarti hadir, jam dibaca terhadap jadwal hari itu")}</option>
                        </select>
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label={tr("Round hours to (minutes)", "Bulatkan jam ke (menit)")}
                          hint={tr("15 = quarter hours, as the payroll sheet does.", "15 = seperempat jam, seperti payroll sheet.")}
                          value={rules.hours_rounding_minutes ?? 15}
                          onChange={(v) => set({ hours_rounding_minutes: v })}
                          disabled={!mayEdit}
                        />
                        <Field
                          label={tr("Clock-out window (minutes)", "Jendela tap pulang (menit)")}
                          hint={tr("A tap this close to the scheduled end is pulang; none means the scheduled end.", "Tap sedekat ini dengan jam pulang dianggap pulang; tidak ada berarti jam pulang jadwal.")}
                          value={rules.out_window_minutes ?? 30}
                          onChange={(v) => set({ out_window_minutes: v })}
                          disabled={!mayEdit}
                        />
                        <Field
                          label={tr("Public holiday worked — × a day's pay", "Tanggal merah masuk — × upah sehari")}
                          hint={tr("0 = the old rule: the hours become overtime. The owner: 2.", "0 = aturan lama: jamnya jadi lembur. Pemilik: 2.")}
                          value={rules.holiday_pay_multiplier ?? 0}
                          onChange={(v) => set({ holiday_pay_multiplier: v > 0 ? v : null })}
                          disabled={!mayEdit}
                        />
                        <label className="block">
                          <span className="block text-[12px] text-slate-500">{tr("Weekly pay period starts on", "Minggu gaji mulai hari")}</span>
                          <select
                            value={rules.pay_week_starts_isodow ?? 1}
                            onChange={(e) => set({ pay_week_starts_isodow: Number(e.target.value) })}
                            disabled={!mayEdit}
                            className="mt-1 h-9 w-full max-w-[180px] rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          >
                            {["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"].map((d, i) => (
                              <option key={d} value={i + 1}>{d}</option>
                            ))}
                          </select>
                        </label>
                        <Field
                          label={tr("Overtime after (minutes from midnight)", "Lembur lewat jam (menit dari tengah malam)")}
                          hint={tr("1320 = 22.00. 0 = no separate rate.", "1320 = jam 22.00. 0 = tanpa tarif terpisah.")}
                          value={rules.overtime_night_after_minutes ?? 0}
                          onChange={(v) => set({ overtime_night_after_minutes: v > 0 ? v : null })}
                          disabled={!mayEdit}
                        />
                        <Field
                          label={tr("…paid at ×", "…dibayar ×")}
                          hint={tr("The sheet: 2.", "Sheet: 2.")}
                          value={rules.overtime_night_multiplier ?? 0}
                          onChange={(v) => set({ overtime_night_multiplier: v > 0 ? v : null })}
                          disabled={!mayEdit}
                        />
                      </div>
                      {([
                        ["allowance_on_premium_days", true,
                          tr("A day paid above ×1 also earns the allowance", "Hari yang dibayar di atas ×1 juga dapat tunjangan"),
                          tr("Off in the sheet: insentif and tunjangan are paid Monday–Friday only.", "Mati di sheet: insentif dan tunjangan hanya Senin–Jumat.")],
                        ["allowance_by_day_value", false,
                          tr("A half day earns half the allowance", "Setengah hari dapat setengah tunjangan"),
                          tr("On in the sheet (insentif × days).", "Nyala di sheet (insentif × hari).")],
                        ["overtime_exact_hourly", false,
                          tr("Price overtime on the exact hourly rate, rounded once at the end", "Hitung lembur dari tarif per jam yang tidak dibulatkan dulu"),
                          tr("170.500 / 8 = 21.312,5 — as the sheet does.", "170.500 / 8 = 21.312,5 — seperti sheet.")],
                      ] as [keyof PayRules, boolean, string, string][]).map(([key, dflt, label, hint]) => (
                        <label key={key} className="flex items-start gap-2 text-[12px] text-slate-600">
                          <input
                            type="checkbox"
                            checked={(rules[key] as boolean | undefined) ?? dflt}
                            onChange={(e) => set({ [key]: e.target.checked } as Partial<PayRules>)}
                            disabled={!mayEdit}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium text-slate-700">{label}</span>
                            {hint}
                          </span>
                        </label>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  {mayEdit && draft && (
                    <Card>
                      <CardHeader title={tr("Save as a new version", "Simpan sebagai versi baru")} subtitle={tr("Old versions are not changed.", "Versi lama tidak diubah.")} icon={Play} />
                      <div className="space-y-2 px-5 py-3">
                        <label className="block">
                          <span className="block text-[12px] text-slate-500">{tr("Effective from", "Berlaku mulai")}</span>
                          <input
                            type="date" value={effective} onChange={(e) => setEffective(e.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <input
                          value={note} onChange={(e) => setNote(e.target.value)}
                          placeholder={tr("Reason for the change — read when an old payslip is questioned", "Alasan perubahan — dibaca saat slip lama ditanyakan")}
                          className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" icon={Play} disabled={busy} onClick={runPreview}>
                            {tr("See the effect", "Lihat dampaknya")}
                          </Button>
                          <Button size="sm" disabled={busy || !note.trim() || !preview} onClick={save}>
                            {busy ? tr("Saving…", "Menyimpan…") : tr("Save version", "Simpan versi")}
                          </Button>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {tr(
                            "The save button opens once the effect has been computed. A pay rule saved without seeing its effect is a rule whose effect employees discover.",
                            "Tombol simpan terbuka setelah dampaknya dihitung. Aturan gaji yang disimpan tanpa dilihat dampaknya adalah aturan yang dampaknya ditemukan karyawan.",
                          )}
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setPreview(null); }}>
                          {tr("Discard changes", "Batalkan perubahan")}
                        </Button>
                      </div>
                    </Card>
                  )}

                  {preview && (
                    <Card>
                      <CardHeader
                        title={tr("Effect on the period 31 Aug – 6 Sep", "Dampak pada periode 31 Agu – 6 Sep")}
                        subtitle={tr(`Gross ${formatIDR(preview.before_total)} → ${formatIDR(preview.after_total)}`, `Bruto ${formatIDR(preview.before_total)} → ${formatIDR(preview.after_total)}`)}
                        icon={Scale}
                      />
                      {/* Said before saving, not as the refusal afterwards:
                          moving somebody off a pattern is work to do first, and
                          a version that strands people is refused by the seam
                          either way (D291). */}
                      {preview.schedules_lost && (
                        <p className="border-b border-rose-100 bg-rose-50 px-5 py-2.5 text-[12px] text-rose-900">
                          <strong className="font-medium">{tr("Someone loses their schedule.", "Ada yang kehilangan jadwalnya.")}</strong>{" "}
                          {tr("This book leaves out a pattern still in use:", "Buku ini tidak memuat pola yang masih dipakai:")} {preview.schedules_lost}.{" "}
                          {tr(
                            "Those people do not move to another schedule — they stop having hours at all and disappear from the schedule screen. Move them first, then publish the version.",
                            "Orangnya tidak pindah ke jadwal lain — mereka berhenti punya jam sama sekali dan hilang dari layar jadwal. Pindahkan dulu, lalu terbitkan versinya.",
                          )}
                        </p>
                      )}
                      <ul className="divide-y divide-slate-100">
                        {preview.lines.length === 0 && (
                          <li className="px-5 py-4 text-[13px] text-slate-500">
                            {tr("Nothing changes in that period.", "Tidak ada yang berubah di periode itu.")}
                          </li>
                        )}
                        {preview.lines.map((l) => (
                          <li key={l.employee_no} className="px-5 py-2 text-[12px]">
                            <span className="font-medium text-slate-800">{l.full_name}</span>
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{l.employee_no}</span>
                            <span className="block text-slate-600">
                              {formatIDR(l.before)} → <span className={cn(
                                "font-semibold",
                                l.after > l.before ? "text-emerald-700" : "text-rose-700",
                              )}>{formatIDR(l.after)}</span>
                              <span className="ml-2 text-slate-400">{stripRefs(l.note)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  <Card>
                    <CardHeader title={tr("Version history", "Riwayat versi")} subtitle={tr("Nothing is deleted.", "Tidak ada yang dihapus.")} icon={History} />
                    <Paged rows={all} pageSize={8} unit={tr("versions", "versi")}>
                      {(page) => (
                        <ul className="divide-y divide-slate-100">
                          {page.map((r) => (
                            <li key={r.id} className="px-5 py-2.5 text-[12px]">
                              <span className="flex flex-wrap items-center gap-2">
                                <Badge tone={r.is_current ? "green" : "slate"}>v{r.version}</Badge>
                                <span className="font-mono text-[11px] text-slate-500">{r.effective_from}</span>
                                <span className="text-slate-400">{r.created_by_name}</span>
                              </span>
                              <span className="mt-0.5 block text-slate-600">{stripRefs(r.note)}</span>
                              <span className="mt-0.5 block text-[11px] text-slate-400">
                                {tr(OVERTIME_MODE_LABEL[r.rules.overtime_mode].en, OVERTIME_MODE_LABEL[r.rules.overtime_mode].id)} ·{" "}
                                {tr(UNDERTIME_MODE_LABEL[r.rules.undertime_mode].en, UNDERTIME_MODE_LABEL[r.rules.undertime_mode].id).toLowerCase()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Paged>
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Field({
  label, hint, value, onChange, disabled,
}: {
  label: string; hint: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] text-slate-500">{label}</span>
      <div className="mt-1 max-w-[180px]">
        <NumberInput value={value} onChange={onChange} disabled={disabled} />
      </div>
      <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>
    </label>
  );
}

/** The ladder, as rows. Adding a step is adding a row — which is what makes
 *  this configuration rather than a shape baked into the code. */
function Tiers({
  title, tiers, onChange, disabled,
}: {
  title: string;
  tiers: { after_hours: number; multiplier: number }[];
  onChange: (t: { after_hours: number; multiplier: number }[]) => void;
  disabled?: boolean;
}) {
  const tr = useTr();
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[12px] font-medium text-slate-700">{title}</p>
      <ul className="mt-1 space-y-1">
        {tiers.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span className="w-[92px]">
              {i === 0 ? tr("Hour 1", "Jam ke-1") : tr(`After hour ${formatNumber(t.after_hours)}`, `Setelah jam ${formatNumber(t.after_hours)}`)}
            </span>
            <div className="w-[92px]">
              <NumberInput
                value={t.multiplier} disabled={disabled}
                onChange={(v) => onChange(tiers.map((x, j) => (j === i ? { ...x, multiplier: v } : x)))}
              />
            </div>
            <span>×</span>
            {!disabled && tiers.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(tiers.filter((_, j) => j !== i))}
                className="text-[11px] text-slate-400 underline hover:text-rose-600"
              >
                {tr("remove", "hapus")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...tiers, {
            after_hours: (tiers[tiers.length - 1]?.after_hours ?? 0) + 1,
            multiplier: (tiers[tiers.length - 1]?.multiplier ?? 1) + 0.5,
          }])}
          className="mt-1 text-[11px] text-brand-700 underline"
        >
          {tr("+ tier", "+ tingkat")}
        </button>
      )}
    </div>
  );
}

/** A worked example with real money, because a multiplier is an abstraction
 *  until it is rupiah. */
function Example({ rules }: { rules: PayRules }) {
  const tr = useTr();
  const hourly = 17_500; // upah harian Rp 140.000 ÷ 8 jam
  const rows: { label: string; hours: number; mult: number }[] = [];
  if (rules.overtime_mode === "flat") {
    rows.push({ label: tr("3 hours, flat rate", "3 jam, tarif rata"), hours: 3, mult: rules.flat_multiplier });
  } else if (rules.overtime_mode === "statutory") {
    let left = 3;
    const ladder = [...rules.workday_tiers].sort((a, b) => a.after_hours - b.after_hours);
    ladder.forEach((t, i) => {
      const to = i + 1 < ladder.length ? ladder[i + 1].after_hours : Infinity;
      const take = Math.min(left, to - t.after_hours);
      if (take > 0) { rows.push({ label: tr(`${formatNumber(take)} hours`, `${formatNumber(take)} jam`), hours: take, mult: t.multiplier }); left -= take; }
    });
  }
  const total = rows.reduce((s, r) => s + r.hours * r.mult * hourly, 0);

  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600">
      <p className="font-medium text-slate-700">{tr("Example: 3 hours of workday overtime, daily wage Rp 140.000 (8 hours)", "Contoh: 3 jam lembur hari kerja, upah harian Rp 140.000 (8 jam)")}</p>
      {rules.overtime_mode === "form_only" ? (
        <p className="mt-1">{tr("Not paid unless the overtime form states the amount.", "Tidak dibayar kecuali form lembur menuliskan nominalnya.")}</p>
      ) : (
        <>
          <p className="mt-1">
            {tr("One normal hour", "Satu jam biasa")} = {formatIDR(hourly)}.{" "}
            {rows.map((r, i) => (
              <span key={i}>
                {i > 0 ? " + " : ""}{r.label} × {formatNumber(r.mult)}
              </span>
            ))}
          </p>
          <p className="mt-0.5 font-semibold text-slate-800">{tr("Paid", "Dibayar")} {formatIDR(Math.round(total))}</p>
        </>
      )}
    </div>
  );
}

/** The divisor, as arithmetic on one real salary.
 *
 *  The owner's question was *dari mana pembagian 173 itu?* — so the screen that
 *  holds the answer shows both sums rather than naming the winner. They differ
 *  by about a tenth on this office's own numbers, which is the whole reason
 *  the question was worth asking.
 */
function HourlyExample({ rules }: { rules: PayRules }) {
  /* Putri, accounting: pokok Rp 6.900.000 + tunjangan Rp 25.000/hari. */
  const pokok = 6_900_000;
  const tunjangan = 25_000;
  const hoursPerDay = 8;
  const days = Math.max(rules.effective_days_per_year, 1);
  const allowance = rules.hourly_includes_allowance ? tunjangan : 0;

  const annual = pokok * 12 + allowance * days;
  const company = Math.round(annual / days / hoursPerDay);
  const monthly = pokok + (allowance * days) / 12;
  const statutory = Math.round(monthly / Math.max(rules.monthly_divisor, 1));
  const chosen = rules.hourly_basis === "statutory" ? statutory : company;
  const other = rules.hourly_basis === "statutory" ? company : statutory;
  const gap = other === 0 ? 0 : Math.round(((chosen - other) / other) * 100);
  const tr = useTr();

  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600">
      <p className="font-medium text-slate-700">
        {tr(
          `Example: office staff, base ${formatIDR(pokok)}/month + allowance ${formatIDR(tunjangan)}/day, ${hoursPerDay} hours a day`,
          `Contoh: staf kantor, pokok ${formatIDR(pokok)}/bulan + tunjangan ${formatIDR(tunjangan)}/hari, ${hoursPerDay} jam sehari`,
        )}
      </p>
      <p className="mt-1">
        <strong className="text-slate-700">{tr("Company calculation:", "Hitungan perusahaan:")}</strong>{" "}
        ({formatIDR(pokok)} × 12{rules.hourly_includes_allowance && <> + {formatIDR(tunjangan)} × {formatNumber(days)}</>})
        {" "}= {formatIDR(annual)} {tr("a year", "setahun")} ÷ {formatNumber(days)} {tr("days", "hari")} ÷ {hoursPerDay} {tr("hours", "jam")} ={" "}
        <span className="font-semibold text-slate-800">{formatIDR(company)}</span>
      </p>
      <p className="mt-0.5">
        <strong className="text-slate-700">{tr("Regulation calculation:", "Hitungan peraturan:")}</strong>{" "}
        {formatIDR(Math.round(monthly))} {tr("a month", "sebulan")} ÷ {formatNumber(rules.monthly_divisor)} ={" "}
        <span className="font-semibold text-slate-800">{formatIDR(statutory)}</span>
      </p>
      <p className="mt-1 text-slate-500">
        {tr("In use:", "Yang dipakai:")} <strong className="text-slate-700">{formatIDR(chosen)}</strong> {tr("per hour", "per jam")}
        {gap !== 0 && <> — {gap > 0
          ? tr(`${Math.abs(gap)}% higher than the other`, `${Math.abs(gap)}% lebih tinggi dari yang satunya`)
          : tr(`${Math.abs(gap)}% lower than the other`, `${Math.abs(gap)}% lebih rendah dari yang satunya`)}</>}.{" "}
        {tr(
          "The difference is not rounding: 173 assumes a 40-hour week, and the effective working days per year used here do not necessarily match it — if the two agreed, both calculations would meet.",
          "Selisihnya bukan pembulatan: 173 mengandaikan minggu 40 jam, dan hari kerja efektif setahun yang dipakai di sini belum tentu sepadan dengan angka itu — kalau keduanya sejalan, kedua hitungan akan bertemu.",
        )}
      </p>
    </div>
  );
}

/** What the calendar counts, beside the figure IT types (Q45, D292).
 *
 *  D271 settled who types `hari kerja efektif` and that the monthly average is
 *  derived from it. It never settled the number — and the number divides a
 *  year's wage into an hourly rate, so twenty days of error moves every
 *  overtime rupiah by eight per cent. 288 reached production as a demo default
 *  (F138) and 240 replaced it as a better convention; both were nobody's
 *  decision.
 *
 *  This does not replace the field. It prints the arithmetic the business's own
 *  calendar already supports, so the typed figure becomes something checked
 *  rather than inherited — and it prints **what the calendar does not know**,
 *  because a year with no tanggal merah entered counts every weekday as worked.
 *  A gap of nineteen days is not an error in the count; it is nineteen days
 *  nobody has written down, and saying so is the only way it gets fixed.
 *
 *  Loaded on the pattern, not on the typed figure: counting a year of days on
 *  every keystroke would be rude, and the difference is arithmetic the browser
 *  can do against the number already on screen.
 */
function EffectiveDaysNote({ rules }: { rules: PayRules }) {
  const { session } = useSession();
  const tr = useTr();
  const year = Number(officeToday().slice(0, 4));
  /* The acting user is in the deps, and it has to be: the seam answers **null**
     to somebody without `payroll.read` or `it.update`, so this is a read whose
     answer depends on who is asking. Keyed on the rules alone it cached the
     first answer for ever — in demo mode, where the acting user changes from
     the header, that is a permission-shaped figure going stale on screen. It
     would have shown up in production too, on the first person promoted while
     the tab was open. */
  const [cal] = useLoad(
    () => hr.effectiveDaysCalendar({ rules, year }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules.week_pattern, year, session?.user.id],
  );

  if (cal.status !== "ready" || !cal.data) return null;
  const c = cal.data;
  const gap = rules.effective_days_per_year - c.working_days;

  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600">
      <p className="font-medium text-slate-700">
        {tr(
          `The ${c.year} calendar counts ${formatNumber(c.working_days)} working days`,
          `Kalender ${c.year} menghitung ${formatNumber(c.working_days)} hari kerja`,
        )}
      </p>
      <p className="mt-1">
        {tr(
          `${formatNumber(c.calendar_days)} days a year − ${formatNumber(c.weekly_rest_days)} weekly rest days (${c.days_per_week}-day pattern) − ${formatNumber(c.holidays_on_workdays)} public holidays falling on working days.`,
          `${formatNumber(c.calendar_days)} hari setahun − ${formatNumber(c.weekly_rest_days)} hari istirahat mingguan (pola ${c.days_per_week} hari) − ${formatNumber(c.holidays_on_workdays)} tanggal merah yang jatuh di hari kerja.`,
        )}
      </p>
      {c.holidays_recorded === 0 ? (
        <p className="mt-1 text-amber-700">
          <strong className="font-medium">{tr(
            `Not a single ${c.year} public holiday has been recorded yet`,
            `Belum ada satu pun tanggal merah ${c.year} yang tercatat`,
          )}</strong>
          {tr(
            `, so the count above assumes every working day is worked. The ${formatNumber(Math.abs(gap))}-day difference from the typed figure is most likely those days — not a counting error, but days nobody has entered yet.`,
            `, jadi hitungan di atas menganggap semua hari kerja dimasuki. Selisih ${formatNumber(Math.abs(gap))} hari terhadap angka yang diketik kemungkinan besar adalah hari-hari itu — bukan kesalahan hitung, melainkan hari yang belum dimasukkan siapa pun.`,
          )}
        </p>
      ) : (
        <p className="mt-1 text-slate-500">
          {tr(
            `${formatNumber(c.holidays_recorded)} public holidays recorded for ${c.year}`,
            `${formatNumber(c.holidays_recorded)} tanggal merah tercatat untuk ${c.year}`,
          )}
          {c.holidays_recorded > c.holidays_on_workdays && (
            <> — {tr(
              `${formatNumber(c.holidays_recorded - c.holidays_on_workdays)} of them fall on days that are already off and reduce nothing`,
              `${formatNumber(c.holidays_recorded - c.holidays_on_workdays)} di antaranya jatuh di hari yang memang sudah libur dan tidak mengurangi apa pun`,
            )}</>
          )}.
        </p>
      )}
      <p className="mt-1">
        {tr("Typed:", "Yang diketik:")} <strong className="text-slate-700">{formatNumber(rules.effective_days_per_year)}</strong>{" "}
        {gap === 0
          ? tr("— the same as the calendar count.", "— sama dengan hitungan kalender.")
          : gap < 0
            ? tr(`— ${formatNumber(Math.abs(gap))} days fewer than the calendar count.`, `— ${formatNumber(Math.abs(gap))} hari lebih sedikit dari hitungan kalender.`)
            : tr(`— ${formatNumber(Math.abs(gap))} days more than the calendar count.`, `— ${formatNumber(Math.abs(gap))} hari lebih banyak dari hitungan kalender.`)}
      </p>
    </div>
  );
}
