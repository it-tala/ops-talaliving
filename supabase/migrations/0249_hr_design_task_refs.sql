-- 0249_hr_design_task_refs.sql — a task can be for a design room or a design
-- item (Studio Desain S2, D402, D403).
--
-- A drafter's work is given out from Design as an ordinary HRD task, so the
-- bell, the daily plan, the daily log, the Roadmap and the KPI all apply
-- without anybody typing it twice. The task names what it is for by the room's
-- public code (`26003-A-LR`) or the item's number (`26003-A-LR-01`), never a
-- uuid (ADR-004).
--
-- Enum values alone, in a file of their own: a value added by `alter type …
-- add value` cannot be used in the same transaction (F161). The seams are
-- `0250`.

alter type ops_hr.task_ref_t add value if not exists 'design_room';
alter type ops_hr.task_ref_t add value if not exists 'design_item';
