-- 0237_acct_file_evidence_fallback_reporter.sql — a document is never lost
-- because the sender's profile is (D390, F238).
--
-- `file_evidence()` (`0038`, `0096`) resolves the name the capture worker hands
-- it — an email, else a full name — against **active** users, and refused the
-- whole document when nobody matched (`reporter_unresolved`). On 2026-10-07 a
-- Google Cloud payment proof (Rp 400.000) sent from the shared Chat account was
-- read by the bot, announced in Chat as *Please confirm on /accounting/verifikasi*,
-- and never reached that screen: the bot names that account "Tala IT", and
-- it@talaliving.com was deactivated on 2026-09-29. The same refusal had already
-- swallowed the Google Cloud September invoice on 2026-10-02. Both refusals sat
-- in `ops_core.audit_log` and nowhere anybody looks.
--
-- A refusal is right when the caller can correct the input. The sender of a
-- chat photo cannot: the worker has already said *done* in Chat, and the paper
-- is in Drive. So when a name was given and resolves to nobody active, the
-- document is filed under the account named by the setting
-- `capture_fallback_reporter` (an email), and the name as it was given is kept
-- in `extracted.reported_as`, which the Verifikasi screen prints beside the
-- reporter. Nothing about who sent it is invented: the row says *filed for
-- shared, sent as Tala IT*.
--
-- What still refuses:
--   * no name at all and no signed-in caller — that is a caller bug, not a
--     profile, and filing it under somebody would hide the bug;
--   * a name matching two active people (`reporter_ambiguous`) — guessing
--     between two real people is worse than asking;
--   * the setting is missing or names nobody active — the old refusal, so a
--     ladder or a project without that account behaves exactly as before.
--
-- Same signature as `0096`, so `create or replace` keeps the function's
-- identity and grants; the grant is restated anyway.

insert into ops_core.settings (key, value, note) values
  ('capture_fallback_reporter', '"shared@talaliving.com"'::jsonb,
   'Email of the account a captured document is filed under when the name the capture worker gives matches nobody active (D390). The given name is kept in extracted.reported_as. Remove it to restore the refusal.')
on conflict (key) do nothing;

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
  existing   ops_acct.evidence_inbox;
  reporter   uuid;
  n_match    int;
  att        uuid;
  who        text := nullif(btrim(coalesce(p_reported_by, '')), '');
  fallback   text;
  sent_as    text;
  extracted_ jsonb := coalesce(p_extracted, '{}'::jsonb);
  res        jsonb;
  replayed   jsonb;
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

  -- A name was given and it is nobody active: file it anyway, under the
  -- fallback account, and keep the name as it was given (D390).
  if reporter is null and who is not null then
    fallback := (select s.value #>> '{}' from ops_core.settings s
                  where s.key = 'capture_fallback_reporter');
    if fallback is not null then
      select u.id into reporter
        from ops_core.users u
       where lower(u.email::text) = lower(btrim(fallback)) and u.is_active;
      if reporter is not null then
        sent_as := who;
        extracted_ := extracted_ || jsonb_build_object('reported_as', who);
      end if;
    end if;
  end if;

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
     extracted_, p_money_direction);

  perform ops_core.emit('accounting','accounting.inbox.filed', p_ref_id,
    jsonb_build_object('ref_id', p_ref_id, 'origin', p_origin,
                       'attachment_id', att, 'reported_by', reporter,
                       'reported_as', sent_as));

  res := ops_core.ok('accounting','inbox', p_ref_id,'file',
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING',
                       'attachment_id', att, 'reported_by', reporter,
                       'reported_as', sent_as),
    null,
    jsonb_build_object('ref_id', p_ref_id, 'status','PENDING'));

  return ops_core.idem_remember('accounting','file_evidence:' || p_ref_id, p_key, res);
end $$;

grant execute on function
  ops_acct.file_evidence(text, text, text, ops_acct.inbox_origin_t, text, text,
                         bigint, text, jsonb, ops_acct.direction_t, timestamptz, text)
  to service_role, authenticated;
