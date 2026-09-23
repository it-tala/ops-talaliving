-- 62_hr_leave.sql — pengajuan cuti, dan pertemuannya dengan hari yang sudah
--                   punya tanda.
--
-- Yang dibuktikan: rentang terbalik, alasan kosong dan tumpang tindih ditolak
-- dengan kalimat; penolakan **harus** punya alasan, dan itu dijaga constraint
-- bukan hanya seam; persetujuan menulis day mark dan **melewati** hari yang
-- sudah bertanda alih-alih menimpanya — lalu menyebut hari mana; memutuskan
-- dua kali tidak mengubah apa pun; jatah cuti dibaca sebelum keputusan, bukan
-- di slip gaji; dan hari yang sudah disetujui tapi belum lewat terhitung
-- sebagai `booked` sehingga sisanya tidak menipu.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000006201','hrd62@talaliving.com','{"full_name":"Wulan Sari"}'),
  ('ffffffff-0000-0000-0000-000000006202','lain62@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000006201','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000006202','procurement','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, paid_leave_days, joined_on)
values ('aaaa6200-0000-0000-0000-000000000001','B-6201','Karjo','Tukang','Produksi',
        'daily', 180000, 25000, 8, 12, '2026-01-01'),
       -- Jatah dua hari, sengaja. Karjo di atas punya dua belas dan hanya
       -- meminta tiga, jadi batas jatahnya **tidak pernah mengikat** — dan
       -- fixture yang selalu longgar tidak bisa menguji sebuah batas sama
       -- sekali (ketahuan lewat mutasi, seperti F145).
       ('aaaa6200-0000-0000-0000-000000000002','B-6202','Sari','Admin','Kantor',
        'monthly', 4000000, 25000, 8, 2, '2026-01-01');

-- Satu tanggal merah di tengah rentang yang nanti diajukan.
insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
values (ops_core.office_day() + 3, null, 'holiday', 'tanggal merah',
        'ffffffff-0000-0000-0000-000000006201');

set local role authenticated;

/* ── REFUSAL: orang tanpa HRD tidak boleh mengajukan ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006202';
do $$
declare a jsonb;
begin
  a := ops_hr.request_leave('B-6201','cuti', ops_core.office_day() + 2,
                            ops_core.office_day() + 4, 'pulang kampung');
  assert (a -> 'error' ->> 'status')::int = 403, format('403, got %s', a);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006201';

/* ── REFUSALS: bentuk pengajuannya ─────────────────────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.request_leave('B-9999','cuti', ops_core.office_day(), ops_core.office_day(), 'x');
  assert (a -> 'error' ->> 'status')::int = 404, format('404, got %s', a);
  assert a -> 'error' ->> 'message' like '%B-9999%', 'pesannya menyebut siapa: ' || a::text;

  a := ops_hr.request_leave('B-6201','cuti', ops_core.office_day() + 5,
                            ops_core.office_day() + 1, 'terbalik');
  assert a -> 'error' ->> 'code' = 'range_invalid', format('got %s', a);

  a := ops_hr.request_leave('B-6201','cuti', ops_core.office_day() + 2,
                            ops_core.office_day() + 4, '   ');
  assert a -> 'error' ->> 'code' = 'reason_required', format('got %s', a);
end $$;

/* ── mengajukan, dan apa yang terbaca sebelum diputuskan ───────────────── */
do $$
declare a jsonb; v jsonb; no text;
begin
  a := ops_hr.request_leave('B-6201','cuti', ops_core.office_day() + 2,
                            ops_core.office_day() + 4, 'pulang kampung');
  assert a ->> 'outcome' = 'ok', format('got %s', a);
  no := a -> 'data' ->> 'request_no';
  assert no like 'izn-%', 'nomor dokumen: ' || no;

  select to_jsonb(r) into v from ops_hr.v_leave_request r where r.request_no = no;
  assert (v ->> 'days')::int = 3, 'tiga hari kalender: ' || v::text;
  -- Jatah 12 hari dan belum terpakai, jadi ketiganya dibayar — dan itu
  -- terbaca **sekarang**, bukan nanti di slip (D178).
  assert (v ->> 'paid_days')::int = 3, 'paid_days: ' || v::text;
  assert (v ->> 'unpaid_days')::int = 0, 'unpaid_days: ' || v::text;
  -- Tanggal merah di tengahnya sudah kelihatan sebelum siapa pun memutuskan.
  assert (v -> 'clashes')::jsonb ? (ops_core.office_day() + 3)::text,
    'bentrokan seharusnya disebut sebelum keputusan: ' || v::text;

  /* ── REFUSAL: tumpang tindih dengan pengajuan yang masih hidup ───────── */
  a := ops_hr.request_leave('B-6201','izin', ops_core.office_day() + 4,
                            ops_core.office_day() + 6, 'keperluan lain');
  assert a -> 'error' ->> 'code' = 'overlaps_existing', format('got %s', a);

  /* ── REFUSAL: menolak tanpa alasan ──────────────────────────────────── */
  a := ops_hr.decide_leave(no, false, '  ');
  assert a -> 'error' ->> 'code' = 'reason_required', format('got %s', a);

  /* ── menyetujui: menulis tanda, melewati yang sudah ada, menyebut mana ─ */
  a := ops_hr.decide_leave(no, true, null);
  assert a ->> 'outcome' = 'ok', format('got %s', a);
  assert jsonb_array_length(a -> 'data' -> 'marked') = 2,
    'dua hari ditandai: ' || (a -> 'data')::text;
  assert jsonb_array_length(a -> 'data' -> 'skipped') = 1,
    'satu hari dilewati: ' || (a -> 'data')::text;
  assert (a -> 'data' -> 'skipped') ? (ops_core.office_day() + 3)::text,
    'yang dilewati adalah tanggal merahnya: ' || (a -> 'data')::text;

  -- Dan yang dilewati itu **masih tanggal merah**, bukan ditimpa jadi cuti.
  assert (select kind from ops_hr.day_marks
           where work_date = ops_core.office_day() + 3 and employee_id is null) = 'holiday',
    'tanggal merah ditimpa oleh persetujuan cuti';
  -- Yang ditandai membawa nomor pengajuannya, supaya harinya bisa dilacak
  -- balik ke keputusannya.
  assert (select reason from ops_hr.day_marks
           where work_date = ops_core.office_day() + 2
             and employee_id = 'aaaa6200-0000-0000-0000-000000000001') like no || ':%',
    'tanda harus menyebut pengajuannya';

  /* ── REFUSAL: memutuskan dua kali ───────────────────────────────────── */
  a := ops_hr.decide_leave(no, false, 'berubah pikiran');
  assert a -> 'error' ->> 'code' = 'already_decided', format('got %s', a);
end $$;

/* ── jatah yang tidak cukup: dibayar sebagian, dan dikatakan sekarang ──── */
--
-- Sari punya dua hari dan meminta tiga. Selisihnya harus terbaca **sebelum**
-- keputusan (D178), bukan muncul sebagai baris tak dibayar di slip sebulan
-- kemudian — versi itulah yang melahirkan perdebatan yang tak bisa dimenangkan
-- siapa pun.
do $$
declare a jsonb; v jsonb; no text;
begin
  a := ops_hr.request_leave('B-6202','cuti', ops_core.office_day() + 10,
                            ops_core.office_day() + 12, 'urusan keluarga');
  assert a ->> 'outcome' = 'ok', format('got %s', a);
  no := a -> 'data' ->> 'request_no';

  select to_jsonb(r) into v from ops_hr.v_leave_request r where r.request_no = no;
  assert (v ->> 'days')::int = 3, 'tiga hari: ' || v::text;
  assert (v ->> 'paid_days')::int = 2, 'hanya dua yang ditutup jatah: ' || v::text;
  assert (v ->> 'unpaid_days')::int = 1, 'sisanya tidak dibayar: ' || v::text;

  -- Dan izin tidak menyentuh jatah cuti sama sekali (D142): semuanya tak
  -- dibayar, bukan sebagian.
  a := ops_hr.request_leave('B-6202','izin', ops_core.office_day() + 20,
                            ops_core.office_day() + 20, 'keperluan sebentar');
  select to_jsonb(r) into v from ops_hr.v_leave_request r
   where r.request_no = a -> 'data' ->> 'request_no';
  assert (v ->> 'paid_days')::int = 0, 'izin tidak memakai jatah cuti: ' || v::text;
  assert (v ->> 'unpaid_days')::int = 1, 'izin: ' || v::text;
end $$;

/* ── jatah: terpakai, dipesan, dan sisanya ─────────────────────────────── */
do $$
declare b ops_hr.leave_balance_t;
begin
  select * into b from ops_hr.leave_balances() where employee_no = 'B-6201';
  assert b.entitlement = 12, 'jatah: ' || b.entitlement;
  -- Dua hari sudah jadi tanda cuti.
  assert b.taken = 2, 'terpakai: ' || b.taken;
  -- Dan keduanya masih di depan, jadi ikut terhitung dipesan. Tanpa `booked`
  -- layar akan menunjukkan sisa yang terlalu banyak pada pagi hari orang itu
  -- hendak mengambilnya.
  assert b.booked >= 2, 'dipesan: ' || b.booked;
  assert b.over = 0, 'belum melewati jatah: ' || b.over;
  assert b.remaining = greatest(b.entitlement - b.taken - b.booked, 0),
    format('sisa %s tidak konsisten dengan %s - %s - %s', b.remaining, b.entitlement, b.taken, b.booked);
end $$;

/* ── constraint, bukan hanya seam: penolakan tanpa alasan lewat SQL ────── */
reset role;
do $$
declare refused boolean := false;
begin
  begin
    insert into ops_hr.leave_requests
      (employee_id, kind, from_date, to_date, reason, status, requested_by,
       decided_by, decided_at, decision_note)
    values ('aaaa6200-0000-0000-0000-000000000001','izin',
            ops_core.office_day() + 40, ops_core.office_day() + 40, 'x','REJECTED',
            'ffffffff-0000-0000-0000-000000006201',
            'ffffffff-0000-0000-0000-000000006201', now(), null);
  exception when check_violation then refused := true;
  end;
  assert refused, 'penolakan tanpa alasan lolos lewat insert langsung';
end $$;

-- Dan keputusan setengah jadi: status berubah tanpa nama siapa pun.
do $$
declare refused boolean := false;
begin
  begin
    insert into ops_hr.leave_requests
      (employee_id, kind, from_date, to_date, reason, status, requested_by)
    values ('aaaa6200-0000-0000-0000-000000000001','izin',
            ops_core.office_day() + 50, ops_core.office_day() + 50, 'x','APPROVED',
            'ffffffff-0000-0000-0000-000000006201');
  exception when check_violation then refused := true;
  end;
  assert refused, 'status APPROVED tanpa siapa dan kapan lolos';
end $$;

rollback;
