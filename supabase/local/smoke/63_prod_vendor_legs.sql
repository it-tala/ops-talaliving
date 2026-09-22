-- prod — which vendor had which pieces, and what that makes impossible.
--
-- An order for **12**, subcontracted, and the arc the legs put it through:
--
--   leg A  JOK    6 pcs, sent -10 hari, dijanjikan -3 hari   -> telat 3 hari
--   report AMPLAS 2                                          -> boleh: 6 masih di bengkel
--   leg B  AMPLAS 6 pcs, sent -5 hari, tanpa janji           -> telat? tidak terukur
--   report AMPLAS +1                                         -> DITOLAK: 12 dari 12 di vendor
--   report AMPLAS -1                                         -> boleh: koreksi bukan pekerjaan
--   leg A ditutup, 4 dari 6 kembali                          -> 6 di bengkel lagi
--   report AMPLAS +1                                         -> boleh lagi
--
--   REFUSALS     a closed leg with no count; returning more than went; a
--                promise before the sending; more pieces out than the order
--                has; reporting work on goods that are all away (D255); no
--                DELETE
--   DERIVATIONS  outstanding; days_out; **overdue only against a promise**
--                (D134); and `goods_on_site` as a quantity rather than a flag

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000d1','joko@talaliving.com','{"full_name":"Joko"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000d1','production','write');

insert into ops_procure.vendors (code, name) values
  ('V-9001','Santoso Jok'), ('V-9002','Amplas Jaya');

insert into ops_prod.products (id, product_code, name, category, uom, created_by)
values ('bbbb0000-0000-0000-0000-0000000000d1','PRD-KR-010','Kursi makan','Kursi','unit',
        'ffffffff-0000-0000-0000-0000000000d1');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000d1';

insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, created_by)
values ('spk-uji-20','PRD-KR-010','Kursi makan', 12,'unit','SUBCON', ops_core.office_day() + 10,
        'ffffffff-0000-0000-0000-0000000000d1');

/* ── REFUSALS on the leg itself ────────────────────────────────────────── */
do $$
declare wo uuid;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-20';

  begin
    insert into ops_prod.vendor_legs (wo_id, process, vendor_code, qty, sent_on, returned_on, created_by)
    values (wo,'JOK','V-9001', 6, ops_core.office_day() - 10, ops_core.office_day(),
            'ffffffff-0000-0000-0000-0000000000d1');
    raise exception 'a closed leg with no count should be refused — how many came back is the question';
  exception when check_violation then null;
  end;

  begin
    insert into ops_prod.vendor_legs (wo_id, process, vendor_code, qty, sent_on, expected_back, created_by)
    values (wo,'JOK','V-9001', 6, ops_core.office_day() - 10, ops_core.office_day() - 20,
            'ffffffff-0000-0000-0000-0000000000d1');
    raise exception 'a promise dated before the sending should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── leg A goes out, and the work that is still legitimate ─────────────── */
do $$
declare wo uuid; l record;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-20';
  insert into ops_prod.vendor_legs (leg_no, wo_id, process, vendor_code, qty, sent_on, expected_back, created_by)
  values ('leg-uji-a', wo,'JOK','V-9001', 6, ops_core.office_day() - 10, ops_core.office_day() - 3,
          'ffffffff-0000-0000-0000-0000000000d1');

  select * into l from ops_prod.v_vendor_leg where leg_no = 'leg-uji-a';
  assert l.vendor_name = 'Santoso Jok', 'named by code at the seam, got ' || coalesce(l.vendor_name,'(null)');
  assert l.process_name = 'Jok',        'and the process is its own vocabulary, got ' || l.process_name;
  assert l.outstanding = 6,             'six still out, got ' || l.outstanding;
  assert l.days_out = 10,               'ten days away, got ' || l.days_out;
  assert l.overdue_days = 3,            'three days past a promise, got ' || coalesce(l.overdue_days::text,'(null)');

  -- Six of twelve at the upholsterer leaves six on the bench, and work on
  -- those six is legitimate. `goods_on_site` is a quantity, not a flag.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, worked_by, recorded_by)
  values (wo,'AMPLAS', 2, ops_core.office_day(),'Pranowo','ffffffff-0000-0000-0000-0000000000d1');
end $$;

/* ── leg B goes out, and now nothing is here ───────────────────────────── */
do $$
declare wo uuid; l record; v record;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-20';
  insert into ops_prod.vendor_legs (leg_no, wo_id, process, vendor_code, qty, sent_on, created_by)
  values ('leg-uji-b', wo,'AMPLAS','V-9002', 6, ops_core.office_day() - 5,
          'ffffffff-0000-0000-0000-0000000000d1');

  -- No promise was given, so it cannot be late. Absent is not overdue (D134),
  -- and counting it as on-time would flatter whoever never promises anything.
  select * into l from ops_prod.v_vendor_leg where leg_no = 'leg-uji-b';
  assert l.overdue_days is null, 'no promise, so no lateness, got ' || l.overdue_days;

  -- More pieces out than the order has cannot be true.
  begin
    insert into ops_prod.vendor_legs (wo_id, process, vendor_code, qty, sent_on, created_by)
    values (wo,'PACKING','V-9002', 1, ops_core.office_day(),'ffffffff-0000-0000-0000-0000000000d1');
    raise exception 'thirteen pieces of an order for twelve should be refused';
  exception when check_violation then null;
  end;

  select * into v from ops_prod.v_work_order where wo_no = 'spk-uji-20';
  assert v.at_vendor,                'something is away';
  assert v.at_vendor_qty = 12,       'all twelve, got ' || v.at_vendor_qty;
  assert v.not_returned_qty = 0,     'nothing has come up short yet, got ' || v.not_returned_qty;
  assert v.on_site_qty = 0,          'and nothing is on the bench, got ' || v.on_site_qty;
  assert not v.goods_on_site,        'so nothing is here';
  assert v.subcon_overdue,           'and one leg is past its promise';
  assert v.days_at_vendor = 10,      'from the first thing that went out, got ' || v.days_at_vendor;
