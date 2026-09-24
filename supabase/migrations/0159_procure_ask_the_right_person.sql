-- 0159 — the question names who it is for, only they can answer it, and the
--        card they get carries the money.
--
-- ── What the owner asked for ──────────────────────────────────────────────
--
-- 2026-09-24, on `/procurement/meeting`: *user harus bisa lihat ini approval
-- ke siapa … harusnya user buka google chat bisa baca apa yang perlu di
-- approve, berapa, keterangannya, butuh dana lagi gak? (dengan cash balance
-- BCA 271 dan nominal diminta) … staff beri tombol untuk minta konfirmasi
-- lewat google chat dan ke siapa harus jelas, harus bisa list user mana yang
-- punya roles approval.*
--
-- Four things, and the first one turned out to be impossible rather than
-- missing: **nothing in the database would tell a member of staff who holds the
-- authority.** `authorities_read` on `ops_core.user_authorities` is
-- `user_id = auth.uid() or has_permission('it.manage_roles')`, so a person
-- without IT access can read exactly one row: their own. The board could not
-- name the approver because it was never allowed to look, and
-- `request_approval` papered over it with `order by u.full_name limit 1` —
-- which today picks Evin Oshima over superadmin@ by the accident of where a
-- capital E sorts.
--
-- ── And a hole found on the way in, which had to be closed first ──────────
--
-- `request_approval(p_line_nos, p_to_email => …)` resolved the addressee with
--
--     select * into approver from ops_core.users where email = p_to_email;
--
-- and **never checked that they hold `approve_goods`**. `answer_request` then
-- checked one thing about the answerer — that they are the person the card was
-- addressed to — and **no authority at all**. So:
--
--   1. a person with `procurement.update` sends the batch to their own address;
--   2. the card arrives in their own Chat;
--   3. they press *Setuju*;
--   4. `pr_approvals` gains an approved GOODS row in their name.
--
-- Nothing in that chain is a bug in any one line of code, which is why it
-- survived: each function checked the thing it was about. `0157` had already
-- shut the browser out of `answer_request` — the worker is the only caller —
-- but the worker's whole job is to carry an answer from whoever was addressed,
-- so shutting the browser out does not touch this. **Approving from Chat could
-- not be built on top of it**, and this migration is where it stops.
--
-- The rule now, stated once and enforced at both doors: *the authority to
-- approve goods belongs to a person, it is checked against the person the
-- answer is recorded for, and being the addressee is not a substitute for
-- holding it.* The second door is the load-bearing one — addressing is a
-- request, answering is the decision — and it checks the **named email's**
-- authority, not the session's, because the session belongs to the worker and
-- the decision does not (D69).

-- ── Who may be asked ──────────────────────────────────────────────────────
--
-- Definer, because the point is to see past `authorities_read`, and **without a
-- parameter**, which is the whole of its safety. `authority_holders('post_ledger')`
-- would have been one line shorter and would have handed anybody with a login
-- the map of who can move money. This answers about the two authorities a
-- colleague has a reason to address something to, named in the body where they
-- can be read, and a third is a migration and an argument.
--
-- What it discloses is the org chart: *Evin approves purchases.* Everybody in
-- the room already knows, and the board cannot say *sent to Evin* without it.
create or replace function ops_core.approvers()
returns table (email ops_core.citext, full_name text, authority ops_core.authority_t)
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select u.email, u.full_name, ua.authority
    from ops_core.users u
    join ops_core.user_authorities ua on ua.user_id = u.id
   where ua.authority in ('approve_goods','approve_funds')
     and u.is_active and u.left_on is null
   order by ua.authority, u.full_name;
$$;

revoke execute on function ops_core.approvers() from public;
grant execute on function ops_core.approvers() to authenticated;

comment on function ops_core.approvers is
  'Who may be asked to approve goods or funds — name and address, nothing else. '
  'Definer with no parameter on purpose: a p_authority argument would disclose who '
  'holds post_ledger and it.* to anybody with a login. (0159)';

