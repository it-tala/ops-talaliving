-- core — one attachment per Drive file (0275, L14, F275).
--
--   drive_file_id_of reads the id from web_view_link, url (/d/ and ?id=)
--     and a bare storage_path; a demo path is not one
--   attach_file twice for the same Drive id → one row, the second answers
--     reused; attach_url with that file's link → the same row
--   file_evidence twice for the same url → one attachment, two inbox rows
--   a direct duplicate insert is refused by the index; a folded copy
--     (merged_into set) is allowed beside its survivor and resolves to it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e275','rina-af@talaliving.com','{"full_name":"Rina Af"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e275','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e275','procurement','write');

do $$
begin
  assert ops_core.drive_file_id_of('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', null, null) = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'web_view_link';
  assert ops_core.drive_file_id_of(null, 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345', null) = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'url ?id=';
  assert ops_core.drive_file_id_of(null, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit', null) = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'docs link';
  assert ops_core.drive_file_id_of(null, null, '1AbCdEfGhIjKlMnOpQrStUvWxYz012345') = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'bare id';
  assert ops_core.drive_file_id_of(null, null, 'demo/2026-09/x.jpg') is null, 'a demo path is not an id';
  assert ops_core.drive_file_id_of(null, 'https://tokopedia.com/some/listing', null) is null, 'a shop link is not a Drive file';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e275';
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; a1 uuid; k int;
begin
  r1 := ops_core.attach_file('1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'nota-af.jpg', 'image/jpeg', 1234, null, 'web', 'k-af-1');
  assert r1 ->> 'outcome' = 'ok', format('first attach_file, got %s', r1);
  a1 := (r1 -> 'data' ->> 'attachment_id')::uuid;
  assert not (r1 -> 'data' ->> 'reused')::boolean, 'the first is new';
  r2 := ops_core.attach_file('1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'nota-af-again.jpg', 'image/jpeg', 1234, null, 'web', 'k-af-2');
  assert r2 ->> 'outcome' = 'ok' and (r2 -> 'data' ->> 'attachment_id')::uuid = a1, format('same Drive id = same row, got %s', r2);
  assert (r2 -> 'data' ->> 'reused')::boolean, 'and says so';
  select count(*) into k from ops_core.attachments where drive_file_id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert k = 1, format('one row, got %s', k);

  r3 := ops_core.attach_url('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', 'the same file, pasted', 'k-au-1');
  assert r3 ->> 'outcome' = 'ok' and (r3 -> 'data' ->> 'attachment_id')::uuid = a1 and (r3 -> 'data' ->> 'reused')::boolean, format('a pasted link to it is it, got %s', r3);
  r3 := ops_core.attach_url('https://www.tokopedia.com/toko/engsel', 'listing', 'k-au-2');
  r4 := ops_core.attach_url('https://www.tokopedia.com/toko/engsel', 'listing again', 'k-au-3');
  assert (r3 -> 'data' ->> 'attachment_id') <> (r4 -> 'data' ->> 'attachment_id'), 'a shop link has no file id and may be filed twice';

  r1 := ops_acct.file_evidence('ref-af-1', 'bukti-af.jpg', 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210/view', 'chat', 'rina-af@talaliving.com');
  assert r1 ->> 'outcome' = 'ok', format('file_evidence, got %s', r1);
  r2 := ops_acct.file_evidence('ref-af-2', 'bukti-af-lagi.jpg', 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210/view', 'chat', 'rina-af@talaliving.com');
  assert r2 ->> 'outcome' = 'ok' and r2 -> 'data' ->> 'attachment_id' = r1 -> 'data' ->> 'attachment_id', format('captured again = the same attachment, got %s / %s', r1, r2);
  assert (select count(*) from ops_acct.evidence_inbox where ref_id in ('ref-af-1','ref-af-2')) = 2, 'but two inbox rows, one per capture';
  assert (select count(*) from ops_core.attachments where drive_file_id = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210') = 1, 'one attachment';
end $$;

set local role postgres;
do $$
declare a1 uuid; b uuid;
begin
  select id into a1 from ops_core.attachments where drive_file_id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  begin
    insert into ops_core.attachments (url, filename, source, uploaded_by)
    values ('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', 'dup.jpg', 'web', 'ffffffff-0000-0000-0000-00000000e275');
    raise exception 'a second live row for the same file was accepted';
  exception when unique_violation then null;
  end;
  -- a folded copy sits beside its survivor and resolves to it
  insert into ops_core.attachments (url, filename, source, uploaded_by, merged_into)
  values ('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', 'copy.jpg', 'web', 'ffffffff-0000-0000-0000-00000000e275', a1)
  returning id into b;
  assert ops_core.live_attachment_for('1AbCdEfGhIjKlMnOpQrStUvWxYz012345') = a1, 'the live row is the survivor';
  assert not exists (select 1 from ops_core.v_attachment where id = b::text), 'a folded copy is not listed';
  assert exists (select 1 from ops_core.v_attachment where id = a1::text), 'its survivor is';
end $$;

rollback;
