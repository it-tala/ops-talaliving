-- core/files — the evidence road: the three seams, and the two vocabularies.
--
-- What is proved here:
--
--   a `javascript:` address is refused — a filed link is a thing people click
--   the same file on the same row under the same kind is a no-op, not an error
--   unlinking updates, never deletes: the row and its history survive (A2, A5)
--   a label from the contract (`Receipt / Invoice / Nota`) stores the code `nota`
--   the enum's `purchase_order` reads back as the contract's `po`
--   `duplicate_suspect` is derived, and only the later twin carries it (A3, A6)
--
-- The last one is the derivation that matters most. Identical bytes are a
-- warning and never a refusal: the same receipt really can be photographed
-- twice, and blocking the second one hides it rather than resolving it.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333','maya@talaliving.com', '{"full_name":"Maya"}');

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

-- ── a filed link, and the one scheme that is refused ─────────────────────
do $$
declare r jsonb; v_id uuid;
begin
  r := ops_core.attach_url('javascript:alert(1)');
  -- `refused`, not `invalid`: `audit_log` allows four outcomes and `invalid`
  -- is not one of them (0003). A 422 is a refusal with a field attached.
  assert r ->> 'outcome' = 'refused',
         format('a javascript: address must be refused, got %s', r ->> 'outcome');
  assert (r ->> 'status')::int = 422,
         format('and refused as unprocessable, got %s', r ->> 'status');
  assert r #>> '{error,code}' = 'url_scheme',
         format('and refused for its scheme, got %s', r #>> '{error,code}');

  r := ops_core.attach_url('   ');
  assert r #>> '{error,code}' = 'url_required', 'an empty address is not an address';

  -- The host becomes the title when nobody typed one: `tokopedia.com` reads
  -- better in a chip than the whole query string, and the address is still on
  -- the row.
  r := ops_core.attach_url('https://tokopedia.com/p/amplas-120?ref=x');
  assert r ->> 'outcome' = 'ok', format('a https link should file, got %s', r);
  v_id := (r #>> '{data,attachment_id}')::uuid;

  assert (select filename from ops_core.attachments where id = v_id) = 'tokopedia.com',
         'an untitled link should be named by its host';
  assert (select url from ops_core.attachments where id = v_id) like 'https://tokopedia.com/%',
         'and keep the whole address';
end $$;

-- ── linking: the label, the enum, and the second click ───────────────────
do $$
declare r jsonb; att uuid; link1 uuid; link2 uuid;
begin
  r   := ops_core.attach_file('2026/09/a1.jpg', 'nota-amplas.jpg', 'image/jpeg', 240000, 'sha-aaa');
  att := (r #>> '{data,attachment_id}')::uuid;
  assert r ->> 'outcome' = 'ok', format('recording a stored file should work, got %s', r);

  -- The contract speaks in labels. The database must store the code.
  r := ops_core.attach_link(att, 'po', 'po-26-09-01', 'Receipt / Invoice / Nota');
  assert r ->> 'outcome' = 'ok', format('linking should work, got %s', r);
  link1 := (r #>> '{data,link_id}')::uuid;

  assert (select kind::text from ops_core.attachment_links where id = link1) = 'nota',
         'the label must be stored as its code, or the two vocabularies drift';
  assert (select entity::text from ops_core.attachment_links where id = link1) = 'purchase_order',
         'the contract''s `po` is the enum''s `purchase_order`';

  -- Clicked twice, or two people filed the same nota. Neither is a mistake.
  r := ops_core.attach_link(att, 'po', 'po-26-09-01', 'Receipt / Invoice / Nota');
  assert r ->> 'outcome' = 'noop',
         format('the same link twice is a no-op, got %s', r ->> 'outcome');
  link2 := (r #>> '{data,link_id}')::uuid;
  assert link2 = link1, 'and it points at the link that already exists';

  assert (select count(*) from ops_core.attachment_links
           where attachment_id = att and unlinked_at is null) = 1,
         'one link, not two';

  -- A kind nobody files, named in the message rather than "invalid kind".
  r := ops_core.attach_link(att, 'po', 'po-26-09-01', 'Kwitansi Ajaib');
  assert r #>> '{error,code}' = 'unknown_kind', format('got %s', r #>> '{error,code}');
  assert r #>> '{error,message}' like '%Kwitansi Ajaib%', 'the message should name it';

  r := ops_core.attach_link(att, 'unicorn', 'po-26-09-01', 'Receipt / Invoice / Nota');
  assert r #>> '{error,code}' = 'unknown_entity', format('got %s', r #>> '{error,code}');
end $$;

-- ── what the strip reads, and what unlinking does ────────────────────────
do $$
declare r jsonb; att uuid; lnk uuid; n int; ent text; who text;
begin
  select a.id into att from ops_core.attachments a where a.storage_path = '2026/09/a1.jpg';
  select l.id into lnk from ops_core.attachment_links l where l.attachment_id = att;

  select entity, linked_by into ent, who from ops_core.v_attachment_link where id = lnk::text;
  assert ent = 'po', format('the view speaks the contract''s names, got %s', ent);
  assert who = 'maya@talaliving.com',
         format('a trail nobody can read is a trail nobody checks, got %s', who);

  select covers_count into n from ops_core.v_attachment where id = att::text;
  assert n = 1, format('one record covered, saw %s', n);

  -- Off the record, and still in the database.
  r := ops_core.attach_unlink(lnk);
  assert r ->> 'outcome' = 'ok', format('unlinking should work, got %s', r);

  assert (select count(*) from ops_core.attachment_links where id = lnk) = 1,
         'unlink is an update — the row must survive it (A2, A5)';
  assert (select unlinked_by from ops_core.attachment_links where id = lnk)
         = '33333333-3333-3333-3333-333333333333',
         'and it records who took it off';
  assert not exists (select 1 from ops_core.v_attachment_link where id = lnk::text),
         'but the strip stops showing it';

  select covers_count into n from ops_core.v_attachment where id = att::text;
  assert n = 0, format('and the count follows, saw %s', n);

  -- Already off is the state the caller wanted.
  r := ops_core.attach_unlink(lnk);
  assert r ->> 'outcome' = 'noop', format('unlinking twice is a no-op, got %s', r ->> 'outcome');
end $$;

-- ── the derivation: identical bytes, and which one is the suspect ────────
do $$
declare first_id uuid; second_id uuid; r jsonb;
begin
  select id into first_id from ops_core.attachments where sha256 = 'sha-aaa';
  assert not (select duplicate_suspect from ops_core.v_attachment where id = first_id::text),
         'the first of its bytes is not a duplicate of anything';

  -- The same receipt, photographed again. Recorded, never refused (A6).
  r := ops_core.attach_file('2026/09/a2.jpg', 'nota-amplas-2.jpg', 'image/jpeg', 240000, 'sha-aaa');
  assert r ->> 'outcome' = 'ok',
         format('identical bytes are a warning, never a refusal, got %s', r ->> 'outcome');
  second_id := (r #>> '{data,attachment_id}')::uuid;

  -- Exactly one of any group of identical bytes is the original. That holds
  -- even here, where both rows share an instant: `now()` is the transaction's
  -- clock, so inside one transaction the id is what orders them.
  assert (select count(*) from ops_core.v_attachment
           where id in (first_id::text, second_id::text) and duplicate_suspect) = 1,
         'exactly one of two identical files is the suspect';

  -- And with real time between them — which is every upload that is not part
  -- of the same import — it is the later one.
  update ops_core.attachments set uploaded_at = uploaded_at + interval '1 second'
   where id = second_id;
  assert (select duplicate_suspect from ops_core.v_attachment where id = second_id::text),
         'the later twin is the suspect';
  assert not (select duplicate_suspect from ops_core.v_attachment where id = first_id::text),
         'and the earlier one is not — order decides which, not existence';
end $$;

-- ── the limit is a setting, and it refuses past it ───────────────────────
do $$
declare r jsonb;
begin
  assert ops_core.setting_num('upload.max_bytes') = 26214400,
         'the upload limit should be a setting somebody can change';

  r := ops_core.attach_file('2026/09/big.mp4', 'video.mp4', 'video/mp4', 99999999, null);
  assert r #>> '{error,code}' = 'file_too_large', format('got %s', r #>> '{error,code}');
  -- The message says the size and the limit, because "too large" is a message
  -- somebody has to guess their way out of.
  assert r #>> '{error,message}' like '%25 MB%', 'the message should name the limit';
end $$;

rollback;