-- ── Asking ────────────────────────────────────────────────────────────────
--
-- Unchanged except at one point: a named addressee has to hold the authority.
-- The fallback stays — the smoke ladder and `DecisionPanel` both ask without
-- naming anybody, and in a company with one approver naming them is ceremony —
-- but it is now the only road that picks for you, and the answer says who it
-- picked and who else could have been asked, so the screen never has to guess.
create or replace function ops_procure.request_approval(
  p_line_nos text[], p_to_email ops_core.citext default null,
  p_notes jsonb default '{}'::jsonb, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  approver ops_core.users; v_batch_no text; v_batch_id uuid; batch_tok text;
  bare text[] := '{}'; fresh text[] := '{}';
  ln text; l ops_procure.pr_lines; v_approved boolean; supported boolean;
  v_holders jsonb;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','request_approval', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','approval_batch', null,'request',
      'not_permitted','Sending a request for approval needs procurement access.');
  end if;

  -- Everybody who could be asked, read once and used twice: to check the named
  -- one and to name the alternatives in the answer.
  select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'name', a.full_name)
                            order by a.full_name), '[]'::jsonb)
    into v_holders
    from ops_core.approvers() a where a.authority = 'approve_goods';

  if p_to_email is not null then
    -- **Addressing is not granting.** A request sent to somebody who does not
    -- hold the authority cannot be answered by them (`answer_request` refuses
    -- it too), so refusing here saves a card nobody could act on — and the
    -- reason names who can, because the person sending it is trying to find
    -- out.
    select u.* into approver from ops_core.users u
      join ops_core.user_authorities ua on ua.user_id = u.id
     where u.email = p_to_email and ua.authority = 'approve_goods'
       and u.is_active and u.left_on is null;
    if not found then
      return ops_core.invalid('procurement','approval_batch', null,'request',
        'not_an_approver',
        format('%s does not hold the authority to approve goods, so they cannot answer this.',
               p_to_email),
        jsonb_build_object('field','to_email', 'approvers', v_holders));
    end if;
  else
    select u.* into approver from ops_core.users u
      join ops_core.user_authorities ua on ua.user_id = u.id
     where ua.authority = 'approve_goods' and u.is_active and u.left_on is null
     order by u.full_name limit 1;
    if not found then
      return ops_core.conflict('procurement','approval_batch', null,'request',
        'no_approver',
        'Nobody currently holds the authority to approve goods, so there is no one to ask.');
    end if;
  end if;

  foreach ln in array coalesce(p_line_nos, '{}') loop
    select * into l from ops_procure.pr_lines where line_no_full = ln;
    continue when not found or l.removed_at is not null;

    select coalesce(a.approved, false) into v_approved
      from ops_procure.v_line_approval a where a.line_id = l.id and a.step = 'GOODS';
    continue when coalesce(v_approved, false);
    -- Already asked. Asking twice is nagging, not a record — and the partial
    -- unique index in `0009` would refuse the second card anyway.
    continue when exists (select 1 from ops_procure.v_pending_request r where r.line_id = l.id);

    select coalesce(e.has_support, false) into supported
      from ops_procure.v_line_evidence e where e.line_id = l.id;
    if coalesce(supported, false) then
      fresh := fresh || ln;
    else
      bare := bare || ln;
    end if;
  end loop;

  if array_length(bare, 1) > 0 then
    return ops_core.invalid('procurement','approval_batch', null,'request',
      'support_required',
      format('%s of these have nothing behind them — %s. Attach the shop link, the invoice or the bill before asking anybody to decide.',
             array_length(bare, 1), array_to_string(bare, ', ')),
      jsonb_build_object('field','documents','lines', to_jsonb(bare)));
  end if;

  if coalesce(array_length(fresh, 1), 0) = 0 then
    return ops_core.conflict('procurement','approval_batch', null,'request',
      'nothing_to_ask',
      'Nothing to send — every one of those is already decided or already waiting for an answer.');
  end if;

  v_batch_no := ops_core.next_doc_number('ask');
  -- Unguessable and **never derived from the batch number**. The token is what
  -- the chat card carries back, so a predictable one would let anybody who can
  -- guess a document number answer somebody else's list — and two sends
  -- deriving the same token would answer each other's.
  batch_tok := ops_core.new_token();

  insert into ops_procure.approval_batches
    (batch_no, token, sent_to, sent_to_email, sent_by, sent_by_email, channel)
  values (v_batch_no, batch_tok, approver.full_name, approver.email,
          auth.uid(), ops_procure.actor_email(), 'chat')
  returning id into v_batch_id;

  insert into ops_procure.approval_requests
    (line_id, batch_id, token, sent_to, sent_to_email, sent_by, sent_by_email,
     channel, meeting_note)
  select pl.id, v_batch_id, ops_core.new_token(),
         approver.full_name, approver.email, auth.uid(), ops_procure.actor_email(),
         'chat', nullif(p_notes ->> pl.line_no_full, '')
    from ops_procure.pr_lines pl
   where pl.line_no_full = any(fresh);

  perform ops_core.emit('procurement','procurement.approval.requested', v_batch_no,
    jsonb_build_object('batch_no', v_batch_no, 'to', approver.email,
                       'lines', to_jsonb(fresh)));

  -- `approvers` is additive (F137): a caller that named nobody can now show who
  -- was picked and who else holds it, instead of presenting an implicit choice
  -- as a fact.
  res := ops_core.ok('procurement','approval_batch', v_batch_no,'request',
    jsonb_build_object('batch_no', v_batch_no, 'token', batch_tok,
                       'sent_to', approver.email, 'sent_to_name', approver.full_name,
                       'approvers', v_holders, 'lines', to_jsonb(fresh)));
  return ops_core.idem_remember('procurement','request_approval', p_key, res);
