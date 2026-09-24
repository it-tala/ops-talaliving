#!/usr/bin/env node
/** John Lau with a model, walked through the live dock (D300).
 *
 *  The model is `scripts/e2e/mock-llm.mjs`, so this proves the road, not the
 *  reading: that a sentence the keyword router does not know reaches the
 *  model with the catalogue, that the model's pick goes through the same gate
 *  a keyword match does, that a read runs as the person, a closed tool is
 *  refused with the owner's sentence, a write is a draft that only a person's
 *  "Ya, tulis" turns into a row — and that a model inventing an argument or a
 *  link has it dropped. The conversation must still be there after a reload.
 *
 *  Same stack as `walk-procurement.mjs`, with the app started with
 *    ASSISTANT_LLM_PROVIDER=openai ASSISTANT_LLM_API_KEY=mock
 *    ASSISTANT_LLM_BASE_URL=http://127.0.0.1:54340
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url);
const { chromium } = require("playwright-core");
const APP = process.env.APP_URL ?? "http://localhost:3200";
const sql = (q) => execFileSync("psql", ["-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5433",
  "-U", "postgres", "-Atc", q], { encoding: "utf8" }).trim();
const lastTurnOf = (email) => sql(`select kind || '|' || coalesce(refused_because::text,'-') || '|' || array_to_string(tools_used, ',')
  || '|' || coalesce(route,'-') || '|' || jsonb_array_length(steps) || '|' || jsonb_array_length(facts)
  from ops_asst.turns t join ops_core.users u on u.id = t.actor_id where u.email = '${email}' order by at desc limit 1`);
const lastTurn = () => lastTurnOf("andi@talaliving.com");
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SHOT = process.env.SHOTS !== "0";

/* Acting as somebody inside one transaction, the way the smoke files do —
   for the steps that belong to another screen (approving on the meeting
   board), so this walk can stay in the dock. */
const as = (id, body) => sql(`begin; set local role authenticated;
  set local request.jwt.claim.sub = '${id}'; ${body}; commit;`);
