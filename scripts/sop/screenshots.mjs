#!/usr/bin/env node
/** Screenshots for the procurement SOP, taken from the demo.
 *
 *  The demo and the live app are the same screens (ADR-009), and the demo is
 *  the only one that runs without Supabase Auth and Google Drive — so the SOP
 *  is illustrated from it. Every shot carries the *DEMO · DATA IS NOT REAL*
 *  banner, which is correct: the figures in the pictures are fixtures.
 *
 *  `playwright-core` is deliberately not a dependency of this repository. Run
 *  it from a throwaway install:
 *
 *    npm run dev -- -p 3100 &
 *    (cd /tmp/sop && npm i playwright-core)
 *    NODE_PATH=/tmp/sop/node_modules node scripts/sop/screenshots.mjs docs/sop/procurement [names]
 *
 *  Chromium comes from CHROME or the pre-installed Playwright browser.
 *  A shot marks the button the step is about with a red outline. */
import { createRequire } from "node:module";
const { chromium } = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url)("playwright-core");
const OUT = process.argv[2];
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
const only = process.argv[3] ? process.argv[3].split(",") : null;

async function go(path) { await p.goto(BASE + path, { waitUntil: "networkidle" }); await p.waitForTimeout(1500); }
async function mark(loc) {
  await loc.first().scrollIntoViewIfNeeded().catch(() => {});
  await loc.first().evaluate((el) => { el.style.outline = "3px solid #e11d48"; el.style.outlineOffset = "3px"; el.style.borderRadius = "6px"; });
}
async function shot(name, fn) {
  if (only && !only.includes(name)) return;
  try { await fn(); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 78 }); console.log("ok  ", name); }
  catch (e) { console.log("FAIL", name, String(e.message).split("\n")[0]); }
}
const btn = (t) => p.getByRole("button", { name: t });

await shot("01-suppliers", async () => { await go("/master-data/suppliers"); });
await shot("02-pr-board", async () => { await go("/procurement/pr"); await mark(p.getByText("New request", { exact: true })); });
await shot("02-pr-new", async () => { await go("/procurement/pr/new"); await mark(p.getByText("Submit for approval")); });
await shot("03-meeting", async () => { await go("/procurement/meeting"); });
await shot("04-new-po", async () => { await go("/procurement/po"); await btn("Add new PO").click(); await p.waitForTimeout(800); await mark(p.getByText("Create the draft")); });
let poUrl = null;
await shot("04-po-detail", async () => {
  await go("/procurement/po");
  await p.locator("tbody tr").first().click(); await p.waitForURL(/\/procurement\/po\/.+/); await p.waitForTimeout(1500);
  poUrl = p.url();
  const target = p.getByText(/Issue and send it|Ask leadership to confirm|Confirm it/).first();
  if (await target.count()) await mark(target);
});
await shot("04-po-print", async () => { if (!poUrl) throw new Error("no po"); await p.goto(poUrl + "/print", { waitUntil: "networkidle" }); await p.waitForTimeout(1500); });
await shot("05-receive", async () => {
  await go("/procurement/tracker");
  await p.locator("tbody tr").first().click(); await p.waitForURL(/\/procurement\/tracker\/.+/); await p.waitForTimeout(2000);
  await btn("Record arrival").first().click(); await p.waitForTimeout(800);
  await mark(p.getByRole("button", { name: /Record what arrived|Report it/ }));
});
await shot("05-penerimaan", async () => { await go("/procurement/penerimaan"); });
await shot("06-pay-line", async () => {
  await go("/procurement/pr");
  await p.locator("tbody tr", { hasText: "APPROVED" }).filter({ hasNotText: "WAITING" }).first().click(); await p.waitForTimeout(1200);
  const post = p.getByText(/to the ledger/).first();
  await mark(post);
});
await shot("07-ledger", async () => { await go("/accounting/ledger"); });
await shot("08-verifikasi", async () => { await go("/accounting/verifikasi"); });
await shot("09-rekening-koran", async () => { await go("/accounting/rekening-koran"); });
await shot("10-john-lau", async () => {
  await go("/procurement/po");
  await p.locator("[data-dock-open='john-lau']").click(); await p.waitForTimeout(500);
  await p.getByLabel(/prompt|pertanyaan|question/i).first().fill("bagaimana cara membuat PO?");
  await p.keyboard.press("Enter"); await p.waitForTimeout(2500);
});
await b.close();
