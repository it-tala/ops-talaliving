-- mkt — the outreach funnel: message, wait, chase, and after seven silent days
-- move to the next of the three (D183, D184, D187).
--
--   REFUSALS     a market code that its own country filter would not find; a
--                time zone Postgres has never heard of; a disqualification
--                with no reason; a validation nobody signed; a fourth agent;
--                two agents in one slot; **a DEAL with no representative**;
--                a reply to a message never sent; giving up without saying
--                why; re-importing the same scraped name; deleting anything;
--                reading any of it without marketing
--   DERIVATIONS  the clock is **stamped, not typed** — and a chase does not
--                restart it; a reply stops it wherever on the ladder it
--                arrives; **`RECYCLED` is not `REPLIED`** although the enum
--                sorts it later; a property is at the **furthest** stage one
--                of its agents reached and at no other; everybody approached
--                and nobody left is `exhausted`; the move-on line is a
--                **setting**, so moving it moves today's queue and rewrites
--                nothing; no reply rate over nought messages; one filter,
--                three altitudes
--
-- Worked out first, across AU:  messaged 5 · replied 2 · 2/5 = 40,0%
--                              funnel 1 + 1 + 1 + 1 = 4 = the properties

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008101','mkt81@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008102','tukang81@talaliving.com','{"full_name":"Tukang Kayu"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008101','marketing','write'),
  ('ffffffff-0000-0000-0000-000000008102','production','write');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008101';

/* ── REFUSAL: a code its own country filter could not find ─────────────── */
do $$
begin
  -- Every filter in this module is a prefix of the code. A code that does not
  -- start with its country is simply missing from every country roll-up, and
  -- nothing would raise (D187).
  begin
    insert into ops_mkt.markets (code, country_code, country_name, city, area_label, currency, timezone)
    values ('QLD-GOLDCOAST-SPNORTH','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
    raise exception 'a code that does not start with its country should be refused';
  exception when check_violation then null;
  end;

  -- Lower case would break the same prefix match, one keystroke further away.
  begin
    insert into ops_mkt.markets (code, country_code, country_name, city, area_label, currency, timezone)
    values ('AU-qld-goldcoast','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
    raise exception 'a lower-case code should be refused';
  exception when check_violation then null;
  end;

  -- *What time is it there* is the one question a list of names cannot answer,
  -- and a typo here makes it unanswerable with nothing else noticing.
  begin
    insert into ops_mkt.markets (code, country_code, country_name, city, area_label, currency, timezone)
    values ('AU-QLD-GC-X','AU','Australia','Gold Coast','X','AUD','Australia/Gold_Coast');
    raise exception 'a time zone Postgres does not know should be refused';
  exception when check_violation then
    assert sqlerrm like '%Australia/Gold_Coast is not a time zone%',
      'and the message names it, got ' || sqlerrm;
  end;
end $$;

insert into ops_mkt.markets (code, country_code, country_name, region, city, area_label, currency, timezone) values
  ('AU-QLD-GOLDCOAST-SPNORTH', 'AU','Australia','Queensland','Gold Coast','SP NORTH', 'AUD','Australia/Brisbane'),
  ('AU-QLD-GOLDCOAST-SPMIDDLE','AU','Australia','Queensland','Gold Coast','SP MIDDLE','AUD','Australia/Brisbane'),
  -- A country with no level worth carrying between the country and the city.
  ('ID-BALI-SEMINYAK',         'ID','Indonesia', null,        'Bali',      'Seminyak', 'IDR','Asia/Makassar'),
  -- Scraped, and nobody has been approached here yet. The one market that can
  -- ask *what is our reply rate* and has to be told there is not one.
  ('ID-BALI-UBUD',             'ID','Indonesia', null,        'Bali',      'Ubud',     'IDR','Asia/Makassar');

/* ── REFUSAL: a disqualification keeps its reason; a validation is signed ─ */
do $$
begin
  begin
    insert into ops_mkt.properties (ref, market_code, name, status)
    values ('TL-9001','AU-QLD-GOLDCOAST-SPNORTH','Uji','DISQUALIFIED');
    raise exception 'a bare DISQUALIFIED should be refused — the reason is the point';
  exception when check_violation then null;
  end;
  begin
    insert into ops_mkt.properties (ref, market_code, name, status)
    values ('TL-9002','AU-QLD-GOLDCOAST-SPNORTH','Uji','BATAL');
    raise exception 'a status that is neither should be refused';
  exception when check_violation then null;
  end;
  -- A score is a machine''s opinion until a person agrees with it (D184), so
  -- the agreement has a name on it.
  begin
    insert into ops_mkt.properties (ref, market_code, name, validated)
    values ('TL-9003','AU-QLD-GOLDCOAST-SPNORTH','Uji', true);
    raise exception 'a validation nobody signed should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into ops_mkt.properties (ref, market_code, name, score)
    values ('TL-9004','AU-QLD-GOLDCOAST-SPNORTH','Uji', 6);
    raise exception 'a score of six should be refused';
  exception when check_violation then null;
  end;
end $$;

insert into ops_mkt.properties
  (id, ref, market_code, name, status, is_condo, rooms, adr, score, validated, validated_by, validated_at)
values
  ('dddd8100-0000-0000-0000-0000000000c1','TL-0001','AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites','QUALIFIED',
    true, 180, 320, 5, true,'ffffffff-0000-0000-0000-000000008101', now()),
  ('dddd8100-0000-0000-0000-0000000000c2','TL-0002','AU-QLD-GOLDCOAST-SPNORTH','Oracle Boulevard','QUALIFIED',
    true, 90, 410, 3, false, null, null),
  ('dddd8100-0000-0000-0000-0000000000c3','TL-0003','AU-QLD-GOLDCOAST-SPMIDDLE','Sea World Resort',
    'DISQUALIFIED — NOT CONDO', false, 400, 260, 1, false, null, null),
  ('dddd8100-0000-0000-0000-0000000000c4','TL-0004','ID-BALI-SEMINYAK','Villa Kayu','QUALIFIED',
    true, 12, 1850000, 4, false, null, null),
  ('dddd8100-0000-0000-0000-0000000000c5','TL-0005','AU-QLD-GOLDCOAST-SPMIDDLE','Circle on Cavill','QUALIFIED',
    true, 250, 380, 4, false, null, null),
  ('dddd8100-0000-0000-0000-0000000000c6','TL-0007','ID-BALI-UBUD','Kayon Resort','QUALIFIED',
    true, 40, 2400000, 2, false, null, null);

insert into ops_mkt.sales_reps (id, rep_no, name, market_code, commission_percent, created_by)
values ('cccc8100-0000-0000-0000-0000000000b1','agn-81-01','Budi Santoso','AU-QLD-GOLDCOAST-SPMIDDLE', 2.5,
        'ffffffff-0000-0000-0000-000000008101');

/* ── REFUSAL: three agents, in order, and a deal names its rep ─────────── */
do $$
begin
  begin
    insert into ops_mkt.property_agents (property_id, slot, name)
    values ('dddd8100-0000-0000-0000-0000000000c1', 4,'Agen keempat');
    raise exception 'a fourth agent should be refused';
  exception when check_violation then null;
  end;

  -- A deal against nobody is a commission nobody can compute (D185).
  begin
    insert into ops_mkt.property_agents (property_id, slot, name, stage, sent_on)
    values ('dddd8100-0000-0000-0000-0000000000c1', 3,'Agen deal','DEAL', current_date - 5);
    raise exception 'a DEAL with no representative should be refused';
  exception when check_violation then null;
  end;

  -- You cannot answer a message that was never sent.
  begin
    insert into ops_mkt.property_agents (property_id, slot, name, replied_on)
    values ('dddd8100-0000-0000-0000-0000000000c1', 3,'Agen balas', current_date);
    raise exception 'a reply with no message should be refused';
  exception when check_violation then null;
  end;

  -- Giving up says why: it is what the next person reads a year later.
  begin
    insert into ops_mkt.property_agents (property_id, slot, name, stage, sent_on)
    values ('dddd8100-0000-0000-0000-0000000000c1', 3,'Agen lepas','RECYCLED', current_date - 30);
    raise exception 'RECYCLED with no remark should be refused';
  exception when check_violation then null;
  end;
end $$;

insert into ops_mkt.property_agents
  (id, property_id, slot, name, agency, stage, sent_on, replied_on, next_action_on, remark, rep_id)
values
  -- Nine silent days: past the line.
  ('eeee8100-0000-0000-0000-0000000000d1','dddd8100-0000-0000-0000-0000000000c1', 1,'Alice Tan','Ray White',
   'MSG SENT', ops_core.office_day() - 9, null, ops_core.office_day() - 2, null, null),
  -- Three: not yet, but due to be chased today.
  ('eeee8100-0000-0000-0000-0000000000d2','dddd8100-0000-0000-0000-0000000000c1', 2,'Ben Cooper','LJ Hooker',
   'MSG SENT', ops_core.office_day() - 3, null, ops_core.office_day(), null, null),
  ('eeee8100-0000-0000-0000-0000000000d3','dddd8100-0000-0000-0000-0000000000c1', 3,'Cara Lim','Ray White',
   'QUEUED', null, null, null, null, null),
  -- Approached a month ago and given up on. Still *messaged*.
  ('eeee8100-0000-0000-0000-0000000000d4','dddd8100-0000-0000-0000-0000000000c2', 1,'Dan Price','Century 21',
   'RECYCLED', ops_core.office_day() - 30, null, null,'tidak pernah balas, coba tahun depan', null),
  ('eeee8100-0000-0000-0000-0000000000d5','dddd8100-0000-0000-0000-0000000000c2', 2,'Ella Nguyen','Century 21',
   'CALL SET', ops_core.office_day() - 10, ops_core.office_day() - 8, null, null, null),
  -- Never approached at all: an exit, and not a message.
  ('eeee8100-0000-0000-0000-0000000000d6','dddd8100-0000-0000-0000-0000000000c3', 1,'Frank Ho', null,
   'SKIP', null, null, null,'hotel, bukan strata', null),
  ('eeee8100-0000-0000-0000-0000000000d7','dddd8100-0000-0000-0000-0000000000c5', 1,'Budi Santoso','Ray White',
   'DEAL', ops_core.office_day() - 20, ops_core.office_day() - 18, null, null,
   'cccc8100-0000-0000-0000-0000000000b1');

/* ── REFUSAL: two agents cannot share a slot ───────────────────────────── */
do $$
begin
  begin
    insert into ops_mkt.property_agents (property_id, slot, name)
    values ('dddd8100-0000-0000-0000-0000000000c1', 2,'Agen bentrok');
    raise exception 'two agents in one slot should be refused — which one is next?';
  exception when unique_violation then null;
  end;
end $$;

/* ── DERIVATION: the clock is stamped, and a chase does not restart it ─── */
do $$
declare a record; v_first date;
begin
  -- A fresh agent messaged for the first time.
  insert into ops_mkt.property_agents (id, property_id, slot, name)
  values ('eeee8100-0000-0000-0000-0000000000d8','dddd8100-0000-0000-0000-0000000000c4', 1,'Gita Sari');
  update ops_mkt.property_agents set stage = 'MSG SENT'
   where id = 'eeee8100-0000-0000-0000-0000000000d8';

  select * into a from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d8';
  assert a.sent_on = ops_core.office_day(),
    'the clock starts on the office day, not the server''s, got ' || coalesce(a.sent_on::text,'(null)');
  assert a.next_action_on = ops_core.office_day() + 7,
    'and the chase is seven days out, got ' || coalesce(a.next_action_on::text,'(null)');
  v_first := a.sent_on;

  -- Chasing is not sending again. A row re-marked MSG SENT must not push the
  -- seven days out, or an agent can be chased for ever and never moved on.
  update ops_mkt.property_agents set stage = 'MSG SENT', remark = 'diingatkan lagi'
   where id = 'eeee8100-0000-0000-0000-0000000000d8';
  select * into a from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d8';
  assert a.sent_on = v_first, 'the clock is not restarted by a chase, got ' || coalesce(a.sent_on::text,'(null)');

  -- A reply stops it, **wherever on the ladder the answer arrives**: somebody
  -- who books a call has replied, whether or not anybody clicked REPLIED on
  -- the way past.
  update ops_mkt.property_agents set stage = 'CALL SET'
   where id = 'eeee8100-0000-0000-0000-0000000000d8';
  select * into a from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d8';
  assert a.replied_on = ops_core.office_day(), 'the reply is stamped too, got ' || coalesce(a.replied_on::text,'(null)');
  assert a.next_action_on is null, 'and a reply ends the chase';

  -- **Only if there was a message to answer.** An agent met at an event and
  -- signed the same week never sat in silence: stamping a reply for them would
  -- write a date against a message that does not exist, and
  -- `replied_after_sent` would refuse the whole write (F117). Nothing is
  -- invented to paper over it — the row says a deal happened and says nobody
  -- recorded messaging them, both of which are true.
  insert into ops_mkt.property_agents (id, property_id, slot, name)
  values ('eeee8100-0000-0000-0000-0000000000d9','dddd8100-0000-0000-0000-0000000000c4', 2,'Hasan Basri');
  update ops_mkt.property_agents set stage = 'PRESENTATION'
   where id = 'eeee8100-0000-0000-0000-0000000000d9';
  select * into a from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d9';
  assert a.stage = 'PRESENTATION', 'the stage is recorded, got ' || coalesce(a.stage::text,'(null)');
  assert a.sent_on is null,    'and nobody messaged them, which is what happened';
  assert a.replied_on is null, 'so there is no reply date to invent';
end $$;

/* ── DERIVATION: waiting, and the line — `RECYCLED` is not `REPLIED` ───── */
do $$
declare v record;
begin
  select * into v from ops_mkt.v_property_agent where id = 'eeee8100-0000-0000-0000-0000000000d1';
  assert v.waiting_days = 9,  'nine silent days, got ' || coalesce(v.waiting_days::text,'(null)');
  assert v.move_on,           'which is past the line';
  assert v.due,               'and its chase date has gone by';

  select * into v from ops_mkt.v_property_agent where id = 'eeee8100-0000-0000-0000-0000000000d2';
  assert v.waiting_days = 3,  'three, got ' || coalesce(v.waiting_days::text,'(null)');
  assert not v.move_on,       'not yet past the line';
  assert v.due,               'but due to be chased today';

  -- An agent who answered is not waiting. Waiting stops being a number the
  -- moment it stops being true.
  select * into v from ops_mkt.v_property_agent where id = 'eeee8100-0000-0000-0000-0000000000d5';
  assert v.waiting_days is null, 'somebody who replied is not waiting';
  assert not v.move_on,          'and is nobody''s move-on';

  -- **The trap the enum sets.** `RECYCLED` is declared after `DEAL`, so a
  -- plain `stage >= 'REPLIED'` would count an agent we gave up on as one who
  -- answered. Rank is null for an exit, and every comparison then answers no.
  assert ops_mkt.stage_rank('RECYCLED') is null, 'RECYCLED is not on the ladder';
  assert ops_mkt.stage_rank('SKIP')     is null, 'nor is SKIP';
  assert ops_mkt.stage_rank('DEAL') > ops_mkt.stage_rank('FORM BACK'), 'and the ladder itself is ordered';

  select * into v from ops_mkt.v_property_agent where id = 'eeee8100-0000-0000-0000-0000000000d4';
  assert v.waiting_days = 30, 'thirty days of silence, got ' || coalesce(v.waiting_days::text,'(null)');
  assert not v.move_on,       'but an agent already dropped is not somebody to move on from';
end $$;

/* ── DERIVATION: a property is at ONE stage, the furthest ──────────────── */
do $$
declare p record; n int;
begin
  select * into p from ops_mkt.v_property where ref = 'TL-0001';
  assert p.agents = 3,                 'three agents, got ' || coalesce(p.agents::text,'(null)');
  assert p.best_stage = 'MSG SENT',    'the furthest any of them reached, got ' || coalesce(p.best_stage::text,'(null)');
  assert p.next_agent = 'Alice Tan',   'the first still in play, by slot, got ' || coalesce(p.next_agent,'(null)');
  assert p.agents_past_the_line = 1,   'one of them, got ' || coalesce(p.agents_past_the_line::text,'(null)');
  assert not p.exhausted,              'there are still agents to try';
  assert p.market_label = 'Gold Coast · SP NORTH', 'got ' || coalesce(p.market_label,'(null)');

  -- Slot 1 was dropped, so the next one to chase is slot 2 — not slot 1 again.
  select * into p from ops_mkt.v_property where ref = 'TL-0002';
  assert p.best_stage = 'CALL SET',    'got ' || coalesce(p.best_stage::text,'(null)');
  assert p.next_agent = 'Ella Nguyen', 'a dropped agent is not the next move, got ' || coalesce(p.next_agent,'(null)');

  -- Everybody approached, nobody agreed: back on the pile rather than sitting
  -- in the funnel for ever.
  select * into p from ops_mkt.v_property where ref = 'TL-0003';
  assert p.exhausted,                  'one agent, skipped, and nothing left to try';
  assert p.next_agent is null,         'and nobody to chase';
  assert not p.qualified,              'it was disqualified, and the row says so';
  assert p.status = 'DISQUALIFIED — NOT CONDO', 'with the reason in the string, got ' || coalesce(p.status,'(null)');

  -- A property whose only agent is an exit is at **QUEUED**, not at nothing:
  -- *nobody is on the ladder here* is an answer, and a property missing from
  -- the funnel is a property nobody chases.
  assert p.best_stage = 'QUEUED',      'got ' || coalesce(p.best_stage::text,'(null)');

  -- **A property with an agent at DEAL is not also a property at QUEUED.**
  -- The funnel adds up to the properties, once each, or it is not a funnel.
  select sum(f.properties) into n from ops_mkt.funnel('AU') f;
  assert n = 4, 'the funnel counts each property once, got ' || coalesce(n::text,'(null)');
  assert (select properties from ops_mkt.funnel('AU') where stage = 'DEAL') = 1,
    'one deal';
  assert (select properties from ops_mkt.funnel('AU') where stage = 'QUEUED') = 1,
    'and the skipped one, which never got a message, is still QUEUED';
end $$;

/* ── DERIVATION: the numbers, and no rate over nothing ─────────────────── */
do $$
declare s ops_mkt.pipeline_t;
begin
  s := ops_mkt.pipeline('AU');
  assert s.properties = 4, 'four on the coast, got ' || coalesce(s.properties::text,'(null)');
  assert s.qualified = 3,  'one was disqualified, got ' || coalesce(s.qualified::text,'(null)');
  assert s.validated = 1,  'and only one has been checked by a person (D184), got '
    || coalesce(s.validated::text,'(null)');
  -- An agent you gave up on **was** messaged, and still counts: `sent_on` is
  -- what says so, and dropping somebody does not clear it.
  assert s.messaged = 5,   'four approached plus the one dropped, got ' || coalesce(s.messaged::text,'(null)');
  assert s.replied = 2,    'got ' || coalesce(s.replied::text,'(null)');
  assert s.reply_rate = 40.0, '2 of 5, got ' || coalesce(s.reply_rate::text,'(null)');
  assert s.forms_back = 1, 'only the deal is past FORM BACK, got ' || coalesce(s.forms_back::text,'(null)');
  assert s.deals = 1,      'got ' || coalesce(s.deals::text,'(null)');

  -- **No rate over nothing.** Nought messages is not a nought per cent reply
  -- rate; a zero on that tile reads as bad outreach rather than as none.
  -- **No rate over nothing.** Ubud has been scraped and nobody approached.
  s := ops_mkt.pipeline('ID-BALI-UBUD');
  assert s.properties = 1,     'one property in Ubud, got ' || coalesce(s.properties::text,'(null)');
  assert s.messaged = 0,       'and nobody messaged, got ' || coalesce(s.messaged::text,'(null)');
  assert s.replied = 0,        'so nobody replied either';
  assert s.reply_rate is null,
    'nought messages is not a nought per cent reply rate — a zero on that tile reads as bad outreach rather than as none, got '
    || coalesce(s.reply_rate::text,'(null)');

  s := ops_mkt.pipeline('ID');
  assert s.properties = 2,     'the villa and the resort, got ' || coalesce(s.properties::text,'(null)');
  -- Two agents there now: one messaged who answered, and one at PRESENTATION
  -- whom nobody recorded messaging. **Counted as events, not as rungs** — the
  -- second is in neither figure, because no message went out and therefore no
  -- silence was ended. Counting rungs would have put them in the numerator
  -- alone and made the reply rate 200% (F117).
  assert s.messaged = 1,       'got ' || coalesce(s.messaged::text,'(null)');
  assert s.replied = 1,        'got ' || coalesce(s.replied::text,'(null)');
  assert s.messaged = 1,       'messaged once during the clock test, got ' || coalesce(s.messaged::text,'(null)');
  assert s.replied = 1,        'and it replied, got ' || coalesce(s.replied::text,'(null)');

  -- One filter, three altitudes: a prefix of the code (D187).
  s := ops_mkt.pipeline('AU-QLD-GOLDCOAST');
  assert s.properties = 4,     'the city is every district in it, got ' || coalesce(s.properties::text,'(null)');
  s := ops_mkt.pipeline('AU-QLD-GOLDCOAST-SPNORTH');
  assert s.properties = 2,     'one district, got ' || coalesce(s.properties::text,'(null)');
  s := ops_mkt.pipeline();
  assert s.properties = 6,     'everywhere, got ' || coalesce(s.properties::text,'(null)');
end $$;

/* ── DERIVATION: the market, resolved once ─────────────────────────────── */
do $$
declare m record;
begin
  select * into m from ops_mkt.v_market where code = 'AU-QLD-GOLDCOAST-SPNORTH';
  assert m.full_path = 'Australia · Queensland · Gold Coast · SP NORTH',
    'got ' || coalesce(m.full_path,'(null)');
  assert m.properties = 2, 'got ' || coalesce(m.properties::text,'(null)');

  -- A country with no level between it and the city leaves no gap in the path.
  select * into m from ops_mkt.v_market where code = 'ID-BALI-SEMINYAK';
  assert m.full_path = 'Indonesia · Bali · Seminyak', 'got ' || coalesce(m.full_path,'(null)');
  -- What time it is **there** is the one question a list of names cannot
  -- answer, so the market answers it.
  assert m.local_time is not null, 'the market knows its own clock';
  assert m.local_time <> (now() at time zone 'Australia/Brisbane'),
    'and Bali is not Brisbane';
end $$;

/* ── DERIVATION: the line is a setting, and moving it moves the queue ──── */
do $$
declare n int;
begin
  select count(*) into n from ops_mkt.v_followup_queue where kind = 'move_on';
  assert n = 1, 'one agent past the line at seven days, got ' || n;
  -- Already late first, then merely due.
  assert (select kind from ops_mkt.v_followup_queue limit 1) = 'move_on',
    'the top of the list is the thing that is already late';
end $$;

-- Moving it. `ops_core.settings` carries a write policy and no UPDATE **grant**
-- (`0003`), so changing one is a deploy, not a user action — which is why this
-- steps out of the role rather than granting the fixture something the real
-- system does not have.
reset role;
update ops_core.settings set value = '3'::jsonb where key = 'mkt.agent_move_on_days';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008101';

do $$
declare n int;
begin
  select count(*) into n from ops_mkt.v_followup_queue where kind = 'move_on';
  assert n = 2, 'at three days the three-day agent joins them, got ' || n;

  -- And nothing was rewritten to make that true: `move_on` is a predicate, not
  -- a column somebody maintains, so moving the line moves **today's queue**
  -- and leaves every date where it was (D183).
  assert (select sent_on from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d2')
         = ops_core.office_day() - 3, 'no history moved';
end $$;

reset role;
update ops_core.settings set value = '7'::jsonb where key = 'mkt.agent_move_on_days';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008101';

/* ── REFUSAL: re-importing the scrape adds nothing, and nothing is deleted */
insert into ops_mkt.scrape_rows (market_code, name, enriched, property_ref) values
  ('AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites', true,'TL-0001'),
  ('AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach', true, null),
  ('AU-QLD-GOLDCOAST-SPNORTH','Hilton Surfers', false, null);

do $$
declare v record;
begin
  begin
    insert into ops_mkt.scrape_rows (market_code, name) values
      ('AU-QLD-GOLDCOAST-SPNORTH','meriton suites');
    raise exception 'the same hotel twice in one market should be refused — a re-import adds nothing';
  exception when unique_violation then null;
  end;

  select * into v from ops_mkt.v_scrape_by_market where market_code = 'AU-QLD-GOLDCOAST-SPNORTH';
  assert v.scraped = 3,   'got ' || coalesce(v.scraped::text,'(null)');
  assert v.enriched = 2,  'got ' || coalesce(v.enriched::text,'(null)');
  assert v.converted = 1, 'one became a property, got ' || coalesce(v.converted::text,'(null)');
  -- The currency is named beside the count, because nothing in this module
  -- adds two of them together and no rate is invented to make it possible.
  assert v.currency = 'AUD', 'got ' || coalesce(v.currency,'(null)');

  begin
    delete from ops_mkt.property_agents where id = 'eeee8100-0000-0000-0000-0000000000d4';
    raise exception 'deleting an agent who said no should be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── REFUSAL: outreach is marketing's alone ────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008102';
do $$
declare n int; s ops_mkt.pipeline_t;
begin
  assert not ops_core.has_permission('marketing.read'), 'the workshop is not marketing';
  -- Unlike `referrals`, which accounting must see because it pays them, there
  -- is no money in the outreach half and nobody else has business in it.
  -- Each table, not only the view: a view that joins four of them comes back
  -- empty the moment **any** one of the four refuses, so counting the view
  -- would leave three policies untested.
  select count(*) into n from ops_mkt.markets;
  assert n = 0, 'the markets are marketing''s own, got ' || n;
  select count(*) into n from ops_mkt.properties;
  assert n = 0, 'and the properties, got ' || n;
  select count(*) into n from ops_mkt.property_agents;
  assert n = 0, 'and who has been approached, got ' || n;
  select count(*) into n from ops_mkt.scrape_rows;
  assert n = 0, 'and the scrape, got ' || n;

  select count(*) into n from ops_mkt.v_property;
  assert n = 0, 'who we are chasing is marketing''s own, got ' || n;
  select count(*) into n from ops_mkt.v_followup_queue;
  assert n = 0, 'and so is today''s queue, got ' || n;
  s := ops_mkt.pipeline('AU');
  assert s.properties = 0, 'the numbers are over rows the reader can see, got '
    || coalesce(s.properties::text,'(null)');
end $$;

rollback;
