-- 0033_acct_file_evidence.sql — the inbox gains a door in.
--
-- ── The gap this closes ──────────────────────────────────────────────────
--
-- `0019` built `evidence_inbox` and `0021` built `resolve_inbox()`, the five
-- roads out. Nothing was ever written that puts a row **in**. The inbox has an
-- exit and no entrance, which is why it holds 0 rows while the legacy
-- `ledger_review_queue` holds 483, 29 of them still PENDING and the newest
-- arriving this morning from the capture worker.
--
-- The worker cannot be repointed at a table it cannot reach, and it must not be
-- repointed at one it can only reach by writing raw inserts: `attachment_id` is
-- `not null`, so filing evidence is always two rows in two schemas, and two
-- rows written by a client is a half-filed document the first time a network
-- call dies between them.
--
-- ── Why the worker gets a function and not a table grant ─────────────────
--
-- The obvious move is `grant insert on ops_acct.evidence_inbox to service_role`.
-- That hands a key that bypasses every row-level policy in the database to a
-- process running outside it, for the sake of one insert — and ADR-002 is
-- explicit that the service role is for system jobs, which this is, but the
-- narrowness is the whole point of allowing it.
--
-- So `service_role` gets **usage on the schema and execute on this function,
-- and nothing else.** No table grants. Because the function is
-- `security definer`, it can write both rows; because it is the only thing the
-- worker can call, the worker's entire reach into this system is one verb with
-- validated arguments. A compromised worker key can file evidence. It cannot
-- read the ledger, and it cannot resolve anything.
--
-- ── Idempotent on `ref_id`, and a repeat is `ok` rather than an error ────
--
-- A capture worker retries: the network dies, the process restarts, the same
-- chat message is processed twice. If the second call raises, the worker's
-- error handling decides what to do with a message it has already delivered,
-- and the honest answers are all bad. So a `ref_id` already present returns
-- `ok` with `already_filed`, which is the truth — the document is in the
-- inbox — and lets the worker treat success as success.
--
-- `ref_id` is the source's own stable id (`rq-493` for a legacy queue row, a
-- chat message id for a new one), never a uuid we mint, because the worker has
-- to be able to compute it again after a restart without asking us.
--
-- ── It never invents who sent something ──────────────────────────────────
--
-- `attachments.uploaded_by` is `not null`, and the source has a display name in
-- text — `Putri Tala` — not an id. Resolving it is a match on email and then on
-- full name, and **a name that matches nobody, or matches two people, is a
-- refusal.** Defaulting to a system account would put a document in the inbox
-- attributed to nobody in particular, which is worse than it not arriving:
-- the whole value of this table is that somebody can ask who sent this.
--
-- The refusal names the text that failed, so the fix is to correct a profile
-- rather than to read logs.
--
-- ── One policy is deliberately bypassed ──────────────────────────────────
--
-- `attachments_write` checks `uploaded_by = auth.uid()` — you may not upload as
-- somebody else. This function writes `uploaded_by` as the *chat sender*, who
-- is not the caller, and being `security definer` it gets away with it. That is
-- intended and it is the reason the function exists rather than the grant:
-- captured evidence genuinely belongs to the person who sent it, and the only
-- alternatives are attributing every captured document to a robot or widening
-- the policy for everybody.

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

  -- Already here. Not an error — see the header: a retry that raises is a
  -- worker that has to guess.
  select * into existing from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if found then
    return ops_core.ok('accounting','inbox', p_ref_id,'file',
      jsonb_build_object('ref_id', p_ref_id, 'status', existing.status, 'already_filed', true),
      null, null);
  end if;

  -- ── who sent it ────────────────────────────────────────────────────────
  if who is not null then
    -- `array_agg(...)[1]` rather than `min()`: there is no `min(uuid)`, and
    -- the count is what the ambiguity check below actually needs — the id is
    -- only meaningful when that count is exactly one.
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

  -- Falling back to the caller covers the web road, where the person filing is
  -- the person holding the document. It cannot cover the worker, which has no
  -- session — and there the refusal below is correct.
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
    (ref_id, origin, attachment_id, reported_by, extracted, money_direction)
  values
    (p_ref_id, p_origin, att, reporter,
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
                         bigint, text, jsonb, ops_acct.direction_t, text)
  to authenticated;

-- ── the capture worker's entire reach ────────────────────────────────────
--
-- Usage on the two schemas the function touches, and execute on the function.
-- No table grants, no view grants, nothing else. Listed here rather than added
-- by hand in the dashboard so that `rebuild.sh` produces a database with the
-- same surface as production — a permission that exists only in production is
-- a permission nobody can review.
grant usage on schema ops_acct, ops_core to service_role;
grant execute on function
  ops_acct.file_evidence(text, text, text, ops_acct.inbox_origin_t, text, text,
                         bigint, text, jsonb, ops_acct.direction_t, text)
  to service_role;

comment on function ops_acct.file_evidence(text, text, text, ops_acct.inbox_origin_t,
                                           text, text, bigint, text, jsonb,
                                           ops_acct.direction_t, text) is
  'The way a document gets into the inbox: writes the attachment and the inbox row together, '
  'idempotent on ref_id so a capture worker may retry, and refusing rather than guessing when '
  'the sender''s name matches nobody. The only thing service_role may call in ops_*. (0033)';
