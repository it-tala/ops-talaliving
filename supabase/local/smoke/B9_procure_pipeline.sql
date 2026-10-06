-- procure — the pipeline: who sells, where a lead came from, and why a sale
-- did not happen (0218, 0219, P2, D375–D377).
--
-- DERIVATIONS  marketing access alone sells: a client, an inquiry, its sale
--              facts, a contact, a quotation, a closing — and reads the
--              quotations and the contact log; v_project reads the salesperson,
--              the source, the estimate, the days in the status, the
--              quotation in play and why it closed; a lost sale can be
--              reopened; an order cancelled after the deal says why
-- REFUSALS     LOST after the deal; CANCELLED before it; closing without a
--              category, with one nobody knows, or without a sentence; a
--              negative estimate; a salesperson who is not an active account;
--              marketing editing order lines (those stay project's); somebody
--              with neither access

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000b9001','mkt-pipeline@talaliving.com','{"full_name":"Rina Marketing"}'),
  ('aaaa0000-0000-0000-0000-0000000b9002','gudang-pipeline@talaliving.com','{"full_name":"Gudang"}'),
  ('aaaa0000-0000-0000-0000-0000000b9003','pm-pipeline@talaliving.com','{"full_name":"PM"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000b9001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000b9002','inventory','write'),
  ('aaaa0000-0000-0000-0000-0000000b9003','project','write');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000b9001';

do $$
declare r jsonb; v jsonb; v_client text; v_code text; v_quote text;
begin
  -- marketing alone sells (D375)
  r := ops_procure.save_client(null, 'PT Contoh Pipeline');
  assert ops_core.said_ok(r), 'marketing adds a client: ' || r::text;
  v_client := r->'data'->>'code';
  r := ops_procure.save_project(null, 'Residence Pipeline', v_client);
  assert ops_core.said_ok(r), 'marketing opens an inquiry: ' || r::text;
  v_code := r->'data'->>'code';

  r := ops_procure.set_project_sales(v_code, 'aaaa0000-0000-0000-0000-0000000b9001', ' Instagram DM ', 420000000, current_date + 30);
  assert ops_core.said_ok(r), 'sale facts: ' || r::text;
  r := ops_procure.set_project_sales(v_code, null, null, -1, null);
  assert r->'error'->>'code' = 'negative_value', 'negative estimate: ' || r::text;
  r := ops_procure.set_project_sales(v_code, 'aaaa0000-0000-0000-0000-0000000b9fff', null, null, null);
  assert r->'error'->>'code' = 'sales_pic_unknown', 'not an account: ' || r::text;

  r := ops_procure.log_client_activity(v_client, 'meeting', 'Presentasi moodboard', v_code);
  assert ops_core.said_ok(r), 'marketing logs a meeting: ' || r::text;
  assert (select count(*) from ops_procure.v_client_activity where project_code = v_code) = 1, 'and reads it back';

  r := ops_procure.save_quotation(null, v_code, current_date + 14);
  assert ops_core.said_ok(r), 'marketing drafts a quotation: ' || r::text;
  v_quote := r->'data'->>'quote_no';
  assert (select count(*) from ops_procure.v_quotation where quote_no = v_quote) = 1, 'and reads it';

  -- order lines stay with project access
  r := ops_procure.save_project_line(v_code, null, null, 'Sofa', 2, 'pcs');
  assert r->'error'->>'code' = 'not_permitted', 'order lines are project''s: ' || r::text;

  assert exists (select 1 from ops_procure.sales_people() x where x.full_name = 'Rina Marketing'), 'a seller is offered';
  assert not exists (select 1 from ops_procure.sales_people() x where x.full_name = 'Gudang'), 'a storeman is not';

  -- what the pipeline reads
  select to_jsonb(x) into v from ops_procure.v_project x where code = v_code;
  assert v->>'sales_pic_name' = 'Rina Marketing' and v->>'source_note' = 'Instagram DM'
     and (v->>'expected_value')::numeric = 420000000, 'the sale on the view: ' || v::text;
  assert (v->>'days_in_status')::int = 0, 'days in status: ' || coalesce(v->>'days_in_status', 'null');
  assert v->>'current_quote_no' = v_quote and v->>'current_quote_status' = 'DRAFT', 'the quotation in play: ' || v::text;

  -- closing: LOST before the deal, with a category and a sentence (D377)
  r := ops_procure.set_project_status(v_code, 'CANCELLED', 'mahal', 'PRICE');
  assert r->'error'->>'code' = 'cancel_before_deal', 'not CANCELLED before the deal: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'LOST', 'mahal');
  assert r->'error'->>'code' = 'reason_code_required', 'a category: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'LOST', 'mahal', 'EXPENSIVE');
  assert r->'error'->>'code' = 'unknown_reason_code', 'a known category: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'LOST', '  ', 'PRICE');
  assert r->'error'->>'code' = 'reason_required', 'a sentence: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'LOST', 'Klien memilih vendor lokal, 15% lebih murah', 'PRICE');
  assert ops_core.said_ok(r), 'lost: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_project x where code = v_code;
  assert v->>'status' = 'LOST' and v->>'closing_reason_code' = 'PRICE'
     and v->>'closing_reason' like 'Klien memilih%' and not (v->>'is_active')::boolean, 'why it closed: ' || v::text;

  -- reopened: the closing no longer reads
  r := ops_procure.set_project_status(v_code, 'INQUIRY');
  assert ops_core.said_ok(r), 'reopen: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_project x where code = v_code;
  assert v->>'closing_reason_code' is null and (v->>'is_active')::boolean, 'reopened: ' || v::text;

  -- after the deal it is CANCELLED, never LOST
  r := ops_procure.set_project_status(v_code, 'DEAL');
  assert ops_core.said_ok(r), 'deal: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'LOST', 'tidak jadi', 'OTHER');
  assert r->'error'->>'code' = 'lost_after_deal', 'not LOST after the deal: ' || r::text;
  r := ops_procure.set_project_status(v_code, 'CANCELLED', 'Pemilik unit menjual unitnya', 'OTHER');
  assert ops_core.said_ok(r), 'cancelled after the deal: ' || r::text;
  assert (select count(*) from ops_procure.project_status_log l join ops_procure.projects p on p.id = l.project_id
           where p.code = v_code and l.reason_code is not null) = 2, 'both closings carry their category';
end $$;

-- somebody with neither project nor marketing access
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000b9002';
do $$
declare r jsonb;
begin
  r := ops_procure.set_project_sales((select code from ops_procure.projects order by created_at desc limit 1), null, null, null, null);
  assert r->'error'->>'code' = 'not_permitted', 'outsider sale facts: ' || r::text;
  r := ops_procure.set_project_status((select code from ops_procure.projects order by created_at desc limit 1), 'INQUIRY');
  assert r->'error'->>'code' = 'not_permitted', 'outsider status: ' || r::text;
  assert (select count(*) from ops_procure.v_quotation) = 0, 'outsider reads no quotation';
  assert (select count(*) from ops_procure.sales_people()) = 0, 'outsider is offered nobody';
end $$;

-- project access still sells, as before
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000b9003';
do $$
declare r jsonb;
begin
  r := ops_procure.save_project(null, 'Proyek PM');
  assert ops_core.said_ok(r), 'project access still opens a project: ' || r::text;
  r := ops_procure.set_project_sales(r->'data'->>'code', null, 'Repeat client', null, null);
  assert ops_core.said_ok(r), 'and records its sale: ' || r::text;
end $$;

rollback;
