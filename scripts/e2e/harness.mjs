/** What every screen walk needs: people who sign in, a step recorder that
 *  writes `docs/sop/<module>/walk.json` with screenshots beside it, and the one
 *  intercepted hop (Google Drive) — see `walk-procurement.mjs` for why each of
 *  these is the shape it is. `walk-hr.mjs` is the first walk built on this;
 *  the procurement walk predates it and carries its own copy.
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url);
const { chromium } = require("playwright-core");

export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const APP = process.env.APP_URL ?? "http://localhost:3200";
const STACK = process.env.STACK_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-only-secret-not-for-anything-real";
const SHOTS = process.env.SHOTS !== "0";

/** The database, read as its owner, for assertions only. */
export const sql = (q) => execFileSync("psql", ["-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5433",
  "-U", "postgres", "-Atc", q], { encoding: "utf8" }).trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwtFor(person) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ sub: person.id, email: person.email, role: "authenticated", aud: "authenticated", exp: 4102444800 });
  return `${h}.${b}.${createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url")}`;
}

/* A one-pixel JPEG, as the file somebody photographs. Only its name reaches
   the database; the bytes stop at the intercepted Drive hop. */
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
export const file = (name) => ({ name, mimeType: "image/jpeg", buffer: JPEG });

export async function createWalk({ module: mod, people }) {
  const OUT = join(ROOT, "docs/sop", mod);
  mkdirSync(OUT, { recursive: true });
  const walk = [];
  const failures = [];
  const browser = await chromium.launch({
    executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  let ctx = null;
  const h = { page: null, current: null };

  h.signIn = async (name) => {
    if (ctx) await ctx.close();
    h.current = name;
    ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    h.page = page;
    page.on("pageerror", (e) => failures.push(`${name}: page error ${e.message}`));
    page.on("dialog", (d) => d.accept(h.nextPrompt ?? "").catch(() => {}));
    await page.route("**/api/documents/upload", async (route) => {
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      const filename = /filename="([^"]+)"/.exec(body)?.[1] ?? "file.jpg";
      const res = await fetch(`${STACK}/rest/v1/rpc/attach_file`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-profile": "ops_core",
          authorization: `Bearer ${jwtFor(people[h.current])}`, apikey: "e2e" },
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
    await page.fill("input[type=email]", people[name].email);
    await page.fill("input[type=password]", "e2e");
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 }).catch(() => {});
  };

  h.go = async (path) => {
    await h.page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    await h.page.waitForTimeout(800);
  };

  h.mark = async (loc) => {
    await loc.first().scrollIntoViewIfNeeded().catch(() => {});
    await loc.first().evaluate((el) => { el.style.outline = "3px solid #e11d48"; el.style.outlineOffset = "3px"; }).catch(() => {});
  };

  /** One thing one person did: `act` presses, `check` reads the database and
   *  returns the status to record, or throws. */
  h.step = async ({ process: proc, action, button, shot, act, check }) => {
    const entry = { n: walk.length + 1, process: proc, actor: h.current, action, button: button ?? null,
      route: null, status: null, shot: null, ok: false, note: null };
    try {
      await act();
      await h.page.waitForTimeout(700);
      entry.route = new URL(h.page.url()).pathname;
      entry.status = check ? await check() : null;
      entry.ok = true;
    } catch (e) {
      entry.note = String(e.message).split("\n")[0];
      failures.push(`${entry.n} ${action}: ${entry.note}`);
      const buttons = await h.page.getByRole("button").allInnerTexts().catch(() => []);
      console.log("   visible buttons:", buttons.map((b) => b.trim()).filter(Boolean).slice(0, 50).join(" | "));
      const body = await h.page.innerText("body").catch(() => "");
      console.log("   toast:", (body.match(/(Not [a-z]+|Tidak [a-z]+|Belum [a-z]+|Upload gagal)[\s\S]{0,300}/) ?? [null])[0]?.replace(/\n/g, " / "));
    }
    if (SHOTS && shot) {
      entry.shot = `walk-${String(entry.n).padStart(2, "0")}-${shot}.jpg`;
      await h.page.screenshot({ path: join(OUT, entry.shot), type: "jpeg", quality: 75 }).catch(() => {});
    }
    walk.push(entry);
    console.log(`${entry.ok ? "ok  " : "FAIL"} ${String(entry.n).padStart(2)} ${h.current.padEnd(4)} ${action}${entry.status ? `  → ${entry.status}` : ""}${entry.note ? `  (${entry.note})` : ""}`);
    if (!entry.ok && process.env.STOP_ON_FAIL !== "0") throw new Error(`stopped at step ${entry.n}`);
  };

  h.finish = async () => {
    writeFileSync(join(OUT, "walk.json"), JSON.stringify({ at: new Date().toISOString(), steps: walk, failures }, null, 2));
    await browser.close();
    if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exitCode = 1; }
  };
  return h;
}
