-- 0157 — the answer to an approval card belongs to the worker, not to a browser.
--
-- ── What was open ────────────────────────────────────────────────────────
--
-- `ops_procure.answer_request` (`0016`) records leadership's answer to a
-- request line. Three facts about it met badly:
--
--   1. it is executable by `authenticated`
--   2. it is `security definer`, so RLS on `approval_requests` does not apply
--   3. it takes **`p_answered_by_email` as a parameter**, and checks only that
--      the address matches the one the card was sent to — never that the
--      caller is that person
--
-- and the token is not a secret from signed-in people either: `requests_read`
-- lets anybody holding `procurement.read` select `approval_requests`, and
-- `v_approval_request` puts `token` on the wire.
--
-- So any signed-in user who can open the requests board could read a pending
-- request's token, call
--
--     answer_request(<token>, true, '<leadership address>')
--
-- and the approval would be recorded **against leadership**, with leadership's
-- name in the audit row. No authority required, because the seam never asks the
-- caller for one — it asks the argument.
--
-- ── Why the parameter is right and the grant was wrong ───────────────────
--
-- The parameter is not the bug. D69 is deliberate: the identity on an approval
-- answered in chat comes from the chat platform's own authentication, not from
-- a session, because the meeting laptop is logged in as somebody else. The
-- seam's own comment in `src/lib/api/procurement.ts` says it in as many words —
-- *"Not called from a screen … `answered_by_email` is visibly a parameter
-- rather than something taken from the session."*
--
-- That sentence was true of the intent and false of the catalogue. A seam that
-- trusts its caller to tell the truth about who is answering may be reachable
-- only by a caller that has verified it — and that is the chat worker, whose
-- key never leaves Cloud Run and which puts Google's own verified address in
-- the argument.
--
-- `0143` already drew exactly this line for purchase orders:
--
--     revoke execute on function ops_procure.answer_po_approval(...) from public, authenticated;
--     grant  execute on function ops_procure.answer_po_approval(...) to service_role;
--
-- Request lines were left on the wrong side of it. This is the same line,
-- drawn again, three migrations later. It is the third time a claim about who
-- may call something turned out to live only in a comment (F147, F148).
--
-- ── Nothing live loses a door ────────────────────────────────────────────
--
-- `answerFromChat` is the only caller in `src/`, and the only screen that calls
-- it is `/demo/chat`, which is not in `LIVE_ROUTES` — in production that screen
-- runs against the demo API and never reaches this seam. Leadership answering
-- in the app uses `approve_line`, which reads `auth.uid()` and is untouched.
--
-- ── And it is the door the notification needed ───────────────────────────
--
-- The owner asked for approval cards that can be answered from Google Chat
-- (2026-09-24). The worker has to be able to call this. Closing it to browsers
-- and opening it to the worker is one change, not two: the hole and the missing
-- feature were the same grant, pointed the wrong way.

revoke execute on function
  ops_procure.answer_request(text, boolean, ops_core.citext, text, text)
  from public, authenticated;

grant execute on function
  ops_procure.answer_request(text, boolean, ops_core.citext, text, text)
  to service_role;

comment on function ops_procure.answer_request(text, boolean, ops_core.citext, text, text) is
  'The chat worker only (D69, 0157). It trusts its caller for the answerer''s '
  'address, so its caller must be one that verified it — never a browser '
  'session. Leadership answering in the app uses approve_line.';
