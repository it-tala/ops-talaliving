-- 56_hr_pay_rules.sql — the rule book: who may publish one, when a version may
--                       reach backwards, and what a candidate would cost.
--
-- What this proves: HRD knows the numbers and IT writes them (D173); a
-- correction may share the date of the version it corrects and the later
-- version wins (D270); a version may reach back only while no run has left
-- DRAFT over those days — money, not the calendar, is the line; a date inside
-- an existing period is refused because payroll would silently ignore it; and
-- a preview computes the whole payroll under a book that was never saved,
-- leaving nothing behind.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005601','it56@talaliving.com','{"full_name":"Staf IT"}'),
  ('ffffffff-0000-0000-0000-000000005602','hrd56@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005603','gaji56@talaliving.com','{"full_name":"Staf Payroll"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005601','it','write'),
  ('ffffffff-0000-0000-0000-000000005602','hrd','write'),
  ('ffffffff-0000-0000-0000-000000005603','payroll','admin');

-- Somebody to compute. Daily, so the hourly rate and the overtime ladder both
-- reach the figure.
insert into ops_hr.employees
  (employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, paid_leave_days, joined_on)
values ('B-5601','Karjo','Tukang','Produksi','daily', 180000, 25000, 8, 12, '2026-01-01');

-- Dua run, dibuat di sini sebagai perkakas dan bukan lewat seam-nya: yang
-- diuji berkas ini adalah buku aturan, bukan cara sebuah run lahir. Satu sudah
-- ditandatangani — itu uang yang sudah dihitung — dan satu masih draft.
insert into ops_hr.payroll_runs (period_start, period_end, status, approved_by, approved_at)
values ('2026-03-01','2026-03-07','APPROVED','ffffffff-0000-0000-0000-000000005603', now());
insert into ops_hr.payroll_runs (period_start, period_end) values ('2026-05-01','2026-05-07');

set local role authenticated;

