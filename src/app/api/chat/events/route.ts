import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyChatToken } from "@/lib/chat/verify";

/** `POST /api/chat/events` — the Google Chat door in.
 *
 *  ## What Chat is for here, and what it is not
 *
 *  Owner, 2026-09-23: *Google Chat hanya dipakai untuk ingest chat + file
 *  upload dari channel dan notifikasi web app.* Chat carries material in and
 *  notifications out. **Nothing is decided in Chat.** That supersedes the part
 *  of ADR-008 and D16 that had approvals answered there, and it is the reason
 *  this route can exist at all: an approval answered in Chat would need a
 *  Supabase session for the approver, and there is no honest way to mint one
 *  from a webhook.
 *
 *  So a message arrives, its files land in the accounting inbox, and a person
 *  on the web app decides what they are. The five roads out of the inbox
 *  (`resolve_inbox`, `0021`) are unchanged and are still somebody's.
 *
 *  ## The two identities, and why neither is a person's session
 *
 *  **Google is authenticated by signature.** Every Chat request carries a
 *  bearer token Google signed; `src/lib/chat/verify.ts` checks it against
 *  Google's *public* keys. No shared secret exists, so none can leak.
 *
 *  **The database is written by the worker key**, which is what `0038` was
 *  built for and the only reason a `service_role` key is allowed near this
 *  application. Since `0117` that key's entire reach is one verb — measured,
 *  not asserted: `ops_acct.file_evidence` and nothing else, across 189 tables
 *  and 175 functions. A leaked worker key files evidence. It cannot read the
 *  ledger, and this route cannot decide who may file, because it does not
 *  choose the uploader — `file_evidence` resolves the *sender* by email and
 *  then by name, and refuses a name that matches nobody or two people.
 *
 *  That is the difference from `/api/documents/upload`, which uses the
 *  person's cookie and must: there a human is present. Here nobody is, and
 *  pretending otherwise by attributing captured evidence to a robot is exactly
 *  what `0038` refused to do.
 *
 *  ## What it never does
 *
 *  It does not post back. Chat is not asked to confirm anything, and a bot
 *  that writes into the room is one step from a bot whose room membership is
 *  the authorization boundary to the ledger (ADR-008). The reply body is
 *  empty on purpose.
 */

/** The Chat app's project number, from IT. Not a secret — an audience. But
 *  its absence is not a reason to accept everything, so the route refuses. */
function audience(): string | null {
  return process.env.GOOGLE_CHAT_AUDIENCE?.trim() || null;
}

interface ChatAttachment {
  contentName?: string;
  contentType?: string;
  source?: string;
  driveDataRef?: { driveFileId?: string };
  attachmentDataRef?: { resourceName?: string };
}

interface ChatEvent {
  type?: string;
  message?: {
    name?: string;
    text?: string;
    createTime?: string;
    sender?: { displayName?: string; email?: string };
    space?: { name?: string; displayName?: string };
    attachment?: ChatAttachment[];
  };
}

interface Envelope {
  outcome?: string;
  data?: unknown;
  error?: { code?: string; message?: string };
}

/** Chat reads the status, not the body. A refusal says nothing about *why* on
 *  the wire: a caller that can tell a bad signature from a wrong audience can
 *  use this route to find out which one it got wrong. The detail is logged. */
function refuse(status: number, why: string): Response {
  console.warn(`[chat/events] refused ${status}: ${why}`);
  return new Response(null, { status });
}

export async function POST(request: Request): Promise<Response> {
  const aud = audience();
  if (!aud) {
    return refuse(503,
      "GOOGLE_CHAT_AUDIENCE is not set, so no token can be checked. IT sets it to the "
      + "Chat app's project number on the Worker.");
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const verdict = await verifyChatToken(bearer, aud);
  if (!verdict.ok) {
    /* **A key we could not fetch is not a token we rejected.** 503 asks Chat
       to try again; 401 tells it to stop, and a network blip would silently
       become a dead integration. */
    return verdict.code === "keys_unavailable"
      ? refuse(503, `Google's keys were unreachable: ${verdict.detail}`)
      : refuse(401, `${verdict.code}: ${verdict.detail}`);
  }

  let event: ChatEvent;
  try {
    event = (await request.json()) as ChatEvent;
  } catch {
    return refuse(400, "Body was not JSON.");
  }

  /* Chat sends membership changes and card clicks too. Acknowledged and
     ignored — an unrecognised event is not an error, and answering 4xx would
     make Chat retry something that will never succeed. */
  if (event.type && event.type !== "MESSAGE") {
    return Response.json({}, { status: 200 });
  }

  const msg = event.message;
  if (!msg?.name) return refuse(400, "A MESSAGE event with no message.name.");

  /* `sender.email` needs a scope the Chat app may not have been given, so the
     display name is the fallback — and `file_evidence` resolves either, or
     refuses. Deciding here would put a second rule about identity in the one
     place nobody reads (0038). */
  const reportedBy = msg.sender?.email?.trim() || msg.sender?.displayName?.trim() || null;

  const files = msg.attachment ?? [];
  if (files.length === 0) {
    /* **A message with no file is not evidence and gets no row.** The inbox
       holds documents somebody has to identify; `attachment_id` is not null
       because a row without one is a note nobody can act on. Chat text
       arrives as the caption on a file, below, which is how people actually
       send a nota — photo first, words with it. */
    return Response.json({}, { status: 200 });
  }

  const sb = supabaseAdmin();
  const filed: string[] = [];
  const refused: { file: string; reason: string }[] = [];

  for (const [i, att] of files.entries()) {
    const name = att.contentName?.trim() || `chat-${i + 1}`;

    /* **Only Drive-backed files can be carried.** A file uploaded straight
       into Chat lives behind `attachmentDataRef`, and fetching those bytes
       needs the Chat app's own credential — which this deployment does not
       hold and, per the owner, should not. Refusing it by name beats filing a
       row that points at nothing. */
    const driveId = att.driveDataRef?.driveFileId;
    if (!driveId) {
      refused.push({ file: name, reason: "not a Drive file" });
      continue;
    }

    /* `ref_id` is the source's own stable id so a retry is recognised after a
       restart (0038). One message can carry several files, so the index is
       part of it; `message.name` alone would make the second file look like a
       repeat of the first. */
    const refId = `${msg.name}#${i + 1}`;

    const { data, error } = await sb.schema("ops_acct").rpc("file_evidence", {
      p_ref_id: refId,
      p_filename: name,
      p_url: `https://drive.google.com/file/d/${driveId}/view`,
      p_origin: "chat",
      p_reported_by: reportedBy,
      p_mime: att.contentType ?? null,
      /* The caption travels with the file rather than being dropped. It is
         what somebody typed, so it is kept as text for a person to read — it
         is never parsed into an amount here (D217). */
      p_extracted: {
        chat_text: msg.text ?? null,
        space: msg.space?.displayName ?? msg.space?.name ?? null,
        drive_file_id: driveId,
      },
      p_reported_at: msg.createTime ?? null,
      p_key: refId,
    });

    if (error) {
      refused.push({ file: name, reason: error.message });
      continue;
    }
    const env = data as Envelope;
    if (env?.outcome === "ok") filed.push(name);
    else refused.push({ file: name, reason: env?.error?.message ?? "refused" });
  }

  /* Logged rather than replied. A refusal here is usually *this sender is not
     a person this system knows*, and the fix is to correct a profile — which
     is a thing IT does on a screen, not a thing to announce in the room. */
  if (refused.length) {
    console.warn(`[chat/events] ${msg.name}: filed ${filed.length}, refused`, refused);
  }

  return Response.json({}, { status: 200 });
}
