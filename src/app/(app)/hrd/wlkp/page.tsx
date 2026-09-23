"use client";

import { useState } from "react";
import { ClipboardList, Printer, UserPen, TriangleAlert, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  SEX_LABEL, EDUCATION_LABEL, MARITAL_LABEL, AGE_BAND_LABEL, IDENTITY_FIELD_LABEL,
  type Sex, type Education, type Citizenship, type MaritalStatus,
  type EmployeeIdentityView, type IdentityField, type WlkpBucket,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** Wajib Lapor Ketenagakerjaan — the six answers the form needs, and the tables
 *  it is transcribed from (D297).
 *
 *  The screen is built around one admission: **today the report cannot be
 *  filed.** WLKP wants a headcount broken down seven ways and four of those
 *  dimensions had no data behind them anywhere in this system. So the first
 *  thing printed is not a chart, it is *how many people are still missing an
 *  answer, and which answer* — because the job in front of whoever opens this
 *  is collecting six facts from twelve people, not admiring a breakdown.
 *
 *  Two rules hold the tables together and both exist because the opposite would
 *  produce a report that looks finished:
 *
 *  - **Belum diisi is its own row, never folded into the biggest bar.** A
 *    breakdown that quietly counts nine unknowns as *laki-laki* is worse than
 *    one that says nine are unknown: the second can be finished, the first
 *    cannot be found. The counts add to the headcount in every table, and the
 *    database asserts it.
 *  - **The report is for a date, not for today.** Somebody who left in November
 *    was staff on the 31 December before it, and their age then was not their
 *    age now. The date picker is not a convenience; it is what makes a report
 *    about last year correct.
 *
 *  Nothing here is filed automatically and nothing here talks to a government
 *  portal. It prints the numbers a person types into one, which is the honest
 *  boundary: we can be sure of our own figures and we cannot be sure of
 *  somebody else's form.
 */

const DIMENSIONS: { key: keyof WlkpRecapBy; title: string; note?: string }[] = [
  { key: "jenis_kelamin", title: "Jenis kelamin" },
  { key: "kelompok_umur", title: "Kelompok umur", note: "Dihitung pada tanggal laporan, bukan hari ini." },
  { key: "pendidikan", title: "Pendidikan terakhir" },
  { key: "status_hubungan_kerja", title: "Status hubungan kerja", note: "Dari kontrak yang aktif pada tanggal itu. Draft tidak dihitung." },
  { key: "kewarganegaraan", title: "Kewarganegaraan" },
  { key: "disabilitas", title: "Penyandang disabilitas" },
  { key: "status_kawin", title: "Status perkawinan" },
  { key: "jabatan", title: "Jabatan" },
];

type WlkpRecapBy = {
  jenis_kelamin: WlkpBucket[]; kelompok_umur: WlkpBucket[];
  pendidikan: WlkpBucket[]; kewarganegaraan: WlkpBucket[];
  disabilitas: WlkpBucket[]; status_kawin: WlkpBucket[];
  jabatan: WlkpBucket[]; status_hubungan_kerja: WlkpBucket[];
};

/** One place that turns a stored key into a word, so a key nobody has a word
 *  for shows as itself rather than as a blank cell. A job title is free text
 *  and has no map at all — printing it back is right. */
function labelFor(dim: string, key: string): string {
  if (key === "tidak_diketahui") return "Belum diisi";
  if (dim === "jenis_kelamin") return SEX_LABEL[key as Sex] ?? key;
  if (dim === "kelompok_umur") return AGE_BAND_LABEL[key] ?? key;
  if (dim === "pendidikan") return EDUCATION_LABEL[key as Education] ?? key;
  if (dim === "status_kawin") return MARITAL_LABEL[key as MaritalStatus] ?? key;
  if (dim === "disabilitas") return key === "ya" ? "Ya" : key === "tidak" ? "Tidak" : key;
  if (dim === "status_hubungan_kerja") return key === "tanpa_kontrak" ? "Belum ada kontrak" : key;
  return key;
}

export default function WlkpPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [asof, setAsof] = useState("");
  const date = asof || officeToday();

  const [recap, reloadRecap] = useLoad(() => hr.getWlkpRecap({ asof: date }), [date]);
  const [people, reloadPeople] = useLoad(() => hr.listEmployeeIdentities(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mayEdit = can("hrd.update");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Wajib Lapor Ketenagakerjaan"
        description="Rincian jumlah karyawan yang diminta formulir WLKP, dihitung dari data yang benar-benar ada. Yang belum diisi punya barisnya sendiri dan tidak pernah dilipat ke kelompok terbesar — laporan yang tampak lengkap padahal tidak adalah yang paling mahal untuk dibetulkan."
        actions={
          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <label className="text-[12px] text-slate-500">Per tanggal</label>
            <input
              type="date" value={date} onChange={(e) => setAsof(e.target.value)}
              aria-label="Tanggal laporan"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Cetak
            </Button>
            <SourceBadge state={recap} />
          </div>
        }
      />

      <Loaded state={recap} onRetry={reloadRecap}>
        {(r) => {
          if (!r) {
            return (
              <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
                Rekap ini butuh akses HRD atau payroll.
              </p></Card>
            );
          }
          const gaps = Object.entries(r.missing_by_field) as [IdentityField, number][];
          return (
            <>
              {/* The admission, first and largest. */}
              <div
                className={cn(
                  "mb-4 rounded-xl border px-4 py-3 text-[13px]",
                  r.incomplete > 0
                    ? "border-amber-200 bg-amber-50/70 text-amber-900"
                    : "border-emerald-200 bg-emerald-50/70 text-emerald-900",
                )}
              >
                {r.incomplete > 0 ? (
                  <>
                    <p>
                      <TriangleAlert className="mr-1.5 inline h-4 w-4" />
                      <strong>{r.complete} dari {r.headcount} orang datanya lengkap.</strong>{" "}
                      Rincian di bawah sudah benar untuk yang ada, tapi {r.incomplete} orang
                      masih punya kolom kosong — dan di setiap tabel mereka muncul sebagai
                      <em> belum diisi</em>, bukan ikut terhitung ke kelompok mana pun.
                    </p>
                    {gaps.length > 0 && (
                      <p className="mt-1.5">
                        Yang masih ditunggu:{" "}
                        {gaps
                          .sort((a, b) => b[1] - a[1])
                          .map(([f, n]) => `${IDENTITY_FIELD_LABEL[f] ?? f} (${n} orang)`)
                          .join(", ")}.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    <Check className="mr-1.5 inline h-4 w-4" />
                    <strong>Semua {r.headcount} orang datanya lengkap</strong> per{" "}
                    <span className="font-mono">{r.asof}</span>. Angka di bawah bisa disalin
                    ke formulir apa adanya.
                  </p>
                )}
              </div>

              <p className="mb-3 text-[12px] text-slate-500">
                Per <strong className="font-mono">{r.asof}</strong> · {r.headcount} orang
                bekerja pada tanggal itu. Yang keluar sebelum tanggal ini tidak dihitung, dan
                yang masuk sesudahnya juga tidak — jadi laporan tahun lalu tetap benar meski
                orangnya sudah berganti.
              </p>

              <div className="mb-4 grid gap-3 md:grid-cols-2">
                {DIMENSIONS.map((d) => {
                  const rows = r.by[d.key] ?? [];
                  return (
                    <Card key={d.key}>
                      <CardHeader title={d.title} subtitle={d.note} icon={ClipboardList} />
                      <table className="w-full text-[13px]">
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((b) => (
                            <tr key={b.key} className={cn(b.key === "tidak_diketahui" && "bg-amber-50/50")}>
                              <td className="px-5 py-1.5 text-slate-700">
                                {labelFor(d.key, b.key)}
                              </td>
                              <td className="w-16 px-5 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                                {b.count}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                            <td className="px-5 py-1.5 text-[12px] font-medium text-slate-500">Jumlah</td>
                            <td className="px-5 py-1.5 text-right font-bold tabular-nums text-slate-800">
                              {rows.reduce((a, b) => a + b.count, 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </Card>
                  );
                })}
              </div>

              {r.nationalities.length > 0 && (
                <Card className="mb-4">
                  <CardHeader
                    title="Tenaga kerja asing, per negara"
                    subtitle="WLKP menghitung WNA per negara, bukan sebagai satu angka."
                    icon={ClipboardList}
                  />
                  <ul className="divide-y divide-slate-100 text-[13px]">
                    {r.nationalities.map((n) => (
                      <li key={n.country} className="flex justify-between px-5 py-1.5">
                        <span className="text-slate-700">{n.country}</span>
                        <span className="font-semibold tabular-nums">{n.count}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          );
        }}
      </Loaded>

      {/* ── who still owes an answer ──────────────────────────────────────── */}
      <div className="print:hidden">
        <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">Data diri per orang</h2>
        <p className="mb-3 text-[12px] text-slate-500">
          Enam jawaban per orang, dan hanya itu — data ini punya tabelnya sendiri yang
          tidak bisa dibaca oleh akun payroll, tidak seperti data karyawan yang lain.
          Rekap di atas boleh dilihat siapa pun yang sudah bisa melihat daftar karyawan,
          karena isinya angka; daftar di bawah ini tidak, karena isinya orang.
        </p>
        <Loaded state={people} onRetry={reloadPeople}>
          {(rows) => (
            <Card>
              <ul className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <li key={p.employee_no} className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="min-w-[200px] flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          {p.full_name}
                          {!p.active && <span className="ml-2 text-[11px] text-slate-400">sudah keluar</span>}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          <span className="font-mono text-[11px]">{p.employee_no}</span>
                          {p.position && <> · {p.position}</>}
                          {p.age !== null && <> · {p.age} tahun</>}
                          {p.sex && <> · {SEX_LABEL[p.sex]}</>}
                          {p.education && <> · {EDUCATION_LABEL[p.education]}</>}
                          {p.citizenship === "WNA" && <> · WNA {p.nationality}</>}
                        </p>
                        {p.disabled && p.disability_note && (
                          <p className="text-[12px] text-slate-600">{p.disability_note}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {p.missing.length === 0 ? (
                          <Badge tone="green">lengkap</Badge>
                        ) : (
                          p.missing.map((f) => (
                            <Badge key={f} tone="amber">{IDENTITY_FIELD_LABEL[f] ?? f}</Badge>
                          ))
                        )}
                        {mayEdit && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setEditing(editing === p.employee_no ? null : p.employee_no)}
                          >
                            <UserPen className="h-4 w-4" /> Isi
                          </Button>
                        )}
                      </div>
                    </div>
                    {editing === p.employee_no && mayEdit && (
                      <IdentityForm
                        person={p}
                        busy={busy}
                        onCancel={() => setEditing(null)}
                        onSave={async (patch) => {
                          setBusy(true);
                          const res = await hr.saveEmployeeIdentity({
                            employee_no: p.employee_no, ...patch,
                          });
                          setBusy(false);
                          if (res.error) {
                            toast(res.error.status === 403 ? "critical" : "warning",
                              "Tidak tersimpan", res.error.message);
                            return;
                          }
                          toast("success", p.full_name,
                            res.data.missing.length === 0
                              ? "Data diri lengkap"
                              : `Masih kurang: ${res.data.missing
                                  .map((f) => IDENTITY_FIELD_LABEL[f] ?? f).join(", ")}`);
                          setEditing(null);
                          reloadPeople(); reloadRecap();
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Loaded>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400 print:hidden">
        Halaman ini tidak mengirim apa pun ke mana pun. Ia mencetak angka yang diketik
        orang ke portal WLKP — batas yang jujur, karena kami bisa memastikan angka kami
        sendiri dan tidak bisa memastikan formulir orang lain.
      </p>
    </div>
  );
}

/** The six answers, and nothing else on the form.
 *
 *  Every field can be left empty and saved that way: filling this in is a
 *  conversation with twelve people over several days, not one sitting, and a
 *  form that refuses a partial answer is a form that gets skipped. What it will
 *  not accept is an **inconsistent** one — a country for a WNI, a note about a
 *  disability nobody recorded — and those the seam refuses with a sentence.
 */
function IdentityForm({
  person, busy, onSave, onCancel,
}: {
  person: EmployeeIdentityView;
  busy: boolean;
  onSave: (patch: {
    born_on: string | null; sex: Sex | null; education: Education | null;
    citizenship: Citizenship | null; nationality: string | null;
    disabled: boolean | null; disability_note: string | null;
    marital_status: MaritalStatus | null;
  }) => void;
  onCancel: () => void;
}) {
  const [born, setBorn] = useState(person.born_on ?? "");
  const [sex, setSex] = useState<string>(person.sex ?? "");
  const [edu, setEdu] = useState<string>(person.education ?? "");
  const [cit, setCit] = useState<string>(person.citizenship ?? "");
  const [nat, setNat] = useState(person.nationality ?? "");
  /* Three states, not two: "", "true" and "false". A checkbox has only two and
     would turn *nobody has asked* into *the answer is no* the moment the form
     opens, for everybody, silently. */
  const [dis, setDis] = useState<string>(
    person.disabled === null ? "" : person.disabled ? "true" : "false");
  const [note, setNote] = useState(person.disability_note ?? "");
  const [mar, setMar] = useState<string>(person.marital_status ?? "");

  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-slate-600">
          Tanggal lahir
          <input type="date" value={born} onChange={(e) => setBorn(e.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-slate-600">
          Jenis kelamin
          <select value={sex} onChange={(e) => setSex(e.target.value)} className={field}>
            <option value="">— belum diisi —</option>
            {(Object.keys(SEX_LABEL) as Sex[]).map((k) => (
              <option key={k} value={k}>{SEX_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-slate-600">
          Pendidikan terakhir
          <select value={edu} onChange={(e) => setEdu(e.target.value)} className={field}>
            <option value="">— belum diisi —</option>
            {(Object.keys(EDUCATION_LABEL) as Education[]).map((k) => (
              <option key={k} value={k}>{EDUCATION_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-slate-600">
          Kewarganegaraan
          <select
            value={cit}
            onChange={(e) => { setCit(e.target.value); if (e.target.value !== "WNA") setNat(""); }}
            className={field}
          >
            <option value="">— belum diisi —</option>
            <option value="WNI">WNI</option>
            <option value="WNA">WNA</option>
          </select>
        </label>
        <label className="text-[12px] text-slate-600">
          Negara (khusus WNA)
          <input
            value={nat} onChange={(e) => setNat(e.target.value)}
            disabled={cit !== "WNA"} placeholder={cit === "WNA" ? "Timor-Leste" : "—"}
            className={cn(field, cit !== "WNA" && "bg-slate-100 text-slate-400")}
          />
        </label>
        <label className="text-[12px] text-slate-600">
          Status perkawinan
          <select value={mar} onChange={(e) => setMar(e.target.value)} className={field}>
            <option value="">— belum diisi —</option>
            {(Object.keys(MARITAL_LABEL) as MaritalStatus[]).map((k) => (
              <option key={k} value={k}>{MARITAL_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-slate-600">
          Penyandang disabilitas
          <select
            value={dis}
            onChange={(e) => { setDis(e.target.value); if (e.target.value !== "true") setNote(""); }}
            className={field}
          >
            <option value="">— belum ditanyakan —</option>
            <option value="false">Tidak</option>
            <option value="true">Ya</option>
          </select>
          <span className="mt-0.5 block text-[11px] text-slate-400">
            <em>Belum ditanyakan</em> bukan <em>tidak</em>. Yang pertama masih jadi
            pekerjaan; yang kedua sudah jadi jawaban.
          </span>
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2">
          Keterangan
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            disabled={dis !== "true"} placeholder={dis === "true" ? "Jenis dan penyesuaian yang sudah dilakukan" : "—"}
            className={cn(field, dis !== "true" && "bg-slate-100 text-slate-400")}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        <Button
          size="sm" disabled={busy}
          onClick={() => onSave({
            born_on: born || null,
            sex: (sex || null) as Sex | null,
            education: (edu || null) as Education | null,
            citizenship: (cit || null) as Citizenship | null,
            nationality: nat.trim() || null,
            disabled: dis === "" ? null : dis === "true",
            disability_note: note.trim() || null,
            marital_status: (mar || null) as MaritalStatus | null,
          })}
        >
          Simpan
        </Button>
      </div>
    </div>
  );
}
