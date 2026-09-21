-- asst — what John Lau was asked, what it answered, and which document the
-- answer turned into (D217, D218, D220, D223).
--
--   REFUSALS     an empty prompt; **a money figure written into the prose**;
--                facts on something that is not an answer, steps on something
--                that is not a guide, a refusal with no reason, an outcome
--                with no draft, a document produced by an abandoned one;
--                **editing a turn somebody already acted on**; deciding a
--                draft twice; confirming somebody else's; confirming with
--                nothing to show for it; reading another person's
--                conversation; inserting or deleting around the seams
--   DERIVATIONS  a refusal is announced **with the tool and not the
--                question**; an answer is announced not at all; a confirmed
--                draft carries the document and the fields; and
--                `v_turn_provenance` answers *where did this line come from*
--                for IT **without ever carrying the prompt**
--
-- The one rule worth arguing about is the prose: a figure in a sentence is the
-- figure a person quotes, and the one in `facts` is the one they could have
-- checked.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009001','budi@talaliving.com','{"full_name":"Budi Hartono"}'),
  ('ffffffff-0000-0000-0000-000000009002','sari@talaliving.com','{"full_name":"Sari Dewi"}'),
  ('ffffffff-0000-0000-0000-000000009003','it90@talaliving.com','{"full_name":"Staf IT"}');
-- Budi holds **nothing**. The assistant is reachable by anybody with an
-- account; what it can then do is decided per tool, by the RLS on the tables
-- those tools read (D219). Being able to ask is not being able to see.
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009002','procurement','write'),
  ('ffffffff-0000-0000-0000-000000009003','it','read');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009001';

/* ── REFUSAL: nothing to answer ────────────────────────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_asst.record_turn('   ','unknown');
  assert a -> 'error' ->> 'code' = 'empty_prompt', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: anybody with an account may ask ───────────────────────── */
do $$
declare a jsonb; t record;
begin
  assert not ops_core.has_permission('procurement.read'), 'Budi holds nothing';

  a := ops_asst.record_turn(
    'berapa hutang kita ke vendor mahoni?','answer','membaca hutang vendor',
    'Angkanya di bawah, dari alat yang sama dengan layarnya.',
    '[{"label":"Hutang vendor","value":"Rp 12.500.000","source":"procurement.vendor_debt","href":"/procurement/supplier"}]'::jsonb,
    '[]'::jsonb, array['procurement.vendor_debt']);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'turn_no' like 'jl-%',
    'a turn is citable, got ' || coalesce(a -> 'data' ->> 'turn_no','(null)');

  select * into t from ops_asst.assistant_turns where turn_no = a -> 'data' ->> 'turn_no';
  assert t.prompt = 'berapa hutang kita ke vendor mahoni?',
    'the sentence is kept verbatim — the one that did not work is the only evidence for why';
  -- The figure is in its own column, where it carries the tool that produced
  -- it and the screen showing the same number (D217).
  assert t.facts -> 0 ->> 'source' = 'procurement.vendor_debt', 'got '
    || coalesce(t.facts -> 0 ->> 'source','(null)');
  assert t.facts -> 0 ->> 'href' = '/procurement/supplier', 'and where to check it';
  assert t.body !~ '12', 'and the prose says none of it';
end $$;

/* ── REFUSAL: a figure paraphrased into the sentence ───────────────────── */
do $$
begin
  -- The failure this catches is the one that actually happens. A client that
  -- hits it has a bug, not a user with bad input, so it raises rather than
  -- coming back as an envelope somebody might render.
  begin
    perform ops_asst.record_turn('x','answer', null,'Total hutang vendor Rp 12.500.000');
    raise exception 'money in the prose should be refused';
  exception when check_violation then null;
  end;
  begin
    perform ops_asst.record_turn('x','answer', null,'Sisanya 12.500.000 lagi');
    raise exception 'a grouped figure with no currency marker should be refused too';
  exception when check_violation then null;
  end;

  -- And what it deliberately does **not** catch, because refusing these would
  -- teach whoever hits it to work around the check rather than use `facts`.
  perform ops_asst.record_turn('a','guide', null,'Berkas 201 tidak lewat prompt',
    '[]'::jsonb,'[{"text":"Buka layarnya","href":"/hrd","rule":null}]'::jsonb);
  perform ops_asst.record_turn('b','answer', null,'Lihat pr-26-09-11_03 di layar permintaan');
  perform ops_asst.record_turn('c','answer', null,'Diminta pada 2026-09-21');
