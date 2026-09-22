-- 0039_asst_router_turns.sql — turning a sentence into a tool name, and
-- keeping what was asked.
--
-- ── Where the executor belongs, and the mistake nearly made here ─────────
--
-- The obvious next step after `0038` is an `ops_asst.ask()` that does
-- everything: route the sentence, check the gate, **run the tool**, store the
-- turn, answer. One round trip, all the rules in one place.
--
-- It would have to be `security definer`, because it writes audit rows through
-- the envelope helpers, which are deliberately not granted to `authenticated`
-- (0003: a client that could call `ops_core.ok(...)` could forge a trail
-- saying anything it liked).
--
-- And a `security definer` function runs as its owner. The owner here is
-- `postgres`, which has `bypassrls`.
--
-- So `select * from ops_acct.v_account_balance` **inside** that function reads
-- every account in the company, for anybody who can reach the prompt. The
-- module check in `may_run` would be the only thing standing in front of it,
-- and a check that is the only thing is exactly what `0037` found `v_po_detail`
-- to be. The same mistake, one file later, in a function written to enforce
-- permissions.
--
-- ── So the tool is run by the client, as the person ──────────────────────
--
-- The division is:
--
--   **the database** owns the catalogue (0038), the gate (0038), the router
--   (here) and the record of what was asked (here);
--
--   **the client** runs the tool — by making the same PostgREST call the
--   screen makes, as the signed-in person, with RLS applying exactly as it
--   does on that screen.
--
-- That is not a weakening. It is D219 satisfied structurally rather than by
-- re-implementation: John Lau reads `v_vendor_journey` the way
-- `/procurement/tracker` reads it, so it cannot see one row more. A client
-- that skips `may_run` and queries the view directly is refused by the
-- policies — which is the real boundary. **RLS is the boundary; `may_run` is
-- the sentence**, and the sentence is worth having because *permission denied*
-- teaches nobody which of the two refusals they hit.
--
-- Nor does it weaken D218. A blocked tool is blocked because the *prompt* is
-- the wrong door to it, not because the data is unreachable: somebody with
-- `hrd.admin` can open Berkas 201 on its own screen, one identity number at a
-- time, with each opening recorded under their name. What does not exist is a
-- conversational path that answers ten at once, and it does not exist because
-- nobody wrote one.
--
-- ── The router is data, and that is the point ────────────────────────────
--
-- `src/demo/assistant/router.ts` says of itself that it is the part that is
-- not real yet, and that Phase 2 swaps this file for a model choosing from the
-- catalogue (D221). The owner's answer when asked was *kata kunci dulu, LLM
-- nanti* — keywords first, decide about a model after seeing what people
-- actually type.
--
-- That decision only pays off if the typing is kept. So the rules are rows
-- (tunable without a deploy, and visible beside the prompts they failed on)
-- and every turn is stored, including the ones that matched nothing. The
-- unmatched ones are the valuable half: they are the list of things people
-- expected John Lau to understand.

-- ── normalising, before anything is compared ─────────────────────────────

/* Lowercase, strip the punctuation people end questions with, and drop the
 * possessive `-nya`.
 *
 * Without the last one, *stoknya menipis* does not match a rule written as
 * *stok menipis* — and that failure was found by the demo's own suggestion
 * chip not working (F64). A matcher this literal is exactly what a model
 * replaces; until then it should at least survive the way people write.
 */
create or replace function ops_asst.normalise(p_text text)
returns text
language sql immutable set search_path = pg_temp as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p_text,'')), '[?!.,;:]', ' ', 'g'),
             '\m(\w{3,})nya\M', '\1', 'g'),
           '\s+', ' ', 'g'))
$$;

-- ── what a how-question looks like ───────────────────────────────────────

create table ops_asst.how_words (
  word text primary key,
  note text
);

comment on table ops_asst.how_words is
  'Words that make a sentence a *how*, checked before every other rule: "cara bikin PO" contains '
  '"buat po" and would otherwise be read as an instruction to build one (F64). (0039)';

insert into ops_asst.how_words (word) values
  ('cara'),('bagaimana'),('gimana'),('sop'),('langkah'),('caranya'),
  ('how do i'),('how to'),('how can i'),('steps');

-- ── the rules ────────────────────────────────────────────────────────────

