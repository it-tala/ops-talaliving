"use client";

import { stripRefs } from "@/lib/refs";
import { useState } from "react";
import { Scale, History, Play, AlertTriangle, Clock } from "lucide-react";
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
const OVERTIME_MODE_LABEL: Record<OvertimeMode, string> = {
  statutory: "Bertingkat sesuai ketentuan nasional",
  flat: "Tarif rata",
  form_only: "Hanya yang tertulis di form",
};

const HOURLY_BASIS_LABEL: Record<HourlyBasis, string> = {
  company: "Setahun gaji ÷ hari kerja efektif ÷ jam sehari (hitungan perusahaan)",
  statutory: "Gaji sebulan ÷ 173 (angka peraturan)",
};

const LATE_MODE_LABEL: Record<LateMode, string> = {
  manual: "Dicatat saja — rupiahnya diketik orang",
  pro_rata: "Dipotong per jam terlambat, di luar toleransi",
};

const UNDERTIME_MODE_LABEL: Record<UndertimeMode, string> = {
  off: "Tidak dipotong",
  pro_rata: "Dipotong per jam kurang",
  half_day_step: "Kurang lebih dari setengah hari → potong ½ hari",
};

export default function PayRulesPage() {
  const { can } = useSession();
  const { toast } = useToast();
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
    if (res.error) { toast("warning", "Tidak bisa dihitung", res.error.message); return; }
    setPreview(res.data);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const res = await hr.savePayRules({ effective_from: effective, note, rules: draft });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message);
      return;
    }
    toast("success", `Versi ${res.data.version} tersimpan`, `Berlaku mulai ${res.data.effective_from}`);
    setDraft(null); setPreview(null); setNote("");
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="Payroll"
        title="Aturan penggajian"
        description="Skema upah, lembur dan undertime — angkanya kebijakan, bukan kode. Mengubahnya menulis versi baru mulai tanggal tertentu; versi lama tetap ada supaya slip lama masih bisa dihitung ulang."
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
                  <strong className="font-medium">Lihat saja.</strong> Aturan gaji diubah oleh IT, bukan
                  dari layar ini — bukan karena angkanya tidak Anda kuasai, tapi karena satu aturan di sini
                  mengubah semua slip sekaligus. Kalau ada yang perlu diganti, sampaikan ke IT: perubahan
                  ditulis sebagai versi baru dengan alasannya, dan versi lama tetap bisa dihitung ulang.
                </div>
              )}

              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] shadow-card">
                <Badge tone="brand">v{current.version}</Badge>
                <span className="text-slate-700">
                  Berlaku sejak <span className="font-mono">{current.effective_from}</span> — {stripRefs(current.note)}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">
                  ditulis {current.created_by_name}, {current.created_at.slice(0, 10)}
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                <div className="space-y-4">
                  <Card>
                    <CardHeader
                      title="Situasi 1 & 2 — komposisi upah dan harga satu jam"
                      subtitle="Upah dibaca sebagai pokok + tunjangan. Tarifnya ada di data karyawan, satu per orang; yang diatur di sini adalah cara mengubah upah menjadi harga satu jam, karena lembur dan potongan dihitung dari sana."
                      icon={Scale}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">Harga satu jam dihitung dari</span>
                        <select
                          value={rules.hourly_basis}
                          onChange={(e) => set({ hourly_basis: e.target.value as HourlyBasis })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(HOURLY_BASIS_LABEL) as HourlyBasis[]).map((m) => (
                            <option key={m} value={m}>{HOURLY_BASIS_LABEL[m]}</option>
                          ))}
                        </select>
                      </label>

                      <Field
                        label="Hari kerja efektif setahun"
                        hint={`Angkanya milik perusahaan, bukan hitungan layar ini — IT yang mengisi, HRD dan payroll membacanya. Yang baru di bawah adalah buktinya: kalender perusahaan sendiri, diuraikan, supaya angka ini diperiksa dan bukan diwarisi. Rata-rata per bulan: ${(rules.effective_days_per_year / 12).toFixed(1)} hari, diturunkan dari angka setahun dan tidak pernah disimpan terpisah.`}
                        value={rules.effective_days_per_year}
                        onChange={(v) => set({ effective_days_per_year: v })}
                        disabled={!mayEdit}
                      />

                      <EffectiveDaysNote rules={rules} />

                      <Field
                        label="Pembagi gaji bulanan (peraturan)"
                        hint="173 = 40 jam × 52 minggu ÷ 12. Angka Kepmenaker, dipakai tangga lembur nasional. Tetap disimpan walau bukan dasar yang dipilih, supaya selisihnya kelihatan."
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
                            Tunjangan ikut dihitung ke harga satu jam
                          </span>
                          Sesuai instruksi pemilik: pokok + tunjangan untuk perhitungan semua.
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            Catatan, bukan keputusan: perusahaan mungkin nanti memakai pokok saja untuk
                            lembur dan perhitungan dasar. Kalau itu terjadi, matikan kotak ini — jangan
                            ubah tarif orangnya.
                          </span>
                        </span>
                      </label>

                      <HourlyExample rules={rules} />

                      <p className="text-[12px] text-slate-500">
                        Harian: tarif per hari ÷ jam kerja kontrak orang itu. Per jam: tarifnya memang
                        sudah per jam. Keduanya tidak diatur di sini — itu data orang, bukan kebijakan.
                      </p>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Situasi 3 — lembur"
                      subtitle="Berlaku per malam, bukan per periode: “jam pertama” adalah jam pertama malam itu."
                      icon={Clock}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">Cara menghitung</span>
                        <select
                          value={rules.overtime_mode}
                          onChange={(e) => set({ overtime_mode: e.target.value as OvertimeMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(OVERTIME_MODE_LABEL) as OvertimeMode[]).map((m) => (
                            <option key={m} value={m}>{OVERTIME_MODE_LABEL[m]}</option>
                          ))}
                        </select>
                      </label>

                      {rules.overtime_mode === "statutory" && (
                        <>
                          <Tiers
                            title="Hari kerja biasa"
                            tiers={rules.workday_tiers}
                            onChange={(workday_tiers) => set({ workday_tiers })}
                            disabled={!mayEdit}
                          />
                          <Tiers
                            title="Hari libur & tanggal merah"
                            tiers={rules.restday_tiers}
                            onChange={(restday_tiers) => set({ restday_tiers })}
                            disabled={!mayEdit}
                          />
                          <label className="block">
                            <span className="block text-[12px] text-slate-500">Hari istirahat mingguan</span>
                            <select
                              value={rules.week_pattern}
                              onChange={(e) => set({ week_pattern: e.target.value as "6day" | "5day" })}
                              disabled={!mayEdit}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            >
                              <option value="6day">Enam hari kerja — Minggu saja</option>
                              <option value="5day">Lima hari kerja — Sabtu & Minggu</option>
                            </select>
                          </label>
                        </>
                      )}

                      {rules.overtime_mode === "flat" && (
                        <Field
                          label="Pengali tetap"
                          hint="Satu angka untuk semua jam lembur, hari apa pun. 1 berarti dibayar sama dengan jam biasa."
                          value={rules.flat_multiplier}
                          onChange={(v) => set({ flat_multiplier: v })}
                          disabled={!mayEdit}
                        />
                      )}

                      <Field
                        label="Pembulatan jam lembur (menit)"
                        hint="0 = apa adanya dari mesin absensi. 15 atau 30 kalau perusahaan membulatkan."
                        value={rules.overtime_rounding_minutes}
                        onChange={(v) => set({ overtime_rounding_minutes: v })}
                        disabled={!mayEdit}
                      />

                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        <strong className="text-slate-700">Yang selalu menang:</strong> angka GAJI yang
                        tertulis di form lembur. Kalau kertasnya menyebut nominal, itu yang dibayar —
                        tangga pengali tidak dipakai untuk baris itu.
                      </p>
                      <Example rules={rules} />
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Situasi 4 — undertime & keterlambatan"
                      subtitle="Aturan keterlambatan sekarang ada — toleransi 15 menit, potongan per jam — dan tetap mati sampai seseorang menyalakannya setelah melihat dampaknya per orang. Undertime masih belum pernah ditetapkan nilainya."
                      icon={AlertTriangle}
                    />
                    <div className="space-y-3 px-5 py-3 text-[13px]">
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">Kurang jam (undertime) — hanya untuk upah harian</span>
                        <select
                          value={rules.undertime_mode}
                          onChange={(e) => set({ undertime_mode: e.target.value as UndertimeMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(UNDERTIME_MODE_LABEL) as UndertimeMode[]).map((m) => (
                            <option key={m} value={m}>{UNDERTIME_MODE_LABEL[m]}</option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label="Toleransi kurang jam (menit)"
                        hint="Di bawah ini tidak dihitung kurang. Hari yang ditandai — sakit, cuti, tanggal merah — tidak pernah dihitung undertime."
                        value={rules.undertime_grace_minutes}
                        onChange={(v) => set({ undertime_grace_minutes: v })}
                        disabled={!mayEdit}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Jam masuk perusahaan (menit dari tengah malam)"
                          hint="480 = jam 08.00. Dipakai hanya untuk unit yang tidak punya jadwal kerja sendiri di bawah."
                          value={rules.day_starts_minutes}
                          onChange={(v) => set({ day_starts_minutes: v })}
                          disabled={!mayEdit}
                        />

                        <Field
                          label="Toleransi terlambat (menit)"
                          hint="Pemilik menetapkan 15. Di bawah ini tidak dihitung terlambat sama sekali."
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
                        <p className="mb-1 text-[12px] font-medium text-slate-700">Jadwal kerja</p>
                        <ScheduleEditor rules={rules} disabled={!mayEdit} onChange={set} />
                        <p className="mt-1 text-[11px] text-slate-500">
                          Jadwal yang jam masuknya belum ditetapkan tidak bisa dipakai menilai ketepatan waktu —
                          orang di jadwal itu terbaca <strong>tidak terukur</strong>, bukan tepat waktu. Istirahat
                          dibandingkan dengan tap dan dilaporkan kalau lewat, tidak pernah dipotong.
                        </p>
                      </div>
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                        Dua angka, bukan satu. Sebelumnya keduanya satu kolom bernama
                        <em> terlambat setelah 480 menit</em>, yang sebenarnya berarti
                        <em> terlambat setelah jam 08.00</em> — dan toleransi yang pemilik tetapkan tidak
                        punya tempat untuk ditulis.
                      </p>
                      <label className="block">
                        <span className="block text-[12px] text-slate-500">Potongan keterlambatan</span>
                        <select
                          value={rules.late_mode}
                          onChange={(e) => set({ late_mode: e.target.value as LateMode })}
                          disabled={!mayEdit}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        >
                          {(Object.keys(LATE_MODE_LABEL) as LateMode[]).map((m) => (
                            <option key={m} value={m}>{LATE_MODE_LABEL[m]}</option>
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
                            Terlambat juga menghanguskan tunjangan hari itu
                          </span>
                          Mati, dan pemilik yang mematikannya sendiri: <em>potongannya jam saja,
                          allowance masih diberikan jika hadir</em>. Tunjangan hilang karena keputusan
                          HRD dengan alasannya sendiri — WFH, setengah hari — bukan sebagai hukuman
                          kedua atas kejadian yang sama.
                        </span>
                      </label>
                      <p className="text-[12px] text-slate-500">
                        Aturannya sekarang ada; menyalakannya keputusan terpisah. Selama masih
                        <em> dicatat saja</em>, slip tetap mencetak menitnya <strong>dan</strong> berapa
                        rupiah yang tidak dipotong — supaya keterlambatan tidak terbaca gratis.
                      </p>
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  {mayEdit && draft && (
                    <Card>
                      <CardHeader title="Simpan sebagai versi baru" subtitle="Versi lama tidak diubah." icon={Play} />
                      <div className="space-y-2 px-5 py-3">
                        <label className="block">
                          <span className="block text-[12px] text-slate-500">Berlaku mulai</span>
                          <input
                            type="date" value={effective} onChange={(e) => setEffective(e.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <input
                          value={note} onChange={(e) => setNote(e.target.value)}
                          placeholder="Alasan perubahan — dibaca saat slip lama ditanyakan"
                          className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" icon={Play} disabled={busy} onClick={runPreview}>
                            Lihat dampaknya
                          </Button>
                          <Button size="sm" disabled={busy || !note.trim() || !preview} onClick={save}>
                            {busy ? "Menyimpan…" : "Simpan versi"}
                          </Button>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Tombol simpan terbuka setelah dampaknya dihitung. Aturan gaji yang disimpan
                          tanpa dilihat dampaknya adalah aturan yang dampaknya ditemukan karyawan.
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setPreview(null); }}>
                          Batalkan perubahan
                        </Button>
                      </div>
                    </Card>
                  )}

                  {preview && (
                    <Card>
                      <CardHeader
                        title="Dampak pada periode 31 Agu – 6 Sep"
                        subtitle={`Bruto ${formatIDR(preview.before_total)} → ${formatIDR(preview.after_total)}`}
                        icon={Scale}
                      />
                      {/* Said before saving, not as the refusal afterwards:
                          moving somebody off a pattern is work to do first, and
                          a version that strands people is refused by the seam
                          either way (D291). */}
                      {preview.schedules_lost && (
                        <p className="border-b border-rose-100 bg-rose-50 px-5 py-2.5 text-[12px] text-rose-900">
                          <strong className="font-medium">Ada yang kehilangan jadwalnya.</strong>{" "}
                          Buku ini tidak memuat pola yang masih dipakai: {preview.schedules_lost}. Orangnya
                          tidak pindah ke jadwal lain — mereka berhenti punya jam sama sekali dan hilang
                          dari layar jadwal. Pindahkan dulu, lalu terbitkan versinya.
                        </p>
                      )}
                      <ul className="divide-y divide-slate-100">
                        {preview.lines.length === 0 && (
                          <li className="px-5 py-4 text-[13px] text-slate-500">
                            Tidak ada yang berubah di periode itu.
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
                    <CardHeader title="Riwayat versi" subtitle="Tidak ada yang dihapus." icon={History} />
                    <Paged rows={all} pageSize={8} unit="versi">
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
                                {OVERTIME_MODE_LABEL[r.rules.overtime_mode]} ·{" "}
                                {UNDERTIME_MODE_LABEL[r.rules.undertime_mode].toLowerCase()}
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
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[12px] font-medium text-slate-700">{title}</p>
      <ul className="mt-1 space-y-1">
        {tiers.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span className="w-[92px]">
              {i === 0 ? "Jam ke-1" : `Setelah jam ${formatNumber(t.after_hours)}`}
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
                hapus
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
          + tingkat
        </button>
      )}
    </div>
  );
}

/** A worked example with real money, because a multiplier is an abstraction
 *  until it is rupiah. */
function Example({ rules }: { rules: PayRules }) {
  const hourly = 17_500; // upah harian Rp 140.000 ÷ 8 jam
  const rows: { label: string; hours: number; mult: number }[] = [];
  if (rules.overtime_mode === "flat") {
    rows.push({ label: "3 jam, tarif rata", hours: 3, mult: rules.flat_multiplier });
  } else if (rules.overtime_mode === "statutory") {
    let left = 3;
    const ladder = [...rules.workday_tiers].sort((a, b) => a.after_hours - b.after_hours);
    ladder.forEach((t, i) => {
      const to = i + 1 < ladder.length ? ladder[i + 1].after_hours : Infinity;
      const take = Math.min(left, to - t.after_hours);
      if (take > 0) { rows.push({ label: `${formatNumber(take)} jam`, hours: take, mult: t.multiplier }); left -= take; }
    });
  }
  const total = rows.reduce((s, r) => s + r.hours * r.mult * hourly, 0);

  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600">
      <p className="font-medium text-slate-700">Contoh: 3 jam lembur hari kerja, upah harian Rp 140.000 (8 jam)</p>
      {rules.overtime_mode === "form_only" ? (
        <p className="mt-1">Tidak dibayar kecuali form lembur menuliskan nominalnya.</p>
      ) : (
        <>
          <p className="mt-1">
            Satu jam biasa = {formatIDR(hourly)}.{" "}
            {rows.map((r, i) => (
              <span key={i}>
                {i > 0 ? " + " : ""}{r.label} × {formatNumber(r.mult)}
              </span>
            ))}
          </p>
          <p className="mt-0.5 font-semibold text-slate-800">Dibayar {formatIDR(Math.round(total))}</p>
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

  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-600">
      <p className="font-medium text-slate-700">
        Contoh: staf kantor, pokok {formatIDR(pokok)}/bulan + tunjangan {formatIDR(tunjangan)}/hari,
        {" "}{hoursPerDay} jam sehari
      </p>
      <p className="mt-1">
        <strong className="text-slate-700">Hitungan perusahaan:</strong>{" "}
        ({formatIDR(pokok)} × 12{rules.hourly_includes_allowance && <> + {formatIDR(tunjangan)} × {formatNumber(days)}</>})
        {" "}= {formatIDR(annual)} setahun ÷ {formatNumber(days)} hari ÷ {hoursPerDay} jam ={" "}
        <span className="font-semibold text-slate-800">{formatIDR(company)}</span>
      </p>
      <p className="mt-0.5">
        <strong className="text-slate-700">Hitungan peraturan:</strong>{" "}
        {formatIDR(Math.round(monthly))} sebulan ÷ {formatNumber(rules.monthly_divisor)} ={" "}
        <span className="font-semibold text-slate-800">{formatIDR(statutory)}</span>
      </p>
      <p className="mt-1 text-slate-500">
        Yang dipakai: <strong className="text-slate-700">{formatIDR(chosen)}</strong> per jam
        {gap !== 0 && <> — {Math.abs(gap)}% {gap > 0 ? "lebih tinggi" : "lebih rendah"} dari yang satunya</>}.
        Selisihnya bukan pembulatan: 173 mengandaikan minggu 40 jam, dan hari kerja efektif setahun
        yang dipakai di sini belum tentu sepadan dengan angka itu — kalau keduanya sejalan, kedua
        hitungan akan bertemu.
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
        Kalender {c.year} menghitung {formatNumber(c.working_days)} hari kerja
      </p>
      <p className="mt-1">
        {formatNumber(c.calendar_days)} hari setahun − {formatNumber(c.weekly_rest_days)} hari
        istirahat mingguan (pola {c.days_per_week} hari) − {formatNumber(c.holidays_on_workdays)} tanggal
        merah yang jatuh di hari kerja.
      </p>
      {c.holidays_recorded === 0 ? (
        <p className="mt-1 text-amber-700">
          <strong className="font-medium">Belum ada satu pun tanggal merah {c.year} yang tercatat</strong>,
          jadi hitungan di atas menganggap semua hari kerja dimasuki. Selisih{" "}
          {formatNumber(Math.abs(gap))} hari terhadap angka yang diketik kemungkinan besar adalah
          hari-hari itu — bukan kesalahan hitung, melainkan hari yang belum dimasukkan siapa pun.
        </p>
      ) : (
        <p className="mt-1 text-slate-500">
          {formatNumber(c.holidays_recorded)} tanggal merah tercatat untuk {c.year}
          {c.holidays_recorded > c.holidays_on_workdays && (
            <> — {formatNumber(c.holidays_recorded - c.holidays_on_workdays)} di antaranya jatuh di hari
              yang memang sudah libur dan tidak mengurangi apa pun</>
          )}.
        </p>
      )}
      <p className="mt-1">
        Yang diketik: <strong className="text-slate-700">{formatNumber(rules.effective_days_per_year)}</strong>{" "}
        {gap === 0
          ? "— sama dengan hitungan kalender."
          : `— ${formatNumber(Math.abs(gap))} hari ${gap < 0 ? "lebih sedikit" : "lebih banyak"} dari hitungan kalender.`}
      </p>
    </div>
  );
}