end $$;

/* ── REFUSAL: a turn says one thing ────────────────────────────────────── */
do $$
begin
  begin
    perform ops_asst.record_turn('x','guide', null,'', 
      '[{"label":"a","value":"b","source":"c","href":null}]'::jsonb);
    raise exception 'facts on a guide should be refused';
  exception when check_violation then null;
  end;
  begin
    perform ops_asst.record_turn('x','answer', null,'', '[]'::jsonb,
      '[{"text":"a","href":null,"rule":null}]'::jsonb);
    raise exception 'steps on an answer should be refused';
  exception when check_violation then null;
  end;
  begin
    perform ops_asst.record_turn('x','refused', null,'ditolak');
    raise exception 'a refusal that does not say which kind should be refused (F64)';
  exception when check_violation then null;
  end;
  begin
    perform ops_asst.record_turn('x','answer', null,'', '[]'::jsonb,'[]'::jsonb,'{}',
      'closed'::ops_asst.refusal_t);
    raise exception 'a reason with nothing refused should be refused';
  exception when check_violation then null;
  end;
  begin
    perform ops_asst.record_turn('x','draft', null,'ini yang akan saya tulis');
    raise exception 'a draft turn with no draft should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── DERIVATION: a refusal is announced, the question is not ───────────── */
do $$
declare a jsonb; v_no text;
begin
  a := ops_asst.record_turn(
    'berapa gaji pak joko bulan ini?','refused','membaca data gaji',
    'Data gaji tidak bisa diakses lewat prompt, oleh siapa pun. Bukan soal izin akun Anda.',
    '[]'::jsonb,'[]'::jsonb, array['hr.payroll'],'closed'::ops_asst.refusal_t,
    null,'/payroll');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'turn_no';

  assert (select refused_because from ops_asst.assistant_turns where turn_no = v_no) = 'closed',
    'closed is not a permission problem, and saying so sends somebody to the right person (F64)';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009003';
do $$
declare v_payload jsonb; n int;
begin
  select payload into v_payload from ops_core.outbox
   where event_type = 'assistant.refused' order by occurred_at desc limit 1;
  assert v_payload ->> 'because' = 'closed', 'the boundary held, and which one, got '
    || coalesce(v_payload ->> 'because','(null)');
  assert v_payload -> 'tools' = '["hr.payroll"]'::jsonb, 'and which tool, got '
    || coalesce((v_payload -> 'tools')::text,'(null)');
  -- **Somebody asking about a salary has done nothing wrong.** A permanent
  -- record of the question, readable by their manager, is a worse trail than
  -- no trail — so what travels is the tool, never the sentence.
  assert v_payload::text not like '%gaji pak joko%', 'the question does not travel';
  assert not exists (
    select 1 from ops_core.audit_log
     where coalesce(reason,'') || coalesce(detail::text,'') like '%gaji pak joko%'),
    'nor is it anywhere on the audit row — not the reason, not the detail';

  -- An answer is nobody's business but the asker's, so nothing is announced.
  select count(*) into n from ops_core.outbox where event_type like 'assistant.%';
  assert n = 1, 'one refusal, and no announcement of the four answers, got ' || n;
end $$;

/* ── REFUSAL: somebody else's conversation ─────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009002';
do $$
declare n int;
begin
  select count(*) into n from ops_asst.assistant_turns;
  assert n = 0, 'Sari sees none of Budi''s questions, got ' || n;

  -- Not even IT, and that is the point: oversight lives on the audit log and
  -- in the provenance view, neither of which carries a question.
  begin
    insert into ops_asst.assistant_turns (actor_id, prompt, kind)
    values ('ffffffff-0000-0000-0000-000000009002','curang','answer');
    raise exception 'inserting around the seam should be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── DERIVATION and REFUSAL: the draft, and the second yes ─────────────── */
