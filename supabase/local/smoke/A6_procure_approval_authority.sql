-- A6 — the approval question names who it is for, and only they can answer it.
--
-- The guard for `0159`. Three of these assertions describe a hole that was open
-- in production until that migration, and the reason they are worth keeping as
-- tests rather than as a note is that each function involved was individually
-- correct:
--
--   * `request_approval` checked the sender's permission and took the
--     addressee's email on trust;
--   * `answer_request` checked that the answerer was the addressee, and no
--     authority at all;
--   * `0157` had shut the browser out of `answer_request`, which does nothing
--     about either of the above because the worker's whole job is to carry an
--     answer from whoever was addressed.
--
-- So a person with `procurement.update` could address a batch to themselves and
-- approve it. Nothing here tests a line of code; it tests the join between
-- three of them, which is where it lived.

begin;

-- Three people: the one who holds the authority, the one who does not and
-- raises the request, and one who holds a different authority entirely.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1','evin@talaliving.com', '{"full_name":"Evin Oshima"}'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','andi@talaliving.com', '{"full_name":"Andi Prasetyo"}'),
  ('aaaaaaaa-0000-0000-0000-0000000000c4','putri@talaliving.com','{"full_name":"Putri Tala"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1','approve_goods'),
  -- Putri moves money and approves nothing. She is here to prove that
  -- `approvers()` does not disclose her.
  ('aaaaaaaa-0000-0000-0000-0000000000c4','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1','procurement','write'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','procurement','write'),
  ('aaaaaaaa-0000-0000-0000-0000000000c4','accounting','write');

-- The account the meeting asks about is already in the ladder, and its balance
-- is deliberately NOT hardcoded below: the assertions read each component from
-- the view it comes from, so they catch a card reading the wrong account or
-- getting the sign of the subtraction backwards, which a fixed number would not.

-- ── who may be asked ──────────────────────────────────────────────────────
do $$
declare v_goods text; v_all text;
begin
  select string_agg(email::text, ',' order by email) into v_goods
    from ops_core.approvers() where authority = 'approve_goods';
  assert v_goods = 'evin@talaliving.com',
         format('only the holder of approve_goods is offered, got %s', v_goods);

  -- The closed list is the safety: `post_ledger` is not an authority a
  -- colleague addresses something to, so it is not disclosed.
  select string_agg(distinct authority::text, ',' order by authority::text) into v_all
    from ops_core.approvers();
  assert v_all = 'approve_goods',
         format('approvers() names only askable authorities, got %s', v_all);
  assert not exists (select 1 from ops_core.approvers() where email = 'putri@talaliving.com'),
         'holding post_ledger does not put somebody on the approver list';
end $$;

-- ── a request, raised by staff ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000a2';

do $$
declare r jsonb; doc text; att uuid;
begin
  r := ops_procure.create_pr(jsonb_build_array(
         jsonb_build_object('description','Plywood 18mm','qty',20,'uom','lembar','unit_price',300000),
         jsonb_build_object('description','Lem kayu','qty',5,'uom','can','unit_price',120000)));
  assert ops_core.said_ok(r), format('got %s', r);
  doc := r -> 'data' ->> 'doc_no';
  perform ops_procure.submit_pr(doc);

  -- Something behind each line, or the send refuses before it reaches anybody
  -- (D125) and this file would be testing that instead.
  insert into ops_core.attachments (url, filename, uploaded_by)
  values ('https://toko.example/plywood','plywood','aaaaaaaa-0000-0000-0000-0000000000a2')
  returning id into att;
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values (att, 'pr_line', doc || '-L01','quotation','aaaaaaaa-0000-0000-0000-0000000000a2'),
         (att, 'pr_line', doc || '-L02','quotation','aaaaaaaa-0000-0000-0000-0000000000a2');
end $$;

-- ── addressing is not granting ────────────────────────────────────────────
--
-- The hole, from the staff end. Andi holds `procurement.update` and no
-- authority; before `0159` this call succeeded and put a live card in his own
-- chat.
do $$
declare r jsonb; doc text;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.request_approval(array[doc || '-L01'], 'andi@talaliving.com');
  assert r -> 'error' ->> 'code' = 'not_an_approver',
         format('a request cannot be addressed to somebody who cannot answer it, got %s', r);
  -- And it says who can, because that is what the sender was trying to find out.
  assert r -> 'error' -> 'detail' -> 'approvers' -> 0 ->> 'email' = 'evin@talaliving.com',
         format('the refusal names who holds it, got %s', r -> 'error' -> 'detail');

  assert not exists (select 1 from ops_procure.approval_batches),
         'and nothing was written on the way to being refused';

  -- Somebody who does not exist at all is the same refusal, not a 404 that
  -- distinguishes "no such person" from "not an approver" for a caller who is
  -- fishing.
  r := ops_procure.request_approval(array[doc || '-L01'], 'nobody@talaliving.com');
  assert r -> 'error' ->> 'code' = 'not_an_approver', format('got %s', r);
end $$;

-- ── addressed properly, and the answer says who else could have been asked ─
do $$
declare r jsonb; doc text; n int;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.request_approval(array[doc || '-L01', doc || '-L02'], 'evin@talaliving.com');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'sent_to' = 'evin@talaliving.com', format('got %s', r);
  assert r -> 'data' ->> 'sent_to_name' = 'Evin Oshima',
         format('the name, so the screen does not print an email at a person, got %s', r);
  assert jsonb_array_length(r -> 'data' -> 'approvers') = 1,
         format('every holder comes back so the board can offer the choice, got %s', r -> 'data');

  select count(*) into n from ops_procure.approval_requests where answered_at is null;
  assert n = 2, format('two cards outstanding, saw %s', n);
end $$;

-- ── the card carries the money ────────────────────────────────────────────
--
-- Read as the worker, because that is the only role that may: it holds live
-- tokens, and a token is an approval anybody who can read it may give.
set local role postgres;
do $$
declare card jsonb; batch text; f jsonb; v_bal numeric; v_owed numeric;
begin
  select batch_no into batch from ops_procure.approval_batches;
  card := ops_procure.approval_card(batch);

  assert (card ->> 'count')::int = 2, format('both lines are on it, got %s', card ->> 'count');
  assert (card ->> 'requested_total')::numeric = 6600000,
         format('20 x 300.000 + 5 x 120.000, got %s', card ->> 'requested_total');
  assert card ->> 'to' = 'evin@talaliving.com', format('got %s', card ->> 'to');
  assert card ->> 'asked_by' = 'andi@talaliving.com', format('got %s', card ->> 'asked_by');
  assert card -> 'lines' -> 0 ->> 'description' = 'Plywood 18mm', format('got %s', card -> 'lines');
  assert (card -> 'lines' -> 0 ->> 'amount')::numeric = 6000000, format('got %s', card -> 'lines');
  -- Each line carries its own token: the *kalau urgent* road, one line answered
  -- on its own without a second seam.
  assert card -> 'lines' -> 0 ->> 'token' is not null, 'each line can be answered alone';

  f := card -> 'funding';
  assert f ->> 'account' = 'BCA 271', format('the account the meeting asks about, got %s', f);

  select balance into v_bal from ops_acct.v_account_balance where code = 'BCA 271';
  assert (f ->> 'balance')::numeric = v_bal,
         format('the balance is BCA 271''s own, not another paying account''s: %s vs %s',
                f ->> 'balance', v_bal);

  select coalesce(sum(remaining), 0) into v_owed from ops_procure.v_round_eligible;
  assert (f ->> 'to_pay_now')::numeric = v_owed,
         format('what is approved and unpaid comes from v_round_eligible, got %s vs %s',
                f ->> 'to_pay_now', v_owed);

  -- Net of anything already paid on these lines — approving a line that was
  -- bought first commits nothing new (D124). Nothing is paid here, so it is the
  -- full 20 x 300.000 + 5 x 120.000.
  assert (f ->> 'this_batch')::numeric = 6600000, format('got %s', f);

  -- The one number the owner asked for: *butuh dana lagi gak?* Checked against
  -- the components read above, so a sign error or the wrong account fails here.
  assert (f ->> 'shortfall')::numeric = greatest(v_owed + 6600000 - v_bal, 0),
         format('what has to move into BCA 271 if this is approved, got %s (owed %s, balance %s)',
                f ->> 'shortfall', v_owed, v_bal);
end $$;

-- ── being the addressee is not the authority ───────────────────────────────
--
-- The hole, from the answering end, and the load-bearing half: the check is on
-- the person the answer is recorded for, not on the session, and it is read at
-- the moment of answering. An authority taken away between the card being sent
-- and the card being pressed means the answer does not count.
set local role postgres;
delete from ops_core.user_authorities
 where user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1' and authority = 'approve_goods';

-- The tokens, taken the way the worker takes them: out of the card. It cannot
-- read `approval_requests` — `service_role` holds no grant on the table — and
-- the card is the whole of what it is given. Kept in a temp table so the rest
-- of this file can answer as the worker without reaching into anything, and the
-- worker's answers are kept beside them so the assertions about rows can be
-- made by somebody allowed to read rows.
create temp table _tok as
  select (c ->> 'token') as batch_token,
         (c -> 'lines' -> 0 ->> 'token') as first_line_token
    from (select ops_procure.approval_card(
                   (select batch_no from ops_procure.approval_batches)) as c) x;
create temp table _said (what text, answer jsonb);
grant select on _tok to service_role;
grant insert on _said to service_role;

set local role service_role;
do $$
declare r jsonb;
begin
  r := ops_procure.answer_request((select first_line_token from _tok), true,
                                  'evin@talaliving.com');
  assert r -> 'error' ->> 'code' = 'authority_required',
         format('the addressee who no longer holds it cannot approve, got %s', r);
  insert into _said values ('one_line_no_authority', r);

  r := ops_procure.answer_batch((select batch_token from _tok), true, 'evin@talaliving.com');
  assert r -> 'error' ->> 'code' = 'nothing_answered',
         format('nor in one press for the whole list, got %s', r);
  assert r -> 'error' -> 'detail' -> 'refused' -> 0 ->> 'code' = 'authority_required',
         format('and the batch names why, per line, got %s', r -> 'error' -> 'detail');
  insert into _said values ('batch_no_authority', r);
end $$;

set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_procure.pr_approvals;
  assert n = 0, format('no approval row was written by either refusal, saw %s', n);
  -- And the cards are still open: a refusal is not an answer, so the real
  -- approver can still act on them once the authority is back.
  select count(*) into n from ops_procure.approval_requests where answered_at is null;
  assert n = 2, format('both cards are still outstanding, saw %s', n);
end $$;

insert into ops_core.user_authorities (user_id, authority)
  values ('aaaaaaaa-0000-0000-0000-0000000000e1','approve_goods');

-- ── the whole list in one press ───────────────────────────────────────────
set local role service_role;
do $$
declare r jsonb;
begin
  -- Somebody else's card is not theirs to answer, whatever they hold.
  r := ops_procure.answer_batch((select batch_token from _tok), true, 'putri@talaliving.com');
  assert r -> 'error' ->> 'code' = 'not_the_approver',
         format('post_ledger is not approve_goods and this is not her card, got %s', r);

  r := ops_procure.answer_batch((select batch_token from _tok), true, 'evin@talaliving.com',
                                'hanya kalau dikirim sebelum tanggal 20');
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'answered')::int = 2,
         format('one press, both lines, got %s', r -> 'data');
  assert jsonb_array_length(r -> 'data' -> 'refused') = 0, format('got %s', r -> 'data');
  insert into _said values ('batch_approved', r);

  -- Answering a batch with nothing left to answer is a conflict that says so,
  -- not a second set of approvals.
  r := ops_procure.answer_batch((select batch_token from _tok), true, 'evin@talaliving.com');
  assert r -> 'error' ->> 'code' = 'nothing_answered',
         format('already answered in full, got %s', r);
  insert into _said values ('batch_again', r);