/* ── REFUSAL: HRD knows the numbers and does not write them (D173) ─────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005602';
do $$
declare a jsonb;
begin
  a := ops_hr.save_pay_rules(current_date + 1, 'coba', '{"week_pattern":"6day"}'::jsonb);
  assert a ->> 'outcome' = 'refused', 'HRD menulis buku aturan: ' || (a ->> 'outcome');
  assert a #>> '{error,code}' = 'not_permitted', a #>> '{error,code}';

  a := ops_hr.preview_pay_rules('{"week_pattern":"6day"}'::jsonb, '2026-02-01','2026-02-07');
  assert a ->> 'outcome' = 'refused', 'HRD mencoba aturan: ' || (a ->> 'outcome');
end $$;

/* ── IT publishes the first version ───────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005601';
do $$
declare a jsonb;
begin
  a := ops_hr.save_pay_rules(current_date, '', '{"week_pattern":"6day"}'::jsonb);
  assert a #>> '{error,code}' = 'note_required',
    'aturan tanpa alasan diterima: ' || coalesce(a #>> '{error,code}', a ->> 'outcome');

  a := ops_hr.save_pay_rules(current_date, 'v1: jam kerja awal', '{
    "week_pattern":"6day", "late_mode":"manual", "overtime_mode":"statutory",
    "workday_tiers":[{"after_hours":0,"multiplier":1.5}],
    "restday_tiers":[{"after_hours":0,"multiplier":2}],
    "effective_days_per_year":300, "day_starts_minutes":480,
    "schedules":[{"code":"PRODUKSI","name":"Produksi","start_minutes":450,
                  "end_minutes":990,"break_minutes":45,"friday_break_minutes":90,"note":null}],
    "schedule_by_unit":{"Produksi":"PRODUKSI"}
  }'::jsonb);
  assert a ->> 'outcome' = 'ok', a ->> 'outcome';
  assert (a #>> '{data,version}')::int = 1, a #>> '{data,version}';
  assert a #>> '{data,corrects}' is null, 'versi pertama mengoreksi sesuatu';
end $$;

/* ── D270: a correction shares the date, and the later version wins ────── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_pay_rules(current_date, 'v2: koreksi v1 dari tanggal yang sama', '{
    "week_pattern":"6day", "late_mode":"manual", "overtime_mode":"flat",
    "flat_multiplier":2, "effective_days_per_year":300, "day_starts_minutes":450,
    "schedules":[{"code":"PRODUKSI","name":"Produksi","start_minutes":450,
                  "end_minutes":990,"break_minutes":45,"friday_break_minutes":90,"note":null}],
    "schedule_by_unit":{"Produksi":"PRODUKSI"}
  }'::jsonb);
  assert a ->> 'outcome' = 'ok',
    'koreksi tanggal-sama ditolak — D270 justru memintanya: ' || coalesce(a #>> '{error,code}', '');
  assert (a #>> '{data,corrects}')::int = 1,
    'koreksi tidak menyebut versi yang dikoreksinya: ' || coalesce(a #>> '{data,corrects}','∅');

  -- Yang menyala adalah versi tertinggi di tanggal itu, bukan urutan baris.
  assert ops_hr.rules_on(current_date) ->> 'overtime_mode' = 'flat',
    'rules_on memilih versi lama: ' || (ops_hr.rules_on(current_date) ->> 'overtime_mode');
  assert (select count(*) from ops_hr.v_pay_rule_set where is_current) = 1,
    'lebih dari satu versi mengaku berlaku';
  assert (select version from ops_hr.v_pay_rule_set where is_current) = 2,
    'yang berlaku bukan koreksinya';
end $$;

/* ── a candidate book, computed and thrown away ───────────────────────── */
do $$
declare a jsonb; before_mode text;
begin
  before_mode := ops_hr.rules_on(current_date) ->> 'overtime_mode';

  a := ops_hr.preview_pay_rules('{
    "week_pattern":"6day", "late_mode":"manual", "overtime_mode":"flat",
    "flat_multiplier":2, "effective_days_per_year":250, "day_starts_minutes":450,
    "schedules":[], "schedule_by_unit":{}
  }'::jsonb, '2026-02-01','2026-02-07');
  assert a ->> 'outcome' = 'ok', coalesce(a #>> '{error,code}', a ->> 'outcome');
  assert a #>> '{data,period}' = '2026-02-01 → 2026-02-07', a #>> '{data,period}';
  assert jsonb_typeof(a #> '{data,lines}') = 'array', 'lines bukan array';

  -- **Tidak meninggalkan apa pun.** Sebuah pratinjau yang lupa membersihkan
  -- override-nya membuat setiap bacaan berikutnya di transaksi ini memakai
  -- buku yang tidak pernah disimpan — dan tidak ada yang akan mengatakannya.
  assert ops_hr.rules_on(current_date) ->> 'overtime_mode' = before_mode,
    'pratinjau meninggalkan bukunya: ' || (ops_hr.rules_on(current_date) ->> 'overtime_mode');
  assert coalesce(current_setting('ops_hr.preview_rules', true), '') = '',
    'setelan pratinjau masih terpasang';

  a := ops_hr.preview_pay_rules('{"week_pattern":"6day"}'::jsonb, '2026-02-08','2026-02-01');
  assert a #>> '{error,code}' = 'period_invalid', coalesce(a #>> '{error,code}','∅');
end $$;

/* ── a run that has left DRAFT is the line, not the calendar ──────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_pay_rules('2026-03-01','mundur melewati run yang sudah ditandatangani',
        '{"week_pattern":"6day"}'::jsonb);
  assert a #>> '{error,code}' = 'already_paid',
    'aturan mundur melewati uang yang sudah dibayar: ' || coalesce(a #>> '{error,code}', a ->> 'outcome');

  -- Di tengah periode sebuah run **DRAFT**, bukan yang sudah ditandatangani:
  -- kalau diuji atas yang APPROVED, `already_paid` menjawab lebih dulu dan
  -- cabang ini tidak pernah menyala sekali pun (F95). Ditolak karena payroll
  -- memakai buku yang berlaku saat periodenya **dibuka**, jadi versi ini akan
  -- terlihat berlaku dan tidak mengubah apa pun.
  a := ops_hr.save_pay_rules('2026-05-04','di tengah periode draft', '{"week_pattern":"6day"}'::jsonb);
  assert a #>> '{error,code}' = 'inside_existing_run',
    'di tengah periode diterima: ' || coalesce(a #>> '{error,code}', a ->> 'outcome');
end $$;

/* ── a DRAFT run has paid nobody, so the book may still move ──────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_pay_rules('2026-04-01','sebelum run yang masih draft', '{"week_pattern":"6day"}'::jsonb);
  assert a ->> 'outcome' = 'ok',
    'run DRAFT menahan buku aturan padahal belum membayar siapa pun: '
    || coalesce(a #>> '{error,code}', a ->> 'outcome');
end $$;

/* ── IT may read the book it owns (0043 hanya memberi HRD dan payroll) ── */
do $$
begin
  assert (select count(*) from ops_hr.v_pay_rule_set) >= 3,
    'IT tidak bisa membaca buku aturan yang ia tulis sendiri';
end $$;

rollback;
