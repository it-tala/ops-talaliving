-- asst — a draft is not a write, and a second yes is not a second write.
--
-- ── The two things a draft store can get wrong ───────────────────────────
--
-- **It can let a write happen without a yes.** A draft against a tool the
-- person may not use, or against a tool nobody may reach from a prompt, would
-- be a form that ends in a write nobody was allowed to ask for. So the gate is
-- applied again at the moment of drafting — not because `may_run` might have
-- been skipped, but because a draft against a blocked tool must be impossible
-- to *construct*, not merely impossible to confirm.
--
-- **It can let one yes become two writes.** Two taps on a slow connection is
-- the ordinary way this happens, and the record must say what happened once.
--
-- Both are measured below, along with the constraints that keep an abandoned
-- draft from claiming it produced something.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5570000-0000-0000-0000-000000000021','buy@talaliving.com',  '{"full_name":"Buyer"}'),
  ('a5570000-0000-0000-0000-000000000022','look@talaliving.com', '{"full_name":"Looker"}'),
  ('a5570000-0000-0000-0000-000000000023','boss@talaliving.com', '{"full_name":"Boss"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('a5570000-0000-0000-0000-000000000021','procurement','write'),
  ('a5570000-0000-0000-0000-000000000022','procurement','read');
insert into ops_core.user_modules (user_id, module, level)
  select 'a5570000-0000-0000-0000-000000000023', m, 'admin'
    from unnest(enum_range(null::ops_core.module_t)) m;

set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000021';

/* ── a sentence becomes a form ─────────────────────────────────────────── */

do $$
declare r jsonb; v_turn uuid; v_draft uuid;
begin
  r := ops_asst.record_turn('minta beli 20 lembar plywood', 'draft', 'id',
        'menyiapkan baris permintaan pembelian', '', '[]'::jsonb, '[]'::jsonb,
        array['procurement.draft_pr_line'], null, '/procurement/pr/new', 61);
  assert ops_core.said_ok(r), format('got %s', r);
  v_turn := (r -> 'data' ->> 'id')::uuid;

  r := ops_asst.open_draft(v_turn, 'procurement.draft_pr_line',
        '{"qty":"20","uom":"lembar"}'::jsonb, 'idem-pr-1');
  assert ops_core.said_ok(r), format('got %s', r);
  v_draft := (r -> 'data' ->> 'id')::uuid;
  assert r -> 'data' ->> 'outcome' is null, 'nothing has happened yet';
  assert r -> 'data' -> 'args' ->> 'qty' = '20', format('got %s', r -> 'data' -> 'args');

  -- A double submit is one draft, and the same one. Answering `noop` with the
  -- row that exists keeps the client's idempotency key pointing at one thing.
  r := ops_asst.open_draft(v_turn, 'procurement.draft_pr_line', '{}'::jsonb, 'idem-pr-2');
  assert r ->> 'outcome' = 'noop', format('got %s', r);
  assert (r -> 'data' ->> 'id')::uuid = v_draft, 'and it is the same draft';
  assert r -> 'data' ->> 'idempotency_key' = 'idem-pr-1',
    format('the first key survives, got %s', r -> 'data' ->> 'idempotency_key');
end $$;

/* ── the second yes, and only one of it ────────────────────────────────── */

do $$
declare r jsonb; v_draft uuid;
begin
  select id into v_draft from ops_asst.drafts order by created_at desc limit 1;

  -- A yes with nothing behind it is a yes to an unknown thing.
  r := ops_asst.settle_draft(v_draft, 'confirmed', null, 'PR-26-09-0001');
  assert r -> 'error' ->> 'code' = 'payload_required', format('got %s', r);

  -- Keyed by `key`, not by the label the person read: a label is display text
  -- and changes with the language in force, so a payload keyed by it empties
  -- itself when somebody switches language between the draft and the yes.
  r := ops_asst.settle_draft(v_draft, 'confirmed',
        '{"item":"Plywood 12mm","qty":"20 lembar","purpose":"Stok workshop"}'::jsonb,
        'PR-26-09-0001');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'produced_ref' = 'PR-26-09-0001', format('got %s', r -> 'data');
  -- What was pressed yes on, not what the sentence happened to contain. The
  -- sentence said nothing about a purpose; the person typed one (D220).
  assert r -> 'data' -> 'confirmed_payload' ->> 'purpose' = 'Stok workshop',
    format('got %s', r -> 'data' -> 'confirmed_payload');

  -- Two taps on a slow connection. `duplicate`, and the client keeps its
  -- claim: the thing it asked for has already happened.
  r := ops_asst.settle_draft(v_draft, 'confirmed', '{"item":"Something else"}'::jsonb, 'PR-26-09-0002');
  assert r -> 'error' ->> 'code' = 'already_settled', format('got %s', r);
  assert (r ->> 'status')::int = 409, format('got %s', r ->> 'status');

  -- And nothing moved.
  assert (select produced_ref from ops_asst.drafts where id = v_draft) = 'PR-26-09-0001',
    'a second confirm does not repoint the first';
  assert (select confirmed_payload ->> 'item' from ops_asst.drafts where id = v_draft) = 'Plywood 12mm',
    'nor rewrite what was agreed to';
end $$;

/* ── changing your mind costs nothing, because nothing had started ─────── */

do $$
declare r jsonb; v_turn uuid; v_draft uuid;
begin
  r := ops_asst.record_turn('buatkan po ke hadi glass', 'draft', 'id', null, '',
        '[]'::jsonb, '[]'::jsonb, array['procurement.draft_po'], null, '/procurement/po', 60);
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'procurement.draft_po', '{"name":"hadi glass"}'::jsonb, 'idem-po-1');
  v_draft := (r -> 'data' ->> 'id')::uuid;

  r := ops_asst.settle_draft(v_draft, 'abandoned');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'produced_ref' is null, 'an abandoned draft produced nothing';
  assert r -> 'data' ->> 'confirmed_payload' is null, 'and agreed to nothing';

  r := ops_asst.settle_draft(v_draft, 'confirmed', '{"x":"y"}'::jsonb);
  assert r -> 'error' ->> 'code' = 'already_settled',
    format('a mind, once changed, is not un-changed by a second call: %s', r);
