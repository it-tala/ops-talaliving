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
  + "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,parents,driveId";

/** The scope uploads use. `drive.file` lets the service account touch files
 *  **it created** and nothing else — so a mistake here cannot reach the 1.412
 *  documents already in those drives. The broader `drive` scope would let it
 *  read and delete all of them, and nothing about filing an upload needs that.
 *
 *  **What it costs:** the account cannot see a folder a person made. The OPS
 *  folders the owner made by hand (D313) answered *File not found* to the
 *  first real upload (F173). The owner kept `drive.file` and had the app make
 *  its own folder instead: `ops-talaliving`, at the root of each shared drive
 *  (D320). Everything the app files lives under it. */
const SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Read-only, and used for one thing: finding which shared drive a recorded
 *  folder is in. That folder was made by a person, so `drive.file` cannot see
 *  it. `drive.readonly` can, for a member, and it cannot write anything.
 *  Uploads never use it. */
const PROBE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** The app's own folder, at the root of each module's shared drive (D320).
 *  Made by the app, so `drive.file` sees it; every task folder
 *  (`INVENTORY/ITEMS`, …) goes inside it. */
export const APP_FOLDER = "ops-talaliving";

/** A refusal from Google, kept whole rather than flattened into a string.
 *
 *  The route turns it into a sentence a person can act on, and keeps
 *  Google's own answer in the audit row's detail. Before this, both were one
 *  string, so the toast showed a JSON blob and the log showed nothing (F173). */
export class DriveError extends Error {
  constructor(
    /** Which step: `token`, `drive` (finding the shared drive),
     *  `app_folder` (`ops-talaliving`), `folder` (a task folder), `upload`. */
    readonly stage: "token" | "drive" | "app_folder" | "folder" | "upload",
    /** Google's HTTP status. */
    readonly status: number,
    /** Google's message, e.g. *File not found: 16btMm…*. */
    readonly googleMessage: string,
    /** Google's reason, e.g. `notFound`, `insufficientFilePermissions`,
     *  `invalid_grant`. */
    readonly googleReason: string | null,
  ) {
    super(`${stage}: ${status} ${googleMessage}`);
  }
}

async function driveError(stage: DriveError["stage"], res: Response): Promise<DriveError> {
  const text = await res.text();
  let message = text;
  let reason: string | null = null;
  try {
    const body = JSON.parse(text) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === "string") {
      /* The token endpoint's shape: `{ error: "invalid_grant", error_description }`. */
      reason = body.error;
      message = body.error_description ?? body.error;
    } else if (body.error) {
      message = body.error.message ?? text;
      reason = body.error.errors?.[0]?.reason ?? null;
    }
  } catch { /* not JSON — keep the text */ }
  return new DriveError(stage, res.status, message, reason);
}