end $$;

/* ── D255: work on goods that are not in the building ──────────────────── */
do $$
declare wo uuid; n int;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-20';
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'AMPLAS', 1, ops_core.office_day(),'ffffffff-0000-0000-0000-0000000000d1');
    raise exception 'reporting work on goods that are all at a vendor should be refused';
  exception when check_violation then null;
  end;

  -- A **correction** is still allowed. It is how somebody fixes a figure
  -- recorded before the pieces left, and refusing it would trap the error in
  -- place until they come back.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, note, recorded_by)
  values (wo,'AMPLAS', -1, ops_core.office_day(),'salah hitung kemarin',
          'ffffffff-0000-0000-0000-0000000000d1');
  select count(*) into n from ops_prod.progress_entries where wo_id = wo and qty < 0;
  assert n = 1, 'a correction goes in while the goods are away, got ' || n;
end $$;

/* ── leg A comes back, four of six ─────────────────────────────────────── */
do $$
declare wo uuid; l record; v record;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-20';

  begin
    update ops_prod.vendor_legs set returned_on = ops_core.office_day(), returned_qty = 7
     where leg_no = 'leg-uji-a';
    raise exception 'seven back from a trip of six should be refused';
  exception when check_violation then null;
  end;

  -- Four of six is a legitimate, closed answer. The two that stayed are the
  -- question somebody has to ask the vendor, which is why this is a number.
  update ops_prod.vendor_legs
     set returned_on = ops_core.office_day(), returned_qty = 4, note = 'dua belum selesai dijok'
   where leg_no = 'leg-uji-a';

  select * into l from ops_prod.v_vendor_leg where leg_no = 'leg-uji-a';
  assert l.outstanding = 0,        'the leg is closed, got ' || l.outstanding;
  assert l.overdue_days is null,   'and a closed leg is not overdue, got ' || l.overdue_days;
  assert l.returned_qty = 4,       'four came back, got ' || l.returned_qty;

  select * into v from ops_prod.v_work_order where wo_no = 'spk-uji-20';
  assert v.at_vendor_qty = 6,      'only leg B is still out, got ' || v.at_vendor_qty;
  assert not v.subcon_overdue,     'and the overdue leg is closed';
  /* **Write what is actually in the workshop** (F107, owner 2026-09-18). Two
     of the six never came back, and they are neither at the vendor — that trip
     is over — nor on the bench. Counting only the open legs said six were
     here; four are. The shortfall is subtracted **and shown**, because a count
     that quietly absorbs it is the number somebody schedules against. */
  assert v.not_returned_qty = 2,   'two never came back, and it says so, got ' || v.not_returned_qty;
  assert v.on_site_qty = 4,        '12 minus 6 at the vendor minus 2 missing, got ' || v.on_site_qty;
  assert v.goods_on_site,          'four is still something to work on';

  -- Work is legitimate again.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, worked_by, recorded_by)
  values (wo,'AMPLAS', 1, ops_core.office_day(),'Pranowo','ffffffff-0000-0000-0000-0000000000d1');
end $$;

/* ── REFUSAL: a trip that happened is a fact about where the goods were ── */
do $$
begin
  begin
    delete from ops_prod.vendor_legs where leg_no = 'leg-uji-a';
    raise exception 'deleting a leg should be refused (A5)';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── F107: a shortfall alone can empty the workshop ────────────────────── */
do $$
declare wo uuid; v record;
begin
  insert into ops_prod.work_orders (wo_no, item_name, qty, uom, route, due_date, created_by)
  values ('spk-uji-21','Kursi hilang', 3,'unit','SUBCON', ops_core.office_day() + 10,
          'ffffffff-0000-0000-0000-0000000000d1')
  returning id into wo;

  -- All three went out and none came back. The leg is **closed** — the vendor
  -- has answered — so nothing is out on an open leg, and nothing is here
  -- either.
  insert into ops_prod.vendor_legs (leg_no, wo_id, process, vendor_code, qty, sent_on, returned_on, returned_qty, note, created_by)
  values ('leg-uji-c', wo,'JOK','V-9001', 3, ops_core.office_day() - 20, ops_core.office_day() - 1, 0,
          'rusak semua di vendor','ffffffff-0000-0000-0000-0000000000d1');

  select * into v from ops_prod.v_work_order where wo_no = 'spk-uji-21';
  assert not v.at_vendor,          'the trip is over, so nothing is at a vendor';
  assert v.not_returned_qty = 3,   'but three never came back, got ' || v.not_returned_qty;
  assert v.on_site_qty = 0,        'and the workshop is empty, got ' || v.on_site_qty;
  assert not v.goods_on_site,      'which is the fact the board must show';

  -- And the refusal counts the same pieces the board does.
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'AMPLAS', 1, ops_core.office_day(),'ffffffff-0000-0000-0000-0000000000d1');
    raise exception 'reporting work with nothing in the workshop should be refused';
  exception when check_violation then null;
  end;
end $$;

rollback;
