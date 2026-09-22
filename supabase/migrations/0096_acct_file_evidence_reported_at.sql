-- 0096_acct_file_evidence_reported_at.sql — the timestamp `file_evidence()`
-- never had a parameter for.
--
-- `evidence_inbox.reported_at` (`0019`) defaults to `now()`, and
-- `file_evidence()` (`0038`) never gave a caller anything else to put there.
-- That is fine for the web road — a person filing a document right now really
-- did report it now — and wrong for chat: a photo sent on the 18th, read by
-- the capture worker on the 21st, and filed by this function at whatever
-- moment it happened to run, has always been stamped with the third time, not
-- the first. Every row a single backfill run touches lands on the same
-- second, which is exactly the symptom that gave this away — dozens of
-- "chat · 2026-09-21 09:06" rows whose own `extracted.document_date` reads
-- the 18th.
--
-- `public.raw_events.received_at` (the capture pipeline's own record of when
-- the chat message arrived) already carries the true moment; nothing before
-- this migration could hand it to `evidence_inbox`. `p_reported_at` closes
-- that — optional, defaulting to `now()`, so a caller that still has nothing
-- better gets exactly today's behaviour. The one-time correction of the rows
-- already filed under the old default is `supabase/legacy/04_backfill_reported_at.sql`,
-- not here: it names `public.raw_events`, so `check_schema_isolation.sh`
-- refuses it inside `supabase/migrations/`, the same reason `03_bridge_review_queue.sql`
-- lives in `supabase/legacy/` rather than here.
drop function if exists ops_acct.file_evidence(
  text, text, text, ops_acct.inbox_origin_t, text, text, bigint, text, jsonb,
  ops_acct.direction_t, text);

create or replace function ops_acct.file_evidence(
  p_ref_id          text,
  p_filename        text,
  p_url             text,
  p_origin          ops_acct.inbox_origin_t default 'chat',
  p_reported_by     text    default null,
  p_mime            text    default null,
  p_bytes           bigint  default null,
  p_sha256          text    default null,
  p_extracted       jsonb   default '{}'::jsonb,
  p_money_direction ops_acct.direction_t default null,
  p_reported_at     timestamptz default null,
  p_key             text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  existing  ops_acct.evidence_inbox;
  reporter  uuid;
  n_match   int;
  att       uuid;
  who       text := nullif(btrim(coalesce(p_reported_by, '')), '');
  res       jsonb;
  replayed  jsonb;
begin
  replayed := ops_core.idem_replay('accounting', 'file_evidence:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_ref_id), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'ref_required','Every filed document needs the source''s own id, so a retry can be recognised.',
      jsonb_build_object('field','ref_id'));
  end if;
  if coalesce(btrim(p_filename), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'filename_required','A document with no name cannot be found again by the person looking for it.',
      jsonb_build_object('field','filename'));
  end if;
  if coalesce(btrim(p_url), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'url_required','Where is the file? A row describing a document nobody can open is not evidence.',
      jsonb_build_object('field','url'));
  end if;

  select * into existing from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if found then
    return ops_core.ok('accounting','inbox', p_ref_id,'file',
      jsonb_build_object('ref_id', p_ref_id, 'status', existing.status, 'already_filed', true),
      null, null);
  end if;

  if who is not null then
    select count(*), (array_agg(u.id))[1] into n_match, reporter
      from ops_core.users u
     where lower(u.email::text) = lower(who) and u.is_active;

    if n_match = 0 then
      select count(*), (array_agg(u.id))[1] into n_match, reporter
        from ops_core.users u
       where lower(u.full_name) = lower(who) and u.is_active;
    end if;

    if n_match > 1 then
      return ops_core.invalid('accounting','inbox', p_ref_id,'file',
        'reporter_ambiguous',
        format('More than one active person is called %L — say which, by email.', who),
        jsonb_build_object('field','reported_by','value',who));
    end if;
    if n_match = 0 then
      reporter := null;
    end if;
  end if;

  reporter := coalesce(reporter, auth.uid());

  if reporter is null then
    return ops_core.invalid('accounting','inbox', p_ref_id,'file',
      'reporter_unresolved',
      coalesce(
        format('Nobody active here is %L. Correct the profile, or pass the email.', who),
        'Say who sent this: no name was given and there is no signed-in caller to assume.'),
      jsonb_build_object('field','reported_by','value', who));
  end if;

  insert into ops_core.attachments
    (url, filename, sha256, mime, bytes, source, uploaded_by)
  values
    (btrim(p_url), btrim(p_filename),
     nullif(btrim(coalesce(p_sha256, '')), ''),
     nullif(btrim(coalesce(p_mime, '')), ''),
     p_bytes,
     case p_origin when 'chat' then 'chat' else 'web' end,
     reporter)
  returning id into att;

  insert into ops_acct.evidence_inbox
    (ref_id, origin, attachment_id, reported_by, reported_at, extracted, money_direction)
  values
    (p_ref_id, p_origin, att, reporter, coalesce(p_reported_at, now()),
     coalesce(p_extracted, '{}'::jsonb), p_money_direction);

  perform ops_core.emit('accounting','accounting.inbox.filed', p_ref_id,
    jsonb_build_object('ref_id', p_ref_id, 'origin', p_origin,
                       'attachment_id', att, 'reported_by', reporter));

  res := ops_core.ok('accounting','inbox', p_ref_id,'file',
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING',
                       'attachment_id', att, 'reported_by', reporter),
    null,
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING'));

  return ops_core.idem_remember('accounting','file_evidence:' || p_ref_id, p_key, res);
end $$;

grant execute on function
  ops_acct.file_evidence(text, text, text, ops_acct.inbox_origin_t, text, text,
                         bigint, text, jsonb, ops_acct.direction_t, timestamptz, text)
  to service_role, authenticated;