/** The service account's address, for sentences that tell IT who to add. */
export function serviceAccountEmail(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "(not set)";
}

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string | null;
  /** The folder(s) Drive says the file is in — checked by the upload route
   *  against the folder it asked for (0175). */
  parents: string[];
  /** The shared drive Drive says the file is in. */
  driveId: string | null;
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
async function accessToken(scope: string = SCOPE): Promise<string> {
  const { email, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss: email,
    scope,
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
    throw await driveError("token", res);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** The same service account, for another Google API — the PR recap sheet
 *  (`src/lib/sheets.ts`, D454). One key, one place it is signed. */
export async function googleAccessToken(scope: string): Promise<string> {
  return accessToken(scope);
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
    throw await driveError("upload", res);
  }
  const out = (await res.json()) as {
    id: string; name: string; webViewLink?: string; parents?: string[]; driveId?: string;
  };
  return {
    id: out.id, name: out.name,
    /* Asked for in `fields`, but a field Drive omits is simply absent; the id
       makes the same link, and a row with no way to open its file is the
       thing to avoid. */
    webViewLink: out.webViewLink ?? `https://drive.google.com/file/d/${out.id}/view`,
    parents: out.parents ?? [],
    driveId: out.driveId ?? null,
  };
}

/** Which shared drive a recorded folder is in.
 *
 *  `drive_folders.parent_folder_id` holds a folder the owner made in each
 *  module's shared drive (the hand-made OPS, D313). It is used here only to
 *  find the drive; nothing is filed in it any more (D320). Asked with
 *  `drive.readonly`, because `drive.file` cannot see a folder a person made.
 *  A 404 here means the service account is not a member of that shared drive,
 *  or the id is wrong. */
export async function driveOf(folderId: string): Promise<{ driveId: string; driveName: string | null }> {
  const token = await accessToken(PROBE_SCOPE);
  const res = await fetch(
    `${FILES_URL}/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,driveId`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw await driveError("drive", res);
  const f = (await res.json()) as { driveId?: string; name?: string };
  if (!f.driveId) {
    throw new DriveError("drive", 422,
      `The recorded folder "${f.name ?? folderId}" is in somebody's My Drive, not in a shared drive.`, "notInSharedDrive");
  }
  return { driveId: f.driveId, driveName: await driveName(f.driveId, token) };
}

async function driveName(driveId: string, token: string): Promise<string | null> {
  const d = await fetch(`https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}?fields=name`,
    { headers: { authorization: `Bearer ${token}` } });
  return d.ok ? ((await d.json()) as { name?: string }).name ?? null : null;
}

/** `ops-talaliving` at the root of a shared drive, found or made by the app.
 *
 *  Found only if the app made it: `drive.file` does not see a folder with the
 *  same name that a person made, and makes its own beside it. */
export async function findOrCreateAppFolder(driveId: string): Promise<{ id: string; created: boolean }> {
  const token = await accessToken();
  return findOrMakeFolder(driveId, APP_FOLDER, token, "app_folder");
}

/** A folder by name inside another, found (ignoring case) or made. */
export async function findOrCreateFolder(parentFolderId: string, name: string, token?: string): Promise<string> {
  return (await findOrMakeFolder(parentFolderId, name, token ?? await accessToken(), "folder")).id;
}

async function findOrMakeFolder(
  parentFolderId: string, name: string, bearer: string, stage: DriveError["stage"],
): Promise<{ id: string; created: boolean }> {
  const wanted = name.trim();
  const q = [
    /* `contains` on a name is a case-insensitive prefix match; the exact
       comparison is done below, so `Inventory` is reused rather than
       duplicated as `INVENTORY`. */
    `name contains '${wanted.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${parentFolderId}' in parents`,
    /* A folder somebody binned last month still answers a search, and
       uploading into the bin loses the file quietly. */
    "trashed = false",
  ].join(" and ");

  const search = new URL(FILES_URL);
  search.searchParams.set("q", q);
  search.searchParams.set("fields", "files(id,name)");
  search.searchParams.set("supportsAllDrives", "true");
  search.searchParams.set("includeItemsFromAllDrives", "true");
  /* Without this the search is scoped to My Drive and answers nothing for a
     folder that is plainly there — the same trap as `supportsAllDrives`. */
  search.searchParams.set("corpora", "allDrives");

  const found = await fetch(search, { headers: { authorization: `Bearer ${bearer}` } });
  if (!found.ok) throw await driveError(stage, found);
  const hits = ((await found.json()) as { files?: { id: string; name: string }[] }).files ?? [];
  const hit = hits.find((f) => f.name.trim().toLowerCase() === wanted.toLowerCase());
  if (hit) return { id: hit.id, created: false };

  const made = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: wanted,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  if (!made.ok) throw await driveError(stage, made);
  return { id: ((await made.json()) as { id: string }).id, created: true };
}

/** The task folder under `ops-talaliving` (`ops_core.drive_paths`, 0172):
 *  each segment of `INVENTORY/FINISHED GOODS` found or made in turn. Two
 *  uploads racing on a brand-new folder can each make one; the next upload
 *  reuses the first found, and IT merges the pair by hand — rare, visible, and
 *  harmless to the files. */
export async function findOrCreatePath(appFolderId: string, path: string): Promise<string> {
  const token = await accessToken();
  let at = appFolderId;
  for (const segment of path.split("/").map((x) => x.trim()).filter(Boolean)) {
    at = await findOrCreateFolder(at, segment, token);
  }
  return at;
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

/** What IT → Google Drive shows for one shared drive (read-only).
 *
 *  - `drive`: the shared drive as a member sees it (`drive.readonly`),
 *    found through the recorded drive id or the recorded folder. A 404 means
 *    not a member, or a wrong id. `canAddChildren` false means Viewer or
 *    Commenter, which cannot file.
 *  - `appFolder`: the app's `ops-talaliving` folder as uploads see it
 *    (`drive.file`), when one is recorded.
 */
export interface DriveProbe {
  drive: {
    ok: boolean; status: number; message: string | null;
    driveId: string | null; driveName: string | null; canAddChildren: boolean | null;
  };
  appFolder: { ok: boolean; status: number; message: string | null; name: string | null; trashed: boolean } | null;
}

export async function probeDrive(rec: {
  drive_id: string | null; parent_folder_id: string | null; folder_id: string | null;
}): Promise<DriveProbe> {
  const ro = await accessToken(PROBE_SCOPE);
  let driveId = rec.drive_id;
  let drive: DriveProbe["drive"] = { ok: false, status: 0, message: null, driveId: null, driveName: null, canAddChildren: null };

  if (!driveId && rec.parent_folder_id) {
    const f = await fetch(
      `${FILES_URL}/${encodeURIComponent(rec.parent_folder_id)}?supportsAllDrives=true&fields=driveId`,
      { headers: { authorization: `Bearer ${ro}` } });
    if (f.ok) {
      driveId = ((await f.json()) as { driveId?: string }).driveId ?? null;
      if (!driveId) drive = { ...drive, status: 422, message: "The recorded folder is not in a shared drive." };
    } else {
      const e = await driveError("drive", f);
      drive = { ...drive, status: e.status, message: e.googleMessage };
    }
  }
  if (driveId) {
    const d = await fetch(
      `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}?fields=id,name,capabilities(canAddChildren)`,
      { headers: { authorization: `Bearer ${ro}` } });
    if (d.ok) {
      const j = (await d.json()) as { name?: string; capabilities?: { canAddChildren?: boolean } };
      drive = { ok: true, status: 200, message: null, driveId, driveName: j.name ?? null,
                canAddChildren: j.capabilities?.canAddChildren ?? null };
    } else {
      const e = await driveError("drive", d);
      drive = { ...drive, status: e.status, message: e.googleMessage, driveId };
    }
  }

  let appFolder: DriveProbe["appFolder"] = null;
  if (rec.folder_id) {
    const up = await accessToken();
    const a = await fetch(
      `${FILES_URL}/${encodeURIComponent(rec.folder_id)}?supportsAllDrives=true&fields=id,name,trashed`,
      { headers: { authorization: `Bearer ${up}` } });
    if (a.ok) {
      const j = (await a.json()) as { name?: string; trashed?: boolean };
      appFolder = { ok: true, status: 200, message: null, name: j.name ?? null, trashed: j.trashed ?? false };
    } else {
      const e = await driveError("app_folder", a);
      appFolder = { ok: false, status: e.status, message: e.googleMessage, name: null, trashed: false };
    }
  }
  return { drive, appFolder };
}

/** A picture of a Drive file, fetched as the service account (F175).
 *
 *  The tiles used to point the browser straight at
 *  `drive.google.com/thumbnail?id=…`. That depends on the viewer's own Google
 *  session reaching a shared drive from another site. Blocked third-party
 *  cookies, or a personal Google account in the browser, left the tiles
 *  broken. Google's own documentation says `thumbnailLink` "must be fetched
 *  using a credentialed request" and suggests a proxy. This is that proxy.
 *  Who may see the file is decided before this is called, by the attachment
 *  row the person can read (RLS). This function only carries the picture.
 *
 *  `drive.file` first, because the app made the file. `drive.readonly` next,
 *  for files the legacy capture worker filed, which the app did not make.
 *  Neither can write. When Drive has no thumbnail yet (it makes them a few
 *  seconds after upload), an image is sent whole instead.
 */
export async function fetchThumbnail(fileId: string, width: number): Promise<Response | null> {
  for (const scope of [SCOPE, PROBE_SCOPE]) {
    const token = await accessToken(scope);
    const meta = await fetch(
      `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=thumbnailLink,mimeType`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!meta.ok) continue;
    const m = (await meta.json()) as { thumbnailLink?: string; mimeType?: string };
    if (m.thumbnailLink) {
      /* The link ends in `=s220`; ask for the size the tile needs. */
      const sized = m.thumbnailLink.replace(/=s\d+(-[a-z])?$/, "") + `=s${width}`;
      const img = await fetch(sized, { headers: { authorization: `Bearer ${token}` } });
      if (img.ok) return img;
    }
    if (m.mimeType?.startsWith("image/")) {
      const whole = await fetch(
        `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&alt=media`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (whole.ok) return whole;
    }
    return null;
  }
  return null;
}

/** The bytes of one Drive file, for a server route that has to hand a
 *  document to somebody else — the working drawing to the model (D324).
 *
 *  The same order and the same reason as `fetchThumbnail`: `drive.file` for
 *  what the app made, `drive.readonly` for what it did not. Who may read the
 *  file is decided before this is called, by the attachment row the person
 *  can read. A file over `maxBytes` answers with its size and no bytes, so the
 *  caller can fall back (a big photo to its thumbnail) or say why it stopped.
 */
export async function fetchDriveFile(
  fileId: string, maxBytes: number,
): Promise<{ bytes: ArrayBuffer | null; mime: string; name: string; size: number } | null> {
  for (const scope of [SCOPE, PROBE_SCOPE]) {
    const token = await accessToken(scope);
    const meta = await fetch(
      `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=name,mimeType,size`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!meta.ok) continue;
    const m = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
    const size = Number(m.size ?? 0);
    const out = { mime: m.mimeType ?? "application/octet-stream", name: m.name ?? fileId, size };
    if (size > maxBytes) return { ...out, bytes: null };
    const whole = await fetch(
      `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&alt=media`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!whole.ok) return null;
    return { ...out, bytes: await whole.arrayBuffer() };
  }
  return null;
}