create table ops_asst.rules (
  seq           int primary key,
  tool          text not null references ops_asst.tools(name),
  -- `how` rules are consulted only when the sentence contains a how-word, and
  -- before every `main` rule. Two stages rather than one ordered list, because
  -- *which guide* and *which tool* are different questions asked of the same
  -- sentence.
  stage         text not null default 'main' check (stage in ('how','main')),
  -- All of these must appear.
  all_words     text[] not null default '{}',
  -- At least one of these.
  any_words     text[] not null default '{}',
  -- None of these, for rules that would otherwise overlap.
  not_words     text[] not null default '{}',
  understood_en text not null,
  understood_id text not null,
  note          text,
  constraint rule_matches_something check (cardinality(any_words) > 0)
);

comment on table ops_asst.rules is
  'The keyword router, as rows. First match wins, so `seq` is the design and not a formality — '
  'the blocked tools are listed first on purpose. (0039)';

comment on column ops_asst.rules.seq is
  'Lower runs first. The blocked tools occupy 10–50: somebody asking for a salary must be told '
  'it is refused, not quietly matched to something adjacent that happens to be allowed. (0039)';

-- ── the rules, as the demo had them ──────────────────────────────────────
--
-- Order preserved exactly. `terlambat` belongs to two worlds — a person
-- arriving late, and a work order past its date — and because the blocked
-- rules run first, an unguarded keyword there turns *SPK apa yang terlambat*
-- into an accusation that somebody was reading staff records (F64).
--
-- **A false refusal is the most expensive mistake this router can make**, so
-- the guards live on the blocked rules rather than on the open ones. Putting
-- them on the open rules would mean every new open rule has to remember them.

insert into ops_asst.rules (seq, tool, stage, all_words, any_words, not_words, understood_en, understood_id, note) values
 (10,'hr.employee_files','main','{}',
     '{ktp,"berkas 201","kartu keluarga",npwp,bpjs,"nomor identitas","berkas karyawan","employee file","id card","id number","family card"}',
     '{}','reading employee files','membaca berkas kepegawaian', null),
 (20,'hr.payroll','main','{}',
     '{gaji,"slip gaji",payroll,upah,thr,"lembur dibayar",salary,payslip,wage,"take home"}',
     '{}','reading pay data','membaca data gaji', null),
 (30,'hr.attendance','main','{}',
     '{absensi,kehadiran,"jam masuk",terlambat,telat,attendance,"clock in",late}',
     '{spk,produksi,order,proyek,kirim,pengiriman,bayar,"po ",vendor,"work order",production,delivery,project}',
     'reading attendance data','membaca data kehadiran',
     'The guards are here, not on production.late_orders: a false refusal is worse than a miss.'),
 (40,'it.audit','main','{}',
     '{audit,"log aktivitas","activity log","siapa membuka","siapa mengubah","who opened","who changed","hak akses",peran,"pengguna sistem",permission,role,"system user"}',
     '{}','reading the IT module','membaca modul IT', null),
 (50,'it.settings_write','main','{}',
     '{"ubah pengaturan","ganti pengaturan","setel ulang","ubah zona waktu","ubah toleransi","change setting","change the setting","set timezone","change tolerance"}',
     '{}','changing settings','mengubah pengaturan', null),

 -- Writing, before the reads: *buatkan PO* is not *berapa PO*.
 (60,'procurement.draft_po','main','{}',
     '{"buatkan po","buat po","bikin po","po baru","order ke vendor","create a po","create po","new po","raise a po","order from vendor"}',
     '{}','drafting a new purchase order','menyiapkan purchase order baru', null),
 (61,'procurement.draft_pr_line','main','{}',
     '{"minta beli","permintaan pembelian","request beli","ajukan pembelian","pr baru","purchase request","request to buy","new request line"}',
     '{}','drafting a purchase request line','menyiapkan baris permintaan pembelian', null),

 -- Reading.
 (70,'procurement.pending_approvals','main','{}',
     '{"menunggu persetujuan","belum disetujui","perlu approve","antrian approval",rapat,"belum di-approve","waiting for approval","pending approval","not approved","approval queue"}',
     '{}','the lines waiting for approval','melihat baris yang menunggu persetujuan', null),
 (71,'procurement.vendor_debt','main','{}',
     '{hutang,utang,"belum dibayar","tagihan vendor","sisa bayar",owe,outstanding,unpaid,"vendor debt"}',
     '{}','what is still owed to vendors','melihat kewajiban ke vendor', null),
 (72,'accounting.balances','main','{}',
     '{saldo,kas,rekening,"uang kita",duit,balance,"account balance","cash we have","how much money"}',
     '{}','the balance of each account','melihat saldo rekening', null),
 (73,'inventory.low_stock','main','{}',
     '{menipis,"stok minimum","hampir habis","stok kurang",restock,"di bawah minimum","below minimum","running low","low stock","need reorder"}',
     '{}','items below their minimum','melihat barang di bawah minimum', null),
 (74,'production.late_orders','main','{spk}',
     '{telat,terlambat,molor,lewat,late,overdue,"past due"}','{}',
     'work orders past their date','melihat SPK yang lewat tanggal', null),
 (75,'production.late_orders','main','{produksi}',
     '{telat,terlambat,molor,lewat,late,overdue}','{}',
     'work orders past their date','melihat SPK yang lewat tanggal', null),
 (76,'production.late_orders','main','{"work order"}',
     '{late,overdue,"past due",behind}','{}',
     'work orders past their date','melihat SPK yang lewat tanggal', null),
 (77,'delivery.fulfilment','main','{}',
     '{"sudah dikirim","sampai mana","progres proyek",terpasang,"serah terima","how far",delivered,installed,handover,"project progress"}',
     '{}','how far a client order has reached them','melihat sejauh mana pesanan klien sampai', null),

 -- Guidance, consulted only when the sentence contains a how-word.
 (110,'guide.create_po','how','{}','{po,"purchase order",order}','{}',
      'how to create a purchase order','menjelaskan cara membuat purchase order', null),
 (111,'guide.receive_goods','how','{}',
      '{"barang datang","terima barang",penerimaan,"surat jalan","goods arriv","receive goods",receiving,"delivery note"}','{}',
      'how to record goods arriving','menjelaskan cara mencatat barang datang', null),
 (112,'guide.pay_line','how','{}',
      '{bayar,pembayaran,melunasi,"pay a line","pay the line",payment}','{}',
      'how to pay a request line','menjelaskan cara membayar baris permintaan', null);

