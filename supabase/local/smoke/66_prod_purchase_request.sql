-- prod — *buat permintaan pembelian*: a work order's bill of material turned
-- into a draft purchase request, and the projection it makes answerable (D151).
--
--   REFUSALS     raising one without procurement access; an order pinned to no
--                bill of material; a cancelled order; **a looped BOM**, which
--                the walk survives and a purchase request must not be built
--                from
--   DERIVATIONS  the request is a **DRAFT** and never submitted; every line
--                carries `source_wo_no`; the quantities come from the revision
--                the order was **pinned** to, not from today's newest release;
--                a sub-assembly that could not be broken down is on the list
--                and says so; a code procurement has never heard of gets a line
--                with no `item_id`; the same key twice is one document;
--                `v_wo_materials` withholds what the reader may not see rather
--                than reporting nought
--
-- Worked out first, for SPK of 5 kabinet against rev 1:
--
--   kayu      5 × 4                =  20 lembar × 200.000 = 4.000.000
--   plywood   5 × 2 × 1,10 = 11 laci; 11 × 3 × 1,10 = 36,3 × 90.000 = 3.267.000
--   sekrup    11 × 8               =  88 pcs    ×     500 =    44.000
--   rangka    5 × 1, tak ada di katalog                   =         0
--   engsel    5 × 1, BOM belum dirilis                    =         0
--                                                  asked  = 7.311.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000006601','mandor@talaliving.com','{"full_name":"Mandor Bengkel"}'),
  ('ffffffff-0000-0000-0000-000000006602','ppic@talaliving.com','{"full_name":"Staf PPIC"}'),
  ('ffffffff-0000-0000-0000-000000006603','akun@talaliving.com','{"full_name":"Staf Akunting"}');
insert into ops_core.user_modules (user_id, module, level) values
  -- The workshop, and only the workshop.
  ('ffffffff-0000-0000-0000-000000006601','production','write'),
  -- The person who actually raises requests holds both.
  ('ffffffff-0000-0000-0000-000000006602','production','write'),
  ('ffffffff-0000-0000-0000-000000006602','procurement','write'),
  ('ffffffff-0000-0000-0000-000000006603','procurement','write'),
  ('ffffffff-0000-0000-0000-000000006603','accounting','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000006603','post_ledger');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('KAYU-66','Papan jati 2cm','raw-wood','lembar', 200000, 180000),
  ('PLY-66','Plywood 12mm','raw-wood','lembar',       null,  90000),
  ('SEKRUP-66','Sekrup 4x30','hardware','pcs',         500,    400);

insert into ops_procure.projects (code, name) values
  ('PRJ-66','Astoria lantai 2'),
  ('PRJ-67','Astoria lobby');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006602';

insert into ops_prod.products
  (id, product_code, name, category, uom, labour_cost, labour_note, created_by)
values
  ('bbbb6600-0000-0000-0000-0000000000a1','PRD-LAC-66','Laci besar','Lemari','unit',
    50000,'satu tukang × setengah hari','ffffffff-0000-0000-0000-000000006602'),
  ('bbbb6600-0000-0000-0000-0000000000a2','PRD-KAB-66','Kabinet dapur','Lemari','unit',
    400000,'dua tukang × 2 hari','ffffffff-0000-0000-0000-000000006602'),
  ('bbbb6600-0000-0000-0000-0000000000a3','PRD-ENG-66','Rakitan engsel','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006602'),
  ('bbbb6600-0000-0000-0000-0000000000a4','PRD-CYC-66A','Rakitan A','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006602'),
  ('bbbb6600-0000-0000-0000-0000000000a5','PRD-CYC-66B','Rakitan B','Lemari','unit',
    null, null,'ffffffff-0000-0000-0000-000000006602');

insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6600-0000-0000-0000-0000000000a1', 1,'ffffffff-0000-0000-0000-000000006602');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb6600-0000-0000-0000-0000000000a1', 1,'material','PLY-66',    3,'lembar', 10),
  ('bbbb6600-0000-0000-0000-0000000000a1', 1,'material','SEKRUP-66', 8,'pcs',     0);
update ops_prod.bom_revisions set released_at = now(),
       released_by = 'ffffffff-0000-0000-0000-000000006602', note = 'rev awal laci'
 where product_id = 'bbbb6600-0000-0000-0000-0000000000a1';

insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6600-0000-0000-0000-0000000000a2', 1,'ffffffff-0000-0000-0000-000000006602');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb6600-0000-0000-0000-0000000000a2', 1,'product', 'PRD-LAC-66', 2,'unit',   10),
  ('bbbb6600-0000-0000-0000-0000000000a2', 1,'material','KAYU-66',    4,'lembar',  0),
  -- A code procurement has never heard of. The workshop knows it needs a steel
  -- frame before anybody has catalogued one (A6).
  ('bbbb6600-0000-0000-0000-0000000000a2', 1,'material','RANGKA-66',  1,'unit',    0),
  -- A sub-assembly with a draft and no release.
  ('bbbb6600-0000-0000-0000-0000000000a2', 1,'product', 'PRD-ENG-66', 1,'unit',    0);
update ops_prod.bom_revisions set released_at = now(),
       released_by = 'ffffffff-0000-0000-0000-000000006602', note = 'rev awal kabinet'
 where product_id = 'bbbb6600-0000-0000-0000-0000000000a2' and rev = 1;

insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6600-0000-0000-0000-0000000000a3', 1,'ffffffff-0000-0000-0000-000000006602');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb6600-0000-0000-0000-0000000000a3', 1,'material','SEKRUP-66', 6,'pcs');

insert into ops_prod.bom_revisions (product_id, rev, created_by) values
  ('bbbb6600-0000-0000-0000-0000000000a4', 1,'ffffffff-0000-0000-0000-000000006602'),
  ('bbbb6600-0000-0000-0000-0000000000a5', 1,'ffffffff-0000-0000-0000-000000006602');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb6600-0000-0000-0000-0000000000a4', 1,'product','PRD-CYC-66B', 1,'unit'),
  ('bbbb6600-0000-0000-0000-0000000000a5', 1,'product','PRD-CYC-66A', 1,'unit');
update ops_prod.bom_revisions set released_at = now(),
       released_by = 'ffffffff-0000-0000-0000-000000006602', note = 'rev awal rakitan'
 where product_id in ('bbbb6600-0000-0000-0000-0000000000a4',
                      'bbbb6600-0000-0000-0000-0000000000a5');

-- ── the orders ────────────────────────────────────────────────────────────
insert into ops_prod.work_orders
  (wo_no, product_code, item_name, qty, uom, project_code, due_date, route, bom_rev, created_by)