end $$;

/* ── REFUSAL: a blocked tool cannot even be drafted against ────────────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000023';

do $$
declare r jsonb; v_turn uuid; n int;
begin
  -- Admin of every module there is. The gate is applied again here, and it is
  -- the same gate: a draft against a blocked tool must be impossible to
  -- construct, not merely impossible to confirm.
  r := ops_asst.record_turn('ubah pengaturan toleransi', 'refused', 'id');
  v_turn := (r -> 'data' ->> 'id')::uuid;

  r := ops_asst.open_draft(v_turn, 'it.settings_write', '{}'::jsonb);
  assert r -> 'error' ->> 'code' = 'closed', format('got %s', r);
  assert length(r -> 'error' ->> 'message') > 80, 'and it says why';

  select count(*) into n from ops_asst.drafts where actor_id = auth.uid();
  assert n = 0, format('and nothing was written down, got %s rows', n);
end $$;

/* ── REFUSAL: a read is not a write, and has nothing to confirm ────────── */

do $$
declare r jsonb; v_turn uuid;
begin
  r := ops_asst.record_turn('berapa saldo kas', 'answer', 'id');
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'accounting.balances', '{}'::jsonb);
  assert r -> 'error' ->> 'code' = 'not_a_write', format('got %s', r);
end $$;

/* ── REFUSAL: read access does not draft ───────────────────────────────── */

set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000000022';

do $$
declare r jsonb; v_turn uuid;
begin
  r := ops_asst.record_turn('minta beli 5 kg lem', 'draft', 'id');
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'procurement.draft_pr_line', '{}'::jsonb);
  assert r -> 'error' ->> 'code' = 'permission_required', format('got %s', r);
end $$;

/* ── REFUSAL: somebody else's draft is not there ───────────────────────── */

do $$
declare r jsonb; v_draft uuid; n int;
begin
  -- The looker cannot see the buyer's drafts at all…
  select count(*) into n from ops_asst.drafts;
  assert n = 0, format('a draft is the person''s own, got %s rows', n);

  -- …and cannot settle one by knowing its id. The answer is `not_found` and
  -- not `refused`, deliberately: *that is somebody else's* would confirm the
  -- id belonged to a real draft.
  set local role postgres;
  select id into v_draft from ops_asst.drafts where actor_id = 'a5570000-0000-0000-0000-000000000021' limit 1;
  set local role authenticated;

  r := ops_asst.settle_draft(v_draft, 'abandoned');
  assert r -> 'error' ->> 'code' = 'not_found', format('got %s', r);
end $$;

/* ── a draft cannot be opened against somebody else's sentence ─────────── */

do $$
declare r jsonb; v_turn uuid;
begin
  set local role postgres;
  select id into v_turn from ops_asst.turns
   where actor_id = 'a5570000-0000-0000-0000-000000000021' limit 1;
  set local role authenticated;

  r := ops_asst.open_draft(v_turn, 'procurement.draft_pr_line', '{}'::jsonb);
  assert r -> 'error' ->> 'code' = 'not_found', format('got %s', r);
end $$;

/* ── the constraints, which are the last line ──────────────────────────── */

set local role postgres;

do $$
declare v_turn uuid;
begin
  select id into v_turn from ops_asst.turns limit 1;

  -- An abandoned draft that produced something is a document with nobody's
  -- yes behind it.
  begin
    insert into ops_asst.drafts (turn_id, actor_id, tool, idempotency_key, outcome, decided_at, produced_ref)
    values (gen_random_uuid(), 'a5570000-0000-0000-0000-000000000021',
            'procurement.draft_po', 'k1', 'abandoned', now(), 'PO-26-09-0009');
    assert false, 'an abandoned draft produces nothing';
  exception when check_violation or foreign_key_violation then null; end;

  -- Decided, with no record of when.
  begin
    insert into ops_asst.drafts (turn_id, actor_id, tool, idempotency_key, outcome, confirmed_payload)
    values (v_turn, 'a5570000-0000-0000-0000-000000000021',
            'procurement.draft_po', 'k2', 'confirmed', '{}'::jsonb);
    assert false, 'an outcome has a moment';
  exception when check_violation or unique_violation then null; end;
end $$;

rollback;