-- Read by everybody, written by nobody through the API — the same rule the
-- catalogue lives under (0038), for a weaker reason: a rule is not a security
-- boundary, but a router somebody can edit from a browser is a router that
-- answers a different question tomorrow than it did today, with no diff.
alter table ops_asst.rules     enable row level security;
alter table ops_asst.how_words enable row level security;

create policy rules_read on ops_asst.rules
  for select to authenticated using (true);
create policy how_words_read on ops_asst.how_words
  for select to authenticated using (true);

grant select on ops_asst.rules, ops_asst.how_words to authenticated;

-- ── the crumbs a keyword matcher can honestly pull out ───────────────────

/* A quantity, a name in quotes, a project code, a vendor after *ke/dari*.
 *
 * Everything else is left to the draft form, where a person fills it in and
 * sees what they filled. A matcher that guessed the rest would be composing,
 * and composing is the one thing John Lau does not do (D217).
 */
create or replace function ops_asst.extract_args(p_norm text)
returns jsonb
language plpgsql immutable set search_path = pg_temp as $$
declare v_args jsonb := '{}'::jsonb; m text[];
begin
  m := regexp_match(p_norm, '(\d+)\s*(lembar|pcs|batang|unit|set|box|dus|kg|m3|daun)\M');
  if m is not null then
    v_args := v_args || jsonb_build_object('qty', m[1], 'uom', m[2]);
  end if;

  m := regexp_match(p_norm, '["'']([^"'']{3,})["'']');
  if m is not null then
    v_args := v_args || jsonb_build_object('name', m[1]);
  end if;

  m := regexp_match(p_norm, '\m(25\d{3})\M');
  if m is not null then
    v_args := v_args || jsonb_build_object('project_code', m[1]);
  end if;

  if v_args -> 'name' is null then
    m := regexp_match(p_norm, '(?:ke|dari|vendor)\s+([a-z][a-z .]{3,30})');
    if m is not null then
      v_args := v_args || jsonb_build_object('name', btrim(m[1]));
    end if;
  end if;

  return v_args;
end $$;

grant execute on function ops_asst.extract_args(text) to authenticated;

-- ── the router ───────────────────────────────────────────────────────────

/* **It is allowed to fail, and that is the feature.**
 *
 * A router that always finds something is a router that answers the wrong
 * question confidently. No match returns null, the caller says *saya tidak
 * mengerti*, and the turn is stored — which is how the list of things people
 * expected John Lau to understand gets written.
 *
 * `position(k in p)` rather than `like '%'||k||'%'`: keywords are typed by
 * people into a table, and one containing `%` or `_` would quietly become a
 * wildcard that matches half the language.
 */
