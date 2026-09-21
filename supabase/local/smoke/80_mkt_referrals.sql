-- mkt — the Package programme's second funnel: what a project owes the person
-- who brought it in (D185, D186).
--
--   REFUSALS     a rate of nought or of twenty-five; `WON` with no project
--                code; `WON` naming a project that does not exist; `WON`
--                against a contract nobody has valued; `LOST` with no reason;
--                a commission paid on an introduction that never became a job;
--                **two commissions on one project**; **moving a rate that has
--                already been paid against**; deleting a referral; reading any
--                of it without marketing or accounting
--   DERIVATIONS  commission is value × rate, **derived on every read**, and
--                the value is read from the project rather than copied beside
--                it (C15) — so revising the contract revises the commission;
--                nothing is owed on an introduction that has not been won;
--                `v_project_cost` gains what the job was **sold** for and what
--                its introduction **costs**, withheld as null from a reader
--                who may not see it rather than summed to nought
--
-- Worked out first:  PRJ-80  500.000.000 × 2,5% = 12.500.000  (belum dibayar)
--                    PRJ-81  200.000.000 × 2,5% =  5.000.000  (sudah dibayar)
--                    revisi  600.000.000 × 2,5% = 15.000.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008001','mkt@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008002','akun80@talaliving.com','{"full_name":"Staf Akunting"}'),
  ('ffffffff-0000-0000-0000-000000008003','tukang80@talaliving.com','{"full_name":"Tukang Kayu"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008001','marketing','write'),
  -- Only so the fixture can revise a contract further down; nothing about the
  -- programme needs it.
  ('ffffffff-0000-0000-0000-000000008001','project','write'),
  -- Accounting pays these commissions, so accounting must be able to see them.
  ('ffffffff-0000-0000-0000-000000008002','accounting','write'),
  ('ffffffff-0000-0000-0000-000000008003','production','write');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price) values
  ('KAYU-80','Papan jati 2cm','raw-wood','lembar', 200000);
insert into ops_procure.projects (code, name, contract_value) values
  ('PRJ-80','Astoria PH-1', 500000000),
  ('PRJ-81','Astoria PH-2', 200000000),
  -- A job nobody has valued yet. Ordinary, and the reason `WON` has a trigger.
  ('PRJ-82','Astoria PH-3', null),
  -- Quoted, priced, and not signed. The figure exists and is owed to nobody.
  ('PRJ-83','Astoria PH-4', 100000000);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008003';

-- One product and one order per project, because `v_project_cost` is a
-- question about work and a project with no work order is not on it.
insert into ops_prod.products (id, product_code, name, category, uom, created_by)
values ('bbbb8000-0000-0000-0000-0000000000a1','PRD-80','Kitchen set','Lemari','unit',
        'ffffffff-0000-0000-0000-000000008003');
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb8000-0000-0000-0000-0000000000a1', 1,'ffffffff-0000-0000-0000-000000008003');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb8000-0000-0000-0000-0000000000a1', 1,'material','KAYU-80', 6,'lembar');
update ops_prod.bom_revisions set released_at = now(),
       released_by = 'ffffffff-0000-0000-0000-000000008003', note = 'rev awal'
 where product_id = 'bbbb8000-0000-0000-0000-0000000000a1';
insert into ops_prod.work_orders
  (wo_no, product_code, item_name, qty, uom, project_code, due_date, route, bom_rev, created_by)
