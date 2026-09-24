"use client";

import { useState } from "react";
import { ShieldCheck, AlertTriangle, UserPlus, UserMinus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  SCHEME_LABEL, COMPUTED_SCHEMES,
  type ContributionScheme,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** The register of who is enrolled in what — HRD's, and accounting's to audit
 *  (owner, D259).
 *
 *  Q30 asked *which statutory deductions apply and at what rate*. The owner's
 *  answer replaced the question with a better one: the rates are public and the
 *  **roll of names is not**, and the leak he described is an invoice that keeps
 *  charging for people who came off the roll. So this screen is the roll, and
 *  the arithmetic beside it is deliberately the simplest thing that can be
 *  checked by hand: names × rate.
 *
 *  Two things it refuses to pretend about. A scheme with **no rate** for the
 *  month shows no figure rather than an invoice of nil — null is not zero. And
 *  **PPh 21 is an enrolment, never a figure**: it is progressive over tables
 *  nobody has given us, so the register records who has an NPWP and the
 *  calculation stays unbuilt (D140).
 */
function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ContributionsPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [month, setMonth] = useState(() => officeToday().slice(0, 7));
  const [rolls, reload] = useLoad(() => hr.listContributionRolls(month), [month]);
  const [enrolments, reloadEnrolments] = useLoad(() => hr.listEnrolments(), []);
  const [employees] = useLoad(() => hr.listEmployees(), []);
  const [rates] = useLoad(() => hr.listContributionRates(), []);
  const [open, setOpen] = useState<ContributionScheme | null>(null);
  const [busy, setBusy] = useState(false);

  /* The add form. */
  const [who, setWho] = useState("");
  const [scheme, setScheme] = useState<ContributionScheme>("BPJS_KESEHATAN");
  const [memberNo, setMemberNo] = useState("");
  const [from, setFrom] = useState(officeToday());
  const [declared, setDeclared] = useState(0);
  const [note, setNote] = useState("");
  const mayEdit = can("hrd.create");

  async function add() {
    setBusy(true);
    const res = await hr.enrol({
      employee_no: who, scheme, member_no: memberNo || null,
      enrolled_on: from, declared_base: declared > 0 ? declared : null,
      note: note || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak terdaftar", res.error.message);
      return;
    }
    toast("success", "Terdaftar", `${who} · ${SCHEME_LABEL[scheme]}`);
    setMemberNo(""); setNote(""); setDeclared(0);
    reload(); reloadEnrolments();
  }

  async function end(id: string, name: string) {
    const why = window.prompt(`Kenapa ${name} berhenti? Kalimat ini yang dibaca akunting kalau tagihan bulan depan masih memuat namanya.`);
    if (!why?.trim()) return;
    setBusy(true);
    const res = await hr.endEnrolment({ id, ended_on: officeToday(), reason: why });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak berubah", res.error.message); return; }
    toast("success", "Dihentikan", why);
    reload(); reloadEnrolments();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Iuran wajib — siapa terdaftar"
        description="Tarifnya publik; daftar namanya tidak. Layar ini daftar namanya, dan hitungannya sengaja sesederhana yang bisa dicek tangan: nama × tarif. Akunting memakai angka yang sama untuk memeriksa tagihan bulanan."
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setMonth(shift(month, -1))}>‹</Button>
            <span className="font-mono text-[13px] text-slate-600">{month}</span>
            <Button size="sm" variant="outline" onClick={() => setMonth(shift(month, 1))}>›</Button>
            <SourceBadge state={rolls} />
          </div>
        }
      />

      <Loaded state={rolls} onRetry={reload}>
        {(all) => {
          const employerTotal = all.reduce((a, r) => a + r.employer_total, 0);
          const employeeTotal = all.reduce((a, r) => a + r.employee_total, 0);
          const noRate = all.filter((r) => r.rate === null);
          const unconfirmed = rates.status === "ready"
            ? rates.data.filter((r) => !r.confirmed)
            : [];

          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Ditanggung perusahaan" value={formatIDR(employerTotal)} note="biaya, bukan potongan" />
                <Tile label="Dipotong dari pekerja" value={formatIDR(employeeTotal)} note="muncul di slip gaji" />
                <Tile label="Total tagihan bulan ini" value={formatIDR(employerTotal + employeeTotal)}
                  note="inilah yang harus dicocokkan akunting" />
                <Tile
                  label="Belum terdaftar sama sekali"
                  value={employees.status === "ready"
                    ? String(employees.data.filter((e) => e.active
                      && !all.some((r) => r.lines.some((l) => l.employee_id === e.id))).length)
                    : "—"}
                  note="dari karyawan aktif"
                  tone="amber"
                />
              </div>

              {unconfirmed.length > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{unconfirmed.length} tarif belum dikonfirmasi:</strong>{" "}
                    {unconfirmed.map((r) => SCHEME_LABEL[r.scheme as ContributionScheme]).join(", ")}.
                    Angkanya dipakai untuk menghitung, tapi belum ada yang memastikannya — tarif yang
                    belum dicek tidak boleh terlihat sama dengan yang sudah. IT yang mengubahnya.
                    Untuk JKK, pemilik sudah memutuskan kelas risikonya tidak perlu dikejar:
                    yang dipakai memeriksa adalah <strong>tagihan bulanan dibanding daftar nama</strong>
                    di bawah, bukan ketepatan persentasenya.
                  </span>
                </p>
              )}
              {noRate.length > 0 && (
                <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
                  {noRate.map((r) => SCHEME_LABEL[r.scheme]).join(", ")} belum punya tarif yang berlaku
                  bulan ini, jadi tidak ada angka yang ditampilkan. <strong>Bukan nol</strong> — belum diketahui.
                </p>
              )}

              {all.map((roll) => (
                <Card key={roll.scheme} className="mb-4">
                  <CardHeader
                    title={`${SCHEME_LABEL[roll.scheme]} — ${roll.headcount} orang`}
                    subtitle={roll.rate
                      ? `${roll.rate.employer_percent}% perusahaan + ${roll.rate.employee_percent}% pekerja${
                        roll.rate.wage_ceiling ? ` · batas upah ${formatIDR(roll.rate.wage_ceiling)}` : ""}`
                      : "Belum ada tarif yang berlaku bulan ini."}
                    icon={ShieldCheck}
                    action={
                      <div className="flex items-center gap-2">
                        {roll.rate && !roll.rate.confirmed && <Badge tone="amber">tarif belum dikonfirmasi</Badge>}
                        <span className="font-semibold tabular-nums text-slate-800">
                          {roll.rate ? formatIDR(roll.expected_total) : "—"}
                        </span>
                        <Button size="sm" variant="ghost"
                          onClick={() => setOpen(open === roll.scheme ? null : roll.scheme)}>
                          {open === roll.scheme ? "Tutup" : "Nama"}
                        </Button>
                      </div>
                    }
                  />
                  {(roll.joined.length > 0 || roll.left.length > 0 || roll.last_month_total != null) && (
                    <p className="px-5 pb-2 text-[12px] text-slate-600">
                      {roll.last_month_total != null && (
                        <>Bulan lalu {formatIDR(roll.last_month_total)}. </>
                      )}
                      {roll.joined.length > 0 && <>Masuk: {roll.joined.join(", ")}. </>}
                      {roll.left.length > 0 && (
                        <span className="text-amber-800">Keluar: {roll.left.join(", ")}. </span>
                      )}
                    </p>
                  )}
                  {open === roll.scheme && (
                    <div className="overflow-x-auto border-t border-slate-100">
                      <table className="w-full min-w-[760px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2 text-left">Nama</th>
                            <th className="px-4 py-2 text-left">No. kartu</th>
                            <th className="px-4 py-2 text-right">Dasar upah</th>
                            <th className="px-4 py-2 text-right">Perusahaan</th>
                            <th className="px-4 py-2 text-right">Pekerja</th>
                            <th className="px-4 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roll.lines.map((l) => (
                            <tr key={l.employee_id} className="border-b border-slate-100">
                              <td className="px-4 py-2">
                                <span className="block text-slate-800">{l.full_name}</span>
                                <span className="block font-mono text-[10px] text-slate-400">{l.employee_no}</span>
                                {l.partial_month && (
                                  <span className="block text-[11px] text-amber-700">{l.partial_month}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                                {l.member_no_masked ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {formatIDR(l.base)}
                                <span className="block text-[10px] text-slate-400">
                                  {l.base_source === "declared" ? "upah didaftarkan" : "dari data gaji"}
                                </span>
                                {l.capped_from != null && (
                                  <span className="block text-[10px] text-amber-700">
                                    dibatasi dari {formatIDR(l.capped_from)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatIDR(l.employer)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatIDR(l.employee)}</td>
                              <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">{formatIDR(l.total)}</td>
                            </tr>
                          ))}
                          {roll.lines.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-[13px] text-slate-500">
                              Belum ada nama di skema ini.
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}

              <Card className="mb-4">
                <CardHeader
                  title="PPh 21"
                  subtitle="Tercatat sebagai pendaftaran. Tidak dihitung di sini, dan tidak akan."
                  icon={AlertTriangle}
                />
                <p className="px-5 py-3 text-[13px] text-slate-600">
                  Siapa punya NPWP dan status PTKP-nya dicatat di register bawah. Perhitungannya
                  <strong> bukan pekerjaan sistem ini</strong> — itu keputusan pemilik, bukan pekerjaan
                  yang tertunda. PPh 21 progresif memakai tabel TER yang berubah, dan yang
                  melaporkan SPT-lah yang memegangnya. Potongan yang salah lebih buruk daripada potongan
                  yang tidak ada — yang tidak ada kelihatan di slip, yang salah ditemukan karyawan yang
                  uangnya kurang.
                </p>
              </Card>

              <Loaded state={enrolments} onRetry={reloadEnrolments}>
                {(rows) => (
                  <Card>
                    <CardHeader
                      title={`Register — ${rows.length} pendaftaran`}
                      subtitle="Yang sudah berhenti tetap ada, dengan tanggal dan alasannya: “bulan Juli dia ditanggung atau tidak” adalah pertanyaan yang register ini ada untuk menjawabnya."
                      icon={ShieldCheck}
                    />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2 text-left">Nama</th>
                            <th className="px-4 py-2 text-left">Skema</th>
                            <th className="px-4 py-2 text-left">No. kartu</th>
                            <th className="px-4 py-2 text-left">Sejak</th>
                            <th className="px-4 py-2 text-left">Status</th>
                            {mayEdit && <th className="px-4 py-2" />}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className={cn("border-b border-slate-100", r.ended_on && "opacity-60")}>
                              <td className="px-4 py-2 text-slate-800">{r.full_name}</td>
                              <td className="px-4 py-2 text-slate-600">{SCHEME_LABEL[r.scheme]}</td>
                              <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{r.member_no_masked ?? "—"}</td>
                              <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                                {r.enrolled_on}
                                {r.declared_base != null && (
                                  <span className="block text-[10px] text-amber-700">
                                    didaftarkan atas {formatIDR(r.declared_base)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-[12px]">
                                {r.ended_on ? (
                                  <span className="text-slate-500">
                                    Berhenti {r.ended_on}
                                    <span className="block text-[11px] text-slate-400">{r.ended_reason}</span>
                                  </span>
                                ) : <Badge tone="green">aktif</Badge>}
                                {r.note && <span className="block text-[11px] text-slate-400">{r.note}</span>}
                              </td>
                              {mayEdit && (
                                <td className="px-4 py-2 text-right">
                                  {!r.ended_on && (
                                    <Button size="sm" variant="outline" icon={UserMinus} disabled={busy}
                                      onClick={() => end(r.id, r.full_name)}>
                                      Hentikan
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {mayEdit && (
                      <div className="border-t border-slate-100 px-5 py-3">
                        <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                          <UserPlus className="h-4 w-4 text-slate-400" /> Daftarkan orang
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="text-[11px] text-slate-500">
                            Karyawan
                            <Loaded state={employees} skeletonRows={1}>
                              {(emps) => (
                                <select
                                  value={who} onChange={(e) => setWho(e.target.value)}
                                  className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                                >
                                  <option value="">Pilih…</option>
                                  {emps.filter((e) => e.active).map((e) => (
                                    <option key={e.id} value={e.employee_no}>{e.full_name} · {e.employee_no}</option>
                                  ))}
                                </select>
                              )}
                            </Loaded>
                          </label>
                          <label className="text-[11px] text-slate-500">
                            Skema
                            <select
                              value={scheme} onChange={(e) => setScheme(e.target.value as ContributionScheme)}
                              className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            >
                              {[...COMPUTED_SCHEMES, "PPH21" as ContributionScheme].map((s) => (
                                <option key={s} value={s}>{SCHEME_LABEL[s]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] text-slate-500">
                            Nomor kartu / NPWP
                            <input
                              value={memberNo} onChange={(e) => setMemberNo(e.target.value)}
                              className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                          </label>
                          <label className="text-[11px] text-slate-500">
                            Terdaftar sejak
                            <input
                              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                              className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                          </label>
                          <label className="text-[11px] text-slate-500">
                            Upah yang didaftarkan <span className="text-slate-400">(kosongkan = pakai data gaji)</span>
                            <div className="mt-0.5"><MoneyInput value={declared} onChange={setDeclared} /></div>
                          </label>
                          <label className="text-[11px] text-slate-500 sm:col-span-2">
                            Catatan
                            <input
                              value={note} onChange={(e) => setNote(e.target.value)}
                              placeholder="Mis. didaftarkan atas upah di bawah gaji sebenarnya"
                              className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                          </label>
                          <div className="flex items-end">
                            <Button size="sm" disabled={busy || !who} onClick={add}>Daftarkan</Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </Loaded>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Tile({ label, value, note, tone = "slate" }: {
  label: string; value: string; note?: string; tone?: "slate" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums",
        tone === "amber" ? "text-amber-700" : "text-slate-900")}>{value}</p>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}
