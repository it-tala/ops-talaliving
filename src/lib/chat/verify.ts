/** Verifying that a request really came from Google Chat.
 *
 *  ## Why this file exists rather than a shared secret
 *
 *  The obvious way to authenticate a webhook is a secret in the URL or a
 *  header both sides know. Google Chat offers something better and it costs
 *  nothing to use: every request it makes carries a bearer token **signed by
 *  Google**, and verifying it needs only Google's *public* keys. There is no
 *  secret to store, none to rotate, and none that can leak from this repo,
 *  this session, or a log line.
 *
 *  That matters here beyond neatness. The route this guards is the one thing
 *  in the system that calls a database seam without a person's session behind
 *  it (ADR-002, `0038`), so the question *is this really Google* is the only
 *  thing standing between a stranger and the evidence inbox.
 *
 *  ## What is checked, and why each one is not optional
 *
 *  A JWT is three base64 segments and it is trivial to write one by hand. The
 *  checks below are the difference between reading a claim and believing it:
 *
 *  - **The algorithm is pinned to RS256.** Read from the header and compared,
 *    never used to choose a verifier. `alg: none` is the oldest JWT attack
 *    there is, and `alg: HS256` is the second — it invites a verifier to use
 *    the *public* key as an HMAC secret, which anybody can also do.
 *  - **The signature is verified against Google's published key for that
 *    `kid`.** This is the only check that cannot be forged; every claim below
 *    is worth nothing on its own.
 *  - **`iss` is Google Chat's own service account.** Google signs tokens for
 *    many things. A valid Google signature is not the same as *from Chat*.
 *  - **`aud` is this deployment's audience.** The project number of the Chat
 *    app, configured by IT. Without it, a token Google minted for *somebody
 *    else's* Chat app verifies perfectly and lands in this inbox.
 *  - **`exp` has not passed**, with no grace. A replayed token is a request
 *    somebody captured, and the window should be Google's, not ours.
 *
 *  ## What it deliberately does not do
 *
 *  It does not decide anything about the message. Who sent it, whether they
 *  are known here, whether the file may be filed — all of that is the
 *  database's, through `ops_acct.file_evidence`. This answers one question.
 */

/** Google Chat signs with this service account, always. */
export const CHAT_ISSUER = "chat@system.gserviceaccount.com";

/** Google's published keys for that issuer, in JWK form. */
export const CHAT_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";

export interface ChatTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  iat?: number;
}

export interface Verified {
  ok: true;
  claims: ChatTokenClaims;
}

export interface Rejected {
  ok: false;
  /** Machine-readable, and deliberately coarse: a caller that can tell *bad
   *  signature* from *wrong audience* is a caller that can be used to probe
   *  which one it got wrong. The detail goes in the log, not the response. */
  code:
    | "no_token"
    | "malformed"
    | "bad_algorithm"
    | "unknown_key"
    | "bad_signature"
    | "wrong_issuer"
    | "wrong_audience"
    | "expired"
    | "keys_unavailable";
  detail: string;
}

export type Verdict = Verified | Rejected;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

/** How the keys are fetched. A parameter rather than a hard-coded `fetch` so
 *  the adversarial tests can drive this with keys they control — a verifier
 *  that can only be exercised against the real Google is a verifier whose
 *  refusals nobody has ever seen. */
export type FetchJwks = () => Promise<{ keys: Jwk[] }>;

/** Google rotates these keys and publishes the next one well before it is
 *  used, so a short cache is safe and keeps a burst of chat messages from
 *  becoming a burst of outbound requests. Deliberately small: a Worker
 *  instance is short-lived, and a stale key is a refused message. */
const KEY_CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; keys: Jwk[] } | null = null;

/** Exposed so a test can start from nothing. Never called by the route. */
export function forgetKeys(): void {
  cache = null;
}

async function googleKeys(): Promise<{ keys: Jwk[] }> {
  const res = await fetch(CHAT_JWKS_URL);
  if (!res.ok) throw new Error(`${res.status} from ${CHAT_JWKS_URL}`);
  return (await res.json()) as { keys: Jwk[] };
}

function b64urlToBytes(s: string): Uint8Array {
  /* `atob` wants standard base64 and no padding is allowed to be missing. */
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonFromB64url(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/** Verify a Google Chat bearer token.
 *
 *  `audience` is the Chat app's project number, which IT configures. It is
 *  required: a verifier that accepts any audience when none is configured is a
 *  verifier that is switched off by forgetting a variable.
 */
export async function verifyChatToken(
  token: string | null | undefined,
  audience: string,
  now: number = Date.now(),
  fetchJwks: FetchJwks = googleKeys,
): Promise<Verdict> {
  if (!token) return { ok: false, code: "no_token", detail: "No bearer token on the request." };

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "malformed", detail: `Expected 3 JWT segments, saw ${parts.length}.` };
  }

  let header: { alg?: string; kid?: string };
  let claims: ChatTokenClaims;
  try {
    header = jsonFromB64url(parts[0]) as { alg?: string; kid?: string };
    claims = jsonFromB64url(parts[1]) as ChatTokenClaims;
  } catch (e) {
    return { ok: false, code: "malformed", detail: `Segments are not JSON: ${(e as Error).message}` };
  }

  /* **Pinned, not read.** The header names the algorithm, and the header is
     written by whoever sent the token. Using it to pick a verifier is how
     `alg: none` and the HMAC-with-the-public-key trick both work. */
  if (header.alg !== "RS256") {
    return { ok: false, code: "bad_algorithm", detail: `alg was ${String(header.alg)}, not RS256.` };
  }
  if (!header.kid) {
    return { ok: false, code: "unknown_key", detail: "No kid in the header." };
  }

  let keys: Jwk[];
  if (cache && now - cache.at < KEY_CACHE_MS) {
    keys = cache.keys;
  } else {
    try {
      keys = (await fetchJwks()).keys;
      cache = { at: now, keys };
    } catch (e) {
      /* Not a refusal of *this* token — we could not do the check at all. The
         route turns this into a 503 so Chat retries, rather than a 401 that
         would tell Google to stop sending. */
      return { ok: false, code: "keys_unavailable", detail: (e as Error).message };
    }
  }

  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    return { ok: false, code: "unknown_key", detail: `No published key with kid ${header.kid}.` };
  }

  let good: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    good = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch (e) {
    return { ok: false, code: "bad_signature", detail: `Could not verify: ${(e as Error).message}` };
  }
  if (!good) {
    return { ok: false, code: "bad_signature", detail: "Signature does not match." };
  }

  /* Claims are only worth reading now. Everything above this line is what
     makes them more than text somebody typed. */
  if (claims.iss !== CHAT_ISSUER) {
    return { ok: false, code: "wrong_issuer", detail: `iss was ${String(claims.iss)}.` };
  }
  if (!audience || claims.aud !== audience) {
    return { ok: false, code: "wrong_audience", detail: `aud was ${String(claims.aud)}.` };
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) {
    return { ok: false, code: "expired", detail: `exp was ${String(claims.exp)}.` };
  }

  return { ok: true, claims };
}
