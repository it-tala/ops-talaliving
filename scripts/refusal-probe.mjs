/** The refusal table, checked by something other than a person looking at it.
 *
 *  `/demo` runs every refusal probe in the system on mount — the 403s, the 409s,
 *  the 422s — and prints a pass or a fail against each. "Refusal table 28/28" is
 *  the single most-cited piece of evidence on the milestone board, in more than
 *  thirty entries.
 *
 *  And until this file existed, it was produced by an ad-hoc script written from
 *  memory in a scratch directory, once per working session, and thrown away
 *  (F96). Nobody else could run it. Nothing in the repository named it. The
 *  number was true every time it was reported and **unreproducible by anyone but
 *  the person reporting it**, which is a strange property for the project's
 *  headline check.
 *
 *  Run: `npm run check:refusals` (needs the app running — see BASE below).
 *
 *  ## Three things this gets right that the throwaway version kept getting wrong
 *
 *  **It waits for a signal, not a stopwatch.** The probes switch the acting user
 *  as they go and finish with `actAs(original)`, which takes fifteen-odd seconds;
 *  the scratch version slept 22s and hoped. A sleep that is long enough on a warm
 *  dev server is not long enough on a cold CI runner, and the failure looks like
 *  a broken app rather than a slow one. The page already says when it is done —
 *  the button reads *Testing…* while running — so this waits for that, having
 *  first waited for it to start, because "not running" is also true before
 *  anything has begun.
 *
 *  **It pages.** `DataTable` shows 25 rows at a time. A 26th probe once read as
 *  missing for exactly that reason, and the bug was in the scraper both times it
 *  was suspected of being in the table (M58).
 *
 *  **It identifies rows by shape, not by position.** A probe row is three cells
 *  whose last is the verdict. `/demo` renders other tables, and a selector of
 *  `table tbody tr` collects those too — the first run of this check reported 62
 *  rows and 34 failures, all of them purchase-request lines that had never
 *  claimed to be probes.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PROBE_URL ?? "http://localhost:3100";
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 120_000);

/** Where Chromium is.
 *
 *  Explicit, and in this order, because a browser found by accident is one that
 *  disappears on a machine that was set up differently. `CHROMIUM_PATH` wins for
 *  anyone who knows better; otherwise a browsers directory is searched; failing
 *  both, playwright-core resolves it and says so itself if it cannot.
 */
function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  const dir = fs.readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  if (!dir) return undefined;
  const exe = path.join(root, dir, "chrome-linux", "chrome");
  return fs.existsSync(exe) ? exe : undefined;
}

/** A probe row: three cells, the last of which is the verdict. */
const ROW_SHAPE = (trs) => trs
  .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()))
  .filter((r) => r.length === 3 && /^(pass|fail|lulus|gagal)$/i.test(r[2]));

const buttonState = () => {
  const b = [...document.querySelectorAll("button")]
    .find((x) => /Test refusals|Testing/i.test(x.innerText));
  if (!b) return "absent";
  return /Testing/i.test(b.innerText) || b.disabled ? "running" : "idle";
};

const browser = await chromium.launch({ executablePath: executablePath() });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));

try {
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });

  /* Started, then finished. Waiting only for "idle" would match the instant
     before the run begins and scrape an empty table. */
  await page.waitForFunction(buttonState, null, { timeout: TIMEOUT, polling: 150 })
    .then(() => page.waitForFunction(
      `(${buttonState.toString()})() === "running"`, null, { timeout: TIMEOUT, polling: 100 },
    ))
    .catch(() => { /* fast enough to have finished already; the next wait decides */ });

  /* A timeout here is a real failure with a readable cause, not a stack trace.
     The three ways it happens are worth telling apart: the page never loaded,
     the button was renamed so the check is blind, or the probes genuinely hung. */
  try {
    await page.waitForFunction(
      `(${buttonState.toString()})() === "idle"`, null, { timeout: TIMEOUT, polling: 200 },
    );
  } catch {
    const where = page.url();
    const state = await page.evaluate(buttonState).catch(() => "unknown");
    console.error(`FAIL: the refusal run never finished at ${where}.`);
    console.error(`      The run button reads "${state}" after ${TIMEOUT}ms.`);
    console.error(state === "absent"
      ? '      No button matching "Test refusals" exists on that page — either the '
        + "URL is wrong or the button was renamed, and this check is blind either way."
      : "      The probes started and did not finish.");
    for (const e of pageErrors) console.error(`      page error: ${e}`);
    process.exit(1);
  }

  /* Keyed by the probe's own description, so a row seen twice across pages is
     one row rather than two. */
  const seen = new Map();
  for (let i = 0; i < 20; i++) {
    for (const r of await page.$$eval("table tbody tr", ROW_SHAPE)) seen.set(r[0], r);
    const next = await page.$('button[aria-label="Halaman berikutnya"]');
    if (!next || await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(400);
  }

  const rows = [...seen.values()];
  const failed = rows.filter((r) => /^(fail|gagal)$/i.test(r[2]));

  console.log(`refusal probes: ${rows.length}   pass: ${rows.length - failed.length}   fail: ${failed.length}`);
  for (const r of failed) console.log(`  FAIL  ${r[0].split("\n")[0]}  ->  got ${r[1]}`);
  for (const e of pageErrors) console.log(`  page error: ${e}`);

  /* Zero rows is not a clean sheet. The probes not running at all would
     otherwise be indistinguishable from every probe passing, and it is the more
     likely failure of the two — a changed selector, a renamed button, a page
     that threw before it began. */
  if (rows.length === 0) {
    console.error("\nFAIL: no probe rows found. The check could not see the table, "
      + "which is not the same as the table being empty.");
    process.exit(1);
  }
  if (failed.length || pageErrors.length) {
    console.error(`\nFAIL: ${failed.length} refusal(s) did not behave as declared`
      + `${pageErrors.length ? `, ${pageErrors.length} page error(s)` : ""}.`);
    process.exit(1);
  }
  console.log("\nOK: every declared refusal refused.");
} finally {
  await browser.close();
}