const ANDI = "e2e00000-0000-0000-0000-00000000a11d", EVIN = "e2e00000-0000-0000-0000-00000000ce00";
function approveWithQuote(lineLike) {
  const line = sql(`select line_no_full from ops_procure.pr_lines where description ilike '%${lineLike}%' order by created_at desc limit 1`);
  as(ANDI, `select ops_core.attach_link((ops_core.attach_url('https://toko.example/${lineLike.replace(/\W/g, "")}', 'q')->'data'->>'attachment_id')::uuid, 'pr_line', '${line}', 'quotation')`);
  as(EVIN, `select ops_procure.approve_line('${line}', true, null, null, null, null)`);
  return line;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
const failures = [];
function expect(name, cond, got) {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : `  (got ${got})`}`);
  if (!cond) failures.push(name);
}

await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
await page.fill("input[type=email]", "andi@talaliving.com");
await page.fill("input[type=password]", "e2e");
await page.getByRole("button", { name: "Masuk" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
await page.goto(`${APP}/procurement/pr`, { waitUntil: "networkidle" });
await page.locator("[data-dock-open='john-lau']").click();

const turnCount = () => Number(sql(`select count(*) from ops_asst.turns`));
/** Types a sentence and waits until the turn is written — the dock answers
 *  when the database has recorded it, not after a fixed pause. */
async function ask(text) {
  const n = turnCount();
  const box = page.getByPlaceholder(/Tanya, atau minta|Ask, or ask/);
  await box.fill(text);
  await box.press("Enter");
  for (let i = 0; i < 30 && turnCount() === n; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(800);
}

/* Sentences the keyword router does not know (checked against ops_asst.route),
   so each one reaches the model. A sentence the router knows is answered by
   the router, which is the rule — the model is the second reader, not the first. */
await ask("supplier mana saja yang belum kita lunasi sampai sekarang?");
let t = lastTurn().split("|");
expect("data question → the model picks a read tool, run as the person",
  t[0] === "answer" && t[2] === "procurement.vendor_debt,ai.openai", t.join("|"));

await ask("Karjo dibayar berapa bulan ini?");
t = lastTurn().split("|");
expect("salary → closed tool, refused with the owner's sentence",
  t[0] === "refused" && t[1] === "closed" && t[2] === "hr.payroll,ai.openai", t.join("|"));

await ask("tolong siapkan PR untuk KSA binder 5 liter");
t = lastTurn().split("|");
expect("write → a draft, not a row", t[0] === "draft" && t[2].startsWith("procurement.draft_pr_line"), t.join("|"));
const args = sql(`select args::text from ops_asst.drafts order by created_at desc limit 1`);
expect("the model's invented vendor is dropped; what the sentence said is kept",
  !args.includes("invented_vendor") && !args.includes("Karangan") && args.includes("KSA binder"), args);
const before = sql(`select count(*) from ops_procure.pr_lines where description ilike '%KSA binder%'`);
expect("nothing written before the person says yes", before === "0", before);
await page.getByRole("button", { name: /Ya, tulis|Yes, write it/ }).last().click();
await page.waitForTimeout(2500);
const after = sql(`select count(*) || ' ' || coalesce(max(qty::text || ' ' || uom), '-') from ops_procure.pr_lines where description ilike '%KSA binder%'`);
expect("\"Ya, tulis\" writes the request line", after.startsWith("1 5"), after);

await ask("saya bingung, langkah pertama memesan barang ke supplier itu apa?");
t = lastTurn().split("|");
expect("how-to → a guide, and the invented link is dropped",
  t[0] === "guide" && t[3] === "/procurement/po"
  && sql(`select count(*) from ops_asst.turns, jsonb_array_elements(steps) s where s->>'href' = '/tidak/ada'`) === "0", t.join("|"));

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const open = await page.locator("[data-dock='john-lau']").isVisible().catch(() => false);
const kept = open ? await page.locator("[data-dock='john-lau']").innerText() : "";
expect("after a reload the dock is still open with the conversation in it",
  open && kept.includes("KSA binder") && kept.includes("Karjo"), open ? "missing turns" : "dock closed");

/* ═════ Stage 3: a purchase order through the prompt (D300) ═════════ */
const ksa = approveWithQuote("KSA binder");
await ask("buat PO untuk KSA binder 5 liter");
t = lastTurn().split("|");
const dArgs = sql(`select args::text from ops_asst.drafts order by created_at desc limit 1`);
expect("\"buat PO untuk KSA binder 5 liter\" → a PO draft filled from the approved line",
  t[0] === "draft" && t[2].startsWith("procurement.draft_po") && dArgs.includes(ksa), `${t.join("|")} ${dArgs}`);
const dock = page.locator("[data-dock='john-lau']");
const priceShown = await dock.locator("label", { hasText: /Harga satuan|Unit price/ }).last().locator("input").inputValue();
expect("a line approved without a price leaves the price blank, not zero", priceShown === "", priceShown);
/* What a person does with the draft: the vendor and price the line did not have. */
await dock.locator("label", { hasText: "Vendor" }).last().locator("input").fill("CV SIMULASI KAYU");
await dock.locator("label", { hasText: /Harga satuan|Unit price/ }).last().locator("input").fill("95000");
await dock.getByRole("button", { name: /Ya, tulis|Yes, write it/ }).last().click();
await page.waitForTimeout(3000);
const po1 = sql(`select p.po_no || '|' || p.status || '|' || (p.approved_at is not null)::int || '|' || coalesce(p.approval_sent_to::text,'-')
  || '|' || coalesce((select pl.line_no_full from ops_procure.po_lines o join ops_procure.pr_lines pl on pl.id = o.pr_line_id where o.po_id = p.id limit 1),'-')
  from ops_procure.purchase_orders p order by p.created_at desc limit 1`).split("|");
expect("staff's PO: a draft, not confirmed, sent to leadership, bought from the approved line",
  po1[1] === "DRAFT" && po1[2] === "0" && po1[3] === "evin@talaliving.com" && po1[4] === ksa, po1.join("|"));
const ref = sql(`select coalesce(produced_ref,'-') from ops_asst.drafts order by created_at desc limit 1`);
expect("and the dock says it is waiting for leadership", ref.includes(po1[0]) && /pimpinan|leadership/.test(ref), ref);

/* Leadership, through the model this time. */
as(ANDI, `select ops_procure.create_pr(jsonb_build_array(jsonb_build_object('description','Engsel sendok 35mm','qty',40,'uom','pcs','unit_price',12000,'vendor_id',(select id from ops_procure.vendors where code = 'V-E2E1'))))`);
as(ANDI, `select ops_procure.submit_pr((select d.doc_no from ops_procure.pr_documents d where d.status = 'DRAFT' order by d.created_at desc limit 1))`);
approveWithQuote("Engsel");
await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
await page.context().clearCookies();
await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch {} });
await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
await page.fill("input[type=email]", "evin@talaliving.com");
await page.fill("input[type=password]", "e2e");
await page.getByRole("button", { name: "Masuk" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
await page.goto(`${APP}/procurement/po`, { waitUntil: "networkidle" });
await page.locator("[data-dock-open='john-lau']").click().catch(() => {});
await ask("tolong pesankan engsel ke supplier");
const eArgs = sql(`select args::text from ops_asst.drafts order by created_at desc limit 1`);
expect("the model's invented price and vendor lose to the approved line",
  eArgs.includes("12000") && !eArgs.includes("Karangan") && eArgs.includes("CV SIMULASI KAYU"), eArgs);
await page.locator("[data-dock='john-lau']").getByRole("button", { name: /Ya, tulis|Yes, write it/ }).last().click();
await page.waitForTimeout(3000);
const po2 = sql(`select status || '|' || (approved_at is not null)::int || '|' || self_confirmed::int || '|' || coalesce(approval_sent_to::text,'-')
  from ops_procure.purchase_orders order by created_at desc limit 1`);
expect("leadership's PO: confirmed on creation, no card to themselves", po2 === "DRAFT|1|1|-", po2);

/* ═════ Stage 4: HR — a leave request through the prompt (D301) ═════ */
/* Evin holds hrd read only, so the gate refuses the draft for him — the same
   answer the screen's missing "Ajukan" gives. Sari, who files leave on the
   screen, gets the draft. The people come from seed-hr.sql and the HR walk. */
/* Wulan, if the HR walk has not run on this database. */
sql(`insert into ops_hr.employees (employee_no, full_name, unit, pay_basis, base_rate, allowance_rate, paid_leave_days)
     select 'B-0102','Wulan Sari','Kantor','monthly',4500000,25000,12
      where not exists (select 1 from ops_hr.employees where employee_no = 'B-0102')`);
await ask("ajukan cuti untuk Wulan 2 sampai 3 Oktober, acara keluarga");
t = lastTurnOf("evin@talaliving.com").split("|");
expect("a reader of HR cannot draft a leave request", t[0] === "refused" && t[2].startsWith("hr.draft_leave"), t.join("|"));

await page.context().clearCookies();
await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch {} });
await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
await page.fill("input[type=email]", "sari@talaliving.com");
await page.fill("input[type=password]", "e2e");
await page.getByRole("button", { name: "Masuk" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
await page.goto(`${APP}/hrd/cuti`, { waitUntil: "networkidle" });
await page.locator("[data-dock-open='john-lau']").click().catch(() => {});

const year = new Date(Date.now() + 8 * 3_600_000).getUTCFullYear();
const before2 = sql(`select count(*) from ops_hr.leave_requests`);
await ask("ajukan cuti untuk Wulan 2 sampai 3 Oktober, acara keluarga");
t = lastTurnOf("sari@talaliving.com").split("|");
const lArgs = sql(`select args::text from ops_asst.drafts order by created_at desc limit 1`);
expect("\"ajukan cuti untuk Wulan …\" → a leave draft with the person, the dates and the reason read from the sentence",
  t[0] === "draft" && t[2] === "hr.draft_leave" && lArgs.includes("B-0102") && lArgs.includes("-10-02") && lArgs.includes("-10-03")
  && lArgs.includes("acara keluarga"), `${t.join("|")} ${lArgs}`);
expect("nothing filed before the person says yes", sql(`select count(*) from ops_hr.leave_requests`) === before2, before2);
if (SHOT) await page.screenshot({ path: `${ROOT}/docs/sop/hr/11-john-lau-cuti.jpg`, type: "jpeg", quality: 75 });
await page.locator("[data-dock='john-lau']").getByRole("button", { name: /Ya, tulis|Yes, write it/ }).last().click();
await page.waitForTimeout(2500);
const filed = sql(`select r.status || ' ' || e.employee_no || ' ' || r.from_date || ' ' || r.to_date from ops_hr.leave_requests r
                    join ops_hr.employees e on e.id = r.employee_id order by r.requested_at desc limit 1`);
expect("\"Ya, tulis\" files it PENDING, as Sari, through request_leave",
  filed === `PENDING B-0102 ${year}-10-02 ${year}-10-03` || filed === `PENDING B-0102 ${year + 1}-10-02 ${year + 1}-10-03`, filed);

await ask("tolong catat Wulan libur, dia menikah");
t = lastTurnOf("sari@talaliving.com").split("|");
const mArgs = sql(`select args::text from ops_asst.drafts order by created_at desc limit 1`);
expect("a sentence the router does not know → the model picks the leave draft; its invented field and malformed date are dropped",
  t[0] === "draft" && t[2] === "hr.draft_leave,ai.openai" && mArgs.includes("B-0102") && !mArgs.includes("4500000")
  && !mArgs.includes("minggu depan") && !mArgs.includes("invented"), `${t.join("|")} ${mArgs}`);

/* ═════ Production (F156): the two reads that answered "not built" ════ */
/* Wayan (production write, project read) from seed-production.sql. A late
   Job Order is made here if the production walk has not left one. */
sql(`insert into ops_prod.work_orders (item_name, qty, uom, due_date, route, status, created_by)
     select 'Kursi uji terlambat', 2, 'unit', ops_core.office_day() - 3, 'IN_HOUSE', 'OPEN', 'e2e00000-0000-0000-0000-0000000007b2'
      where not exists (select 1 from ops_prod.work_orders where status = 'OPEN' and due_date < ops_core.office_day())`);
await page.context().clearCookies();
await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch {} });
await page.goto(`${APP}/signin`, { waitUntil: "networkidle" });
await page.fill("input[type=email]", "wayan@talaliving.com");
await page.fill("input[type=password]", "e2e");
await page.getByRole("button", { name: "Masuk" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
await page.goto(`${APP}/produksi/jadwal`, { waitUntil: "networkidle" });
await page.locator("[data-dock-open='john-lau']").click().catch(() => {});

await ask("SPK mana yang terlambat");
t = lastTurnOf("wayan@talaliving.com").split("|");
expect("\"SPK mana yang terlambat\" → late Job Orders read live, with at least one fact",
  t[0] === "answer" && t[2] === "production.late_orders" && Number(t[5]) >= 1, t.join("|"));

await ask("sudah sampai mana pengiriman ke klien");
t = lastTurnOf("wayan@talaliving.com").split("|");
expect("\"sudah sampai mana pengiriman ke klien\" → fulfilment read live, not \"not built\"",
  t[0] === "answer" && t[2] === "delivery.fulfilment", t.join("|"));

await browser.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exitCode = 1; }
