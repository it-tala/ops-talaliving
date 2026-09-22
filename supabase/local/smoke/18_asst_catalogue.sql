-- asst — the catalogue is the security boundary, and no grant lifts a block.
--
-- ── What this file is actually guarding ──────────────────────────────────
--
-- D218 is one sentence: *Berkas 201 and the whole of IT are not reachable from
-- a prompt, at any permission level.* Every way that sentence can quietly stop
-- being true is a thing somebody does while meaning well —
--
--   * giving the person the grant and expecting the block to hold anyway
--   * making somebody an admin of everything, which is the same test with the
--     most generous possible input
--   * "tidying" a blocked row's reason away, leaving a refusal that says
--     nothing and points nowhere
--   * adding an insert policy so IT can manage the catalogue from a screen
--
-- so all four are measured here rather than trusted. The last one is the one
-- that would look most like an improvement in review.
--
-- The other half of the file is F64: a refusal that is about **this person**
-- must not read like a refusal that is about **everybody**, because the first
-- is fixed by asking IT and the second never is.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5570000-0000-0000-0000-000000000001','nobody@talaliving.com','{"full_name":"Nobody"}'),
  ('a5570000-0000-0000-0000-000000000002','reader@talaliving.com','{"full_name":"Reader"}'),
  ('a5570000-0000-0000-0000-000000000003','buyer@talaliving.com', '{"full_name":"Buyer"}'),
  ('a5570000-0000-0000-0000-000000000004','every@talaliving.com', '{"full_name":"Everything"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('a5570000-0000-0000-0000-000000000002','procurement','read'),
  ('a5570000-0000-0000-0000-000000000003','procurement','write');

-- Admin of every module there is. This account is the point of the file: it is
-- the most permissive thing the system can describe, and it still may not ask
-- for a salary.
insert into ops_core.user_modules (user_id, module, level)
  select 'a5570000-0000-0000-0000-000000000004', m, 'admin'
    from unnest(enum_range(null::ops_core.module_t)) m;

/* ── the catalogue itself ──────────────────────────────────────────────── */

do $$
declare n int;
begin
  select count(*) into n from ops_asst.tools;
  assert n = 16, format('sixteen tools were transcribed from the demo, got %s', n);

  select count(*) into n from ops_asst.tools where reach = 'blocked';
  assert n = 5, format('five of them are the owner''s refusals, got %s', n);

  -- Every blocked row explains itself, in both languages, and names a screen.
  -- A table constraint says this too; asserted again because the constraint is
  -- the thing somebody would relax to make a seed pass.
  select count(*) into n from ops_asst.tools
   where reach = 'blocked'
     and (coalesce(blocked_reason_en,'') = '' or coalesce(blocked_reason_id,'') = ''
          or instead_at is null);
  assert n = 0, format('%s blocked tools refuse without saying why or where instead', n);
end $$;

/* ── REFUSAL: no grant lifts `blocked` ─────────────────────────────────── */

set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000004';

do $$
declare r jsonb; t record;
begin
  -- Admin of everything, asking for each of the five in turn.
  for t in select name, module from ops_asst.tools where reach = 'blocked' order by sort_order loop
    r := ops_asst.may_run(t.name);
    assert r -> 'error' ->> 'code' = 'closed',
      format('%s is closed to everybody, and an admin of every module got %s', t.name, r);

    -- And it is the *closed* refusal, not the permission one. If this ever
    -- flips, somebody moved the grant check above the reach check and the
    -- block became a level.
    assert r -> 'error' -> 'detail' ->> 'refused_because' = 'closed',
      format('%s refused for the wrong reason: %s', t.name, r -> 'error' -> 'detail');

    -- The reason is the owner's sentence, not a shrug.
    assert length(r -> 'error' ->> 'message') > 80,
      format('%s refused without explaining itself: %s', t.name, r -> 'error' ->> 'message');
    assert r -> 'error' -> 'detail' ->> 'instead_at' is not null,
      format('%s refused and named nowhere to go', t.name);
  end loop;
end $$;

-- The same, said the other way round: the catalogue this person reads still
-- shows all five as blocked, so the screen cannot draw them as available.
do $$
declare n int;
begin
  select count(*) into n from ops_asst.v_tool_catalogue where may = 'blocked';
  assert n = 5, format('an admin of everything sees five blocked tools, got %s', n);

  select count(*) into n from ops_asst.v_tool_catalogue where may = 'no_grant';
  assert n = 0, format('and nothing else is out of reach for them, got %s', n);
end $$;

/* ── the two refusals are different, and say so ────────────────────────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000001';

do $$
declare r jsonb;
begin
  -- Nobody holds nothing. `procurement.vendor_debt` is open to the prompt and
  -- closed to them — the fix is IT, and the message has to say so.
  r := ops_asst.may_run('procurement.vendor_debt');
  assert r -> 'error' ->> 'code' = 'permission_required', format('got %s', r);
  assert r -> 'error' -> 'detail' ->> 'refused_because' = 'permission',
    format('a permission problem must not read as a closed door (F64), got %s', r -> 'error' -> 'detail');
  assert r -> 'error' ->> 'message' like '%IT%',
    format('and it names who can fix it (A7), got %s', r -> 'error' ->> 'message');
  -- Nobody holds nothing, so it is the *no access at all* sentence.
  assert r -> 'error' ->> 'message' like '%belum punya akses%',
    format('got %s', r -> 'error' ->> 'message');

  -- While the closed one, for the same person, still says closed.
  r := ops_asst.may_run('hr.payroll');
  assert r -> 'error' -> 'detail' ->> 'refused_because' = 'closed', format('got %s', r);
end $$;

/* ── an unknown name is not a refusal ──────────────────────────────────── */

do $$
declare r jsonb;
begin
  r := ops_asst.may_run('hr.payroll_v2');
  assert r -> 'error' ->> 'code' = 'not_found', format('got %s', r);
  -- Deliberately not 403: answering a guessed name with *you may not* would
  -- confirm that the name was real.
  assert (r ->> 'status')::int = 404, format('got %s', r ->> 'status');
end $$;

/* ── grants do what grants do ──────────────────────────────────────────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000002';

do $$
declare r jsonb;
begin
  -- `procurement.read` opens the reads.
  r := ops_asst.may_run('procurement.vendor_debt');
  assert ops_core.said_ok(r), format('a reader may read, got %s', r);

  -- And not the writes, which is the same answer the screen gives.
  r := ops_asst.may_run('procurement.draft_po');
  assert r -> 'error' ->> 'code' = 'permission_required',
    format('drafting a PO needs procurement.write, got %s', r);

  -- *Your access is read-only*, not *you have no access* — this person plainly
  -- does have access, and telling them otherwise sends them to IT to ask for
  -- something they are already holding.
  assert r -> 'error' ->> 'message' like '%melihat%',
    format('a reader short of write is told which of the two it is, got %s',
           r -> 'error' ->> 'message');
  r := ops_asst.may_run('procurement.draft_po', 'en');
  assert r -> 'error' ->> 'message' like '%read-only%', format('got %s', r -> 'error' ->> 'message');

  -- Guidance needs no grant at all: it explains a screen the person may not be
  -- able to open, and says so.
  r := ops_asst.may_run('guide.pay_line');
  assert ops_core.said_ok(r), format('guidance is open to everybody, got %s', r);
end $$;

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000003';

do $$
declare r jsonb; n int;
begin
  r := ops_asst.may_run('procurement.draft_po');
  assert ops_core.said_ok(r), format('procurement.write may draft, got %s', r);
  assert r -> 'data' ->> 'effect' = 'write', format('and it is a write, got %s', r -> 'data');

  -- Four things are out of reach for them and are not blocked: accounting,
  -- inventory, production and project reads.
  select count(*) into n from ops_asst.v_tool_catalogue where may = 'no_grant';
  assert n = 4, format('a buyer is short four open tools, got %s', n);
end $$;

/* ── the language of a refusal is decided here, not at the screen ──────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000001';

do $$
declare r_id jsonb; r_en jsonb;
begin
  r_id := ops_asst.may_run('it.audit', 'id');
  r_en := ops_asst.may_run('it.audit', 'en');
  assert r_id -> 'error' ->> 'message' like 'Modul IT%', format('got %s', r_id -> 'error' ->> 'message');
  assert r_en -> 'error' ->> 'message' like 'The IT module%', format('got %s', r_en -> 'error' ->> 'message');

  -- An unknown language is Indonesian, not an error: the office speaks it, and
  -- refusing to answer because a header was misspelled helps nobody.
  r_id := ops_asst.may_run('it.audit', 'fr');
  assert r_id -> 'error' ->> 'message' like 'Modul IT%', format('got %s', r_id -> 'error' ->> 'message');
end $$;

/* ── REFUSAL: the catalogue is not editable through the API ────────────── */

-- Not by IT, not by the owner, not by anybody: there is no write policy and no
-- grant for one, so every change to this table is a migration with a reason
-- next to it. A security boundary an admin screen can edit is one a single
-- compromised admin session can edit.
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000004';

do $$
declare n int; v_reach text;
begin
  begin
    update ops_asst.tools set reach = 'open' where name = 'hr.payroll';
    get diagnostics n = row_count;
    assert n = 0, 'nobody opens a blocked tool through the API';
  exception when insufficient_privilege then
    null;  -- Refused at the grant, before RLS. Also correct.
  end;

  begin
    insert into ops_asst.tools (sort_order, name, module, level, effect, reach, label_en, label_id)
      values (99, 'hr.payroll_v2', 'payroll', 'read', 'read', 'open', 'x', 'x');
    assert false, 'nobody adds a tool through the API';
  exception when insufficient_privilege or check_violation then
    null;
  end;

  select reach::text into v_reach from ops_asst.tools where name = 'hr.payroll';
  assert v_reach = 'blocked', format('and it did not move, got %s', v_reach);
end $$;

/* ── the constraints that hold the shape ───────────────────────────────── */

set local role postgres;

do $$
begin
  -- A blocked row with no reason is the refusal that says nothing.
  begin
    insert into ops_asst.tools (sort_order, name, module, level, effect, reach, label_en, label_id)
      values (90,'hr.secret','hrd','read','read','blocked','x','x');
    assert false, 'a blocked tool must carry its reason';
  exception when check_violation then null; end;

  -- Guidance that asked for a grant would be a read pretending to be a guide.
  begin
    insert into ops_asst.tools (sort_order, name, module, level, effect, reach, label_en, label_id)
      values (91,'guide.sneaky','hrd','read','guide','open','x','x');
    assert false, 'guidance needs no grant, and may not ask for one';
  exception when check_violation then null; end;

  -- A write that only needed `read` is a write nobody had to be allowed to make.
  begin
    insert into ops_asst.tools (sort_order, name, module, level, effect, reach, label_en, label_id)
      values (92,'procurement.quiet_write','procurement','read','write','open','x','x');
    assert false, 'a write tool asks for write';
  exception when check_violation then null; end;

  -- `admin` is not a level a sentence may ask for.
  begin
    insert into ops_asst.tools (sort_order, name, module, level, effect, reach, label_en, label_id)
      values (93,'it.big','it','admin','write','open','x','x');
    assert false, 'no tool asks for admin';
  exception when check_violation then null; end;
end $$;

rollback;
