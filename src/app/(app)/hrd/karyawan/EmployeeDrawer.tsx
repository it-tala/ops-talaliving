"use client";

import { useState } from "react";
import { Save, UserMinus, UserCheck } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { officeToday } from "@/lib/office";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import type { Employee, EmployeeAccount, PayBasis } from "@/services/hr/contracts";
import { contactProblem, leaveFrom } from "@/services/hr/employee-rules";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Somebody's name, and what their time costs.
 *
 *  Changing a rate is the most consequential edit in the system after posting
 *  to the ledger, so the audit row carries the figure before and after: *when
 *  did his rate go up, and who said so* is the question a payroll dispute
 *  turns on, and it is never asked on the day it happens.
 */
export function EmployeeDrawer({
  employee, account = null, onClose, onSaved,
}: {
  employee: Employee | null;
  /** The account this person signs in with, read-only: IT links it (D329). */
  account?: EmployeeAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [no, setNo] = useState(employee?.employee_no ?? "");
  const [name, setName] = useState(employee?.full_name ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [unit, setUnit] = useState(employee?.unit ?? "Workshop");
  const [basis, setBasis] = useState<PayBasis>(employee?.pay_basis ?? "daily");
  const [rate, setRate] = useState(employee?.base_rate ?? 0);
  const [allowance, setAllowance] = useState(employee?.allowance_rate ?? 0);
  const [hours, setHours] = useState(employee?.daily_hours ?? 8);
  /* Nought for a new person: paid leave is HRD's to write after a year of
     service (D349). */
  const [leave, setLeave] = useState(employee?.paid_leave_days ?? 0);
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [schedule, setSchedule] = useState(employee?.schedule_code ?? "");
  /* The day they started, not the day they were typed in. Everybody entered at
     go-live would otherwise have joined that morning (F154). Blank on a new
     person means today, which is what the seam does with no date. */
  const [joined, setJoined] = useState(employee?.joined_on ?? "");
  const [busy, setBusy] = useState(false);
  /* Leaving is a date and a sentence (D337); coming back is a sentence. Both
     live under the form, apart from Save, because neither is a change of
     terms. */
  const [leaving, setLeaving] = useState(false);
  const [leftOn, setLeftOn] = useState(officeToday());
  const [why, setWhy] = useState("");

  const [sched] = useLoad(() => hr.listSchedules(), []);
  const schedules = sched.status === "ready" ? sched.data.schedules : [];
  /* What this person's unit falls back to, named rather than implied: *ikut
     bawaan unit* is only a usable option if the screen says what that is. */
  const unitDefault = sched.status === "ready"
    ? schedules.find((sc) => sc.units.includes(unit)) ?? null
    : null;

  const today = officeToday();
  /* When leave may be written: a year after the start date as it will be
     saved (blank on a new person is today). The seam refuses it earlier, with
     the same date; the field says so first. */
  const leaveOpensOn = leaveFrom(joined || (employee ? null : today));
  const leaveOpen = leaveOpensOn !== null && leaveOpensOn <= today;
  const contact = contactProblem(email, phone);

  const changed = employee && rate !== employee.base_rate;
  /* Somebody already on the books with no salary written yet (six monthly
     people in production) can still have everything else saved: the rate is
     then left as it is rather than sent as nought. A new person needs one,
     and a salary that is there cannot be wiped to nought (the seam's rule). */
  const rateUnset = !!employee && employee.base_rate <= 0;
  const rateMissing = rate <= 0 && !rateUnset;
  /* A disabled button is a refusal too, and says why (F214). */
  const blockers = [
    !no.trim() && tr("the number on the machine", "nomor di mesin"),
    !name.trim() && tr("the full name", "nama lengkap"),
    rateMissing && (basis === "monthly" ? tr("the salary", "gajinya") : tr("the rate", "tarifnya")),
    contact && contact.message,
  ].filter(Boolean) as string[];
  const allowanceChanged = employee && allowance !== employee.allowance_rate;

  async function save() {
    setBusy(true);
    const res = await hr.saveEmployee({
      employee_no: no, full_name: name, position, unit,
      pay_basis: basis, ...(rate > 0 ? { base_rate: rate } : {}), allowance_rate: allowance,
      daily_hours: hours, paid_leave_days: leave,
      ...(joined ? { joined_on: joined } : {}),
      /* Sent as typed; blank clears it on an existing person (D349). */
      email, phone,
      /* Empty means *follow the unit*, which is a real answer here and not an
         omission — so it is sent as an explicit null rather than left out
         (absent means unchanged on this endpoint). */
      schedule_code: schedule || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", employee ? tr("Updated", "Diperbarui") : tr("Added", "Ditambahkan"), `${name} · ${formatIDR(rate)} ${basis === "monthly" ? tr("per month", "per bulan") : basis === "daily" ? tr("per day", "per hari") : tr("per hour", "per jam")}`);
    onSaved();
  }

  async function offboard() {
    if (!employee) return;
    setBusy(true);
    const res = await hr.offboardEmployee({ employee_no: employee.employee_no, left_on: leftOn, reason: why });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not offboarded", "Tidak dikeluarkan"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`${employee.full_name} has left`, `${employee.full_name} dikeluarkan`),
      res.data.taps_after > 0
        ? tr(
          `As of ${leftOn}. ${res.data.taps_after} tap(s) after that date stay on file — check the date if that is wrong.`,
          `Per ${leftOn}. ${res.data.taps_after} tap setelah tanggal itu tetap tersimpan — periksa tanggalnya kalau itu keliru.`,
        )
        : tr(`As of ${leftOn}. Every record stays.`, `Per ${leftOn}. Semua catatannya tetap disimpan.`),
    );
    onSaved();
  }

  async function reinstate() {
    if (!employee) return;
    setBusy(true);
    const res = await hr.reinstateEmployee({ employee_no: employee.employee_no, reason: why });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not reinstated", "Tidak diaktifkan"), res.error.message);
      return;
    }
    toast("success", tr(`${employee.full_name} is active again`, `${employee.full_name} aktif kembali`), why.trim());
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={employee ? employee.full_name : tr("New employee", "Karyawan baru")}
      subtitle={employee
        ? tr(`${employee.employee_no} · joined ${employee.joined_on}`, `${employee.employee_no} · masuk ${employee.joined_on}`)
        : tr("The number has to match the fingerprint machine.", "Nomornya harus sama dengan mesin sidik jari.")}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {blockers.length > 0 && (
            <p className="mr-auto text-[12px] text-amber-700">
              {tr("To save, fill in: ", "Untuk menyimpan, isi dulu: ")}{blockers.join(" · ")}
            </p>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || blockers.length > 0}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {employee && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12px]">
            <p className="text-xs text-slate-500">{tr("Sign-in account", "Akun masuk")}</p>
            {account?.user_email ? (
              <p className="mt-0.5 break-all text-slate-800">
                {account.user_email}
                {account.user_is_active === false && <span className="text-slate-500"> — {tr("switched off", "nonaktif")}</span>}
              </p>
            ) : (
              <p className="mt-0.5 text-slate-500">{tr("None yet.", "Belum ada.")}</p>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              {tr("IT makes accounts and links them, on IT → Users & access.", "IT yang membuat dan menautkan akun, di IT → Pengguna & akses.")}
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="e-no" className="block text-xs text-slate-500">{tr("Number on the machine", "Nomor di mesin")}</label>
            <input
              id="e-no" value={no} onChange={(e) => setNo(e.target.value)}
              disabled={!!employee}
              placeholder="T-034"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            />
            {employee && <p className="mt-1 text-[11px] text-slate-500">{tr("Fixed — attendance is filed against it.", "Tetap — absensi dicatat atas nomor ini.")}</p>}
          </div>
          <div>
            <label htmlFor="e-name" className="block text-xs text-slate-500">{tr("Full name", "Nama lengkap")}</label>
            <input
              id="e-name" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="e-pos" className="block text-xs text-slate-500">{tr("Position", "Jabatan")}</label>
            <input
              id="e-pos" value={position} onChange={(e) => setPosition(e.target.value)}
              placeholder={tr("Carpenter", "Tukang Kayu")}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="e-unit" className="block text-xs text-slate-500">{tr("Unit", "Unit")}</label>
            <input
              id="e-unit" value={unit} onChange={(e) => setUnit(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          {/* How to reach them (D349). Both optional: most of the floor has
              no email. Not the sign-in account — IT links that. */}
          <div>
            <label htmlFor="e-email" className="block text-xs text-slate-500">{tr("Email", "Email")}</label>
            <input
              id="e-email" type="email" inputMode="email" autoComplete="off"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@contoh.com"
              className={"mt-1 h-9 w-full rounded-lg border px-2 text-sm focus:outline-none "
                + (contact?.field === "email" ? "border-amber-400 focus:border-amber-500" : "border-slate-200 focus:border-brand-400")}
            />
            {contact?.field === "email" && <p className="mt-1 text-[11px] text-amber-700">{contact.message}</p>}
          </div>
          <div>
            <label htmlFor="e-phone" className="block text-xs text-slate-500">{tr("Mobile number", "Nomor HP")}</label>
            <input
              id="e-phone" type="tel" inputMode="tel" autoComplete="off"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="0812 3456 7890"
              className={"mt-1 h-9 w-full rounded-lg border px-2 text-sm focus:outline-none "
                + (contact?.field === "phone" ? "border-amber-400 focus:border-amber-500" : "border-slate-200 focus:border-brand-400")}
            />
            {contact?.field === "phone" && <p className="mt-1 text-[11px] text-amber-700">{contact.message}</p>}
          </div>
        </div>

        {/* Which working pattern this person is on (Q53, D281).
            
            The unit's default **is** the decision — the owner ruled that after
            M58 offered to confirm 39 of them one by one — so the first option
            says what that default is rather than reading as *unset*. Choosing
            a named pattern here overrides it for this person, which is what
            the guard on a twelve-hour shift and the house assistant need: a
            fact about them, not about their unit. */}
        <div>
          <label htmlFor="e-sched" className="block text-xs text-slate-500">{tr("Work schedule", "Jadwal kerja")}</label>
          <select
            id="e-sched" value={schedule} onChange={(e) => setSchedule(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            <option value="">
              {tr("Follow unit default", "Ikut bawaan unit")}{unitDefault ? ` — ${unitDefault.name}` : tr(" (the unit has no default yet)", " (unitnya belum punya bawaan)")}
            </option>
            {schedules.map((sc) => (
              <option key={sc.code} value={sc.code}>
                {sc.name}
                {sc.hours.weekly_hours != null ? tr(` · ${sc.hours.weekly_hours} h/week`, ` · ${sc.hours.weekly_hours} jam/minggu`) : tr(" · hours not set yet", " · jam belum ditetapkan")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {schedule
              ? tr("Assigned to this person. Moving units does not change it.", "Dipasang ke orang ini. Pindah unit tidak mengubahnya.")
              : unitDefault
                ? tr("Follows the unit. Move units and the hours move too.", "Mengikuti unitnya. Pindah unit, jamnya ikut pindah.")
                : tr(
                  "This unit has no default schedule yet, so there are no hours to judge punctuality against.",
                  "Unit ini belum punya jadwal bawaan, jadi tidak ada jam yang bisa dipakai menilai ketepatan waktunya.",
                )}
          </p>
        </div>

        <div>
          <span className="block text-xs text-slate-500">{tr("How they are paid", "Cara dibayar")}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {([["monthly", tr("Monthly salary", "Gaji bulanan")], ["daily", tr("Per day", "Per hari")], ["hourly", tr("Per hour", "Per jam")]] as [PayBasis, string][]).map(([b, label]) => (
              <Button key={b} size="sm" variant={basis === b ? "primary" : "outline"} onClick={() => setBasis(b)}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="e-rate" className="block text-xs text-slate-500">
              {basis === "monthly" ? tr("Salary, per month", "Gaji, per bulan") : basis === "daily" ? tr("Rate, per day", "Tarif, per hari") : tr("Rate, per hour", "Tarif, per jam")}
            </label>
            <MoneyInput id="e-rate" value={rate} onChange={setRate} className="mt-1" />
            {rateUnset && rate <= 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                {tr(
                  "Not written yet — the rest can be saved without it; payroll counts nought until it is filled in.",
                  "Belum diisi — data lainnya tetap bisa disimpan; penggajian menghitung nol sampai ini diisi.",
                )}
              </p>
            )}
            {rateMissing && !rateUnset && employee && (
              <p className="mt-1 text-[11px] text-amber-700">
                {tr("Nought is not pay. Write what they are actually paid.", "Nol bukan upah. Tulis yang benar-benar dibayar.")}
              </p>
            )}
            {changed && rate > 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                {formatIDR(employee!.base_rate)} → {formatIDR(rate)} · {tr("both figures go on the audit row.", "kedua angka dicatat di baris audit.")}
              </p>
            )}
          </div>
          <div>
            {/* Per day for everybody, whatever the pokok is quoted in — that is
                how the owner described it, and how it is paid (D250). */}
            <label htmlFor="e-allowance" className="block text-xs text-slate-500">
              {tr("Allowance, per day present", "Tunjangan, per hari hadir")}
            </label>
            <MoneyInput id="e-allowance" value={allowance} onChange={setAllowance} className="mt-1" />
            {allowanceChanged ? (
              <p className="mt-1 text-[11px] text-amber-700">
                {formatIDR(employee!.allowance_rate)} → {formatIDR(allowance)} · {tr("recorded on the audit row.", "dicatat di baris audit.")}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                {tr(
                  "Paid per day the person is present. Zero means the pay has not been split yet — and while it is zero, none of this person's figures change.",
                  "Dibayar per hari orangnya hadir. Nol berarti gajinya memang belum dipisah — dan selama nol, tidak ada angka orang ini yang berubah.",
                )}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="e-hours" className="block text-xs text-slate-500">{tr("Hours in a standard day", "Jam dalam sehari standar")}</label>
            <NumberInput id="e-hours" value={hours} min={1} max={24} onChange={setHours} className="mt-1" />
            <p className="mt-1 text-[11px] text-slate-500">{tr("Anything past this is overtime — claimed, then approved twice.", "Lewat dari ini adalah lembur — diajukan, lalu disetujui dua kali.")}</p>
          </div>
          <div>
            <label htmlFor="e-joined" className="block text-xs text-slate-500">{tr("Start date", "Tanggal masuk")}</label>
            <input
              id="e-joined" type="date" value={joined} onChange={(e) => setJoined(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">{tr("First working day. Empty means today.", "Hari pertama kerja. Kosong berarti hari ini.")}</p>
          </div>
          <div>
            <label htmlFor="e-leave" className="block text-xs text-slate-500">{tr("Paid leave entitlement, per year", "Hak cuti berbayar, per tahun")}</label>
            {/* Per person, because the owner said so: length of service and
                what was agreed at hiring both move it (D144) — and **only
                after a year of service**, written by HRD (D349). */}
            {leaveOpen || leave > 0 ? (
              <NumberInput id="e-leave" value={leave} min={0} max={60} onChange={setLeave} className="mt-1" />
            ) : (
              <p id="e-leave" className="mt-1 flex h-9 items-center rounded-lg border border-slate-100 bg-slate-50 px-2 text-sm text-slate-500">
                {tr("0 — not entitled yet", "0 — belum berhak")}
              </p>
            )}
            <p className={"mt-1 text-[11px] " + (leaveOpen && leave === 0 ? "text-amber-700" : "text-slate-500")}>
              {!leaveOpensOn
                ? tr("Counted from the start date — fill that in first.", "Dihitung dari tanggal masuk — isi tanggal masuknya dulu.")
                : !leaveOpen
                  ? tr(`Filled in by HRD after a year of service — from ${leaveOpensOn}.`, `Diisi HRD setelah 1 tahun bekerja — mulai ${leaveOpensOn}.`)
                  : leave === 0
                    ? tr("A year of service is up — fill in the entitlement.", "Sudah 1 tahun bekerja — isi hak cutinya.")
                    : tr(
                      "Different for everybody. Leave within this number is paid; days past it are recorded and not paid.",
                      "Berbeda untuk setiap orang. Cuti dalam jumlah ini dibayar; hari yang melebihinya tercatat dan tidak dibayar.",
                    )}
            </p>
          </div>
        </div>

        {employee && (
          <div className={employee.active
            ? "rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-3"
            : "rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3"}
          >
            {employee.active ? (
              <>
                <p className="text-[13px] font-medium text-slate-800">{tr("Offboard", "Offboard / keluar")}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {tr(
                    "Nothing is deleted: every payslip and tap stays. From the day after, the machine's taps for this number are set aside at upload rather than filed.",
                    "Tidak ada yang dihapus: slip gaji dan tap tetap disimpan. Mulai hari berikutnya, tap mesin untuk nomor ini disisihkan saat unggah, tidak dicatat.",
                  )}
                </p>
                {!leaving ? (
                  <Button className="mt-2" size="sm" variant="outline" icon={UserMinus} onClick={() => setLeaving(true)} disabled={busy}>
                    {tr("This person has left…", "Orang ini sudah keluar…")}
                  </Button>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr]">
                    <div>
                      <label htmlFor="e-left" className="block text-xs text-slate-500">{tr("Last working day", "Hari kerja terakhir")}</label>
                      <input
                        id="e-left" type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="e-why" className="block text-xs text-slate-500">{tr("Why", "Alasan")}</label>
                      <input
                        id="e-why" value={why} onChange={(e) => setWhy(e.target.value)}
                        placeholder={tr("Resigned, contract ended, did not come back…", "Resign, kontrak selesai, tidak kembali…")}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button size="sm" variant="ghost" onClick={() => { setLeaving(false); setWhy(""); }} disabled={busy}>{tr("Cancel", "Batal")}</Button>
                      <Button size="sm" icon={UserMinus} onClick={offboard} disabled={busy || !leftOn || !why.trim()}>
                        {tr("Offboard", "Keluarkan")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-[13px] font-medium text-slate-800">
                  {tr(`Left on ${employee.left_on ?? "—"}`, `Keluar per ${employee.left_on ?? "—"}`)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {tr(
                    "Reinstate if this was the wrong person or date, or they came back. Taps set aside earlier come in when the file is uploaded again.",
                    "Aktifkan kembali kalau salah orang atau tanggal, atau orangnya kembali bekerja. Tap yang tadinya disisihkan masuk saat file diunggah lagi.",
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1">
                    <label htmlFor="e-why-back" className="block text-xs text-slate-500">{tr("Why", "Alasan")}</label>
                    <input
                      id="e-why-back" value={why} onChange={(e) => setWhy(e.target.value)}
                      placeholder={tr("Wrong date, came back…", "Salah tanggal, kembali bekerja…")}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                  <Button size="sm" variant="outline" icon={UserCheck} onClick={reinstate} disabled={busy || !why.trim()}>
                    {tr("Reinstate", "Aktifkan kembali")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