create or replace function ops_asst.route(p_prompt text)
returns jsonb
language plpgsql stable set search_path = ops_asst, pg_temp as $$
declare p text; r record; v_is_how boolean;
begin
  p := ops_asst.normalise(p_prompt);
  if p = '' then return null; end if;

  v_is_how := exists (select 1 from ops_asst.how_words w where position(w.word in p) > 0);

  if v_is_how then
    for r in select * from ops_asst.rules where stage = 'how' order by seq loop
      if exists (select 1 from unnest(r.any_words) k where position(k in p) > 0) then
        return jsonb_build_object('tool', r.tool, 'seq', r.seq,
                 'understood_en', r.understood_en, 'understood_id', r.understood_id,
                 'args', ops_asst.extract_args(p), 'normalised', p);
      end if;
    end loop;
  end if;

  for r in select * from ops_asst.rules where stage = 'main' order by seq loop
    if exists (select 1 from unnest(r.not_words) k where position(k in p) > 0) then
      continue;
    end if;
    if cardinality(r.all_words) > 0
       and exists (select 1 from unnest(r.all_words) k where position(k in p) = 0) then
      continue;
    end if;
    if not exists (select 1 from unnest(r.any_words) k where position(k in p) > 0) then
      continue;
    end if;
    return jsonb_build_object('tool', r.tool, 'seq', r.seq,
             'understood_en', r.understood_en, 'understood_id', r.understood_id,
             'args', ops_asst.extract_args(p), 'normalised', p);
  end loop;

  return null;
end $$;

grant execute on function ops_asst.route(text) to authenticated;

comment on function ops_asst.route(text) is
  'A sentence to a tool name, or null. Null is a real answer — a router that always matches is '
  'one that answers the wrong question confidently. (0039)';

-- ── what was asked, and what came back ───────────────────────────────────

create type ops_asst.turn_kind_t as enum ('answer','guide','draft','refused','unknown');

create table ops_asst.turns (
  id              uuid primary key default gen_random_uuid(),
  at              timestamptz not null default now(),
  actor_id        uuid not null references ops_core.users(id),
  -- Verbatim, because *what did I actually ask* is the first question somebody
  -- has when the answer looks wrong.
  prompt          text not null,
  -- Which language it was answered in. A record of what was said, not a
  -- setting: the sentence the person read is the sentence stored.
  lang            text not null default 'id' check (lang in ('en','id')),
  kind            ops_asst.turn_kind_t not null,
  -- What it thought was asked, echoed back so a wrong reading is visible
  -- before anybody acts on it.
  understood_as   text,
  -- The prose part. **Never contains a figure** — figures live in `facts`, so
  -- they cannot be paraphrased into something slightly different (D217).
  text            text not null default '',
  -- `[{label, value, amount, unit, source, href}]`. `amount` + `unit` carry a
  -- number the client formats with the same helper the screens use; `value`
  -- carries anything that is not a number. One of the two, never both — a
  -- figure formatted in two places is a figure that disagrees with itself.
  facts           jsonb not null default '[]'::jsonb,
  steps           jsonb not null default '[]'::jsonb,
  -- The tools it actually ran, in order. Shown, always.
  tools_used      text[] not null default '{}',
  refused_because ops_asst.refusal_t,
  route           text,
  -- The rule that fired, so a bad match can be found and fixed rather than
  -- argued about.
  matched_rule    int references ops_asst.rules(seq)
);

create index turns_actor_at_idx on ops_asst.turns (actor_id, at desc);
-- The unmatched ones, across everybody, are the tuning list.
create index turns_unknown_idx on ops_asst.turns (at desc) where kind = 'unknown';

comment on table ops_asst.turns is
  'One exchange. Stored because *what did John Lau tell me on Tuesday* is a question somebody '
  'asks after acting on the answer — and because the unmatched ones are the list of things '
  'people expected it to understand. (0039)';

-- ── who may read a conversation ──────────────────────────────────────────
--
-- **Only the person who had it.** Not IT, not leadership, not the owner.
--
-- The obvious alternative is the `activity_intervals` shape from `0026` —
-- yours, plus IT's — and it is wrong here. What people type into a prompt is
-- closer to what they would have asked a colleague than to what they had on
-- screen, and a searchable record of everybody's questions is a surveillance
-- capability nobody asked for. `it.audit` is blocked from the prompt for
-- exactly this reason (D218); building the mirror image of it one migration
-- later would be an odd way to honour that.
--
-- Nothing is lost in accountability: every tool call is already an audit row
-- from `may_run`, and every write still goes through the seam that writes it.
-- What this table adds is the prose, which is the part that is nobody else's.
alter table ops_asst.turns enable row level security;

create policy turns_own on ops_asst.turns
  for select to authenticated using (actor_id = auth.uid());

grant select on ops_asst.turns to authenticated;

-- ── writing one down ─────────────────────────────────────────────────────

