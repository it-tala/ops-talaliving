-- procure — a meeting recorded in full: attendees, minutes as lines, and its
-- files (0222, 0223, P3, kajian F224 §4.2).
--
-- DERIVATIONS  a meeting carries TALA's people as accounts and the client's
--              as names; its minutes are numbered lines, a revision request
--              pointing at the design item it is about; lines added the next
--              day follow on; a point is open, overdue, done or only noted;
--              the log counts attendees, points and open ones; a meeting's
--              files go to <client>/<project>/04 MEETING/<date> <kind> (and
--              the client's drawings to 00 DARI KLIEN/<date> <kind>); a
--              contact with no project to the client's 00 UMUM
-- REFUSALS     attendees on a phone call; an attendee with no account or no
--              name; a point of no known kind, empty, about an item of another
--              project, or due before the meeting — and the entry is not
--              written either; closing a decision; closing twice (noop); a
--              drafter logging a meeting (they read and close its points, not
--              the sales log); somebody with neither reading anything

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c2001','mkt-meeting@talaliving.com','{"full_name":"Rina Meeting"}'),
  ('aaaa0000-0000-0000-0000-0000000c2002','drafter-meeting@talaliving.com','{"full_name":"Ayu Drafter"}'),
  ('aaaa0000-0000-0000-0000-0000000c2003','gudang-meeting@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c2001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c2002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c2003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('c2000000-0000-0000-0000-0000000000c1','CL-0952','PT Contoh Meeting');
insert into ops_procure.projects (id, code, name, client_id) values
  ('c2000000-0000-0000-0000-0000000000d1','26952','Villa Meeting','c2000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-0000000000d2','26953','Villa Lain','c2000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c2001';

do $$
declare r jsonb; v jsonb; v_id uuid; v_general uuid; n int; d date := ops_core.office_day() - 1;
        me text := 'aaaa0000-0000-0000-0000-0000000c2001';
        drafter text := 'aaaa0000-0000-0000-0000-0000000c2002';
begin
  perform ops_procure.save_design_collection('26952', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26952', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26952', 'A', 'LR', 'Coffee table', 2, 'tala');
  perform ops_procure.save_design_collection('26953', 'A', 'Lain');
  perform ops_procure.save_design_room('26953', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26953', 'A', 'LR', 'Meja lain', 1, 'tala');

  assert (select count(*) from ops_procure.meeting_people() where email = 'drafter-meeting@talaliving.com') = 1,
    'a drafter can be named as attending';

  -- refused, and nothing written
  r := ops_procure.log_meeting(null, 'call', 'Telepon singkat', '26952', null, d, null, null,
         jsonb_build_array(jsonb_build_object('side','client','name','Ibu Sari')));
  assert r->'error'->>'code' = 'attendees_meeting_only', 'a call has no attendees: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', 'Meeting desain', '26952', null, d, null, null,
         jsonb_build_array(jsonb_build_object('side','tala')));
  assert r->'error'->>'code' = 'attendee_unknown', 'TALA''s attendee is an account: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', 'Meeting desain', '26952', null, d, null, null,
         jsonb_build_array(jsonb_build_object('side','client','name',' ')));
  assert r->'error'->>'code' = 'attendee_name_required', 'the client''s attendee has a name: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', 'Meeting desain', '26952', null, d, null, null, null,
         jsonb_build_array(jsonb_build_object('kind','gossip','body','x')));
  assert r->'error'->>'code' = 'unknown_point_kind', 'a known kind: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', 'Meeting desain', '26952', null, d, null, null, null,
         jsonb_build_array(jsonb_build_object('kind','revision','body','Lebih rendah','item_no','26953-A-LR-01')));
  assert r->'error'->>'code' = 'item_other_project', 'an item of this project: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', 'Meeting desain', '26952', null, d, null, null, null,
         jsonb_build_array(jsonb_build_object('kind','action','body','Kirim render','due_on', (d - 1)::text)));
  assert r->'error'->>'code' = 'due_before_meeting', 'due after the meeting: ' || r::text;
  r := ops_procure.log_meeting(null, 'meeting', '', '26952', null, d);
  assert r->'error'->>'code' = 'summary_required', 'the log''s own rules still hold: ' || r::text;
  assert (select count(*) from ops_procure.client_activities) = 0, 'a refused meeting leaves no entry';

  -- the meeting
  r := ops_procure.log_meeting(null, 'meeting', 'Review render tipe 2BR di lokasi', '26952', null, d, d + 7, 'Kirim render revisi',
         jsonb_build_array(
           jsonb_build_object('side','tala','user_id', me),
           jsonb_build_object('side','tala','user_id', drafter, 'role','Drafter'),
           jsonb_build_object('side','tala','user_id', me),
           jsonb_build_object('side','client','name','Ibu Sari','role','GM')),
         jsonb_build_array(
           jsonb_build_object('kind','decision','body','Warna kayu walnut untuk semua unit'),
           jsonb_build_object('kind','revision','body','Coffee table lebih rendah, 380 mm','item_no','26952-A-LR-01',
                              'owner_id', drafter, 'due_on', (d + 3)::text),
           jsonb_build_object('kind','action','body','Kirim sampel finishing','owner_id', me)),
         'meet-1');
  assert ops_core.said_ok(r) and (r->'data'->>'points')::int = 3, 'meeting: ' || r::text;
  v_id := (r->'data'->>'id')::uuid;
  r := ops_procure.log_meeting(null, 'meeting', 'Review render tipe 2BR di lokasi', '26952', null, d, null, null,
         null, null, 'meet-1');
  assert (r->'data'->>'id')::uuid = v_id and (select count(*) from ops_procure.client_activities) = 1,
    'the same key is the same meeting';

  select to_jsonb(x) into v from ops_procure.v_client_activity x where id = v_id;
  assert (v->>'attendee_count')::int = 3 and (v->>'point_count')::int = 3 and (v->>'open_points')::int = 2,
    'the log counts what the meeting carries (one account once): ' || v::text;
  assert (select string_agg(name || ':' || side, ',' order by seq) from ops_procure.v_meeting_attendee where activity_id = v_id)
       = 'Rina Meeting:tala,Ayu Drafter:tala,Ibu Sari:client', 'attendees read by name';
  select to_jsonb(x) into v from ops_procure.v_meeting_point x where activity_id = v_id and seq = 2;
  assert v->>'kind' = 'revision' and v->>'item_no' = '26952-A-LR-01' and v->>'owner_name' = 'Ayu Drafter'
     and v->>'state' = 'open' and v->>'project_code' = '26952', 'the revision request points at its item: ' || v::text;
  assert (select state from ops_procure.v_meeting_point where activity_id = v_id and seq = 1) = 'noted', 'a decision is noted';

  -- the next day's minutes follow on
  r := ops_procure.add_meeting_lines(v_id, null,
         jsonb_build_array(jsonb_build_object('kind','note','body','Klien minta jadwal pasang Desember')));
  assert ops_core.said_ok(r), 'more minutes: ' || r::text;
  assert (select max(seq) from ops_procure.meeting_points where activity_id = v_id) = 4, 'numbered after the last';
  r := ops_procure.add_meeting_lines(v_id, null, '[]'::jsonb);
  assert r->>'outcome' = 'noop', 'nothing to add: ' || r::text;

  -- its files, in a folder of the meeting
  assert ops_core.drive_path_for_record('notulen', 'client_activity', v_id::text)
       = 'CL-0952 PT CONTOH MEETING/26952 VILLA MEETING/04 MEETING/' || to_char(d, 'YYYY-MM-DD') || ' MEETING',
    'the meeting''s folder, got ' || ops_core.drive_path_for_record('notulen', 'client_activity', v_id::text);
  assert ops_core.drive_path_for_record('gambar_klien', 'client_activity', v_id::text)
       = 'CL-0952 PT CONTOH MEETING/26952 VILLA MEETING/00 DARI KLIEN/' || to_char(d, 'YYYY-MM-DD') || ' MEETING',
    'the client''s drawings from it, got ' || ops_core.drive_path_for_record('gambar_klien', 'client_activity', v_id::text);
  r := ops_core.attach_file('DRV_MINUTES', 'notulen.pdf', 'application/pdf', 100, null, 'web', null, 'notulen',
                            'client_activity', null, null, v_id::text, 'tala');
  perform ops_core.attach_link((r->'data'->>'attachment_id')::uuid, 'client_activity', v_id::text, 'Meeting Notes');
  assert (select file_count from ops_procure.v_client_activity where id = v_id) = 1, 'the log counts its files';

  -- a visit about the client in general
  r := ops_procure.log_meeting('CL-0952', 'visit', 'Kunjungan kantor klien', null, null, d, null, null,
         jsonb_build_array(jsonb_build_object('side','third_party','name','Arsitek Budi')));
  assert ops_core.said_ok(r), 'a general visit: ' || r::text;
  v_general := (r->'data'->>'id')::uuid;
  assert ops_core.drive_path_for_record('foto_survei', 'client_activity', v_general::text)
       = 'CL-0952 PT CONTOH MEETING/00 UMUM/04 MEETING/' || to_char(d, 'YYYY-MM-DD') || ' VISIT',
    'no project, the client''s general folder, got ' || ops_core.drive_path_for_record('foto_survei', 'client_activity', v_general::text);
  r := ops_procure.add_meeting_lines(v_general, null,
         jsonb_build_array(jsonb_build_object('kind','revision','body','x','item_no','26952-A-LR-01')));
  assert r->'error'->>'code' = 'item_other_project', 'no project, no item: ' || r::text;
