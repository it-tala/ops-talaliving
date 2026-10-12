-- 0260_core_qc_module.sql — a module for the field QC team (O6, kajian F255
-- §5.7, D412–D414).
--
-- Alone in its file because Postgres will not let a new enum value be used in
-- the transaction that added it (F161); 0261 uses it straight away.
--
--   **qc** is a module of its own. The people who watch a partner factory are
--   outsiders with an ops account (Q88, D414): they are not staff, so `hrd`
--   is wrong, and they must not see prices, so `procurement` and `project`
--   are wrong. The coordinator holds `qc: admin`; a QC holds `qc: write`, and
--   sees only the factory orders assigned to them.
--
--   **qc_assignment** is a record a file can be filed against — the reports
--   and photos of O7 hang off an assignment.

alter type ops_core.module_t      add value if not exists 'qc';
alter type ops_core.link_entity_t add value if not exists 'qc_assignment';