end $$;

-- ── Answering ─────────────────────────────────────────────────────────────
--
-- Unchanged except for the authority check, which is new and is the reason this
-- migration exists. It reads the **named email's** authority rather than
-- `has_authority()`, which would ask about `auth.uid()` — and `auth.uid()` here
-- is the worker's service role, which holds nothing and is not the person
-- deciding (D69, and the same shape as `0157`).
--
-- It is checked at answer time, not at send time, and both: an authority taken
-- away between the card being sent and the card being pressed means the answer
-- does not count, which is the whole point of holding the authority on the
-- person rather than on the card.
create or replace function ops_procure.answer_request(
  p_token text, p_approved boolean, p_answered_by_email ops_core.citext,
  p_instructions text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  r ops_procure.approval_requests; l ops_procure.pr_lines;
  answerer uuid; already boolean; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','answer_request', p_key);
  if replayed is not null then return replayed; end if;

  select * into r from ops_procure.approval_requests where token = p_token;
  if not found then
    return ops_core.not_found('procurement','approval_request', p_token,'answer',
      'That approval card is not one we sent.');
  end if;

  if r.answered_at is not null then
    return ops_core.conflict('procurement','approval_request', p_token,'answer',
      'already_answered',
      format('This was already %s.', r.outcome));
  end if;

  -- The card is addressed, not broadcast. Somebody else's answer on somebody
  -- else's card is not an approval, whatever authority they hold here.
  if lower(p_answered_by_email::text) <> lower(r.sent_to_email::text) then
    return ops_core.refused('procurement','approval_request', p_token,'answer',
      'not_the_approver',
      format('This was asked of %s.', r.sent_to_email),
      jsonb_build_object('expected', r.sent_to_email, 'answered_by', p_answered_by_email));
  end if;

  -- And being the addressee is not the authority. Checked here because this is
  -- where the decision is written, and checked about the person named rather
  -- than the session, which belongs to the worker carrying the answer.
  if not exists (
    select 1 from ops_core.users u
      join ops_core.user_authorities ua on ua.user_id = u.id
     where u.email = p_answered_by_email and ua.authority = 'approve_goods'
       and u.is_active and u.left_on is null)
  then
    return ops_core.refused('procurement','approval_request', p_token,'answer',
      'authority_required',
      format('%s does not hold the authority to approve goods. The answer is logged, not applied.',
             p_answered_by_email),
      jsonb_build_object('required','approve_goods','answered_by', p_answered_by_email));
  end if;

  select * into l from ops_procure.pr_lines where id = r.line_id;

  -- Answered means answered: a line decided in the app leaves the card
  -- standing, and the honest answer to a late reply is that it is stale, not a
  -- second approval row (D69).
  select coalesce(approved, false) into already
    from ops_procure.v_line_approval where line_id = l.id and step = 'GOODS';
  if coalesce(already, false) = p_approved then
    update ops_procure.approval_requests
       set answered_at = now(),
           outcome = case when p_approved then 'approved' else 'declined' end::ops_procure.request_outcome_t
     where id = r.id;
    return ops_core.conflict('procurement','approval_request', p_token,'answer',
      'line_already_decided',
      format('%s was already decided here. The card is closed, and nothing changed.', l.line_no_full));
  end if;

  select id into answerer from ops_core.users where email = p_answered_by_email;

  insert into ops_procure.pr_approvals
    (line_id, step, approved, approved_qty, approved_amount,
     recorded_by, recorded_by_email, channel)
  values (l.id,'GOODS', p_approved,
          case when p_approved then l.qty else null end,
          case when p_approved then l.item_total else null end,
          answerer, p_answered_by_email, r.channel);

  -- The meeting's words prefill the approver's instruction field; sent back
  -- unchanged they become theirs, deliberately and visibly (D127).
  if coalesce(btrim(p_instructions), '') <> '' then
    insert into ops_procure.line_notes (line_id, instructions, recorded_by, recorded_by_email)
    values (l.id, btrim(p_instructions), answerer, p_answered_by_email);
  end if;

  update ops_procure.approval_requests
     set answered_at = now(),
         outcome = case when p_approved then 'approved' else 'declined' end::ops_procure.request_outcome_t
   where id = r.id;

  perform ops_core.emit('procurement','procurement.line.approved', l.line_no_full,
    jsonb_build_object('line_no', l.line_no_full, 'approved', p_approved,
                       'channel', r.channel, 'by', p_answered_by_email));

  res := ops_core.ok('procurement','pr_line', l.line_no_full,
    case when p_approved then 'approve' else 'unapprove' end,
    jsonb_build_object('line_no', l.line_no_full, 'approved', p_approved,
                       'by', p_answered_by_email, 'channel', r.channel));
  return ops_core.idem_remember('procurement','answer_request', p_key, res);
end $$;

-- ── The whole list in one press ───────────────────────────────────────────
--
-- *saya tidak mau approval satu satu tapi kalau urgent kita biarkan.* The board
-- already decides in one act; the card could not, so the same meeting was
-- batched on the screen and one-at-a-time on the phone.
--
-- It delegates to `answer_request` line by line rather than restating its rules
-- (A7): the addressee check, the authority check, the already-decided case and
-- the audit row all happen exactly once in the codebase, and a rule added there
-- tomorrow applies here without anybody remembering to copy it.
--
-- **Per-line outcomes come back, and a partial answer is still an `ok`.** Four
-- of five approved with the fifth already decided in the app is what happened,
-- and collapsing it to a failure would tell the approver their four yeses did
-- not land. It is a `conflict` only when nothing at all could be answered.
--
-- One instruction for the batch, applied to every line it answers — the room
-- says *all of these only if they deliver before the 20th* once, not five
-- times. A line that needs its own words is answered with its own token, which
-- is the *kalau urgent* road and needs nothing added here.
create or replace function ops_procure.answer_batch(
  p_batch_token text, p_approved boolean, p_answered_by_email ops_core.citext,
  p_instructions text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  b ops_procure.approval_batches; r record; one jsonb;
  v_done jsonb := '[]'::jsonb; v_refused jsonb := '[]'::jsonb;
  v_n int := 0; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','answer_batch', p_key);
  if replayed is not null then return replayed; end if;

  select * into b from ops_procure.approval_batches where token = p_batch_token;
  if not found then
    return ops_core.not_found('procurement','approval_batch', null,'answer',
      'That approval card is not one we sent.');
  end if;

  -- The addressee and the authority are both `answer_request`'s to check, and it
  -- does, once per line. Refused here as well only for the batch as a whole, so
  -- the wrong person gets one refusal naming the batch rather than five naming
  -- lines they were never shown.
  if lower(p_answered_by_email::text) <> lower(b.sent_to_email::text) then
    return ops_core.refused('procurement','approval_batch', b.batch_no,'answer',
      'not_the_approver',
      format('%s was asked of %s.', b.batch_no, b.sent_to_email),
      jsonb_build_object('expected', b.sent_to_email, 'answered_by', p_answered_by_email));
  end if;

  for r in
    select q.token, pl.line_no_full
      from ops_procure.approval_requests q
      join ops_procure.pr_lines pl on pl.id = q.line_id
     where q.batch_id = b.id and q.answered_at is null
     order by pl.line_no_full
  loop
    one := ops_procure.answer_request(r.token, p_approved, p_answered_by_email,
                                      p_instructions, null);
    if one ->> 'outcome' = 'ok' then
      v_n := v_n + 1;
      v_done := v_done || to_jsonb(r.line_no_full);
    else
      v_refused := v_refused || jsonb_build_object(
        'line_no', r.line_no_full,
        'code', one -> 'error' ->> 'code',
        'message', one -> 'error' ->> 'message');
    end if;
  end loop;

  if v_n = 0 then
    return ops_core.conflict('procurement','approval_batch', b.batch_no,'answer',
      'nothing_answered',
      case when jsonb_array_length(v_refused) = 0
        then format('%s has already been answered in full.', b.batch_no)
        else format('Nothing on %s could be answered: %s', b.batch_no,
                    v_refused -> 0 -> 'message' #>> '{}') end,
      jsonb_build_object('batch_no', b.batch_no, 'refused', v_refused));
  end if;

  res := ops_core.ok('procurement','approval_batch', b.batch_no,
    case when p_approved then 'approve' else 'decline' end,
    jsonb_build_object('batch_no', b.batch_no, 'approved', p_approved,
                       'answered', v_n, 'lines', v_done,
                       'refused', v_refused, 'by', p_answered_by_email));
  return ops_core.idem_remember('procurement','answer_batch', p_key, res);
end $$;

-- ── What the card says ────────────────────────────────────────────────────
--
-- Every figure on the approver's phone, computed here. The renderer in the bot
-- may not add two numbers together (D217) — a total assembled there is a number
-- on somebody's phone that no seam stands behind — so this answers with the
-- totals already done, and with the components beside them so the card can show
-- the working rather than an unexplained answer.
--
-- The funding question is the owner's, in their words: *butuh dana lagi gak?*
-- Three components and one subtraction, the same three and the same subtraction
-- `MoneyPanel` performs in front of the reader on the board, so the phone and
-- the screen cannot disagree:
--
--   `to_pay_now`   approved already and not yet paid — what BCA 271 owes today
--   `this_batch`   what saying yes to this list adds, net of anything already
--                  paid on those lines (approving a line that was bought first
--                  commits nothing new — D124)
--   `balance`      BCA 271
--   `shortfall`    greatest(to_pay_now + this_batch - balance, 0)
--
-- `BCA 271` by name, as on the board. Four accounts carry `is_paying`, so that
-- flag does not name one, and the account purchases are paid out of is the one
-- the meeting asks about.
--
-- `already_paid` is on the card on purpose, and it is the uncomfortable number:
-- a line with money against it and no approval is money that moved before
-- anybody said yes, and the approver is entitled to see that is what they are
-- being asked to ratify rather than authorise.
--
-- Read-only and `service_role` only, like `po_approval_card` (0143): it carries
-- a live token, and a token in a browser is an approval anybody who can read it
-- may give.
create or replace function ops_procure.approval_card(p_batch_no text)
returns jsonb language sql stable security definer
set search_path = ops_procure, ops_core, ops_acct, pg_temp as $$
  with b as (
    select * from ops_procure.approval_batches where batch_no = p_batch_no
  ), asked as (
    select q.token, l.line_no_full, l.description, l.qty, l.uom, l.unit_price,
           l.item_total, l.purpose, l.project_code, l.vendor_name,
           l.coverage_covered, q.meeting_note
      from ops_procure.approval_requests q
      join b on b.id = q.batch_id
      join ops_procure.v_pr_line l on l.id = q.line_id
     where q.answered_at is null
  ), money as (
    select coalesce(sum(a.item_total), 0)                                   as requested_total,
           coalesce(sum(a.coverage_covered), 0)                             as already_paid,
           coalesce(sum(greatest(a.item_total - a.coverage_covered, 0)), 0)  as this_batch
      from asked a
  ), bank as (
    select coalesce(max(v.balance), 0) as balance
      from ops_acct.v_account_balance v where v.code = 'BCA 271'
  ), owed as (
    select coalesce(sum(e.remaining), 0) as to_pay_now from ops_procure.v_round_eligible e
  )
  select jsonb_build_object(
           'batch_no',   b.batch_no,
           'token',      b.token,
           'to',         b.sent_to_email,
           'to_name',    b.sent_to,
           'asked_by',   b.sent_by_email,
           'asked_at',   b.sent_at,
           'count',      (select count(*) from asked),
           'requested_total', m.requested_total,
           'already_paid',    m.already_paid,
           'funding', jsonb_build_object(
                        'account',    'BCA 271',
                        'balance',    k.balance,
                        'to_pay_now', o.to_pay_now,
                        'this_batch', m.this_batch,
                        'shortfall',  greatest(o.to_pay_now + m.this_batch - k.balance, 0)),
           'lines', coalesce((select jsonb_agg(jsonb_build_object(
                        'token',        a.token,
                        'line_no',      a.line_no_full,
                        'description',  a.description,
                        'qty',          a.qty,
                        'uom',          a.uom,
                        'unit_price',   a.unit_price,
                        'amount',       a.item_total,
                        'purpose',      a.purpose,
                        'project',      a.project_code,
                        'vendor',       a.vendor_name,
                        'already_paid', a.coverage_covered,
                        'meeting_note', a.meeting_note)
                      order by a.line_no_full) from asked a), '[]'::jsonb))
    from b, money m, bank k, owed o;
$$;

revoke execute on function ops_procure.answer_batch(text, boolean, ops_core.citext, text, text)
  from public, authenticated;
grant execute on function ops_procure.answer_batch(text, boolean, ops_core.citext, text, text)
  to service_role;

revoke execute on function ops_procure.approval_card(text) from public, authenticated;
grant execute on function ops_procure.approval_card(text) to service_role;

comment on function ops_procure.answer_batch is
  'Answers every unanswered line of one approval batch, delegating each to answer_request '
  'so the rules live in one place. Partial answers are an ok with the refusals named. '
  'The worker calls this; the browser cannot (D69, 0157). (0159)';

comment on function ops_procure.approval_card is
  'Every fact the Chat approval card shows, figures computed here because a renderer may '
  'not compose one (D217): the lines, the total, what was already paid, and BCA 271 against '
  'what approving this would owe. Carries live tokens — service_role only. (0159)';
