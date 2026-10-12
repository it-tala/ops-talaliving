-- 0263_core_qc_report_kinds.sql — the records a QC report and a finding are,
-- and the kind of file a QC photo is (O7, kajian F255 §5.7).
--
--   link_entity_t  `qc_report`, `qc_finding` — a photo is linked to the report
--                  or finding it shows.
--   doc_kind_t     `foto_qc` — its own kind, not `foto`: `foto` is filed in
--                  PROCUREMENT with the goods received, a QC photo in PROJECT
--                  MANAGER with the project the factory is making (§5.7).
--
-- Their own migration because a value added by `alter type … add value`
-- cannot be used in the same transaction (F161). Tables, folders and seams are
-- `0264`.

alter type ops_core.link_entity_t add value if not exists 'qc_report';
alter type ops_core.link_entity_t add value if not exists 'qc_finding';
alter type ops_core.doc_kind_t    add value if not exists 'foto_qc';