end $$;

-- the drafter: reads and closes the points, not the sales log
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c2002';
do $$
declare r jsonb; v_rev uuid; v_dec uuid;
begin
  r := ops_procure.log_meeting('CL-0952', 'meeting', 'Diam-diam', '26952', null, ops_core.office_day());
  assert r->'error'->>'code' = 'not_permitted', 'a drafter does not log meetings: ' || r::text;
  assert (select count(*) from ops_procure.v_client_activity) = 0, 'nor reads the sales log';
  assert (select count(*) from ops_procure.v_meeting_point where item_no = '26952-A-LR-01') = 1, 'but reads what is asked of the item';
  select id into v_rev from ops_procure.v_meeting_point where kind = 'revision' and item_no = '26952-A-LR-01';
  select id into v_dec from ops_procure.v_meeting_point where kind = 'decision';
  r := ops_procure.close_meeting_point(v_dec);
  assert r->'error'->>'code' = 'not_closable', 'a decision is not closed: ' || r::text;
  r := ops_procure.close_meeting_point(v_rev, 'Render rev B, tinggi 380');
  assert ops_core.said_ok(r), 'closed: ' || r::text;
  r := ops_procure.close_meeting_point(v_rev);
  assert r->>'outcome' = 'noop', 'once: ' || r::text;
  assert (select state || '/' || closed_by_name || '/' || closed_note from ops_procure.v_meeting_point where id = v_rev)
       = 'done/Ayu Drafter/Render rev B, tinggi 380', 'done, by whom, with what';
end $$;

-- somebody with neither
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c2003';
do $$
declare r jsonb;
begin
  assert (select count(*) from ops_procure.v_meeting_point) = 0, 'outsider reads no points';
  assert (select count(*) from ops_procure.v_meeting_attendee) = 0, 'nor attendees';
  assert (select count(*) from ops_procure.meeting_people()) = 0, 'nor the people list';
  r := ops_procure.close_meeting_point((select id from ops_procure.meeting_points limit 1));
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
end $$;

-- the helpers write nothing for a signed-in account calling them directly:
-- they are not security definer, and the account has select only
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c2001';
do $$
declare v_refused boolean := false;
begin
  begin
    perform ops_procure.meeting_lines_write(a, null,
      jsonb_build_array(jsonb_build_object('kind','note','body','sneak')))
      from ops_procure.client_activities a limit 1;
  exception when insufficient_privilege then v_refused := true;
  end;
  assert v_refused, 'a direct call to the writer is refused';
  assert (select count(*) from ops_procure.meeting_points where body = 'sneak') = 0, 'and wrote nothing';
end $$;

rollback;