values
  ('SPK-66-01','PRD-KAB-66','Kabinet dapur', 5,'unit','PRJ-66', current_date + 21,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000006602'),
  ('SPK-66-02','PRD-LAC-66','Laci besar',   10,'unit','PRJ-67', current_date + 14,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000006602'),
  -- Typed in by hand: a one-off with a name and no catalogue entry.
  ('SPK-66-03', null,       'Rak pesanan khusus', 1,'unit', null, current_date + 7,'IN_HOUSE', null,
   'ffffffff-0000-0000-0000-000000006602'),
  ('SPK-66-04','PRD-CYC-66A','Rakitan A',     2,'unit', null, current_date + 7,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000006602'),
  -- Cancelled, and on a project: the roll-up must leave it out.
  ('SPK-66-05','PRD-KAB-66','Kabinet batal',  3,'unit','PRJ-66', current_date + 7,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000006602'),
  -- A second, fully priced order on the same project, so that one unknown
  -- projection is visibly what makes the project's total unknown.
  ('SPK-66-06','PRD-LAC-66','Laci besar',     4,'unit','PRJ-66', current_date + 10,'IN_HOUSE', 1,
   'ffffffff-0000-0000-0000-000000006602');
update ops_prod.work_orders set status = 'CANCELLED', cancelled_reason = 'klien menunda'
 where wo_no = 'SPK-66-05';

-- **Rev 2, released after the order was raised.** Everything below must keep
-- reading rev 1, because that is what SPK-66-01 is pinned to (D256).
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb6600-0000-0000-0000-0000000000a2', 2,'ffffffff-0000-0000-0000-000000006602');
insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom) values
  ('bbbb6600-0000-0000-0000-0000000000a2', 2,'material','KAYU-66', 40,'lembar');
update ops_prod.bom_revisions set released_at = now(),
       released_by = 'ffffffff-0000-0000-0000-000000006602', note = 'desain diubah'
 where product_id = 'bbbb6600-0000-0000-0000-0000000000a2' and rev = 2;

/* ── REFUSAL: the workshop names what it needs; procurement asks for it ─── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006601';
do $$
declare a jsonb;
begin
  assert ops_core.has_permission('production.create'), 'the mandor runs the workshop';
  assert not ops_core.has_permission('procurement.create'), 'and holds nothing in procurement';

  -- There is one road to a purchase request and it is `create_pr`, so this
  -- seam borrows procurement's authority rather than minting a second one. A
  -- foreman who should raise his own is **granted** `procurement.create` —
  -- a grant somebody can audit, not a back door in another schema.
  a := ops_prod.request_materials('SPK-66-01');
  assert not ops_core.said_ok(a), 'raising a request without procurement access should be refused';
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'and refused for that reason, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- Refused **here**, by production, before a single price was read — not by
  -- `create_pr` after the list had already been assembled out of somebody
  -- else's catalogue. The two refusals say different things and this is the
  -- one that should arrive.
  assert a -> 'error' ->> 'message' like '%procurement asks for the money%',
    'the refusal is production''s own, got ' || coalesce(a -> 'error' ->> 'message','(null)');

  -- And nothing was created on the way to being refused.
  assert (select count(*) from ops_prod.v_wo_materials where wo_no = 'SPK-66-01') = 1,
    'the order is still there';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006602';

/* ── REFUSAL: no bill of material, a cancelled order, and a loop ───────── */
do $$
declare a jsonb;
begin
  a := ops_prod.request_materials('SPK-66-99');
  assert a -> 'error' ->> 'code' = 'not_found',
    'an order that does not exist, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_prod.request_materials('SPK-66-03');
  assert a -> 'error' ->> 'code' = 'no_bom',
    'a hand-typed order has no list to raise, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_prod.request_materials('SPK-66-05');
  assert a -> 'error' ->> 'code' = 'order_cancelled',
    'nothing needs buying for a cancelled order, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The walk survives A holds B holds A and reports it. A purchase request
  -- built from it would look exactly like a correct one, which is why this is
  -- the one warning that is a refusal (D257).
  a := ops_prod.request_materials('SPK-66-04');
  assert a -> 'error' ->> 'code' = 'bom_has_a_cycle',
    'a looped BOM is not something to buy from, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%PRD-CYC-66A%',
    'and the message names where the loop closes, got ' || coalesce(a -> 'error' ->> 'message','(null)');
end $$;

/* ── DERIVATION: the request itself ────────────────────────────────────── */
do $$
declare a jsonb; v_doc text; l record; n int;
begin
  a := ops_prod.request_materials('SPK-66-01');
  assert ops_core.said_ok(a), 'the request is raised, got ' || coalesce(a -> 'error' ->> 'code','(no error either)');
  v_doc := a -> 'data' ->> 'doc_no';

  assert (a -> 'data' ->> 'lines')::int = 5,
    'kayu, plywood, sekrup, rangka, engsel, got ' || coalesce(a -> 'data' ->> 'lines','(null)');
  assert (a -> 'data' ->> 'unexploded')::int = 1,
    'the engsel, and the caller is told, got ' || coalesce(a -> 'data' ->> 'unexploded','(null)');
  assert (a -> 'data' ->> 'prior_requests')::int = 0,
    'the first one, got ' || coalesce(a -> 'data' ->> 'prior_requests','(null)');

  -- A bill of material is a requirement, not a decision to spend money.
  assert (select status from ops_procure.pr_documents where doc_no = v_doc) = 'DRAFT',
    'the request is a draft and nothing submitted it';
  assert (select submitted_at from ops_procure.pr_documents where doc_no = v_doc) is null,
    'and carries no submission time';
  -- It lands on the project the order belongs to.
  assert (select p.code from ops_procure.pr_documents d
            join ops_procure.projects p on p.id = d.project_id where d.doc_no = v_doc) = 'PRJ-66',
    'filed against the order''s own project';

  -- **The one column the whole decision rests on** (D151).
  select count(*) into n from ops_procure.pr_lines
   where doc_no = v_doc and source_wo_no = 'SPK-66-01';
  assert n = 5, 'every line carries the SPK it came from, got ' || n;

  -- Pinned rev 1, not the rev 2 released a moment ago — which would say 200.
  select * into l from ops_procure.pr_lines where doc_no = v_doc and description like 'Papan jati%';
  assert l.qty = 20,         '5 × 4 at the pinned revision, got ' || coalesce(l.qty::text,'(null)');
  assert l.unit_price = 200000, 'the catalogue price travels with it, got ' || coalesce(l.unit_price::text,'(null)');
  assert l.item_total = 4000000, '20 × 200.000, got ' || coalesce(l.item_total::text,'(null)');
  assert l.item_id is not null,  'and it resolves to the catalogue item';
  assert l.purpose = 'SPK SPK-66-01 — Kabinet dapur' or l.purpose like '%SPK-66-01%',
    'the line says what it is for, got ' || coalesce(l.purpose,'(null)');
  -- The order's due date is when the piece is promised, not when its plywood
  -- has to be here, and nothing in this system knows the difference in days.
  assert l.need_by is null, 'an unasked-for date is not invented';

  -- Waste compounded through the laci, two levels down.
  select * into l from ops_procure.pr_lines where doc_no = v_doc and description like 'Plywood%';
  assert l.qty = 36.3,        '11 laci × 3 × 1,10, got ' || coalesce(l.qty::text,'(null)');
  assert l.item_total = 3267000, '36,3 × 90.000, got ' || coalesce(l.item_total::text,'(null)');

  -- A code nobody has catalogued: a line, by its code, with no item behind it.
  select * into l from ops_procure.pr_lines where doc_no = v_doc and description = 'RANGKA-66';
  assert l.item_id is null,  'unresolved at the seam, and reported rather than refused';
  assert l.qty = 5,          '5 × 1, got ' || coalesce(l.qty::text,'(null)');
  assert l.item_total = 0,   'no price yet, so nought until somebody prices it';

  -- A sub-assembly that could not be broken down says so on the document,
  -- because the person pricing it must not read it as an ordinary material.
  select * into l from ops_procure.pr_lines where doc_no = v_doc and description like 'Rakitan engsel%';
  assert l.description like '%no released BOM%',
    'the line is marked, got ' || coalesce(l.description,'(null)');

  -- Nothing from rev 2 got in.
  select count(*) into n from ops_procure.pr_lines where doc_no = v_doc and qty = 200;
  assert n = 0, 'a revision released after the pin cannot change what was ordered';
end $$;

/* ── DERIVATION: the same key twice is one document ────────────────────── */
do $$
declare a jsonb; b jsonb; n int;
begin
  a := ops_prod.request_materials('SPK-66-02', null, 'k-66-second');
  b := ops_prod.request_materials('SPK-66-02', null, 'k-66-second');
  assert ops_core.said_ok(a), 'the first is raised, got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- A replay is answered `duplicate`, not `ok` — the caller is told that this
  -- is the earlier answer coming back rather than a second thing happening.
  assert b ->> 'outcome' = 'duplicate',
    'the retry is reported as the replay it is, got ' || coalesce(b ->> 'outcome','(null)');
  assert a -> 'data' ->> 'doc_no' = b -> 'data' ->> 'doc_no',
    'and carries the same document, not a second one';
  -- Replayed at **this** layer, not procurement's: the remembered answer still
  -- carries the work order it was raised for, which `create_pr`'s own replay
  -- knows nothing about.
  assert b -> 'data' ->> 'wo_no' = 'SPK-66-02',
    'the production answer is what comes back, got ' || coalesce(b -> 'data' ->> 'wo_no','(null)');

  select count(distinct doc_no) into n from ops_procure.pr_lines where source_wo_no = 'SPK-66-02';
  assert n = 1, 'one document for that order, got ' || n;

  -- Asking again with a new key is allowed and **warned about**, not refused:
  -- a run that grew is ordinary, an accidental double is not, and the count is
  -- how somebody sees the difference (A6).
  a := ops_prod.request_materials('SPK-66-02', null, 'k-66-third');
  assert ops_core.said_ok(a), 'a second, deliberate request is allowed';
  assert (a -> 'data' ->> 'prior_requests')::int = 1,
    'and says one already existed, got ' || coalesce(a -> 'data' ->> 'prior_requests','(null)');
end $$;

/* ── DERIVATION: projection against actual ─────────────────────────────── */
do $$
declare m record;
begin
  select * into m from ops_prod.v_wo_materials where wo_no = 'SPK-66-01';
  assert m.projected_lines = 5,      'five things to obtain, got ' || coalesce(m.projected_lines::text,'(null)');
  assert m.projected_unexploded = 1, 'one of them a rakitan, got ' || coalesce(m.projected_unexploded::text,'(null)');
  assert m.projected_unpriced = 2,   'the rangka and the rakitan, got ' || coalesce(m.projected_unpriced::text,'(null)');
  assert m.projected_cost is null,   'a projection missing two lines is not a number to compare against';
  assert not m.projected_has_cycle,  'this tree is sound';

  assert m.procurement_visible,  'this reader holds procurement';
  assert m.requests = 1,         'one request raised from it, got ' || coalesce(m.requests::text,'(null)');
  assert m.request_lines = 5,    'five lines, got ' || coalesce(m.request_lines::text,'(null)');
  assert m.asked = 7311000,      '4.000.000 + 3.267.000 + 44.000, got ' || coalesce(m.asked::text,'(null)');
  -- `pr_lines.item_total` is `not null`, so an unpriced component lands as
  -- nought and `asked` under-reports until somebody prices it. The count is by
  -- how much.
  assert m.asked_unpriced = 2,   'two lines still at nought, got ' || coalesce(m.asked_unpriced::text,'(null)');
  assert m.approved = 0,         'a draft has been approved by nobody, got ' || coalesce(m.approved::text,'(null)');
  assert m.paid = 0,             'and paid by nobody, got ' || coalesce(m.paid::text,'(null)');

  -- The order with everything priced: a projection there IS a number.
  select * into m from ops_prod.v_wo_materials where wo_no = 'SPK-66-02';
  assert m.projected_cost = 3010000, '2.970.000 + 40.000, got ' || coalesce(m.projected_cost::text,'(null)');
  assert m.requests = 2,             'the retry and the deliberate second, got ' || coalesce(m.requests::text,'(null)');
end $$;

/* ── DERIVATION: the project roll-up, and the ledger kept beside it ────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006603';
insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code, project_id,
   description, source_ref, posted_by)
select 'TRX-66-01', current_date, a.id, 'OUT', 1500000, 'PRODUCTION', p.id,
       'Ongkos pasang lobby','smoke-66', 'ffffffff-0000-0000-0000-000000006603'
  from ops_acct.accounts a, ops_procure.projects p
 where a.code = 'PETTY CASH' and p.code = 'PRJ-67';

do $$
declare c record;
begin
  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-67';
  assert c.work_orders = 1,          'one order on the lobby, got ' || coalesce(c.work_orders::text,'(null)');
  assert c.projected_cost = 3010000, 'the order''s own projection, got ' || coalesce(c.projected_cost::text,'(null)');
  assert c.ledger_visible,           'this reader holds accounting';
  -- Shown, and **never subtracted from the projection**: the ledger figure
  -- contains installation, delivery and subcontract and the projection contains
  -- none of them, so the difference is not an overrun (D151).
  assert c.ledger_spend = 1500000,   'everything paid out on that job, got ' || coalesce(c.ledger_spend::text,'(null)');

  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-66';
  -- Two live orders and a cancelled one. A cancelled order is not work the
  -- project still has to pay for.
  assert c.work_orders = 2,          'the cancelled one is out, got ' || coalesce(c.work_orders::text,'(null)');
  assert c.orders_without_a_projection = 1, 'one of the two, got ' || coalesce(c.orders_without_a_projection::text,'(null)');
  -- The other order projects at 1.204.000 and is not the answer: a project
  -- total that silently omits an order is the number somebody quotes from.
  assert c.projected_cost is null,   'one unknown order makes the project total unknown, got '
                                     || coalesce(c.projected_cost::text,'(null)');
end $$;

/* ── REFUSAL: withheld, never reported as nought ───────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006601';
do $$
declare m record; c record;
begin
  -- The workshop may read its own orders and the walk, because the catalogue is
  -- not the secret (F112). What it may not read is procurement's document.
  select * into m from ops_prod.v_wo_materials where wo_no = 'SPK-66-01';
  assert m.projected_lines = 5, 'the workshop still sees what its order needs';
  assert not m.procurement_visible, 'and is told it cannot see the request side';
  -- `requests = 0` would read as *nobody has asked yet*, which is false and is
  -- exactly the plausible null this project keeps finding (F104, F112).
  assert m.requests is null, 'so the figure is withheld, not zeroed';
  assert m.asked    is null, 'and so is the money';

  select * into c from ops_prod.v_project_cost where project_code = 'PRJ-67';
  assert not c.ledger_visible, 'nor may the workshop read the ledger';
  assert c.ledger_spend is null, 'withheld rather than reported as nothing spent';
  assert c.projected_cost = 3010000, 'the projection is the workshop''s own and stays visible';
end $$;

rollback;
