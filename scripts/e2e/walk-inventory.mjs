#!/usr/bin/env node
/** The inventory walk, through the screens, in live mode.
 *
 *  `supabase/local/smoke/99_sim_inventory.sql` walks the same week in SQL.
 *  This one presses the buttons, as the people who press them: the gudang
 *  agrees a rack with the floor and types it in, registers an item found on it
 *  with its photos and first count, procurement records the glue arriving with
 *  its delivery note (and the rack gains it), the gudang issues material to a
 *  Job Order and moves some to another rack, counts the rack and records the
 *  difference, puts the Job Order's finished chairs on the finished-goods rack,
 *  delivery writes the surat jalan, and an asset is registered. A reader opens
 *  the opname screen and is offered nothing to write.
 *
 *  Every step lands in `docs/sop/inventory/walk.json`, which
 *  `scripts/sop/check-knowledge.mjs inventory` compares with John Lau's
 *  knowledge (0181). Same stack and running notes as `walk-procurement.mjs`;
 *  `reset.sh` seeds this walk's people and what the other modules hold
 *  before the week (`seed-inventory.sql`). The screens are walked in their
 *  default language, English (D318), so the buttons recorded are English and
 *  the guide names both.
 */
import { createWalk, file, sql } from "./harness.mjs";

const PEOPLE = {
  Dewi: { email: "dewi@talaliving.com", id: "e2e00000-0000-0000-0000-0000000000d1" },
  Lina: { email: "lina@talaliving.com", id: "e2e00000-0000-0000-0000-0000000000e1" },
  Andi: { email: "andi@talaliving.com", id: "e2e00000-0000-0000-0000-00000000a11d" },
  Joko: { email: "joko@talaliving.com", id: "e2e00000-0000-0000-0000-0000000000c0" },
};

const onHand = (item, loc) => Number(sql(`select coalesce(sum(qty),0) from ops_inv.stock_moves
  where item_code = '${item}'${loc ? ` and location = '${loc}'` : ""}`));

const h = await createWalk({ module: "inventory", people: PEOPLE });
const ctx = {};