end $$;

set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_procure.pr_approvals where approved;
  assert n = 2, format('two approvals recorded, saw %s', n);
  select count(*) into n from ops_procure.pr_approvals;
  assert n = 2, format('and the second press added none, saw %s', n);

  -- The batch instruction is recorded on every line it answered, as the
  -- approver's own words (D127).
  select count(*) into n from ops_procure.line_notes
   where instructions = 'hanya kalau dikirim sebelum tanggal 20';
  assert n = 2, format('the instruction rides along to both, saw %s', n);

  -- Recorded as Evin's, from chat — not as the worker's. This is the whole of
  -- D69: the session belongs to the worker, the decision does not.
  select count(*) into n from ops_procure.pr_approvals
   where recorded_by_email = 'evin@talaliving.com' and channel = 'chat';
  assert n = 2, format('recorded as the person who answered, saw %s', n);

  -- Both lines carry an approval the ledger can pay against.
  select count(*) into n from ops_procure.v_line_approval
   where step = 'GOODS' and approved;
  assert n = 2, format('and the tracker agrees, saw %s', n);
end $$;

-- ── the card is empty once the batch is answered ──────────────────────────
do $$
declare card jsonb;
begin
  card := ops_procure.approval_card((select batch_no from ops_procure.approval_batches));
  assert (card ->> 'count')::int = 0,
         format('an answered batch has nothing waiting on it, got %s', card ->> 'count');
  assert (card ->> 'requested_total')::numeric = 0, format('got %s', card);
  assert jsonb_array_length(card -> 'lines') = 0, format('got %s', card);
  -- The funding block is still answered rather than absent: the approver who
  -- opens a stale card should read "nothing waiting", not a blank.
  assert card -> 'funding' ->> 'account' = 'BCA 271', format('got %s', card);
end $$;

-- ── neither seam is reachable from a browser ──────────────────────────────
do $$
declare bad text := '';
begin
  if has_function_privilege('anon',
       'ops_procure.answer_batch(text,boolean,ops_core.citext,text,text)','execute')
     then bad := bad || ' anon/answer_batch'; end if;
  if has_function_privilege('authenticated',
       'ops_procure.answer_batch(text,boolean,ops_core.citext,text,text)','execute')
     then bad := bad || ' authenticated/answer_batch'; end if;
  if has_function_privilege('anon','ops_procure.approval_card(text)','execute')
     then bad := bad || ' anon/approval_card'; end if;
  if has_function_privilege('authenticated','ops_procure.approval_card(text)','execute')
     then bad := bad || ' authenticated/approval_card'; end if;
  -- `approvers()` is the opposite case and must stay open to a signed-in
  -- person: a board that cannot name the approver is the thing 0159 fixed.
  if not has_function_privilege('authenticated','ops_core.approvers()','execute')
     then bad := bad || ' authenticated cannot read approvers()'; end if;
  if has_function_privilege('anon','ops_core.approvers()','execute')
     then bad := bad || ' anon/approvers'; end if;

  assert bad = '', format('execute grants are wrong:%s', bad);
end $$;

rollback;
