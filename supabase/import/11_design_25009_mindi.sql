-- 11_design_25009_mindi.sql — project 25009 (MINDI GROUP, Living Ikon): its
-- three catalogue collections and their items, with the client's own codes
-- (D419, after 0262).
--
-- Source: *LIVINGIKON TRACKER – LEXI_HOIAN_SIENNA_TRACKER* (Google Sheets,
-- sheets LEXI · NEW HOI AN · SIENNA), itself read from the catalogues Living
-- Ikon sent (LEXI COLLECTION 2026, NEW HOI AN CATALOGUE 2026, SIENNA
-- CATALOGUE 2026). Sizes are the catalogue's nominal size in mm, length =
-- the longest of L/W. The tracker has no quantity column, so every item is
-- written as 1 — the order's quantities belong on the quotation and order.
-- The catalogues themselves (the client's PDFs in the shared folder) are
-- filed on each collection as a link (`attach_url`), kind *Client Drawing*.
--
-- Runs through the seams, as superadmin@talaliving.com (who typed the first
-- three items; it@ holds no design access), so every rule and audit row
-- is the screen's. Idempotent: an item whose client code is already in the
-- project is corrected, not added; a catalogue already on its collection is
-- not filed twice. The three items typed before (Queen and King in LV232,
-- Queen in LV453) get their client codes and keep their numbers. Removes
-- nothing.

begin;

select set_config('request.jwt.claim.sub', '4d3f1da1-963a-4bc0-9f62-3d7b6f5ac5c8', true),
       set_config('request.jwt.claims', '{"sub":"4d3f1da1-963a-4bc0-9f62-3d7b6f5ac5c8","role":"authenticated"}', true);

create temp table mindi_items (coll text, ord int, code text, name text, l numeric, w numeric, h numeric, note text) on commit drop;
insert into mindi_items values
  -- LEXI — oak timber, finish LCO046 Burnt Amber
  ('LV232', 1,'LV232-B01','Queen Bed',2130,1600,1170,'Queen bed, slatted open-frame headboard and footboard, sled-style base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 2,'LV232-B02','King Bed',2130,1900,1170,'King bed, same design as Queen (LV232-B01). Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 3,'LV232-B41','1 Drawer Bedside',500,420,600,'Bedside with 1 drawer and open niche above, sled-frame legs. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 4,'LV232-B51','4 Drawers Tallboy',950,450,1100,'Tallboy, 4 drawers with metal bar pulls, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 5,'LV232-B61','6 Drawers Dresser',1300,450,900,'Dresser, 6 drawers (2 x 3) with metal bar pulls, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 6,'LV232-B71','Mirror',1000,20,1000,'Wall/dresser mirror, timber frame. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 7,'LV232-D02','Extended Dining Table (6-8 seater)',1400,900,750,'Extension dining table, 6-8 seats. Length 1400 closed / 1800 extended. Oak timber, LCO046 Burnt Amber.'),
  ('LV232', 8,'LV232-D03','Extended Dining Table (8-10 seater)',1800,1050,750,'Extension dining table, 8-10 seats. Length 1800 closed / 2300 extended. Oak timber, LCO046 Burnt Amber. Image shared with D02.'),
  ('LV232', 9,'LV232-D21','3 Drawers 2 Doors Buffet',1650,450,820,'Buffet, 2 doors + 3 drawers, metal bar pulls, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',10,'LV232-D11','Fabric Seat Dining Chair',630,460,960,'Dining chair, upholstered seat and back in grey fabric, timber frame. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',11,'LV232-L01','2 Drawers Coffee Table',1200,600,400,'Coffee table, 2 drawers, sled-frame base with stretcher. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',12,'LV232-L11','Lamp Table with Shelf',550,550,550,'Lamp/side table with 1 drawer, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',13,'LV232-L21','2 Drawers Console Table',1300,400,800,'Console table, 2 drawers, sled-frame legs. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',14,'LV232-L33','3 Doors TV Unit',1600,430,600,'TV unit, 3 doors, metal bar pulls, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',15,'LV232-L51','3 Drawers Desk',1300,600,800,'Writing desk, 3 drawers, sled-frame legs. Oak timber, LCO046 Burnt Amber.'),
  ('LV232',16,'LV232-L41','2 Doors & 3 Shelfs Bookcase',900,450,1900,'Bookcase, 3 open shelves over 2-door base, sled-frame base. Oak timber, LCO046 Burnt Amber.'),
  -- NEW HOI AN — wood + rattan, finish LCM127 Golden Syrup
  ('LV453', 1,'LV453.B01','5'' Queen Bed',2140,1600,1300,'Queen bed, framed rattan-panel headboard and footboard, square legs. Wood + rattan, LCM127 Golden Syrup.'),
  ('LV453', 2,'LV453.B02','6'' King Bed',2140,1900,1300,'King bed, same design as Queen (LV453.B01). Wood + rattan, LCM127 Golden Syrup.'),
  ('LV453', 3,'LV453.B41','Bedside 2 Drawers',550,420,580,'Bedside, 2 drawers with rattan fronts and timber pulls. Wood + rattan, LCM127 Golden Syrup.'),
  ('LV453', 4,'LV453.B51','Tallboy 4 Drawers',950,450,1200,'Tallboy, 4 drawers with rattan fronts and timber pulls. Wood + rattan, LCM127 Golden Syrup.'),
  ('LV453', 5,'LV453.B61','Dresser 6 Drawers',1500,450,820,'Dresser, 6 drawers (2 x 3) with rattan fronts and timber pulls. Wood + rattan, LCM127 Golden Syrup.'),
  ('LV453', 6,'LV453.B71','Mirror',1000,25,1000,'Mirror, timber frame. Wood, LCM127 Golden Syrup.'),
  -- SIENNA — chevron veneer, brass-tone metal, finish LCV09 Warm Brown
  ('LV463', 1,'LV463-B01','5'' Queen Bed',2125,1630,1200,'Queen bed, chevron veneer headboard and footboard panel, brass-tone metal frame base. LCV09 Warm Brown.'),
  ('LV463', 2,'LV463-B02','6'' King Bed',2125,1930,1200,'King bed, same design as Queen (LV463-B01). LCV09 Warm Brown.'),
  ('LV463', 3,'LV463-B42','2 Drawer & Shelf Bedside',550,400,550,'Bedside, 2 chevron-veneer drawers in metal frame, sled base. LCV09 Warm Brown.'),
  ('LV463', 4,'LV463-B51','2 Over 4 Drawers Tallboy',900,450,1200,'Tallboy, 4 chevron-veneer drawers, metal edge trim and sled base. LCV09 Warm Brown.'),
  ('LV463', 5,'LV463-B61','3 Over 4 Drawers Dresser',1500,450,800,'Dresser, 3 small drawers over 4 large drawers, chevron veneer, metal frame. LCV09 Warm Brown.'),
  ('LV463', 6,'LV463-B71','Mirror',1000,26,1000,'Mirror, chevron-veneer frame with metal trim. LCV09 Warm Brown.'),
  ('LV463', 7,'LV463-D01','Rectangle Dining Table (8 seater)',2200,1000,760,'Rectangular dining table, 8 seats, veneer top on brass-tone metal U-legs. LCV09 Warm Brown.'),
  ('LV463', 8,'LV463-D21','3 Drawers 4 Doors Buffet',1800,450,820,'Buffet, 3 drawers over 4 doors, chevron veneer, brass-tone metal frame and pulls. LCV09 Warm Brown.'),
  ('LV463', 9,'LV463-L21','1 Drawer & Shelf Console Table',1400,400,760,'Console table, 1 drawer + open shelves, brass-tone metal frame. LCV09 Warm Brown.'),
  ('LV463',10,'LV446-L01','Rectangle Coffee Table with Shelf',1200,700,440,'Rectangular coffee table with split lower shelves, brass-tone metal frame. LCV09 Warm Brown.'),
  ('LV463',11,'LV446-L02','Square Coffee Table with Shelf',900,900,440,'Square coffee table with split lower shelves, brass-tone metal frame. LCV09 Warm Brown.'),
  ('LV463',12,'LV446-L11','1 Drawer & Shelf Lamp Table',550,550,550,'Lamp table, 1 drawer + top shelf, brass-tone metal frame. LCV09 Warm Brown.'),
  ('LV463',13,'LV446-L12','Sofa Table',460,250,500,'C-shape sofa side table, veneer top on brass-tone metal frame. LCV09 Warm Brown.'),
  ('LV463',14,'LV446-L31','4 Doors & Shelf TV Unit',1800,440,550,'TV unit, 4 chevron doors with open shelf above, brass-tone metal frame. LCV09 Warm Brown.');

do $$
declare r jsonb; x record; v_no text; v_att uuid; n_new int := 0; n_fix int := 0;
begin
  -- the collections, named as the catalogues name them
  for x in select * from (values
      ('LV232','LEXI COLLECTION','Oak timber · finish LCO046 Burnt Amber'),
      ('LV453','NEW HOI AN COLLECTION','Wood + rattan · finish LCM127 Golden Syrup'),
      ('LV463','SIENNA COLLECTION','Chevron veneer + brass-tone metal · finish LCV09 Warm Brown')) c(code, name, note) loop
    r := ops_procure.save_design_collection('25009', x.code, x.name, x.note);
    if not ops_core.said_ok(r) then raise exception 'collection %: %', x.code, r; end if;
  end loop;

  -- the three typed before: their client codes
  for x in select * from (values ('25009-LV232-B-01','LV232-B01'), ('25009-LV232-B-02','LV232-B02'),
                                 ('25009-LV453-B-01','LV453.B01')) t(item_no, code) loop
    update ops_procure.design_items set client_item_code = x.code, updated_at = now()
     where item_no = x.item_no and client_item_code is distinct from x.code;
  end loop;

  -- every item: corrected where the code is there, added where it is not
  for x in select * from mindi_items order by coll, ord loop
    select di.item_no into v_no from ops_procure.design_items di
      join ops_procure.design_rooms dr on dr.id = di.room_id
      join ops_procure.design_collections dc on dc.id = dr.collection_id
      join ops_procure.projects p on p.id = dc.project_id
     where p.code = '25009' and upper(di.client_item_code) = upper(x.code);
    r := ops_procure.save_design_item('25009', x.coll, null, x.name, 1, 'client', x.l, x.w, x.h, x.note,
                                      v_no, x.code);
    if not ops_core.said_ok(r) then raise exception 'item %: %', x.code, r; end if;
    if v_no is null then n_new := n_new + 1; else n_fix := n_fix + 1; end if;
  end loop;

  -- the catalogues, on their collections
  for x in select * from (values
      ('LV232','https://drive.google.com/file/d/1LetavRqM9_-dspnzoiqcSOgGd7dM80-2/view','LEXI COLLECTION 2026.pdf'),
      ('LV453','https://drive.google.com/file/d/13HY903uit5Z4xe2aMl_xAMs7_YfiX0E0/view','NEW HOI AN CATALOGUE 2026.pdf'),
      ('LV463','https://drive.google.com/file/d/1wSBIg8ICP5Q-8Qv5X_jFUX4q015Wmjvj/view','SIENNA CATALOGUE 2026.pdf')) c(coll, url, title) loop
    continue when exists (select 1 from ops_core.attachment_links l join ops_core.attachments a on a.id = l.attachment_id
                           where l.entity = 'design_collection' and l.entity_no = '25009-' || x.coll
                             and l.unlinked_at is null and a.url = x.url);
    r := ops_core.attach_url(x.url, x.title);
    if not ops_core.said_ok(r) then raise exception 'catalogue %: %', x.coll, r; end if;
    v_att := (r->'data'->>'attachment_id')::uuid;
    update ops_core.attachments set origin = 'client' where id = v_att;
    r := ops_core.attach_link(v_att, 'design_collection', '25009-' || x.coll, 'Client Drawing',
                              'Katalog dari Living Ikon (David Wormald)');
    if not ops_core.said_ok(r) then raise exception 'catalogue link %: %', x.coll, r; end if;
  end loop;

  raise notice '25009: % items added, % corrected', n_new, n_fix;
end $$;

select collection_code, count(*) as items, string_agg(coalesce(client_item_code, item_no), ' ' order by room_sort, seq) as codes
  from ops_procure.v_design_item where project_code = '25009' group by 1 order by 1;

commit;
