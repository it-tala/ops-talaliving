-- People and reference data for the HR walk (scripts/e2e/walk-hr.mjs), on top
-- of seed-procurement.sql. The walk creates everything else through the
-- screens. Same four roles as the SQL walk (99_sim_hr_to_ledger):
--   Sari — staf HRD: hrd write, payroll write (prepares, cannot approve)
--   Evin — pimpinan: approve_funds, payroll read
--   Rina — keuangan: accounting write, post_ledger, payroll read
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2e00000-0000-0000-0000-0000000005a1','sari@talaliving.com','{"full_name":"Sari Wulandari"}')
on conflict do nothing;
insert into ops_core.user_modules (user_id, module, level) values
  ('e2e00000-0000-0000-0000-0000000005a1','hrd','write'),
  ('e2e00000-0000-0000-0000-0000000005a1','payroll','write'),
  ('e2e00000-0000-0000-0000-00000000ce00','payroll','read'),
  ('e2e00000-0000-0000-0000-00000000ce00','hrd','read'),
  ('e2e00000-0000-0000-0000-00000000f11a','payroll','read')
on conflict do nothing;
insert into ops_core.user_authorities (user_id, authority) values
  ('e2e00000-0000-0000-0000-00000000ce00','approve_funds')
on conflict do nothing;

-- The pay rules are IT's (hr.pay_rules), and the walk starts from a version
-- already in force — the same way the procurement walk starts from a curated
-- vendor. Produksi deliberately has no default pattern, so the walk has a
-- person to pair with one on /hrd/jadwal.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
select 1, ops_core.office_day() - 60, 'aturan awal walk HR', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "overtime_mode":"statutory","flat_multiplier":1,
   "workday_tiers":[{"after_hours":0,"multiplier":1.5},{"after_hours":1,"multiplier":2}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "monthly_divisor":173,"hourly_basis":"company","effective_days_per_year":240,
   "hourly_includes_allowance":false,"overtime_rounding_minutes":0,
   "undertime_mode":"off","undertime_grace_minutes":15,
   "late_grace_minutes":0,"late_mode":"manual","late_forfeits_allowance":false,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR"}
 }'::jsonb, 'e2e00000-0000-0000-0000-0000000005a1'
where not exists (select 1 from ops_hr.pay_rule_sets);
