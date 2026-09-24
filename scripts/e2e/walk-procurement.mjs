#!/usr/bin/env node
/** The procurement walk, through the screens, in live mode.
 *
 *  `supabase/local/smoke/99_sim_procure_to_ledger.sql` walks the same week in
 *  SQL and proves the seams. This walks it in a browser, pressing the buttons
 *  people press, against the same seams through PostgREST — because B5 was a
 *  bug in what the *screen* sent, and SQL that calls the seam the way its
 *  author expects cannot find that kind of bug.
 *
 *  Every step is written to `docs/sop/procurement/walk.json` — actor, screen,
 *  the button pressed, and the status the database read back afterwards — with
 *  a screenshot beside it. `scripts/sop/check-knowledge.mjs` compares that
 *  record against John Lau's process knowledge (`ops_asst.process_steps`), so
 *  a screen that changes without its guide changing fails CI instead of
 *  misleading somebody.
 *
 *  ## Running it
 *
 *    supabase/local/rebuild.sh && psql … -f scripts/e2e/seed-procurement.sql
 *    POSTGREST_BIN=… node scripts/e2e/local-stack.mjs &          # prints the env
 *    NEXT_PUBLIC_USE_SUPABASE=1 NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… npx next dev -p 3200 &
 *    NODE_PATH=<playwright-core install>/node_modules node scripts/e2e/walk-procurement.mjs
 *
 *  `playwright-core` is not a dependency of this repository, on purpose (07);
 *  Chromium comes from CHROME or the pre-installed Playwright browser.
 *
 *  ## The one thing not real
 *
 *  `/api/documents/upload` puts the bytes in Google Drive, which is not here.
 *  The walk intercepts that request and does the route's database half itself
 *  — `ops_core.attach_file` through PostgREST, **as the signed-in person** —
 *  and answers with the route's own envelope. Everything after the Drive hop
 *  is the real thing.
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url);
const { chromium } = require("playwright-core");

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const APP = process.env.APP_URL ?? "http://localhost:3200";
const STACK = process.env.STACK_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-only-secret-not-for-anything-real";
const OUT = join(ROOT, "docs/sop/procurement");
const SHOTS = process.env.SHOTS !== "0";
mkdirSync(OUT, { recursive: true });

const PEOPLE = {
  Andi: { email: "andi@talaliving.com", id: "e2e00000-0000-0000-0000-00000000a11d" },
  Evin: { email: "evin@talaliving.com", id: "e2e00000-0000-0000-0000-00000000ce00" },
  Rina: { email: "rina@talaliving.com", id: "e2e00000-0000-0000-0000-00000000f11a" },
};

/* ── the database, read as its owner, for assertions only ─────────────── */
const sql = (q) => execFileSync("psql", ["-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5433",
  "-U", "postgres", "-Atc", q], { encoding: "utf8" }).trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwtFor(person) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ sub: person.id, email: person.email, role: "authenticated", aud: "authenticated", exp: 4102444800 });
  return `${h}.${b}.${createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url")}`;
}

/* ── the record ───────────────────────────────────────────────────────── */
const walk = [];
let current = null;
const failures = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
let ctx, page;

async function signIn(name) {
  if (ctx) await ctx.close();
  current = name;
  ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1.5 });
  page = await ctx.newPage();
  page.on("pageerror", (e) => failures.push(`${name}: page error ${e.message}`));
  await page.route("**/api/documents/upload", async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const filename = /filename="([^"]+)"/.exec(body)?.[1] ?? "file.jpg";
    const res = await fetch(`${STACK}/rest/v1/rpc/attach_file`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-profile": "ops_core",
        authorization: `Bearer ${jwtFor(PEOPLE[current])}`, apikey: "e2e" },
      body: JSON.stringify({ p_storage_path: `e2e/${Date.now()}-${filename}`, p_filename: filename,
        p_mime: "image/jpeg", p_bytes: 1000, p_sha256: null, p_source: "web", p_key: null }),
    });
    const env = await res.json();
    if (env.outcome !== "ok") return route.fulfill({ status: 422, json: { error: env.error } });
    return route.fulfill({ status: 200, json: {
      data: { attachment_id: env.data.attachment_id, drive_file_id: "e2e", web_view_link: null, filed_in: "e2e", sha256: null },
      meta: { request_id: "", service: "documents", version: "1", outcome: "ok" } } });
  });
  await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
  await page.fill("input[type=email]", PEOPLE[name].email);
  await page.fill("input[type=password]", "e2e");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
}

