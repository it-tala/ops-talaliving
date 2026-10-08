-- 0240_hr_goal_candidate_status.sql — a goal that may or may not happen (D393).
--
-- Alone in its file because a new enum value cannot be used in the
-- transaction that adds it (F161); 0241 is what uses it.

alter type ops_hr.goal_status_t add value if not exists 'CANDIDATE' before 'OPEN';