values
  ('SPK-80-01','PRD-80','Kitchen set', 2,'unit','PRJ-80', current_date + 30,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000008003'),
  ('SPK-80-02','PRD-80','Kitchen set', 1,'unit','PRJ-81', current_date + 30,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000008003');

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008001';

/* ── REFUSAL: a rate is a number between nothing and a typo ────────────── */
do $$
begin
  assert ops_core.has_permission('marketing.create'), 'marketing runs the programme';
  begin
    insert into ops_mkt.sales_reps (name, commission_percent) values ('Agen Nol', 0);
    raise exception 'a rate of nought should be refused — a rep without one is not a rep (D185)';
  exception when check_violation then null;
  end;
  begin
    insert into ops_mkt.sales_reps (name, commission_percent) values ('Agen Serakah', 25);
    raise exception 'a rate above twenty is a typo far more often than a deal';
  exception when check_violation then null;
  end;
end $$;

insert into ops_mkt.sales_reps (id, rep_no, name, agency, commission_percent, created_by) values
  ('cccc8000-0000-0000-0000-0000000000b1','agn-26-09-18_01','Budi Santoso','Ray White', 2.5,
   'ffffffff-0000-0000-0000-000000008001'),
  ('cccc8000-0000-0000-0000-0000000000b2','agn-26-09-18_02','Sari Dewi','Century 21', 3,
   'ffffffff-0000-0000-0000-000000008001');

/* ── REFUSAL: a commission needs a contract that exists ────────────────── */
do $$
begin
  -- No project code at all.
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status)
    values ('cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','WON');
    raise exception 'WON with no project code should be refused (D186)';
  exception when check_violation then null;
  end;

  -- A code naming nothing. Not a foreign key — the trigger is what makes the
  -- code mean something across the seam (ADR-004). The message matters as much
  -- as the refusal: *no such project* and *that project has no value* are two
  -- different things to go and fix, and one guard catching the other's case
  -- would look identical from here.
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status, project_code)
    values ('cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','WON','PRJ-HANTU');
    raise exception 'WON against a project that does not exist should be refused';
  exception when check_violation then
    assert sqlerrm like 'no project PRJ-HANTU%',
      'and refused for not existing, got ' || sqlerrm;
  end;

  -- A real job nobody has valued. A percentage of nothing is not a commission.
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status, project_code)
    values ('cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','WON','PRJ-82');
    raise exception 'WON against an unvalued contract should be refused (D186)';
  exception when check_violation then null;
  end;

  -- Losing says why, the same as cancelling a work order does.
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status)
    values ('cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','LOST');
    raise exception 'LOST with no reason should be refused';
  exception when check_violation then null;
  end;

  -- Money on an introduction that never became a job.
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status, commission_trx_no)
    values ('cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','QUOTED','trx-26-09-18_001');
    raise exception 'a commission paid on an introduction that was never won should be refused';
  exception when check_violation then null;
  end;
end $$;

insert into ops_mkt.referrals
  (referral_no, rep_id, owner_name, unit, status, project_code, commission_trx_no, lost_reason, created_by)
values
  ('lead-80-01','cccc8000-0000-0000-0000-0000000000b1','Pak Hadi','PH-1','WON','PRJ-80', null, null,
   'ffffffff-0000-0000-0000-000000008001'),
  ('lead-80-02','cccc8000-0000-0000-0000-0000000000b1','Bu Ratna','PH-2','WON','PRJ-81',
   'trx-26-09-18_001', null,'ffffffff-0000-0000-0000-000000008001'),
  ('lead-80-03','cccc8000-0000-0000-0000-0000000000b1','Pak Wawan','PH-7','QUOTED', null, null, null,
   'ffffffff-0000-0000-0000-000000008001'),
  ('lead-80-04','cccc8000-0000-0000-0000-0000000000b1','Bu Lina','PH-9','LOST', null, null,
   'pakai kontraktor sendiri','ffffffff-0000-0000-0000-000000008001'),
  ('lead-80-05','cccc8000-0000-0000-0000-0000000000b2','Pak Anton','PH-3','LEAD', null, null, null,
   'ffffffff-0000-0000-0000-000000008001'),
  -- Priced, and not signed: the one case where every ingredient of a
  -- commission exists and none is owed.
  ('lead-80-06','cccc8000-0000-0000-0000-0000000000b1','Bu Tuti','PH-4','QUOTED','PRJ-83', null, null,
   'ffffffff-0000-0000-0000-000000008001');

/* ── REFUSAL: one project, one commission ──────────────────────────────── */
do $$
begin
  begin
    insert into ops_mkt.referrals (rep_id, owner_name, status, project_code)
    values ('cccc8000-0000-0000-0000-0000000000b2','Pak Hadi juga','WON','PRJ-80');
    raise exception 'a second commission on one project should be refused — the job pays once';
  exception when unique_violation then null;
  end;
end $$;

