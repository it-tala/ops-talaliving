-- 0284 — money papers go to TRANSACTIONS/<month>/<day> (D359 step 3).
--
-- 0203 wrote the resolver and the smoke, and left the rows for IT to add
-- "once the capture tree is under ops-talaliving", so that no third tree
-- would start beside the two the owner already had. The owner asked for the
-- move on 2026-10-15 (D440): John Lau's `scripts/move_transactions_under_ops`
-- puts the month folders under `ops-talaliving/TRANSACTIONS` on the
-- ACCOUNTING drive, John Lau files by day from then on, and these rows send
-- the app's own uploads to the same day folder.
--
-- Why both sides see one tree now: the app and the Chat bot are the same
-- service account (`capture-worker@john-lau-v01`). `drive.file` shows the app
-- every folder that account made, whichever program made it — only the
-- hand-made root of 2026-09-09 was invisible, which is what the move
-- replaces. `findOrCreatePath` in the upload route finds the month and the
-- day John Lau already made, or makes them and John Lau finds them.
--
-- The three money kinds: the nota, the transfer proof and the bank statement.
-- The tax invoice (L8) keeps its own folder; it is read with the money but
-- filed as a paper of its own.
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('nota',           null, 'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}', 'Beside the Chat captures of the same day (D359, D440).'),
  ('transfer_proof', null, 'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}', 'Beside the Chat captures of the same day (D359, D440).'),
  ('rekening_koran', null, 'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}', 'A statement is money paper too (D359, D440).')
on conflict (kind, entity) do nothing;
