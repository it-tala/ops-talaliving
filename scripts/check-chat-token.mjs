#!/usr/bin/env node
/** Prove the Google Chat token verifier refuses what it must.
 *
 *  ## Why this is a script and not a comment
 *
 *  `src/lib/chat/verify.ts` guards the one route in this application that
 *  calls a database seam with no person's session behind it. Every claim in
 *  its comments — pinned algorithm, checked issuer, checked audience, checked
 *  expiry — is a refusal, and **a refusal nobody has ever seen happen is a
 *  hope.** Each one below is made to happen, with a key this script generates,
 *  so the tests can forge tokens the way an attacker would rather than only
 *  presenting valid ones and watching them pass.
 *
 *  The verifier takes its key source and its clock as parameters for exactly
 *  this reason. A verifier that can only run against the real Google is one
 *  whose failure paths are never executed until the day they matter.
 *
 *  Run: `node --experimental-strip-types scripts/check-chat-token.mjs`
 *  (`npm run verify` runs it; Node 22 strips the types, no build step.)
 */
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const { verifyChatToken, forgetKeys, CHAT_ISSUER } =
  await import(`${ROOT}/src/lib/chat/verify.ts`);

const AUD = "1234567890";
const NOW = Date.UTC(2026, 8, 23, 6, 0, 0);

/* One keypair, used as if it were Google's. The public half is served to the
   verifier as a JWK; the private half signs both the honest tokens and the
   forgeries, which is what makes "wrong audience" a *different* failure from
   "bad signature" rather than the same one twice. */
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const KID = "test-key-1";

/** A second keypair nobody published — for the forged-signature case. */
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

const keys = async () => ({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
const noKeys = async () => { throw new Error("network is down"); };

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o))
  .toString("base64url");

function mint({ alg = "RS256", kid = KID, iss = CHAT_ISSUER, aud = AUD,
                exp = Math.floor(NOW / 1000) + 300, signWith = privateKey,
                tamper = false } = {}) {
  const head = b64({ alg, kid, typ: "JWT" });
  const body = b64({ iss, aud, exp, iat: Math.floor(NOW / 1000), sub: CHAT_ISSUER });
  if (alg === "none") return `${head}.${body}.`;
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).end()
    .sign(signWith).toString("base64url");
  return `${head}.${body}.${tamper ? sig.slice(0, -4) + "AAAA" : sig}`;
}

let failed = 0;
const pass = (n) => process.stdout.write(`${n.padEnd(52)} ok\n`);
const fail = (n, why) => { process.stdout.write(`${n.padEnd(52)} FAILED\n    ${why}\n`); failed++; };

async function expectOk(name, token) {
  forgetKeys();
  const v = await verifyChatToken(token, AUD, NOW, keys);
  v.ok ? pass(name) : fail(name, `refused with ${v.code}: ${v.detail}`);
}
async function expectRefusal(name, token, code, fetcher = keys, aud = AUD) {
  forgetKeys();
  const v = await verifyChatToken(token, aud, NOW, fetcher);
  if (v.ok) return fail(name, "it was ACCEPTED — this is the case the check exists for");
  if (v.code !== code) return fail(name, `refused as ${v.code}, expected ${code}: ${v.detail}`);
  pass(name);
}

/* The one that must pass. If this fails everything below is meaningless,
   because a verifier that refuses everything also refuses every forgery. */
await expectOk("a token Google really signed is accepted", mint());

/* `alg: none` — the oldest JWT attack. The header is written by the sender,
   so a verifier that reads `alg` to choose its algorithm is told what to do
   by the attacker. */
await expectRefusal("alg: none is refused", mint({ alg: "none" }), "bad_algorithm");

/* HS256 with the *public* key as the HMAC secret: the public key is public,
   so anybody can compute that MAC. Pinning to RS256 is the whole defence. */
await expectRefusal("alg: HS256 is refused", mint({ alg: "HS256" }), "bad_algorithm");

/* Signed by a real RSA key — just not the one Google published. */
await expectRefusal("a stranger's signature is refused",
  mint({ signWith: stranger }), "bad_signature");

/* Right key, right claims, four bytes changed. */
await expectRefusal("a tampered signature is refused",
  mint({ tamper: true }), "bad_signature");

/* **The one that is easiest to leave out**, because the token is genuinely
   from Google and genuinely valid — for somebody else's Chat app. Without
   this check, any Google customer can post into this inbox. */
await expectRefusal("a token for another audience is refused",
  mint({ aud: "9999999999" }), "wrong_audience");

/* And the same failure worn differently: audience not configured at all. A
   verifier that accepts anything when its audience is unset is one that is
   switched off by forgetting an environment variable. */
await expectRefusal("an unset audience refuses rather than allows",
  mint(), "wrong_audience", keys, "");

/* Google signs for many services; a valid Google signature is not "from Chat". */
await expectRefusal("another Google issuer is refused",
  mint({ iss: "someone-else@system.gserviceaccount.com" }), "wrong_issuer");

/* Replay. No grace period: the window belongs to Google, not to us. */
await expectRefusal("an expired token is refused",
  mint({ exp: Math.floor(NOW / 1000) - 1 }), "expired");
await expectRefusal("expiring exactly now is refused",
  mint({ exp: Math.floor(NOW / 1000) }), "expired");

/* Shape. */
await expectRefusal("no token at all is refused", null, "no_token");
await expectRefusal("a non-JWT is refused", "not-a-jwt", "malformed");
await expectRefusal("a kid nobody published is refused",
  mint({ kid: randomUUID() }), "unknown_key");

/* **Not a refusal of the token** — we could not run the check. The route turns
   this into a 503 so Chat retries, rather than a 401 telling it to stop. */
await expectRefusal("unreachable keys are reported as such",
  mint(), "keys_unavailable", noKeys);

process.stdout.write("──\n");
if (failed) {
  process.stdout.write(`chat token  ${failed} FAILED\n`);
  process.exit(1);
}
process.stdout.write("chat token  ok (1 accepted, 13 refusals each proved)\n");
