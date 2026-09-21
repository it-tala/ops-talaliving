-- asst — the router, and the false refusal it is arranged to avoid.
--
-- ── What is actually at stake in the ordering ────────────────────────────
--
-- The blocked rules run first so that somebody asking for a salary is told it
-- is refused, rather than quietly matched to something adjacent that happens
-- to be allowed. That much is obvious and it is half the story.
--
-- The other half is the cost of getting it wrong in the other direction.
-- `terlambat` belongs to two worlds — a person arriving late, and a work order
-- past its promised date — and because the blocked rules run first, an
-- unguarded keyword on `hr.attendance` turns *SPK apa yang terlambat* into a
-- refusal that reads **you were trying to read staff records** (F64).
--
-- A wrong answer can be checked. A false accusation cannot be unread. So the
-- sentences that must not be refused are measured here one by one, and so are
-- the ones that must.
--
-- The rest of the file is the router being allowed to fail, which is the
-- feature: no match is a real answer, and the unmatched prompts are the list
-- of things people expected John Lau to understand.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5570000-0000-0000-0000-000000000011','asker@talaliving.com','{"full_name":"Asker"}'),
  ('a5570000-0000-0000-0000-000000000012','ityoung@talaliving.com','{"full_name":"IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('a5570000-0000-0000-0000-000000000011','procurement','read'),
  ('a5570000-0000-0000-0000-000000000012','it','admin');

/* ── normalising, which is why half the rules match at all ─────────────── */

do $$
begin
  assert ops_asst.normalise('  Stoknya MENIPIS?? ') = 'stok menipis',
    format('got %s', ops_asst.normalise('  Stoknya MENIPIS?? '));
  -- `-nya` is dropped only from a word long enough for it to be possessive.
  -- Without the length guard this eats real words.
  assert ops_asst.normalise('hanya') = 'hanya', format('got %s', ops_asst.normalise('hanya'));
  assert ops_asst.normalise(null) = '', 'a null prompt normalises to nothing';
end $$;

/* ── the sentences that must NOT be refused ────────────────────────────── */

do $$
declare r jsonb; s text;
begin
  foreach s in array array[
    'SPK apa yang terlambat?',
    'spk mana yang telat',
    'produksi yang molor apa saja',
    'which work orders are late'
  ] loop
    r := ops_asst.route(s);
    assert r is not null, format('%s matched nothing', s);
    assert r ->> 'tool' = 'production.late_orders',
      format('"%s" must not be read as a question about people — got %s', s, r ->> 'tool');
  end loop;
end $$;

/* ── and the ones that must ────────────────────────────────────────────── */

do $$
declare r jsonb; s text;
begin
  foreach s in array array[
    'berapa gaji budi',
    'tolong kirim slip gaji bulan ini',
    'what is the payroll this month',
    'siapa yang telat hari ini',
    'absensi minggu ini',
    'nomor ktp karyawan baru',
    'siapa membuka berkas itu kemarin'
  ] loop
    r := ops_asst.route(s);
    assert r is not null, format('%s matched nothing', s);
    assert (select reach from ops_asst.tools where name = r ->> 'tool') = 'blocked',
      format('"%s" must reach a refusal, got %s', s, r ->> 'tool');
  end loop;
end $$;

/* ── a how-question is a how, not a how-many ───────────────────────────── */

do $$
declare r jsonb;
begin
  -- "cara bikin PO" contains "buat po", which is the rule for *build me one*.
  -- The how-stage runs first for exactly this sentence (F64).
  r := ops_asst.route('cara bikin PO gimana ya');
  assert r ->> 'tool' = 'guide.create_po', format('got %s', r);

  r := ops_asst.route('bagaimana cara mencatat barang datang');
  assert r ->> 'tool' = 'guide.receive_goods', format('got %s', r);

  r := ops_asst.route('how do i pay a line');
  assert r ->> 'tool' = 'guide.pay_line', format('got %s', r);

  -- Without the how-word it is an instruction, not a question.
  r := ops_asst.route('buatkan PO ke Hadi Glass');
  assert r ->> 'tool' = 'procurement.draft_po', format('got %s', r);
end $$;

/* ── the router is allowed to fail ─────────────────────────────────────── */

do $$
declare r jsonb;
begin
  -- A router that always matches is a router that answers the wrong question
  -- confidently, and every hour of this project has been spent refusing that.
  assert ops_asst.route('siapa yang menang piala dunia') is null, 'no match is a real answer';
  assert ops_asst.route('') is null, 'an empty prompt matches nothing';
  assert ops_asst.route('   ') is null, 'and so does whitespace';
end $$;

/* ── a keyword is a keyword, not a pattern ─────────────────────────────── */

do $$
declare n int;
begin
  -- `position(k in p)` rather than LIKE: a keyword typed into the table with a
  -- `%` in it would otherwise become a wildcard matching half the language,
  -- and the person who typed it would have no idea.
  select count(*) into n from ops_asst.rules
   where exists (select 1 from unnest(any_words || all_words || not_words) k
                  where k like '%\%%' or k like '%\_%');
  -- None today. The assertion that matters is the one below: even if one
  -- appears, it must not match everything.
  assert ops_asst.route('%') is null, format('a bare wildcard matches nothing, %s rules hold one', n);
end $$;

/* ── the crumbs, and only the crumbs ───────────────────────────────────── */

do $$
declare r jsonb;
begin
  r := ops_asst.route('buatkan PO 20 lembar ke "HADI GLASS" untuk proyek 25014');
  assert r -> 'args' ->> 'qty' = '20', format('got %s', r -> 'args');
  assert r -> 'args' ->> 'uom' = 'lembar', format('got %s', r -> 'args');
  -- Lower case, because the sentence is normalised before anything is read
  -- out of it — the same text the rules matched against is the text the
  -- crumbs come from.
  assert r -> 'args' ->> 'name' = 'hadi glass', format('a quoted name wins, got %s', r -> 'args');
  assert r -> 'args' ->> 'project_code' = '25014', format('got %s', r -> 'args');

  -- Where the two could disagree, the quoted one wins — somebody who put
  -- quotes round a name was being explicit, and the *ke …* pattern happily
  -- reads a preposition and whatever follows it.
  r := ops_asst.route('buatkan PO ke gudang untuk "PT SUMBER JAYA"');
  assert r -> 'args' ->> 'name' = 'pt sumber jaya', format('got %s', r -> 'args');

  -- Nothing is invented. A sentence with no quantity in it does not acquire
  -- one, because the draft form is where a person fills a blank and sees that
  -- they filled it (D217).
  r := ops_asst.route('buatkan PO ke Hadi Glass');
  assert r -> 'args' ->> 'qty' is null, format('got %s', r -> 'args');
  assert r -> 'args' ->> 'name' = 'hadi glass', format('got %s', r -> 'args');
end $$;

/* ── every rule points at a tool that exists ───────────────────────────── */

do $$
declare v_strays text; n int;
begin
  -- The foreign key says this too. Asserted because the thing that actually
  -- breaks is subtler: a rule whose tool exists but which no ordering can ever
  -- reach.
  select string_agg(distinct tool, ', ') into v_strays
    from ops_asst.rules r
   where not exists (select 1 from ops_asst.tools t where t.name = r.tool);
  assert v_strays is null, format('rules point at nothing: %s', v_strays);

  -- Every tool in the catalogue is reachable by some sentence. A capability
  -- nobody can phrase is a capability that is not there.
  select count(*) into n from ops_asst.tools t
   where not exists (select 1 from ops_asst.rules r where r.tool = t.name);
  assert n = 0, format('%s tools have no rule that reaches them', n);
end $$;

/* ── a turn is recorded against whoever is asking ──────────────────────── */

set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000011';

do $$
declare r jsonb; n int;
begin
  r := ops_asst.record_turn('berapa hutang kita ke vendor', 'answer', 'id',
        'melihat kewajiban ke vendor', 'Tiga vendor masih punya sisa kewajiban.',
        '[{"label":"HADI GLASS","amount":6000000,"unit":"IDR","source":"procurement.vendor_debt","href":"/procurement/tracker"}]'::jsonb,
        '[]'::jsonb, array['procurement.vendor_debt'], null, '/procurement/tracker', 71);
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'actor_id' = 'a5570000-0000-0000-0000-000000000011',
    format('recorded against whoever is asking, got %s', r -> 'data' ->> 'actor_id');

  r := ops_asst.record_turn('siapa yang menang piala dunia', 'unknown', 'id');
  assert ops_core.said_ok(r), format('got %s', r);

  r := ops_asst.record_turn('   ', 'unknown');
  assert r -> 'error' ->> 'code' = 'empty_prompt', format('got %s', r);

  select count(*) into n from ops_asst.turns;
  assert n = 2, format('this person sees their own two, got %s', n);
end $$;

/* ── REFUSAL: a conversation is nobody else's ──────────────────────────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000012';

do $$
declare n int;
begin
  -- IT, at admin. The most access this system describes, and it does not
  -- include reading what somebody typed into a prompt. Building the mirror
  -- image of `it.audit` one migration after blocking it would be an odd way to
  -- honour D218.
  select count(*) into n from ops_asst.turns;
  assert n = 0, format('IT sees nobody''s conversation, got %s rows', n);
end $$;

/* ── what IT does get: the sentences, without the people ───────────────── */

-- A second person asks the same thing, and a third asks it with different
-- punctuation and a possessive. All three are one question to the router, so
-- all three must be one row here — that grouping is the difference between a
-- tuning list and a log.
set local role postgres;
insert into ops_core.user_modules (user_id, module, level) values
  ('a5570000-0000-0000-0000-000000000012','procurement','read');
set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000012';

do $$
declare r jsonb;
begin
  r := ops_asst.record_turn('Siapa yang menang piala dunia?', 'unknown', 'id');
  assert ops_core.said_ok(r), format('got %s', r);
  r := ops_asst.record_turn('siapa yang menang piala dunianya', 'unknown', 'en');
  assert ops_core.said_ok(r), format('got %s', r);
  r := ops_asst.record_turn('kapan kantor libur', 'unknown', 'id');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

-- `at` defaults to `now()`, which is **transaction start** — so every row this
-- file writes shares a timestamp and "most recent" means nothing inside it.
-- That is right for the column (each real turn is its own transaction) and
-- wrong for the test, so the moments are set explicitly here. Without this the
-- ordering assertions below pass or fail on insertion order and prove nothing.
set local role postgres;
update ops_asst.turns set at = now() - interval '3 hours' where prompt = 'siapa yang menang piala dunia';
update ops_asst.turns set at = now() - interval '2 hours' where prompt = 'Siapa yang menang piala dunia?';
update ops_asst.turns set at = now() - interval '1 hour'  where prompt = 'siapa yang menang piala dunianya';
set local role authenticated;

do $$
declare n int; r record;
begin
  select count(*) into n from ops_asst.unmatched();
  assert n = 2, format('four prompts, two questions, got %s rows', n);

  select * into r from ops_asst.unmatched() limit 1;
  -- Most asked first: that is the one worth a rule, and it will not be the
  -- newest.
  assert r.times = 3, format('the repeated one is on top with its count, got %s', r.times);
  assert r.normalised = 'siapa yang menang piala dunia',
    format('grouped by what the matcher compares, got %s', r.normalised);
  -- The example is the most recent **as it was typed** — punctuation, `-nya`
  -- and all. The normalised form is what the router saw; the raw one is what a
  -- person reads when deciding whether a rule would have helped.
  assert r.example = 'siapa yang menang piala dunianya', format('got %s', r.example);
  assert r.langs @> array['id','en'], format('both languages asked it, got %s', r.langs);
  assert r.first_at < r.last_at, 'and it spans time';
end $$;

/* ── is the router working, in counts and nothing else ─────────────────── */

do $$
declare h record;
begin
  select * into h from ops_asst.router_health();
  assert h.turns = 5, format('five turns across two people, got %s', h.turns);
  assert h.unknown = 4, format('four of them unmatched, got %s', h.unknown);
  assert h.answered = 1, format('one answered, got %s', h.answered);
  -- Not a column anywhere in either function. The question is *what did we
  -- fail to understand*, and a name makes it a different question (D218).
  assert not exists (
    select 1 from information_schema.routines ro
    join information_schema.parameters pa
      on pa.specific_name = ro.specific_name
   where ro.routine_schema = 'ops_asst'
     and ro.routine_name in ('unmatched','router_health')
     and pa.parameter_name in ('actor_id','actor_email','prompt_by')),
    'neither function returns who asked';
end $$;

-- And it is IT's, not everybody's.
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000011';

do $$
declare n int;
begin
  begin
    select count(*) into n from ops_asst.unmatched();
    assert false, 'the tuning list is everybody''s prompts in one place';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
