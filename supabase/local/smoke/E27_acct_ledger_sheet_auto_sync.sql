-- acct — the GL OPS sheet keeps itself up to date (0302, D460).
--
-- Proved here:
--   * refusal: without post_ledger the rows and the run record are still
--     refused, and anon cannot call either;
--   * the rows answer `hash`, `last_hash` (the last good write's) and
--     `last_ok_at`; a new transaction changes the hash, so the job writes;
--   * a person's run records `manual`, who, and the hash; a failed run keeps
--     no hash and does not move `last_hash`;
--   * the job (`service_role`, no session) reads the rows and records `cron`
--     with nobody as `run_by`;
--   * the kick is a no-op without Vault/pg_net, and for a person without
--     post_ledger.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000e302','gl-auto@talaliving.com','{"full_name":"GL Auto"}'),
  ('eeee0000-0000-0000-0000-00000000f302','gl-auto-read@talaliving.com','{"full_name":"GL Auto Reader"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('eeee0000-0000-0000-0000-00000000e302','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000e302','accounting','write'),
  ('eeee0000-0000-0000-0000-00000000f302','accounting','read');

do $$
begin
  assert not has_function_privilege('anon', 'ops_acct.ledger_sheet_rows()', 'execute'), 'anon may not read the rows';
  assert not has_function_privilege('anon', 'ops_acct.record_ledger_sheet_run(int, text, text, text)', 'execute'),
    'anon may not record a run';
  assert has_function_privilege('service_role', 'ops_acct.ledger_sheet_rows()', 'execute'), 'the job reads the rows';
  assert has_function_privilege('service_role', 'ops_acct.record_ledger_sheet_run(int, text, text, text)', 'execute'),
    'the job records its run';
end $$;

/* ── the kick without Vault or pg_net: nothing, and no error ─────────────── */
select ops_acct.kick_ledger_sheet_sync();

set local role authenticated;

/* ── REFUSAL: no post_ledger ───────────────────────────────────────────── */
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000f302';
do $$
declare r jsonb;
begin
  r := ops_acct.ledger_sheet_rows();
  assert r->>'outcome' = 'refused' and r->'error'->>'code' = 'forbidden', 'reader may not sync: ' || r::text;
  r := ops_acct.record_ledger_sheet_run(1, 'ok', null, 'abc');
  assert r->>'outcome' = 'refused', 'reader may not record a run: ' || r::text;
  perform ops_acct.kick_ledger_sheet_sync();   -- returns quietly
end $$;

/* ── a person: hash, record, last_hash ─────────────────────────────────── */
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000e302';
do $$
declare
  r  jsonb;
  h1 text;
  h2 text;
  run ops_acct.ledger_sheet_runs;
begin
  r := ops_acct.ledger_sheet_rows();
  assert r->>'outcome' = 'ok', 'rows: ' || r::text;
  h1 := r->'data'->>'hash';
  assert h1 ~ '^[0-9a-f]{32}$', 'an md5: ' || coalesce(h1, 'null');
  assert h1 = md5((r->'data'->'rows')::text), 'the hash is of the rows';

  r := ops_acct.record_ledger_sheet_run(jsonb_array_length(ops_acct.ledger_sheet_rows()->'data'->'rows'), 'ok', null, h1);
  assert r->>'outcome' = 'ok', 'record: ' || r::text;
  select * into run from ops_acct.ledger_sheet_runs where id = (r->'data'->>'id')::uuid;
  assert run.trigger = 'manual' and run.run_by = 'eeee0000-0000-0000-0000-00000000e302' and run.content_hash = h1,
    'a person''s run: ' || row_to_json(run)::text;

  r := ops_acct.ledger_sheet_rows();
  assert r->'data'->>'last_hash' = h1, 'last_hash is the write just recorded: ' || (r->'data')::text;
  assert r->'data'->>'last_ok_at' is not null, 'last_ok_at';
  assert r->'data'->>'hash' = h1, 'nothing changed, same hash';

  -- A failed write keeps no hash and does not become the last good one.
  r := ops_acct.record_ledger_sheet_run(1, 'failed', 'sheet 403', 'ffffffffffffffffffffffffffffffff');
  select * into run from ops_acct.ledger_sheet_runs where id = (r->'data'->>'id')::uuid;
  assert run.content_hash is null, 'a failed run keeps no hash';
  assert ops_acct.ledger_sheet_rows()->'data'->>'last_hash' = h1, 'last_hash is still the good write';
end $$;

/* ── a new row changes the hash ─────────────────────────────────────────── */
reset role;
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by, status)
select '77770000-0000-0000-0000-000000000302', 'trx-gl-auto-1', '2026-12-31', a.id, 'OUT', 12345, 'SUPPLIERS',
       'AUTO SYNC PROBE', 'trx-gl-auto-1', 'eeee0000-0000-0000-0000-00000000e302', 'POSTED'
  from ops_acct.accounts a where a.code = 'PETTY CASH';
set local role authenticated;
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000e302';
do $$
declare r jsonb;
begin
  r := ops_acct.ledger_sheet_rows();
  assert r->'data'->>'hash' is distinct from r->'data'->>'last_hash', 'a new row: the job must write';
  assert exists (select 1 from jsonb_array_elements(r->'data'->'rows') e where e->>'trx_no' = 'trx-gl-auto-1'),
    'the new row is in the rows';
end $$;

/* ── the job: service_role, no session ─────────────────────────────────── */
reset role;
set local request.jwt.claim.sub = '';
set local role service_role;
do $$
declare
  r jsonb;
begin
  assert auth.uid() is null, 'the job has no session';
  r := ops_acct.ledger_sheet_rows();
  assert r->>'outcome' = 'ok', 'the job reads the rows: ' || r::text;
  r := ops_acct.record_ledger_sheet_run(jsonb_array_length(r->'data'->'rows'), 'ok', null, r->'data'->>'hash');
  assert r->>'outcome' = 'ok', 'the job records: ' || r::text;
  assert ops_acct.ledger_sheet_rows()->'data'->>'last_hash' = ops_acct.ledger_sheet_rows()->'data'->>'hash',
    'the job''s write is the last good one';
end $$;

-- service_role gets functions, never tables (0038): read the run back as owner.
reset role;
do $$
declare run ops_acct.ledger_sheet_runs;
begin
  select * into run from ops_acct.ledger_sheet_runs where trigger = 'cron';
  assert found and run.trigger = 'cron' and run.run_by is null and run.content_hash is not null,
    'the job''s run: ' || row_to_json(run)::text;
end $$;

rollback;