/* **The turn is recorded against `auth.uid()`, never against an actor named in
 * the payload.** Who asked is something the database already knows, and taking
 * it from the caller would mean a conversation anybody could write into
 * somebody else's name.
 *
 * Everything else here the caller supplies, and that is not a hole: the only
 * reader is the caller themselves, so a client that lies is lying to itself.
 * The parts that must be true for anybody else — may this person run this
 * tool, and did the write happen — live in `may_run` and in the seam that
 * performs the write.
 */
create or replace function ops_asst.record_turn(
  p_prompt          text,
  p_kind            text,
  p_lang            text default 'id',
  p_understood_as   text default null,
  p_text            text default '',
  p_facts           jsonb default '[]'::jsonb,
  p_steps           jsonb default '[]'::jsonb,
  p_tools_used      text[] default '{}',
  p_refused_because text default null,
  p_route           text default null,
  p_matched_rule    int default null)
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare v_row ops_asst.turns;
begin
  if auth.uid() is null then
    return ops_core.refused('assistant','turn', null,'record',
      'not_signed_in','A conversation has somebody in it, and nobody is signed in.');
  end if;
  if coalesce(btrim(p_prompt),'') = '' then
    return ops_core.invalid('assistant','turn', null,'record',
      'empty_prompt','There is nothing to record.', jsonb_build_object('field','prompt'));
  end if;

  insert into ops_asst.turns
    (actor_id, prompt, lang, kind, understood_as, text, facts, steps,
     tools_used, refused_because, route, matched_rule)
  values
    (auth.uid(), p_prompt,
     case when lower(coalesce(p_lang,'id')) = 'en' then 'en' else 'id' end,
     p_kind::ops_asst.turn_kind_t, p_understood_as, coalesce(p_text,''),
     coalesce(p_facts,'[]'::jsonb), coalesce(p_steps,'[]'::jsonb),
     coalesce(p_tools_used,'{}'), p_refused_because::ops_asst.refusal_t,
     p_route, p_matched_rule)
  returning * into v_row;

  return ops_core.ok('assistant','turn', v_row.id::text,'record', to_jsonb(v_row));
end $$;

grant execute on function ops_asst.record_turn(
  text, text, text, text, text, jsonb, jsonb, text[], text, text, int) to authenticated;

comment on function ops_asst.record_turn is
  'Writes one exchange down, always against auth.uid(). The caller supplies the prose because '
  'the caller is the only reader; what has to be true for anybody else lives in may_run and in '
  'the seams that write. (0039)';

-- ── what the rules are doing, for whoever tunes them ─────────────────────

/* The unmatched prompts, which is the whole reason turns are kept.
 *
 * *Kata kunci dulu, LLM nanti* (owner) is a decision that only pays off if the
 * typing is kept, and this is where it is read: the sentences people expected
 * John Lau to understand, most recent first.
 *
 * ── Why this is a function and not a view ───────────────────────────────
 *
 * It was a view first, `security_invoker = on`, filtered on `it.read`. That
 * view was worthless and did not look it: `turns` is own-rows-only under RLS,
 * so an invoker view over it returns **your own** unmatched prompts however
 * the filter is written. IT would have opened the tuning list, seen their own
 * four questions, and concluded the router was doing fine.
 *
 * The fix cannot be an RLS policy either, because RLS grants rows and the
 * thing that must not be granted here is a *column*. Letting IT read the row
 * to get the prompt hands them `actor_id` with it, and *who asked what* is
 * precisely the record `turns` refuses to be (D218, D190).
 *
 * So: a `security definer` function, which chooses its own columns. It answers
 * the prompt, the day and the language, and never who typed it. The question
 * worth asking is *what did we fail to understand*; adding a name turns it
 * into a different question that nobody asked for.
 */
create or replace function ops_asst.unmatched(p_limit int default 200)
returns table (day date, lang text, prompt text)
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
begin
  if not ops_core.has_permission('it.read') then
    -- Not an envelope: this is a listing, and the caller is a screen that
    -- either draws a table or draws a refusal. IT holds it; nobody else needs
    -- everybody's questions.
    raise exception 'The tuning list is IT''s — it is everybody''s prompts in one place.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select t.at::date, t.lang, t.prompt
      from ops_asst.turns t
     where t.kind = 'unknown'
     order by t.at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

grant execute on function ops_asst.unmatched(int) to authenticated;

comment on function ops_asst.unmatched(int) is
  'The sentences the router did not understand, without who typed them. The tuning list, and '
  'the evidence for deciding whether a model is worth it. A function rather than a view because '
  'what must be withheld is a column, and RLS withholds rows. (0039)';
