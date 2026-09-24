#!/usr/bin/env node
/** The HR walk, through the screens, in live mode.
 *
 *  `supabase/local/smoke/99_sim_hr_to_ledger.sql` walks the same week in SQL.
 *  This one presses the buttons: a new person, their 201 file and contract,
 *  last week's attendance from a machine file, a sick day, a leave request,
 *  the week's payroll — prepared by HRD, approved by leadership, paid by
 *  finance into the ledger. Every step lands in `docs/sop/hr/walk.json`, which
 *  `scripts/sop/check-knowledge.mjs hr` compares with John Lau's knowledge.
 *
 *  Same stack and running notes as `walk-procurement.mjs`; `reset.sh` seeds
 *  both walks' people (`seed-hr.sql`).
 */
import { createWalk, file, sql } from "./harness.mjs";

const PEOPLE = {
  Sari: { email: "sari@talaliving.com", id: "e2e00000-0000-0000-0000-0000000005a1" },
  Evin: { email: "evin@talaliving.com", id: "e2e00000-0000-0000-0000-00000000ce00" },
  Rina: { email: "rina@talaliving.com", id: "e2e00000-0000-0000-0000-00000000f11a" },
};

/* Last week, Monday to Sunday, in the office's own calendar (WITA). */
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayMs = Date.parse(day(Date.now() + 8 * 3_600_000));
const dow = new Date(todayMs).getUTCDay() || 7;
const MON = day(todayMs - (dow - 1 + 7) * 86_400_000);
const d = (i) => day(Date.parse(MON) + i * 86_400_000);
const dmy = (key, hm) => { const [y, m, dd] = key.split("-"); return `${dd}/${m}/${y} ${hm}`; };

/* The machine's export: four taps a day. Karjo (101) Mon, Tue, Thu, Fri — Wed
   he is sick. Wulan (102) Mon, Tue and Fri — Wed and Thu are leave, and on
   Friday the machine missed her going home. */
function machineFile() {
  const rows = ["No.,Name,Date/Time,VerifyCode,Location ID"];
  for (const i of [0, 1, 3, 4]) {
    for (const hm of ["07:25", "12:00", "12:44", i === 4 ? "16:05" : "16:35"]) rows.push(`101,Karjo,${dmy(d(i), hm)},FP,104`);
  }
  for (const i of [0, 1, 4]) {
    for (const hm of ["07:55", "12:00", "12:58", ...(i < 4 ? ["17:20"] : [])]) rows.push(`102,Wulan,${dmy(d(i), hm)},FP,104`);
  }
  rows.push(`999,Tamu,${dmy(d(0), "08:00")},FP,104`);
  return { name: `mesin-${MON}.csv`, mimeType: "text/csv", buffer: Buffer.from(rows.join("\n") + "\n") };
}

const h = await createWalk({ module: "hr", people: PEOPLE });
const ctx = {};

