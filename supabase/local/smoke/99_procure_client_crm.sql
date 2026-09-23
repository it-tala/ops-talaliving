-- procure — the client log: contacts, follow-ups, and who closed them (0134).
--
--   REFUSALS     no summary; an unknown kind; a date in the future; a follow-up
--                before the contact; a project of another client; a quotation
--                of another project; a project with no client; a reader writing
--   DERIVATIONS  client taken from the project, project from the quotation;
--                follow-up states overdue / today / upcoming / done; closing
--                twice is a no-op; an outsider reads nothing

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000f0001','sales-crm@talaliving.com','{"full_name":"Sales CRM"}'),
  ('ffffffff-0000-0000-0000-0000000f0002','baca-crm@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-0000000f0003','luar-crm@talaliving.com','{"full_name":"Orang Luar"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000f0001','project','write'),
  ('ffffffff-0000-0000-0000-0000000f0002','project','read'),
  ('ffffffff-0000-0000-0000-0000000f0003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('0f000000-0000-0000-0000-0000000000c1','CL-CRM1','Hotel Satu'),
  ('0f000000-0000-0000-0000-0000000000c2','CL-CRM2','Villa Dua');
insert into ops_procure.projects (id, code, name, is_active, status, client_id) values
  ('0f000000-0000-0000-0000-0000000000a1','CRM-P1','Lobby Hotel Satu', true, 'INQUIRY', '0f000000-0000-0000-0000-0000000000c1'),
  ('0f000000-0000-0000-0000-0000000000a2','CRM-P2','Villa Dua', true, 'INQUIRY', '0f000000-0000-0000-0000-0000000000c2'),
  ('0f000000-0000-0000-0000-0000000000a3','CRM-P3','Stok', true, 'INQUIRY', null);
insert into ops_procure.quotations (id, quote_no, project_id) values
  ('0f000000-0000-0000-0000-0000000000b1','qt-crm-1','0f000000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000f0001';

do $$
declare r jsonb; v jsonb; a1 uuid; a2 uuid; today date := ops_core.office_day();
begin
  r := ops_procure.log_client_activity('CL-CRM1', 'call', ' ');
  assert r->'error'->>'code' = 'summary_required', 'no summary: ' || r::text;
  r := ops_procure.log_client_activity('CL-CRM1', 'fax', 'halo');
  assert r->'error'->>'code' = 'bad_kind', 'kind: ' || r::text;
  r := ops_procure.log_client_activity('CL-CRM1', 'call', 'besok', p_happened_on => today + 1);
  assert r->'error'->>'code' = 'in_future', 'future: ' || r::text;
  r := ops_procure.log_client_activity('CL-CRM1', 'call', 'x', p_happened_on => today - 1, p_follow_up_on => today - 2);
  assert r->'error'->>'code' = 'follow_up_before', 'follow-up before: ' || r::text;
  r := ops_procure.log_client_activity('CL-CRM2', 'call', 'x', p_project_code => 'CRM-P1');
  assert r->'error'->>'code' = 'project_other_client', 'other client: ' || r::text;
  r := ops_procure.log_client_activity(null, 'call', 'x', p_project_code => 'CRM-P2', p_quote_no => 'qt-crm-1');
  assert r->'error'->>'code' = 'quote_other_project', 'other project: ' || r::text;
  r := ops_procure.log_client_activity(null, 'call', 'x', p_project_code => 'CRM-P3');
  assert r->'error'->>'code' = 'no_client', 'no client: ' || r::text;
  r := ops_procure.log_client_activity(null, 'call', 'x');
  assert r->'error'->>'code' = 'client_required', 'nobody: ' || r::text;

  /* DERIVATION: the quotation brings its project, the project its client */
  r := ops_procure.log_client_activity(null, 'whatsapp', 'Quotation dikirim via WA, klien minta waktu',
         p_quote_no => 'qt-crm-1', p_happened_on => today - 3, p_follow_up_on => today - 1,
         p_next_action => 'Tanya keputusan', p_key => 'crm-1');
  assert ops_core.said_ok(r), 'log: ' || r::text;
  a1 := (r->'data'->>'id')::uuid;
  /* the same key twice is one row */
  r := ops_procure.log_client_activity(null, 'whatsapp', 'Quotation dikirim via WA, klien minta waktu',
         p_quote_no => 'qt-crm-1', p_happened_on => today - 3, p_follow_up_on => today - 1, p_key => 'crm-1');
  assert (select count(*) from ops_procure.client_activities where client_id = '0f000000-0000-0000-0000-0000000000c1') = 1, 'idempotent';

  select to_jsonb(x) into v from ops_procure.v_client_activity x where id = a1;
  assert v->>'client_code' = 'CL-CRM1' and v->>'project_code' = 'CRM-P1' and v->>'quote_no' = 'qt-crm-1',
    'resolved: ' || v::text;
  assert v->>'follow_up_state' = 'overdue', 'overdue: ' || v::text;
  assert v->>'created_by_name' = 'Sales CRM', 'who: ' || v::text;

  r := ops_procure.log_client_activity('CL-CRM2', 'meeting', 'Survey lokasi', p_follow_up_on => today);
  a2 := (r->'data'->>'id')::uuid;
  assert (select follow_up_state from ops_procure.v_client_activity where id = a2) = 'today', 'today';
  r := ops_procure.log_client_activity('CL-CRM2', 'note', 'Butuh desain ulang', p_follow_up_on => today + 7);
  assert (select follow_up_state from ops_procure.v_client_activity where id = (r->'data'->>'id')::uuid) = 'upcoming', 'upcoming';

  r := ops_procure.complete_follow_up(a1, 'Klien setuju, tunggu PO');
  assert ops_core.said_ok(r), 'complete: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_client_activity x where id = a1;
  assert v->>'follow_up_state' = 'done' and v->>'follow_up_result' = 'Klien setuju, tunggu PO'
     and v->>'follow_up_done_by_name' = 'Sales CRM', 'done: ' || v::text;
  r := ops_procure.complete_follow_up(a1);
  assert r->>'outcome' = 'noop', 'twice: ' || r::text;

  r := ops_procure.log_client_activity('CL-CRM2', 'note', 'tanpa follow-up');
  r := ops_procure.complete_follow_up((r->'data'->>'id')::uuid);
  assert r->'error'->>'code' = 'no_follow_up', 'nothing to close: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000f0002';
do $$
declare r jsonb;
begin
  assert (select count(*) from ops_procure.v_client_activity where client_code like 'CL-CRM%') = 4, 'reader reads';
  r := ops_procure.log_client_activity('CL-CRM1', 'call', 'x');
  assert r->'error'->>'code' = 'not_permitted', 'reader writes: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000f0003';
do $$
begin
  assert (select count(*) from ops_procure.client_activities) = 0, 'outsider reads nothing';
end $$;

rollback;