/* ── DERIVATION: value × rate, and nothing before it is won ────────────── */
do $$
declare v record;
begin
  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-01';
  assert v.contract_value = 500000000,
    'the value comes from the project, got ' || coalesce(v.contract_value::text,'(null)');
  assert v.commission_amount = 12500000,
    '500 juta × 2,5%, got ' || coalesce(v.commission_amount::text,'(null)');
  assert not v.commission_paid,      'nobody has paid it yet';
  assert v.commission_unpaid = 12500000,
    'so all of it is outstanding, got ' || coalesce(v.commission_unpaid::text,'(null)');
  assert v.project_name = 'Astoria PH-1', 'the project names itself across the seam';

  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-02';
  assert v.commission_amount = 5000000, '200 juta × 2,5%, got ' || coalesce(v.commission_amount::text,'(null)');
  assert v.commission_paid,             'the ledger row is on the referral';
  assert v.commission_unpaid = 0,       'and nothing is outstanding, got ' || coalesce(v.commission_unpaid::text,'(null)');

  -- A referral that has been surveyed and quoted is **work, not revenue**. A
  -- percentage of a hoped-for size is a figure the agent will quote back at us.
  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-03';
  assert v.commission_amount is null, 'nothing is owed on an introduction that has not been won';
  assert v.commission_unpaid is null, 'and no outstanding figure either — null, not nought';

  -- The case that separates *not won* from *no figure to work from*: a quoted
  -- job whose project exists and carries a value. Every ingredient is there
  -- and nothing is owed, because a quote is work rather than revenue (D186).
  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-06';
  assert v.contract_value = 100000000, 'the quote has a figure, got ' || coalesce(v.contract_value::text,'(null)');
  assert v.commission_amount is null,  'and it earns nobody anything until it is signed';
end $$;

/* ── DERIVATION: the value is the project's, not a copy of it (C15) ────── */
do $$
declare v record;
begin
  -- The contract is revised. A `contract_value` stored beside the referral
  -- would still be quoting last month's figure, and nothing would say so.
  update ops_procure.projects set contract_value = 600000000 where code = 'PRJ-80';

  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-01';
  assert v.contract_value = 600000000, 'the revision is visible, got ' || coalesce(v.contract_value::text,'(null)');
  assert v.commission_amount = 15000000,
    '600 juta × 2,5% — derived, never stored, got ' || coalesce(v.commission_amount::text,'(null)');

  -- And the read guard beside the write guard: a value cleared in procurement
  -- is not something a trigger here can prevent, so the view reports it as a
  -- state somebody has to go and fix rather than a quiet null.
  update ops_procure.projects set contract_value = null where code = 'PRJ-80';
  select * into v from ops_mkt.v_referral where referral_no = 'lead-80-01';
  assert v.commission_amount is null,   'a commission off a missing number is not a number';
  assert v.contract_value_missing,      'and the row says that is why';

  update ops_procure.projects set contract_value = 500000000 where code = 'PRJ-80';
end $$;

/* ── REFUSAL: a rate that has been paid against cannot move ────────────── */
do $$
begin
  -- Budi has a settled commission. Changing his rate would restate a figure
  -- the ledger has already paid, and the module would stop agreeing with the
  -- bank.
  begin
    update ops_mkt.sales_reps set commission_percent = 4
     where rep_no = 'agn-26-09-18_01';
    raise exception 'moving a rate that has been paid against should be refused';
  exception when check_violation then null;
  end;

  -- Sari has been paid nothing, so hers is still ordinary editing.
  update ops_mkt.sales_reps set commission_percent = 3.5 where rep_no = 'agn-26-09-18_02';
  assert (select commission_percent from ops_mkt.sales_reps where rep_no = 'agn-26-09-18_02') = 3.5,
    'a rate nothing has been paid against is still negotiable';

  -- Everything else about a rep moves freely either way.
  update ops_mkt.sales_reps set phone = '0812-3456' where rep_no = 'agn-26-09-18_01';
end $$;

/* ── REFUSAL: nothing is deleted (A2) ──────────────────────────────────── */
do $$
begin
  begin
    delete from ops_mkt.referrals where referral_no = 'lead-80-04';
    raise exception 'deleting an introduction that came to nothing should be refused';
  exception when insufficient_privilege then null;
  end;
  -- `LOST` with a reason is the record; removing the row is how a conversion
  -- rate improves by forgetting.
  assert (select lost_reason from ops_mkt.referrals where referral_no = 'lead-80-04')
         = 'pakai kontraktor sendiri', 'the reason is the record';
end $$;

/* ── DERIVATION: the rep's own page ────────────────────────────────────── */
do $$
declare r record;
begin
  select * into r from ops_mkt.v_rep where rep_no = 'agn-26-09-18_01';
  assert r.referrals = 5,   'five introductions, got ' || coalesce(r.referrals::text,'(null)');
  assert r.won = 2,         'two of them signed, got ' || coalesce(r.won::text,'(null)');
  assert r.lost = 1,        'one went elsewhere, got ' || coalesce(r.lost::text,'(null)');
  assert r.won_value = 700000000, '500 juta + 200 juta, got ' || coalesce(r.won_value::text,'(null)');
  assert r.commission_earned = 17500000,
    '12,5 juta + 5 juta, got ' || coalesce(r.commission_earned::text,'(null)');
  assert r.commission_paid = 5000000, 'one of the two settled, got ' || coalesce(r.commission_paid::text,'(null)');
  -- The number that matters (D186).
  assert r.commission_unpaid = 12500000, 'what the business still owes him, got '
    || coalesce(r.commission_unpaid::text,'(null)');

  -- A rep who has introduced nothing yet is a row of zeroes, not a missing row:
  -- *onboarded and quiet* is a state somebody follows up on.
  select * into r from ops_mkt.v_rep where rep_no = 'agn-26-09-18_02';
  assert r.referrals = 1,          'one lead, got ' || coalesce(r.referrals::text,'(null)');
  assert r.commission_earned = 0,  'and nothing earned on it yet';
  assert r.won_value is null,      'no contracts at all is not a value of nought';
