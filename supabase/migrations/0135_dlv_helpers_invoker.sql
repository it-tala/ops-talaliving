-- 0135_dlv_helpers_invoker.sql — two internal helpers stop being seams.
--
-- `ops_dlv.move_project` and `ops_dlv.file_evidence` (0132) are called only
-- from inside the delivery seams, never by the app. They were written
-- `security definer` and revoked from `public`, which left them in the one
-- shape 0125's guard refuses: a definer function signed-in people cannot
-- call. Opening them would be wrong — `move_project` checks no permission, it
-- is the step *after* the seam decided.
--
-- They do not need to be definers at all. Called from a definer seam, an
-- invoker function runs as that seam's owner, so every insert and update
-- inside them still has the privileges it had. Called by anyone else they have
-- neither execute nor, if execute were granted, the table rights to do harm.

alter function ops_dlv.move_project(text, text, text[], text) security invoker;
alter function ops_dlv.file_evidence(uuid, text, text, text) security invoker;