try {
  await h.signIn("Dewi");

  /* ═════ lokasi ══════════════════════════════════════════════════════ */
  await h.step({
    process: "inv.locations", action: "Tambah lokasi RAK-A1: kode + nama → Add location", button: "Add location", shot: "lokasi",
    act: async () => {
      await h.go("/inventory/penyesuaian");
      await h.page.getByPlaceholder("Code, e.g. AREA-A").fill("RAK-A1");
      await h.page.getByPlaceholder("Name, e.g. Area A — sanding rack").fill("Rak A1 — lem & cat");
      const b = h.page.getByRole("button", { name: "Add location" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select name || ' ' || is_active from ops_inv.stock_locations where code = 'RAK-A1'`);
      if (r !== "Rak A1 — lem & cat true") throw new Error(`expected RAK-A1 active, got "${r}"`);
      return "RAK-A1 aktif";
    },
  });

  await h.step({
    process: "inv.locations", action: "Ganti nama RAK-A1: Rename → nama baru → Save name", button: "Save name",
    act: async () => {
      const row = h.page.locator("li", { hasText: "RAK-A1" });
      await row.getByRole("button", { name: "Rename" }).click();
      await h.page.getByLabel("New name for RAK-A1").fill("Rak A1 — lem, cat, amplas");
      const b = h.page.getByRole("button", { name: "Save name" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select name from ops_inv.stock_locations where code = 'RAK-A1'`);
      if (r !== "Rak A1 — lem, cat, amplas") throw new Error(`expected the new name, got "${r}"`);
      return "RAK-A1 berganti nama";
    },
  });

  await h.step({
    process: "inv.locations", action: "Nonaktifkan rak BENGKEL → Deactivate, lalu Reactivate", button: "Deactivate",
    act: async () => {
      const row = h.page.locator("li", { hasText: "BENGKEL" }).filter({ has: h.page.getByRole("button", { name: "Deactivate" }) });
      await row.getByRole("button", { name: "Deactivate" }).click(); await h.page.waitForTimeout(1200);
      ctx.off = sql(`select is_active from ops_inv.stock_locations where code = 'BENGKEL'`);
      await h.page.locator("li", { hasText: "BENGKEL" }).getByRole("button", { name: "Reactivate" }).click();
      await h.page.waitForTimeout(1200);
    },
    check: async () => {
      const r = sql(`select is_active from ops_inv.stock_locations where code = 'BENGKEL'`);
      if (ctx.off !== "f" || r !== "t") throw new Error(`expected off then on, got ${ctx.off} then ${r}`);
      return "BENGKEL nonaktif → aktif lagi";
    },
  });

  /* ═════ daftar barang ══════════════════════════════════════════════ */
  await h.step({
    process: "inv.register_item", action: "Register an item: 2 foto, nama katalog, nama lapangan, kategori, satuan, hitungan 12 di RAK-A1 → Register",
    button: "Register", shot: "daftar-barang",
    act: async () => {
      await h.go("/inventory/material");
      await h.page.getByRole("button", { name: "Register an item" }).first().click();
      await h.page.waitForTimeout(600);
      await h.page.locator("input[type=file][capture]").first().setInputFiles([file("klem-1.jpg"), file("klem-2.jpg")]);
      await h.page.waitForTimeout(800);
      await h.page.getByPlaceholder("Sandpaper 240").fill("F-clamp 30 cm");
      await h.page.getByPlaceholder("Amplas 240").fill("klem F 30");
      const card = h.page.locator("div", { has: h.page.getByPlaceholder("Sandpaper 240") }).last();
      const selects = h.page.locator("select").filter({ has: h.page.locator("option[value=hardware]") });
      await selects.first().selectOption("hardware");
      await h.page.locator("select").filter({ has: h.page.locator("option[value=pcs]") }).first().selectOption("pcs");
      await h.page.getByLabel("Location").last().selectOption("RAK-A1");
      await card.page().locator("input[inputmode]").last().fill("12");
      const b = h.page.getByRole("button", { name: "Register", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(3000);
    },
    check: async () => {
      const r = sql(`select i.code || '|' || coalesce(i.name_local,'-') || '|' || (select count(*) from ops_core.attachment_links l
                       where l.entity = 'item' and l.entity_no = i.code and l.kind = 'foto' and l.unlinked_at is null)
                       from ops_procure.items i where i.name = 'F-clamp 30 cm'`);
      const [code, local, photos] = r.split("|");
      ctx.item = code;
      if (!code || photos !== "2" || local !== "klem F 30") throw new Error(`expected the clamp with its floor name and 2 photos, got "${r}"`);
      const q = onHand(code, "RAK-A1");
      if (q !== 12) throw new Error(`expected 12 counted on RAK-A1, got ${q}`);
      return `${code} · 2 foto · 12 di RAK-A1 (penyesuaian opname)`;
    },
  });

  await h.step({
    process: "inv.register_item", action: "Nama lapangan barang katalog: buka Sandpaper 240 → Edit → amplas 240 → Save", button: "Save",
    act: async () => {
      /* Not entered on the rack yet, so not in the list (D348): opened by its
         code, the way a label's QR opens it. */
      await h.go("/inventory/material?item=I-E2E02");
      await h.page.waitForTimeout(1200);
      await h.page.getByRole("button", { name: "Edit" }).first().click();
      await h.page.getByPlaceholder("e.g. amplas 240").fill("amplas 240");
      const b = h.page.getByRole("button", { name: "Save", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1500);
    },
    check: async () => {
      const r = sql(`select name_local from ops_procure.items where code = 'I-E2E02'`);
      if (r !== "amplas 240") throw new Error(`expected amplas 240, got "${r}"`);
      return "Sandpaper 240 = amplas 240";
    },
  });

  /* ═════ penerimaan (procurement menandatangani) ════════════════════ */
  await h.signIn("Andi");
  await h.step({
    process: "inv.receipt_stock", action: "Tracker → vendor → Record arrival: 20 kg, foto + surat jalan → Record what arrived",
    button: "Record what arrived", shot: "penerimaan",
    act: async () => {
      await h.go("/procurement/tracker");
      await h.page.locator("tbody tr", { hasText: "CV LEM SIMULASI" }).first().click();
      await h.page.waitForURL(/\/procurement\/tracker\/.+/); await h.page.waitForTimeout(1500);
      await h.page.getByRole("button", { name: "Record arrival" }).first().click();
      await h.page.waitForTimeout(600);
      await h.page.fill("#rc-qty", "20");
      const photo = h.page.locator("input[type=file][capture]").last();
      await photo.setInputFiles(file("foto-lem.jpg"));
      await h.page.waitForTimeout(1200);
      await photo.locator("xpath=following::input[@type='file'][1]").setInputFiles(file("surat-jalan-lem.jpg"));
      await h.page.waitForTimeout(1200);
      const b = h.page.getByRole("button", { name: /Record what arrived/ });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select status || ' ' || qty_received || ' ' || receipt_no from ops_procure.receipts order by received_at desc limit 1`);
      if (!/^CONFIRMED 20 /.test(r)) throw new Error(`expected a confirmed receipt of 20, got "${r}"`);
      const q = onHand("I-E2E01", "BENGKEL");
      if (q !== 20) throw new Error(`receipt ${r.split(" ")[2]} signed, but the glue on BENGKEL is ${q}, not 20`);
      return `${r.split(" ")[2]} CONFIRMED · lem +20 kg di BENGKEL`;
    },
  });

  /* ═════ pemakaian ══════════════════════════════════════════════════ */
  await h.signIn("Dewi");
  ctx.jo = sql(`select wo_no from ops_prod.work_orders where project_line_id = 'e2e00000-0000-0000-0000-00000000c101'`);
  const openItem = async (name) => {
    await h.go("/inventory/material");
    await h.page.locator("tr", { hasText: name }).first().click();
    await h.page.waitForTimeout(1500);
  };

  await h.step({
    process: "inv.material_moves", action: "Lem kayu → Issue 6 kg untuk Job Order → Record", button: "Record", shot: "keluar",
    act: async () => {
      await openItem("Wood glue PVAc");
      await h.page.getByRole("button", { name: "Issue", exact: true }).click();
      const drawer = h.page.locator("div", { has: h.page.getByPlaceholder("Job Order number (optional)") }).last();
      await drawer.locator("input[inputmode]").first().fill("6");
      await h.page.getByPlaceholder("Job Order number (optional)").fill(ctx.jo);
      await h.page.getByPlaceholder("What for — read in the history next month").fill("lem rangka kursi");
      const b = h.page.getByRole("button", { name: "Record", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select location || ' ' || qty || ' ' || coalesce(ref_no,'-') from ops_inv.stock_moves where item_code = 'I-E2E01' and kind = 'issue'`);
      if (r !== `BENGKEL -6 ${ctx.jo}`) throw new Error(`expected -6 from BENGKEL for ${ctx.jo}, got "${r}"`);
      return `BENGKEL ${onHand("I-E2E01", "BENGKEL")} kg · ${ctx.jo}`;
    },
  });

  await h.step({
    process: "inv.material_moves", action: "Lem kayu → Move location 4 kg BENGKEL → RAK-A1 → Record", button: "Move location",
    act: async () => {
      await openItem("Wood glue PVAc");
      await h.page.getByRole("button", { name: "Move location" }).click();
      const drawer = h.page.locator("div", { has: h.page.getByLabel("To location") }).last();
      await drawer.locator("input[inputmode]").first().fill("4");
      await h.page.getByLabel("From location").selectOption("BENGKEL");
      await h.page.getByLabel("To location").selectOption("RAK-A1");
      const b = h.page.getByRole("button", { name: "Record", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const a = onHand("I-E2E01", "BENGKEL"), c = onHand("I-E2E01", "RAK-A1");
      if (a !== 10 || c !== 4) throw new Error(`expected BENGKEL 10 · RAK-A1 4, got ${a} · ${c}`);
      return "BENGKEL 10 · RAK-A1 4";
    },
  });

  /* ═════ opname ═════════════════════════════════════════════════════ */
  await h.step({
    process: "inv.opname", action: "Opname: lem di BENGKEL dihitung 9 → alasan → Record difference", button: "Record difference", shot: "opname",
    act: async () => {
      await h.go("/inventory/penyesuaian");
      await h.page.getByLabel("Item").selectOption("I-E2E01");
      await h.page.getByLabel("Location").last().selectOption("BENGKEL");
      const form = h.page.locator("div", { has: h.page.getByLabel("Item") }).last();
      await form.locator("input[inputmode]").first().fill("9");
      await h.page.getByPlaceholder("Reason — why it differs, or what you suspect").fill("satu kaleng bocor, dibuang");
      const b = h.page.getByRole("button", { name: "Record difference" });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select qty || ' ' || reason from ops_inv.stock_moves where item_code = 'I-E2E01' and kind = 'adjust'`);
      if (r !== "-1 satu kaleng bocor, dibuang") throw new Error(`expected a -1 adjustment with its reason, got "${r}"`);
      return "selisih -1 · BENGKEL 9 kg";
    },
  });

  /* ═════ barang jadi ════════════════════════════════════════════════ */
  await h.step({
    process: "inv.finished_goods", action: "Record a finished-goods move → Production output: Job Order, FINISHING, 12 → Save", button: "Production output", shot: "barang-jadi",
    act: async () => {
      await h.go("/inventory/produk");
      await h.page.getByRole("button", { name: "Record a finished-goods move" }).click();
      await h.page.getByRole("button", { name: "Production output" }).click();
      await h.page.getByLabel("Job Order").selectOption(ctx.jo);
      await h.page.getByLabel("Location").first().selectOption("FINISHING");
      const form = h.page.locator("div", { has: h.page.getByLabel("Job Order") }).last();
      await form.locator("input[inputmode]").first().fill("12");
      const b = h.page.getByRole("button", { name: "Save", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select location || ' ' || qty || ' ' || project_line_id from ops_inv.product_moves where kind = 'produced'`);
      if (r !== "FINISHING 12 e2e00000-0000-0000-0000-00000000c101") throw new Error(`expected 12 on FINISHING for the JO's order line, got "${r}"`);
      return "12 kursi di FINISHING, pesanan diambil dari JO";
    },
  });

  await h.step({
    process: "inv.finished_goods", action: "Move location: 12 kursi FINISHING → GUDANG (lokasi rumah) sebelum dikirim", button: "Move location",
    act: async () => {
      await h.page.getByRole("button", { name: "Record a finished-goods move" }).click().catch(() => {});
      await h.page.getByRole("button", { name: "Move location" }).click();
      await h.page.getByLabel("Product").selectOption("E2E-CHR");
      const batch = h.page.getByLabel("Batch");
      const opt = await batch.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      await batch.selectOption(opt[0]);
      await h.page.getByLabel("Location").first().selectOption("FINISHING");
      await h.page.getByLabel("To location").selectOption("GUDANG");
      const form = h.page.locator("div", { has: h.page.getByLabel("Product") }).last();
      await form.locator("input[inputmode]").first().fill("12");
      const b = h.page.getByRole("button", { name: "Save", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select string_agg(location || ' ' || s, ', ' order by location) from
                       (select location, sum(qty) s from ops_inv.product_moves group by 1 having sum(qty) <> 0) x`);
      if (r !== "GUDANG 12") throw new Error(`expected all 12 in GUDANG, got "${r}"`);
      return "GUDANG 12";
    },
  });

  await h.signIn("Joko");
  await h.step({
    process: "inv.finished_goods", action: "(Pengiriman) Ready to ship → Create delivery note → 10 → Dispatch 10", button: "Create delivery note", shot: "surat-jalan",
    act: async () => {
      await h.go("/proyek/pengiriman");
      await h.page.getByRole("button", { name: "Create delivery note" }).first().click();
      await h.page.waitForTimeout(800);
      await h.page.locator("li", { hasText: "Kursi makan" }).locator("input").first().fill("10");
      await h.page.getByRole("button", { name: /^Dispatch 10/ }).click();
      await h.page.waitForTimeout(2000);
    },
    check: async () => {
      const d = sql(`select delivery_no from ops_dlv.deliveries order by created_at desc limit 1`);
      if (!d) throw new Error("no delivery note written");
      /* The rack reads the surat jalan; ask it as the gudang would, through the seam. */
      const s = sql(`set role authenticated; select set_config('request.jwt.claim.sub','e2e00000-0000-0000-0000-0000000000d1',true);
                     select (x->>'shipped') || ' ' || (x->>'on_hand') || ' ' || (x->'by_location')::text
                       from jsonb_array_elements((ops_inv.product_stock('E2E-CHR'))->'data') x`).split("\n").pop();
      if (s !== '10 2 {"GUDANG": 2}') throw new Error(`expected 10 shipped, 2 on GUDANG, got "${s}"`);
      return `${d} · rak barang jadi: terkirim 10, sisa 2 di GUDANG`;
    },
  });

  /* ═════ aset ═══════════════════════════════════════════════════════ */
  await h.signIn("Dewi");
  await h.step({
    process: "inv.assets", action: "Register asset: nama, kategori, nomor seri, lokasi, pemegang → Save", button: "Register asset", shot: "aset",
    act: async () => {
      await h.go("/inventory/assets");
      await h.page.getByRole("button", { name: "Register asset" }).click();
      await h.page.fill("#as-name", "Mesin amplas Makita 9403");
      await h.page.selectOption("#as-cat", "tool");
      await h.page.fill("#as-ident", "SN-9403-77");
      await h.page.fill("#as-brand", "Makita");
      await h.page.fill("#as-model", "9403");
      await h.page.selectOption("#as-loc", "BENGKEL");
      await h.page.fill("#as-holder", "Pak Wayan");
      const b = h.page.getByRole("button", { name: "Save", exact: true });
      await h.mark(b); await b.click(); await h.page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select asset_no || ' ' || status || ' ' || ownership from ops_inv.assets where name = 'Mesin amplas Makita 9403'`);
      if (!/ in_use owned$/.test(r)) throw new Error(`expected an owned asset in use, got "${r}"`);
      return r;
    },
  });

  /* ═════ pembaca ════════════════════════════════════════════════════ */
  await h.signIn("Lina");
  await h.step({
    process: "inv.opname", action: "Pembaca membuka Opname: tidak ada Record difference dan tidak ada kelola lokasi",
    act: async () => { await h.go("/inventory/penyesuaian"); },
    check: async () => {
      for (const name of ["Record difference", "Add location"]) {
        if (await h.page.getByRole("button", { name }).count()) throw new Error(`a reader is offered "${name}"`);
      }
      return "hanya riwayat penyesuaian";
    },
  });
} finally {
  await h.finish();
}