end $$;

/* ── DERIVATION: `v_project_cost`, completed ───────────────────────────── */
do $$
declare c record; m record;
begin
  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-80';
  -- What the job was sold for: on the project list, which `0006` decided is
  -- not a secret, so it carries no visibility flag of its own.
  assert c.contract_value = 500000000, 'what it was sold for, got ' || coalesce(c.contract_value::text,'(null)');
  assert c.marketing_visible,          'marketing may see what it is owed';
  assert c.commission_owed = 12500000, 'the introduction costs this, got ' || coalesce(c.commission_owed::text,'(null)');
  assert c.commission_paid = 0,        'and none of it is settled, got ' || coalesce(c.commission_paid::text,'(null)');
  -- And what marketing may **not** see: `projected_cost` prices the BOM out of
  -- `ops_procure.items`, which is open to procurement, production and
  -- inventory and to nobody else. A marketing reader prices nothing, so the
  -- figure is withheld and labelled — otherwise its null would be
  -- indistinguishable from *some component has no price*.
  assert not c.cost_visible,           'marketing cannot price a bill of material';
  assert c.projected_cost is null,     'so it is not told what making it costs';
  assert c.orders_without_a_projection is null,
    'nor how many orders lack a projection, which would be all of them';

  -- Same rule one view down. The **structure** is not the secret (F112): how
  -- many things the order needs is visible, and only the money is withheld.
  select * into m from ops_prod.v_wo_materials where wo_no = 'SPK-80-01';
  assert m.projected_lines = 1,        'one component, and marketing may see that';
  assert not m.cost_visible,           'but not price it';
  assert m.projected_cost is null,     'so no cost';
  assert m.projected_unpriced is null, 'and no count of unpriced lines, which would be all of them';

  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-81';
  assert c.commission_owed = 5000000,  'the second job, got ' || coalesce(c.commission_owed::text,'(null)');
  assert c.commission_paid = 5000000,  'and it has been settled, got ' || coalesce(c.commission_paid::text,'(null)');
end $$;

/* ── DERIVATION: one predicate, so accounting sees it too ──────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008002';
do $$
declare c record; n int;
begin
  assert not ops_core.has_permission('marketing.read'), 'accounting is not marketing';
  -- Written into the policy at the start rather than bolted on from outside
  -- four times (F111). Accounting pays these commissions and cannot pay what
  -- it cannot see.
  select count(*) into n from ops_mkt.v_referral;
  assert n = 6, 'accounting reads the programme''s money, got ' || n;

  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-80';
  assert c.marketing_visible,          'and sees it on the project too';
  assert c.commission_owed = 12500000, 'got ' || coalesce(c.commission_owed::text,'(null)');
end $$;

/* ── REFUSAL: withheld from the workshop, never reported as nought ─────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008003';
do $$
declare c record; n int;
begin
  select count(*) into n from ops_mkt.v_referral;
  assert n = 0, 'what an agent is paid is not the workshop''s business, got ' || n;

  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-80';
  -- Making it costs this: 2 × 6 × 200.000 of boards, and it is never
  -- subtracted from what the job was sold for — boards are not the whole cost
  -- of a kitchen set, and the difference would read as profit (D151).
  assert c.cost_visible,             'the workshop may price its own bill of material';
  assert c.projected_cost = 2400000, 'the materials, got ' || coalesce(c.projected_cost::text,'(null)');
  assert c.contract_value = 500000000, 'and what the job was sold for, which is on the project list';
  assert not c.marketing_visible,  'and is told the rest is not its to see';
  -- Nought would say *nobody is owed anything on this job*, which is a
  -- different sentence (F104, F112, F113).
  assert c.commission_owed is null, 'so the commission is withheld, not zeroed';
  assert c.commission_paid is null, 'and so is what has been settled';
end $$;

rollback;
