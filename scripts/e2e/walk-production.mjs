#!/usr/bin/env node
/** The production walk, through the screens, in live mode.
 *
 *  `supabase/local/smoke/99_sim_production_to_handover.sql` walks the same
 *  order in SQL. This one presses the buttons: a client and a project, a
 *  product with its stages and BOM, a quotation the client accepts, a Job Order
 *  from the order line, a purchase request from the BOM, progress and a vendor
 *  leg, a crate, a delivery note, installation, and the signed BAST. Every step
 *  lands in `docs/sop/produksi/walk.json`, which `check-knowledge.mjs produksi`
 *  compares with John Lau's knowledge.
 *
 *  Same stack as the other walks; `reset.sh` seeds the people (`seed-production.sql`).
 */
import { createWalk, file, sql } from "./harness.mjs";

const PEOPLE = {
  Ryan: { email: "ryan@talaliving.com", id: "e2e00000-0000-0000-0000-0000000007a1" },
  Wayan: { email: "wayan@talaliving.com", id: "e2e00000-0000-0000-0000-0000000007b2" },
  Komang: { email: "komang@talaliving.com", id: "e2e00000-0000-0000-0000-0000000007c3" },
};
const CLIENT = "Hotel Laut Biru E2E";
const PRODUCT = "E2E-MJ-01";
const day = (n) => new Date(Date.now() + 8 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

const h = await createWalk({ module: "produksi", people: PEOPLE });
const ctx = {};
const page = () => h.page;
const click = async (loc) => { await h.mark(loc); await loc.first().click(); await page().waitForTimeout(1500); };

try {
  /* ═════ klien dan proyek ════════════════════════════════════════════ */
  await h.signIn("Ryan");
  await h.step({
    process: "prod.project", action: "Klien baru → nama, kontak, telepon → Simpan", button: "Klien baru", shot: "klien",
    act: async () => {
      await h.go("/master-data/clients");
      await page().getByRole("button", { name: "Klien baru" }).first().click();
      await page().getByLabel("Nama klien").fill(CLIENT);
      await page().getByLabel("Kontak").fill("Bu Sari");
      await page().getByLabel("Telepon / WA").fill("0812000111");
      await click(page().getByRole("button", { name: "Simpan", exact: true }));
    },
    check: async () => {
      ctx.client = sql(`select code from ops_procure.clients where name = '${CLIENT}'`);
      if (!ctx.client) throw new Error("client not saved");
      return ctx.client;
    },
  });

  await h.step({
    process: "prod.project", action: "Proyek baru → klien, lokasi, penanggung jawab → Simpan", button: "Proyek baru", shot: "proyek",
    act: async () => {
      await h.go("/proyek/order");
      await page().getByRole("button", { name: "Proyek baru" }).first().click();
      await page().getByLabel("Nama proyek").fill("Restoran Hotel Laut Biru").catch(async () => {
        await page().locator("label", { hasText: /^Nama/ }).first().locator("input").fill("Restoran Hotel Laut Biru");
      });
      const sel = page().getByLabel("Klien", { exact: true });
      const opt = await sel.locator("option", { hasText: CLIENT }).first().getAttribute("value");
      await sel.selectOption(opt);
      await page().getByLabel("Lokasi").fill("Labuan Bajo");
      await page().getByLabel("Penanggung jawab").fill("Ryan");
      await click(page().getByRole("button", { name: "Simpan", exact: true }));
    },
    check: async () => {
      const r = sql(`select p.code || ' ' || p.status from ops_procure.projects p join ops_procure.clients c on c.id = p.client_id
                      where c.code = '${ctx.client}' order by p.created_at desc limit 1`);
      if (!/ INQUIRY$/.test(r)) throw new Error(`expected an INQUIRY project, got "${r}"`);
      ctx.project = r.split(" ")[0];
      return `${ctx.project} INQUIRY`;
    },
  });

  /* ═════ produk dan BOM ══════════════════════════════════════════════ */
  await h.signIn("Wayan");
  await h.step({
    process: "prod.product_bom", action: "Produk baru → item code, nama, tahap Amplas/Finishing/Packing → Simpan", button: "Produk baru", shot: "produk",
    act: async () => {
      await h.go("/produksi/bom");
      await page().getByRole("button", { name: "Produk baru" }).click();
      await page().getByPlaceholder("mis. TL-DT-180").fill(PRODUCT);
      await page().getByPlaceholder("Meja, Kursi, Lemari…").fill("Meja");
      await page().getByPlaceholder("Meja makan jati 180×90").fill("Meja makan jati 180");
      for (const st of ["Sanding / amplas", "Finishing", "Packing"]) await page().getByLabel(`Tahap ${st}`).check();
      await click(page().getByRole("button", { name: "Simpan", exact: true }));
    },
    check: async () => {
      const r = sql(`select array_to_string(stages, ',') from ops_prod.products where product_code = '${PRODUCT}'`);
      if (r !== "AMPLAS,FINISHING,PACKING") throw new Error(`expected three stages, got "${r}"`);
      return "produk · Amplas → Finishing → Packing";
    },
  });

  async function addMaterial(query, qty) {
    await page().getByRole("button", { name: /Tambah komponen/ }).first().click();
    await page().getByLabel("Cari komponen").fill(query);
    await page().waitForTimeout(800);
    await page().locator("ul li button").filter({ hasText: new RegExp(query, "i") }).first().click();
    const need = page().locator("label", { hasText: /Kebutuhan per 1/ }).first().locator("input").first();
    await need.fill(String(qty));
    await page().getByRole("button", { name: /ikut katalog/ }).click().catch(() => {});
    await click(page().getByRole("button", { name: "Tambah", exact: true }));
  }

  await h.step({
    process: "prod.product_bom", action: "Tambah komponen: bahan dari database items dan tenaga kerja", button: "Tambah komponen", shot: "bom",
    act: async () => {
      await page().getByText(PRODUCT).first().click();
      await page().waitForTimeout(1200);
      await addMaterial("jati", 0.12);
      await addMaterial("PU clear", 1.5);
      await page().getByRole("button", { name: /Tambah komponen/ }).first().click();
      await page().getByRole("button", { name: "Tenaga kerja", exact: true }).click();
      await page().getByPlaceholder("mis. Tukang finishing").fill("Tukang kayu borongan meja");
      await page().locator("label", { hasText: /Kebutuhan per 1/ }).first().locator("input").first().fill("1");
      await page().locator("label", { hasText: /Rate per/ }).first().locator("input").first().fill("750000");
      await click(page().getByRole("button", { name: "Tambah", exact: true }));
    },
    check: async () => {
      const r = sql(`select count(*) from ops_prod.bom_components c join ops_prod.products p on p.id = c.product_id
                      where p.product_code = '${PRODUCT}'`);
      if (r !== "3") throw new Error(`expected 3 BOM lines, got ${r}`);
      return "draft BOM · 2 bahan + 1 tenaga kerja";
    },
  });

  await h.step({
    process: "prod.product_bom", action: "Catatan rilis → Rilis rev 1", button: "Rilis rev", shot: "bom-rilis",
    act: async () => {
      await page().getByLabel("Catatan rilis").fill("rev awal dari gambar kerja");
      await click(page().getByRole("button", { name: /^Rilis rev/ }));
    },
    check: async () => {
      const r = sql(`select count(*) from ops_prod.bom_revisions r join ops_prod.products p on p.id = r.product_id
                      where p.product_code = '${PRODUCT}' and r.released_at is not null`);
      if (r !== "1") throw new Error(`expected a released revision, got ${r}`);
      return "rev 1 dirilis";
    },
  });

  /* ═════ quotation ═══════════════════════════════════════════════════ */
  await h.signIn("Ryan");
  await h.step({
    process: "prod.quotation", action: "Quotation baru → proyek → Buat draft", button: "Buat draft", shot: "quotation",
    act: async () => {
      await h.go("/proyek/quotation");
      await page().getByRole("button", { name: "Quotation baru" }).click();
      const sel = page().getByLabel("Proyek");
      const opt = await sel.locator("option", { hasText: ctx.project }).first().getAttribute("value");
      await sel.selectOption(opt);
      await click(page().getByRole("button", { name: "Buat draft" }));
      await page().waitForTimeout(1500);
    },
    check: async () => {
      ctx.quote = sql(`select q.quote_no from ops_procure.quotations q join ops_procure.projects p on p.id = q.project_id
                        where p.code = '${ctx.project}' and q.status = 'DRAFT'`);
      if (!ctx.quote) throw new Error("no draft quotation");
      return `${ctx.quote} DRAFT`;
    },
  });

  await h.step({
    process: "prod.quotation", action: "Tambah item: item code dan jumlah → simpan", button: "Tambah item",
    act: async () => {
      if (!page().url().includes(ctx.quote)) await h.go(`/proyek/quotation/${ctx.quote}`);
      await page().getByRole("button", { name: /Tambah item/ }).first().click();
      await page().getByLabel("Item code").fill(PRODUCT);
      await page().getByLabel("Item code").press("Tab");
      const qty = page().getByLabel(/^Jumlah|^Qty/).first();
      if (await qty.count()) await qty.fill("4");
      else await page().locator("tr input[inputmode=decimal], tr input[inputmode=numeric]").first().fill("4");
      await click(page().getByRole("button", { name: "Simpan", exact: true }));
    },
    check: async () => {
      const r = sql(`select count(*) || ' ' || coalesce(max(l.qty)::text, '-') from ops_procure.quotation_lines l
                       join ops_procure.quotations q on q.id = l.quotation_id where q.quote_no = '${ctx.quote}'`);
      if (!r.startsWith("1 4")) throw new Error(`expected one line of 4, got "${r}"`);
      return "1 item · 4 unit";
    },
  });

  await h.step({
    process: "prod.quotation", action: "Kirim ke klien", button: "Kirim ke klien",
    act: async () => { await click(page().getByRole("button", { name: "Kirim ke klien" })); },
    check: async () => {
      const r = sql(`select q.status || ' ' || p.status from ops_procure.quotations q join ops_procure.projects p on p.id = q.project_id
                      where q.quote_no = '${ctx.quote}'`);
      if (r !== "SENT QUOTATION_SENT") throw new Error(`expected SENT / QUOTATION_SENT, got "${r}"`);
      return "SENT · proyek QUOTATION_SENT";
    },
  });

  await h.step({
    process: "prod.quotation", action: "Klien setuju → Disetujui", button: "Disetujui", shot: "quotation-setuju",
    act: async () => { await click(page().getByRole("button", { name: "Disetujui" })); },
    check: async () => {
      const r = sql(`select q.status || ' ' || p.status || ' ' || (select count(*) from ops_procure.project_lines l where l.project_id = p.id)
                       from ops_procure.quotations q join ops_procure.projects p on p.id = q.project_id where q.quote_no = '${ctx.quote}'`);
      if (r !== "ACCEPTED DEAL 1") throw new Error(`expected ACCEPTED, DEAL, 1 order line, got "${r}"`);
      return "ACCEPTED · proyek DEAL · 1 baris order";
    },
  });

  /* ═════ Job Order ═══════════════════════════════════════════════════ */
  await h.signIn("Wayan");
  await h.step({
    process: "prod.job_order", action: "Dari baris order: Buat Job Order → jatuh tempo → Buat", button: "Buat Job Order", shot: "job-order",
    act: async () => {
      await h.go("/proyek/order");
      await page().getByText(ctx.project).first().click();
      await page().waitForTimeout(1200);
      await page().getByRole("button", { name: "Buat Job Order" }).first().click();
      await page().getByLabel("Jatuh tempo Job Order").fill(day(21));
      await click(page().getByRole("button", { name: "Buat", exact: true }));
    },
    check: async () => {
      const r = sql(`select w.wo_no || ' ' || w.status || ' ' || w.qty::int || ' ' || p.status from ops_prod.work_orders w
                       join ops_procure.projects p on p.code = w.project_code where w.project_code = '${ctx.project}'`);
      if (!/ OPEN 4 IN_PRODUCTION$/.test(r)) throw new Error(`expected an OPEN Job Order of 4, project IN_PRODUCTION, got "${r}"`);
      ctx.jo = r.split(" ")[0];
      return `${ctx.jo} OPEN · proyek IN_PRODUCTION`;
    },
  });

  await h.step({
    process: "prod.materials", action: "Buka Job Order → Buat PR dari BOM", button: "Buat PR dari BOM", shot: "pr-bom",
    act: async () => {
      await h.go("/produksi/jadwal");
      await page().getByText(ctx.jo).first().click();
      await page().waitForTimeout(1500);
      await click(page().getByRole("button", { name: "Buat PR dari BOM" }));
    },
    check: async () => {
      const r = sql(`select count(*) || ' ' || count(item_id) from ops_procure.pr_lines where source_wo_no = '${ctx.jo}'`);
      if (r !== "2 2") throw new Error(`expected 2 request lines, both linked to items, got "${r}"`);
      return "PR DRAFT · 2 baris, keduanya bertaut item";
    },
  });

  async function progress(stageLabel, qty) {
    const sel = page().getByLabel("Tahap");
    const v = await sel.locator("option", { hasText: stageLabel }).first().getAttribute("value");
    await sel.selectOption(v);
    /* The quantity box right after the stage picker — the vendor form above
       has a quantity box of its own. */
    await sel.locator("xpath=following::input[1]").fill(String(qty));
    await page().getByPlaceholder("Siapa yang mengerjakan").fill("Pak Nyoman");
    await page().keyboard.press("Enter").catch(() => {});
    await click(page().getByRole("button", { name: "Catat", exact: true }));
  }

  await h.step({
    process: "prod.progress", action: "Catat progres Amplas 4", button: "Catat", shot: "progres",
    act: async () => { await progress("Sanding", 4); },
    check: async () => {
      const r = sql(`select coalesce(sum(e.qty)::int, 0) from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
                      where w.wo_no = '${ctx.jo}' and e.stage = 'AMPLAS'`);
      if (r !== "4") throw new Error(`expected 4 sanded, got ${r}`);
      return "Amplas 4/4";
    },
  });

  await h.step({
    process: "prod.progress", action: "Kirim ke vendor → finishing → Catat dikirim, lalu Catat kembali", button: "Catat dikirim", shot: "vendor",
    act: async () => {
      await page().getByRole("button", { name: "Kirim ke vendor" }).click();
      const proses = page().locator("label", { hasText: "Proses" }).locator("select");
      const pv = await proses.locator("option", { hasText: /Finishing/i }).first().getAttribute("value");
      await proses.selectOption(pv);
      const vendor = page().locator("label", { hasText: "Vendor" }).locator("select");
      const vv = await vendor.locator("option", { hasText: "CV FINISHING SIMULASI" }).first().getAttribute("value");
      await vendor.selectOption(vv);
      await page().locator("label", { hasText: /^Jumlah/ }).locator("input").first().fill("4");
      await page().locator("label", { hasText: "Dijanjikan kembali" }).locator("input").fill(day(5));
      await click(page().getByRole("button", { name: "Catat dikirim" }));
      await click(page().getByRole("button", { name: "Catat kembali" }));
    },
    check: async () => {
      const r = sql(`select l.leg_no || ' ' || coalesce(l.returned_qty::int::text, '-') from ops_prod.vendor_legs l
                       join ops_prod.work_orders w on w.id = l.wo_id where w.wo_no = '${ctx.jo}'`);
      if (!/ 4$/.test(r)) throw new Error(`expected the leg back with 4, got "${r}"`);
      return `${r.split(" ")[0]} kembali 4`;
    },
  });

  await h.step({
    process: "prod.progress", action: "Catat Finishing 4 dan Packing 4, lalu Tutup", button: "Tutup",
    act: async () => {
      await progress("Finishing", 4);
      await progress("Packing", 4);
      /* Once every piece is past the last stage the close form is already
         open; before that it sits behind "Tutup Job Order". */
      await page().getByRole("button", { name: "Tutup Job Order" }).click({ timeout: 3000 }).catch(() => {});
      await click(page().getByRole("button", { name: "Tutup", exact: true }));
    },
    check: async () => {
      const r = sql(`select status from ops_prod.work_orders where wo_no = '${ctx.jo}'`);
      if (r !== "DONE") throw new Error(`expected DONE, got "${r}"`);
      return "DONE";
    },
  });

  /* ═════ peti, surat jalan, sampai ═══════════════════════════════════ */
  await h.signIn("Komang");
  await h.step({
    process: "prod.packing", action: "Kemas peti → proyek, tujuan, isi → Kemas & beri label", button: "Kemas & beri label", shot: "peti",
    act: async () => {
      await h.go("/proyek/peti");
      await page().getByRole("button", { name: "Kemas peti" }).click();
      const sel = page().locator("select").first();
      const v = await sel.locator("option", { hasText: ctx.project }).first().getAttribute("value");
      await sel.selectOption(v);
      await page().getByPlaceholder("Lantai 2 — kamar tidur utama").fill("Restoran lantai 1");
      await page().waitForTimeout(600);
      const qty = page().locator("input[inputmode]").first();
      if (await qty.count()) await qty.fill("4");
      await click(page().getByRole("button", { name: /Kemas & beri label/ }));
    },
    check: async () => {
      ctx.box = sql(`select box_no from ops_dlv.packing_boxes where project_code = '${ctx.project}' order by packed_at desc limit 1`);
      if (!ctx.box) throw new Error("no crate");
      return `${ctx.box} PACKED`;
    },
  });

  await h.step({
    process: "prod.delivery", action: "Buat surat jalan → jumlah, peti, sopir, kendaraan → Berangkatkan", button: "Berangkatkan", shot: "surat-jalan",
    act: async () => {
      await h.go("/proyek/pengiriman");
      await page().getByRole("button", { name: /Buat surat jalan/ }).first().click();
      await page().waitForTimeout(800);
      await page().locator("input[inputmode]").first().fill("4");
      await page().getByLabel(new RegExp(ctx.box)).check().catch(() => {});
      await page().locator("label", { hasText: "Sopir" }).locator("input").fill("Pak Made");
      await page().locator("label", { hasText: "Kendaraan" }).locator("input").fill("DK 1234 XX");
      await click(page().getByRole("button", { name: /^Berangkatkan/ }));
    },
    check: async () => {
      const r = sql(`select d.delivery_no || ' ' || d.status || ' ' || p.status from ops_dlv.deliveries d
                       join ops_procure.projects p on p.code = d.project_code where p.code = '${ctx.project}'`);
      if (!/ IN_TRANSIT SHIPPED$/.test(r)) throw new Error(`expected IN_TRANSIT and SHIPPED, got "${r}"`);
      ctx.delivery = r.split(" ")[0];
      return `${ctx.delivery} IN_TRANSIT · proyek SHIPPED`;
    },
  });

  await h.step({
    process: "prod.delivery", action: "Catat sampai → penerima + foto surat jalan → Simpan", button: "Catat sampai",
    act: async () => {
      await page().getByRole("button", { name: "Catat sampai" }).first().click();
      await page().getByLabel("Penerima").fill("Pak Wayan (engineering hotel)");
      await page().setInputFiles("input[aria-label='Foto surat jalan bertanda tangan']", file("surat-jalan.jpg"));
      await page().waitForTimeout(1500);
      await click(page().getByRole("button", { name: "Simpan", exact: true }));
    },
    check: async () => {
      const r = sql(`select status from ops_dlv.deliveries where delivery_no = '${ctx.delivery}'`);
      if (r !== "ARRIVED") throw new Error(`expected ARRIVED, got "${r}"`);
      return "ARRIVED";
    },
  });

  await h.step({
    process: "prod.installation", action: "Catat pemasangan → jumlah, tim → Catat N unit terpasang", button: "Catat pemasangan", shot: "instalasi",
    act: async () => {
      await h.go("/proyek/instalasi");
      await page().getByRole("button", { name: /Catat pemasangan/ }).first().click();
      await page().waitForTimeout(800);
      await page().locator("input[inputmode]").first().fill("4");
      await page().locator("label", { hasText: "Tim yang datang" }).locator("input").fill("Tim Made").catch(() => {});
      await click(page().getByRole("button", { name: /^Catat \d+ unit terpasang/ }));
    },
    check: async () => {
      const r = sql(`select coalesce(sum(l.qty)::int, 0) from ops_dlv.installation_lines l join ops_dlv.installations i on i.id = l.installation_id
                      where i.project_code = '${ctx.project}'`);
      if (r !== "4") throw new Error(`expected 4 installed, got ${r}`);
      return "4 terpasang";
    },
  });

  /* ═════ serah terima ════════════════════════════════════════════════ */
  await h.signIn("Ryan");
  await h.step({
    process: "prod.handover", action: "Serah terima → penandatangan, unggah BAST → Catat serah terima", button: "Catat serah terima", shot: "bast",
    act: async () => {
      await h.go("/proyek/serah-terima");
      await page().getByRole("button", { name: "Serah terima" }).first().click();
      await page().getByPlaceholder("Nama dan jabatan, seperti di kertasnya").fill("Bu Sari, GM Hotel Laut Biru");
      await page().locator("label", { hasText: /dari kita/ }).locator("input").fill("Ryan, PM");
      await page().setInputFiles("input[aria-label='Unggah BAST yang sudah ditandatangani']", file("bast.jpg"));
      await page().waitForTimeout(1500);
      await click(page().getByRole("button", { name: "Catat serah terima" }));
    },
    check: async () => {
      const r = sql(`select status from ops_procure.projects where code = '${ctx.project}'`);
      if (r !== "DONE") throw new Error(`expected DONE, got "${r}"`);
      return "proyek DONE";
    },
  });
} finally {
  await h.finish();
}
