#!/usr/bin/env node
/** Upload the 2013 register's photos and file each on its asset (D447).
 *
 *  `supabase/import/13_inv_legacy_2013_register.sql` made the 164 assets. Their
 *  photos are files, and a file this app keeps goes to Drive **through the
 *  app's own upload route** (`/api/documents/upload`), as a signed-in person:
 *  that route picks the drive and the folder from the database (D313, D320 —
 *  `INVENTORY/ASSETS` for `foto` on an `asset`), hashes the bytes, and reuses a
 *  file it already holds. A SQL step cannot do any of that, so this is a
 *  script, and it runs as whoever runs it.
 *
 *  What it does, per register row (`photo_file` in the CSV):
 *    1. finds the asset(s) with that `legacy_code` (C1-07 is two);
 *    2. skips an asset that already has a record photo — so a second run
 *       uploads nothing and links nothing;
 *    3. otherwise posts the photo (kind Foto, entity asset, entity_no the
 *       asset's number) and links the returned attachment with `attach_link`.
 *  Shared photos (F1-05…F1-10, C1-04/05, C1-06/07) are the same bytes; the
 *  route answers the second one with the file it already has.
 *
 *  Usage, from the repo root:
 *
 *    NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… \
 *    OPS_URL=https://ops.talaliving.com OPS_EMAIL=… OPS_PASSWORD=… \
 *      node scripts/import/upload-2013-photos.mjs [--dry-run] [--limit N]
 *
 *  OPS_EMAIL / OPS_PASSWORD are the runner's own account; it needs inventory
 *  write access and its module's Drive must be connected (IT → Google Drive).
 *  Nothing here stores them. `--dry-run` signs in, reads, and reports what it
 *  would do without uploading.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSV = join(ROOT, "supabase/import/data/legacy_2013_register.csv");
const PHOTOS = join(ROOT, "docs/handoff/inventory-verification/data");
const NOTE = "2013 register photo (MACHINE INVENTORY 2013, taken Nov 2012)";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`${name} is not set.`); process.exit(2); }
  return v;
}

/** RFC 4180, enough for this file: quoted fields with commas and "" escapes. */
function parseCsv(text) {
  const rows = []; let row = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function main() {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const opsUrl = need("OPS_URL").replace(/\/+$/, "");
  const email = need("OPS_EMAIL");
  const password = need("OPS_PASSWORD");

  /* The upload route reads the session from the same cookies the browser
     carries, so sign in through the same library and keep what it writes. */
  const jar = new Map();
  const sb = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) value ? jar.set(name, value) : jar.delete(name); },
    },
  });
  const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
  if (signInErr) { console.error(`sign-in failed: ${signInErr.message}`); process.exit(1); }
  const cookie = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const { data: assets, error: readErr } = await sb.schema("ops_inv")
    .from("v_asset_verification")
    .select("asset_no, legacy_code, record_photo_count")
    .not("legacy_code", "is", null);
  if (readErr) { console.error(`could not read assets: ${readErr.message}`); process.exit(1); }
  const byCode = new Map();
  for (const a of assets) byCode.set(a.legacy_code, [...(byCode.get(a.legacy_code) ?? []), a]);

  const count = { uploaded: 0, reused: 0, linked: 0, skipped: 0, missing_asset: 0, missing_file: 0, failed: 0 };
  let done = 0;

  for (const r of rows) {
    if (done >= LIMIT) break;
    const file = join(PHOTOS, r.photo_file);
    const targets = byCode.get(r.legacy_code) ?? [];
    if (!targets.length) { count.missing_asset++; console.log(`${r.legacy_code}: no asset — run step 13 first`); continue; }
    if (!existsSync(file)) { count.missing_file++; console.log(`${r.legacy_code}: ${r.photo_file} not found`); continue; }

    for (const a of targets) {
      if (a.record_photo_count > 0) { count.skipped++; continue; }
      done++;
      if (DRY) { console.log(`would upload ${r.photo_file} → ${a.asset_no}`); continue; }

      const form = new FormData();
      form.append("file", new Blob([readFileSync(file)], { type: "image/jpeg" }), `${a.asset_no}_2013_${r.legacy_code}.jpg`);
      form.append("kind", "Foto");
      form.append("entity", "asset");
      form.append("entity_no", a.asset_no);
      const res = await fetch(`${opsUrl}/api/documents/upload`, { method: "POST", body: form, headers: { cookie: cookie() } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.data?.attachment_id) {
        count.failed++;
        console.log(`${a.asset_no} (${r.legacy_code}): upload refused ${res.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`);
        continue;
      }
      body.data.reused ? count.reused++ : count.uploaded++;

      const { data: env, error: linkErr } = await sb.schema("ops_core").rpc("attach_link", {
        p_attachment_id: body.data.attachment_id, p_entity: "asset", p_entity_no: a.asset_no,
        p_kind: "foto", p_note: NOTE, p_key: `2013-photo:${a.asset_no}`,
      });
      if (linkErr || !["ok", "noop"].includes(env?.outcome)) {
        count.failed++;
        console.log(`${a.asset_no}: uploaded but not linked — ${linkErr?.message ?? env?.error?.message}`);
        continue;
      }
      count.linked++;
      console.log(`${a.asset_no} (${r.legacy_code}): ${body.data.reused ? "reused" : "uploaded"} and linked`);
    }
  }

  console.log("\n──");
  console.log(JSON.stringify({ dry_run: DRY, rows: rows.length, ...count }));
  if (count.failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
