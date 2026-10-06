import "server-only";

/** GitHub's webhook signature: `X-Hub-Signature-256: sha256=<hex>`, an
 *  HMAC-SHA256 of the **raw** request body with the secret both sides hold.
 *
 *  Raw bytes, never a re-serialised JSON: `JSON.stringify(JSON.parse(body))`
 *  is a different string (spacing, escapes) and fails every real delivery.
 *  The comparison is constant-time so the answer's timing says nothing about
 *  how many leading characters were right. `crypto.subtle` because that is
 *  what a Cloudflare Worker has. */
export async function verifyGithubSignature(
  secret: string, body: ArrayBuffer, header: string | null,
): Promise<boolean> {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const want = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(want, given);
}

/** Equal-length strings compared without an early exit. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
