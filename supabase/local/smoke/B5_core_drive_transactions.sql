-- core — money evidence by month, and the same bytes never filed twice (0203, D359).
--
-- DERIVATIONS  with IT's two rows, a nota and a transfer proof go to
--              TRANSACTIONS/<month>/<day> of the office day; other kinds keep their folders; a chat
--              capture with the same bytes is found for a money kind; a file
--              this app filed in the same drive is preferred over it; other
--              bytes are not found
-- REFUSALS     the same bytes in another drive are not offered (an HRD scan
--              never answers for a nota); a chat capture never answers for a
--              non-money kind; an unknown kind; a hash that is not a hash;
--              nobody signed in

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000b5001','acct-same@talaliving.com','{"full_name":"Accounting"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000b5001','accounting','write');

-- Three files with the same bytes: a chat capture (a link, no drive slug, as
-- `file_evidence` files it), an HRD scan, and — for the second hash — one this
-- app filed in ACCOUNTING after a chat capture of the same bytes.
insert into ops_core.attachments (id, url, filename, sha256, source, uploaded_by, uploaded_at) values
  ('b5000000-0000-0000-0000-0000000000c1','https://drive.google.com/file/d/CHAT1/view','chat.webp',
   repeat('a', 64),'chat','aaaa0000-0000-0000-0000-0000000b5001', now() - interval '2 days'),
  ('b5000000-0000-0000-0000-0000000000c2','https://drive.google.com/file/d/CHAT2/view','chat2.webp',
   repeat('b', 64),'chat','aaaa0000-0000-0000-0000-0000000b5001', now() - interval '2 days');
insert into ops_core.attachments (id, storage_path, filename, sha256, source, uploaded_by, drive_slug, uploaded_at) values
  ('b5000000-0000-0000-0000-0000000000a1','DRIVE_HRD','ktp.jpg',
   repeat('c', 64),'web','aaaa0000-0000-0000-0000-0000000b5001','hrd', now() - interval '3 days'),
  ('b5000000-0000-0000-0000-0000000000a2','DRIVE_ACCT','nota.jpg',
   repeat('b', 64),'web','aaaa0000-0000-0000-0000-0000000b5001','accounting', now() - interval '1 day');

do $$
begin
  assert (ops_core.same_bytes(repeat('a', 64), 'nota'))->'error'->>'code' = 'not_signed_in',
    'nobody signed in must be refused';
end $$;

-- The two rows IT adds once the capture tree is under ops-talaliving (0203).
insert into ops_core.drive_paths (kind, path) values
  ('nota',           'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}'),
  ('transfer_proof', 'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000b5001';

do $$
declare r jsonb; month text := to_char(ops_core.office_day(), 'YYYY-MM'); day text := to_char(ops_core.office_day(), 'YYYY-MM-DD');
begin
  assert ops_core.drive_path_for('nota', null) = 'TRANSACTIONS/' || month || '/' || day,
    'a nota by month and day, got ' || ops_core.drive_path_for('nota', null);
  assert ops_core.drive_path_for('transfer_proof', 'transaction') = 'TRANSACTIONS/' || month || '/' || day,
    'a transfer proof by month and day, got ' || ops_core.drive_path_for('transfer_proof', 'transaction');
  r := ops_core.drive_folder_for('Payment Proof');
  assert r->'data'->>'path' = 'TRANSACTIONS/' || month || '/' || day, 'the route reads the same path, got ' || r::text;
  assert ops_core.drive_path_for('purchase_order', null) = 'PURCHASE ORDER', 'other kinds keep their folder';
  assert ops_core.drive_path_for('foto', 'item') = 'INVENTORY/ITEMS', 'task folders keep their folder';

  r := ops_core.same_bytes(repeat('a', 64), 'Receipt / Invoice / Nota');
  assert (r->'data'->>'found')::boolean and r->'data'->>'attachment_id' = 'b5000000-0000-0000-0000-0000000000c1'
     and r->'data'->>'source' = 'chat', 'a chat capture answers for a nota, got ' || r::text;
  r := ops_core.same_bytes(repeat('b', 64), 'transfer_proof');
  assert r->'data'->>'attachment_id' = 'b5000000-0000-0000-0000-0000000000a2',
    'a file already in the drive is preferred to the chat capture, got ' || r::text;
  r := ops_core.same_bytes(repeat('a', 64), 'purchase_order');
  assert not (r->'data'->>'found')::boolean, 'a chat capture never answers for a procurement kind, got ' || r::text;
  r := ops_core.same_bytes(repeat('c', 64), 'nota');
  assert not (r->'data'->>'found')::boolean, 'an HRD scan never answers for a nota, got ' || r::text;
  r := ops_core.same_bytes(repeat('d', 64), 'nota');
  assert not (r->'data'->>'found')::boolean, 'other bytes are not found, got ' || r::text;

  r := ops_core.same_bytes(repeat('a', 64), 'kwitansi palsu');
  assert r->'error'->>'code' = 'unknown_kind', 'unknown kind, got ' || r::text;
  r := ops_core.same_bytes('not-a-hash', 'nota');
  assert r->'error'->>'code' = 'sha256_required', 'a hash that is not one, got ' || r::text;
end $$;

rollback;