async function go(path) {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

async function mark(loc) {
  await loc.first().scrollIntoViewIfNeeded().catch(() => {});
  await loc.first().evaluate((el) => { el.style.outline = "3px solid #e11d48"; el.style.outlineOffset = "3px"; }).catch(() => {});
}

/** The body text after an action, so a refusal toast is readable in the log. */
async function said(pattern) {
  const t = await page.innerText("body");
  return (t.match(pattern) ?? [null])[0];
}

/**
 * One thing one person did. `act` presses the buttons; `check` reads the
 * database and returns the status to record, or throws.
 */
async function step({ process: proc, action, button, shot, act, check }) {
  const entry = { n: walk.length + 1, process: proc, actor: current, action, button: button ?? null, route: null, status: null, shot: null, ok: false, note: null };
  try {
    await act();
    await page.waitForTimeout(700);
    entry.route = new URL(page.url()).pathname;
    entry.status = check ? await check() : null;
    entry.ok = true;
  } catch (e) {
    entry.note = String(e.message).split("\n")[0];
    failures.push(`${entry.n} ${action}: ${entry.note}`);
    /* What was on screen, so the next attempt knows which button exists. */
    const buttons = await page.getByRole("button").allInnerTexts().catch(() => []);
    console.log("   visible buttons:", buttons.map((b) => b.trim()).filter(Boolean).slice(0, 40).join(" | "));
    console.log("   toast:", (await said(/(Not [a-z]+|Tidak [a-z]+)[\s\S]{0,300}/))?.replace(/\n/g, " / "));
  }
  if (SHOTS && shot) {
    entry.shot = `walk-${String(entry.n).padStart(2, "0")}-${shot}.jpg`;
    await page.screenshot({ path: join(OUT, entry.shot), type: "jpeg", quality: 75 }).catch(() => {});
  }
  walk.push(entry);
  console.log(`${entry.ok ? "ok  " : "FAIL"} ${String(entry.n).padStart(2)} ${current.padEnd(4)} ${action}${entry.status ? `  → ${entry.status}` : ""}${entry.note ? `  (${entry.note})` : ""}`);
  if (!entry.ok && process.env.STOP_ON_FAIL !== "0") throw new Error(`stopped at step ${entry.n}`);
}

const ctx_ = {};

/* A one-pixel JPEG, as the file somebody photographs. Only its name reaches
   the database; the bytes stop at the intercepted Drive hop. */
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const file = (name) => ({ name, mimeType: "image/jpeg", buffer: JPEG });

try {
  /* ═════ PR ═════════════════════════════════════════════════════════ */
  await signIn("Andi");

  await step({
    process: "procure.create_pr", action: "Isi PR dua baris: plywood dan ongkir", button: null, shot: "pr-new",
    act: async () => {
      await go("/procurement/pr/new");
      await page.selectOption("#pr-project", { label: /25777/ }).catch(async () => {
        const opt = await page.locator("#pr-project option", { hasText: "25777" }).first().getAttribute("value");
        await page.selectOption("#pr-project", opt);
      });
      await page.fill("#desc-l1", "Plywood 18mm — meja lobi");
      await page.fill("#qty-l1", "10");
      await page.selectOption("#uom-l1", "lembar");
      await page.fill("#price-l1", "150000");
      await page.fill("#purpose-l1", "Meja lobi hotel");
      await page.getByPlaceholder("Search vendors…").first().click();
      await page.getByPlaceholder("Search vendors…").first().fill("SIMULASI");
      await page.getByRole("button", { name: /CV SIMULASI KAYU/ }).first().click();
      await page.getByRole("button", { name: "Add another line" }).click();
      await page.fill("#desc-l2", "Ongkos kirim ke hotel");
      await page.fill("#qty-l2", "1");
      await page.selectOption("#uom-l2", "lot");
      await page.fill("#price-l2", "300000");
      await page.fill("#purpose-l2", "Kirim plywood ke lokasi");
      await mark(page.getByRole("button", { name: "Submit for approval" }));
    },
  });

  await step({
    process: "procure.create_pr", action: "Tekan Submit for approval", button: "Submit for approval", shot: "pr-submitted",
    act: async () => {
      await page.getByRole("button", { name: "Submit for approval" }).click();
      await page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select d.doc_no || ' ' || d.status || ' · ' || count(l.*) || ' baris'
                       from ops_procure.pr_documents d join ops_procure.pr_lines l on l.doc_id = d.id
                      group by d.doc_no, d.status, d.created_at order by d.created_at desc limit 1`);
      if (!/SUBMITTED · 2 baris/.test(r)) throw new Error(`expected a submitted request with 2 lines, got "${r}"`);
      ctx_.doc = r.split(" ")[0];
      return `PR: ${r}`;
    },
  });

  await step({
    process: "procure.create_pr", action: "Buka baris L01, tempel link penawaran", button: "Paste a link", shot: "pr-quote",
    act: async () => {
      await go("/procurement/pr");
      await page.getByText(`${ctx_.doc}-L01`).first().click();
      await page.waitForTimeout(1200);
      const kind = page.locator("select").filter({ has: page.locator("option", { hasText: "Reference Link" }) }).last();
      await kind.selectOption("Reference Link");
      await page.getByRole("button", { name: "Paste a link" }).last().click();
      await page.waitForTimeout(400);
      const url = page.getByPlaceholder(/the page the price came from/).last();
      await url.fill("https://toko.example/plywood-18");
      await mark(url);
      await url.press("Enter");
      await page.waitForTimeout(1500);
    },
    check: async () => {
      const n = sql(`select count(*) from ops_core.attachment_links where entity = 'pr_line' and entity_no = '${ctx_.doc}-L01' and unlinked_at is null`);
      if (n === "0") throw new Error("no document linked to L01");
      return `${n} bukti harga di L01`;
    },
  });

  await step({
    process: "procure.create_pr", action: "Tempel link penawaran di baris L02 juga", button: "Paste a link",
    act: async () => {
      await go("/procurement/pr");
      await page.getByText(`${ctx_.doc}-L02`).first().click();
      await page.waitForTimeout(1200);
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Reference Link" }) }).last().selectOption("Reference Link");
      await page.getByRole("button", { name: "Paste a link" }).last().click();
      const url = page.getByPlaceholder(/the page the price came from/).last();
      await url.fill("https://chat.example/ongkir");
      await url.press("Enter");
      await page.waitForTimeout(1500);
    },
    check: async () => {
      const n = sql(`select count(*) from ops_core.attachment_links where entity = 'pr_line' and entity_no = '${ctx_.doc}-L02' and unlinked_at is null`);
      if (n === "0") throw new Error("no document linked to L02");
      return `${n} bukti harga di L02`;
    },
  });

  /* ═════ Persetujuan barang ═════════════════════════════════════════ */
  await signIn("Andi");
  await step({
    process: "procure.approve_goods", action: "Staf mencoba menyetujui: tombol persetujuan tidak ada", shot: "meeting-staff",
    act: async () => { await go("/procurement/meeting"); },
    check: async () => {
      const n = await page.getByRole("button", { name: /^Approve/ }).count();
      if (n > 0) throw new Error(`staff sees ${n} approve button(s)`);
      return "tidak ada tombol Approve untuk staf";
    },
  });

  await signIn("Evin");
  await step({
    process: "procure.approve_goods", action: "Pimpinan mencentang kedua baris lalu menyetujui", button: "Approve N · Rp…", shot: "meeting-approve",
    act: async () => {
      await go("/procurement/meeting");
      for (const n of ["L01", "L02"]) {
        const row = page.locator("tr", { hasText: `${ctx_.doc}-${n}` }).first();
        await row.locator("input[type=checkbox]").first().check();
      }
      const approve = page.getByRole("button", { name: /^Approve \d/ }).first();
      await mark(approve);
      await approve.click();
      await page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select string_agg(right(line_no_full,3) || ':' || status, ' ') from ops_procure.v_pr_line_status where line_no_full like '${ctx_.doc}-%'`);
      if (!/L01:APPROVED/.test(r) || !/L02:APPROVED/.test(r)) throw new Error(`expected both approved, got ${r}`);
      return r;
    },
  });

  /* ═════ PO — road two: staff write it, leadership confirm ═══════════ */
  async function newPo(lineNo, dp) {
    await go("/procurement/po");
    await page.getByRole("button", { name: "Add new PO" }).click();
    await page.waitForTimeout(800);
    await page.getByPlaceholder("Search suppliers…").click();
    await page.getByPlaceholder("Search suppliers…").fill("SIMULASI");
    await page.getByRole("button", { name: /CV SIMULASI KAYU/ }).first().click();
    await page.waitForTimeout(600);
    await page.selectOption("#po-pr-0", lineNo);
    if (dp) await page.fill("#po-dp", String(dp));
    await mark(page.locator("#po-pr-0"));
  }
  const lastPo = () => sql(`select po_no || ' ' || status || ' ' || (approved_at is not null)::int || ' ' || self_confirmed::int from ops_procure.purchase_orders order by created_at desc limit 1`);

  await signIn("Andi");
  await step({
    process: "procure.create_po", action: "Add new PO → pilih baris L01 di \"From request line\", DP 30%", button: "Add new PO", shot: "po-new",
    act: async () => { await newPo(`${ctx_.doc}-L01`, 30); },
    check: async () => {
      const v = await page.inputValue("#po-desc-0");
      if (!/Plywood/.test(v)) throw new Error(`line not filled from the request, got "${v}"`);
      return `terisi dari ${ctx_.doc}-L01: ${v}`;
    },
  });
  await step({
    process: "procure.create_po", action: "Tekan Create the draft", button: "Create the draft",
    act: async () => { await page.getByRole("button", { name: /Create the draft/ }).click(); await page.waitForTimeout(2000); },
    check: async () => {
      const r = lastPo();
      const [po, st, approved] = r.split(" ");
      if (st !== "DRAFT" || approved !== "0") throw new Error(`expected an unconfirmed draft, got ${r}`);
      if (sql(`select ops_procure.order_of_line('${ctx_.doc}-L01')`) !== po) throw new Error("line not linked to the order");
      ctx_.po = po;
      return `PO: ${po} DRAFT, belum dikonfirmasi, tersambung ke L01`;
    },
  });
  await step({
    process: "procure.create_po", action: "Issue sebelum dikonfirmasi: tombolnya tidak ada", shot: "po-draft-staff",
    act: async () => { await go(`/procurement/po/${ctx_.po}`); },
    check: async () => {
      if (await page.getByRole("button", { name: /Issue and send it/ }).count()) throw new Error("staff can issue an unconfirmed order");
      if (await page.getByText(/Changed since it was sent/).count()) throw new Error("a draft that was never sent says it changed since it was sent (B12)");
      return "hanya Ask leadership to confirm";
    },
  });
  await step({
    process: "procure.create_po", action: "Tekan Ask leadership to confirm", button: "Ask leadership to confirm", shot: "po-asked",
    act: async () => {
      const ask = page.getByRole("button", { name: /Ask leadership to confirm/ }).first();
      await ask.click(); await page.waitForTimeout(800);
      const send = page.getByRole("button", { name: /^(Send|Kirim|Ask)/ }).last();
      if (await send.isVisible().catch(() => false)) { await send.click(); }
      await page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select approval_sent_to || ' ' || (approval_token is not null)::int from ops_procure.purchase_orders where po_no = '${ctx_.po}'`);
      if (!/^evin@talaliving.com 1/.test(r)) throw new Error(`expected a card addressed to Evin, got "${r}"`);
      const ev = sql(`select count(*) from ops_core.outbox where event_type = 'procurement.po.approval_requested' and entity_no = '${ctx_.po}'`);
      return `kartu untuk evin@talaliving.com, event ke Chat: ${ev}`;
    },
  });

  await signIn("Evin");
  await step({
    process: "procure.create_po", action: "Pimpinan membuka PO dan menekan Confirm it", button: "Confirm it", shot: "po-confirm",
    act: async () => {
      await go(`/procurement/po/${ctx_.po}`);
      const c = page.getByRole("button", { name: /^Confirm it/ }).first();
      await mark(c); await c.click(); await page.waitForTimeout(800);
      const again = page.getByRole("button", { name: /^Confirm/ }).last();
      if (await again.isVisible().catch(() => false)) await again.click().catch(() => {});
      await page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select (approved_at is not null)::int || ' ' || self_confirmed::int || ' ' || coalesce((select email from ops_core.users where id = approved_by),'-') from ops_procure.purchase_orders where po_no = '${ctx_.po}'`);
      if (r !== "1 0 evin@talaliving.com") throw new Error(`expected confirmed by Evin, not self, got "${r}"`);
      return "dikonfirmasi oleh evin@talaliving.com (bukan dikonfirmasi sendiri)";
    },
  });

  /* ═════ PO — road one: leadership write their own ═══════════════════ */
  await step({
    process: "procure.create_po", action: "Pimpinan membuat PO sendiri untuk baris L02", button: "Create the draft", shot: "po-self",
    act: async () => {
      await newPo(`${ctx_.doc}-L02`, 0);
      await page.getByRole("button", { name: /Create the draft/ }).click();
      await page.waitForTimeout(2000);
    },
    check: async () => {
      const [po, st, approved, self] = lastPo().split(" ");
      if (st !== "DRAFT" || approved !== "1" || self !== "1") throw new Error(`expected self-confirmed draft, got ${po} ${st} ${approved} ${self}`);
      ctx_.po2 = po;
      const toast = await said(/dibuat dan dikonfirmasi[^\n]*/);
      return `PO: ${po} dikonfirmasi saat dibuat${toast ? ` — toast: "${toast}"` : ""}`;
    },
  });

  await signIn("Andi");
  await step({
    process: "procure.create_po", action: "Tekan Issue and send it", button: "Issue and send it", shot: "po-issued",
    act: async () => {
      await go(`/procurement/po/${ctx_.po}`);
      const b = page.getByRole("button", { name: /Issue and send it/ }).first();
      await mark(b); await b.click(); await page.waitForTimeout(800);
      const again = page.getByRole("button", { name: /^Issue/ }).last();
      if (await again.isVisible().catch(() => false)) await again.click().catch(() => {});
      await page.waitForTimeout(1800);
    },
    check: async () => {
      const r = sql(`select status || ' ' || payable_now from ops_procure.v_po_detail where po_no = '${ctx_.po}'`);
      if (r !== "ISSUED 450000") throw new Error(`expected ISSUED with 450000 payable, got "${r}"`);
      return "PO: ISSUED · payable now 450.000 (DP 30%)";
    },
  });

  /* ═════ Penerimaan ═════════════════════════════════════════════════ */
  await step({
    process: "procure.receive_goods", action: "Tracker → vendor → Record arrival: 10 lembar, foto + tanda terima", button: "Record what arrived", shot: "receive",
    act: async () => {
      await go("/procurement/tracker");
      await page.locator("tbody tr", { hasText: "CV SIMULASI KAYU" }).first().click();
      await page.waitForURL(/\/procurement\/tracker\/.+/); await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Record arrival" }).first().click();
      await page.waitForTimeout(600);
      await page.fill("#rc-qty", "10");
      const photo = page.locator("input[type=file][capture]").last();
      await photo.setInputFiles(file("foto-plywood.jpg"));
      await page.waitForTimeout(1200);
      await photo.locator("xpath=following::input[@type='file'][1]").setInputFiles(file("tanda-terima.jpg"));
      await page.waitForTimeout(1200);
      const rec = page.getByRole("button", { name: /Record what arrived/ });
      await mark(rec); await rec.click(); await page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select status || ' ' || qty_received from ops_procure.receipts order by received_at desc limit 1`);
      if (!/^CONFIRMED 10/.test(r)) throw new Error(`expected a confirmed receipt of 10, got "${r}"`);
      const st = sql(`select status from ops_procure.v_pr_line_status where line_no_full = '${ctx_.doc}-L01'`);
      return `penerimaan: CONFIRMED 10 lembar · baris L01: ${st}`;
    },
  });

  /* ═════ Pembayaran ═════════════════════════════════════════════════ */
  await step({
    process: "acct.pay_po", action: "Staf procurement: kartu Pay this order tidak muncul",
    act: async () => { await go(`/procurement/po/${ctx_.po}`); },
    check: async () => {
      if (await page.getByText("Pay this order").count()) throw new Error("procurement sees the payment panel");
      return "tidak ada kartu pembayaran untuk staf";
    },
  });

  await signIn("Rina");
  await step({
    process: "acct.pay_po", action: "Pay this order: DP 450.000 dengan bukti transfer", button: "Post Rp… to the ledger", shot: "pay-po",
    act: async () => {
      await go(`/procurement/po/${ctx_.po}`);
      await page.getByText("Pay this order").scrollIntoViewIfNeeded();
      const amt = await page.inputValue("#po-pay-amount");
      if (!/450/.test(amt)) throw new Error(`amount should start at payable now, got "${amt}"`);
      await page.locator("#po-pay-type").locator("xpath=following::input[@type='file'][1]").setInputFiles(file("bukti-dp.jpg"));
      await page.waitForTimeout(400);
      const post = page.getByRole("button", { name: /to the ledger/ }).last();
      await mark(post); await post.click(); await page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select s.payment_state || ' ' || c.covered from ops_procure.v_po_status s, ops_procure.v_line_coverage c
                      where s.po_no = '${ctx_.po}' and c.line_no_full = '${ctx_.doc}-L01'`);
      if (r !== "PARTIAL 450000") throw new Error(`expected PO PARTIAL and L01 covered 450000, got "${r}"`);
      return "PO: PARTIAL · baris L01 terbayar 450.000 (satu pembayaran, terbaca di dua sisi)";
    },
  });

  await step({
    process: "acct.pay_line", action: "Lunasi dari baris L01: Post Rp… to the ledger", button: "Post Rp… to the ledger", shot: "pay-line",
    act: async () => {
      await go("/procurement/pr");
      await page.getByText(`${ctx_.doc}-L01`).first().click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Attach the payment proof" }).last().locator("xpath=preceding::input[@type='file'][1]").setInputFiles(file("bukti-pelunasan.jpg"));
      await page.waitForTimeout(400);
      const post = page.getByRole("button", { name: /to the ledger/ }).last();
      await mark(post); await post.click(); await page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select s.payment_state || ' ' || l.status from ops_procure.v_po_status s, ops_procure.v_pr_line_status l
                      where s.po_no = '${ctx_.po}' and l.line_no_full = '${ctx_.doc}-L01'`);
      if (r !== "SETTLED COMPLETED") throw new Error(`expected PO SETTLED and L01 COMPLETED, got "${r}"`);
      return "PO: SETTLED · baris L01: COMPLETED";
    },
  });

  await step({
    process: "acct.pay_line", action: "Bayar ongkir L02 dari barisnya", button: "Post Rp… to the ledger",
    act: async () => {
      await go("/procurement/pr");
      await page.getByText(`${ctx_.doc}-L02`).first().click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Attach the payment proof" }).last().locator("xpath=preceding::input[@type='file'][1]").setInputFiles(file("bukti-ongkir.jpg"));
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /to the ledger/ }).last().click();
      await page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select status from ops_procure.v_pr_line_status where line_no_full = '${ctx_.doc}-L02'`);
      if (r !== "PAID") throw new Error(`expected L02 PAID, got "${r}"`);
      const bal = sql(`select 0 - sum(amount_idr) from ops_acct.transactions where status <> 'VOID'`);
      return `baris L02: PAID · total keluar ${Number(bal) * -1}`;
    },
  });

  await step({
    process: "acct.complete_transaction", action: "Ledger → buka transaksi pelunasan → Mark completed", button: "Mark completed", shot: "ledger-complete",
    act: async () => {
      ctx_.trx = sql(`select trx_no from ops_acct.transactions where description like '%${ctx_.doc}-L01%' order by posted_at desc limit 1`);
      await go("/accounting/ledger");
      await page.getByText(ctx_.trx).first().click();
      await page.waitForTimeout(1500);
      const b = page.getByRole("button", { name: /Mark completed/ }).first();
      await mark(b); await b.click(); await page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select status from ops_acct.transactions where trx_no = '${ctx_.trx}'`);
      if (r !== "COMPLETED") throw new Error(`expected COMPLETED, got "${r}"`);
      return `transaksi ${ctx_.trx}: COMPLETED`;
    },
  });

  /* ═════ Verifikasi ═════════════════════════════════════════════════ */
  await step({
    process: "acct.verify_evidence", action: "Nota dari Chat masuk ke kotak verifikasi, lalu Link to a row", button: "Link to a row", shot: "verifikasi",
    act: async () => {
      /* The capture worker's half: it files what arrived in Chat, as the
         service, the way `ops_acct.file_evidence` is called in production. */
      sql(`select ops_acct.file_evidence('e2e-inb-01','nota-plywood.jpg','https://drive.example/nota-plywood','chat','andi@talaliving.com')`);
      await go("/accounting/verifikasi");
      await page.getByText("nota-plywood.jpg").first().click();
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: /^Link to a row/ }).first().click();
      await page.waitForTimeout(400);
      const opt = await page.locator("#rv-trx option", { hasText: ctx_.trx }).first().getAttribute("value");
      await page.selectOption("#rv-trx", opt);
      const run = page.getByRole("button", { name: /^Link to a row$/ }).last();
      await mark(run); await run.click(); await page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select i.status || ' ' || exists (select 1 from ops_core.attachment_links k
                       where k.attachment_id = i.attachment_id and k.entity = 'transaction'
                         and k.entity_no = '${ctx_.trx}' and k.unlinked_at is null)::int
                       from ops_acct.evidence_inbox i where i.ref_id = 'e2e-inb-01'`);
      if (r !== "ATTACHED 1") throw new Error(`expected ATTACHED and filed on ${ctx_.trx}, got "${r}"`);
      return `bukti: ATTACHED ke ${ctx_.trx}`;
    },
  });

  /* ═════ Rekening koran ═════════════════════════════════════════════ */
  await step({
    process: "acct.bank_statement", action: "Upload rekening koran BCA 271 (CSV), Masukkan baris", button: "Masukkan", shot: "rk-upload",
    act: async () => {
      const d = sql(`select to_char(ops_core.office_day(), 'YYYY-MM-DD')`);
      await go("/accounting/rekening-koran");
      await page.getByRole("button", { name: "Upload" }).click();
      await page.waitForTimeout(800);
      await page.locator("select").filter({ has: page.locator("option", { hasText: "BCA 271" }) }).first()
        .selectOption({ label: /^BCA 271/ }).catch(async () => {
          const v = await page.locator("option", { hasText: "BCA 271" }).first().getAttribute("value");
          await page.locator("select").filter({ has: page.locator("option", { hasText: "BCA 271" }) }).first().selectOption(v);
        });
      await page.setInputFiles("#rk-file", { name: "rk-bca271.csv", mimeType: "text/csv",
        buffer: Buffer.from(`Tanggal,Keterangan,Debit,Kredit\n${d},TRSF KE CV SIMULASI KAYU,1050000,\n${d},BIAYA ADM,15000,\n`) });
      await page.waitForTimeout(600);
      await page.getByText("Saldo akhir (dari rekening koran)").locator("xpath=following::input[1]").fill("1000000");
      const run = page.getByRole("button", { name: /^Masukkan/ });
      await mark(run); await run.click(); await page.waitForTimeout(2500);
    },
    check: async () => {
      const r = sql(`select count(*) || ' ' || string_agg(distinct status::text, ',') from ops_acct.statement_lines`);
      if (!/^2 unmatched$/.test(r)) throw new Error(`expected 2 unmatched lines, got "${r}"`);
      return "2 baris bank masuk, status unmatched";
    },
  });

  await step({
    process: "acct.bank_statement", action: "Pilih saran di bawah \"Mirip dengan:\"", button: "Mirip dengan", shot: "rk-match",
    act: async () => {
      await go("/accounting/rekening-koran");
      await page.getByRole("button", { name: "Buka" }).first().click();
      await page.waitForTimeout(1200);
      const b = page.getByRole("button", { name: new RegExp(ctx_.trx) }).first();
      await mark(b); await b.click(); await page.waitForTimeout(2000);
    },
    check: async () => {
      const r = sql(`select status || ' ' || coalesce(trx_no,'-') from ops_acct.statement_lines where raw_description like 'TRSF%'`);
      if (r !== `matched ${ctx_.trx}`) throw new Error(`expected matched to ${ctx_.trx}, got "${r}"`);
      return `baris bank: matched ke ${ctx_.trx}`;
    },
  });
} finally {
  writeFileSync(join(OUT, "walk.json"), JSON.stringify({ at: new Date().toISOString(), steps: walk, failures }, null, 2));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exitCode = 1; }
}