do $$
declare a jsonb; b jsonb; v_no text; t record;
begin
  a := ops_asst.record_turn(
    'tolong buat permintaan pembelian 20 lembar tripleks','draft','membuat baris permintaan',
    'Ini yang akan saya tulis. Belum ada apa pun yang tersimpan.',
    '[]'::jsonb,'[]'::jsonb, array['procurement.draft_pr_line'], null,
    $d${"tool":"procurement.draft_pr_line","headline":"Baris permintaan pembelian baru",
        "fields":[{"label":"Barang","value":"Tripleks 12mm"},{"label":"Jumlah","value":"20 lembar"}],
        "warnings":["Masuk sebagai permintaan, bukan persetujuan."],
        "args":{"name":"Tripleks 12mm","qty":"20"},"idempotency_key":"idem-90-01"}$d$::jsonb,
    '/procurement/pr/documents');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'turn_no';

  -- Nothing has happened yet, and the row says so.
  select * into t from ops_asst.assistant_turns where turn_no = v_no;
  assert t.draft_outcome is null and t.produced_ref is null, 'a draft is not a write';

  b := ops_asst.close_draft(v_no,'ditunda');
  assert b -> 'error' ->> 'code' = 'bad_outcome', 'got ' || coalesce(b -> 'error' ->> 'code','(null)');

  -- A confirmation with nothing to show for it is the shape of a write that
  -- half happened.
  b := ops_asst.close_draft(v_no,'confirmed');
  assert b -> 'error' ->> 'code' = 'produced_required', 'got ' || coalesce(b -> 'error' ->> 'code','(null)');

  b := ops_asst.close_draft(v_no,'confirmed','pr-26-09-21_01-L01','k-90-close');
  assert ops_core.said_ok(b), 'got ' || coalesce(b -> 'error' ->> 'code', b::text);

  select * into t from ops_asst.assistant_turns where turn_no = v_no;
  assert t.draft_outcome = 'confirmed', 'got ' || coalesce(t.draft_outcome,'(null)');
  assert t.produced_ref = 'pr-26-09-21_01-L01', 'and the document it became, got '
    || coalesce(t.produced_ref,'(null)');

  -- Once, and once only.
  b := ops_asst.close_draft(v_no,'abandoned');
  assert b -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(b -> 'error' ->> 'code','(null)');
  -- A retry with the key is the earlier answer, not a second decision.
  b := ops_asst.close_draft(v_no,'confirmed','pr-26-09-21_01-L01','k-90-close');
  assert b ->> 'outcome' = 'duplicate', 'got ' || coalesce(b ->> 'outcome','(null)');
end $$;

/* ── REFUSAL: a turn is what somebody read before they acted ───────────── */
do $$
declare v_no text; n int;
begin
  select turn_no into v_no from ops_asst.assistant_turns where produced_ref is not null;

  -- The ordinary road: there is no UPDATE grant, so it never reaches a trigger.
  begin
    update ops_asst.assistant_turns set prompt = 'sesuatu yang lain' where turn_no = v_no;
    raise exception 'rewriting the prompt should be refused';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from ops_asst.assistant_turns where turn_no = v_no;
    raise exception 'deleting a turn somebody acted on should be refused';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from ops_asst.assistant_turns
   where turn_no = v_no and prompt like 'tolong buat permintaan%';
  assert n = 1, 'and it is where it was, got ' || n;
end $$;

-- And the road that **does** have the rights: a `security definer` seam, a
-- migration, somebody at a psql prompt. That is the road the trigger is for,
-- and testing it through a grant that already refuses would have left it
-- untested while looking covered.
reset role;
do $$
declare v_no text;
begin
  select turn_no into v_no from ops_asst.assistant_turns where produced_ref is not null;
  begin
    update ops_asst.assistant_turns set prompt = 'sesuatu yang lain' where turn_no = v_no;
    raise exception 'rewriting the prompt should be refused even by an owner';
  exception when check_violation then
    assert sqlerrm like '%only the draft''s outcome may change%', 'got ' || sqlerrm;
  end;
  begin
    update ops_asst.assistant_turns
       set facts = '[{"label":"x","value":"y","source":"z","href":null}]'::jsonb
     where turn_no = v_no;
    raise exception 'rewriting the figures should be refused';
  exception when check_violation then null;
  end;
  -- The one field that is supposed to move has already moved, and moving it
  -- again is the other half of the same trigger.
  begin
    update ops_asst.assistant_turns set draft_outcome = 'abandoned' where turn_no = v_no;
    raise exception 'deciding a draft twice should be refused';
  exception when check_violation then
    assert sqlerrm like '%decided once%', 'got ' || sqlerrm;
  end;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009002';

