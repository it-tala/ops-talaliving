import "server-only";

/** Uploading to a Google shared drive, as the service account.
 *
 *  ## Why a service account rather than the person
 *
 *  The file goes to a shared drive the business already uses (owner,
 *  2026-09-21: *pakai folder ops di tiap module shared drive*), and the reason
 *  it goes there rather than somewhere of the application's own is that people
 *  open these files by hand, in Drive, beside the work. A per-user OAuth flow
 *  would put every upload behind a Google consent screen and make the app's
 *  ability to file depend on whether the person signing in happens to have a
 *  Workspace account — which B5 deliberately does not require.
 *
 *  So one identity writes: `capture-worker@…`, a Content manager on each drive.
 *  It has been doing exactly this for the legacy system since it began.
 *
 *  ## Why this is not in the browser
 *
 *  A service account key in a browser is a service account key in everybody's
 *  browser. This module is `server-only` and the route that uses it runs in the
 *  Worker; the key reaches it as a runtime secret and never as `NEXT_PUBLIC_`.
 *  `credentials()` refuses the prefixed form outright rather than reading it,
 *  the same way `serviceRoleKey()` does, because by the time somebody notices
 *  the name the value has already shipped.
 *
 *  ## No SDK
 *
 *  `googleapis` is a large dependency that assumes Node's crypto and HTTP.
 *  What is needed here is one signed JWT and two `fetch` calls, and WebCrypto
 *  does RS256 natively — so this is about eighty lines instead of a megabyte,
 *  and it runs on the Worker runtime without a shim.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files"
  + "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";

/** The scope, and only this one. `drive.file` lets the service account touch
 *  files **it created** and nothing else — so a mistake here cannot reach the
 *  1.412 documents already in those drives. The broader `drive` scope would let
 *  it read and delete all of them, and nothing about filing an upload needs
 *  that.
 *
 *  **What this costs, stated rather than discovered:** the account cannot
 *  *see* a folder a person made. So `findOrCreateOpsFolder` searching for an
 *  existing hand-made `ops` will come back empty and make its own. That is the
 *  right trade here — nobody has made one yet, the app creating it is the plan,
 *  and a duplicate folder is a tidying job where a `drive` scope would be a
 *  standing risk to years of documents.
 *
 *  If an upload ever fails with Google saying the parent cannot be written,
 *  that is this line to revisit, and the error will say so in Google's own
 *  words rather than being swallowed. */
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string | null;
}

function credentials(): { email: string; privateKey: string } {
  if (typeof window !== "undefined") {
    throw new Error("The Drive service account is server-only and was read in a browser.");
  }
  /* The guard that earns this function. `NEXT_PUBLIC_` is not a naming
     convention in Next.js — it is an instruction to inline the value into the
     client bundle at build time. */
  if (process.env.NEXT_PUBLIC_GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_PRIVATE_KEY is set. A service account key must never carry the "
      + "NEXT_PUBLIC_ prefix — that prefix ships the value to every browser. Rename it to "
      + "GOOGLE_PRIVATE_KEY and rotate the key in Google Cloud, because it has been in a "
      + "client bundle.",
    );
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set for uploads to reach "
      + "Drive. They are runtime secrets on the Worker — Settings → Variables and Secrets, "
      + "not Build variables. See docs/plan/phase-2/05-storage.md.",
    );
  }
  return { email, privateKey };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM to a WebCrypto key. The private key arrives as one line with `\n`
 *  written out, because that is what a secret store does to a multi-line
 *  value — so the escape is undone here rather than in whoever pastes it. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

/** An access token, minted from a self-signed JWT.
 *
 *  Not cached. A token lasts an hour and an upload takes a second, so caching
 *  it would trade a round trip for a class of bug — a stale token on one
 *  isolate, a clock skew on another — in exchange for latency nobody is
 *  waiting on. If uploads ever become frequent enough to matter, cache it
 *  somewhere with an expiry rather than in a module variable.
 */
async function accessToken(): Promise<string> {
  const { email, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importKey(privateKey),
    new TextEncoder().encode(`${head}.${body}`),
  );
  const jwt = `${head}.${body}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    /* Google's own words. A rewritten message here would hide the one thing
       worth knowing — `invalid_grant` means the clock or the key, and
       `unauthorized_client` means domain-wide delegation, and they need
       different fixes. */
    throw new Error(`Google refused the service account: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Put a file in one folder of one shared drive.
 *
 *  `supportsAllDrives` is not optional: without it the Drive API pretends
 *  shared drives do not exist and answers *file not found* for a folder that is
 *  plainly there — which is a long afternoon if you have not met it before.
 */
export async function uploadToDrive(
  file: { name: string; type: string; bytes: ArrayBuffer },
  folderId: string,
): Promise<DriveFile> {
  const token = await accessToken();
  const boundary = `b${crypto.randomUUID().replace(/-/g, "")}`;

  const metadata = JSON.stringify({
    name: file.name,
    parents: [folderId],
    mimeType: file.type || "application/octet-stream",
  });

  const head = new TextEncoder().encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    + `--${boundary}\r\ncontent-type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const payload = new Uint8Array(head.length + file.bytes.byteLength + tail.length);
  payload.set(head, 0);
  payload.set(new Uint8Array(file.bytes), head.length);
  payload.set(tail, head.length + file.bytes.byteLength);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Drive refused the upload: ${res.status} ${await res.text()}`);
  }
  const out = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return { id: out.id, name: out.name, webViewLink: out.webViewLink ?? null };
}

