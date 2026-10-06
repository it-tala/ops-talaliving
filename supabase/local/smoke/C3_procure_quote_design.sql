-- procure — a quotation line offers a design item, priced on a drawing that
-- is frozen when it goes out (0225, P5, kajian F224 G9, G14).
--
-- DERIVATIONS  design items become lines named and sized from the item, once
--              each; a draft line prices the item's latest drawing unless one
--              is pinned; sending freezes that drawing with the cost; a new
--              drawing afterwards leaves the offer naming the old one and says
--              it changed; a revision prices the latest again; accepting
--              carries the item and the drawing to the order line; the item
--              reads QUOTED once sent and ORDERED once on an order line, and
--              an approval stays counted after it is quoted
-- REFUSALS     an item of another project; a dropped item; a drawing that is
--              not the item's; a drawing with no item; changing a sent
--              quotation's design

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c3001','mkt-quote@talaliving.com','{"full_name":"Rina Quote"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c3001','marketing','write');

insert into ops_procure.clients (id, code, name) values
  ('c3000000-0000-0000-0000-0000000000c1','CL-0954','PT Contoh Quote');
insert into ops_procure.projects (id, code, name, client_id) values
  ('c3000000-0000-0000-0000-0000000000d1','26954','Villa Quote','c3000000-0000-0000-0000-0000000000c1'),
  ('c3000000-0000-0000-0000-0000000000d2','26955','Villa Lain','c3000000-0000-0000-0000-0000000000c1');

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug) where slug = 'drafting';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c3001';

do $$
declare r jsonb; v jsonb; qt text; qt2 text; l1 uuid; l2 uuid; f1 uuid; f2 uuid; f_other uuid;
begin
  perform ops_procure.save_design_collection('26954', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26954', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26954', 'A', 'LR', 'Sofa 3 seater', 24, 'tala', 2100, 900, 780);
  perform ops_procure.save_design_item('26954', 'A', 'LR', 'Coffee table', 24, 'tala');
  perform ops_procure.save_design_item('26954', 'A', 'LR', 'Rak buku', 24, 'tala');
  perform ops_procure.set_design_item_dropped('26954-A-LR-03', true, 'Tidak jadi');
  perform ops_procure.save_design_collection('26955', 'A', 'Lain');
  perform ops_procure.save_design_room('26955', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26955', 'A', 'LR', 'Meja lain', 1, 'tala');

  r := ops_core.attach_file('DRV_Q1', 'sofa-rev-a.jpg', 'image/jpeg', 100, null, 'web', null, 'render', 'design_item',
                            null, null, '26954-A-LR-01', 'tala');
  f1 := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f1, 'design_item', '26954-A-LR-01', 'Render');
  r := ops_core.attach_file('DRV_QX', 'meja.jpg', 'image/jpeg', 100, null, 'web', null, 'render', 'design_item',
                            null, null, '26954-A-LR-02', 'tala');
  f_other := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f_other, 'design_item', '26954-A-LR-02', 'Render');
  perform ops_procure.record_design_approval('26954-A-LR-01', 'approved', ops_core.office_day(), 'meeting', 'Ibu Sari');

  r := ops_procure.save_quotation(null, '26954', ops_core.office_day() + 14, 0, 0, 20);
  qt := r->'data'->>'quote_no';

  -- offered from the design
  r := ops_procure.add_quotation_lines_from_design(qt, array['26955-A-LR-01']);
  assert r->'error'->>'code' = 'item_other_project', 'an item of this project: ' || r::text;
  r := ops_procure.add_quotation_lines_from_design(qt, array['26954-A-LR-01', '26954-A-LR-03']);
  assert r->'error'->>'code' = 'item_dropped', 'not a dropped item: ' || r::text;
  assert (select count(*) from ops_procure.quotation_lines l join ops_procure.quotations q on q.id = l.quotation_id
           where q.quote_no = qt) = 0, 'a refused batch adds nothing';
  r := ops_procure.add_quotation_lines_from_design(qt, array['26954-A-LR-01', '26954-A-LR-02']);
  assert ops_core.said_ok(r) and (r->'data'->>'added')::int = 2, 'two lines: ' || r::text;
  r := ops_procure.add_quotation_lines_from_design(qt, array['26954-A-LR-01']);
  assert (r->'data'->>'added')::int = 0, 'once each: ' || r::text;

  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt and line_no = 1;
  assert v->>'description' = 'Sofa 3 seater — 2100 × 900 × 780 mm' and (v->>'qty')::numeric = 24
     and v->>'design_item_no' = '26954-A-LR-01' and v->>'room_code' = 'LR' and v->>'collection_name' = 'Type 2BR'
     and v->>'design_file_name' = 'sofa-rev-a.jpg' and not (v->>'design_changed')::boolean,
    'named, sized and priced on the latest drawing: ' || v::text;
  l1 := (v->>'id')::uuid;
  select id into l2 from ops_procure.quotation_lines where design_item_id =
    (select id from ops_procure.design_items where item_no = '26954-A-LR-02');

  -- the line's own fields are edited as before; the design stays
  r := ops_procure.save_quotation_line(qt, l1, null, 'Sofa 3 seater — 2100 × 900 × 780 mm', 24, 'unit', null, 4000000);
  assert ops_core.said_ok(r), 'cost: ' || r::text;
  perform ops_procure.save_quotation_line(qt, l2, null, 'Coffee table', 24, 'unit', null, 1500000);
  assert (select design_item_no from ops_procure.v_quotation_line where id = l1) = '26954-A-LR-01', 'saving keeps the item';

  -- which drawing
  r := ops_procure.set_quotation_line_design(qt, l1, '26954-A-LR-01', f_other);
  assert r->'error'->>'code' = 'file_not_on_item', 'the item''s own drawing: ' || r::text;
  r := ops_procure.set_quotation_line_design(qt, l1, null, f1);
  assert r->'error'->>'code' = 'file_without_item', 'a drawing needs its item: ' || r::text;
  r := ops_procure.set_quotation_line_design(qt, l1, '26954-A-LR-01', f1);
  assert ops_core.said_ok(r), 'pinned: ' || r::text;

  -- sent: the drawing is frozen with the price
  r := ops_procure.send_quotation(qt);
  assert ops_core.said_ok(r), 'send: ' || r::text;
  r := ops_procure.set_quotation_line_design(qt, l1, null);
  assert r->'error'->>'code' = 'not_draft', 'a sent offer keeps its design: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26954-A-LR-01';
  assert v->>'status' = 'QUOTED' and v->>'quote_no' = qt and (v->>'quoted_unit_price')::numeric > 0,
    'quoted: ' || v::text;
  assert (select approved_count from ops_procure.v_design_collection where project_code = '26954') = 1,
    'an approved item quoted is still approved';