/* ── REFUSAL: confirming somebody else's draft ─────────────────────────── */
--
-- Budi cannot read Sari's turn, so he cannot look its number up — which is the
-- system working, and leaves the test with nothing to pass in. Carried across
-- here rather than weakened: *he does not know the number* is not the same
-- refusal as *it is not his to close*, and it is the second one worth proving.
create temp table t90_draft as
  select turn_no from ops_asst.assistant_turns where produced_ref is not null;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009001';
do $$
declare a jsonb; v_no text;
begin
  select turn_no into v_no from t90_draft;
  assert (select count(*) from ops_asst.assistant_turns where turn_no = v_no) = 0,
    'and he genuinely cannot see it';
  -- Budi cannot even see it, and the answer says whose it is rather than
  -- pretending it does not exist — the second yes is the **same person's** yes,
  -- which is the whole of D220.
  a := ops_asst.close_draft(v_no,'abandoned');
  assert a -> 'error' ->> 'code' = 'not_yours', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- And a turn that produced no draft has nothing to close.
  select turn_no into v_no from ops_asst.assistant_turns
   where actor_id = 'ffffffff-0000-0000-0000-000000009001' and kind = 'answer' limit 1;
  a := ops_asst.close_draft(v_no,'abandoned');
  assert a -> 'error' ->> 'code' = 'not_a_draft', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: where did this line come from, without the question ───── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009003';
do $$
declare p record; n int; v_payload jsonb;
begin
  assert ops_core.has_permission('it.read'), 'IT may ask where a write came from';

  select * into p from ops_asst.v_turn_provenance where produced_ref = 'pr-26-09-21_01-L01';
  assert p.tool = 'procurement.draft_pr_line', 'got ' || coalesce(p.tool,'(null)');
  assert p.actor_name = 'Sari Dewi',           'and who confirmed it, got ' || coalesce(p.actor_name,'(null)');
  assert p.draft_outcome = 'confirmed',        'got ' || coalesce(p.draft_outcome,'(null)');
  assert p.fields -> 0 ->> 'value' = 'Tripleks 12mm',
    'field by field, as it was confirmed, got ' || coalesce(p.fields -> 0 ->> 'value','(null)');

  -- Only the turns that wrote something. A conversation that answered and
  -- guided is not on this list at all.
  select count(*) into n from ops_asst.v_turn_provenance;
  assert n = 1, 'one write through the prompt, got ' || n;

  -- **And the question that produced it comes with it**, because the sentence
  -- somebody typed instead of filling in the form is that document's
  -- provenance. The ones that produced nothing do not: IT reads one turn out
  -- of the seven on this table.
  select count(*) into n from ops_asst.assistant_turns;
  assert n = 1, 'the draft turn, and no other conversation, got ' || n;
  assert (select prompt from ops_asst.assistant_turns)
         like 'tolong buat permintaan%', 'and it reads the sentence that wrote';
  assert not exists (select 1 from ops_asst.assistant_turns where prompt like '%gaji pak joko%'),
    'the salary question produced nothing and is nobody else''s business';

  -- The write is announced with everything on it, because it is the one input
  -- path with no form behind it.
  select payload into v_payload from ops_core.outbox
   where event_type = 'assistant.draft.confirmed';
  assert v_payload ->> 'produced_ref' = 'pr-26-09-21_01-L01', 'got '
    || coalesce(v_payload ->> 'produced_ref','(null)');
  assert v_payload -> 'fields' -> 0 ->> 'label' = 'Barang', 'with the fields, got '
    || coalesce((v_payload -> 'fields')::text,'(null)');
end $$;

/* ── REFUSAL: a colleague's write is not a colleague's business ────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009001';
do $$
declare n int;
begin
  assert not ops_core.has_permission('it.read'), 'Budi is not IT';
  -- Sari would see her own draft here, and should: it is hers. Budi is the
  -- one who proves the limit, because the widening policy is `it.read` and
  -- nothing else — a colleague with no audit role reads none of it.
  select count(*) into n from ops_asst.v_turn_provenance;
  assert n = 0, 'got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009002';
do $$
declare n int;
begin
  -- And the author still sees her own, through the first policy.
  select count(*) into n from ops_asst.v_turn_provenance;
  assert n = 1, 'her own draft is hers to read, got ' || n;
end $$;

rollback;