/** The `OPS` folder of a module — the recorded folder itself, or one inside it.
 *
 *  `0036` read the ids the owner handed over (2026-09-21) as the **module
 *  folders** and made this function create an `ops` folder inside each. The
 *  ids are the `OPS` folders themselves: DRAFTING's is a folder named `OPS`,
 *  and the owner confirmed it for procurement (2026-09-25, *harusnya di folder
 *  OPS shared drive Procurement*). Nesting would have filed everything in
 *  `OPS/ops`. Nothing was uploaded before this was caught — every
 *  `drive_folders.folder_id` was still null in production.
 *
 *  So the recorded folder is asked its own name first: **named OPS (any case)
 *  → it is the target**. Only a folder named anything else gets an `OPS`
 *  folder found or made inside it, the case `0036` was written for. Resolved
 *  by name, once, and written back to `ops_core.drive_folders` — a name is
 *  checkable; an id is not.
 *
 *  `trashed = false` matters: a folder somebody deleted last month still
 *  answers a search, and uploading into the bin loses the file quietly.
 */
export async function findOrCreateOpsFolder(parentFolderId: string): Promise<string> {
  const token = await accessToken();

  const self = await fetch(
    `${FILES_URL}/${encodeURIComponent(parentFolderId)}?supportsAllDrives=true&fields=id,name,trashed`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!self.ok) {
    throw new Error(`Drive refused to read the recorded folder: ${self.status} ${await self.text()}`);
  }
  const me = (await self.json()) as { id: string; name: string; trashed?: boolean };
  if (me.trashed) {
    throw new Error(`The recorded folder "${me.name}" is in the bin. IT records the right one in ops_core.drive_folders.`);
  }
  if (isOpsName(me.name)) return me.id;
  return findOrCreateFolder(parentFolderId, "OPS", token);
}

/** A folder by name inside another — found (ignoring case, because people
 *  make these by hand), or made. */
export async function findOrCreateFolder(parentFolderId: string, name: string, token?: string): Promise<string> {
  const bearer = token ?? await accessToken();
  const wanted = name.trim();
  const q = [
    /* `contains` on a name is a case-insensitive prefix match; the exact
       comparison is done below, so `Inventory` made by hand is reused rather
       than duplicated as `INVENTORY`. */
    `name contains '${wanted.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${parentFolderId}' in parents`,
    "trashed = false",
  ].join(" and ");

  const search = new URL(FILES_URL);
  search.searchParams.set("q", q);
  search.searchParams.set("fields", "files(id,name)");
  search.searchParams.set("supportsAllDrives", "true");
  search.searchParams.set("includeItemsFromAllDrives", "true");
  /* Without this the search is scoped to My Drive and answers nothing for a
     folder that is plainly there — the same trap as `supportsAllDrives` on the
     upload, one call earlier. */
  search.searchParams.set("corpora", "allDrives");

  const found = await fetch(search, { headers: { authorization: `Bearer ${bearer}` } });
  if (!found.ok) {
    throw new Error(`Drive refused the folder search: ${found.status} ${await found.text()}`);
  }
  const hits = ((await found.json()) as { files?: { id: string; name: string }[] }).files ?? [];
  const hit = hits.find((f) => f.name.trim().toLowerCase() === wanted.toLowerCase());
  if (hit) return hit.id;

  const made = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: wanted,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  if (!made.ok) {
    throw new Error(`Drive refused to create the folder "${wanted}": ${made.status} ${await made.text()}`);
  }
  return ((await made.json()) as { id: string }).id;
}

/** The task folder under OPS (`ops_core.drive_paths`, 0172): each segment of
 *  `INVENTORY/FINISHED GOODS` found or made in turn. Two uploads racing on a
 *  brand-new folder can each make one; the next upload reuses the first found,
 *  and IT merges the pair by hand — rare, visible, and harmless to the files. */
export async function findOrCreatePath(opsFolderId: string, path: string): Promise<string> {
  const token = await accessToken();
  let at = opsFolderId;
  for (const segment of path.split("/").map((x) => x.trim()).filter(Boolean)) {
    at = await findOrCreateFolder(at, segment, token);
  }
  return at;
}

/** `OPS`, `ops`, ` Ops ` — the owner's folders are typed by hand. */
export function isOpsName(name: string): boolean {
  return name.trim().toLowerCase() === "ops";
}

/** Is this deployment able to reach Drive at all?
 *
 *  Asked by the route before it reads a file, so an unconfigured deployment
 *  answers in a sentence rather than after somebody has waited for a 12 MB
 *  upload to finish.
 */
export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}
