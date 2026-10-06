-- 0227_hr_task_cadence_daily.sql — a sixth cadence: every working day (D383).
--
-- Alone in its file because a new enum value cannot be used in the
-- transaction that adds it (F161); 0228 is what uses it.
--
-- 0152 said *a sixth is a migration, and one worth arguing about*. The
-- argument, 2026-10-06: the owner asked for *"tugas rutin setiap hari juga"* —
-- the daily checks and backups that today live in nobody's list.

alter type ops_hr.task_cadence_t add value if not exists 'DAILY' before 'WEEKLY';