end $$;

-- The first drawing was filed days before the second: one transaction would
-- give both the same `linked_at`, which a real upload never does.
reset role;
update ops_core.attachment_links set linked_at = linked_at - interval '3 days'
 where attachment_id = (select id from ops_core.attachments where filename = 'sofa-rev-a.jpg');
set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c3001';

do $$
declare r jsonb; v jsonb; qt text; qt2 text; l1 uuid; f2 uuid;
begin
  select quote_no into qt from ops_procure.v_quotation where project_code = '26954' and rev = 1;
  select id into l1 from ops_procure.v_quotation_line where quote_no = qt and line_no = 1;

  -- drawn again after the offer
  r := ops_core.attach_file('DRV_Q2', 'sofa-rev-b.jpg', 'image/jpeg', 100, null, 'web', null, 'render', 'design_item',
                            null, null, '26954-A-LR-01', 'tala');
  f2 := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f2, 'design_item', '26954-A-LR-01', 'Render');
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where id = l1;
  assert v->>'design_file_name' = 'sofa-rev-a.jpg' and (v->>'design_changed')::boolean,
    'the offer still names its drawing, and says it changed: ' || v::text;

  -- a revision prices the latest; accepting carries it to the order
  r := ops_procure.revise_quotation(qt);
  qt2 := r->'data'->>'quote_no';
  perform ops_procure.set_quotation_line_design(qt2,
    (select id from ops_procure.quotation_lines where quotation_id = (select id from ops_procure.quotations where quote_no = qt2) and line_no = 1),
    '26954-A-LR-01', null);
  select to_jsonb(x) into v from ops_procure.v_quotation_line x where quote_no = qt2 and line_no = 1;
  assert v->>'design_item_no' = '26954-A-LR-01' and v->>'design_file_name' = 'sofa-rev-b.jpg'
     and not (v->>'design_changed')::boolean, 'the revision prices the new drawing: ' || v::text;
  perform ops_procure.send_quotation(qt2);
  r := ops_procure.decide_quotation(qt2, true);
  assert ops_core.said_ok(r), 'accepted: ' || r::text;
  assert (select count(*) from ops_procure.project_lines pl
           join ops_procure.design_items i on i.id = pl.design_item_id
          where i.item_no = '26954-A-LR-01' and pl.design_file_id = f2) = 1, 'the order line carries item and drawing';
  assert (select status from ops_procure.v_design_item where item_no = '26954-A-LR-01') = 'ORDERED', 'ordered';
  assert (select status from ops_procure.v_design_item where item_no = '26954-A-LR-03') = 'DROPPED', 'dropped stays dropped';
end $$;

rollback;
