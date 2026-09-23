-- 58_hr_friday_end.sql — Jumat punya jam pulangnya sendiri, bukan cuma
--                        istirahat yang lebih panjang.
--
-- Yang dibuktikan: keduanya berdiri sendiri — sebuah pola boleh pulang lebih
-- awal dengan istirahat biasa, boleh istirahat lebih lama dengan jam pulang
-- biasa, boleh dua-duanya, boleh tidak sama sekali; yang tidak disebut jatuh
-- ke hari biasa dan **bukan** ke kosong; dan minggu serta bulannya ikut,
-- karena tiga tempat menghitung Jumat dan yang berbahaya adalah kalau dua di
-- antaranya sepakat.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005801','hrd58@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005801','hrd','write');

-- Empat pola yang membelah ruang jawabannya. KANTOR adalah kasus yang
-- menyebabkan kolom ini ada: 08.00–17.15 empat hari, Jumat pulang 16.30,
-- istirahat tetap 90 menit — tepat 7 jam, dan tidak bisa dikatakan dengan
-- istirahat saja tanpa mengarang angka 135 menit yang tak pernah diambil siapa pun.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date - 30, 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "schedules":[
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null},
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":null,"note":null},
     {"code":"PULANG","name":"Pulang awal saja","start_minutes":480,"end_minutes":1020,
      "break_minutes":60,"friday_break_minutes":null,"friday_end_minutes":960,"note":null},
     {"code":"BIASA","name":"Jumat seperti hari lain","start_minutes":480,"end_minutes":1020,
      "break_minutes":60,"friday_break_minutes":null,"friday_end_minutes":null,"note":null}],
   "schedule_by_unit":{}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005801');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000005801"}';

-- Jam per pola, diambil dari jawaban `schedule_roll()` sendiri dan bukan
-- dihitung ulang di sini — sebuah uji yang mengulang aritmatika yang diujinya
-- hanya membuktikan bahwa dua salinan rumus itu sama.
do $$
declare
  s jsonb;
  d numeric; f numeric; w numeric; m numeric;
begin
  for s in select jsonb_array_elements(ops_hr.schedule_roll() -> 'schedules') loop
    d := (s -> 'hours' ->> 'daily_hours')::numeric;
    f := (s -> 'hours' ->> 'friday_hours')::numeric;
    w := (s -> 'hours' ->> 'weekly_hours')::numeric;
    m := (s -> 'hours' ->> 'monthly_hours')::numeric;

    case s ->> 'code'
      -- 08.00–17.15 kurang 60' = 8,25. Jumat 08.00–16.30 kurang 90' = 7,00.
      -- Seminggu 4 × 8,25 + 7 = 40,00 — angka yang diminta pemilik.
      when 'KANTOR' then
        assert d = 8.25, 'KANTOR harian: ' || d;
        assert f = 7.00, 'KANTOR jumat: ' || f;
        assert w = 40.00, 'KANTOR minggu: ' || w;

      -- Jam pulang Jumat null: jatuh ke 16.30, hari biasa. Yang berbeda hanya
      -- istirahatnya. 07.30–16.30 kurang 90' = 7,5 — bukan kosong.
      when 'PRODUKSI' then
        assert d = 8.25, 'PRODUKSI harian: ' || d;
        assert f = 7.50, 'PRODUKSI jumat jatuh ke jam pulang biasa: ' || coalesce(f::text,'(null)');
        assert w = 40.50, 'PRODUKSI minggu: ' || w;

      -- Kebalikannya: istirahat Jumat null, jatuh ke 60'. Yang berbeda hanya
      -- jam pulangnya. 08.00–16.00 kurang 60' = 7,0.
      when 'PULANG' then
        assert d = 8.00, 'PULANG harian: ' || d;
        assert f = 7.00, 'PULANG jumat: ' || coalesce(f::text,'(null)');
        assert w = 39.00, 'PULANG minggu: ' || w;

      -- Dua-duanya null: Jumat memang hari biasa, dan `friday_hours` kosong
      -- supaya layar mengatakan *tidak ada aturan Jumat* dan bukan mengulang
      -- angka harian seolah itu sebuah keputusan.
      when 'BIASA' then
        assert d = 8.00, 'BIASA harian: ' || d;
        assert f is null, 'BIASA seharusnya tidak punya jumat sendiri: ' || f;
        assert w = 40.00, 'BIASA minggu: ' || w;
        assert m = round(40.00 * 52 / 12.0, 2), 'BIASA bulan: ' || m;
    end case;

    -- Bulan selalu turunan dari minggu, di keempat pola.
    if d is not null then
      assert m = round(w * 52 / 12.0, 2),
        (s ->> 'code') || ': bulan bukan turunan minggu — ' || m || ' vs ' || round(w * 52 / 12.0, 2);
    end if;
  end loop;
end $$;

rollback;