try {
  await h.signIn("Sari");

  /* ═════ karyawan ════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.employee", action: "Tambah karyawan harian: Add somebody → isi → Save", button: "Save", shot: "karyawan",
    act: async () => {
      await h.go("/hrd/karyawan");
      await h.page.getByRole("button", { name: "Add somebody" }).click();
      await h.page.fill("#e-no", "B-0101");
      await h.page.fill("#e-name", "Karjo Susanto");
      await h.page.fill("#e-pos", "Tukang kayu");
      await h.page.fill("#e-unit", "Produksi");
      await h.page.getByRole("button", { name: "Per day" }).click();
      await h.page.fill("#e-rate", "180000");
      await h.page.fill("#e-allowance", "25000");
      await h.page.fill("#e-joined", d(-400));
      const save = h.page.getByRole("button", { name: "Save" });
      await h.mark(save); await save.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select pay_basis || ' ' || base_rate || ' ' || allowance_rate || ' ' || joined_on from ops_hr.employees where employee_no = 'B-0101'`);
      if (r !== `daily 180000 25000 ${d(-400)}`) throw new Error(`expected Karjo daily 180000 25000, got "${r}"`);
      return "B-0101 aktif, harian Rp 180.000";
    },
  });

  await h.step({
    process: "hr.employee", action: "Tambah karyawan bulanan di unit Kantor", button: "Save",
    act: async () => {
      await h.page.getByRole("button", { name: "Add somebody" }).click();
      await h.page.fill("#e-no", "B-0102");
      await h.page.fill("#e-name", "Wulan Sari");
      await h.page.fill("#e-pos", "Admin");
      await h.page.fill("#e-unit", "Kantor");
      await h.page.getByRole("button", { name: "Monthly salary" }).click();
      await h.page.fill("#e-rate", "4500000");
      await h.page.fill("#e-allowance", "25000");
      await h.page.fill("#e-joined", d(-400));
      await h.page.getByRole("button", { name: "Save" }).click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select pay_basis || ' ' || base_rate from ops_hr.employees where employee_no = 'B-0102'`);
      if (r !== "monthly 4500000") throw new Error(`expected Wulan monthly, got "${r}"`);
      return "B-0102 aktif, bulanan";
    },
  });

  /* ═════ jadwal ══════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.schedule", action: "Pasang pola PRODUKSI untuk Karjo", button: "Pasang", shot: "jadwal",
    act: async () => {
      await h.go("/hrd/jadwal");
      /* Karjo is the one person listed without a pattern: Produksi has no
         unit default in the seeded rules. */
      const pick = h.page.getByPlaceholder("Pilih pola kerja…").first();
      await pick.waitFor({ timeout: 15000 });
      await pick.focus();
      await h.page.getByRole("button", { name: /^Produksi/ }).first().click({ timeout: 10000 });
      const b = h.page.getByRole("button", { name: "Pasang" }).first();
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select coalesce(schedule_code,'-') from ops_hr.employees where employee_no = 'B-0101'`);
      if (r !== "PRODUKSI") throw new Error(`expected PRODUKSI, got "${r}"`);
      return "Karjo: PRODUKSI";
    },
  });

  /* ═════ berkas 201 ══════════════════════════════════════════════════ */
  await h.step({
    process: "hr.employee_files", action: "KTP: Tambah → nomor + scan → Simpan", button: "Simpan", shot: "berkas-201",
    act: async () => {
      await h.go("/hrd/berkas-201");
      await h.page.getByRole("button", { name: /Karjo Susanto/ }).first().click();
      await h.page.waitForTimeout(800);
      const slot = h.page.locator("div", { hasText: /^KTP/ }).filter({ has: h.page.getByRole("button", { name: "Tambah" }) }).last();
      await slot.getByRole("button", { name: "Tambah" }).click();
      await h.page.getByLabel("Nomor dokumen").fill("3271010101800001");
      await h.page.setInputFiles("input[aria-label='Scan atau foto berkas']", file("ktp-karjo.jpg"));
      const b = h.page.getByRole("button", { name: "Simpan" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select count(*) filter (where d.link_id is not null) || '/' || count(*)
                       from ops_hr.employee_documents d join ops_hr.employees e on e.id = d.employee_id
                      where e.employee_no = 'B-0101' and d.kind = 'ktp'`);
      if (r !== "1/1") throw new Error(`expected a KTP with its scan, got "${r}"`);
      return "KTP tercatat dengan scan";
    },
  });

  /* ═════ kontrak ═════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.contract", action: "Daftarkan kontrak PKWT", button: "Daftarkan", shot: "kontrak",
    act: async () => {
      await h.go("/hrd/kontrak");
      await h.page.getByRole("button", { name: "Daftarkan kontrak" }).click();
      await h.page.selectOption("#k-emp", "B-0101");
      await h.page.getByRole("button", { name: /^PKWT\s/ }).click();
      await h.page.fill("#k-from", d(-30));
      await h.page.fill("#k-to", d(335));
      const b = h.page.getByRole("button", { name: "Daftarkan", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      ctx.contract = sql(`select c.contract_no || ' ' || c.status from ops_hr.employment_contracts c
                            join ops_hr.employees e on e.id = c.employee_id where e.employee_no = 'B-0101'
                           order by c.created_at desc limit 1`);
      if (!/ draft$/.test(ctx.contract)) throw new Error(`expected a draft, got "${ctx.contract}"`);
      ctx.contract = ctx.contract.split(" ")[0];
      return `${ctx.contract} draft`;
    },
  });

  await h.step({
    process: "hr.contract", action: "Lampirkan kontrak yang ditandatangani", button: "Lampirkan kontrak", shot: "kontrak-kertas",
    act: async () => {
      await h.go(`/hrd/kontrak/${ctx.contract}`);
      await h.mark(h.page.getByRole("button", { name: "Lampirkan kontrak" }));
      await h.page.setInputFiles("input[aria-label='Berkas kontrak yang ditandatangani']", file("pkwt-karjo.jpg"));
      await h.page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select (link_id is not null)::int from ops_hr.employment_contracts where contract_no = '${ctx.contract}'`);
      if (r !== "1") throw new Error("the paper is not linked");
      return "draft · berkas terlampir";
    },
  });

  await h.step({
    process: "hr.contract", action: "Jawab sepuluh poin wajib (Jawab → kalimat + nilai → Konfirmasi)", button: "Konfirmasi", shot: "kontrak-poin",
    act: async () => {
      for (let i = 0; i < 20; i++) {
        const jawab = h.page.getByRole("button", { name: "Jawab", exact: true });
        if (await jawab.count() === 0) break;
        await jawab.first().click();
        await h.page.getByPlaceholder("Salin kalimatnya dari kontrak, apa adanya.").fill(`Pasal ${i + 1} sebagaimana tertulis di kontrak.`);
        /* One editor is open at a time, and the page has no other selects or
           digit fields, so the page is the editor. */
        const editor = h.page;
        for (const s of await editor.locator("select").all()) {
          const vals = await s.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
          const want = ["day", "PKWT", "manual", "off", "statutory", "PRODUKSI"].find((v) => vals.includes(v)) ?? vals[0];
          await s.selectOption(want);
        }
        for (const inp of await editor.locator("input[inputmode=numeric]").all()) {
          await inp.fill((await inp.getAttribute("placeholder")) ?? "1");
        }
        await h.page.getByRole("button", { name: "Konfirmasi" }).click();
        await h.page.waitForTimeout(1200);
      }
    },
    check: async () => {
      const r = sql(`select count(*) from ops_hr.contract_clauses where contract_no = '${ctx.contract}' and confirmed_at is not null`);
      if (Number(r) < 10) throw new Error(`expected 10 confirmed clauses, got ${r}`);
      return `${r} poin terjawab`;
    },
  });

  await h.step({
    process: "hr.contract", action: "Berlakukan kontrak", button: "Berlakukan",
    act: async () => {
      const b = h.page.getByRole("button", { name: "Berlakukan" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select status from ops_hr.employment_contracts where contract_no = '${ctx.contract}'`);
      if (r !== "active") throw new Error(`expected active, got "${r}"`);
      return "active";
    },
  });

  /* ═════ absensi ═════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.attendance", action: "Upload biometric file → Import N tap(s)", button: "Import N tap(s)", shot: "absensi-impor",
    act: async () => {
      await h.go(`/hrd/absensi?from=${MON}`);
      await h.page.getByRole("button", { name: "Upload biometric file" }).click();
      await h.page.locator("input[type=file]").last().setInputFiles(machineFile());
      await h.page.waitForTimeout(800);
      const b = h.page.getByRole("button", { name: /^Import \d+ tap/ });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(2000);
      await h.page.getByRole("button", { name: "Back to the timesheet" }).click().catch(() => {});
    },
    check: async () => {
      const r = sql(`select count(*) from ops_hr.attendance_scans`);
      if (r !== "27") throw new Error(`expected 27 taps, got ${r}`);
      return "27 tap masuk · 1 nomor tak dikenal";
    },
  });

  const cell = async (name, date) => {
    await h.go(`/hrd/absensi?from=${MON}`);
    const row = h.page.locator("tr", { hasText: name });
    const col = await h.page.locator("thead th").evaluateAll((ths, dt) =>
      ths.findIndex((t) => (t.textContent ?? "").includes(String(Number(dt.slice(8))))), date);
    await row.locator("td, th").nth(col).locator("button").click();
    await h.page.waitForTimeout(800);
  };

  await h.step({
    process: "hr.attendance", action: "Wulan Jumat: Tap the machine missed → Add tap", button: "Add tap", shot: "absensi-tap",
    act: async () => {
      await cell("Wulan Sari", d(4));
      await h.page.getByRole("button", { name: "Tap the machine missed" }).click();
      await h.page.getByLabel("Time").fill("16:31");
      await h.page.getByPlaceholder(/Why the machine missed it/).fill("jari tidak terbaca mesin, dikonfirmasi satpam");
      const b = h.page.getByRole("button", { name: "Add tap" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select count(*) from ops_hr.attendance_scans s join ops_hr.employees e on e.id = s.employee_id
                      where e.employee_no = 'B-0102' and s.work_date = '${d(4)}'`);
      if (r !== "4") throw new Error(`expected 4 taps on Friday, got ${r}`);
      return "Jumat Wulan lengkap (4 tap)";
    },
  });

  await h.step({
    process: "hr.attendance", action: "Karjo Rabu: pilih Sakit → Mark as sakit", button: "Mark as sakit", shot: "absensi-sakit",
    act: async () => {
      await cell("Karjo Susanto", d(2));
      await h.page.getByRole("button", { name: "Sakit", exact: true }).click();
      await h.page.getByPlaceholder(/Keterangan — surat dokter/).fill("demam");
      const b = h.page.getByRole("button", { name: "Mark as sakit" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select kind from ops_hr.day_marks m join ops_hr.employees e on e.id = m.employee_id
                      where e.employee_no = 'B-0101' and m.work_date = '${d(2)}' and m.withdrawn_at is null`);
      if (r !== "sick") throw new Error(`expected sick, got "${r}"`);
      return "sakit";
    },
  });

  await h.step({
    process: "hr.attendance", action: "Lampirkan surat dokter", button: "Lampirkan surat dokter",
    act: async () => {
      await cell("Karjo Susanto", d(2));
      await h.mark(h.page.getByRole("button", { name: "Lampirkan surat dokter" }));
      await h.page.locator("input[type=file]").last().setInputFiles(file("surat-dokter.jpg"));
      await h.page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select count(*) from ops_core.attachment_links where kind = 'surat_dokter' and unlinked_at is null`);
      if (r !== "1") throw new Error(`expected the doctor's note linked, got ${r}`);
      return "sakit · surat dokter terlampir";
    },
  });

  /* ═════ cuti ════════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.leave", action: "Ajukan cuti Wulan Rabu–Kamis", button: "Ajukan", shot: "cuti",
    act: async () => {
      await h.go("/hrd/cuti");
      await h.page.getByRole("button", { name: "Ajukan" }).first().click();
      /* The request form is the only one on the page. */
      const form = h.page.locator("main");
      await form.locator("select").first().selectOption("B-0102");
      await form.locator("select").nth(1).selectOption("cuti");
      await form.locator("input[type=date]").first().fill(d(2));
      await form.locator("input[type=date]").nth(1).fill(d(3));
      await h.page.getByPlaceholder("Alasan — ini yang dibaca saat diputuskan").fill("acara keluarga di Makassar");
      const b = form.getByRole("button", { name: "Ajukan", exact: true }).last();
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select status from ops_hr.leave_requests order by requested_at desc limit 1`);
      if (r !== "PENDING") throw new Error(`expected PENDING, got "${r}"`);
      return "PENDING";
    },
  });

  await h.step({
    process: "hr.leave", action: "Setujui cuti", button: "Setujui",
    act: async () => {
      const b = h.page.getByRole("button", { name: "Setujui" }).first();
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select status || ' · ' || (select count(*) from ops_hr.day_marks m join ops_hr.employees e on e.id = m.employee_id
                        where e.employee_no = 'B-0102' and m.kind = 'leave') from ops_hr.leave_requests order by requested_at desc limit 1`);
      if (r !== "APPROVED · 2") throw new Error(`expected APPROVED with 2 marked days, got "${r}"`);
      return "APPROVED · 2 hari bertanda cuti";
    },
  });

  /* ═════ gajian ══════════════════════════════════════════════════════ */
  await h.step({
    process: "hr.payroll_run", action: "Gajian mingguan minggu lalu → Buka run minggu ini", button: "Buka run minggu ini", shot: "gajian-mingguan",
    act: async () => {
      await h.go(`/hrd/payroll/minggu?from=${MON}`);
      const b = h.page.getByRole("button", { name: "Buka run minggu ini" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(2500);
    },
    check: async () => {
      ctx.run = sql(`select run_no || ' ' || status from ops_hr.payroll_runs where period_start = '${MON}'`);
      if (!/ DRAFT$/.test(ctx.run)) throw new Error(`expected a DRAFT run, got "${ctx.run}"`);
      ctx.run = ctx.run.split(" ")[0];
      return `${ctx.run} DRAFT`;
    },
  });

  await h.step({
    process: "hr.payroll_run", action: "Tambah bonus untuk Karjo", button: "Tambahkan", shot: "run",
    act: async () => {
      await h.go(`/hrd/payroll/${ctx.run}`);
      await h.page.getByLabel("Karyawan").selectOption("B-0101");
      await h.page.getByLabel("Jenis").selectOption("bonus");
      const form = h.page.locator("div", { has: h.page.getByLabel("Karyawan") }).last();
      await form.locator("input").filter({ hasNot: h.page.locator("[type=date]") }).first().fill("150000");
      await h.page.getByPlaceholder(/Alasan — dicetak apa adanya/).fill("target rak selesai lebih cepat");
      const b = h.page.getByRole("button", { name: "Tambahkan" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select sum(amount)::bigint from ops_hr.payroll_adjustments
                      where run_no = '${ctx.run}' and withdrawn_at is null`);
      if (r !== "150000") throw new Error(`expected a 150000 bonus, got "${r}"`);
      const t = sql(`select open_days || ' ' || net_total from ops_hr.payroll_totals('${MON}', '${d(6)}', '${ctx.run}')`);
      ctx.net = Number(t.split(" ")[1]);
      if (!t.startsWith("0 ")) throw new Error(`expected no unread days, got "${t}"`);
      return `DRAFT · 0 hari belum dibaca · diterima ${ctx.net}`;
    },
  });

  await h.signIn("Evin");
  await h.step({
    process: "hr.payroll_approve", action: "Approve the run", button: "Approve the run", shot: "run-approve",
    act: async () => {
      await h.go(`/hrd/payroll/${ctx.run}`);
      const b = h.page.getByRole("button", { name: "Approve the run" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select status from ops_hr.payroll_runs where run_no = '${ctx.run}'`);
      if (r !== "APPROVED") throw new Error(`expected APPROVED, got "${r}"`);
      return "APPROVED";
    },
  });

  await h.signIn("Rina");
  await h.step({
    process: "hr.payroll_pay", action: "Bayar run ini → bukti transfer → Catat ke buku besar", button: "Catat Rp", shot: "bayar-run",
    act: async () => {
      await h.go(`/hrd/payroll/${ctx.run}`);
      await h.page.setInputFiles("input[aria-label='Bukti transfer gaji']", file("transfer-gaji.jpg"));
      const b = h.page.getByRole("button", { name: /^Catat Rp/ });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select r.status || ' ' || t.trx_no || ' ' || t.type_code || ' ' || t.amount_idr::bigint
                       from ops_hr.payroll_runs r join ops_acct.transactions t on t.trx_no = r.paid_trx_no
                      where r.run_no = '${ctx.run}'`);
      if (!r.startsWith("PAID ") || !r.includes("PAYROLL WEEKLY") || !r.endsWith(` ${ctx.net}`)) {
        throw new Error(`expected PAID through a weekly payroll row of ${ctx.net}, got "${r}"`);
      }
      return `PAID · ${r.split(" ")[1]}`;
    },
  });
} finally {
  await h.finish();
}
