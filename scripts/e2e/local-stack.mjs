#!/usr/bin/env node
/** A live-mode backend for end-to-end walks, with no Docker and no hosted project.
 *
 *  ## Why this exists
 *
 *  The procurement walk proved the database right and still missed B5: the
 *  bug was in what the *screen* sent, and only a browser pressing the real
 *  button against the real seams finds that. The full Supabase stack is the
 *  obvious way to get there, and it is not reachable from where these walks
 *  run (image pulls are refused — `supabase/README.md` records the same).
 *
 *  What the application needs from Supabase in live mode turns out to be
 *  small, and this provides exactly that:
 *
 *  - **PostgREST**, the real one (a static binary), against the ladder applied
 *    by `supabase/local/rebuild.sh`. Every read and every seam goes through
 *    it, as the signed-in person, with RLS applying — the part that matters.
 *  - **Auth, stubbed**: `POST /auth/v1/token?grant_type=password`,
 *    `GET /auth/v1/user`, `POST /auth/v1/logout`. The browser client only ever
 *    calls those three; `getSession` is local. Tokens are HS256 JWTs signed
 *    with the same secret PostgREST verifies, so `auth.uid()` is the person
 *    who signed in. Any password is accepted for a user that exists in
 *    `auth.users` — this is a test harness, and it refuses to run against a
 *    database that is not local (the same guard as `rebuild.sh`).
 *
 *    POSTGREST_BIN=/tmp/postgrest PGHOST=/tmp PGPORT=5433 node scripts/e2e/local-stack.mjs
 *
 *  Then run the app with the three variables it prints, and the walks in
 *  `scripts/e2e/` against it.
 */
import { createServer, request as httpRequest } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PGHOST = process.env.PGHOST ?? "/tmp";
const PGPORT = process.env.PGPORT ?? "5433";
const PORT = Number(process.env.STACK_PORT ?? 54321);
const REST_PORT = PORT + 9;
const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-only-secret-not-for-anything-real";
const BIN = process.env.POSTGREST_BIN ?? "postgrest";

if (!(PGHOST.startsWith("/") || ["localhost", "127.0.0.1", "::1"].includes(PGHOST))) {
  console.error(`refusing: PGHOST=${PGHOST} is not local. This harness accepts any password.`);
  process.exit(2);
}

const psql = (sql) => execFileSync("psql", ["-h", PGHOST, "-p", PGPORT, "-U", "postgres", "-Atc", sql], { encoding: "utf8" }).trim();

/* ── JWTs ─────────────────────────────────────────────────────────────── */
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sign(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
function verify(token) {
  const [h, b, s] = (token ?? "").split(".");
  if (!s || createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url") !== s) return null;
  return JSON.parse(Buffer.from(b, "base64url").toString());
}
const anonKey = sign({ role: "anon", iss: "e2e", iat: 0, exp: 4102444800 });

/* ── the database side PostgREST needs ────────────────────────────────── */
psql(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;`);
const schemas = psql(`select string_agg(nspname, ',' order by nspname) from pg_namespace where nspname like 'ops\\_%'`);

const conf = join(tmpdir(), "e2e-postgrest.conf");
writeFileSync(conf, [
  `db-uri = "postgres://authenticator@/postgres?host=${PGHOST}&port=${PGPORT}"`,
  `db-schemas = "${schemas}"`,
  `db-anon-role = "anon"`,
  `jwt-secret = "${SECRET}"`,
  `server-port = ${REST_PORT}`,
  `db-pool = 5`,
].join("\n"));
const rest = spawn(BIN, [conf], { stdio: ["ignore", "inherit", "inherit"] });
rest.on("exit", (c) => { console.error(`postgrest exited ${c}`); process.exit(1); });

/* ── auth, stubbed ────────────────────────────────────────────────────── */
function userByEmail(email) {
  const row = psql(`select coalesce(json_build_object('id', id, 'email', email, 'meta', raw_user_meta_data)::text, '')
                      from auth.users where lower(email) = lower('${String(email).replace(/'/g, "''")}')`);
  return row ? JSON.parse(row) : null;
}
function userById(id) {
  const row = psql(`select coalesce(json_build_object('id', id, 'email', email, 'meta', raw_user_meta_data)::text, '')
                      from auth.users where id = '${String(id).replace(/'/g, "''")}'::uuid`);
  return row ? JSON.parse(row) : null;
}
function userJson(u) {
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    user_metadata: u.meta ?? {}, app_metadata: { provider: "email" },
    created_at: new Date(0).toISOString(), confirmed_at: new Date(0).toISOString() };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600;
  return {
    access_token: sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp }),
    token_type: "bearer", expires_in: exp - now, expires_at: exp,
    refresh_token: randomUUID(), user: userJson(u),
  };
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}
const readBody = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });

async function auth(req, res, path) {
  if (path.startsWith("/auth/v1/token")) {
    const body = JSON.parse((await readBody(req)) || "{}");
    const u = body.email ? userByEmail(body.email) : null;
    if (!u) return json(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    return json(res, 200, session(u));
  }
  if (path.startsWith("/auth/v1/user")) {
    const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    const u = claims?.sub ? userById(claims.sub) : null;
    return u ? json(res, 200, userJson(u)) : json(res, 401, { msg: "invalid JWT" });
  }
  if (path.startsWith("/auth/v1/logout")) { res.writeHead(204, cors); return res.end(); }
  return json(res, 404, { msg: `not stubbed: ${path}` });
}

createServer(async (req, res) => {
  const path = req.url ?? "/";
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (path.startsWith("/auth/v1/")) return auth(req, res, path);
  if (path.startsWith("/rest/v1/")) {
    const up = httpRequest({ host: "127.0.0.1", port: REST_PORT, method: req.method,
      path: path.slice("/rest/v1".length), headers: { ...req.headers, host: `127.0.0.1:${REST_PORT}` } },
    (r) => { res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors }); r.pipe(res); });
    up.on("error", (e) => json(res, 502, { message: String(e) }));
    return req.pipe(up);
  }
  json(res, 404, { msg: `nothing at ${path}` });
}).listen(PORT, () => {
  console.log(`local stack on http://127.0.0.1:${PORT} (schemas: ${schemas})`);
  console.log(`NEXT_PUBLIC_USE_SUPABASE=1`);
  console.log(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORT}`);
  console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);
});
